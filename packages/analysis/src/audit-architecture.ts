import {
  resolveAuditArchitecture,
  type AuditArchitectureNode,
} from "../../contracts/src/audit-architecture";
import {
  eventLossHours,
  mechanismEventIds,
  faultTypeLabels,
  type AuditEventView,
} from "../../contracts/src/audit-objects";
import { auditMechanismSummary } from "../../contracts/src/audit-mechanism-view";
import {
  auditExtensionCatalog,
  existingMechanismClasses,
} from "../../contracts/src/audit-extensions";
import {
  hardwareCount,
  hardwareScaleEvents,
} from "../../contracts/src/audit-hardware";
import { auditReferenceOnly } from "../../contracts/src/audit-presets";
import { equivalentMttrSeconds } from "../../contracts/src/audit-recovery-budget";
import { topologyDecision } from "./audit-topology-decision";
import { agreeLossAllocation } from "./audit-allocation";
import {
  layerEvidenceAllocation,
  type LayerAllocationReference,
} from "./audit-layer-allocation";

export const architectureLossNames: Record<string, string> = {
  downtime: "恢复停机",
  rollback: "回滚重算",
  terminalInvalid: "期末污染",
  slowdown: "亚健康降速",
  localLoss: "局部容量损失",
  save: "保存阻塞",
  mechanismOverhead: "检测与机制开销",
};
const scopes: Record<string, string> = {
  hardDetect: "hard",
  slowDetect: "slow",
  sdcDetect: "sdc",
  step: "sdc",
  replay: "replay",
  process: "process",
  elastic: "elastic",
  fast: "all",
};

export function architectureMechanismCoverage(result: any) {
  const events = result.events as AuditEventView[];
  const inferred =
    result.request.mechanisms === undefined && !result.selection
      ? {
          deployed: result.baseline?.mechanisms ?? [],
          candidates:
            result.attribution?.[0]?.contributions?.map((c: any) => c.id) ?? [],
        }
      : result.selection;
  const core = auditMechanismSummary(result.request, inferred).ids.map(
    (id) => ({
      id,
      eventIds: mechanismEventIds(events, scopes[id] ?? "all"),
      overhead: id === "fast",
    }),
  );
  const extensions: { id: string; eventIds: string[]; overhead: boolean }[] = (
    result.configuration?.extensions ?? []
  ).map((m: any) => {
    const candidates = auditExtensionCatalog.find((e) => e.id === m.id)
      ?.eventCandidates as string[] | undefined;
    return {
      id: m.id,
      eventIds: events
        .filter((e) => !candidates?.length || candidates.includes(e.id))
        .map((e) => e.id),
      overhead: m.id === "C-ASYNC",
    };
  });
  return [...core, ...extensions];
}

export function architectureBudgets(
  architecture: ReturnType<typeof resolveAuditArchitecture>,
  cards: number,
  hours: number,
  budget: number | null,
) {
  const root = architecture.nodes.find((n) => !n.parentId)!;
  const children = (id: string) =>
    architecture.nodes.filter((n) => n.parentId === id);
  const budgets = new Map<string, number | null>([[root.id, budget]]);
  const split = (parent: AuditArchitectureNode) => {
    const group = children(parent.id),
      total = budgets.get(parent.id) ?? null;
    if (!group.length) return;
    let values: (number | null)[];
    if (total === null || architecture.budgetMethod === "agree-evidence")
      values = group.map(() => null);
    else if (architecture.budgetMethod === "agree" && total > 0) {
      const allocated = agreeLossAllocation(
        total,
        hours,
        group.map((n) => ({
          id: n.id,
          name: n.name,
          importance: n.importance,
          complexity: n.scaleWeights?.[cards] ?? n.weight,
          actualHours: 0,
        })),
      );
      values = allocated.items.map((i) => i.allowedHours);
    } else {
      const weights = group.map((n) =>
        architecture.budgetMethod === "equal"
          ? 1
          : (n.scaleWeights?.[cards] ?? n.weight),
      );
      const sum = weights.reduce((a, b) => a + b, 0);
      values = weights.map((w) => (total * w) / sum);
    }
    group.forEach((n, i) => {
      budgets.set(n.id, values[i]);
      split(n);
    });
  };
  split(root);
  return budgets;
}

/** A diagnostic roll-up of the ORIGINAL solver ledger. No new availability solver. */
export function auditArchitectureDiagnosis(
  result: any,
  reference?: LayerAllocationReference,
) {
  const architecture = resolveAuditArchitecture(
    result.request.architecture,
    result.events,
  );
  const root = architecture.nodes.find((n) => !n.parentId)!;
  const events = result.events as AuditEventView[],
    hours: number = result.request.hours;
  const coverage = architectureMechanismCoverage(result);
  const children = (id: string) =>
    architecture.nodes.filter((n) => n.parentId === id);
  const descendants = (n: AuditArchitectureNode): string[] => [
    n.id,
    ...children(n.id).flatMap(descendants),
  ];
  const ids = new Map(architecture.nodes.map((n) => [n.id, descendants(n)]));
  const rows: any[] = result.rows.filter(
    (r: any) => !r.id || r.id === "combined",
  );
  const scales = rows.map((row: any) => {
    const cards: number = row.cards;
    const scaleEvents: AuditEventView[] =
      row.scaleEvents ?? hardwareScaleEvents(events, architecture, cards);
    const target: number =
      cards === result.request.cards
        ? result.request.target
        : (result.request.targets?.[String(cards)] ?? result.request.target);
    const referenceOnly = auditReferenceOnly(result.request, cards);
    const budget =
      referenceOnly || architecture.budgetMethod === "none"
        ? null
        : (1 - target) * hours;
    const evidencePlan =
      architecture.budgetMethod === "agree-evidence"
        ? layerEvidenceAllocation(
            architecture,
            scaleEvents,
            row,
            coverage,
            result.attribution?.find((a: any) => a.cards === cards)
              ?.contributions ?? [],
            hours,
            budget,
            cards,
          )
        : null;
    const frozen = reference?.scales.find((s) => s.cards === cards);
    const budgets = evidencePlan
      ? frozen
        ? new Map(frozen.nodes.map((n) => [n.id, n.allowedHours]))
        : evidencePlan.budgets
      : architectureBudgets(architecture, cards, hours, budget);
    const nodes = architecture.nodes.map((n) => {
      const included = new Set(ids.get(n.id)!);
      const eventIds = architecture.nodes
        .filter((c) => included.has(c.id))
        .flatMap((c) => c.eventIds);
      const eventSet = new Set(eventIds);
      const selectedEvents = scaleEvents.filter((e) => eventSet.has(e.id));
      const missingData = architecture.nodes.filter(
        (c) =>
          included.has(c.id) &&
          c.kind !== "overhead" &&
          !children(c.id).length &&
          !c.eventIds.length,
      );
      const hasOverhead = architecture.nodes.some(
        (c) => included.has(c.id) && c.kind === "overhead",
      );
      const loss: Record<string, number> = Object.fromEntries(
        Object.keys(architectureLossNames).map((key) => [key, 0]),
      );
      let observedEvents = 0,
        recoveries = 0;
      for (const id of eventIds) {
        const item = row.perEvent?.[id] ?? {};
        observedEvents += item.events ?? 0;
        recoveries += item.recoveries ?? 0;
        for (const key of Object.keys(loss))
          if (!["save", "mechanismOverhead"].includes(key))
            loss[key] += item[key] ?? 0;
      }
      if (hasOverhead) {
        loss.save = row.ledger.save ?? 0;
        loss.mechanismOverhead = row.ledger.mechanismOverhead ?? 0;
      }
      const actualHours = Object.values(loss).reduce((a, b) => a + b, 0),
        allowedHours = budgets.get(n.id) ?? null;
      const types = ["hard", "slow", "sdc"].map((type) => {
        const fit = selectedEvents
          .filter((e) => e.type === type)
          .reduce((a, e) => a + e.fit, 0);
        const rate = (cards * fit) / 1e9;
        return {
          type,
          name: faultTypeLabels[type],
          fit,
          rate,
          intervalHours: rate > 0 ? 1 / rate : null,
          lossHours: selectedEvents
            .filter((e) => e.type === type)
            .reduce((sum, e) => sum + eventLossHours(row.perEvent?.[e.id]), 0),
        };
      });
      const mechanisms = coverage
        .filter(
          (m) =>
            m.eventIds.some((id) => eventSet.has(id)) ||
            (hasOverhead && m.overhead),
        )
        .map((m) => m.id);
      const drivers = selectedEvents
        .map((e) => ({
          id: e.id,
          name: e.description ?? e.domain,
          type: e.type,
          fit: e.fit,
          lossHours: eventLossHours(row.perEvent?.[e.id]),
          source: e.source ?? "未提供来源",
          evidence: e.evidence ?? "未标注",
        }))
        .sort((a, b) => b.lossHours - a.lossHours);
      const largestLoss = Object.entries(loss).sort((a, b) => b[1] - a[1])[0];
      const extensions = auditExtensionCatalog
        .filter(
          (m) =>
            (hasOverhead && m.id === "C-ASYNC") ||
            m.eventCandidates.some((id: string) => eventSet.has(id)),
        )
        .map((m) => ({
          id: m.id,
          name: m.name,
          stage: m.stage,
          source: m.sourceIds.join("、"),
        }));
      const focus =
        largestLoss?.[1] > 0
          ? architectureLossNames[largestLoss[0]]
          : "本样本未观察到损失";
      const action =
        largestLoss?.[1] <= 1e-12
          ? "补充暴露量与验证证据，暂不推断该层无风险"
          : largestLoss?.[0] === "terminalInvalid" ||
              (drivers[0]?.type === "sdc" && largestLoss?.[0] === "rollback")
            ? "复核静默检出覆盖、发现时延与干净状态恢复"
            : largestLoss?.[0] === "save"
              ? "权衡保存阻塞、检查点周期与持久化滞后"
              : largestLoss?.[0] === "mechanismOverhead"
                ? "复核检测吞吐开销与适用范围"
                : largestLoss?.[0] === "slowdown"
                  ? "复核亚健康检出时延、隔离与恢复"
                  : "复核检测等待、局部恢复成功率与失败升级耗时";
      return {
        ...n,
        allocationEvidence: evidencePlan
          ? (frozen?.nodes.find((r) => r.id === n.id)?.allocationEvidence ??
            evidencePlan.evidence.get(n.id) ??
            null)
          : null,
        leaf: children(n.id).length === 0,
        eventIds,
        quantity:
          n.kind === "overhead"
            ? null
            : hardwareCount(architecture, n.id, cards),
        dataStatus: missingData.length
          ? selectedEvents.length || hasOverhead
            ? "partial"
            : "unknown"
          : "modeled",
        missingObjects: missingData.map((c) => c.name),
        targetAvailability:
          allowedHours === null ? null : 1 - allowedHours / hours,
        attributedAvailability: 1 - actualHours / hours,
        frequencyRecovery: {
          hardEventIntervalHours:
            types.find((t) => t.type === "hard")?.intervalHours ?? null,
          targetEquivalentMttrSeconds:
            allowedHours === null
              ? null
              : equivalentMttrSeconds(
                  types.find((t) => t.type === "hard")?.intervalHours ?? null,
                  1 - allowedHours / hours,
                ),
          targetConversionBasis:
            "按本层hard事件间隔与损失责任目标作MTBF×(1−A)/A条件换算；包含各类损失预算，不是单项物理恢复时限，不与其他层秒数直接相加。",
          physicalFitReductionAssumed: false,
          otherLossHours: actualHours - loss.downtime,
          recoveryOnlyFeasible:
            allowedHours === null
              ? null
              : actualHours - loss.downtime <= allowedHours,
          requiredPauseSeconds:
            allowedHours === null ||
            recoveries <= 0 ||
            actualHours - loss.downtime > allowedHours
              ? null
              : (Math.max(0, allowedHours - (actualHours - loss.downtime)) /
                  recoveries) *
                3600,
          basis:
            "固定本轮恢复次数及其他损失的单侧诊断，非独立MTTR分配或正向复评；硬中断事件间隔不等于业务中断MTBF。",
          frequencyAction: n.rateModel
            ? "可比较设备数量方案；保持单件故障依据，核查容量、带宽、冗余和共因后独立复评"
            : "源FIT保持现有证据；需先建立设备数量与事件暴露映射，再评估减少器件的组网方案",
        },
        businessMtbfHours: null,
        propagationRecords: (architecture.propagations ?? []).filter((p) =>
          eventSet.has(p.eventId),
        ),
        mechanismEffects: mechanisms.map((id) => ({
          id,
          effect:
            existingMechanismClasses[id]?.effect ??
            auditExtensionCatalog.find((m) => m.id === id)?.effect ??
            "需核对作用范围",
        })),
        types,
        fit: types.reduce((a, t) => a + t.fit, 0),
        observedEvents,
        recoveries,
        recoveryPauseSeconds:
          recoveries > 0 ? (loss.downtime / recoveries) * 3600 : null,
        equivalentLossSeconds:
          observedEvents > 0
            ? ((actualHours - loss.save - loss.mechanismOverhead) /
                observedEvents) *
              3600
            : null,
        loss,
        actualHours,
        lossFraction: actualHours / hours,
        allowedHours,
        excessHours: allowedHours === null ? null : actualHours - allowedHours,
        mechanisms,
        drivers,
        extensions,
        focus,
        action,
      };
    });
    const rootNode = nodes.find((n) => n.id === root.id)!;
    const leaves = nodes.filter((n) => n.leaf);
    const totalLossHours = (1 - row.statistics.mean) * hours;
    const residualHours =
      leaves.reduce((a, n) => a + n.actualHours, 0) - totalLossHours;
    const weaknesses = leaves
      .filter((n) => n.actualHours > 1e-12)
      .sort(
        (a, b) =>
          (b.excessHours ?? b.actualHours) - (a.excessHours ?? a.actualHours),
      )
      .map((n, i) => ({
        id: n.id,
        rank: i + 1,
        name: n.name,
        lossHours: n.actualHours,
        excessHours: n.excessHours,
        focus: n.focus,
        action: n.action,
        mechanisms: n.mechanisms,
        events: n.drivers.slice(0, 3).map((d) => d.id),
      }));
    const ranking = (
      result.attribution?.find((a: any) => a.cards === cards)?.contributions ??
      []
    )
      .slice()
      .sort((a: any, b: any) => b.statistics.mean - a.statistics.mean)
      .map((c: any, i: number) => ({ ...c, rank: i + 1 }));
    return {
      cards,
      target,
      referenceOnly,
      statistics: row.statistics,
      allowedHours: budget,
      actualHours: rootNode.actualHours,
      residualHours,
      nodes,
      weaknesses,
      ranking,
      scaleEvents,
      allocationMethod: evidencePlan?.method ?? architecture.budgetMethod,
      allocationBasis: evidencePlan?.basis ?? "显式设计参照",
      allocationFrozen: !!frozen && !!evidencePlan,
      allocationIssues: frozen
        ? (frozen.allocationIssues ?? [])
        : (evidencePlan?.issues ?? []),
    };
  });
  return {
    version:
      result.kind === "expert-audit-experiment"
        ? "architecture-diagnosis.incremental.v1"
        : "architecture-diagnosis.v1",
    architecture,
    hours,
    scales,
    notes: [
      "硬件数量可逐规模填写；数量折算仅在显式启用且提供参考数量与依据时进入求解。当前源FIT仍为NPU等效业务影响率，不能再次作为实测单器件FIT相乘。",
      "架构目标和现状百分比为折算至业务口径的损失责任；未知故障对象不代表零风险。图中连接、共享故障域及传播路径是证据记录，不自动改变传播概率或引入冗余收益。",
      "业务中断MTBF需要中断定义及独立计数，当前不由硬件FIT冒充。快速倒换可缩短恢复；只有符合业务连续性条件才可归为提高业务MTBF，同一收益不重复计算。",
      "分层目标是系统损失责任预算；父层汇总子层，不是各模块自身运行可用度，也不直接连乘。",
      "FIT为NPU等效业务影响事件率，按评估卡数换算一次；故障时钟按非全局停机暴露运行，hard、slow与sdc均显示输入事件间隔；业务中断MTBF需独立观测。",
      "恢复停机/次来自仿真事件账，包含检测、失败回退及窗口截断，不代表完整物理修复MTTR；局部损失另计。",
      "未观察到事件时恢复时间留空；公共保存与检测开销独立计账，共同依赖仅作架构关系展示，不自动增加故障或收益。",
      "分层差距与排名基于本次样本均值，未提供分层置信区间；总指标区间仅反映抽样误差，不代表参数与故障归属已验证。",
    ],
  };
}
export type AuditArchitectureDiagnosis = ReturnType<
  typeof auditArchitectureDiagnosis
>;

export function architectureReviewChecks(
  diagnosis: AuditArchitectureDiagnosis,
) {
  const maximum = Math.max(
    0,
    ...diagnosis.scales.map((scale) => Math.abs(scale.residualHours)),
  );
  return [
    ...(diagnosis.scales.some((s) => s.allocationIssues?.length)
      ? [
          {
            name: "分层AGREE分配可行性",
            status: "failed",
            detail: diagnosis.scales
              .flatMap((s) =>
                s.allocationIssues.map(
                  (i) => `${s.cards}卡 ${i.id}: ${i.message}`,
                ),
              )
              .join("；"),
          },
        ]
      : []),
    {
      name: "分层损失与总体可用度一致",
      status: maximum < 1e-6 ? "passed" : "failed",
      detail: `${diagnosis.scales.length}个规模；叶层互斥计账、父层只汇总；最大残差${maximum.toExponential(3)}小时`,
    },
  ];
}

const mechanismLossScopes: Record<string, string[]> = {
  hardDetect: ["downtime"],
  slowDetect: ["downtime", "slowdown"],
  sdcDetect: ["downtime", "rollback", "terminalInvalid"],
  step: ["downtime", "rollback", "terminalInvalid"],
  replay: ["downtime", "rollback"],
  process: ["downtime", "rollback"],
  elastic: ["downtime", "rollback", "localLoss"],
  fast: ["save", "rollback", "terminalInvalid"],
};
const eventLossScopes: Record<string, string[]> = {
  hard: ["downtime", "rollback", "localLoss"],
  slow: ["downtime", "slowdown"],
  sdc: ["downtime", "rollback", "terminalInvalid"],
};

/** Partition design responsibility by actual scope; this is not a causal Shapley decomposition of losses. */
export function architectureResponsibilities(
  result: any,
  diagnosis: AuditArchitectureDiagnosis,
  cards: number,
  contributions: any[],
) {
  const scale = diagnosis.scales.find((s) => s.cards === cards)!;
  const coverage = architectureMechanismCoverage(result);
  const row = result.rows.find(
    (r: any) => r.cards === cards && (!r.id || r.id === "combined"),
  );
  const topology =
    result.topologyDecision ??
    topologyDecision({ ...result, architectureDiagnosis: diagnosis });
  const projectedScale = topology?.scales.find((s: any) => s.cards === cards);
  const projected = projectedScale?.scenarios[0];
  const projectedEvidence =
    topology?.estimates.filter(
      (e: any) => e.cards === cards && e.scenario === projected?.name,
    ) ?? [];
  const projectedNodes = projected?.nodes.map((n: any) => ({
    ...n,
    leaf: !projected.nodes.some((c: any) => c.parentId === n.id),
    kind: n.id === "overhead" ? "overhead" : "object",
    eventIds: projectedEvidence
      .filter((e: any) => e.nodeId === n.id)
      .map((e: any) => e.eventId),
  })) as AuditArchitectureDiagnosis["scales"][number]["nodes"] | undefined;
  return (projectedNodes ?? scale.nodes)
    .filter((n) => n.leaf)
    .flatMap((n) => {
      const segments =
        n.kind === "overhead"
          ? [
              {
                eventId: "save",
                lossKey: "save",
                actualHours: n.loss.save,
                weight: 1,
              },
              {
                eventId: "mechanismOverhead",
                lossKey: "mechanismOverhead",
                actualHours: n.loss.mechanismOverhead,
                weight: 1,
              },
            ]
          : n.eventIds.length
            ? n.eventIds.flatMap((eventId) => {
                const event = (scale.scaleEvents ?? result.events).find(
                  (e: any) => e.id === eventId,
                );
                const keys =
                  eventLossScopes[event?.type ?? ""] ??
                  Object.keys(architectureLossNames).filter(
                    (key) => !["save", "mechanismOverhead"].includes(key),
                  );
                const projectionFraction = projected
                  ? (projectedEvidence.find(
                      (e: any) => e.nodeId === n.id && e.eventId === eventId,
                    )?.fraction ?? 0)
                  : 1;
                return keys.map((lossKey) => ({
                  eventId,
                  lossKey,
                  actualHours:
                    (row.perEvent?.[eventId]?.[lossKey] ?? 0) *
                    projectionFraction,
                  weight:
                    ((event?.fit ?? 0) * projectionFraction) / keys.length,
                }));
              })
            : [
                {
                  eventId: "unassigned",
                  lossKey: "unassigned",
                  actualHours: n.actualHours,
                  weight: 1,
                },
              ];
      const weight = segments.reduce((s, e) => s + e.weight, 0);
      const links = segments.flatMap((segment) => {
        const applicable = contributions.filter((c) => {
          const m = coverage.find((m) => m.id === c.id);
          return (
            m &&
            (segment.eventId === "save"
              ? m.overhead
              : segment.eventId === "mechanismOverhead"
                ? c.id.endsWith("Detect")
                : m.eventIds.includes(segment.eventId) &&
                  (mechanismLossScopes[c.id]?.includes(segment.lossKey) ??
                    false))
          );
        });
        const positive = applicable.reduce(
          (a, c) => a + Math.max(0, c.statistics.mean),
          0,
        );
        const parts = applicable.length
          ? applicable
          : [
              {
                id: "unaddressed",
                name: "未覆盖设计责任",
                statistics: { mean: 0 },
              },
            ];
        return parts.map((c) => {
          const share = positive
            ? Math.max(0, c.statistics.mean) / positive
            : 1 / parts.length;
          return {
            layerId: n.id,
            layerName: n.name,
            mechanismId: c.id,
            mechanismName: c.name,
            eventIds: [segment.eventId],
            lossKeys: [segment.lossKey],
            actualHours: segment.actualHours * share,
            allowedHours:
              n.allowedHours === null
                ? null
                : n.allowedHours *
                  (weight ? segment.weight / weight : 1 / segments.length) *
                  share,
            basis:
              (projected ? "沿用超节点主图的守恒估算分配；" : "") +
              "按故障与可改善损失项匹配，再按正Shapley分担设计责任；叶层预算按FIT份额及类型内损失项均分作参照，公共开销单列；不是独立物理损失或改善收益",
          };
        });
      });
      return [...new Set(links.map((l) => l.mechanismId))].map((id) => {
        const matching = links.filter((l) => l.mechanismId === id);
        return {
          ...matching[0],
          eventIds: [...new Set(matching.flatMap((l) => l.eventIds))],
          lossKeys: [...new Set(matching.flatMap((l) => l.lossKeys))],
          actualHours: matching.reduce((s, l) => s + l.actualHours, 0),
          allowedHours:
            n.allowedHours === null
              ? null
              : matching.reduce((s, l) => s + (l.allowedHours ?? 0), 0),
        };
      });
    });
}

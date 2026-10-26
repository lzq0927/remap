import {
  auditArchitectureDiagnosis,
  architectureBudgets,
} from "./audit-architecture";
import {
  atlasNodeDomain,
  atlasMechanismDimensions,
  type AtlasDomain,
} from "../../contracts/src/audit-atlas";
import {
  hardwareScaleEvents,
  hardwareCount,
} from "../../contracts/src/audit-hardware";
import { supernodeCounts } from "../../contracts/src/audit-topology-config";
import {
  eventLossHours,
  mechanismEventIds,
  type AuditEventView,
} from "../../contracts/src/audit-objects";
import {
  auditMechanismCodes,
  auditMechanismNames,
  auditMechanismSummary,
} from "../../contracts/src/audit-mechanism-view";
import {
  auditExtensionCatalog,
  existingMechanismClasses,
} from "../../contracts/src/audit-extensions";
import {
  auditSummaryScales,
  auditReferenceOnly,
} from "../../contracts/src/audit-presets";
import {
  resolveAuditArchitecture,
  type AuditArchitecture,
} from "../../contracts/src/audit-architecture";

const scope: Record<string, string> = {
  hardDetect: "hard",
  slowDetect: "slow",
  sdcDetect: "sdc",
  step: "sdc",
  replay: "replay",
  process: "process",
  elastic: "elastic",
  fast: "all",
};
export type AtlasInput = {
  architecture?: AuditArchitecture;
  events: AuditEventView[];
  request?: any;
  result?: any;
};
/** Read model: no simulation, mutation, extra probabilities, or synthetic local Shapley. */
export function auditAtlas(input: AtlasInput, cards: number) {
  const result = input.result,
    request = result?.request ?? input.request ?? {};
  const d = result
    ? (result.architectureDiagnosis ?? auditArchitectureDiagnosis(result))
    : undefined;
  const a: AuditArchitecture =
    d?.architecture ??
    resolveAuditArchitecture(
      input.architecture ?? request.architecture,
      input.events,
    );
  const scale = d?.scales.find((s: any) => s.cards === cards);
  const row = result?.rows?.find(
    (r: any) => r.cards === cards && (!r.id || r.id === "combined"),
  );
  const baseline =
    result?.kind === "expert-audit-experiment"
      ? result.baseline?.rows?.find((r: any) => r.cards === cards)
      : result?.rows?.find((r: any) => r.cards === cards && r.id === "base");
  let error: string | undefined;
  let events: AuditEventView[] = scale?.scaleEvents ?? input.events;
  if (!scale) {
    try {
      events = hardwareScaleEvents(input.events, a, cards);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const sourceEvents = new Map(input.events.map((e) => [e.id, e]));
  const referenceOnly = auditReferenceOnly(request, cards);
  const target =
    cards === request.cards
      ? request.target
      : (request.targets?.[cards] ??
        (request.scales?.includes(cards) ? request.target : undefined));
  const hours = request.hours;
  const budget =
    !referenceOnly &&
    Number.isFinite(target) &&
    Number.isFinite(hours) &&
    a.budgetMethod !== "none"
      ? (1 - target) * hours
      : null;
  const budgets = architectureBudgets(a, cards, hours, budget);
  const domain = new Map(a.nodes.map((n) => [n.id, atlasNodeDomain(a, n)]));
  const allDescendants = (id: string): string[] => [
    id,
    ...a.nodes
      .filter((n) => n.parentId === id)
      .flatMap((n) => allDescendants(n.id)),
  ];
  const rawPolicy =
    result?.config?.policy ?? result?.baseline?.policy ?? request.policy ?? {};
  const effectivePolicy = Object.fromEntries(
    Object.entries(rawPolicy).map(([code, value]) => [
      code,
      {
        ...(value as object),
        ...(result?.configuration?.policy?.[code] ?? {}),
      },
    ]),
  );
  const currentExtensions = result?.configuration?.extensions ?? [];
  const selected = auditMechanismSummary(request, result?.selection);
  const mechanisms = [
    ...Object.keys(auditMechanismCodes).map((id) => {
      const code = auditMechanismCodes[id];
      const parameters = { ...effectivePolicy[code] };
      if (
        id === "fast" &&
        result?.configuration?.checkpointPeriods?.[cards] !== undefined
      )
        parameters.computeSeconds =
          result.configuration.checkpointPeriods[cards];
      return {
        id,
        name: auditMechanismNames[id],
        eventIds: mechanismEventIds(events, scope[id]),
        status: selected.deployed.includes(id)
          ? "deployed"
          : selected.ids.includes(id)
            ? "selected"
            : "candidate",
        parameters,
        source: "本次保存的机制策略参数；候选参数不代表已经启用",
        effect: existingMechanismClasses[id]?.effect ?? "需核对作用条件",
        ...atlasMechanismDimensions(id),
      };
    }),
    ...auditExtensionCatalog.map((m) => {
      const actual = currentExtensions.find((v: any) => v.id === m.id);
      return {
        id: m.id,
        name: m.name,
        eventIds: events
          .filter((e) =>
            (m.eventCandidates as readonly string[]).includes(e.id),
          )
          .map((e) => e.id),
        status: actual ? "selected" : "candidate",
        parameters: actual?.parameters ?? {},
        source: actual?.source ?? m.sources.map((s) => s.title).join("；"),
        effect: m.effect,
        ...atlasMechanismDimensions(m.id),
      };
    }),
  ].map((m) => {
    const owners = a.nodes.filter((n) =>
      n.eventIds.some((id) => m.eventIds.includes(id)),
    );
    return {
      ...m,
      nodeIds: owners.map((n) => n.id),
      domains: [...new Set(owners.map((n) => domain.get(n.id)!))],
      faultTypes: [
        ...new Set(
          events.filter((e) => m.eventIds.includes(e.id)).map((e) => e.type),
        ),
      ],
      applicability:
        "事件目录与求解器适用范围匹配；实际成功率、覆盖率及前置条件见参数，非全部覆盖保证",
    };
  });
  const nodes = a.nodes.map((n) => {
    const descendants = allDescendants(n.id);
    const nested = a.nodes.filter((v) => descendants.includes(v.id));
    const eventIds = nested.flatMap((v) => v.eventIds);
    const observed = scale?.nodes.find((v: any) => v.id === n.id);
    const overhead = nested.some((v) => v.kind === "overhead");
    const baselineHours =
      baseline?.perEvent && baseline?.ledger
        ? eventIds.reduce(
            (sum, id) => sum + eventLossHours(baseline.perEvent[id]),
            0,
          ) +
          (overhead
            ? (baseline.ledger.save ?? 0) +
              (baseline.ledger.mechanismOverhead ?? 0)
            : 0)
        : null;
    const actualHours =
      observed?.dataStatus === "unknown"
        ? null
        : (observed?.actualHours ?? null);
    const path: string[] = [];
    let current = n;
    while (current) {
      path.unshift(current.id);
      if (!current.parentId) break;
      current = a.nodes.find((v) => v.id === current.parentId)!;
    }
    const attached = mechanisms.filter(
      (m) =>
        m.eventIds.some((id) => eventIds.includes(id)) ||
        (overhead && ["fast", "C-ASYNC", "C-LOSSLESS"].includes(m.id)),
    );
    const mappedEvents = events.filter((e) => eventIds.includes(e.id));
    const missing = nested.some(
      (v) =>
        v.kind !== "overhead" &&
        !a.nodes.some((c) => c.parentId === v.id) &&
        !v.eventIds.length,
    );
    const quantity =
      n.kind === "overhead" ? null : hardwareCount(a, n.id, cards);
    const fit =
      error || !mappedEvents.length
        ? null
        : mappedEvents.reduce((s, e) => s + e.fit, 0);
    const allowedHours = observed?.allowedHours ?? budgets.get(n.id) ?? null;
    return {
      ...n,
      domain: domain.get(n.id)!,
      domainBasis: n.functionalDomain ? "显式配置" : "由对象与子层推导",
      path,
      depth: path.length - 1,
      leaf: !a.nodes.some((v) => v.parentId === n.id),
      quantity,
      npuEquivalentFit: fit,
      aggregateEventFit: fit === null ? null : fit * cards,
      perUnitEquivalentFit:
        fit !== null && quantity && n.rateModel
          ? (fit * cards) / quantity
          : null,
      coverageStatus: missing
        ? mappedEvents.length || overhead
          ? "partial"
          : "unknown"
        : "modeled",
      allowedHours,
      targetAvailability:
        !n.parentId && !referenceOnly && Number.isFinite(target)
          ? target
          : allowedHours === null || !hours
            ? null
            : 1 - allowedHours / hours,
      attributedAvailability:
        actualHours === null || !hours ? null : 1 - actualHours / hours,
      eventIds,
      descendants,
      mechanismIds: attached.map((m) => m.id),
      measured: observed ?? null,
      baselineHours,
      actualHours,
      improvementHours:
        actualHours !== null && baselineHours !== null
          ? baselineHours - actualHours
          : null,
    };
  });
  const ranked =
    result?.attribution?.find((r: any) => r.cards === cards)?.contributions ??
    [];
  const eventRows = events.map((e) => {
    const owner = a.nodes.find((n) => n.eventIds.includes(e.id));
    return {
      ...e,
      nodeId: owner?.id ?? "",
      domainId: owner ? domain.get(owner.id)! : ("other" as AtlasDomain),
      referenceFit: sourceEvents.get(e.id)?.fit ?? e.fit,
      actualLossHours: row?.perEvent
        ? eventLossHours(row.perEvent[e.id])
        : null,
      baselineLossHours: baseline?.perEvent
        ? eventLossHours(baseline.perEvent[e.id])
        : null,
      rate: error ? null : (cards * e.fit) / 1e9,
      mechanismIds: mechanisms
        .filter((m) => m.eventIds.includes(e.id))
        .map((m) => m.id),
    };
  });
  const domains = [
    ...new Set(nodes.filter((n) => n.leaf).map((n) => n.domain)),
  ].map((id) => {
    const leaves = nodes.filter((n) => n.leaf && n.domain === id);
    return {
      id,
      nodeIds: leaves.map((n) => n.id),
      incomplete: leaves.some((n) => n.measured?.dataStatus !== "modeled"),
      actualHours: row
        ? leaves.reduce((sum, n) => sum + (n.measured?.actualHours ?? 0), 0)
        : null,
      allowedHours: leaves.some((n) => n.measured?.allowedHours == null)
        ? null
        : leaves.reduce((sum, n) => sum + n.measured.allowedHours, 0),
    };
  });
  return {
    version: "architecture-atlas.v1",
    referenceOnly,
    topologySummary: a.topology ? supernodeCounts(a.topology, cards) : null,
    architecture: a,
    networkStudyResult: result?.networkStudyResult ?? null,
    cards,
    scales: auditSummaryScales(
      request,
      d?.scales.map((s: any) => s.cards) ?? request.scales ?? [cards],
    ),
    evaluated: !!row,
    error,
    nodes,
    events: eventRows,
    mechanisms,
    domains,
    ranking: ranked,
    propagation: a.propagations ?? [],
    comparisonBasis:
      result?.kind === "expert-audit-experiment"
        ? "相对冻结第一轮"
        : "组合相对本轮确认基线",
    attributionBasis:
      result?.kind === "expert-audit-experiment"
        ? "本规模全局改进因子Shapley；不等于单个部件贡献"
        : "本规模全局候选措施Shapley；不等于单个部件贡献",
    provenance: {
      modelVersion: result?.modelVersion ?? null,
      inputHash: result?.config?.inputHash ?? result?.sourceInputHash ?? null,
      sourceRunId: result?.sourceRunId ?? null,
      configurationHash: result?.configurationHash ?? null,
      hours: request.hours ?? null,
      trials: request.trials ?? null,
      seed: request.seed ?? null,
      confidenceMethod: request.confidenceMethod ?? null,
      statistics: row?.statistics ?? null,
    },
    effectiveModel: {
      ...(result?.config?.model ??
        result?.baseline?.model ??
        request.model ??
        {}),
      ...(result?.configuration?.model ?? {}),
    },
    notes: [
      "纯架构只展示组成与连接；功能域和物理层级是同一对象的不同维度。连接/传播记录不自动产生概率或收益。",
      "图中损失来自保存的逐事件账；父层汇总子层，不将父子层重复相加。功能域按叶层唯一归属汇总，公共开销单列。",
      "前后差值是对象级损失账差值，未提供对象级置信区间；仅总可用度区间来自原采样。未观察到损失不代表无风险。",
      "机制映射表示适用范围；未选候选不计入本轮收益。Shapley只展示原始全局归因，不按故障率拆成局部贡献。",
      "筛选和分层浏览不改变评估；包含关系与连接分别展示，不是实物数字孪生。组网辅助验证读取正式运行快照，不替代主流程指标。",
    ],
  };
}
export type AuditAtlas = ReturnType<typeof auditAtlas>;
export type AtlasNode = AuditAtlas["nodes"][number];

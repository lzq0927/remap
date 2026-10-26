import { topologyDecision } from "./audit-topology-decision";
import {
  auditArchitectureDiagnosis,
  architectureResponsibilities,
} from "./audit-architecture";
import {
  auditMechanismCodes,
  auditMechanismSummary,
} from "../../contracts/src/audit-mechanism-view";
import {
  designAllocation,
  compareDesignAllocations,
} from "./audit-design-allocation";
import {
  boundPlanningConfiguration,
  validatePlanningSource,
} from "./audit-planning-bounds";
import { completeDecisionStudy } from "./audit-decision-study";
import { planningWork } from "./audit-planning-work";
import { shapleyImportance, validateOptimization } from "./audit-optimization";
import {
  experimentFactors,
  experimentSampler,
  experimentSeeds,
  mechanismNames,
  type AuditSource,
} from "./audit-experiments";
import {
  auditExtensionCatalog,
  extensionScenario,
} from "../../contracts/src/audit-extensions";
import { auditReferenceOnly } from "../../contracts/src/audit-presets";
import type { AuditOptimizationRequest } from "../../contracts/src/audit-optimization";

type Group = {
  id: string;
  name: string;
  parentIds: string[];
  configuration: AuditOptimizationRequest;
  source: string;
  importance: number;
};
/** AGREE allocates design responsibility; total availability is the forward constraint.
 * The allocation is not asserted to be a unique physical inverse or independent mechanism gain.
 */
function guidedExperimentPlan(
  input: { source: AuditSource; options?: AuditOptimizationRequest },
  onProgress?: (fraction: number) => void,
) {
  const { source } = input,
    options = input.options ?? { enabled: true };
  const request = source.input,
    primary = options.planningCards ?? request.cards;
  const attribution = source.result.attribution;
  if (
    !attribution?.length ||
    !attribution.some((row: any) => row.contributions?.length)
  )
    throw new Error(
      "现状缺少可分配的候选措施贡献；请先选择候选措施并计算Shapley，或直接新建参数方案",
    );
  const architectureDiagnosis: ReturnType<typeof auditArchitectureDiagnosis> =
    source.result.architectureDiagnosis ??
    auditArchitectureDiagnosis({ ...source.result, request });
  const allocations = source.result.rows
    .filter(
      (r: any) => r.id === "combined" && !auditReferenceOnly(request, r.cards),
    )
    .map((row: any) => {
      const contributions =
        attribution.find((a: any) => a.cards === row.cards)?.contributions ??
        [];
      const maximum = Math.max(
        1e-12,
        ...contributions.map((c: any) => Math.max(0, c.statistics.mean)),
      );
      const target =
        row.cards === request.cards
          ? request.target
          : (request.targets?.[String(row.cards)] ?? request.target);
      const currentLoss = (1 - row.statistics.mean) * request.hours;
      const layerLinks = architectureResponsibilities(
        { ...source.result, request },
        architectureDiagnosis,
        row.cards,
        contributions,
      );
      const items = contributions.map((c: any) => ({
        id: c.id,
        name: c.name,
        importance:
          options.importance?.[String(row.cards)]?.[c.id] ??
          shapleyImportance(c.statistics.mean, maximum),
        suggestedImportance: shapleyImportance(c.statistics.mean, maximum),
        contribution: c.statistics.mean,
        complexity: options.planning?.complexity?.[c.id] ?? 1,
        actualHours: layerLinks
          .filter((link) => link.mechanismId === c.id)
          .reduce((sum, link) => sum + link.actualHours, 0),
      }));
      const unaddressed = layerLinks
        .filter((link) => link.mechanismId === "unaddressed")
        .reduce((sum, link) => sum + link.actualHours, 0);
      if (unaddressed > 0 || options.planning?.budgetBounds?.unaddressed)
        items.push({
          id: "unaddressed",
          name: "未覆盖设计责任",
          importance: 0.2,
          suggestedImportance: 0.2,
          contribution: 0,
          complexity: options.planning?.complexity?.unaddressed ?? 1,
          actualHours: unaddressed,
        });
      const plan = designAllocation(
        (1 - target) * request.hours,
        request.hours,
        items,
        options.planning,
      );
      return {
        cards: row.cards,
        target,
        current: row.statistics,
        gapHours: Math.max(0, (target - row.statistics.mean) * request.hours),
        ...plan,
        comparisons: compareDesignAllocations(
          (1 - target) * request.hours,
          request.hours,
          items,
          options.planning,
        ),
        weightBasis:
          "正Shapley映射到0.2–1的工程优先级；不是经典AGREE条件失效概率。复杂度由本次规划设置，缺省1。",
        layerLinks,
        responsibilityResidualHours:
          items.reduce((sum: number, item: any) => sum + item.actualHours, 0) -
          currentLoss,
        basis:
          "先沿架构定位实际损失与分层目标，再在措施适用层内按第一轮正Shapley分担互斥设计责任，以AGREE分配允许责任损失；未覆盖责任明确保留。重要度不是追加改善收益，仍按条件响应与总目标正向求解，不要求所有子预算硬达标",
      };
    });
  const mainPlan = allocations.find((p: any) => p.cards === primary)!;
  const inherited = (ids: string[]) => {
    const matching = mainPlan.items.filter((i: any) => ids.includes(i.id));
    return matching.length
      ? matching.reduce((s: number, i: any) => s + i.importance, 0) /
          matching.length
      : 0.2;
  };
  const targetValue = (id: string, fallback: number) =>
    options.parameterTargets?.[id] ?? fallback;
  const config = (patch: any): AuditOptimizationRequest => ({
    enabled: true,
    autoTune: false,
    extensions: [],
    ...patch,
  });
  const groups: Group[] = [];
  const add = (
    id: string,
    name: string,
    parents: string[],
    patch: any,
    reference: string,
  ) => {
    const activeCodes = auditMechanismSummary(
      request,
      source.result.selection,
    ).ids.map((id) => auditMechanismCodes[id]);
    if (
      patch.policy &&
      !patch.model &&
      !Object.keys(patch.policy).some((code) => activeCodes.includes(code))
    )
      return;
    if (patch.policy) {
      patch = {
        ...patch,
        policy: Object.fromEntries(
          Object.entries(patch.policy).filter(([code]) =>
            activeCodes.includes(code),
          ),
        ),
      };
    }
    groups.push({
      id,
      name,
      parentIds: parents,
      configuration: config(patch),
      source: reference,
      importance: inherited(parents),
    });
  };
  add(
    "sdc",
    mechanismNames.sdcDetect,
    ["sdcDetect", "step"],
    {
      policy: {
        "D-SDC": {
          coverage: targetValue("sdcCoverage", 0.995),
          detectSeconds: targetValue("detectSeconds", 0.5),
        },
      },
    },
    "当前模型的检测能力规划参考；可用本次参数约束覆盖，并按实际现状与总目标反解，不预先改写现状能力",
  );
  add(
    "fast",
    mechanismNames.fast,
    ["fast"],
    { policy: { "C-FAST": { saveSeconds: targetValue("saveSeconds", 0.5) } } },
    "当前模型的保存能力规划参考；保存开销与回滚损失共同参与正向权衡，具体要求可配置",
  );
  add(
    "global",
    mechanismNames.recovery,
    ["replay", "process", "elastic"],
    {
      model: {
        recoveryAttemptSeconds: targetValue("recoverySeconds", 30),
        recoverySuccess: targetValue("recoverySuccess", 0.999),
      },
    },
    "完整恢复30秒与99.9%成功是工程参考，需验证；专家初始化/读取/通信优化提供实现方向，子阶段不冒充总恢复",
  );
  add(
    "detect",
    mechanismNames.detection,
    ["hardDetect", "slowDetect", "sdcDetect", "elastic", "process"],
    {
      policy: {
        "D-HARD": {
          coverage: targetValue("hardCoverage", 0.999),
          detectSeconds: targetValue("detectSeconds", 0.5),
        },
        "D-SLOW": {
          coverage: targetValue("slowCoverage", 0.999),
          detectSeconds: targetValue("detectSeconds", 0.5),
        },
      },
      model: {
        detectProbability: targetValue("hardCoverage", 0.999),
        detectSeconds: targetValue("detectSeconds", 0.5),
        slowDetectProbability: targetValue("slowCoverage", 0.999),
        slowDetectHours: targetValue("detectSeconds", 0.5) / 3600,
        validationOverhead: targetValue("validationOverhead", 0.0001),
      },
    },
    "基础检测0.5秒与99.9%覆盖为工程参考，计入0.01%正常态检测开销；需故障注入和吞吐验证",
  );
  add(
    "replay",
    mechanismNames.replay,
    ["replay"],
    {
      policy: {
        "R-REPLAY": {
          success: targetValue("localSuccess", 0.99),
          successSeconds: targetValue("replaySeconds", 1),
          failureSeconds: targetValue("failureSeconds", 10),
        },
      },
    },
    "重执行完整路径工程参考，保留失败升级成本",
  );
  add(
    "process",
    mechanismNames.process,
    ["process"],
    {
      policy: {
        "R-PROCESS": {
          success: targetValue("localSuccess", 0.99),
          successSeconds: targetValue("processSeconds", 10),
          failureSeconds: targetValue("failureSeconds", 10),
        },
      },
    },
    "进程恢复完整路径工程参考；专家预热/运行时快照只改善其适用启动阶段",
  );
  add(
    "elastic",
    mechanismNames.elastic,
    ["elastic"],
    {
      policy: {
        "R-ELASTIC": {
          success: targetValue("elasticSuccess", 0.999),
          recoverSeconds: targetValue("elasticSeconds", 30),
          failureSeconds: targetValue("failureSeconds", 10),
          syncSeconds: targetValue("syncSeconds", 0.5),
        },
      },
    },
    "弹性完整恢复工程参考；专家HCCL 60→15秒仅是通信子阶段",
  );
  const sample = experimentSampler(source),
    trials = options.screeningTrials ?? 128;
  const expectedPerTrajectory =
    (primary *
      request.hours *
      source.result.events.reduce(
        (sum: number, event: any) => sum + event.fit,
        0,
      )) /
    1e9;
  const work = planningWork(source, [primary], trials);
  if (
    trials * 360 > 1000000 ||
    (trials * 360 + Math.min(1024, request.trials) * 32) *
      expectedPerTrajectory >
      450000000 ||
    work.trajectories > 1000000 ||
    work.events > 450000000
  )
    throw new Error("AGREE规划工作量超过上限，请减少规划采样或评估范围");
  let seeds = experimentSeeds(source, "planning", trials);
  const candidates: any[] = [];
  const evaluate = (name: string, configuration: AuditOptimizationRequest) => {
    configuration = boundPlanningConfiguration(
      source,
      configuration,
      options.planning,
    );
    const factors = experimentFactors(source, configuration);
    const row = sample(primary, factors, seeds);
    const candidate = {
      name,
      configuration: structuredClone(configuration),
      statistics: row.statistics,
      ledger: row.ledger,
    };
    candidates.push(candidate);
    onProgress?.(Math.min(0.94, 0.02 + candidates.length / 100));
    return candidate;
  };
  const merge = (
    base: AuditOptimizationRequest,
    change: AuditOptimizationRequest,
  ) => ({
    ...base,
    model: { ...base.model, ...change.model },
    policy: Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(base.policy ?? {}),
          ...Object.keys(change.policy ?? {}),
        ]),
      ].map((code) => [
        code,
        { ...base.policy?.[code], ...change.policy?.[code] },
      ]),
    ),
    extensions: [...(base.extensions ?? []), ...(change.extensions ?? [])],
  });
  // Small explicit target margin, not per-path hard constraints or a cross-scale strict envelope.
  const primaryTarget =
    primary === request.cards
      ? request.target
      : (request.targets?.[String(primary)] ?? request.target);
  const planningMargin = Math.min(0.0003, (1 - primaryTarget) * 0.02);
  const goal = Math.min(1, primaryTarget + planningMargin);
  let chosen = evaluate("冻结第一轮现状", config({}));
  const decisions: any[] = [],
    adopted: Group[] = [];
  const periods = [30, 60, 90, 120, 180, 300, 600, 1200];
  for (const group of groups.sort(
    (a, b) => b.importance - a.importance || a.id.localeCompare(b.id),
  )) {
    if (chosen.statistics.mean >= goal) break;
    let trial = evaluate(
      group.name + "参考",
      merge(chosen.configuration, group.configuration),
    );
    if (group.id === "fast") {
      for (const period of periods) {
        const c = evaluate(
          "检查点联合权衡 / " + period + "秒",
          merge(
            chosen.configuration,
            config({
              policy: {
                "C-FAST": {
                  ...group.configuration.policy!["C-FAST"],
                  computeSeconds: period,
                },
              },
            }),
          ),
        );
        if (c.statistics.mean > trial.statistics.mean) trial = c;
      }
      group.configuration.policy!["C-FAST"] =
        trial.configuration.policy!["C-FAST"];
    }
    const responsibility = mainPlan.items.filter((item: any) =>
      group.parentIds.includes(item.id),
    );
    const allocatedImprovementHours = responsibility.length
      ? responsibility.reduce(
          (sum: number, item: any) => sum + Math.max(0, item.excessHours),
          0,
        ) / responsibility.length
      : 0;
    const requiredGain = Math.min(
      Math.max(0, goal - chosen.statistics.mean),
      allocatedImprovementHours / request.hours,
    );
    // Allocate first, then invert the measured conditional response up to that
    // responsibility. Overlapping responsibility is never added as physical loss.
    if (
      requiredGain > 1e-8 &&
      trial.statistics.mean - chosen.statistics.mean > requiredGain
    ) {
      const endpoint = trial.configuration;
      const start = chosen.configuration;
      let low = 0,
        high = 1;
      for (let iteration = 0; iteration < 6; iteration++) {
        const fraction = (low + high) / 2;
        const patch: AuditOptimizationRequest = {
          enabled: true,
          model: {},
          policy: {},
        };
        for (const [key, value] of Object.entries(endpoint.model ?? {})) {
          const before = start.model?.[key] ?? source.result.config.model[key];
          patch.model![key] = before + (value - before) * fraction;
        }
        for (const [code, values] of Object.entries(endpoint.policy ?? {})) {
          patch.policy![code] = {};
          for (const [key, value] of Object.entries(values)) {
            const before =
              start.policy?.[code]?.[key] ??
              source.result.config.policy[code][key];
            patch.policy![code][key] = before + (value - before) * fraction;
          }
        }
        const response = evaluate(
          group.name + " / AGREE责任反解",
          merge(start, patch),
        );
        if (response.statistics.mean - chosen.statistics.mean >= requiredGain) {
          high = fraction;
          trial = response;
        } else low = fraction;
      }
    }
    const accepted = trial.statistics.mean > chosen.statistics.mean + 1e-7;
    decisions.push({
      id: group.id,
      name: group.name,
      importance: group.importance,
      parentIds: group.parentIds,
      selected: accepted,
      reason: accepted
        ? "根据AGREE责任缺口和第一轮重要度采用，正向试算减少总损失"
        : "本次组合下未减少总损失",
      source: group.source,
      allocatedImprovementHours,
      achievedConditionalGainHours:
        (trial.statistics.mean - chosen.statistics.mean) * request.hours,
    });
    if (accepted) {
      chosen = trial;
      adopted.push(group);
    }
  }
  // Expert proposals keep their reference point and explicit applicability/cost assumptions.
  if (chosen.statistics.mean < goal && (options.exploreExtensions ?? true)) {
    for (const m of auditExtensionCatalog) {
      const extension = extensionScenario(m.id);
      if (m.id === "I-CONTAIN") {
        decisions.push({
          id: m.id,
          name: m.name,
          selected: false,
          reason: "已有弹性路径的隔离前提，不重复计收益",
          source: m.evidence,
        });
        continue;
      }
      if ((chosen.configuration.extensions ?? []).some((e) => e.id === m.id))
        continue;
      const trial = evaluate(
        "专家 / " + m.name,
        merge(chosen.configuration, config({ extensions: [extension] })),
      );
      const accepted =
        trial.statistics.mean > chosen.statistics.mean + 1e-7 &&
        extension.parameters.overhead < 1 - primaryTarget;
      decisions.push({
        id: m.id,
        name: m.name,
        selected: accepted,
        importance: inherited(
          m.id.startsWith("D-") || m.id === "H-SDC-SCREEN"
            ? ["sdcDetect", "step"]
            : ["elastic", "process", "replay"],
        ),
        reason: accepted
          ? "专家参考方案补足总目标缺口，成本计入总账"
          : "收益未补足缺口或正常态成本过高",
        source: extension.source,
      });
      if (accepted) {
        chosen = trial;
        adopted.push({
          id: m.id,
          name: m.name,
          parentIds: [],
          importance: inherited(["elastic", "process"]),
          configuration: config({ extensions: [extension] }),
          source: extension.source,
        });
      }
      if (chosen.statistics.mean >= goal) break;
    }
  }
  // If reference values are insufficient, extend only the deficient controls,
  // then relax them back towards the FIRST ROUND until the total target binds.
  if (chosen.statistics.mean < goal) {
    for (const [id, patch, reference] of [
      [
        "sdc-stricter",
        { policy: { "D-SDC": { coverage: 0.99995 } } },
        "检测参考能力仍不足时，进一步探索检出要求；以总目标正向求解，不用120小时暴露上界强迫所有路径独立达标",
      ],
      [
        "save-stricter",
        { policy: { "C-FAST": { saveSeconds: 0.1 } } },
        "0.5秒参考不足时进一步探索0.1秒；必须实测阻塞、同步和持久化成本",
      ],
      [
        "global-stricter",
        { model: { recoveryAttemptSeconds: 10, recoverySuccess: 0.9999 } },
        "30秒参考不足时探索10秒完整恢复与失败概率，非专家已有能力",
      ],
    ] as const) {
      if (
        "policy" in patch &&
        !Object.keys(patch.policy).some((code) =>
          auditMechanismSummary(request, source.result.selection).ids.some(
            (id) => auditMechanismCodes[id] === code,
          ),
        )
      )
        continue;
      const trial = evaluate(id, merge(chosen.configuration, config(patch)));
      if (trial.statistics.mean > chosen.statistics.mean) {
        chosen = trial;
        adopted.push({
          id,
          name: id,
          parentIds: ["sdcDetect", "fast", "elastic"],
          configuration: config(patch),
          source: reference,
          importance: inherited(
            id.startsWith("sdc")
              ? ["sdcDetect"]
              : id.startsWith("save")
                ? ["fast"]
                : ["elastic", "process", "replay"],
          ),
        });
      }
      if (chosen.statistics.mean >= goal) break;
    }
  }
  // A reference may look ineffective while contamination dominates a small
  // screening sample. Recheck missing controls after the SDC/restore changes.
  for (let pass = 0; pass < 2 && chosen.statistics.mean < goal; pass++) {
    for (const group of groups) {
      if (chosen.statistics.mean >= goal) break;
      const trial = evaluate(
        group.name + " / 剩余总缺口复核",
        merge(chosen.configuration, group.configuration),
      );
      if (trial.statistics.mean > chosen.statistics.mean + 1e-7) {
        chosen = trial;
        if (!adopted.some((g) => g.id === group.id)) adopted.push(group);
        decisions.push({
          id: group.id,
          name: group.name,
          selected: true,
          importance: group.importance,
          source: group.source,
          reason:
            "其他路径改善后重新复核，补足总目标剩余缺口；原AGREE责任预算保持冻结",
        });
      }
    }
  }
  // Calibrate the final response on a larger planning batch. This is still
  // planning, with seeds separate from the user-triggered independent assessment.
  seeds = experimentSeeds(
    source,
    "planning-refinement",
    Math.min(1024, request.trials),
  );
  chosen = evaluate("较大规划样本校准", chosen.configuration);
  for (const group of groups) {
    if (chosen.statistics.mean >= goal) break;
    const patch = structuredClone(group.configuration);
    for (const [key, value] of Object.entries(patch.model ?? {})) {
      const present =
        chosen.configuration.model?.[key] ?? source.result.config.model[key];
      patch.model![key] = /Probability|Success/.test(key)
        ? Math.max(present, value)
        : key === "validationOverhead"
          ? Math.max(present, value)
          : Math.min(present, value);
    }
    for (const [code, values] of Object.entries(patch.policy ?? {}))
      for (const [key, value] of Object.entries(values)) {
        const present =
          chosen.configuration.policy?.[code]?.[key] ??
          source.result.config.policy[code][key];
        values[key] = /success$|coverage$/.test(key)
          ? Math.max(present, value)
          : Math.min(present, value);
      }
    const trial = evaluate(
      group.name + " / 规划校准补足",
      merge(chosen.configuration, patch),
    );
    if (trial.statistics.mean > chosen.statistics.mean) chosen = trial;
  }
  if (chosen.statistics.mean >= goal) {
    for (const extension of [...(chosen.configuration.extensions ?? [])]) {
      const reduced = {
        ...chosen.configuration,
        extensions: chosen.configuration.extensions!.filter(
          (e) => e.id !== extension.id,
        ),
      };
      const trial = evaluate("必要性复核 / " + extension.id, reduced);
      if (trial.statistics.mean >= goal) {
        chosen = trial;
        const decision = decisions.find((d) => d.id === extension.id);
        if (decision) {
          decision.selected = false;
          decision.reason = "其余改进后移除此项仍达到总目标，减少工程措施数量";
        }
      }
    }
  }
  // One-dimensional response inversion relaxes the WHOLE chosen implementation.
  // AGREE chooses priority/starting design; the inverse is the total model constraint.
  if (chosen.statistics.mean >= goal) {
    const original = structuredClone(chosen.configuration);
    const scaled = (fraction: number) => {
      const c = structuredClone(original);
      for (const [key, value] of Object.entries(c.model ?? {}))
        c.model![key] =
          (source.result.config.model[key] ?? 0) +
          (value - (source.result.config.model[key] ?? 0)) * fraction;
      for (const [code, patch] of Object.entries(c.policy ?? {}))
        for (const [key, value] of Object.entries(patch))
          patch[key] =
            source.result.config.policy[code][key] +
            (value - source.result.config.policy[code][key]) * fraction;
      // Expert extensions retain their explicit point values; only explicit numeric controls are interpolated.
      return c;
    };
    const lowCandidate = evaluate("专家扩展＋现状参数", scaled(0));
    let lo = 0,
      hi = 1;
    if (lowCandidate.statistics.mean >= goal) chosen = lowCandidate;
    else
      for (let i = 0; i < 10; i++) {
        const q = (lo + hi) / 2,
          trial = evaluate("总目标反解 / 改进幅度" + q.toFixed(4), scaled(q));
        if (trial.statistics.mean >= goal) {
          hi = q;
          chosen = trial;
        } else lo = q;
      }
  }
  onProgress?.(1);
  return {
    kind: "expert-audit-plan",
    selection: source.result.selection,
    name: (mainPlan.methodName ?? "AGREE") + "第二轮改进分配",
    modelVersion: "agree-total-target.v4",
    sourceRunId: source.id,
    sourceInputHash: source.inputHash,
    request,
    allocations,
    architectureDiagnosis,
    topologyDecision:
      source.result.topologyDecision ??
      topologyDecision({ ...source.result, architectureDiagnosis }),
    networkStudyResult: structuredClone(
      source.result.networkStudyResult ?? null,
    ),
    decisions,
    configuration: chosen.configuration,
    factors: experimentFactors(source, chosen.configuration).map((factor) => ({
      ...factor,
      source:
        factor.source +
        "；AGREE设计责任先分配，再按条件响应与总目标收回改进幅度；参考：" +
        adopted
          .filter(
            (g) =>
              Object.keys(g.configuration.model ?? {}).some(
                (key) =>
                  factor.kind === "model" && factor.value[key] !== undefined,
              ) ||
              (factor.kind === "policy" &&
                g.configuration.policy?.[factor.code!] !== undefined) ||
              factor.id === g.id,
          )
          .map((g) => g.source)
          .join("；"),
    })),
    prediction: {
      cards: primary,
      target: primaryTarget,
      mean: chosen.statistics.mean,
      planningMargin,
      planningTrials: seeds.length,
      supported: chosen.statistics.mean >= primaryTarget,
      note: "规划试算，不是第二轮正式评估；请核对参数后单独点击评估。正式结果可能偏离目标，按新采样区间判断。",
    },
    candidates: candidates.map(({ configuration: _configuration, ...c }) => c),
    scenarioEvaluated: false,
    assumptions: [
      "现状的实际措施集合、能力参数与证据保持冻结；新增要求仅存入本次改进方案。",
      "AGREE责任子预算用于改进优先级，总可用度是正向求解约束；不要求每项独立达标。",
      "以主规模目标附近为停止点；其他规模分别报告，不合并最严共同要求。",
      `预留${(planningMargin * 100).toFixed(5)}个百分点规划余量（允许损失的2%，上限0.03pp）；不是置信水平或全局最优。`,
      "参考方案不足可适度扩展并反向收回改进幅度；专家单点、工程假设与产品能力须分别验证。",
    ],
  };
}

export function auditExperimentPlan(
  input: { source: AuditSource; options?: AuditOptimizationRequest },
  onProgress?: (fraction: number) => void,
) {
  validateOptimization({
    ...input.source.input,
    optimization: input.options ?? { enabled: true },
  });
  validatePlanningSource(input.source, input.options?.planning);
  const guided = guidedExperimentPlan(input, (f) => onProgress?.(f * 0.6));
  return completeDecisionStudy(
    input.source,
    input.options ?? { enabled: true },
    guided,
    (f) => onProgress?.(0.6 + f * 0.4),
  );
}

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import sourceInputs from "../../../references/expert-review-2026-10-09/inputs.json";
import sourceConfig from "../../../references/expert-review-2026-10-09/config.json";
import sourcePolicy from "../../../references/expert-review-2026-10-09/mechanism-policy.json";
import sourceMechanisms from "../../../references/expert-review-2026-10-09/mechanisms.json";
import { summarize } from "../../solvers/src/statistics";
import {
  auditDefaultTargets,
  auditScalePresets,
} from "../../contracts/src/audit-presets";
import { auditSensitivityPlan } from "./audit-sensitivity";
import { auditReviewChecks } from "./audit-checks";
import { shapleyValues } from "./index";
import {
  auditTarget,
  validateAuditDesign,
  auditDesignReview,
  auditBudgetDefaults,
} from "./audit-design";

const createEngine = createRequire(import.meta.url)(
  "../../solvers/src/vendor/review-engine.cjs",
);
export const AUDIT_VERSION = "review-retained-progress.v3";
export const AUDIT_METRIC = "training.retained-clean-progress";
const commit = "683afe829313bfdcb249bc593e48df5b29813666";
const rateBasis = "npu-equivalent-hour";
const scenarios = [
  ["hardDetect", "中断检测优化", "D-HARD"],
  ["slowDetect", "亚健康检测优化", "D-SLOW"],
  ["sdcDetect", "静默即时检测", "D-SDC"],
  ["step", "干净 step 恢复", "R-SDC"],
  ["replay", "通信/算子重执行", "R-REPLAY"],
  ["process", "进程重调度", "R-PROCESS"],
  ["elastic", "DP 域弹性恢复", "R-ELASTIC"],
  ["fast", "更频繁检查点", "C-FAST"],
] as const;
export type EventOverride = {
  id: string;
  fit: number;
  source: string;
  evidence: "internal-measured" | "external-prior" | "scenario";
  rateBasis: string;
  note?: string;
};
export interface AuditRequest {
  cards: number;
  hours: number;
  trials: number;
  seed: number;
  target: number;
  targets?: Record<string, number>;
  lossBudgetWeights?: Record<string, number>;
  verifyRecommendation?: boolean;
  verificationTrials?: number;
  scales?: number[];
  mechanisms?: string[];
  attribution?: boolean;
  attributionTrials?: number;
  model?: Record<string, number>;
  policy?: Record<string, Record<string, number>>;
  eventOverrides?: EventOverride[];
  candidateFitOverrides?: EventOverride[];
  recoveryOrder?: string[];
  costs?: Record<string, number>;
  sensitivity?: boolean;
  sensitivityMode?: "expert-reference" | "selected-combination";
}
const modelKeys = [
  "checkpointComputeSeconds",
  "checkpointSaveSeconds",
  "recoveryAttemptSeconds",
  "recoverySuccess",
  "manualAdditionalSeconds",
  "detectProbability",
  "detectSeconds",
  "timeoutSeconds",
  "slowDetectProbability",
  "slowDetectHours",
  "slowLifetimeHours",
  "slowLoss",
  "sdcDelayHours",
];
function numberIn(
  value: unknown,
  min: number,
  max: number,
  label: string,
  integer = false,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(
      `${label} must be ${integer ? "integer " : ""}${min}..${max}`,
    );
}
export function getAuditDefaults() {
  return {
    cards: 10000,
    hours: 720,
    trials: 128,
    seed: sourceConfig.seed,
    target: 0.99,
    targets: { ...auditDefaultTargets },
    lossBudgetWeights: { ...auditBudgetDefaults },
    verifyRecommendation: true,
    verificationTrials: 64,
    scales: auditScalePresets.map((p) => p.cards),
    mechanisms: ["sdcDetect", "step", "replay", "process", "elastic", "fast"],
    attribution: true,
    attributionTrials: 64,
    sensitivity: true,
    sensitivityMode: "expert-reference" as const,
    eventOverrides: [],
    candidateFitOverrides: [],
    recoveryOrder: ["replay", "elastic", "process"],
    model: Object.fromEntries(
      modelKeys.map((k) => [k, (sourceConfig as any)[k]]),
    ),
    policy: structuredClone(sourcePolicy),
    metricId: AUDIT_METRIC,
    modelVersion: AUDIT_VERSION,
  };
}
export function getAuditEvents() {
  return sourceInputs.current.events.map((event) => {
    const old = sourceInputs.legacy.events.find((e) => e.id === event.id)!;
    return {
      id: event.id,
      domain: event.domain,
      description: event.description,
      type: old.type,
      fit: event.fit,
      scope: old.scope,
      persistence: old.persistence,
      replay: old.replay,
      process: old.process,
      elastic: old.elastic,
      evidence: "external-prior",
      source: `expert-review@${commit}`,
      rateBasis,
      note:
        event.type === "中断"
          ? "中断总量及 CORE-hard 等类内占比待内网数据校准"
          : "暂用外网先验；缺少内网观测不代表零风险",
    };
  });
}
export const auditMechanisms = scenarios.map(([id, name, code]) => ({
  ...sourceMechanisms.mechanisms.find((m) => m.id === code),
  id,
  name,
  code,
}));
function applyOverrides(
  events: ReturnType<typeof getAuditEvents>,
  overrides: EventOverride[] = [],
) {
  if (
    !Array.isArray(overrides) ||
    overrides.length > events.length ||
    new Set(overrides.map((e) => e.id)).size !== overrides.length
  )
    throw new Error("Event overrides require unique known event IDs");
  const out = structuredClone(events);
  for (const patch of overrides) {
    const event = out.find((e) => e.id === patch.id);
    if (!event) throw new Error("Unknown event: " + patch.id);
    if (
      Object.keys(patch).some(
        (k) =>
          !["id", "fit", "source", "evidence", "rateBasis", "note"].includes(k),
      )
    )
      throw new Error("Unsupported event override field");
    numberIn(patch.fit, 0, 1e7, "event FIT");
    if (patch.rateBasis !== rateBasis)
      throw new Error(
        "FIT requires npu-equivalent-hour exposure; device physical FIT cannot be mixed",
      );
    if (
      !patch.source?.trim() ||
      !["internal-measured", "external-prior", "scenario"].includes(
        patch.evidence,
      )
    )
      throw new Error("Event source and evidence level are required");
    Object.assign(event, patch);
  }
  return out;
}
export function resolveAudit(request: AuditRequest) {
  numberIn(request.cards, 1, 1000000, "cards", true);
  numberIn(request.hours, 0.01, 8760, "hours");
  numberIn(request.trials, 2, 8192, "trials", true);
  numberIn(request.seed, 0, 4294967295, "seed", true);
  numberIn(request.target, 0, 1, "target");
  const scales = request.scales ?? [request.cards];
  if (
    !Array.isArray(scales) ||
    !scales.length ||
    scales.length > 5 ||
    new Set(scales).size !== scales.length ||
    !scales.includes(request.cards)
  )
    throw new Error(
      "scales must contain the selected cards and 1..5 unique sizes",
    );
  scales.forEach((n) => numberIn(n, 1, 1000000, "scale", true));
  validateAuditDesign(request, scales);
  if (
    request.verifyRecommendation !== undefined &&
    typeof request.verifyRecommendation !== "boolean"
  )
    throw new Error("verifyRecommendation must be boolean");
  numberIn(
    request.verificationTrials ?? 64,
    2,
    2048,
    "verificationTrials",
    true,
  );
  const model: Record<string, any> = {
    ...sourceConfig,
    horizonHours: request.hours,
  };
  if (
    request.model &&
    (typeof request.model !== "object" || Array.isArray(request.model))
  )
    throw new Error("model must be an object");
  for (const [key, value] of Object.entries(request.model ?? {})) {
    if (!modelKeys.includes(key))
      throw new Error("Unsupported audit model field: " + key);
    const probability = /Probability|Success|Loss/.test(key);
    numberIn(
      value,
      key === "checkpointComputeSeconds" ||
        key === "slowLifetimeHours" ||
        key === "sdcDelayHours"
        ? 0.000001
        : 0,
      probability ? 1 : 31536000,
      key,
    );
    model[key] = value;
  }
  const policy: Record<string, any> = structuredClone(sourcePolicy);
  for (const [id, patch] of Object.entries(request.policy ?? {})) {
    if (
      !policy[id] ||
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch)
    )
      throw new Error("Unknown policy mechanism " + id);
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in policy[id]))
        throw new Error("Unknown policy parameter " + key);
      numberIn(
        value,
        ["domains", "computeSeconds"].includes(key) ? 1 : 0,
        ["coverage", "success"].includes(key)
          ? 1
          : key === "domains"
            ? 100000
            : 31536000,
        id + "." + key,
        key === "domains",
      );
      policy[id][key] = value;
    }
  }
  const mechanisms = request.mechanisms ?? getAuditDefaults().mechanisms;
  if (
    !Array.isArray(mechanisms) ||
    new Set(mechanisms).size !== mechanisms.length ||
    mechanisms.some((id) => !scenarios.some((s) => s[0] === id))
  )
    throw new Error("Unknown or repeated mechanism");
  const recoveryOrder = request.recoveryOrder ?? [
    "replay",
    "elastic",
    "process",
  ];
  if (
    !Array.isArray(recoveryOrder) ||
    recoveryOrder.length !== 3 ||
    new Set(recoveryOrder).size !== 3 ||
    recoveryOrder.some((n) => !["replay", "elastic", "process"].includes(n))
  )
    throw new Error(
      "recoveryOrder must be a permutation of replay, elastic, process",
    );
  const attributionTrials = request.attributionTrials ?? 64;
  numberIn(attributionTrials, 2, 2048, "attributionTrials", true);
  if (
    request.attribution !== undefined &&
    typeof request.attribution !== "boolean"
  )
    throw new Error("attribution must be boolean");
  if (
    request.sensitivity !== undefined &&
    typeof request.sensitivity !== "boolean"
  )
    throw new Error("sensitivity must be boolean");
  if (
    request.sensitivityMode !== undefined &&
    !["expert-reference", "selected-combination"].includes(
      request.sensitivityMode,
    )
  )
    throw new Error("Unknown sensitivity comparison mode");
  for (const [id, cost] of Object.entries(request.costs ?? {})) {
    if (!mechanisms.includes(id))
      throw new Error("Costs must refer to selected mechanisms");
    numberIn(cost, 0, 1e15, "cost");
  }
  const events = applyOverrides(getAuditEvents(), request.eventOverrides);
  const candidateEvents = applyOverrides(events, request.candidateFitOverrides);
  const totalFit = Math.max(
    events.reduce((s, e) => s + e.fit, 0),
    candidateEvents.reduce((s, e) => s + e.fit, 0),
  );
  const sensitivityPlan = auditSensitivityPlan(
    request,
    mechanisms,
    model,
    policy,
  );
  const sensitivityCount = sensitivityPlan.reduce(
    (n, p) => n + p.values.length,
    0,
  );
  const sampleRuns =
    ((request.verifyRecommendation ?? false)
      ? 2 * (request.verificationTrials ?? 64)
      : 0) +
    (11 + (request.candidateFitOverrides?.length ? 1 : 0)) * request.trials +
    ((request.attribution ?? true) && mechanisms.length
      ? 2 ** mechanisms.length * attributionTrials
      : 0);
  const expectedEvents = scales.reduce(
    (s, n) =>
      s +
      ((n * totalFit) / 1e9) *
        request.hours *
        (sampleRuns +
          (n === request.cards ? sensitivityCount * request.trials : 0)),
    0,
  );
  if (
    sampleRuns * scales.length + sensitivityCount * request.trials > 131072 ||
    expectedEvents > 30000000
  )
    throw new Error(
      "Audit work budget exceeded; reduce scales, trials, mechanisms or event rates",
    );
  return {
    model,
    policy,
    mechanisms,
    recoveryOrder,
    events,
    candidateEvents,
    scales,
    attributionTrials,
    expectedEvents,
    sensitivityPlan,
  };
}
export function audit(
  request: AuditRequest,
  onProgress?: (done: number, total: number) => void,
) {
  const resolved = resolveAudit(request),
    {
      events,
      candidateEvents,
      model,
      policy,
      scales,
      mechanisms,
      recoveryOrder,
      attributionTrials,
      sensitivityPlan,
    } = resolved;
  const engine = createEngine(events, policy, model);
  const candidateEngine = createEngine(candidateEvents, policy, model);
  const sample = (
    cards: number,
    opts: Record<string, any>,
    trials: number,
    selectedEngine = engine,
    ledgerEnabled: boolean | "totals" = true,
    seedOffset = 0,
  ) => {
    const values: number[] = [],
      ledger: Record<string, number> = {},
      perEvent: Record<string, any> = {};
    let availability = 0;
    const params = selectedEngine.parameters(opts);
    for (let i = 0; i < trials; i++) {
      const r = selectedEngine.simulate(
        cards,
        2,
        (request.seed + Math.imul(i + 1 + seedOffset, 2654435761)) >>> 0,
        params,
        { ...opts, recoveryOrder },
      );
      values.push(r.usefulThroughput);
      availability += r.operationalAvailability / trials;
      if (ledgerEnabled) {
        for (const [k, v] of Object.entries(r.ledger))
          ledger[k] = (ledger[k] ?? 0) + (v as number) / trials;
        if (ledgerEnabled !== "totals")
          for (const [id, row] of Object.entries(r.perEvent)) {
            perEvent[id] ??= {};
            for (const [k, v] of Object.entries(row as any))
              perEvent[id][k] = (perEvent[id][k] ?? 0) + (v as number) / trials;
          }
      }
    }
    return {
      cards,
      statistics: summarize(values, auditTarget(request, cards)),
      availability,
      ledger,
      perEvent,
      values,
    };
  };
  let completed = 0;
  const rows: any[] = [],
    attribution: any[] = [],
    sensitivity: any[] = [];
  const definitions = [
    { id: "base", name: "确认基线", opts: {} },
    ...scenarios.map(([id, name]) => ({ id, name, opts: { [id]: true } })),
    {
      id: "sdcStep",
      name: "静默检测＋step 恢复",
      opts: { sdcDetect: true, step: true },
    },
    {
      id: "combined",
      name: "所选机制组合",
      opts: Object.fromEntries(mechanisms.map((id) => [id, true])),
    },
  ];
  if (request.candidateFitOverrides?.length)
    definitions.push({
      id: "hardware",
      name: "目标 FIT＋所选机制",
      opts: Object.fromEntries(mechanisms.map((id) => [id, true])),
    });
  const total =
    ((request.verifyRecommendation ?? false) ? 2 : 0) +
    scales.length *
      (definitions.length +
        ((request.attribution ?? true) && mechanisms.length
          ? 2 ** mechanisms.length
          : 0)) +
    sensitivityPlan.reduce((n, p) => n + p.values.length, 0);
  for (const cards of scales) {
    const base = sample(cards, {}, request.trials);
    const samples = definitions.map((def) => {
      const sampled =
        def.id === "base"
          ? base
          : sample(
              cards,
              def.opts,
              request.trials,
              def.id === "hardware" ? candidateEngine : engine,
            );
      const delta = summarize(
        sampled.values.map((v, i) => v - base.values[i]),
        0,
      );
      rows.push({
        target: auditTarget(request, cards),
        id: def.id,
        name: def.name,
        ...sampled,
        delta,
        values: undefined,
      });
      onProgress?.(++completed, total);
      return { ...def, ...sampled };
    });
    if (cards === request.cards) {
      for (const scan of sensitivityPlan) {
        const reference = samples.find((s) => s.id === scan.scenarioId)!;
        for (const value of scan.values) {
          const parameter = scan.parameter;
          const opts = {
            ...reference.opts,
            ...(parameter !== "sdcDelayHours" ? { [parameter]: value } : {}),
          };
          const selectedEngine =
            parameter === "sdcDelayHours"
              ? createEngine(events, policy, { ...model, sdcDelayHours: value })
              : engine;
          const s = sample(
            cards,
            opts,
            request.trials,
            selectedEngine,
            "totals",
          );
          sensitivity.push({
            parameter,
            value,
            cards,
            scenarioId: reference.id,
            scenarioName: reference.name,
            currentValue: scan.current,
            ledger: s.ledger,
            availability: s.availability,
            statistics: s.statistics,
            delta: summarize(
              s.values.map((v, i) => v - reference.values[i]),
              0,
            ),
          });
          onProgress?.(++completed, total);
        }
      }
    }
    if ((request.attribution ?? true) && mechanisms.length) {
      const coalitions = Array.from(
        { length: 2 ** mechanisms.length },
        (_, mask) => {
          const factors = mechanisms.filter((_, i) => mask & (1 << i));
          const r = sample(
            cards,
            Object.fromEntries(factors.map((id) => [id, true])),
            attributionTrials,
            engine,
            false,
          );
          onProgress?.(++completed, total);
          return { mask, factors, ...r };
        },
      );
      const trialContributions = Array.from(
        { length: attributionTrials },
        (_, i) =>
          shapleyValues(
            coalitions.map((c) => c.values[i]),
            mechanisms.length,
          ),
      );
      const contributions = mechanisms.map((id, i) => ({
        id,
        name: scenarios.find((s) => s[0] === id)![1],
        statistics: summarize(
          trialContributions.map((v) => v[i]),
          0,
        ),
      }));
      const gain =
        coalitions.at(-1)!.statistics.mean - coalitions[0].statistics.mean;
      const singletonSum = mechanisms.reduce(
        (s, _, i) =>
          s +
          coalitions[1 << i].statistics.mean -
          coalitions[0].statistics.mean,
        0,
      );
      const interactions = mechanisms.flatMap((a, i) =>
        mechanisms.slice(i + 1).map((b, j) => {
          const ai = 1 << i,
            bi = 1 << (i + j + 1);
          return {
            a,
            b,
            statistics: summarize(
              coalitions[ai | bi].values.map(
                (v, k) =>
                  v -
                  coalitions[ai].values[k] -
                  coalitions[bi].values[k] +
                  coalitions[0].values[k],
              ),
              0,
            ),
          };
        }),
      );
      attribution.push({
        cards,
        trials: attributionTrials,
        gain,
        nonAdditivity: gain - singletonSum,
        contributions,
        interactions,
        residual:
          contributions.reduce((s, c) => s + c.statistics.mean, 0) - gain,
        coalitions: coalitions.map((c) => ({
          mask: c.mask,
          factors: c.factors,
          statistics: c.statistics,
        })),
        conditionalStep: summarize(
          samples
            .find((s) => s.id === "sdcStep")!
            .values.map(
              (v, i) =>
                v - samples.find((s) => s.id === "sdcDetect")!.values[i],
            ),
          0,
        ),
      });
    }
  }
  const combined = rows.find(
    (r) => r.cards === request.cards && r.id === "combined",
  );
  const costOf = (ids: string[]) =>
    ids.every((id) => request.costs?.[id] !== undefined)
      ? ids.reduce((sum, id) => sum + request.costs![id], 0)
      : null;
  const coalitionAudit = attribution.find((a) => a.cards === request.cards);
  const candidates = (
    coalitionAudit
      ? coalitionAudit.coalitions.map((c: any) => ({
          mechanisms: c.factors,
          statistics: c.statistics,
        }))
      : rows
          .filter(
            (r) =>
              r.cards === request.cards && ["base", "combined"].includes(r.id),
          )
          .map((r) => ({
            mechanisms: r.id === "base" ? [] : mechanisms,
            statistics: r.statistics,
          }))
  ).map((c: any) => ({ ...c, cost: costOf(c.mechanisms) }));
  const costsComplete = candidates.every((c: any) => c.cost !== null);
  candidates.sort((a: any, b: any) => {
    const passes = (c: any) => c.statistics.ciLow >= request.target;
    if (passes(a) !== passes(b)) return passes(a) ? -1 : 1;
    if (passes(a) && costsComplete && a.cost !== b.cost) return a.cost - b.cost;
    return (
      b.statistics.mean - a.statistics.mean ||
      a.mechanisms.length - b.mechanisms.length
    );
  });
  const chosen = candidates[0];
  let verification: any = null;
  if (request.verifyRecommendation ?? false) {
    const trials = request.verificationTrials ?? 64;
    const independentBase = sample(
      request.cards,
      {},
      trials,
      engine,
      false,
      1000000,
    );
    onProgress?.(++completed, total);
    const checked = sample(
      request.cards,
      Object.fromEntries(chosen.mechanisms.map((id: string) => [id, true])),
      trials,
      engine,
      false,
      1000000,
    );
    onProgress?.(++completed, total);
    verification = {
      trials,
      seedOffset: 1000000,
      statistics: checked.statistics,
      baseline: independentBase.statistics,
      delta: summarize(
        checked.values.map((v, i) => v - independentBase.values[i]),
        0,
      ),
      status:
        checked.statistics.ciLow >= request.target
          ? "supported"
          : checked.statistics.ciHigh < request.target
            ? "below"
            : "uncertain",
    };
  }
  const recommendation = {
    scope: coalitionAudit
      ? "selected-mechanism-subsets"
      : "baseline-and-selected-combination",
    candidateCount: candidates.length,
    chosen,
    shortlist: candidates.slice(0, 8),
    verification,
    rule: "优先区间下限达到目标的候选；候选成本均已提供时优先较低成本，否则按均值排序。候选仅限当前已选机制的子集，不代表全局最优；载入后需重新评估其他规模。",
  };
  const totalFit = events.reduce((s, e) => s + e.fit, 0);
  const referenceEvents = getAuditEvents();
  const metadata = events.map((event) => ({
    ...event,
    referenceFit: referenceEvents.find((e) => e.id === event.id)!.fit,
    share: totalFit ? event.fit / totalFit : 0,
    withinTypeShare: engine.typeTotals[event.type]
      ? event.fit / engine.typeTotals[event.type]
      : 0,
    rate: (request.cards * event.fit) / 1e9,
    mtbfHours: event.fit > 0 ? 1e9 / (request.cards * event.fit) : null,
  }));
  return {
    kind: "expert-review-audit",
    metricId: AUDIT_METRIC,
    modelVersion: AUDIT_VERSION,
    request: structuredClone(request),
    rows,
    designReview: auditDesignReview(
      { ...request, mechanisms },
      rows,
      model,
      policy,
    ),
    recommendation,
    attribution,
    sensitivity,
    reviewChecks: auditReviewChecks(request.hours, rows, attribution),
    events: metadata,
    mechanisms: sourceMechanisms.mechanisms.map((m) => ({
      ...m,
      parameters: policy[m.id] ?? null,
      eventIds: events
        .filter(
          (e) =>
            m.scope === "all" ||
            e.type === m.scope ||
            (e.type === "hard" && (e as any)[m.scope] === true),
        )
        .map((e) => e.id),
    })),
    candidateEvents: request.candidateFitOverrides?.length
      ? candidateEvents
      : [],
    config: {
      model,
      policy,
      recoveryOrder,
      sourceCommit: commit,
      sourcePath: "catalogs/review-2026-10-09",
      inputHash: createHash("sha256")
        .update(JSON.stringify({ events, model, policy, recoveryOrder }))
        .digest("hex"),
      classFit: engine.typeTotals,
    },
    decision: {
      target: request.target,
      selectedScale: request.cards,
      status:
        combined.statistics.ciLow >= request.target
          ? "supported-by-sampling"
          : combined.statistics.ciHigh < request.target
            ? "below-target"
            : "uncertain",
      totalCost: mechanisms.every((id) => request.costs?.[id] !== undefined)
        ? mechanisms.reduce((s, id) => s + request.costs![id], 0)
        : null,
    },
    assumptions: [
      "单作业有限窗口；故障时钟仅在非全局停机期间推进",
      "期末存在污染时保留最后干净检查点；与 V4 整任务清零不是同一指标",
      "恢复链顺序固定为本次输入；机制启用组合与物理执行顺序分别建模",
      "DP 为容量等效近似；同步阻塞、共因与备用资源耗尽需扩展模型",
    ],
    warnings: [
      "中断类内占比（包括 CORE-hard）优先用内网数据替换；未提供的静默/亚健康保留外网先验",
      "机制不改变源 FIT；硬件降 FIT 必须显式输入目标事件率",
      "Shapley 的加入顺序是贡献分摊，不是恢复链执行顺序；收益完全可加时不必使用 Shapley",
      "固定时延与周期检查点采用离散事件仿真；CTMC 仅适用于指数停留时间等前提",
      "置信区间只反映抽样误差；不同参数下配对种子不保证事件逐一对齐",
      "费用与工程可行性需现场确认；候选达到均值目标不等于生产 SLA 或全局最优",
    ],
  };
}

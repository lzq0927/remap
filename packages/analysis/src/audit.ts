import { auditPlanningModelKeys } from "../../contracts/src/audit-planning";
import { topologyDecision } from "./audit-topology-decision";
import {
  trainingScenarioIssues,
  type TrainingScenario,
} from "../../contracts/src/audit-training-scenario";
import { networkStudySnapshot } from "./audit-network-study";
import { hardwareScaleEvents } from "../../contracts/src/audit-hardware";
import { supernodeAuditArchitecture } from "../../contracts/src/audit-supernode";
import {
  resolveAuditArchitecture,
  type AuditArchitecture,
} from "../../contracts/src/audit-architecture";
import {
  auditArchitectureDiagnosis,
  architectureBudgets,
  architectureReviewChecks,
} from "./audit-architecture";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import sourceInputs from "../../../references/expert-review-2026-10-09/inputs.json";
import sourceConfig from "../../../references/expert-review-2026-10-09/config.json";
import sourcePolicy from "../../../references/expert-review-2026-10-09/mechanism-policy.json";
import sourceMechanisms from "../../../references/expert-review-2026-10-09/mechanisms.json";
import { summarize } from "../../solvers/src/statistics";
import {
  auditDefaultTargets,
  auditSamplingPreset,
  auditReferenceScales,
  auditReferenceMechanisms,
  auditReferenceOnly,
} from "../../contracts/src/audit-presets";
import { auditSensitivityPlan } from "./audit-sensitivity";
import { auditReviewChecks } from "./audit-checks";
import { auditReferenceComparison } from "./audit-reference";
import { shapleyValues } from "./index";
import {
  resolveConditionalBaseline,
  rankMarginalGains,
  type ConditionalBaseline,
} from "./conditional-baseline";
import {
  auditTarget,
  validateAuditDesign,
  auditDesignReview,
} from "./audit-design";
import {
  auditSubmodelPlan,
  auditHardwareItems,
  lossAllocation,
  type AuditSubmodelAllocation,
  type LossBudgetMethod,
} from "./audit-allocation";
import { mechanismEventIds } from "../../contracts/src/audit-objects";
import {
  auditOptimizationDefaults,
  type AuditOptimizationRequest,
} from "../../contracts/src/audit-optimization";
import {
  auditOptimization,
  validateOptimization,
  optimizationWork,
} from "./audit-optimization";
import { existingMechanismClasses } from "../../contracts/src/audit-extensions";
import {
  calibratedAuditEvents,
  currentAuditCatalogVersion,
  type AuditCatalogVersion,
} from "../../contracts/src/audit-catalog";

const createEngine = createRequire(import.meta.url)(
  "../../solvers/src/vendor/review-engine.cjs",
);
export const AUDIT_VERSION = "review-retained-progress.v4";
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
  trainingScenario?: TrainingScenario;
  architecture?: AuditArchitecture;
  eventCatalogVersion?: AuditCatalogVersion;
  optimization?: AuditOptimizationRequest;
  rateArithmetic?: "expert-reference" | "catalog";
  samplingProfile?: "expert-reproduction" | "quick" | "custom";
  confidenceMethod?: "student-t" | "normal-1.96";
  attributionSeed?: number;
  sensitivitySeed?: number;
  sensitivityTrials?: number;
  sensitivityCards?: number;
  cards: number;
  hours: number;
  trials: number;
  seed: number;
  target: number;
  targets?: Record<string, number>;
  lossBudgetWeights?: Record<string, number>;
  lossBudgetMethod?: LossBudgetMethod;
  submodelAllocation?: AuditSubmodelAllocation;
  verifyRecommendation?: boolean;
  verificationTrials?: number;
  scales?: number[];
  mechanisms?: string[];
  baseline?: ConditionalBaseline;
  attribution?: boolean;
  attributionTrials?: number;
  model?: Record<string, number>;
  policy?: Record<string, Record<string, number>>;
  eventOverrides?: EventOverride[];
  candidateFitOverrides?: EventOverride[];
  recoveryOrder?: string[];
  costs?: Record<string, number>;
  sensitivity?: boolean;
  sensitivityMode?:
    | "expert-reference"
    | "selected-combination"
    | "expert-reproduction";
}
const modelKeys = auditPlanningModelKeys;
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
    architecture: supernodeAuditArchitecture(getAuditEvents()),
    cards: 500000,
    eventCatalogVersion: currentAuditCatalogVersion,
    hours: 720,
    ...auditSamplingPreset("expert-reproduction"),
    seed: sourceConfig.seed,
    target: 0.985,
    targets: { ...auditDefaultTargets },
    lossBudgetMethod: "none" as const,
    optimization: structuredClone(auditOptimizationDefaults),
    verifyRecommendation: true,
    scales: [...auditReferenceScales],
    mechanisms: [...auditReferenceMechanisms],
    attribution: true,
    sensitivity: true,
    eventOverrides: [],
    candidateFitOverrides: [],
    recoveryOrder: ["replay", "elastic", "process"],
    model: Object.fromEntries(
      modelKeys.map((k) => [k, (sourceConfig as any)[k] ?? 0]),
    ),
    policy: structuredClone(sourcePolicy),
    metricId: AUDIT_METRIC,
    modelVersion: AUDIT_VERSION,
  };
}
function getAuditReferenceEvents() {
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
      referenceEvidence: event.evidence,
      referenceReviewNote: event.reviewNote,
      legacyEvidence: old.evidence,
      fitEvidence: old.fitEvidence,
      note:
        event.type === "中断"
          ? "参考版本的中断总量及类内占比，可用观测数据校准"
          : "采用参考参数；缺少观测不代表零风险",
    };
  });
}
export function getAuditEvents(
  version: AuditCatalogVersion = currentAuditCatalogVersion,
) {
  const events = getAuditReferenceEvents();
  return version === "baseline-2026-10-14"
    ? calibratedAuditEvents(events)
    : events;
}
export const auditMechanisms = scenarios.map(([id, name, code]) => ({
  ...sourceMechanisms.mechanisms.find((m) => m.id === code),
  id,
  name,
  code,
  ...existingMechanismClasses[id],
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
  if (
    request.eventCatalogVersion !== undefined &&
    !["expert-2026-10-09", "baseline-2026-10-14"].includes(
      request.eventCatalogVersion,
    )
  )
    throw new Error("未知故障模式基准版本");
  validateOptimization(request);
  if (
    request.optimization?.enabled &&
    (request.optimization.model ||
      request.optimization.policy ||
      request.optimization.fitTargets)
  ) {
    resolveAudit({
      ...request,
      optimization: undefined,
      model: { ...request.model, ...request.optimization.model },
      policy: Object.fromEntries(
        [
          ...new Set([
            ...Object.keys(request.policy ?? {}),
            ...Object.keys(request.optimization.policy ?? {}),
          ]),
        ].map((id) => [
          id,
          { ...request.policy?.[id], ...request.optimization?.policy?.[id] },
        ]),
      ),
      candidateFitOverrides:
        request.optimization.fitTargets ?? request.candidateFitOverrides,
    });
  }
  if (request.trainingScenario) {
    const issues = trainingScenarioIssues(
      request.trainingScenario,
      getAuditEvents(),
    );
    if (request.hours !== 600)
      issues.push("训练场景使用600小时固定窗口；其他窗口请另建普通评估");
    if (issues.length) throw new Error(issues.join("；"));
  }
  const submodelPlan = auditSubmodelPlan(request.submodelAllocation);
  if (
    request.lossBudgetMethod !== undefined &&
    !["none", "equal", "baseline-proportional", "custom"].includes(
      request.lossBudgetMethod,
    )
  )
    throw new Error("未知损失预算分配方法");
  if (
    request.rateArithmetic !== undefined &&
    !["expert-reference", "catalog"].includes(request.rateArithmetic)
  )
    throw new Error("Unknown rate arithmetic");
  if (
    request.samplingProfile !== undefined &&
    !["expert-reproduction", "quick", "custom"].includes(
      request.samplingProfile,
    )
  )
    throw new Error("Unknown sampling profile");
  if (
    request.confidenceMethod !== undefined &&
    !["student-t", "normal-1.96"].includes(request.confidenceMethod)
  )
    throw new Error("Unknown confidence method");
  for (const key of ["attributionSeed", "sensitivitySeed"] as const)
    if (request[key] !== undefined)
      numberIn(request[key], 0, 4294967295, key, true);
  const sensitivityTrials = request.sensitivityTrials ?? request.trials;
  const sensitivityCards = request.sensitivityCards ?? request.cards;
  numberIn(sensitivityTrials, 2, 8192, "sensitivityTrials", true);
  numberIn(sensitivityCards, 1, 1000000, "sensitivityCards", true);
  numberIn(request.cards, 1, 1000000, "cards", true);
  numberIn(request.hours, 0.01, 8760, "hours");
  numberIn(request.trials, 2, 8192, "trials", true);
  numberIn(request.seed, 0, 4294967295, "seed", true);
  numberIn(request.target, 0, 1, "target");
  const scales = request.scales ?? [request.cards];
  if (
    !Array.isArray(scales) ||
    !scales.length ||
    scales.length > 6 ||
    new Set(scales).size !== scales.length ||
    !scales.includes(request.cards)
  )
    throw new Error(
      "scales must contain the selected cards and 1..6 unique sizes",
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
    validationOverhead: 0,
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
    const probability = /Probability|Success|Loss|Overhead/.test(key);
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
        key === "domains" ? 1 : key === "computeSeconds" ? 0.000001 : 0,
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
  const selectedMechanisms =
    request.mechanisms ?? getAuditDefaults().mechanisms;
  if (
    !Array.isArray(selectedMechanisms) ||
    new Set(selectedMechanisms).size !== selectedMechanisms.length ||
    selectedMechanisms.some((id) => !scenarios.some((s) => s[0] === id))
  )
    throw new Error("Unknown or repeated mechanism");
  const originalEvents = applyOverrides(
    getAuditEvents(request.eventCatalogVersion ?? "expert-2026-10-09"),
    request.eventOverrides,
  );
  const baseline = resolveConditionalBaseline(
    request.baseline,
    scenarios.map((s) => s[0]),
    originalEvents,
  );
  const mechanisms = selectedMechanisms.filter(
    (id) => !baseline.mechanisms.includes(id),
  );
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
  if (request.verifyRecommendation) {
    const seeds = new Set<number>();
    const addSeeds = (base: number, trials: number) => {
      for (let i = 0; i < trials; i++)
        seeds.add((base + Math.imul(i + 1, 2654435761)) >>> 0);
    };
    addSeeds(request.seed, request.trials);
    if ((request.attribution ?? true) && mechanisms.length)
      addSeeds(request.attributionSeed ?? request.seed, attributionTrials);
    for (let i = 0; i < (request.verificationTrials ?? 64); i++)
      if (
        seeds.has((request.seed + Math.imul(i + 1 + 1000000, 2654435761)) >>> 0)
      )
        throw new Error(
          "Independent verification seeds overlap with screening seeds; choose another Shapley seed",
        );
  }
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
    ![
      "expert-reference",
      "selected-combination",
      "expert-reproduction",
    ].includes(request.sensitivityMode)
  )
    throw new Error("Unknown sensitivity comparison mode");
  for (const [id, cost] of Object.entries(request.costs ?? {})) {
    if (!selectedMechanisms.includes(id) && !baseline.mechanisms.includes(id))
      throw new Error("Costs must refer to selected mechanisms");
    numberIn(cost, 0, 1e15, "cost");
  }
  const events = baseline.events;
  const architecture = resolveAuditArchitecture(request.architecture, events);
  for (const cards of scales)
    architectureBudgets(
      architecture,
      cards,
      request.hours,
      auditReferenceOnly(request, cards) || architecture.budgetMethod === "none"
        ? null
        : (1 - auditTarget(request, cards)) * request.hours,
    );
  if (request.submodelAllocation?.source === "event-catalog") {
    const allocation = request.submodelAllocation;
    const expected = auditHardwareItems(
      hardwareScaleEvents(events, architecture, request.cards),
      request.cards,
    );
    if (
      allocation.cards !== request.cards ||
      allocation.items.length !== expected.length ||
      expected.some(
        (item) =>
          Math.abs(
            (allocation.items.find((i) => i.id === item.id)?.baselineRate ??
              -1) - item.baselineRate,
          ) > 1e-14,
      )
    )
      throw new Error("故障库或规模已改变，请在可用度分配中刷新对象并复核目标");
  }
  if (
    request.candidateFitOverrides?.some((e) =>
      baseline.resolvedEvents.some((r) => r.id === e.id),
    )
  )
    throw new Error("已假设消除的故障不能同时设置候选FIT");
  const candidateEvents = applyOverrides(events, request.candidateFitOverrides);
  // Preserve the reference's arithmetic at checkpoint boundaries only while event FITs are unchanged.
  // Every calibrated catalog, and historical requests without this option, still derives rates from its actual FIT.
  const usesReferenceRates = (catalog: typeof events) =>
    request.rateArithmetic === "expert-reference" &&
    catalog.every(
      (e, i) =>
        e.id === sourceInputs.current.events[i].id &&
        e.fit === sourceInputs.current.events[i].fit,
    );
  model.referenceRateArithmetic = usesReferenceRates(events);
  model.referenceFitSignature = JSON.stringify(
    sourceInputs.current.events.map(({ id, fit }) => ({ id, fit })),
  );
  const totalFit = Math.max(
    ...[
      ...new Set([
        ...scales,
        ...(request.sensitivity !== false ? [sensitivityCards] : []),
      ]),
    ].flatMap((cards) =>
      [events, candidateEvents].map((catalog) =>
        hardwareScaleEvents(catalog, architecture, cards).reduce(
          (s, e) => s + e.fit,
          0,
        ),
      ),
    ),
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
  const runsByScale = scales.map((cards) => ({
    cards,
    runs:
      (11 + (request.candidateFitOverrides?.length ? 1 : 0)) * request.trials +
      ((request.attribution ?? true) &&
      mechanisms.length &&
      !auditReferenceOnly(request, cards)
        ? 2 ** mechanisms.length * attributionTrials
        : 0),
  }));
  // Reference scans need their own same-seed, same-count control, not the main-result sample.
  const controls = new Set(sensitivityPlan.map((p) => p.scenarioId)).size;
  runsByScale.push({
    cards: sensitivityCards,
    runs: (sensitivityCount + controls) * sensitivityTrials,
  });
  if (request.verifyRecommendation ?? false)
    runsByScale.push({
      cards: request.cards,
      runs: 2 * (request.verificationTrials ?? 64),
    });
  const sampleRuns = runsByScale.reduce((s, r) => s + r.runs, 0);
  const expectedEvents = runsByScale.reduce(
    (s, r) => s + ((r.cards * totalFit) / 1e9) * request.hours * r.runs,
    0,
  );
  const extraWork = optimizationWork(request, scales);
  if (
    sampleRuns + extraWork.trajectories > 1000000 ||
    expectedEvents + (extraWork.events * totalFit) / 1e9 > 450000000
  )
    throw new Error(
      "Audit work budget exceeded (1,000,000 trajectories / 450,000,000 expected events); reduce scales, trials, mechanisms or event rates",
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
    sensitivityCards,
    sensitivityTrials,
    sampleRuns,
    candidateReferenceRates: usesReferenceRates(candidateEvents),
    submodelPlan,
    baseline,
  };
}
function auditOneRound(
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
      sensitivityCards,
      sensitivityTrials,
      baseline,
    } = resolved;
  const buildEngine = (catalog: typeof events, config: typeof model) => {
    const base = createEngine(catalog, policy, config);
    if (!request.architecture?.nodes.some((n) => n.rateModel || n.exposure))
      return base;
    const cache = new Map<number, any>();
    return {
      ...base,
      forCards: (cards: number) => {
        if (!cache.has(cards))
          cache.set(
            cards,
            createEngine(
              hardwareScaleEvents(catalog, request.architecture, cards),
              policy,
              { ...config, referenceRateArithmetic: false },
            ),
          );
        return cache.get(cards);
      },
    };
  };
  const engine = buildEngine(events, model);
  const candidateEngine = buildEngine(candidateEvents, {
    ...model,
    referenceRateArithmetic: resolved.candidateReferenceRates,
  });
  const stats = (values: number[], target = 0) =>
    summarize(values, target, request.confidenceMethod ?? "student-t");
  let completed = 0;
  const total = resolved.sampleRuns;
  const sample = (
    cards: number,
    opts: Record<string, any>,
    trials: number,
    selectedEngine = engine,
    ledgerEnabled: boolean | "totals" = true,
    seedOffset = 0,
    seedBase = request.seed,
  ) => {
    selectedEngine = selectedEngine.forCards?.(cards) ?? selectedEngine;
    opts = {
      ...Object.fromEntries(baseline.mechanisms.map((id) => [id, true])),
      ...opts,
    };
    const values: number[] = [],
      ledger: Record<string, number> = {},
      perEvent: Record<string, any> = {};
    let availability = 0;
    const params = selectedEngine.parameters(opts);
    for (let i = 0; i < trials; i++) {
      const r = selectedEngine.simulate(
        cards,
        2,
        (seedBase + Math.imul(i + 1 + seedOffset, 2654435761)) >>> 0,
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
      completed++;
      if (
        completed === total ||
        completed % Math.max(1, Math.floor(total / 200)) === 0
      )
        onProgress?.(completed, total);
    }
    return {
      cards,
      ...(request.architecture?.nodes.some((n) => n.rateModel || n.exposure)
        ? { scaleEvents: selectedEngine.events }
        : {}),
      statistics: stats(values, auditTarget(request, cards)),
      availability,
      ledger,
      perEvent,
      values,
    };
  };
  const rows: any[] = [],
    attribution: any[] = [],
    sensitivity: any[] = [];
  const lossAllocations: ReturnType<typeof lossAllocation>[] = [];
  const definitions = [
    { id: "base", name: "确认基线", opts: {} },
    ...scenarios.map(([id, name]) => ({
      id,
      name: baseline.mechanisms.includes(id) ? name + "（已在基线）" : name,
      opts: { [id]: true },
    })),
    {
      id: "sdcStep",
      name: "静默检测＋step 恢复",
      opts: { sdcDetect: true, step: true },
    },
    {
      id: "combined",
      name: "当前措施组合",
      opts: Object.fromEntries(mechanisms.map((id) => [id, true])),
    },
  ];
  if (request.candidateFitOverrides?.length)
    definitions.push({
      id: "hardware",
      name: "目标 FIT＋所选机制",
      opts: Object.fromEntries(mechanisms.map((id) => [id, true])),
    });
  for (const cards of scales) {
    const base = sample(cards, {}, request.trials);
    lossAllocations.push(
      lossAllocation(
        request.lossBudgetMethod,
        request.lossBudgetWeights,
        base.ledger,
        cards,
        request.hours,
        auditTarget(request, cards),
      ),
    );
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
      const delta = stats(
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
      return { ...def, ...sampled };
    });
    if (
      (request.attribution ?? true) &&
      mechanisms.length &&
      !auditReferenceOnly(request, cards)
    ) {
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
            0,
            request.attributionSeed ?? request.seed,
          );
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
        statistics: stats(
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
            statistics: stats(
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
        conditionalStep: stats(
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
  for (const scenarioId of new Set(
    sensitivityPlan.map((scan) => scan.scenarioId),
  )) {
    const definition = definitions.find((d) => d.id === scenarioId)!;
    const reference = sample(
      sensitivityCards,
      definition.opts,
      sensitivityTrials,
      engine,
      "totals",
      0,
      request.sensitivitySeed ?? request.seed,
    );
    for (const scan of sensitivityPlan.filter(
      (p) => p.scenarioId === scenarioId,
    )) {
      for (const value of scan.values) {
        const parameter = scan.parameter;
        const opts = {
          ...definition.opts,
          ...(parameter !== "sdcDelayHours" ? { [parameter]: value } : {}),
        };
        const selectedEngine =
          parameter === "sdcDelayHours"
            ? buildEngine(events, { ...model, sdcDelayHours: value })
            : engine;
        const sampled = sample(
          sensitivityCards,
          opts,
          sensitivityTrials,
          selectedEngine,
          "totals",
          0,
          request.sensitivitySeed ?? request.seed,
        );
        sensitivity.push({
          parameter,
          value,
          cards: sensitivityCards,
          trials: sensitivityTrials,
          scenarioId,
          scenarioName: definition.name,
          currentValue: scan.current,
          referenceStatistics: reference.statistics,
          ledger: sampled.ledger,
          availability: sampled.availability,
          statistics: sampled.statistics,
          delta: stats(sampled.values.map((v, i) => v - reference.values[i])),
        });
      }
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
              r.cards === request.cards &&
              (mechanisms.length ? ["base", "combined"] : ["base"]).includes(
                r.id,
              ),
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
    const checked = sample(
      request.cards,
      Object.fromEntries(chosen.mechanisms.map((id: string) => [id, true])),
      trials,
      engine,
      false,
      1000000,
    );
    verification = {
      trials,
      seedOffset: 1000000,
      statistics: checked.statistics,
      baseline: independentBase.statistics,
      delta: stats(
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
  onProgress?.(completed, total);
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
  const rankings = scales.map((cards) => ({
    cards,
    single: rankMarginalGains(
      mechanisms.map((id) => {
        const row = rows.find((r) => r.cards === cards && r.id === id)!;
        return { id, name: row.name, statistics: row.delta };
      }),
    ),
    shapley: attribution.some((a) => a.cards === cards)
      ? rankMarginalGains(
          attribution.find((a) => a.cards === cards)!.contributions,
        )
      : null,
  }));
  const referenceEvents = getAuditEvents("expert-2026-10-09");
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
  const result = {
    kind: "expert-review-audit",
    optimization: null as any,
    metricId: AUDIT_METRIC,
    modelVersion: AUDIT_VERSION,
    request: structuredClone(request),
    selection: {
      candidates: [...mechanisms],
      deployed: [...baseline.mechanisms],
    },
    referenceComparison: auditReferenceComparison(request, resolved),
    rows,
    baseline: {
      active: baseline.active,
      mechanisms: baseline.mechanisms,
      resolvedEvents: baseline.resolvedEvents,
      note: baseline.note,
      interpretation:
        "已部署机制在每个方案中固定启用；选定已消除事件的FIT仅在本次假设中置零，不改变故障库。新增成本不含基线已部署成本。",
    },
    rankings,
    allocationPlan: {
      submodel: resolved.submodelPlan,
      lossBudgets: lossAllocations,
    },
    designReview: auditDesignReview(
      {
        ...request,
        mechanisms: [...new Set([...baseline.mechanisms, ...mechanisms])],
      },
      rows,
      model,
      policy,
      lossAllocations,
    ),
    recommendation,
    attribution,
    sensitivity,
    reviewChecks: auditReviewChecks(request.hours, rows, attribution),
    events: metadata,
    mechanisms: sourceMechanisms.mechanisms.map((m) => ({
      ...m,
      parameters: policy[m.id] ?? null,
      eventIds: mechanismEventIds(events, m.scope),
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
      eventCatalogVersion: request.eventCatalogVersion ?? "expert-2026-10-09",
      inputHash: createHash("sha256")
        .update(
          JSON.stringify({
            events,
            model,
            policy,
            recoveryOrder,
            ...(baseline.active ? { baseline } : {}),
            ...(request.architecture?.nodes.some(
              (n) => n.rateModel || n.exposure,
            )
              ? { architecture: request.architecture }
              : {}),
          }),
        )
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
      "故障模式基准、补充观测和设计假设分开记录；更新事件时保留未修改项目的冻结值",
      "第一轮检测恢复措施不改变源 FIT；第二轮硬件目标或筛查机制会显式记录残余事件率",
      "Shapley 的加入顺序是贡献分摊，不是恢复链执行顺序；收益完全可加时不必使用 Shapley",
      "固定时延与周期检查点采用离散事件仿真；CTMC 仅适用于指数停留时间等前提",
      "置信区间只反映抽样误差；不同参数下配对种子不保证事件逐一对齐",
      "费用与工程可行性需现场确认；候选达到均值目标不等于生产 SLA 或全局最优",
    ],
  };
  const architectureDiagnosis = auditArchitectureDiagnosis(result);
  return {
    ...result,
    architectureDiagnosis,
    topologyDecision: topologyDecision({ ...result, architectureDiagnosis }),
    networkStudyResult: networkStudySnapshot(
      architectureDiagnosis.architecture,
      result.request.cards,
    ),
    reviewChecks: [
      ...result.reviewChecks,
      ...architectureReviewChecks(architectureDiagnosis),
    ],
  };
}

export function audit(
  request: AuditRequest,
  onProgress?: (done: number, total: number) => void,
) {
  const enabled = request.optimization?.enabled === true;
  const result = auditOneRound(
    request,
    enabled ? (done, total) => onProgress?.(done, total * 2) : onProgress,
  );
  if (enabled) {
    result.optimization = auditOptimization(
      request,
      result,
      resolveAudit(request),
      (fraction) => onProgress?.(1 + fraction, 2),
    );
    onProgress?.(1, 1);
  }
  return result;
}

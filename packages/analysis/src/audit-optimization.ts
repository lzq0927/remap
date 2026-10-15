import { optimizationSampling } from "../../contracts/src/audit-optimization";
import { mechanismTargetCatalog } from "../../contracts/src/audit-mechanism-targets";
import { deriveAgreeDesign, expertBudgetPaths } from "./audit-agree-design";
import { createHash } from "node:crypto";
import type { AuditRequest } from "./audit";
import {
  auditExtensionCatalog,
  validateExtensions,
  existingMechanismClasses,
  extensionScenario,
} from "../../contracts/src/audit-extensions";
import {
  auditReferenceOnly,
  auditScaleOrder,
} from "../../contracts/src/audit-presets";
import {
  auditObjects,
  eventLossHours,
  mechanismEventIds,
} from "../../contracts/src/audit-objects";
import { summarize } from "../../solvers/src/statistics";
import { agreeLossAllocation } from "./audit-allocation";
import { auditTarget } from "./audit-design";
import { createEnhancedAuditEngine } from "./audit-enhanced-engine";
import {
  mechanismLossBudget,
  mechanismGapDiagnostics,
} from "./audit-mechanism-budget";

const codes: Record<string, string> = {
  hardDetect: "D-HARD",
  slowDetect: "D-SLOW",
  sdcDetect: "D-SDC",
  step: "R-SDC",
  replay: "R-REPLAY",
  process: "R-PROCESS",
  elastic: "R-ELASTIC",
  fast: "C-FAST",
};
const names: Record<string, string> = {
  hardDetect: "中断检测",
  slowDetect: "亚健康检测",
  sdcDetect: "静默即时检测",
  step: "干净 step 恢复",
  replay: "通信/算子重执行",
  process: "进程重调度",
  elastic: "DP 域弹性恢复",
  fast: "检查点策略",
};
type Factor = {
  id: string;
  name: string;
  kind: string;
  mechanism?: string;
  code?: string;
  value?: any;
  source: string;
  parameterSources?: Record<string, string>;
};

export function shapleyImportance(contribution: number, maximum: number) {
  return Math.min(
    1,
    Math.max(
      0.2,
      0.2 + 0.8 * (Math.max(0, contribution) / Math.max(1e-12, maximum)),
    ),
  );
}

export function validateOptimization(request: AuditRequest) {
  const input = request.optimization;
  if (!input) return;
  if (
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.enabled !== "boolean"
  )
    throw new Error("第二轮配置必须明确是否启用");
  for (const key of [
    "autoTune",
    "allowFitTargets",
    "exploreExtensions",
  ] as const)
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      throw new Error("第二轮 " + key + " 必须是布尔值");
  if (
    input.planningCards !== undefined &&
    (!(request.scales ?? [request.cards]).includes(input.planningCards) ||
      !Number.isSafeInteger(input.planningCards) ||
      auditReferenceOnly(request, input.planningCards))
  )
    throw new Error("规划规模必须来自第一轮已评估规模");
  validateExtensions(input.extensions);
  for (const field of ["parameterTargets", "checkpointPeriods"] as const)
    if (
      input[field] !== undefined &&
      (typeof input[field] !== "object" ||
        input[field] === null ||
        Array.isArray(input[field]))
    )
      throw new Error("第二轮 " + field + " 必须是参数对象");
  for (const [id, value] of Object.entries(input.parameterTargets ?? {})) {
    const definition = mechanismTargetCatalog.find((p) => p.id === id);
    if (
      !definition ||
      !Number.isFinite(value) ||
      value < definition.min ||
      value > definition.max
    )
      throw new Error("第二轮工程参数边界无效：" + id);
  }
  for (const [cards, period] of Object.entries(input.checkpointPeriods ?? {})) {
    if (
      !(request.scales ?? [request.cards]).includes(Number(cards)) ||
      !Number.isFinite(period) ||
      period < 1 ||
      period > 31536000
    )
      throw new Error("第二轮检查点周期必须对应本次规模且至少1秒");
  }
  if (
    input.extensions?.some((e) => e.id === "I-CONTAIN") &&
    ![
      ...(request.mechanisms ?? []),
      ...(request.baseline?.mechanisms ?? []),
    ].includes("elastic")
  )
    throw new Error(
      "故障隔离是弹性训练的前提；需同时启用 DP 域弹性，不能单独计为局部续跑收益",
    );
  for (const [key, min, max] of [
    ["screeningTrials", 2, 256],
    ["attributionTrials", 2, 128],
    ["permutations", 2, 32],
  ] as const) {
    const value = input[key];
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < min || value > max)
    )
      throw new Error(`第二轮 ${key} 必须为 ${min}–${max} 整数`);
  }
  for (const [scale, items] of Object.entries(input.importance ?? {})) {
    if (
      !(request.scales ?? [request.cards]).includes(Number(scale)) ||
      !items ||
      typeof items !== "object" ||
      Array.isArray(items)
    )
      throw new Error("第二轮重要度必须对应本次规模");
    for (const [id, value] of Object.entries(items))
      if (!(id in codes) || !Number.isFinite(value) || value <= 0 || value > 1)
        throw new Error("第二轮机制重要度应在 (0,1]，且使用已知机制ID");
  }
  for (const [id, value] of Object.entries(input.complexity ?? {}))
    if (
      !/^[A-Z]+$/.test(id) ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 10000
    )
      throw new Error("对象复杂度必须为 (0,10000] 的数值");
}

export function optimizationWork(request: AuditRequest, scales: number[]) {
  if (!request.optimization?.enabled) return { trajectories: 0, events: 0 };
  const o = request.optimization;
  const extensionCount = new Set([
    ...(o.extensions ?? []).map((e) => e.id),
    ...((o.autoTune ?? true) && (o.exploreExtensions ?? true)
      ? auditExtensionCatalog.map((m) => m.id)
      : []),
  ]).size;
  const n = 14 + extensionCount;
  const {
    screeningTrials: screening,
    attributionTrials: attribution,
    permutations,
  } = optimizationSampling(request);
  const perScale =
    (screening + 2) * 40 +
    (request.verificationTrials ?? 64) * 2 +
    attribution * (permutations * (n + 1) + 2);
  return {
    trajectories: perScale * scales.length,
    events:
      perScale * scales.reduce((s, cards) => s + cards, 0) * request.hours,
  };
}

export function auditOptimization(
  request: AuditRequest,
  current: any,
  resolved: any,
  onProgress?: (fraction: number) => void,
) {
  const input = request.optimization!;
  const scales = resolved.scales
    .filter((n: number) => !auditReferenceOnly(request, n))
    .sort(auditScaleOrder);
  const primaryCards = scales.includes(500000) ? 500000 : request.cards;
  const currentRow = (n: number) =>
    current.rows.find((r: any) => r.cards === n && r.id === "combined");
  const unmet = scales.filter(
    (n: number) => currentRow(n).statistics.ciLow < auditTarget(request, n),
  );
  const basis = {
    kind: "two-round-availability.v1",
    planningVersion: "agree-mechanism-design-v3",
    primaryCards,
    firstRound:
      "固定本次事件 FIT 和现状措施参数；不因第二轮分配而改写第一轮结果",
    strategy:
      "目标与规模 → 固定现状评估 → 各规模 Shapley → AGREE 损失与机制指标分配 → 专家机制逐项筛选 → 预算反解参数要求 → 独立复评、剩余缺口与增量贡献",
    method: "agree.classical-normalized-loss.v1",
    source:
      "HAC-D@5ddfd65f67ff75e181abdec471e494d6cf8072b2 / user manual §7；专家机制库 mechanism-detail-review-2",
  };
  if (!unmet.length)
    return {
      ...basis,
      status: "not-needed",
      reason:
        "本次所有需求规模的现状采样区间下限均达到目标，保留现有方案，无需强制分配改进指标。",
      scales: [],
      allocations: [],
      candidates: [],
      attribution: [],
      factors: [],
    };
  if (!(request.attribution ?? true) || !current.attribution.length)
    return {
      ...basis,
      status: "needs-attribution",
      reason:
        "请开启第一轮组合 Shapley，才能据各规模贡献生成第二轮重要度建议。",
      scales: [],
      allocations: [],
      candidates: [],
      attribution: [],
      factors: [],
    };

  const selected = [
    ...new Set([
      ...(resolved.baseline.mechanisms ?? []),
      ...resolved.mechanisms,
    ]),
  ];
  const { screeningTrials, attributionTrials, permutations } =
    optimizationSampling(request);
  const verificationTrials = request.verificationTrials ?? 64;
  const used = new Set<number>();
  for (const [seed, trials, offset] of [
    [request.seed, request.trials, 0],
    [
      request.attributionSeed ?? request.seed,
      request.attributionTrials ?? 64,
      0,
    ],
    [request.seed, verificationTrials, 1000000],
    [
      request.sensitivitySeed ?? request.seed,
      request.sensitivityTrials ?? request.trials,
      0,
    ],
  ])
    for (let i = 0; i < trials; i++)
      used.add((seed + Math.imul(i + offset + 1, 2654435761)) >>> 0);
  const seedSet = (label: string, n: number) => {
    let index = 0;
    const values: number[] = [];
    while (values.length < n) {
      // The solver itself is an LCG. Consecutive LCG states would create
      // shifted, overlapping trajectories and misleadingly narrow intervals.
      const base = createHash("sha256")
        .update(
          `${request.seed}:two-round:mechanism-bounds-v2:${label}:${index++}`,
        )
        .digest()
        .readUInt32LE();
      if (!used.has(base)) {
        values.push(base);
        used.add(base);
      }
    }
    return values;
  };
  const seeds = {
    screening: seedSet("screening", screeningTrials),
    verification: seedSet("verification", verificationTrials),
    attribution: seedSet("attribution", attributionTrials),
  };
  const stats = (values: number[], target = 0) =>
    summarize(values, target, request.confidenceMethod ?? "student-t");
  const simulate = (
    cards: number,
    factors: Factor[],
    randomSeeds: number[],
    collect = true,
  ) => {
    const model = { ...resolved.model },
      policy = structuredClone(resolved.policy),
      extensions: any[] = [];
    let events = resolved.events;
    // Coalition value must not depend on the order in which Shapley added factors.
    // Scale overrides are always applied after the common checkpoint policy.
    const ordered = [...factors].sort(
      (a, b) =>
        Number(a.kind === "checkpoint-schedule") -
          Number(b.kind === "checkpoint-schedule") || a.id.localeCompare(b.id),
    );
    for (const f of ordered) {
      if (f.kind === "policy")
        policy[f.code!] = { ...policy[f.code!], ...f.value };
      if (f.kind === "model") Object.assign(model, f.value);
      if (
        f.kind === "checkpoint-schedule" &&
        f.value[String(cards)] !== undefined
      )
        policy["C-FAST"].computeSeconds = f.value[String(cards)];
      if (f.kind === "extension") extensions.push(f.value);
      if (f.kind === "fit")
        events = events.map((event: any) => ({
          ...event,
          fit: f.value.find((e: any) => e.id === event.id)?.fit ?? event.fit,
        }));
    }
    const engine = createEnhancedAuditEngine(events, policy, model, extensions),
      opts = {
        ...Object.fromEntries(selected.map((id) => [id, true])),
        recoveryOrder: resolved.recoveryOrder,
      },
      p = engine.parameters(opts);
    const values: number[] = [],
      ledger: Record<string, number> = {},
      perEvent: Record<string, any> = {};
    for (const seed of randomSeeds) {
      const r = engine.simulate(cards, 2, seed, p, opts);
      values.push(r.usefulThroughput);
      if (collect) {
        for (const [key, value] of Object.entries(r.ledger))
          ledger[key] = (ledger[key] ?? 0) + Number(value) / randomSeeds.length;
        for (const [id, detail] of Object.entries(r.perEvent)) {
          perEvent[id] ??= {};
          for (const [key, value] of Object.entries(detail as any))
            perEvent[id][key] =
              (perEvent[id][key] ?? 0) + Number(value) / randomSeeds.length;
        }
      }
    }
    // Conservative screening proxy for rare misses; never substituted for simulation output.
    const delay = Math.min(model.sdcDelayHours, request.hours);
    const exposure = delay - (delay * delay) / (2 * request.hours);
    const missRate = engine.events
      .filter((e: any) => e.type === "sdc")
      .reduce((sum: number, e: any) => {
        let coverage = selected.includes("sdcDetect")
          ? policy["D-SDC"].coverage
          : 0;
        const applicable = extensions.filter((m) =>
          auditExtensionCatalog
            .find((d) => d.id === m.id)!
            .eventCandidates.some((id: string) => id === e.id),
        );
        const extra = applicable
          .filter((m) => ["D-SDC-FP8", "D-SDC-FP4", "D-NET-SDC"].includes(m.id))
          .reduce(
            (s, m) =>
              s +
              m.parameters.eligibleShare *
                m.parameters.success *
                m.parameters.coverage,
            0,
          );
        coverage = Math.max(coverage, Math.min(1, extra));
        const abft = applicable.find((m) => m.id === "D-ABFT");
        if (abft)
          coverage +=
            (1 - coverage) *
            abft.parameters.eligibleShare *
            abft.parameters.success *
            abft.parameters.coverage;
        return sum + ((cards * e.fit) / 1e9) * (1 - coverage);
      }, 0);
    const observedSDCLoss =
      engine.events
        .filter((e: any) => e.type === "sdc")
        .reduce(
          (sum: number, e: any) => sum + eventLossHours(perEvent[e.id]),
          0,
        ) / request.hours;
    const rareMissPlanningMargin = Math.max(
      0,
      Math.min(1, missRate * exposure) - observedSDCLoss,
    );
    return {
      cards,
      statistics: stats(values, auditTarget(request, cards)),
      ledger,
      perEvent,
      values,
      rareMissPlanningMargin,
    };
  };
  const describe = (rows: any[]) =>
    rows.map(({ values: _values, perEvent: _perEvent, ...r }) => r);
  // Allocate before candidate search. The disjoint path budgets also guide
  // ranking inside the finite parameter bounds, while total availability wins.
  const planningLossBudgets = new Map(
    scales.map((cards: number) => {
      const contributions =
        current.attribution.find((a: any) => a.cards === cards)
          ?.contributions ?? [];
      const maximum = Math.max(
        1e-12,
        ...contributions.map((c: any) => Math.max(0, c.statistics.mean)),
      );
      const priorities = contributions.map((c: any) => ({
        id: c.id,
        importance:
          input.importance?.[String(cards)]?.[c.id] ??
          shapleyImportance(c.statistics.mean, maximum),
      }));
      return [
        cards,
        mechanismLossBudget(
          request.hours,
          (1 - auditTarget(request, cards)) * request.hours,
          currentRow(cards).ledger,
          priorities,
        ),
      ];
    }),
  ) as Map<number, ReturnType<typeof mechanismLossBudget>>;
  const target = (id: string) =>
    input.parameterTargets?.[id] ??
    mechanismTargetCatalog.find((p) => p.id === id)!.target;
  const targetSource = (id: string) => {
    const p = mechanismTargetCatalog.find((p) => p.id === id)!;
    return (
      (input.parameterTargets?.[id] !== undefined
        ? "用户参考初值，不锁定反解结果；"
        : "") + p.source
    );
  };
  const factorsFor = (
    model: any,
    policy: any,
    sources: Record<string, string> = {},
  ): Factor[] => {
    const out: Factor[] = [];
    for (const id of selected) {
      const code = codes[id];
      const patch = Object.fromEntries(
        Object.entries(policy[code] ?? {}).filter(
          ([key, value]) => value !== resolved.policy[code]?.[key],
        ),
      );
      if (Object.keys(patch).length)
        out.push({
          id: "tune:" + id,
          mechanism: id,
          code,
          name: names[id] + "参数改进",
          kind: "policy",
          value: patch,
          source: "AGREE预算反解的工程参数；非实测",
          parameterSources: Object.fromEntries(
            Object.keys(patch).map((key) => [
              key,
              input.policy?.[code]?.[key] !== undefined
                ? "用户显式输入的第二轮工程参数，需提供验收证据"
                : (sources[code + "." + key] ?? "平台工程假设，需产品确认"),
            ]),
          ),
        });
    }
    const groups: Record<string, Record<string, number>> = {};
    for (const [key, value] of Object.entries(model)) {
      if (value === resolved.model[key]) continue;
      const group = /^(detect|timeout)/.test(key)
        ? "hardDetect"
        : /^slow/.test(key)
          ? "slowDetect"
          : key === "sdcDelayHours"
            ? "sdcFallback"
            : key === "validationOverhead"
              ? "validation"
              : "recovery";
      (groups[group] ??= {})[key] = value as number;
    }
    for (const [group, patch] of Object.entries(groups))
      out.push({
        id: "tune:base:" + group,
        name: (
          {
            hardDetect: "中断基础检测",
            slowDetect: "亚健康基础检测",
            sdcFallback: "漏检 SDC 兜底复核",
            validation: "新增检测与复核开销",
            recovery: "全局恢复",
          } as Record<string, string>
        )[group],
        kind: "model",
        value: patch,
        source: "第二轮工程目标，独立于现状六项措施",
        parameterSources: Object.fromEntries(
          Object.keys(patch).map((key) => [
            key,
            input.model?.[key] !== undefined
              ? "用户显式输入的第二轮基础参数，需产品验收"
              : (sources["model." + key] ?? "平台工程假设，需产品确认"),
          ]),
        ),
      });
    return out;
  };
  const asExtension = (value: any): Factor => ({
    id: value.id,
    name: auditExtensionCatalog.find((m) => m.id === value.id)!.name,
    kind: "extension",
    value,
    source: value.source,
  });
  const explicitExtensions = input.extensions ?? [];
  const automaticExtensions =
    (input.autoTune ?? true) && (input.exploreExtensions ?? true)
      ? auditExtensionCatalog
          .filter((m) => !explicitExtensions.some((e) => e.id === m.id))

          .map((m) => extensionScenario(m.id))
      : [];
  const candidates: Array<{
    id: string;
    name: string;
    factors: Factor[];
    rows: any[];
    noFaultReference: number;
  }> = [];
  const evaluate = (name: string, factors: Factor[]) => {
    const noFault = simulate(
      primaryCards,
      [
        ...factors,
        {
          id: "reference:no-fault",
          name: "无故障参考",
          kind: "fit",
          value: resolved.events.map((e: any) => ({ id: e.id, fit: 0 })),
          source: "参考计算",
        },
      ],
      seeds.screening.slice(0, 2),
      false,
    );
    const candidate = {
      id: `candidate-${candidates.length + 1}`,
      name,
      factors,
      noFaultReference: noFault.statistics.mean,
      rows: scales.map((n: number) => simulate(n, factors, seeds.screening)),
    };
    candidates.push(candidate);
    onProgress?.(Math.min(0.48, 0.04 + candidates.length * 0.04));
    return candidate;
  };
  // Budgets are the constraints, not a small penalty after availability maximization.
  const burden = (candidate: (typeof candidates)[number]) =>
    candidate.rows.reduce((sum, row) => {
      const plan = planningLossBudgets.get(row.cards)!;
      const pathExcess = plan.items.reduce(
        (s, p) => s + Math.max(0, (row.ledger[p.id] ?? 0) - p.allowedHours),
        0,
      );
      return (
        sum +
        ((row.cards === primaryCards ? 2 : 1) *
          (pathExcess + row.rareMissPlanningMargin * request.hours)) /
          Math.max(1e-12, plan.allowedHours)
      );
    }, 0);
  let chosen = evaluate("保持第一轮现状", []);
  const baselineCandidate = chosen;
  const libraryDecisions: any[] = explicitExtensions.map((e) => ({
    id: e.id,
    name: auditExtensionCatalog.find((m) => m.id === e.id)!.name,
    paths: expertBudgetPaths[e.id],
    selected: true,
    reason: "用户显式选入，参数锁定；仍按分配预算检查与独立复评",
    reference: e.parameters,
  }));
  const explicitModel = { ...resolved.model, ...input.model };
  const explicitPolicy = structuredClone(resolved.policy);
  for (const [code, patch] of Object.entries(input.policy ?? {}))
    Object.assign(explicitPolicy[code], patch);
  const explicitFactors = factorsFor(explicitModel, explicitPolicy);
  if (
    selected.includes("fast") &&
    Object.keys(input.checkpointPeriods ?? {}).length
  )
    explicitFactors.push({
      id: "tune:checkpoint-schedule",
      name: "按规模检查点周期",
      kind: "checkpoint-schedule",
      value: input.checkpointPeriods,
      source: "用户显式指定各规模检查点周期",
    });
  if (explicitFactors.length || explicitExtensions.length)
    chosen = evaluate("用户显式参数与机制", [
      ...explicitFactors,
      ...explicitExtensions.map(asExtension),
    ]);
  const extensionPriority = (id: string) =>
    scales.reduce(
      (total: number, cards: number) =>
        total +
        planningLossBudgets
          .get(cards)!
          .items.filter((p) => expertBudgetPaths[id].includes(p.id))
          .reduce(
            (sum, p) =>
              sum +
              (Math.max(0, p.excessHours) * p.importance) /
                Math.max(1e-12, planningLossBudgets.get(cards)!.allowedHours),
            0,
          ),
      0,
    );
  // One pass in allocation-deficit order; every expert proposal gets a recorded disposition.
  for (const extension of automaticExtensions.sort(
    (a, b) =>
      extensionPriority(b.id) - extensionPriority(a.id) ||
      a.id.localeCompare(b.id),
  )) {
    const paths = expertBudgetPaths[extension.id];
    const scope = auditExtensionCatalog.find((m) => m.id === extension.id)!;
    const active =
      !scope.eventCandidates.length ||
      resolved.events.some(
        (e: any) =>
          e.fit > 0 && scope.eventCandidates.some((id: string) => id === e.id),
      );
    const deficit = chosen.rows.some((row: any) =>
      planningLossBudgets
        .get(row.cards)!
        .items.some(
          (p) =>
            paths.includes(p.id) &&
            ((row.ledger[p.id] ?? 0) > p.allowedHours ||
              (["rollback", "terminalInvalid"].includes(p.id) &&
                row.rareMissPlanningMargin > 0)),
        ),
    );
    const costConflict = scales.some(
      (cards: number) =>
        extension.parameters.overhead * request.hours >
        planningLossBudgets
          .get(cards)!
          .items.find((p) => p.id === "mechanismOverhead")!.allowedHours,
    );
    const precisionConflict =
      ["D-SDC-FP8", "D-SDC-FP4"].includes(extension.id) &&
      extension.parameters.eligibleShare +
        chosen.factors
          .filter((f) => ["D-SDC-FP8", "D-SDC-FP4"].includes(f.id))
          .reduce((sum, f) => sum + f.value.parameters.eligibleShare, 0) >
        1;
    if (
      !active ||
      !deficit ||
      extension.id === "I-CONTAIN" ||
      costConflict ||
      precisionConflict
    ) {
      libraryDecisions.push({
        id: extension.id,
        name: scope.name,
        paths,
        selected: false,
        reason: costConflict
          ? "专家参考正常态成本单项即超过某规模AGREE开销预算；不按零成本纳入，可在产品降低成本后显式复评"
          : precisionConflict
            ? "与已选精度风险份额重叠，不能重复计入"
            : !active
              ? "本次无适用故障"
              : extension.id === "I-CONTAIN"
                ? "隔离是现有弹性路径的前提，不能重复计作新增收益"
                : "对应路径已在AGREE预算内，无新增分配责任",
        reference: extension.parameters,
      });
      continue;
    }
    const before = chosen,
      trial = evaluate("专家单点 / " + scope.name, [
        ...chosen.factors,
        asExtension(extension),
      ]);
    const accepted = burden(trial) + 1e-7 < burden(before);
    libraryDecisions.push({
      id: extension.id,
      name: scope.name,
      paths,
      selected: accepted,
      reason: accepted
        ? "专家参考值降低已分配预算的超额损失，进入参数反解"
        : "在现有组合与成本假设下未降低预算超额，不自动加入",
      reference: extension.parameters,
      beforeBurden: burden(before),
      afterBurden: burden(trial),
      candidateId: trial.id,
    });
    if (accepted) chosen = trial;
  }
  let design: ReturnType<typeof deriveAgreeDesign> | undefined;
  const designIterations: any[] = [];
  if (input.autoTune ?? true) {
    const extensions = chosen.factors
      .filter((f) => f.kind === "extension")
      .map((f) => f.value);
    // Only the planning fraction changes on a failed forward check. Each iteration
    // re-derives parameters from the ORIGINAL frozen allocation, never from verification data.
    for (const utilization of [0.85, 0.65, 0.45]) {
      const proposed = deriveAgreeDesign({
        hours: request.hours,
        scales,
        events: resolved.events,
        model: resolved.model,
        policy: resolved.policy,
        selected,
        recoveryOrder: resolved.recoveryOrder,
        budgets: planningLossBudgets,
        extensions,
        input,
        utilization,
      });
      const factors = [
        ...factorsFor(proposed.model, proposed.policy, proposed.sources),
        ...proposed.extensions.map(asExtension),
      ];
      if (selected.includes("fast"))
        factors.push({
          id: "tune:checkpoint-schedule",
          name: "AGREE回滚预算反解的分规模周期",
          kind: "checkpoint-schedule",
          value: proposed.schedule,
          source:
            "按各规模AGREE回滚子预算与恢复路径到达率反解周期；与保存阻塞联合复评；用户显式周期锁定",
        });
      const trial = evaluate(
        `AGREE分配反解 · 保留${Math.round((1 - utilization) * 100)}%建模余量`,
        factors,
      );
      const feasible = trial.rows.every(
        (row: any) =>
          row.statistics.ciLow - row.rareMissPlanningMargin >=
            auditTarget(request, row.cards) &&
          planningLossBudgets
            .get(row.cards)!
            .items.every(
              (p) => (row.ledger[p.id] ?? 0) <= p.allowedHours + 1e-10,
            ),
      );
      designIterations.push({
        candidateId: trial.id,
        utilization,
        feasible,
        burden: burden(trial),
      });
      if (!design || burden(trial) < burden(chosen) || feasible) {
        chosen = trial;
        design = proposed;
      }
      if (feasible) break;
    }
    // Remove redundant automatic proposals after parameter synthesis only when
    // the same frozen budgets still hold. Explicit choices are always preserved.
    for (const factor of [...chosen.factors].filter(
      (f) =>
        f.kind === "extension" &&
        !explicitExtensions.some((e) => e.id === f.id),
    )) {
      const trial = evaluate(
        "必要性复核 / 移除" + factor.name,
        chosen.factors.filter((f) => f.id !== factor.id),
      );
      if (
        burden(trial) <= burden(chosen) + 1e-10 &&
        trial.rows.every(
          (row: any) =>
            row.statistics.ciLow - row.rareMissPlanningMargin >=
              auditTarget(request, row.cards) &&
            planningLossBudgets
              .get(row.cards)!
              .items.every(
                (p) => (row.ledger[p.id] ?? 0) <= p.allowedHours + 1e-10,
              ),
        )
      ) {
        chosen = trial;
        const decision = libraryDecisions.find((d) => d.id === factor.id);
        if (decision) {
          decision.selected = false;
          decision.reason =
            "参数反解后，移除此项仍满足全部冻结预算和筛选目标，避免冗余叠加";
        }
      }
    }
    if (chosen === baselineCandidate) design = undefined;
  }
  const proposedFits = input.fitTargets ?? request.candidateFitOverrides;
  if (proposedFits?.length) {
    const fitCandidate = evaluate("用户已注明来源的 FIT 方案＋机制参数", [
      ...chosen.factors,
      {
        id: "fit:objects",
        name: "用户显式 FIT 目标",
        kind: "fit",
        value: proposedFits,
        source: "仅采用逐事件记录的用户来源；不是由可用度缺口自动折算",
      },
    ]);
    if (burden(fitCandidate) < burden(chosen)) chosen = fitCandidate;
  }
  const objects = auditObjects(resolved.events);
  const allocations = scales.map((cards: number) => {
    const a = current.attribution.find((row: any) => row.cards === cards),
      positives = (a?.contributions ?? []).map((c: any) =>
        Math.max(0, c.statistics.mean),
      ),
      maximum = Math.max(1e-12, ...positives),
      sum = positives.reduce((s: number, v: number) => s + v, 0),
      gapHours = Math.max(
        0,
        (auditTarget(request, cards) - currentRow(cards).statistics.mean) *
          request.hours,
      );
    const priorities = (a?.contributions ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      contribution: c.statistics.mean,
      suggestedImportance: shapleyImportance(c.statistics.mean, maximum),
      importance:
        input.importance?.[String(cards)]?.[c.id] ??
        shapleyImportance(c.statistics.mean, maximum),
      improvementPriorityHours: sum
        ? (gapHours * Math.max(0, c.statistics.mean)) / sum
        : 0,
      evidence:
        "Shapley-derived engineering suggestion; not conditional system failure probability",
      effect: existingMechanismClasses[c.id]?.effect,
    }));
    const row = chosen.rows.find((r: any) => r.cards === cards)!,
      allowedHours = (1 - auditTarget(request, cards)) * request.hours,
      fixedHours = planningLossBudgets
        .get(cards)!
        .items.filter((i) => ["save", "mechanismOverhead"].includes(i.id))
        .reduce((s, i) => s + i.allowedHours, 0),
      eventBudget = Math.max(0, allowedHours - fixedHours);
    const plan = agreeLossAllocation(
      eventBudget,
      request.hours,
      objects
        .filter((o) => o.fit > 0)
        .map((object) => {
          const related = priorities.filter((p: any) => {
            const scope = current.mechanisms.find(
              (m: any) => m.id === codes[p.id],
            )?.scope;
            return (
              scope &&
              mechanismEventIds(object.events, scope).some(
                (id) => object.events.find((e) => e.id === id)!.fit > 0,
              )
            );
          });
          return {
            id: object.id,
            name: object.name,
            complexity:
              input.complexity?.[object.id] ??
              object.events.filter((e) => e.fit > 0).length,
            importance: related.length
              ? related.reduce((s: number, p: any) => s + p.importance, 0) /
                related.length
              : 0.2,
            actualHours: object.events.reduce(
              (s, e) => s + eventLossHours(row.perEvent[e.id]),
              0,
            ),
          };
        }),
    );
    const actualEventLoss = plan.items.reduce((s, i) => s + i.actualHours, 0),
      samplingMarginHours = Math.max(
        0,
        (row.statistics.mean - row.statistics.ciLow) * request.hours,
      ),
      planningEventLoss = actualEventLoss + samplingMarginHours;
    const responsibilityLoss =
      (1 - currentRow(cards).statistics.mean) * request.hours;
    const mechanismPlan = priorities.length
      ? agreeLossAllocation(
          allowedHours,
          request.hours,
          priorities.map((p: any) => ({
            id: p.id,
            name: p.name,
            importance: p.importance,
            complexity: 1,
            actualHours:
              responsibilityLoss *
              (sum ? Math.max(0, p.contribution) / sum : 1 / priorities.length),
          })),
        )
      : null;
    return {
      cards,
      target: auditTarget(request, cards),
      totalAllowedHours: allowedHours,
      fixedHours,
      samplingMarginHours,
      planningEventLoss,
      fixedExcessHours: Math.max(0, fixedHours - allowedHours),
      gapHours,
      priorities,
      mechanismPlan,
      lossPathPlan: planningLossBudgets.get(cards)!,
      mechanismBudgetBasis:
        "将现状剩余损失按正Shapley份额分成不重叠的设计责任账，再以AGREE分配；不是每项机制的独立物理损失，不能与对象预算相加。",
      ...plan,
      items: plan.items.map((i) => {
        const object = objects.find((o) => o.id === i.id)!;
        return {
          ...i,
          currentFit: object.fit,
          allowedEquivalentSeconds:
            object.fit > 0
              ? (i.allowedHours * 3600) /
                (((cards * object.fit) / 1e9) * request.hours)
              : null,
          basis:
            "保持源 FIT；按对象预算 / 期望故障次数折算每次事件允许的全系统等效损失秒数，含检测、恢复、回滚与污染；不是单项 MTTR，也不是 FIT 降幅。",
        };
      }),
    };
  });
  onProgress?.(0.5);
  const verified = scales.map((cards: number, index: number) => {
    const baseline = simulate(cards, [], seeds.verification),
      improved = simulate(cards, chosen.factors, seeds.verification);
    const fast = chosen.factors.find((f) => f.code === "C-FAST")?.value ?? {};
    const effectiveModel = Object.assign(
      {},
      resolved.model,
      ...chosen.factors.filter((f) => f.kind === "model").map((f) => f.value),
    );
    const schedule = chosen.factors.find(
      (f) => f.kind === "checkpoint-schedule",
    )?.value;
    const allocation = allocations.find((a: any) => a.cards === cards)!;
    onProgress?.(0.5 + (0.15 * (index + 1)) / scales.length);
    return {
      cards,
      target: auditTarget(request, cards),
      current: {
        statistics: baseline.statistics,
        ledger: baseline.ledger,
        perEvent: baseline.perEvent,
      },
      optimized: {
        statistics: improved.statistics,
        ledger: improved.ledger,
        perEvent: improved.perEvent,
      },
      delta: stats(improved.values.map((v, i) => v - baseline.values[i])),
      gap: improved.statistics.mean - auditTarget(request, cards),
      diagnostics: mechanismGapDiagnostics(
        request.hours,
        auditTarget(request, cards),
        improved.ledger,
        improved.perEvent,
        allocation.lossPathPlan,
        !selected.includes("fast")
          ? effectiveModel.checkpointComputeSeconds
          : (schedule?.[String(cards)] ??
              fast.computeSeconds ??
              resolved.policy["C-FAST"].computeSeconds),
        !selected.includes("fast")
          ? effectiveModel.checkpointSaveSeconds
          : (fast.saveSeconds ?? resolved.policy["C-FAST"].saveSeconds),
      ),
      status:
        improved.statistics.ciLow >= auditTarget(request, cards)
          ? "supported"
          : improved.statistics.ciHigh < auditTarget(request, cards)
            ? "below"
            : "uncertain",
    };
  });
  const attribution = scales.map((cards: number, scaleIndex: number) => {
    const factors = chosen.factors,
      cache = new Map<string, number[]>();
    const values = (indexes: number[]) => {
      const key = [...indexes].sort((a, b) => a - b).join(",");
      if (!cache.has(key))
        cache.set(
          key,
          simulate(
            cards,
            indexes.map((i) => factors[i]),
            seeds.attribution,
            false,
          ).values,
        );
      return cache.get(key)!;
    };
    const contributions = factors.map(
      () => Array(attributionTrials).fill(0) as number[],
    );
    let state = (request.seed ^ cards ^ 0x45d9f3b) >>> 0;
    for (let p = 0; p < permutations; p++) {
      const order = factors.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const j = Math.floor((state / 4294967296) * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const indexes: number[] = [];
      let previous = values(indexes);
      for (const index of order) {
        indexes.push(index);
        const next = values(indexes);
        for (let t = 0; t < attributionTrials; t++)
          contributions[index][t] += (next[t] - previous[t]) / permutations;
        previous = next;
      }
      onProgress?.(
        0.65 + (0.35 * (scaleIndex + (p + 1) / permutations)) / scales.length,
      );
    }
    const baseline = stats(values([])),
      combined = stats(values(factors.map((_, i) => i))),
      gain = combined.mean - baseline.mean;
    const rows = factors
      .map((f, i) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        statistics: stats(contributions[i]),
      }))
      .sort((a, b) => b.statistics.mean - a.statistics.mean)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return {
      cards,
      method: "permutation-shapley",
      interpretation:
        "相对第一轮现状的第二轮改进增量；与现状所选措施的组合贡献基准不同",
      permutations,
      trials: attributionTrials,
      coalitionCount: cache.size,
      baseline,
      combined,
      gain,
      contributions: rows,
      residual: rows.reduce((s, r) => s + r.statistics.mean, 0) - gain,
      uncertainty:
        "区间反映固定排列下的轨迹抽样；有限排列也有近似误差。负贡献保留。",
    };
  });
  const recommendedRequest = structuredClone(request);
  recommendedRequest.optimization = {
    ...input,
    autoTune: false,
    allowFitTargets: false,
    extensions: [],
    model: {},
    policy: {},
    fitTargets: [],
    checkpointPeriods: {},
  };
  for (const f of chosen.factors) {
    if (f.kind === "policy")
      recommendedRequest.optimization.policy![f.code!] = f.value;
    if (f.kind === "model")
      Object.assign(recommendedRequest.optimization.model!, f.value);
    if (f.kind === "extension")
      recommendedRequest.optimization.extensions!.push(f.value);
    if (f.kind === "fit") recommendedRequest.optimization.fitTargets = f.value;
    if (f.kind === "checkpoint-schedule")
      recommendedRequest.optimization.checkpointPeriods = f.value;
  }
  onProgress?.(1);
  const fitFactor = chosen.factors.find((f) => f.kind === "fit");
  const targetEvents = resolved.events.map((event: any) => ({
    ...event,
    fit: fitFactor?.value.find((e: any) => e.id === event.id)?.fit ?? event.fit,
  }));
  const optimizedEvents = createEnhancedAuditEngine(
    targetEvents,
    resolved.policy,
    resolved.model,
    chosen.factors.filter((f) => f.kind === "extension").map((f) => f.value),
  ).events;
  return {
    ...basis,
    status: "evaluated",
    reason: `第一轮 ${unmet.length} 个规模尚无充分达标证据，已先完成AGREE预算分配、专家机制筛选与参数反解，再独立复评。`,
    allocations,
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      noFaultReference: c.noFaultReference,
      factorIds: c.factors.map((f) => f.id),
      rows: describe(c.rows),
    })),
    chosenId: chosen.id,
    chosenName: design
      ? `AGREE预算反解方案 · ${Math.round(design.reserveFraction * 100)}%建模余量`
      : chosen.name,
    optimizedEvents,
    design: design
      ? {
          method: design.method,
          reserveFraction: design.reserveFraction,
          envelope: design.envelope.filter(
            (r) =>
              !r.code.startsWith("ext:") ||
              chosen.factors.some((f) => f.id === r.code.slice(4)),
          ),
          perScale: design.perScale.map(
            ({ cards, requirements, componentPlans, routes, utilization }) => ({
              cards,
              requirements,
              componentPlans,
              routes,
              utilization,
            }),
          ),
          iterations: designIterations,
          allocationFrozenBeforeCandidates: true,
          postSynthesisPruning: libraryDecisions
            .filter((d) => d.reason.includes("参数反解后"))
            .map((d) => d.id),
        }
      : null,
    libraryDecisions,
    parameterBounds: mechanismTargetCatalog.map((p) => ({
      ...p,
      target: target(p.id),
      source: targetSource(p.id),
    })),
    legacyFitSearchIgnored: input.allowFitTargets === true,
    configurationHash: createHash("sha256")
      .update(
        JSON.stringify({
          firstRound: current.config.inputHash,
          factors: chosen.factors,
        }),
      )
      .digest("hex"),
    factors: chosen.factors.map((f) => ({
      ...f,
      before:
        f.kind === "policy"
          ? resolved.policy[f.code!]
          : f.kind === "model"
            ? Object.fromEntries(
                Object.keys(f.value).map((key) => [key, resolved.model[key]]),
              )
            : f.kind === "checkpoint-schedule"
              ? Object.fromEntries(
                  scales.map((cards: number) => [
                    cards,
                    resolved.policy["C-FAST"].computeSeconds,
                  ]),
                )
              : f.kind === "fit"
                ? resolved.events.map((e: any) => ({ id: e.id, fit: e.fit }))
                : "现状未部署",
    })),
    scales: verified,
    attribution,
    seeds,
    seedGeneration:
      "sha256-per-purpose-and-index.v2; excludes first-round and cross-purpose collisions",
    recommendedRequest,
    allScalesSupported: verified.every((r: any) => r.status === "supported"),
    primaryStatus: verified.find((r: any) => r.cards === primaryCards)!.status,
    assumptions: [
      "第一轮措施不因第二轮改进而改变；第二轮为工程目标情景，不是已部署性能。",
      "先冻结AGREE物理路径预算，按预算超额逐项筛选专家机制，再用路径到达率反解覆盖、发现、保存、恢复要求。共同参数采用各规模最严格要求，周期可分规模。",
      "AGREE 以现状 Shapley 建议重要度分配允许损失，转换为对象每次事件的等效损失预算；不把损失缺口换算为硬件 FIT 降幅。",
      "已取消自动 FIT 收紧。源 FIT 仅在用户显式提供有来源的事件目标时变化；H-SDC-SCREEN 只降低适用的残余 SDC 风险，专家25%是待验证目标。",
      "99.5% 全系统 SDC 覆盖是用户工程目标。专家 ABFT 的99.5%仅适用于主检测95%且补漏90%的同一子集，不能当成全系统证据，也不自动叠加一次ABFT收益。",
      "完整恢复与检测开销由预算反解，不是专家实测能力；默认不增加周期复核机制，漏检发现时间保持现状，除非用户显式修改。扩展适用比例与成功率等假设须逐项验收。",
      "恢复阶段使用读取、启动、通信三等份预算；图准备属于启动，同段改善取最优适用路径，跨段才相加。阶段拆分需产品实测替换。",
      "扩展适用比例和成功率必须显式输入；FP8/FP4风险份额互斥，ABFT针对上游漏检的条件覆盖。",
      "异步检查点采用期望阻塞预算与保守持久化滞后；正常态开销单独记账，未持久化副本不作回滚起点。",
      "AGREE 预算不是物理参数的唯一逆解；采用显式的期望损失近似反解参数，并预留建模余量；超出专家参考值的是待论证工程要求，未达标继续显示缺口，不通过无依据降 FIT 制造达标结果。",
      "独立验证使用与第一轮、候选筛选及归因均不重叠的种子；区间不包含输入参数和模型误差。",
      "筛选排序用残余SDC率×漏检概率×有限窗口暴露时长作为保守提示，补足小样本未见漏检的乐观误差；会忽略其他故障清除污染等作用，不能当作精确损失或达标证据。正式结论只用独立仿真。",
    ],
  };
}

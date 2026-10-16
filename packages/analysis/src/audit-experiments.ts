import {
  auditArchitectureDiagnosis,
  architectureReviewChecks,
} from "./audit-architecture";
import { createHash } from "node:crypto";
import { validateOptimization } from "./audit-optimization";
import { resolveAudit, type AuditRequest } from "./audit";
import { createEnhancedAuditEngine } from "./audit-enhanced-engine";
import {
  optimizationSampling,
  type AuditOptimizationRequest,
} from "../../contracts/src/audit-optimization";
import { auditExtensionCatalog } from "../../contracts/src/audit-extensions";
import { auditReferenceOnly } from "../../contracts/src/audit-presets";
import { summarize } from "../../solvers/src/statistics";
import { hash } from "../../assets/src/hash";

export type AuditSource = {
  id: string;
  inputHash: string;
  createdAt: string;
  input: AuditRequest;
  result: any;
};
export type AuditExperimentInput = {
  source: AuditSource;
  name: string;
  configuration: AuditOptimizationRequest;
  plan?: { id: string; inputHash: string; result: any };
};
export const mechanismCodes: Record<string, string> = {
  hardDetect: "D-HARD",
  slowDetect: "D-SLOW",
  sdcDetect: "D-SDC",
  step: "R-SDC",
  replay: "R-REPLAY",
  process: "R-PROCESS",
  elastic: "R-ELASTIC",
  fast: "C-FAST",
};
export const mechanismNames: Record<string, string> = {
  hardDetect: "中断检测",
  slowDetect: "亚健康检测",
  sdcDetect: "静默检出覆盖与时延",
  step: "干净step恢复",
  replay: "重执行",
  process: "进程重调度",
  elastic: "弹性恢复",
  fast: "检查点保存与周期",
  recovery: "全局恢复",
  detection: "基础检测",
  validation: "新增检测开销",
  checkpoint: "基线检查点",
};
export type ExperimentFactor = {
  id: string;
  name: string;
  kind: "policy" | "model" | "extension" | "schedule" | "fit";
  code?: string;
  value: any;
  before: any;
  source: string;
};
export function experimentFactors(
  source: AuditSource,
  configuration: AuditOptimizationRequest,
): ExperimentFactor[] {
  const resolved = resolveAudit({ ...source.input, optimization: undefined });
  const factors: ExperimentFactor[] = [];
  for (const [code, patch] of Object.entries(configuration.policy ?? {})) {
    const value = Object.fromEntries(
      Object.entries(patch).filter(
        ([key, v]) => v !== resolved.policy[code]?.[key],
      ),
    );
    if (!Object.keys(value).length) continue;
    const mechanism = Object.keys(mechanismCodes).find(
      (id) => mechanismCodes[id] === code,
    );
    factors.push({
      id: "policy:" + code,
      name: mechanismNames[mechanism ?? ""] ?? code,
      code,
      kind: "policy",
      value,
      before: resolved.policy[code],
      source: "第二轮明确输入；相对冻结第一轮改进，需产品验证",
    });
  }
  const groups: Record<string, Record<string, number>> = {};
  for (const [key, value] of Object.entries(configuration.model ?? {})) {
    if (value === resolved.model[key]) continue;
    const group = /^(detect|timeout|slow)/.test(key)
      ? "detection"
      : /^checkpoint/.test(key)
        ? "checkpoint"
        : key === "validationOverhead"
          ? "validation"
          : "recovery";
    (groups[group] ??= {})[key] = value;
  }
  for (const [id, value] of Object.entries(groups))
    factors.push({
      id: "model:" + id,
      name: mechanismNames[id],
      kind: "model",
      value,
      before: Object.fromEntries(
        Object.keys(value).map((key) => [key, resolved.model[key]]),
      ),
      source: "第二轮明确输入的基础能力改进，需产品验证",
    });
  for (const extension of configuration.extensions ?? [])
    factors.push({
      id: extension.id,
      name: auditExtensionCatalog.find((m) => m.id === extension.id)!.name,
      kind: "extension",
      value: extension,
      before: "第一轮未部署",
      source: extension.source,
    });
  if (Object.keys(configuration.checkpointPeriods ?? {}).length)
    factors.push({
      id: "schedule",
      name: "分规模检查点周期",
      kind: "schedule",
      value: configuration.checkpointPeriods,
      before: Object.fromEntries(
        resolved.scales.map((cards) => [
          cards,
          resolved.policy["C-FAST"].computeSeconds,
        ]),
      ),
      source: "用户明确指定各规模周期；不合并为最严要求",
    });
  if (configuration.fitTargets?.length)
    factors.push({
      id: "fit",
      name: "有来源的故障FIT方案",
      kind: "fit",
      value: configuration.fitTargets,
      before: resolved.events,
      source: "用户逐事件提供来源；不由目标缺口自动降低FIT",
    });
  return factors;
}
export function validateExperiment(input: AuditExperimentInput) {
  if (
    !input.source?.id ||
    input.source.result?.kind !== "expert-review-audit" ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 100
  )
    throw new Error("方案需要已完成的第一轮现状与1–100字名称");
  const first = input.source.input;
  const request = {
    ...first,
    optimization: { ...input.configuration, enabled: true, autoTune: false },
  };
  validateOptimization(request);
  resolveAudit({
    ...first,
    optimization: undefined,
    model: { ...first.model, ...input.configuration.model },
    policy: Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(first.policy ?? {}),
          ...Object.keys(input.configuration.policy ?? {}),
        ]),
      ].map((code) => [
        code,
        { ...first.policy?.[code], ...input.configuration.policy?.[code] },
      ]),
    ),
    eventOverrides: [
      ...(first.eventOverrides ?? []).filter(
        (e) => !input.configuration.fitTargets?.some((f) => f.id === e.id),
      ),
      ...(input.configuration.fitTargets ?? []),
    ],
  });
  const { attributionTrials, permutations } = optimizationSampling({
    ...first,
    optimization: input.configuration,
  });
  const count = experimentFactors(input.source, input.configuration).length;
  const cards = first.scales ?? [first.cards];
  const perScale =
    first.trials + attributionTrials * (permutations * (count + 1) + 2);
  const fit = input.source.result.events.reduce(
    (s: number, e: any) => s + e.fit,
    0,
  );
  if (
    perScale * cards.length > 1000000 ||
    (perScale * cards.reduce((s, c) => s + c, 0) * first.hours * fit) / 1e9 >
      450000000
  )
    throw new Error("方案工作量超过上限，请减少采样或候选机制");

  return request;
}
export function experimentSeeds(
  source: AuditSource,
  purpose: string,
  count: number,
) {
  const first = source.input;
  const excluded = new Set<number>();
  for (const [seed, n, offset] of [
    [first.seed, first.trials, 0],
    [first.attributionSeed ?? first.seed, first.attributionTrials ?? 64, 0],
    [first.seed, first.verificationTrials ?? 64, 1000000],
    [
      first.sensitivitySeed ?? first.seed,
      first.sensitivityTrials ?? first.trials,
      0,
    ],
  ])
    for (let i = 0; i < n; i++)
      excluded.add((seed + Math.imul(i + offset + 1, 2654435761)) >>> 0);
  const seeds: number[] = [];
  let index = 0;
  while (seeds.length < count) {
    const seed = createHash("sha256")
      .update(
        `${source.id}:${first.seed}:separate-rounds.v1:${purpose}:${index++}`,
      )
      .digest()
      .readUInt32LE();
    if (!excluded.has(seed)) {
      seeds.push(seed);
      excluded.add(seed);
    }
  }
  return seeds;
}
/** Shared by planning and formal scenario evaluation. No parameter is auto-changed here. */
export function experimentSampler(source: AuditSource) {
  const request = { ...source.input, optimization: undefined };
  const resolved = resolveAudit(request);
  const selected = [
    ...new Set([...resolved.baseline.mechanisms, ...resolved.mechanisms]),
  ];
  return (
    cards: number,
    factors: ExperimentFactor[],
    seeds: number[],
    collect = true,
  ) => {
    const model = { ...resolved.model },
      policy = structuredClone(resolved.policy);
    const extensions: any[] = [];
    let events = resolved.events;
    for (const factor of [...factors].sort(
      (a, b) =>
        Number(a.kind === "schedule") - Number(b.kind === "schedule") ||
        a.id.localeCompare(b.id),
    )) {
      if (factor.kind === "model") Object.assign(model, factor.value);
      if (factor.kind === "policy")
        Object.assign(policy[factor.code!], factor.value);
      if (factor.kind === "extension") extensions.push(factor.value);
      if (
        factor.kind === "schedule" &&
        factor.value[String(cards)] !== undefined
      )
        policy["C-FAST"].computeSeconds = factor.value[String(cards)];
      if (factor.kind === "fit")
        events = events.map((e) => ({
          ...e,
          fit: factor.value.find((f: any) => f.id === e.id)?.fit ?? e.fit,
        }));
    }
    const engine = createEnhancedAuditEngine(events, policy, model, extensions);
    const opts = {
      ...Object.fromEntries(selected.map((id) => [id, true])),
      recoveryOrder: resolved.recoveryOrder,
    };
    const parameters = engine.parameters(opts);
    const values: number[] = [],
      ledger: Record<string, number> = {},
      perEvent: Record<string, any> = {};
    for (const seed of seeds) {
      const result = engine.simulate(cards, 2, seed, parameters, opts);
      values.push(result.usefulThroughput);
      if (collect) {
        for (const [key, value] of Object.entries(result.ledger))
          ledger[key] = (ledger[key] ?? 0) + Number(value) / seeds.length;
        for (const [id, row] of Object.entries(result.perEvent)) {
          perEvent[id] ??= {};
          for (const [key, value] of Object.entries(row as any))
            perEvent[id][key] =
              (perEvent[id][key] ?? 0) + Number(value) / seeds.length;
        }
      }
    }
    const target =
      cards === request.cards
        ? request.target
        : (request.targets?.[String(cards)] ?? request.target);
    const statistics = summarize(
      values,
      target,
      request.confidenceMethod ?? "student-t",
    );
    return {
      cards,
      statistics,
      values,
      ledger,
      perEvent,
      target,
      referenceOnly: auditReferenceOnly(request, cards),
      status:
        statistics.ciLow >= target
          ? "supported"
          : statistics.ciHigh < target
            ? "below"
            : "uncertain",
    };
  };
}
export function auditExperiment(
  input: AuditExperimentInput,
  onProgress?: (fraction: number) => void,
) {
  validateExperiment(input);
  const { source, name, configuration } = input;
  const factors = experimentFactors(source, configuration).map((factor) => ({
      ...factor,
      source: input.plan
        ? `AGREE分配运行${input.plan.id}；` +
          (input.plan.result.factors.find((f: any) => f.id === factor.id)
            ?.source ?? factor.source) +
          (JSON.stringify(input.plan.result.configuration) ===
          JSON.stringify(configuration)
            ? "；按建议原样执行"
            : "；本次可能包含用户进一步调整，以实际参数快照为准")
        : factor.source,
    })),
    sample = experimentSampler(source);
  const resolved = resolveAudit({ ...source.input, optimization: undefined });
  const seeds = experimentSeeds(source, "evaluation", source.input.trials);
  const rows = resolved.scales.map((cards, i) => {
    const { values: _values, ...row } = sample(cards, factors, seeds);
    onProgress?.((0.5 * (i + 1)) / resolved.scales.length);
    return row;
  });
  const { attributionTrials, permutations } = optimizationSampling({
    ...source.input,
    optimization: configuration,
  });
  const attributionSeeds = experimentSeeds(
    source,
    "attribution",
    attributionTrials,
  );
  const attribution = resolved.scales
    .filter((cards) => !auditReferenceOnly(source.input, cards))
    .map((cards, scaleIndex, scales) => {
      const cache = new Map<string, number[]>();
      const values = (indexes: number[]) => {
        const key = [...indexes].sort((a, b) => a - b).join(",");
        if (!cache.has(key))
          cache.set(
            key,
            sample(
              cards,
              indexes.map((i) => factors[i]),
              attributionSeeds,
              false,
            ).values,
          );
        return cache.get(key)!;
      };
      const contributions = factors.map(
        () => Array(attributionTrials).fill(0) as number[],
      );
      let state = source.input.seed ^ cards;
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
          0.5 + (0.5 * (scaleIndex + (p + 1) / permutations)) / scales.length,
        );
      }
      const stats = (v: number[]) =>
        summarize(v, 0, source.input.confidenceMethod ?? "student-t");
      const baseline = values([]),
        combined = values(factors.map((_, i) => i));
      const totalGain = combined.reduce(
        (s, v, i) => s + (v - baseline[i]) / attributionTrials,
        0,
      );
      const ranked = factors
        .map((f, i) => ({
          id: f.id,
          name: f.name,
          statistics: stats(contributions[i]),
        }))
        .sort((a, b) => b.statistics.mean - a.statistics.mean);
      return {
        cards,
        contributions: ranked.map((c, i) => ({ ...c, rank: i + 1 })),
        baseline: stats(baseline),
        combined: stats(combined),
        gain: totalGain,
        residual: ranked.reduce((s, c) => s + c.statistics.mean, 0) - totalGain,
        permutations,
        trials: attributionTrials,
        basis:
          "相对冻结第一轮的改进增量；与现状候选措施相对固定基线的贡献基准不同",
      };
    });
  onProgress?.(1);
  const result = {
    kind: "expert-audit-experiment",
    selection: source.result.selection,
    round: "scenario",
    name,
    metricId: "training.retained-clean-progress",
    modelVersion: "separate-rounds.v1",
    sourceRunId: source.id,
    sourceInputHash: source.inputHash,
    planningRunId: input.plan?.id,
    planningCards:input.plan?.result.prediction.cards,
    request: source.input,
    configuration: structuredClone(configuration),
    configurationHash: hash(configuration),
    factors,
    rows,
    attribution,
    seeds: { evaluation: seeds, attribution: attributionSeeds },
    baseline: {
      rows: source.result.rows.filter((r: any) => r.id === "combined"),
      attribution: source.result.attribution,
      policy: source.result.config.policy,
      model: source.result.config.model,
    },
    decision: rows.find(
      (r) =>
        r.cards === (input.plan?.result.prediction.cards ?? source.input.cards),
    )!,
    assumptions: [
      "仅计算本次明确输入的方案；参数不会自动收紧或替换。",
      "第一轮为真实现状参数的模型评估，并非现场实测；各轮结果独立保存。",
      "各改进方案复用相同评估种子以便比较，规划、第一轮及增量归因另用种子；置信区间仅含抽样误差。",
      "达标按总可用度的区间下限判断，不要求每个损失子预算独立达标，也不合并各规模最严参数。",
    ],
  };
  // FIT edits and screening affect this scenario's diagnostic rates, never the frozen source.
  const scenarioEvents = resolved.events.map((event) => {
    const patch = configuration.fitTargets?.find((p) => p.id === event.id);
    const screen = configuration.extensions?.find(
      (m) => m.id === "H-SDC-SCREEN",
    );
    const eligible = (
      auditExtensionCatalog.find((m) => m.id === "H-SDC-SCREEN")!
        .eventCandidates as string[]
    ).includes(event.id);
    const fit = patch?.fit ?? event.fit;
    return {
      ...event,
      ...(patch ?? {}),
      ...(screen && eligible
        ? {
            source:
              (patch?.source ?? event.source) +
              "；残余事件率按H-SDC-SCREEN情景折算：" +
              screen.source,
            evidence: "scenario",
            note: "本轮筛查情景的残余FIT；不是修改第一轮源FIT或新增实测数据",
          }
        : {}),
      fit:
        screen && eligible
          ? fit *
            (1 -
              screen.parameters.eligibleShare *
                screen.parameters.success *
                screen.parameters.reduction)
          : fit,
    };
  });
  const architectureDiagnosis = auditArchitectureDiagnosis({
    ...result,
    events: scenarioEvents,
  });
  return {
    ...result,
    events: scenarioEvents,
    architectureDiagnosis,
    reviewChecks: architectureReviewChecks(architectureDiagnosis),
  };
}

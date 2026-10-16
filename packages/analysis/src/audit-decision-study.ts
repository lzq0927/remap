import {
  experimentFactors,
  experimentSampler,
  experimentSeeds,
  type AuditSource,
  type ExperimentFactor,
} from "./audit-experiments";
import type { AuditOptimizationRequest } from "../../contracts/src/audit-optimization";
import {
  boundPlanningConfiguration,
  conservativeConfiguration,
  planningParameterCatalog,
} from "./audit-planning-bounds";
import {
  auditSummaryScales,
  auditReferenceOnly,
} from "../../contracts/src/audit-presets";
import { auditExtensionCatalog } from "../../contracts/src/audit-extensions";

export function factorConfiguration(
  factors: ExperimentFactor[],
): AuditOptimizationRequest {
  const c: AuditOptimizationRequest = {
    enabled: true,
    autoTune: false,
    model: {},
    policy: {},
    extensions: [],
  };
  for (const f of factors) {
    if (f.kind === "model") Object.assign(c.model!, f.value);
    if (f.kind === "policy") c.policy![f.code!] = structuredClone(f.value);
    if (f.kind === "extension") c.extensions!.push(structuredClone(f.value));
    if (f.kind === "schedule") c.checkpointPeriods = structuredClone(f.value);
    if (f.kind === "fit") c.fitTargets = structuredClone(f.value);
  }
  return c;
}
const keyOf = (c: AuditOptimizationRequest) =>
  JSON.stringify(c, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const compact = (row: any) => ({
  cards: row.cards,
  target: row.target,
  statistics: row.statistics,
  ledger: row.ledger,
});
/** Bounded, deterministic candidate comparison on the same physical engine and planning seeds. */
export function completeDecisionStudy(
  source: AuditSource,
  options: AuditOptimizationRequest,
  guided: any,
  onProgress?: (f: number) => void,
) {
  const o = options.planning ?? {},
    primary = guided.prediction.cards,
    target = guided.prediction.target;
  const seeds = experimentSeeds(
    source,
    "decision-study",
    Math.min(32, options.screeningTrials ?? 128),
  );
  const sample = experimentSampler(source);
  const factors = experimentFactors(source, guided.configuration);
  const max = o.maxCandidates ?? 32,
    candidates: any[] = [],
    cache = new Map<string, any>();
  const nominalBase = boundPlanningConfiguration(
    source,
    { enabled: true, autoTune: false },
    o,
  );
  const needsStress = o.conservative?.enabled !== false,
    required = o.conservative?.require ?? false;
  const fromFactors = (fs: ExperimentFactor[]) =>
    boundPlanningConfiguration(source, factorConfiguration(fs), o);
  const effortOf = (fs: ExperimentFactor[]) =>
    fs.reduce((sum, f) => sum + (o.effort?.[f.id] ?? 1), 0);
  function evaluate(name: string, configuration: AuditOptimizationRequest) {
    const c = boundPlanningConfiguration(source, configuration, o),
      key = keyOf(c);
    if (cache.has(key)) return cache.get(key);
    if (candidates.length >= max) return undefined;
    const fs = experimentFactors(source, c),
      nominal = compact(sample(primary, fs, seeds));
    const conservative = needsStress
      ? compact(
          sample(
            primary,
            experimentFactors(source, conservativeConfiguration(source, c, o)),
            seeds,
          ),
        )
      : undefined;
    const row = {
      id: "candidate-" + candidates.length,
      name,
      configuration: c,
      effort: effortOf(fs),
      factorIds: fs.map((f) => f.id),
      nominal,
      conservative,
      feasible:
        nominal.statistics.mean >= target &&
        (!required || conservative?.statistics.mean >= target),
    };
    candidates.push(row);
    cache.set(key, row);
    onProgress?.((candidates.length / max) * 0.6);
    return row;
  }
  evaluate("约束内保留现状", nominalBase);
  evaluate("分配引导方案", guided.configuration);
  const exhaustive = factors.length <= 5 && 2 ** factors.length + 2 <= max;
  if (exhaustive) {
    for (let mask = 0; mask < 2 ** factors.length; mask++)
      evaluate(
        "组合 " + mask,
        fromFactors(factors.filter((_f, i) => mask & (1 << i))),
      );
  } else {
    for (const f of factors) evaluate("单项 / " + f.name, fromFactors([f]));
    for (const f of factors)
      evaluate(
        "移除 / " + f.name,
        fromFactors(factors.filter((x) => x.id !== f.id)),
      );
    for (let i = 0; i < factors.length; i++)
      for (let j = i + 1; j < factors.length && candidates.length < max; j++)
        evaluate(
          "双项互补 / " + factors[i].name + "＋" + factors[j].name,
          fromFactors([factors[i], factors[j]]),
        );
  }
  const ordered = [...candidates].sort((a, b) => {
    if (a.feasible !== b.feasible)
      return Number(b.feasible) - Number(a.feasible);
    if (!a.feasible)
      return (
        b.nominal.statistics.mean - a.nominal.statistics.mean ||
        a.effort - b.effort
      );
    return o.objective === "margin"
      ? b.nominal.statistics.mean - a.nominal.statistics.mean ||
          a.effort - b.effort
      : a.effort - b.effort ||
          b.nominal.statistics.mean - a.nominal.statistics.mean;
  });
  let recommended = ordered[0];
  const feasible = candidates.filter((c) => c.feasible);
  const necessary = feasible.length
    ? factors
        .filter((f) => feasible.every((c) => c.factorIds.includes(f.id)))
        .map((f) => f.id)
    : [];
  const pareto = candidates.filter(
    (a) =>
      !candidates.some(
        (b) =>
          b.effort <= a.effort &&
          b.nominal.statistics.mean >= a.nominal.statistics.mean &&
          (b.effort < a.effort ||
            b.nominal.statistics.mean > a.nominal.statistics.mean),
      ),
  );
  const paretoPoints = pareto.map((c) => ({
    id: c.id,
    effort: c.effort,
    mean: c.nominal.statistics.mean,
    conservativeMean: c.conservative?.statistics.mean,
    feasible: c.feasible,
  }));
  const distinct = [
    recommended,
    [...candidates].sort(
      (a, b) =>
        b.nominal.statistics.mean - a.nominal.statistics.mean ||
        a.effort - b.effort,
    )[0],
    [...candidates].sort(
      (a, b) =>
        (b.conservative?.statistics.mean ?? b.nominal.statistics.mean) -
          (a.conservative?.statistics.mean ?? a.nominal.statistics.mean) ||
        a.effort - b.effort,
    )[0],
    ...pareto.sort((a, b) => a.effort - b.effort),
  ];
  const alternatives = [
    ...new Map(distinct.map((c) => [c.id, c])).values(),
  ].slice(0, 3);
  const scales = auditSummaryScales(
    source.input,
    source.result.rows
      .filter(
        (r: any) =>
          r.id === "combined" && !auditReferenceOnly(source.input, r.cards),
      )
      .map((r: any) => r.cards),
  );
  const curveSeeds = experimentSeeds(
    source,
    "decision-refinement",
    Math.min(256, source.input.trials),
  );
  const baselineCurves = scales.map((cards) =>
    compact(sample(cards, [], curveSeeds)),
  );
  for (const [i, c] of alternatives.entries()) {
    c.factors = experimentFactors(source, c.configuration).map((f) => ({
      ...f,
      source:
        guided.factors.find((g: any) => g.id === f.id)?.source ?? f.source,
    }));
    c.label =
      i === 0
        ? "推荐方案"
        : c.id === distinct[1].id
          ? "名义收益备选"
          : c.id === distinct[2].id
            ? "保守情景备选"
            : "工作量备选";
    c.curves = scales.map((cards) =>
      compact(
        sample(cards, experimentFactors(source, c.configuration), curveSeeds),
      ),
    );
    c.conservativeCurves = needsStress
      ? scales.map((cards) =>
          compact(
            sample(
              cards,
              experimentFactors(
                source,
                conservativeConfiguration(source, c.configuration, o),
              ),
              curveSeeds,
            ),
          ),
        )
      : [];
    c.nominal = c.curves.find((r: any) => r.cards === primary);
    c.conservative = c.conservativeCurves.find((r: any) => r.cards === primary);
    c.feasible =
      c.nominal.statistics.mean >= target &&
      (!required || c.conservative?.statistics.mean >= target);
  }
  recommended = [...alternatives].sort(
    (a, b) =>
      Number(b.feasible) - Number(a.feasible) ||
      (a.feasible && o.objective !== "margin" ? a.effort - b.effort : 0) ||
      b.nominal.statistics.mean - a.nominal.statistics.mean,
  )[0];
  for (const a of alternatives)
    a.label =
      a.id === recommended.id
        ? "推荐方案"
        : a.label === "推荐方案"
          ? "工作量备选"
          : a.label;
  const leverGroups = [
    {
      id: "detection",
      name: "仅改善检测",
      test: (f: ExperimentFactor) =>
        f.id === "policy:D-SDC" || f.id === "model:detection",
    },
    {
      id: "recovery",
      name: "仅改善恢复",
      test: (f: ExperimentFactor) =>
        [
          "policy:R-SDC",
          "policy:R-REPLAY",
          "policy:R-PROCESS",
          "policy:R-ELASTIC",
          "model:recovery",
        ].includes(f.id),
    },
    {
      id: "checkpoint",
      name: "仅改善保存与周期",
      test: (f: ExperimentFactor) =>
        f.id === "policy:C-FAST" ||
        f.id === "model:checkpoint" ||
        f.kind === "schedule",
    },
  ];
  const leverDiagnostics = leverGroups.map((g) => {
    const fs = factors.filter(g.test),
      configuration = fromFactors(fs),
      row = compact(
        sample(primary, experimentFactors(source, configuration), seeds),
      );
    return {
      id: g.id,
      name: g.name,
      row,
      configuration,
      gapHours: Math.max(
        0,
        (target - row.statistics.mean) * source.input.hours,
      ),
      status:
        row.statistics.mean >= target
          ? "sample-feasible"
          : "not-found-at-tested-point",
    };
  });
  const contributions =
    source.result.attribution.find((a: any) => a.cards === primary)
      ?.contributions ?? [];
  const maximum = Math.max(
    1e-12,
    ...contributions.map((c: any) => Math.max(0, c.statistics.mean)),
  );
  const main = guided.allocations.find((a: any) => a.cards === primary);
  const weightEvidence = main.items.map((item: any) => {
    const contribution = contributions.find((c: any) => c.id === item.id);
    const E = item.importance;
    const raw = (e: number) =>
      -Math.log1p(
        -(-Math.expm1(
          (-(main.allowedHours / source.input.hours) * item.complexity) /
            main.items.reduce((s: number, i: any) => s + i.complexity, 0),
        )) / e,
      );
    const sensitivity = [Math.max(0.01, E * 0.8), Math.min(1, E * 1.2)].map(
      (e) => {
        try {
          const own = raw(e),
            other = main.items
              .filter((i: any) => i.id !== item.id)
              .reduce(
                (s: number, i: any) =>
                  s +
                  -Math.log1p(
                    -(-Math.expm1(
                      (-(main.allowedHours / source.input.hours) *
                        i.complexity) /
                        main.items.reduce(
                          (t: number, x: any) => t + x.complexity,
                          0,
                        ),
                    )) / i.importance,
                  ),
                0,
              );
          return (main.allowedHours * own) / (own + other || 1);
        } catch {
          return null;
        }
      },
    );
    return {
      id: item.id,
      name: item.name,
      importance: E,
      complexity: item.complexity,
      contribution: item.contribution,
      ci: contribution
        ? [contribution.statistics.ciLow, contribution.statistics.ciHigh]
        : null,
      source:
        options.importance?.[String(primary)]?.[item.id] !== undefined
          ? "本次专家输入"
          : "0.2+0.8×max(0,φ)/max正贡献（下限0.2）；非条件失效概率",
      sensitivity: sensitivity.map((v) =>
        v !== null && Number.isFinite(v) ? v : null,
      ),
      maximum,
    };
  });
  const selectedFactors = experimentFactors(source, recommended.configuration);
  const constraints = (o.bounds ?? []).map((b) => ({
    ...b,
    ...planningParameterCatalog(source).find((p) => p.path === b.path),
    source: b.source,
    min: b.min,
    max: b.max,
    locked: b.locked,
  }));
  const assumptionGaps = selectedFactors
    .filter((f) => f.kind === "extension" && f.value.evidence === "scenario")
    .map((f) => {
      const def = auditExtensionCatalog.find((m) => m.id === f.id)!;
      return {
        id: f.id,
        name: f.name,
        fields: Object.entries(def.parameters)
          .filter(([_k, p]) => p.value === null)
          .map(([k]) => k),
        source: f.source,
      };
    });
  const study = {
    version: "decision-study.v1",
    settings: structuredClone(o),
    metricId: source.result.metricId,
    planningOnly: true,
    primaryCards: primary,
    target,
    trials: curveSeeds.length,
    selectionTrials: seeds.length,
    objective: o.objective ?? "effort",
    search: {
      method: exhaustive
        ? "enumerated-discrete-pool"
        : "bounded-subset-comparison",
      evaluated: candidates.length,
      limit: max,
      factorIds: factors.map((f) => f.id),
      necessary,
      necessaryScope:
        "仅本次筛选样本的已评估离散组合；不代表所有参数配置中的必要机制",
      globalOptimal: false,
    },
    recommendedId: recommended.id,
    alternatives,
    pareto: paretoPoints,
    paretoBasis: "同一筛选样本的候选前沿；备选曲线另用较大规划样本校准",
    baselineCurves,
    leverDiagnostics,
    weightEvidence,
    constraints,
    assumptionGaps,
    conservative: {
      enabled: needsStress,
      required,
      probabilityDelta: o.conservative?.probabilityDelta ?? 0.005,
      timeFactor: o.conservative?.timeFactor ?? 1.2,
      unknownOverhead: o.conservative?.unknownOverhead ?? 0.001,
      source:
        o.conservative?.source ??
        "可编辑探索压力情景：概率减" +
          (o.conservative?.probabilityDelta ?? 0.005) * 100 +
          "个百分点，时延与开销乘" +
          (o.conservative?.timeFactor ?? 1.2) +
          "；缺失依据的零开销扩展按" +
          (o.conservative?.unknownOverhead ?? 0.001) * 100 +
          "%压力值试算；不是实测分布或统计置信区间",
    },
    feasibility: {
      status: recommended.feasible ? "candidate-found" : "not-found",
      gapHours: Math.max(
        0,
        (target - recommended.nominal.statistics.mean) * source.input.hours,
      ),
      proofOfInfeasibility: false,
      conservativeGapHours: recommended.conservative
        ? Math.max(
            0,
            (target - recommended.conservative.statistics.mean) *
              source.input.hours,
          )
        : null,
    },
    notes: [
      "所有配置使用同一专家引擎及独立规划种子；曲线每条固定配置，各规模保留自己的目标。",
      "工作量缺省每个参数块/扩展措施1分，仅为相对评分；未提供完整成本资料时成本分配不可用。",
      "锁定参数在规划和本次保守情景保持不变；其工程可达性需另行验收。",
      "单类杠杆是所列参数点的试算，不能解释为该类的理论上界。全选不保证最佳；有限搜索未找到不等于证明不可达。",
      "保守情景范围与均值95%采样区间、窗口达标概率分开解释；规划没有产生正式第二轮。",
    ],
  };
  onProgress?.(1);
  return {
    ...guided,
    modelVersion: "bounded-design-decision.v1",
    assumptions: [
      ...(guided.assumptions ?? []).filter(
        (s: string) => !s.startsWith("预留"),
      ),
      "最终候选按各规模目标本身比较；保守情景是否作为额外规划条件由显式设置决定。",
    ],
    configuration: recommended.configuration,
    factors: selectedFactors.map((f) => ({
      ...f,
      source:
        guided.factors.find((g: any) => g.id === f.id)?.source ?? f.source,
    })),
    prediction: {
      ...guided.prediction,
      planningMargin: 0,
      mean: recommended.nominal.statistics.mean,
      supported: recommended.nominal.statistics.mean >= target,
      planningTrials: curveSeeds.length,
      conservativeMean: recommended.conservative?.statistics.mean,
    },
    decisionStudy: study,
  };
}

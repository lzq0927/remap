import type { CoreModel } from "./model";
import {
  applyMeasures,
  assess,
  type Assessment,
  type ResolvedParameters,
} from "./assess";
import { allocate, type AllocationResult } from "./allocate";

export const verificationLimits = {
  minTrials: 100,
  maxTrials: 20000,
  /** 一次验证（现状与设计后两次仿真合计）允许模拟的故障事件数上限。 */
  maxEvents: 2e7,
};

/** 一次验证预计要模拟的故障事件数，用于在运行前拒绝过大的仿真。 */
export function expectedSimulationEvents(model: CoreModel, trials: number) {
  const perWindow = (parameters: ResolvedParameters) =>
    assess(model, parameters).system.events;
  return (
    trials *
    (perWindow(applyMeasures(model, new Set())) +
      perWindow(applyMeasures(model)))
  );
}

function mulberry(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulationSummary {
  trials: number;
  seed: number;
  mean: number;
  standardDeviation: number;
  standardError: number;
  /** 均值的 95% 置信区间（正态近似）。 */
  interval: [number, number];
  p05: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  /** 达到目标的窗口比例。 */
  passRatio: number;
  events: number;
  mtbfHours: number;
  mttrHours: number;
  histogram: { from: number; to: number; count: number }[];
  /** 低于直方图左边界、并入最左一箱的窗口数。 */
  histogramTail: number;
  /** 各模块在窗口内的平均损失小时。 */
  moduleLossHours: Record<string, number>;
  overheadLossHours: number;
}

/**
 * 离散事件仿真。与解析评估相互独立：
 * 逐个抽取故障到达（指数间隔）、检出与否（伯努利）和各段时长，
 * 并在窗口末尾截断未完成的恢复。恢复时间取指数分布，回滚重算取均匀分布，
 * 漏检损失取指数分布，因此仿真还给出解析模型没有的窗口间波动。
 * 只有“停机期间不产生新故障”这一条与解析模型相同，它是被建模系统的性质。
 */
export function simulate(
  model: CoreModel,
  parameters: ResolvedParameters,
  trials: number,
  seed: number,
): SimulationSummary {
  const { cards, hours, target } = model.scenario,
    random = mulberry(seed),
    units = new Map(model.modules.map((m) => [m.id, m.unitsPerCard]));
  const modes = parameters.modes
    .map((mode) => ({
      mode,
      module: model.modules.findIndex((m) => m.id === mode.moduleId),
      rate: (mode.fit * (units.get(mode.moduleId) ?? 1) * cards) / 1e9,
    }))
    .filter((entry) => entry.rate > 0);
  const totalRate = modes.reduce((sum, m) => sum + m.rate, 0),
    cumulative: number[] = [];
  modes.reduce((sum, m) => {
    cumulative.push(sum + m.rate);
    return sum + m.rate;
  }, 0);
  const exponential = (mean: number) =>
    mean > 0 ? -Math.log(1 - random()) * mean : 0;
  const samples = new Float64Array(trials),
    moduleLoss = new Float64Array(model.modules.length);
  let events = 0,
    uptimeTotal = 0,
    lossTotal = 0;
  for (let trial = 0; trial < trials; trial++) {
    let clock = 0,
      loss = 0;
    while (totalRate > 0) {
      const gap = exponential(1 / totalRate);
      if (clock + gap >= hours) {
        uptimeTotal += hours - clock;
        break;
      }
      clock += gap;
      uptimeTotal += gap;
      events++;
      const pick = random() * totalRate;
      let index = 0;
      while (index < cumulative.length - 1 && cumulative[index] < pick) index++;
      const { mode, module } = modes[index];
      const duration =
        random() < mode.coverage
          ? mode.detectHours +
            exponential(mode.recoverHours) +
            random() * 2 * mode.reworkHours
          : exponential(mode.missedLossHours);
      // 影响系数小于 1 时按等效停机时间计：受影响的部分停下，其余部分照常运行并可能再出故障。
      const stopped = duration * mode.impact,
        counted = Math.min(stopped, hours - clock);
      loss += counted;
      moduleLoss[module] += counted;
      clock += stopped;
      if (clock >= hours) break;
    }
    if (totalRate === 0) uptimeTotal += hours;
    lossTotal += loss;
    samples[trial] = ((1 - parameters.overhead) * (hours - loss)) / hours;
  }
  const mean = samples.reduce((sum, v) => sum + v, 0) / trials,
    variance =
      trials > 1
        ? samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (trials - 1)
        : 0,
    standardDeviation = Math.sqrt(variance),
    standardError = standardDeviation / Math.sqrt(trials),
    sorted = Float64Array.from(samples).sort();
  const quantile = (q: number) => {
    const position = q * (trials - 1),
      low = Math.floor(position),
      high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
  };
  const min = sorted[0],
    max = sorted[trials - 1],
    bins = 24,
    // 个别窗口会被一次长时间漏检拖得很低；分箱从第 10 百分位起，更低的窗口并入最左一箱。
    floor = quantile(0.1),
    width = (max - floor) / bins || 1e-6;
  const histogram = Array.from({ length: bins }, (_, i) => ({
    from: floor + i * width,
    to: floor + (i + 1) * width,
    count: 0,
  }));
  let histogramTail = 0;
  for (const value of samples) {
    if (value < floor) histogramTail++;
    histogram[
      Math.max(0, Math.min(bins - 1, Math.floor((value - floor) / width)))
    ].count++;
  }
  return {
    trials,
    seed,
    mean,
    standardDeviation,
    standardError,
    interval: [mean - 1.96 * standardError, mean + 1.96 * standardError],
    p05: quantile(0.05),
    p50: quantile(0.5),
    p95: quantile(0.95),
    min,
    max,
    passRatio: samples.reduce((n, v) => n + (v >= target ? 1 : 0), 0) / trials,
    events: events / trials,
    mtbfHours: events > 0 ? uptimeTotal / events : Infinity,
    mttrHours: events > 0 ? lossTotal / events : 0,
    histogram,
    histogramTail,
    moduleLossHours: Object.fromEntries(
      model.modules.map((m, i) => [m.id, moduleLoss[i] / trials]),
    ),
    overheadLossHours:
      (parameters.overhead * (hours * trials - lossTotal)) / trials,
  };
}

export type CheckState = "pass" | "warn" | "fail";
export interface VerificationCheck {
  id: "mean" | "windows" | "consistency" | "modules" | "evidence";
  title: string;
  state: CheckState;
  detail: string;
}
export interface VerificationResult {
  modelHash: string;
  createdAt: string;
  trials: number;
  seed: number;
  target: number;
  analytic: { baseline: number; design: number };
  baseline: SimulationSummary;
  design: SimulationSummary;
  /** 设计后各模块：仿真损失、解析损失与分配预算。 */
  modules: Array<{
    id: string;
    name: string;
    simulatedLossHours: number;
    analyticLossHours: number;
    budgetHours: number;
    withinBudget: boolean;
  }>;
  checks: VerificationCheck[];
  verdict: CheckState;
}

const percent = (value: number, digits = 2) =>
  (value * 100).toFixed(digits) + "%";

/** 模型内容的稳定指纹：用于判断验证结果是否对应当前参数。 */
export function modelHash(model: CoreModel) {
  const stable = (value: unknown): string =>
    Array.isArray(value)
      ? "[" + value.map(stable).join(",") + "]"
      : value && typeof value === "object"
        ? "{" +
          Object.keys(value as object)
            .sort()
            .map(
              (key) =>
                JSON.stringify(key) +
                ":" +
                stable((value as Record<string, unknown>)[key]),
            )
            .join(",") +
          "}"
        : JSON.stringify(value);
  // 名称、说明、出处和架构图画法不影响数值结果，不计入指纹。
  const numeric = {
    scenario: model.scenario,
    modules: model.modules.map(
      ({ note: _note, name: _name, container: _container, ...rest }) => rest,
    ),
    modes: model.modes.map(
      ({ evidence: _evidence, name: _name, ...rest }) => rest,
    ),
    measures: model.measures.map(
      ({ rationale: _rationale, name: _name, source: _source, ...rest }) =>
        rest,
    ),
    allocation: model.allocation,
  };

  let hash = 0x811c9dc5;
  const text = stable(numeric);
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 用独立随机种子对现状和所选设计各做一次仿真，并给出逐项判定。 */
export function verify(
  model: CoreModel,
  options: { trials?: number; seed?: number } = {},
): VerificationResult {
  const trials = Math.round(
      Math.min(
        verificationLimits.maxTrials,
        Math.max(verificationLimits.minTrials, options.trials ?? 2000),
      ),
    ),
    seed = (options.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0,
    target = model.scenario.target;
  const baselineParameters = applyMeasures(model, new Set()),
    designParameters = applyMeasures(model);
  const analyticBaseline: Assessment = assess(model, baselineParameters),
    analyticDesign: Assessment = assess(model, designParameters),
    allocation: AllocationResult = allocate(
      model,
      model.allocation.method,
      analyticBaseline,
    );
  const baseline = simulate(model, baselineParameters, trials, seed),
    // 两次仿真使用不同的随机流，互不复用。
    design = simulate(
      model,
      designParameters,
      trials,
      (seed ^ 0x9e3779b9) >>> 0,
    );
  const modules = analyticDesign.modules.map((module) => {
    const budget = allocation.modules.find((m) => m.id === module.id)!;
    const simulated = design.moduleLossHours[module.id] ?? 0;
    return {
      id: module.id,
      name: module.name,
      simulatedLossHours: simulated,
      analyticLossHours: module.lossHours,
      budgetHours: budget.lossHours,
      withinBudget: simulated <= budget.lossHours * 1.0001,
    };
  });
  const checks: VerificationCheck[] = [];
  checks.push({
    id: "mean",
    title: "平均可用度达到目标",
    state:
      design.interval[0] >= target
        ? "pass"
        : design.mean >= target
          ? "warn"
          : "fail",
    detail:
      `仿真均值 ${percent(design.mean)}，95% 置信区间 ${percent(design.interval[0])}–${percent(design.interval[1])}，目标 ${percent(target)}。` +
      (design.interval[0] >= target
        ? "区间下限高于目标。"
        : design.mean >= target
          ? "均值达标但区间下限低于目标，建议增加仿真次数或留出余量。"
          : "均值低于目标。"),
  });
  const required = model.scenario.passRatio;
  checks.push({
    id: "windows",
    title: "单个窗口的达标比例",
    state: design.passRatio >= required ? "pass" : "fail",
    detail: `${trials} 个仿真窗口中 ${percent(design.passRatio, 1)} 达到目标，要求不低于 ${percent(required, 0)}。第 5 百分位窗口为 ${percent(design.p05)}。`,
  });
  const deviation = design.mean - analyticDesign.system.availability,
    tolerance = Math.max(3 * design.standardError, 0.005);
  checks.push({
    id: "consistency",
    title: "仿真与解析评估一致",
    state: Math.abs(deviation) <= tolerance ? "pass" : "warn",
    detail:
      `解析值 ${percent(analyticDesign.system.availability)}，仿真均值 ${percent(design.mean)}，偏差 ${(deviation * 100).toFixed(2)} 个百分点（容差 ${(tolerance * 100).toFixed(2)}）。` +
      (Math.abs(deviation) <= tolerance
        ? "两种独立方法相互印证。"
        : "偏差超出容差：单次损失接近窗口长度时，窗口截断会使仿真高于稳态解析值。"),
  });
  const exceeded = modules.filter((m) => !m.withinBudget);
  checks.push({
    id: "modules",
    title: "各模块不超出分配预算",
    state: !exceeded.length
      ? "pass"
      : design.interval[0] >= target
        ? "warn"
        : "fail",
    detail: exceeded.length
      ? `超出预算的模块：${exceeded.map((m) => `${m.name}（${m.simulatedLossHours.toFixed(2)} / ${m.budgetHours.toFixed(2)} h）`).join("、")}。` +
        (design.interval[0] >= target
          ? "系统总体达标，可在第一步调整分配或继续改进这些模块。"
          : "")
      : "全部模块的仿真损失都在分配预算之内。",
  });
  const pending = model.measures.filter(
    (m) => m.enabled && m.evidence !== "verified",
  );
  checks.push({
    id: "evidence",
    title: "所选措施有工程证据",
    state: pending.length ? "warn" : "pass",
    detail: pending.length
      ? `${pending.length} 项措施的参数尚未实测：${pending.map((m) => m.name).join("、")}。仿真只证明“参数成立时可以达标”，不证明产品已具备这些能力。`
      : "所选措施均已标记为有实测证据。",
  });
  const verdict: CheckState = checks.some((c) => c.state === "fail")
    ? "fail"
    : checks.some((c) => c.state === "warn")
      ? "warn"
      : "pass";
  return {
    modelHash: modelHash(model),
    createdAt: new Date().toISOString(),
    trials,
    seed,
    target,
    analytic: {
      baseline: analyticBaseline.system.availability,
      design: analyticDesign.system.availability,
    },
    baseline,
    design,
    modules,
    checks,
    verdict,
  };
}

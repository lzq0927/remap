import { recoveryLevels, type CoreModel, type FaultMode } from "./model";
import {
  applyMeasures,
  assess,
  createEvaluator,
  ladderOutcomes,
} from "./assess";

export const studyScales = [1000, 10000, 100000, 200000, 500000];

/** 规模–目标对照中的一个点。 */
export interface TargetPoint {
  cards: number;
  target: number;
}
/**
 * 规模与目标的关系。串联系统的故障次数与规模成正比，所以损失负荷 r = 1/A − 1 也与规模成正比：
 * A(N) = 1 / (1 + k·N)，k 是“每张卡带来的损失负荷”，代表一个可靠性水平。
 * 给定若干（规模，目标）点，先换算成各点的 k，再对规模的对数线性插值；范围之外沿用端点的 k。
 */
export function targetFromCurve(curve: TargetPoint[], cards: number) {
  const points = [...curve]
    .filter((p) => p.cards > 0 && p.target > 0 && p.target < 1)
    .sort((a, b) => a.cards - b.cards);
  if (!points.length) return null;
  const perCard = (p: TargetPoint) => (1 / p.target - 1) / p.cards;
  let k: number;
  if (cards <= points[0].cards) k = perCard(points[0]);
  else if (cards >= points[points.length - 1].cards)
    k = perCard(points[points.length - 1]);
  else {
    const hi = points.findIndex((p) => p.cards >= cards),
      a = points[hi - 1],
      b = points[hi],
      t = Math.log(cards / a.cards) / Math.log(b.cards / a.cards);
    k = perCard(a) + t * (perCard(b) - perCard(a));
  }
  return 1 / (1 + k * cards);
}
/** 每万卡的损失负荷（‰）：把不同规模的目标换算到同一把尺子上。 */
export const loadPerTenThousand = (point: TargetPoint) =>
  ((1 / point.target - 1) / point.cards) * 10000;

/**
 * 某个规模下的系统目标。
 * - 有域级要求时：固定公共开销单独留出，故障损失负荷随卡数线性折算。
 * - 否则：当前规模用场景里的目标，其它规模按“规模—目标”对照换算。
 */
export function targetAtScale(model: CoreModel, cards: number) {
  const r = model.requirements;
  if (!r)
    return cards === model.scenario.cards
      ? model.scenario.target
      : (targetFromCurve(model.scenario.targetCurve, cards) ??
          model.scenario.target);
  const load = (1 - r.overheadBudget) / r.systemTarget - 1;
  if (load < 0) return r.systemTarget; // 开销预算与目标矛盾时由分配结果明确报告。
  return (1 - r.overheadBudget) / (1 + (load * cards) / r.referenceCards);
}
export function modelAtScale(model: CoreModel, cards: number): CoreModel {
  return {
    ...model,
    scenario: { ...model.scenario, cards, target: targetAtScale(model, cards) },
  };
}
export function domainTargetAtScale(
  model: CoreModel,
  target: number,
  cards = model.scenario.cards,
) {
  return (
    1 /
    (1 +
      ((1 / target - 1) * cards) /
        (model.requirements?.referenceCards ?? model.scenario.cards))
  );
}
export function domainModel(
  model: CoreModel,
  moduleIds: string[],
  target = 1,
): CoreModel {
  const selected = new Set(moduleIds);
  return {
    ...model,
    scenario: { ...model.scenario, overhead: 0, target },
    modules: model.modules.filter((m) => selected.has(m.id)),
    modes: model.modes.filter((m) => selected.has(m.moduleId)),
    measures: model.measures.map((m) => ({
      ...m,
      effects: m.effects.filter((e) => e.param !== "overhead"),
    })),
    requirements: undefined,
  };
}
export function requirementResults(model: CoreModel) {
  return (model.requirements?.domains ?? []).map((domain) => {
    const sub = domainModel(model, domain.moduleIds);
    const baseline = assess(sub, applyMeasures(sub, new Set())).system;
    const design = assess(sub).system;
    const target =
      domain.targetAvailability === null
        ? null
        : domainTargetAtScale(model, domain.targetAvailability);
    return {
      ...domain,
      baseline,
      design,
      target,
      referenceBaseline:
        domain.baselineAvailability === null
          ? null
          : domainTargetAtScale(model, domain.baselineAvailability),
      met: target === null || design.availability >= target - 1e-12,
    };
  });
}
/** Fast scalar score only for search; reported availability remains the real system result. */
export function goalEvaluator(model: CoreModel) {
  const system = createEvaluator(model),
    target = targetAtScale(model, model.scenario.cards);
  const domains = (model.requirements?.domains ?? [])
    .filter((d) => d.targetAvailability !== null)
    .map((d) => ({
      value: createEvaluator(domainModel(model, d.moduleIds)),
      target: domainTargetAtScale(model, d.targetAvailability!),
    }));
  return (enabled: ReadonlySet<string>) =>
    Math.min(
      system(enabled) / target,
      ...domains.map((d) => d.value(enabled) / d.target),
    );
}

/** 恢复链的期望耗时：各级“到达概率 × 时间”之和，不含检测与回滚重算，未乘影响系数。 */
const recoveryHours = (mode: FaultMode) =>
  ladderOutcomes(mode).reduce((sum, o) => sum + o.lossHours, 0);
/** 漏检分支的总损失：漏检后发现 + 恢复链 + 回滚重算。 */
const missedHours = (mode: FaultMode) =>
  mode.lateDetectHours +
  ladderOutcomes(mode).reduce((sum, o) => sum + o.lossHours + o.reworkHours, 0);

/**
 * 按责任域的独立现状反求未知的中断恢复时长。只调整中断类故障恢复链上各级的耗时
 * （成功耗时与失败耗时同比例缩放）；故障率、静默故障的检出率与漏检发现时间、
 * 检测时间和回滚重算保持不变。
 */
export function calibrateBaseline(input: CoreModel): CoreModel {
  const model = structuredClone(input),
    r = model.requirements;
  if (!r) return model;
  r.calibration = [];
  const used = new Set<string>();
  for (const domain of r.domains.filter(
    (d) => d.baselineAvailability !== null,
  )) {
    if (domain.moduleIds.some((id) => used.has(id)))
      throw new Error("现状校准范围不能重叠");
    domain.moduleIds.forEach((id) => used.add(id));
    const sub = domainModel(
      modelAtScale(model, r.referenceCards),
      domain.moduleIds,
    );
    const baseline = assess(sub, applyMeasures(sub, new Set()));
    const candidates = model.modes.filter(
      (m) => domain.moduleIds.includes(m.moduleId) && m.kind === "hard",
    );
    const rates = new Map(
      baseline.modules.flatMap((m) => m.modes).map((m) => [m.id, m.rate]),
    );
    const lever = candidates.reduce(
      (sum, m) => sum + (rates.get(m.id) ?? 0) * m.impact * recoveryHours(m),
      0,
    );
    const target = 1 / domain.baselineAvailability! - 1;
    const factor = 1 + (target - baseline.system.load) / lever;
    if (!(factor >= 0) || !Number.isFinite(factor))
      throw new Error(
        `${domain.name}无法只靠未知恢复段校准；已知分支可能超出约束`,
      );
    for (const mode of candidates) {
      const before = recoveryHours(mode),
        missed = missedHours(mode);
      for (const level of recoveryLevels) {
        mode.ladder[level].hours *= factor;
        mode.ladder[level].failHours *= factor;
      }
      if (
        recoveryLevels.some(
          (level) =>
            mode.ladder[level].hours > 8760 ||
            mode.ladder[level].failHours > 8760,
        )
      )
        throw new Error("校准时长超出模型范围");
      r.calibration.push({
        modeId: mode.id,
        beforeRecoveryHours: before,
        afterRecoveryHours: recoveryHours(mode),
        beforeMissedHours: missed,
        afterMissedHours: missedHours(mode),
        source: `${domain.name}单独现状${domain.baselineAvailability! * 100}%约束；按原恢复段比例反求，未作为实测。`,
      });
    }
  }
  model.scenario.target = targetAtScale(model, model.scenario.cards);
  return model;
}

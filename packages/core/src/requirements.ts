import type { CoreModel } from "./model";
import { applyMeasures, assess, createEvaluator } from "./assess";

export const studyScales = [1000, 10000, 100000, 200000, 500000];
/** Keep fixed overhead separate; scale failure loss-load with actual active cards. */
export function targetAtScale(model: CoreModel, cards: number) {
  const r = model.requirements;
  if (!r) return model.scenario.target;
  const load = (1 - r.overheadBudget) / r.systemTarget - 1;
  if (load < 0) return r.systemTarget; // Allocation reports the contradictory overhead budget explicitly.
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

/** Calibrate uncertain hard-fault recovery only. FIT, SDC 90%/48h, detection and rollback stay explicit. */
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
      (sum, m) => sum + (rates.get(m.id) ?? 0) * m.impact * m.recoverHours,
      0,
    );
    const target = 1 / domain.baselineAvailability! - 1;
    const factor = 1 + (target - baseline.system.load) / lever;
    if (!(factor >= 0) || !Number.isFinite(factor))
      throw new Error(
        `${domain.name}无法只靠未知恢复段校准；已知分支可能超出约束`,
      );
    for (const mode of candidates) {
      const before = mode.recoverHours,
        missed = mode.missedLossHours;
      mode.recoverHours *= factor;
      mode.missedLossHours += mode.recoverHours - before;
      if (
        mode.missedLossHours < 0 ||
        mode.recoverHours > 8760 ||
        mode.missedLossHours > 8760
      )
        throw new Error("校准时长超出模型范围");
      r.calibration.push({
        modeId: mode.id,
        beforeRecoveryHours: before,
        afterRecoveryHours: mode.recoverHours,
        beforeMissedHours: missed,
        afterMissedHours: mode.missedLossHours,
        source: `${domain.name}单独现状${domain.baselineAvailability! * 100}%约束；按原恢复段比例反求，未作为实测。`,
      });
    }
  }
  model.scenario.target = targetAtScale(model, model.scenario.cards);
  return model;
}

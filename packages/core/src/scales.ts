import { layerOf, type CoreModel } from "./model";
import { applyMeasures, assess } from "./assess";
import { modelAtScale, studyScales, targetAtScale } from "./requirements";
import { shapley } from "./design";

export function measureScaleStudy(model: CoreModel) {
  // 只看类别不够：同时改故障率和恢复参数的措施不算纯 MTBF 措施。
  const pureMtbfIds = model.measures
    .filter(
      (m) =>
        layerOf(m.category) === "component" &&
        m.effects.length > 0 &&
        m.effects.every((e) => e.param === "fit"),
    )
    .map((m) => m.id);
  const mtbfIds = model.measures
    .filter((m) => m.enabled && pureMtbfIds.includes(m.id))
    .map((m) => m.id);
  const reference = modelAtScale(model, 500000),
    mtbfShapley = shapley(reference, mtbfIds);
  const mtbfBase = assess(
    reference,
    applyMeasures(reference, new Set()),
  ).system;
  const mtbfCombination = assess(
    reference,
    applyMeasures(reference, new Set(mtbfIds)),
  ).system;
  const rows = studyScales.map((cards) => {
    const scaled = modelAtScale(model, cards);
    const base = assess(scaled, applyMeasures(scaled, new Set())).system;
    const combination = assess(scaled).system;
    return {
      cards,
      target: scaled.scenario.target,
      targetLossHours: 168 * (1 - scaled.scenario.target),
      baseline: base.availability,
      baselineLossHours: 168 * (1 - base.availability),
      combination: combination.availability,
      combinationLossHours: 168 * (1 - combination.availability),
      met: combination.availability >= scaled.scenario.target,
    };
  });
  const measures = model.measures
    .map((measure) => ({
      id: measure.id,
      name: measure.name,
      // 组件级措施降低故障频次（MTBF），系统级措施缩短单次损失（MTTR）。
      direction:
        layerOf(measure.category) === "component"
          ? ("mtbf" as const)
          : ("mttr" as const),
      category: measure.category,
      enabled: measure.enabled,
      points: rows.map((row) => {
        const scaled = modelAtScale(model, row.cards),
          baseline = assess(scaled, applyMeasures(scaled, new Set())).system,
          single = assess(
            scaled,
            applyMeasures(scaled, new Set([measure.id])),
          ).system;
        return {
          ...row,
          availability: single.availability,
          lossHours: 168 * (1 - single.availability),
          gainPp: (single.availability - row.baseline) * 100,
          savedHours: 168 * (single.availability - row.baseline),
          // Keep current recovery, detection, rollback, missed branch, overhead AND exposure.
          // This avoided component burden is not the full-system net weekly loss reduction.
          fixedExposureSavedHours: pureMtbfIds.includes(measure.id)
            ? ((baseline.load - single.load) * 168) / (1 + baseline.load)
            : null,
        };
      }),
      mtbfOnlyShapleyPp: mtbfIds.includes(measure.id)
        ? (mtbfShapley.values.get(measure.id) ?? 0) * 100
        : null,
    }))
    .sort(
      (a, b) =>
        b.points.at(-1)!.gainPp - a.points.at(-1)!.gainPp ||
        a.id.localeCompare(b.id),
    );
  return {
    rows,
    measures,
    referenceTarget: targetAtScale(model, 500000),
    mtbfOnly: {
      ids: mtbfIds,
      cards: 500000,
      baseline: mtbfBase.availability,
      availability: mtbfCombination.availability,
      savedHours: 168 * (mtbfCombination.availability - mtbfBase.availability),
      gainPp: 100 * (mtbfCombination.availability - mtbfBase.availability),
      exact: mtbfShapley.exact,
    },
    basis:
      "每条曲线只启用该项，相对同一冻结现状；提升MTBF时，检测、恢复、回滚、漏检与检查点开销均保持现状。曲线及阴影显示整系统净收益。另列现状运行暴露下避免的部件损失；两者因剩余故障暴露增加而不同。MTBF组Shapley仅在降FIT措施内分摊，全方案Shapley另列。",
  };
}
export type MeasureScaleStudy = ReturnType<typeof measureScaleStudy>;

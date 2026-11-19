import type { CoreModel } from "./model";
import { applyMeasures, assess } from "./assess";
import { modelAtScale, studyScales, targetAtScale } from "./requirements";

export function measureScaleStudy(model: CoreModel) {
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
      direction: measure.direction,
      enabled: measure.enabled,
      points: rows.map((row) => {
        const scaled = modelAtScale(model, row.cards),
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
        };
      }),
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
    basis:
      "每条措施曲线只启用该项，相对同一冻结现状；其他候选关闭。单项收益不能相加，组合增益用Shapley另行分摊。",
  };
}
export type MeasureScaleStudy = ReturnType<typeof measureScaleStudy>;

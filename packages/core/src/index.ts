import type { CoreModel } from "./model";
import { applyMeasures, assess } from "./assess";
import { allocate, gaps } from "./allocate";
import { contributions, recommend } from "./design";
import { modelHash } from "./verify";

export * from "./model";
export * from "./defaults";
export * from "./assess";
export * from "./allocate";
export * from "./design";
export * from "./verify";

/** 一次算出四步工作台需要的全部解析结果。 */
export function analyze(model: CoreModel) {
  const baseline = assess(model, applyMeasures(model, new Set())),
    design = assess(model, applyMeasures(model)),
    allocation = allocate(model, model.allocation.method, baseline);
  return {
    hash: modelHash(model),
    baseline,
    design,
    allocation,
    baselineGaps: gaps(baseline, allocation),
    designGaps: gaps(design, allocation),
    contributions: contributions(model),
    recommendation: recommend(model),
  };
}
export type Analysis = ReturnType<typeof analyze>;

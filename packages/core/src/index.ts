import type { CoreModel } from "./model";
import { applyMeasures, assess } from "./assess";
import { allocate, consequences, gaps } from "./allocate";
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
  const baselineParameters = applyMeasures(model, new Set()),
    baseline = assess(model, baselineParameters),
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
    /** 单次故障后果很大的模块（按现状计）。 */
    consequences: consequences(model, baselineParameters),
  };
}
export type Analysis = ReturnType<typeof analyze>;

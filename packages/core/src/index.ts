import type { CoreModel } from "./model";
import { applyMeasures, assess } from "./assess";
import { allocate, gaps } from "./allocate";
import { contributions, recommend } from "./design";
import { modelHash } from "./verify";
import { requirementResults } from "./requirements";

export * from "./model";
export * from "./defaults";
export * from "./assess";
export * from "./allocate";
export * from "./design";
export * from "./verify";
export * from "./requirements";
export * from "./reference-scenario";
export * from "./scales";
export * from "./measure-audit";

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
    requirements: requirementResults(model).map((domain) => ({
      ...domain,
      allocatedTarget:
        1 /
        (1 +
          allocation.modules
            .filter((m) => domain.moduleIds.includes(m.id))
            .reduce((sum, m) => sum + m.load, 0)),
    })),
  };
}
export type Analysis = ReturnType<typeof analyze>;

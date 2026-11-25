import type { CoreModel } from "./model";
import { applyMeasures, assess } from "./assess";
import { allocate, consequences, gaps } from "./allocate";
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
  const baselineParameters = applyMeasures(model, new Set()),
    baseline = assess(model, baselineParameters),
    designParameters = applyMeasures(model),
    design = assess(model, designParameters),
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
    /** 单次故障后果很大的模块（恢复能力按当前设计计）。 */
    consequences: consequences(model, designParameters),
    /** 域级要求：每个责任域单独评估的现状、设计后与目标。 */
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

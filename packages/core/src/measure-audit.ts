import type { CoreModel } from "./model";
import { defaultCoreModel } from "./defaults";

/** Only recognize the six exact legacy library effects; never overwrite edited targets. */
const stageSavings: Record<string, number> = {
  "recovery-classify": 64.8,
  "runtime-snapshot": 45,
  "warm-process": 40,
  "hccl-elastic": 45,
  "cann-graph": 22.5,
  "lossless-checkpoint": 20,
};
export function auditLibraryMeasures(model: CoreModel) {
  return model.measures.flatMap((measure) => {
    const seconds = stageSavings[measure.id];
    if (seconds === undefined) return [];
    return measure.effects.flatMap((effect, index) =>
      effect.param === "recoverHours" &&
      effect.op === "set" &&
      Math.abs(effect.value * 3600 - (252 - seconds)) < 1e-8
        ? [{ id: measure.id, name: measure.name, index, seconds }]
        : [],
    );
  });
}

/** Explicit correction creates a new revision; callers retain the old model and verification. */
export function correctLibraryMeasures(model: CoreModel): CoreModel {
  const next = structuredClone(model),
    defaults = defaultCoreModel();
  for (const issue of auditLibraryMeasures(model)) {
    const measure = next.measures.find((m) => m.id === issue.id)!;
    const source = defaults.measures.find((m) => m.id === issue.id)!;
    measure.effects[issue.index] = {
      param: "recoverHours",
      op: "subtract",
      value: issue.seconds / 3600,
    };
    measure.name = source.name;
    measure.rationale = source.rationale;
    measure.source += "；2026-11-19审计：仅扣阶段节省，保留校准恢复残差";
  }
  const elastic = next.measures.find((m) => m.id === "elastic-recover");
  if (elastic?.name === "域级弹性恢复") {
    const source = defaults.measures.find((m) => m.id === elastic.id)!;
    elastic.name = source.name;
    elastic.rationale = source.rationale;
  }
  return next;
}

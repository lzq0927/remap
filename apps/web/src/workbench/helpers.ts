import {
  isRatioParam,
  makeLadder,
  measureParamNames,
  readParam,
  recoveryLevelNames,
  recoveryLevels,
  type CoreModel,
  type FaultMode,
  type Measure,
  type MeasureEffect,
  type MeasureParam,
} from "../../../../packages/core/src/index";
import { duration, fit, percent } from "./format";

export const newId = (prefix: string) =>
  prefix +
  "-" +
  Date.now().toString(36) +
  Math.floor(Math.random() * 1296).toString(36);

/** 删除故障模式后，同步清理引用它的措施。 */
export function dropModes(draft: CoreModel, ids: Set<string>) {
  draft.modes = draft.modes.filter((mode) => !ids.has(mode.id));
  draft.measures = draft.measures
    .map((measure) => ({
      ...measure,
      modeIds: measure.modeIds.filter((id) => !ids.has(id)),
    }))
    .filter(
      (measure) =>
        measure.modeIds.length > 0 ||
        measure.effects.every((effect) => effect.param === "overhead"),
    );
}

/** 删除模块及其故障模式；至少保留一个模块和一个故障模式。 */
export function dropModule(draft: CoreModel, moduleId: string) {
  const modes = new Set(
    draft.modes.filter((m) => m.moduleId === moduleId).map((m) => m.id),
  );
  if (draft.modules.length <= 1 || draft.modes.length - modes.size < 1)
    return false;
  dropModes(draft, modes);
  draft.modules = draft.modules.filter((m) => m.id !== moduleId);
  delete draft.allocation.customWeights[moduleId];
  return true;
}

export const isRatio = isRatioParam;
export const formatParam = (param: MeasureParam, value: number) =>
  param === "fit"
    ? fit(value) + " FIT"
    : isRatio(param)
      ? percent(value)
      : duration(value);

/** 措施完全适用时的目标值，再按适用比例在现值与目标值之间折算。 */
export function applyEffect(effect: MeasureEffect, base: number, share = 1) {
  if (effect.op === "set") return base + share * (effect.value - base);
  if (effect.op === "add") return base + share * effect.value;
  const ratio = share * effect.value;
  return effect.param === "coverage"
    ? 1 - (1 - base) * (1 - ratio)
    : base * (1 - ratio);
}

/** 措施作用对象的现状取值；各模式不同时返回 null。 */
export function baseValue(
  model: CoreModel,
  measure: Measure,
  param: MeasureParam,
) {
  if (param === "overhead") return model.scenario.overhead;
  const values = model.modes
    .filter((mode) => measure.modeIds.includes(mode.id))
    .map((mode) => readParam(mode, param));
  return values.length && values.every((v) => Math.abs(v - values[0]) < 1e-12)
    ? values[0]
    : null;
}

export const effectText = (effect: MeasureEffect) =>
  measureParamNames[effect.param] +
  (effect.op === "reduce"
    ? (effect.param === "coverage" ? " 漏检率降低 " : " 降低 ") +
      percent(effect.value)
    : effect.op === "add"
      ? " 增加 " + formatParam(effect.param, effect.value)
      : " 设为 " + formatParam(effect.param, effect.value));

/** 措施作用范围的简短说明。 */
export function targetText(model: CoreModel, measure: Measure) {
  if (!measure.modeIds.length) return "公共开销";
  if (measure.modeIds.length === model.modes.length) return "全部故障模式";
  const modules = [
    ...new Set(
      model.modes
        .filter((mode) => measure.modeIds.includes(mode.id))
        .map(
          (mode) =>
            model.modules.find((m) => m.id === mode.moduleId)?.name ?? "",
        ),
    ),
  ];
  return modules.length > 3
    ? `${modules.slice(0, 2).join("、")} 等 ${modules.length} 个模块`
    : modules.join("、");
}

/** 新故障模式的默认参数：取默认场景中断类故障的检测与恢复链。 */
export const blankMode = (moduleId: string) => ({
  id: newId("mode"),
  moduleId,
  name: "新故障模式",
  kind: "hard" as const,
  fit: 100,
  coverage: 0.95,
  detectHours: 10 / 3600,
  lateDetectHours: 60 / 3600,
  reworkHours: 300 / 3600,
  ladder: makeLadder({
    restart: { success: 0.99, hours: 600 / 3600, failHours: 600 / 3600 },
    manual: { success: 1, hours: 4 },
  }),
  impact: 1,
  evidence: "",
});
export const blankModule = (groupId: string) => ({
  id: newId("module"),
  groupId,
  name: "新模块",
  unitsPerCard: 1,
  scaling: "per-card" as const,
  fixedTarget: null,
  importance: 1,
  complexity: null,
  anchor: "",
  note: "",
});

/** 恢复链的一行摘要：只列链上的级别及其成功率，最后一级兜底。 */
export const ladderText = (mode: FaultMode) => {
  const used = recoveryLevels.filter(
    (level) => mode.ladder[level].success > 0 || mode.ladder[level].gate,
  );
  return used
    .map(
      (level, index) =>
        recoveryLevelNames[level] +
        (mode.ladder[level].success <= 0
          ? "（不具备）"
          : index === used.length - 1
            ? ""
            : " " + percent(mode.ladder[level].success, 0)),
    )
    .join(" → ");
};

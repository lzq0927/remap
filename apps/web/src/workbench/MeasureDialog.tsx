import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  evidenceStateNames,
  evidenceStates,
  faultKindNames,
  measureParamNames,
  measureParams,
  type EvidenceState,
  type Measure,
  type MeasureDirection,
  type MeasureEffect,
  type MeasureParam,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { isRatio, newId } from "./helpers";
import { Dialog, DurationField, NumberField } from "./ui";

const defaultValue = (param: MeasureParam, op: MeasureEffect["op"]) =>
  op === "reduce"
    ? 0.5
    : op === "add"
      ? isRatio(param)
        ? 0.001
        : param === "fit"
          ? 10
          : 10 / 3600
      : param === "fit"
        ? 100
        : param === "coverage"
          ? 0.99
          : param === "impact"
            ? 0.1
            : param === "overhead"
              ? 0.01
              : 60 / 3600;
const blank = (direction: MeasureDirection): Measure => ({
  id: newId("measure"),
  name: "",
  direction,
  modeIds: [],
  effects: [
    direction === "mtbf"
      ? { param: "fit", op: "reduce", value: 0.5 }
      : { param: "recoverHours", op: "set", value: 60 / 3600 },
  ],
  applicability: 1,
  enabled: true,
  evidence: "assumed",
  rationale: "",
  source: "",
});

/** 新增或编辑一项措施：作用范围、参数变化、适用比例与依据。 */
export default function MeasureDialog({
  measure,
  direction = "mttr",
  onClose,
}: {
  /** 传入则编辑该措施，否则新增。 */
  measure?: Measure;
  direction?: MeasureDirection;
  onClose: () => void;
}) {
  const { model, update } = useWorkbench(),
    [draft, setDraft] = useState<Measure>(() =>
      measure ? structuredClone(measure) : blank(direction),
    );
  const patch = (change: Partial<Measure>) =>
      setDraft((current) => ({ ...current, ...change })),
    patchEffect = (index: number, change: Partial<MeasureEffect>) =>
      patch({
        effects: draft.effects.map((effect, i) =>
          i === index ? { ...effect, ...change } : effect,
        ),
      });
  const needsModes = draft.effects.some((e) => e.param !== "overhead"),
    valid =
      draft.name.trim().length > 0 && (!needsModes || draft.modeIds.length > 0);
  const toggle = (ids: string[], on: boolean) =>
    patch({
      modeIds: on
        ? [...new Set([...draft.modeIds, ...ids])]
        : draft.modeIds.filter((id) => !ids.includes(id)),
    });
  const save = () => {
    const next: Measure = {
      ...draft,
      name: draft.name.trim(),
      modeIds: needsModes ? draft.modeIds : [],
    };
    update((d) => {
      const at = d.measures.findIndex((m) => m.id === next.id);
      if (at >= 0) d.measures[at] = next;
      else d.measures.push(next);
    });
    onClose();
  };

  return (
    <Dialog
      title={measure ? "编辑措施" : "添加措施"}
      onClose={onClose}
      footer={
        <>
          <button className="rw-button" onClick={onClose}>
            取消
          </button>
          <button
            className="rw-button is-primary"
            disabled={!valid}
            onClick={save}
          >
            {measure ? "保存" : "添加并启用"}
          </button>
        </>
      }
    >
      <div className="rw-form">
        <label className="is-wide">
          <span>措施名称</span>
          <input
            aria-label="措施名称"
            autoFocus
            value={draft.name}
            maxLength={80}
            placeholder="例如：电源模块降额设计"
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label>
          <span>改进方向</span>
          <select
            aria-label="改进方向"
            value={draft.direction}
            onChange={(e) =>
              patch({ direction: e.target.value as MeasureDirection })
            }
          >
            <option value="mtbf">提升 MTBF（减少故障）</option>
            <option value="mttr">降低 MTTR（减少单次损失）</option>
          </select>
        </label>
        <label>
          <span>适用比例</span>
          <NumberField
            label="适用比例（%）"
            value={draft.applicability}
            factor={100}
            min={0}
            max={1}
            digits={1}
            suffix="%"
            onCommit={(applicability) => patch({ applicability })}
          />
        </label>
      </div>
      <p className="rw-hint rw-dialog-hint">
        适用比例：所作用的故障中，这项措施实际适用并成功的比例。参数按此比例在现值与目标值之间折算。
      </p>

      <h3 className="rw-dialog-title">参数变化</h3>
      <div className="rw-effect-editor">
        {draft.effects.map((effect, index) => (
          <div key={index} className="rw-effect-row">
            <select
              aria-label={`第 ${index + 1} 项改变的参数`}
              value={effect.param}
              onChange={(e) => {
                const param = e.target.value as MeasureParam;
                patchEffect(index, {
                  param,
                  value: defaultValue(param, effect.op),
                });
              }}
            >
              {measureParams.map((param) => (
                <option key={param} value={param}>
                  {measureParamNames[param]}
                </option>
              ))}
            </select>
            <select
              aria-label={`第 ${index + 1} 项的改变方式`}
              value={effect.op}
              onChange={(e) => {
                const op = e.target.value as MeasureEffect["op"];
                patchEffect(index, {
                  op,
                  value: defaultValue(effect.param, op),
                });
              }}
            >
              <option value="reduce">
                {effect.param === "coverage"
                  ? "漏检率按比例降低"
                  : "按比例降低"}
              </option>
              <option value="set">设为新值</option>
              <option value="add">增加（代价）</option>
            </select>
            {effect.op === "reduce" || isRatio(effect.param) ? (
              <NumberField
                label={`第 ${index + 1} 项的取值`}
                value={effect.value}
                factor={100}
                min={0}
                max={1}
                digits={3}
                suffix="%"
                onCommit={(value) => patchEffect(index, { value })}
              />
            ) : effect.param === "fit" ? (
              <NumberField
                label={`第 ${index + 1} 项的取值`}
                value={effect.value}
                min={0}
                max={1e7}
                digits={2}
                suffix="FIT"
                onCommit={(value) => patchEffect(index, { value })}
              />
            ) : (
              <DurationField
                label={`第 ${index + 1} 项的取值`}
                value={effect.value}
                onCommit={(value) => patchEffect(index, { value })}
              />
            )}
            <button
              className="rw-icon-button"
              aria-label={`删除第 ${index + 1} 项参数变化`}
              disabled={draft.effects.length <= 1}
              onClick={() =>
                patch({ effects: draft.effects.filter((_, i) => i !== index) })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {draft.effects.length < 6 && (
          <button
            className="rw-button"
            onClick={() =>
              patch({
                effects: [
                  ...draft.effects,
                  { param: "reworkHours", op: "set", value: 30 / 3600 },
                ],
              })
            }
          >
            <Plus size={15} aria-hidden />
            再加一项参数变化
          </button>
        )}
      </div>

      {needsModes && (
        <fieldset className="rw-mode-picker">
          <legend>
            作用于哪些故障模式
            <span>
              <button
                type="button"
                className="rw-link"
                onClick={() =>
                  toggle(
                    model.modes.map((m) => m.id),
                    true,
                  )
                }
              >
                全选
              </button>
              {(["hard", "slow", "sdc"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="rw-link"
                  onClick={() =>
                    patch({
                      modeIds: model.modes
                        .filter((m) => m.kind === kind)
                        .map((m) => m.id),
                    })
                  }
                >
                  仅{faultKindNames[kind]}类
                </button>
              ))}
              <button
                type="button"
                className="rw-link"
                onClick={() => patch({ modeIds: [] })}
              >
                清空
              </button>
            </span>
          </legend>
          {model.modules.map((module) => {
            const modes = model.modes.filter((m) => m.moduleId === module.id);
            if (!modes.length) return null;
            return (
              <div key={module.id}>
                <strong>{module.name}</strong>
                {modes.map((mode) => (
                  <label key={mode.id}>
                    <input
                      type="checkbox"
                      checked={draft.modeIds.includes(mode.id)}
                      onChange={(e) => toggle([mode.id], e.target.checked)}
                    />
                    {mode.name}
                    <small>{faultKindNames[mode.kind]}</small>
                  </label>
                ))}
              </div>
            );
          })}
        </fieldset>
      )}

      <h3 className="rw-dialog-title">依据</h3>
      <div className="rw-form">
        <label>
          <span>证据状态</span>
          <select
            aria-label="证据状态"
            value={draft.evidence}
            onChange={(e) =>
              patch({ evidence: e.target.value as EvidenceState })
            }
          >
            {evidenceStates.map((state) => (
              <option key={state} value={state}>
                {evidenceStateNames[state]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>出处</span>
          <input
            aria-label="出处"
            value={draft.source}
            maxLength={120}
            placeholder="例如：机制库编号、试验报告"
            onChange={(e) => patch({ source: e.target.value })}
          />
        </label>
        <label className="is-wide">
          <span>工程依据</span>
          <textarea
            aria-label="工程依据"
            value={draft.rationale}
            maxLength={600}
            rows={3}
            placeholder="这项措施为什么能达到上面的参数；有哪些前提和代价"
            onChange={(e) => patch({ rationale: e.target.value })}
          />
        </label>
      </div>
    </Dialog>
  );
}

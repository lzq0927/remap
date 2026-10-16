import { useState } from "react";
import type { AuditPlanningOptions } from "../../../packages/contracts/src/audit-planning";
import {
  planningMethods,
  planningMethodNames,
} from "../../../packages/contracts/src/audit-planning";
import {
  planningParameterCatalog,
  validatePlanningSource,
} from "../../../packages/analysis/src/audit-planning-bounds";
import { parameterLabels } from "../../../packages/reports/src/audit-labels";
import { auditMechanismCodes } from "../../../packages/contracts/src/audit-mechanism-view";
import { auditExtensionCatalog } from "../../../packages/contracts/src/audit-extensions";

export default function AuditPlanningEditor({
  sourceRun,
  value,
  onChange,
  disabled,
}: {
  sourceRun: any;
  value: AuditPlanningOptions;
  onChange: (v: AuditPlanningOptions) => void;
  disabled: boolean;
}) {
  const source = { ...sourceRun, input: sourceRun.result.request };
  const catalog = planningParameterCatalog(source);
  const [path, setPath] = useState(""),
    [min, setMin] = useState(""),
    [max, setMax] = useState(""),
    [locked, setLocked] = useState(""),
    [origin, setOrigin] = useState(""),
    [error, setError] = useState("");
  const mechanisms = [
    ...(sourceRun.result.attribution[0]?.contributions ?? []),
    { id: "unaddressed", name: "未覆盖设计责任" },
  ];
  const controls = [
    ...auditExtensionCatalog.map((m) => ({ id: m.id, name: m.name })),
    ...mechanisms
      .filter((m) => auditMechanismCodes[m.id])
      .map((m) => ({
        id: "policy:" + auditMechanismCodes[m.id],
        name: m.name,
      })),
    { id: "model:detection", name: "基础检测参数块" },
    { id: "model:recovery", name: "全局恢复参数块" },
    { id: "model:validation", name: "检测开销参数块" },
  ];
  const change = (patch: Partial<AuditPlanningOptions>) =>
    onChange({ ...value, ...patch });
  const stress = value.conservative ?? {};
  const add = () => {
    if (!path || !origin.trim()) {
      setError("请选择参数并填写工程边界依据");
      return;
    }
    const bound = {
      path,
      min: min === "" ? undefined : Number(min),
      max: max === "" ? undefined : Number(max),
      locked: locked === "" ? undefined : Number(locked),
      source: origin.trim(),
    };
    const next = {
      ...value,
      bounds: [...(value.bounds ?? []).filter((b) => b.path !== path), bound],
    };
    try {
      validatePlanningSource(source, next);
      onChange(next);
      setError("");
      setMin("");
      setMax("");
      setLocked("");
      setOrigin("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <details className="planning-editor" aria-label="规划方法与工程边界">
      <summary>规划方法、工程边界与保守情景</summary>
      <style>
        {
          ".planning-editor{min-width:0;margin:14px 0}.planning-editor fieldset{min-width:0}.planning-editor .arch-toggle{display:flex!important;flex-direction:row;align-items:center;gap:8px;margin:10px 0}.planning-editor input[type=checkbox]{width:16px;flex:0 0 16px;margin:0}.planning-editor td input{min-width:80px;max-width:180px}.planning-editor .table-wrap{overflow:auto;max-width:100%}"
        }
      </style>
      <fieldset disabled={disabled}>
        <div className="fields">
          <label>
            责任分配方法
            <select
              aria-label="规划责任分配方法"
              value={value.method ?? "agree"}
              onChange={(e) => change({ method: e.target.value as any })}
            >
              {planningMethods.map((m) => (
                <option key={m} value={m}>
                  {planningMethodNames[m]}
                </option>
              ))}
            </select>
          </label>
          <label>
            方案偏好
            <select
              aria-label="规划方案偏好"
              value={value.objective ?? "effort"}
              onChange={(e) => change({ objective: e.target.value as any })}
            >
              <option value="effort">优先较低工作量</option>
              <option value="margin">优先较大名义余量</option>
            </select>
          </label>
          <label>
            最多比较组合
            <input
              aria-label="规划组合上限"
              type="number"
              min="8"
              max="64"
              value={value.maxCandidates ?? 32}
              onChange={(e) =>
                change({ maxCandidates: Number(e.target.value) })
              }
            />
          </label>
          <label>
            保守情景概率减量（百分点）
            <input
              aria-label="保守概率减量"
              type="number"
              min="0"
              max="20"
              step=".1"
              value={(stress.probabilityDelta ?? 0.005) * 100}
              onChange={(e) =>
                change({
                  conservative: {
                    ...stress,
                    probabilityDelta: Number(e.target.value) / 100,
                  },
                })
              }
            />
          </label>
          <label>
            时延与开销倍数
            <input
              aria-label="保守时间倍数"
              type="number"
              min="1"
              max="3"
              step=".1"
              value={stress.timeFactor ?? 1.2}
              onChange={(e) =>
                change({
                  conservative: {
                    ...stress,
                    timeFactor: Number(e.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            保守情景依据
            <input
              aria-label="保守情景依据"
              value={stress.source ?? ""}
              placeholder="未填时标注为探索压力情景"
              onChange={(e) =>
                change({
                  conservative: {
                    ...stress,
                    source: e.target.value || undefined,
                  },
                })
              }
            />
          </label>
        </div>
        <label className="arch-toggle">
          <input
            type="checkbox"
            checked={stress.enabled !== false}
            onChange={(e) =>
              change({
                conservative: {
                  ...stress,
                  enabled: e.target.checked,
                  require: e.target.checked ? stress.require : false,
                },
              })
            }
          />
          比较保守参数情景
        </label>
        <label className="arch-toggle">
          <input
            type="checkbox"
            checked={stress.require ?? false}
            disabled={stress.enabled === false}
            onChange={(e) =>
              change({ conservative: { ...stress, require: e.target.checked } })
            }
          />
          建议也须满足保守情景（额外规划偏好）
        </label>
        <p className="note">
          本页分配工程责任小时。经典任务可靠度与串联可用度在独立子模型中使用。压力情景不是统计置信区间，正式改进评估仍需单独启动。
        </p>
        <details>
          <summary>能力边界与参数锁定</summary>
          <div className="fields">
            <label>
              约束参数
              <select
                aria-label="工程边界参数"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              >
                <option value="">选择参数</option>
                {catalog.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path} ·{" "}
                    {parameterLabels[p.path.split(".").at(-1)!] ?? p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              工程下限
              <input
                aria-label="工程下限"
                type="number"
                step="any"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
            </label>
            <label>
              工程上限
              <input
                aria-label="工程上限"
                type="number"
                step="any"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            </label>
            <label>
              锁定值（可选）
              <input
                aria-label="工程锁定值"
                type="number"
                step="any"
                value={locked}
                onChange={(e) => setLocked(e.target.value)}
              />
            </label>
            <label>
              依据
              <input
                aria-label="工程边界依据"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="实测、专家参考或待论证工程要求"
              />
            </label>
          </div>
          <button type="button" onClick={add}>
            加入工程边界
          </button>
          {error && <p role="alert">{error}</p>}
          <p className="note">
            概率使用0～1，时间沿用参数标注的秒或小时；锁定值不参与自动松弛。设置扩展措施边界不会自动部署该措施。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>参数</th>
                  <th>下限</th>
                  <th>上限</th>
                  <th>锁定</th>
                  <th>依据</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {value.bounds?.map((b) => (
                  <tr key={b.path}>
                    <td>{b.path}</td>
                    <td>{b.min ?? "—"}</td>
                    <td>{b.max ?? "—"}</td>
                    <td>{b.locked ?? "—"}</td>
                    <td>{b.source}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          change({
                            bounds: value.bounds?.filter(
                              (x) => x.path !== b.path,
                            ),
                          })
                        }
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details>
          <summary>复杂度、可改进性与成本资料</summary>
          <p className="note">
            复杂度不是自动推断的模块数量；难以改善的责任可设置较高可改进性权重。成本曲线仅在每项资料及来源完整时可用，缺省评分不代表实际价格。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>责任</th>
                  <th>复杂度</th>
                  <th>可改进性权重</th>
                  <th>成本a</th>
                  <th>成本b</th>
                  <th>成本来源</th>
                </tr>
              </thead>
              <tbody>
                {mechanisms.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    {(["complexity", "feasibility"] as const).map((k) => (
                      <td key={k}>
                        <input
                          aria-label={k + " " + m.id}
                          type="number"
                          min=".01"
                          step=".1"
                          value={value[k]?.[m.id] ?? 1}
                          onChange={(e) =>
                            change({
                              [k]: {
                                ...value[k],
                                [m.id]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </td>
                    ))}
                    {(["a", "b"] as const).map((k) => (
                      <td key={k}>
                        <input
                          aria-label={"成本" + k + " " + m.id}
                          type="number"
                          min=".01"
                          step=".1"
                          value={value.costs?.[m.id]?.[k] ?? ""}
                          onChange={(e) =>
                            change({
                              costs: {
                                ...value.costs,
                                [m.id]: {
                                  a: 1,
                                  b: 1,
                                  source: "本次工程成本假设",
                                  ...value.costs?.[m.id],
                                  [k]: Number(e.target.value),
                                },
                              },
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <input
                        aria-label={"成本来源 " + m.id}
                        value={value.costs?.[m.id]?.source ?? ""}
                        onChange={(e) =>
                          change({
                            costs: {
                              ...value.costs,
                              [m.id]: {
                                a: 1,
                                b: 1,
                                ...value.costs?.[m.id],
                                source: e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details>
          <summary>措施工作量评分</summary>
          <p className="note">
            每个改善参数块缺省1分；评分用于本次候选之间的相对比较。
          </p>
          <div className="fields">
            {controls.map((m) => (
              <label key={m.id}>
                {m.name}
                <input
                  aria-label={"工作量 " + m.id}
                  type="number"
                  min=".01"
                  step=".1"
                  value={value.effort?.[m.id] ?? 1}
                  onChange={(e) =>
                    change({
                      effort: {
                        ...value.effort,
                        [m.id]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <details>
          <summary>固定责任与损失预算边界（小时）</summary>
          <p className="note">
            固定责任先从总预算中扣除；每个规模分别检查可行性。它是设计预算，不修改第一轮损失。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>责任</th>
                  <th>最低允许损失</th>
                  <th>最高允许损失</th>
                  <th>固定预算</th>
                  <th>依据</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {mechanisms.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    {(["min", "max", "locked"] as const).map((k) => (
                      <td key={k}>
                        <input
                          aria-label={"责任" + k + " " + m.id}
                          type="number"
                          min="0"
                          step="any"
                          value={value.budgetBounds?.[m.id]?.[k] ?? ""}
                          onChange={(e) =>
                            change({
                              budgetBounds: {
                                ...value.budgetBounds,
                                [m.id]: {
                                  ...value.budgetBounds?.[m.id],
                                  source:
                                    value.budgetBounds?.[m.id]?.source ??
                                    "本次工程责任预算假设",
                                  [k]:
                                    e.target.value === ""
                                      ? undefined
                                      : Number(e.target.value),
                                },
                              },
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <input
                        aria-label={"责任来源 " + m.id}
                        value={value.budgetBounds?.[m.id]?.source ?? ""}
                        onChange={(e) =>
                          change({
                            budgetBounds: {
                              ...value.budgetBounds,
                              [m.id]: {
                                ...value.budgetBounds?.[m.id],
                                source: e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          const rest = { ...value.budgetBounds };
                          delete rest[m.id];
                          change({ budgetBounds: rest });
                        }}
                      >
                        清除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </fieldset>
    </details>
  );
}

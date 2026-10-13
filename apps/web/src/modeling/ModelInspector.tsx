import { useState } from "react";
import type { EngineeringModel } from "../../../../packages/modeling/src/schema";
import { labels, uid, type ModelEdit } from "./shared";

export default function ModelInspector({
  model,
  edit,
  selected,
  onSelect,
}: {
  model: EngineeringModel;
  edit: ModelEdit;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [deleteMode, setDeleteMode] = useState(false),
    [relationTarget, setRelationTarget] = useState(""),
    [kind, setKind] =
      useState<EngineeringModel["relations"][number]["kind"]>("dependsOn");
  const entity = model.entities.find((e) => e.id === selected);
  const add = () => {
    const id = uid("component");
    edit((d) => {
      d.entities.push({
        id,
        name: "新部件",
        kind: "component",
        description: "",
        sourceRefs: [],
      });
      d.views.forEach((v) => {
        if (v.entityRefs.length) v.entityRefs.push(id);
      });
    });
    onSelect(id);
  };
  return (
    <aside className="eng-inspector">
      <div className="section-head">
        <h3>对象与属性</h3>
        <button onClick={add}>添加对象</button>
      </div>
      <label>
        当前对象
        <select
          aria-label="当前对象"
          value={selected}
          onChange={(e) => {
            onSelect(e.target.value);
            setDeleteMode(false);
          }}
        >
          <option value="">选择对象</option>
          {model.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {entity ? (
        <>
          <label>
            对象名称
            <input
              value={entity.name}
              onChange={(e) =>
                edit((d) => {
                  d.entities.find((x) => x.id === selected)!.name =
                    e.target.value;
                })
              }
            />
          </label>
          <label>
            对象类型
            <select
              value={entity.kind}
              onChange={(e) =>
                edit((d) => {
                  d.entities.find((x) => x.id === selected)!.kind = e.target
                    .value as typeof entity.kind;
                })
              }
            >
              {[
                "system",
                "component",
                "service",
                "instance",
                "function",
                "location",
                "fault-domain",
              ].map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            设计说明
            <textarea
              value={entity.description}
              onChange={(e) =>
                edit((d) => {
                  d.entities.find((x) => x.id === selected)!.description =
                    e.target.value;
                })
              }
            />
          </label>
          <small className="note">
            ID：{entity.id} · 来源：
            {entity.sourceRefs
              .map((id) => model.sources.find((s) => s.id === id)?.name ?? id)
              .join("、") || "尚未关联"}
          </small>
          <h4>故障模式与参数</h4>
          {model.failureModes
            .filter((f) => f.entityId === selected)
            .map((f) => (
              <fieldset key={f.id}>
                <legend>{f.name}</legend>
                <label>
                  故障名称
                  <input
                    value={f.name}
                    onChange={(e) =>
                      edit((d) => {
                        d.failureModes.find((x) => x.id === f.id)!.name =
                          e.target.value;
                      })
                    }
                  />
                </label>
                <div className="eng-field-row">
                  <label>
                    失效率
                    <input
                      type="number"
                      min="0"
                      value={f.rate?.value ?? ""}
                      onChange={(e) =>
                        edit((d) => {
                          d.failureModes.find((x) => x.id === f.id)!.rate =
                            e.target.value === ""
                              ? null
                              : {
                                  value: Number(e.target.value),
                                  unit: f.rate?.unit ?? "FIT",
                                };
                        })
                      }
                    />
                  </label>
                  <label>
                    单位
                    <select
                      value={f.rate?.unit ?? "FIT"}
                      onChange={(e) =>
                        edit((d) => {
                          if (d.failureModes.find((x) => x.id === f.id)!.rate)
                            d.failureModes.find(
                              (x) => x.id === f.id,
                            )!.rate!.unit = e.target.value as "FIT" | "1/h";
                        })
                      }
                    >
                      <option>FIT</option>
                      <option>1/h</option>
                    </select>
                  </label>
                </div>
                <label>
                  平均恢复时间（小时）
                  <input
                    type="number"
                    min="0"
                    value={f.recoveryHours ?? ""}
                    onChange={(e) =>
                      edit((d) => {
                        d.failureModes.find(
                          (x) => x.id === f.id,
                        )!.recoveryHours =
                          e.target.value === "" ? null : Number(e.target.value);
                      })
                    }
                  />
                </label>
                <label>
                  故障来源
                  <input
                    value={f.category}
                    onChange={(e) =>
                      edit((d) => {
                        d.failureModes.find((x) => x.id === f.id)!.category =
                          e.target.value;
                      })
                    }
                  />
                </label>
                <label>
                  影响（逗号分隔）
                  <input
                    value={f.impacts.join(",")}
                    onChange={(e) =>
                      edit((d) => {
                        d.failureModes.find((x) => x.id === f.id)!.impacts =
                          e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean);
                      })
                    }
                  />
                </label>
              </fieldset>
            ))}
          <button
            onClick={() =>
              edit((d) =>
                d.failureModes.push({
                  id: uid("failure"),
                  name: entity.name + "故障",
                  entityId: selected,
                  category: "hardware",
                  impacts: ["interruption"],
                  rate: null,
                  recoveryHours: null,
                  probability: null,
                  sourceRefs: [],
                }),
              )
            }
          >
            添加故障模式
          </button>
          <h4>可靠性机制</h4>
          {model.mechanisms
            .filter((m) => m.entityRefs.includes(selected))
            .map((m) => (
              <fieldset key={m.id}>
                <legend>{m.name}</legend>
                <label>
                  状态
                  <select
                    value={m.status}
                    onChange={(e) =>
                      edit((d) => {
                        d.mechanisms.find((x) => x.id === m.id)!.status = e
                          .target.value as typeof m.status;
                      })
                    }
                  >
                    {["candidate", "deployed", "disabled"].map((s) => (
                      <option key={s} value={s}>
                        {labels[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  作用过程
                  <textarea
                    value={m.description}
                    onChange={(e) =>
                      edit((d) => {
                        d.mechanisms.find((x) => x.id === m.id)!.description =
                          e.target.value;
                      })
                    }
                  />
                </label>
                <label>
                  适用条件
                  <textarea
                    value={m.conditions}
                    onChange={(e) =>
                      edit((d) => {
                        d.mechanisms.find((x) => x.id === m.id)!.conditions =
                          e.target.value;
                      })
                    }
                  />
                </label>
              </fieldset>
            ))}
          <button
            onClick={() =>
              edit((d) =>
                d.mechanisms.push({
                  id: uid("mechanism"),
                  name: "新恢复机制",
                  kind: "recovery",
                  entityRefs: [selected],
                  failureRefs: [],
                  description: "",
                  conditions: "",
                  status: "candidate",
                  sourceRefs: [],
                  effects: [],
                }),
              )
            }
          >
            添加机制
          </button>
          <h4>关系</h4>
          <label>
            关系类型
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {[
                "contains",
                "deployedOn",
                "connectsTo",
                "dependsOn",
                "implements",
                "flow",
              ].map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            关系目标
            <select
              value={relationTarget}
              onChange={(e) => setRelationTarget(e.target.value)}
            >
              <option value="">选择目标</option>
              {model.entities
                .filter((e) => e.id !== selected)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={!relationTarget}
            onClick={() =>
              edit((d) =>
                d.relations.push({
                  id: uid("relation"),
                  source: selected,
                  target: relationTarget,
                  kind,
                  label: "",
                  sourceRefs: [],
                }),
              )
            }
          >
            添加关系
          </button>
          {model.relations
            .filter((r) => r.source === selected || r.target === selected)
            .map((r) => (
              <div className="eng-relation" key={r.id}>
                <span>
                  {model.entities.find((x) => x.id === r.source)?.name} —
                  {labels[r.kind]}→{" "}
                  {model.entities.find((x) => x.id === r.target)?.name}
                </span>
                <button
                  aria-label={"删除关系 " + r.id}
                  onClick={() =>
                    edit((d) => {
                      d.relations = d.relations.filter((x) => x.id !== r.id);
                    })
                  }
                >
                  移除
                </button>
              </div>
            ))}
          <details>
            <summary>删除领域对象</summary>
            <p>
              跨图引用会一起受到影响。包含故障、机制、行为或案例引用的对象必须先处理引用。
            </p>
            <button onClick={() => setDeleteMode(true)}>查看删除影响</button>
            {deleteMode && (
              <>
                <p>
                  关系{" "}
                  {
                    model.relations.filter(
                      (r) => r.source === selected || r.target === selected,
                    ).length
                  }{" "}
                  条；故障/机制/行为/案例引用需先解除。
                </p>
                <button
                  disabled={
                    model.failureModes.some((f) => f.entityId === selected) ||
                    model.mechanisms.some((m) =>
                      m.entityRefs.includes(selected),
                    ) ||
                    model.behaviors.some((b) =>
                      b.participants.includes(selected),
                    ) ||
                    model.cases.some((c) => c.entityRefs.includes(selected))
                  }
                  onClick={() => {
                    edit((d) => {
                      d.entities = d.entities.filter((e) => e.id !== selected);
                      d.relations = d.relations.filter(
                        (r) => r.source !== selected && r.target !== selected,
                      );
                      d.views.forEach((v) => {
                        v.entityRefs = v.entityRefs.filter(
                          (id) => id !== selected,
                        );
                        delete v.positions[selected];
                      });
                    });
                    onSelect("");
                  }}
                >
                  确认删除对象及显示关系
                </button>
              </>
            )}
          </details>
        </>
      ) : (
        <p className="empty">从图中或列表选择对象。</p>
      )}
    </aside>
  );
}

import { useState } from "react";
import type { EngineeringModel } from "../../../../packages/modeling/src/schema";
import { type ModelEdit, uid } from "./shared";
export default function BehaviorView({
  model,
  edit,
}: {
  model: EngineeringModel;
  edit: ModelEdit;
}) {
  const [id, setId] = useState(model.behaviors[0]?.id ?? "");
  const b = model.behaviors.find((x) => x.id === id) ?? model.behaviors[0];
  return (
    <section className="eng-behavior">
      <div className="actions">
        <select
          aria-label="行为时序"
          value={b?.id ?? ""}
          onChange={(e) => setId(e.target.value)}
        >
          {model.behaviors.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const id = uid("behavior");
            edit((d) =>
              d.behaviors.push({
                id,
                name: "新的交互时序",
                participants: d.entities.slice(0, 4).map((e) => e.id),
                steps: [],
                sourceRefs: [],
              }),
            );
            setId(id);
          }}
        >
          新增时序
        </button>
      </div>
      {b ? (
        <>
          <label>
            时序名称
            <input
              value={b.name}
              onChange={(e) =>
                edit((d) => {
                  d.behaviors.find((x) => x.id === b.id)!.name = e.target.value;
                })
              }
            />
          </label>
          <details>
            <summary>参与对象</summary>
            {model.entities.map((entity) => {
              const used = b.steps.some(
                (s) => s.from === entity.id || s.to === entity.id,
              );
              return (
                <label key={entity.id} style={{ display: "block", margin: 8 }}>
                  <input
                    type="checkbox"
                    checked={b.participants.includes(entity.id)}
                    disabled={used}
                    onChange={(e) =>
                      edit((d) => {
                        const target = d.behaviors.find((x) => x.id === b.id)!;
                        target.participants = e.target.checked
                          ? [...target.participants, entity.id]
                          : target.participants.filter((x) => x !== entity.id);
                      })
                    }
                  />
                  {entity.name}
                  {used ? " · 已用于消息" : ""}
                </label>
              );
            })}
          </details>
          <p className="note">
            设计时序 · {b.sourceRefs.length ? "关联专家材料" : "待补充来源"} ·
            不代表真实执行轨迹
          </p>
          <div className="eng-sequence">
            <svg
              role="img"
              aria-label={b.name}
              viewBox={`0 0 ${Math.max(600, b.participants.length * 190)} ${b.steps.length * 80 + 120}`}
              style={{ minWidth: Math.max(600, b.participants.length * 190) }}
            >
              <defs>
                <marker
                  id="eng-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill="#356b60" />
                </marker>
              </defs>
              {b.participants.map((id, i) => (
                <g key={id}>
                  <rect
                    x={i * 190 + 20}
                    y="10"
                    width="150"
                    height="40"
                    rx="8"
                    fill="#edf5ef"
                    stroke="#98b6a6"
                  />
                  <text x={i * 190 + 95} y="35" textAnchor="middle">
                    {model.entities.find((e) => e.id === id)?.name ?? id}
                  </text>
                  <line
                    x1={i * 190 + 95}
                    x2={i * 190 + 95}
                    y1="50"
                    y2={b.steps.length * 80 + 100}
                    stroke="#98b6a6"
                    strokeDasharray="5 4"
                  />
                </g>
              ))}
              {b.steps.map((s, i) => {
                const x1 = b.participants.indexOf(s.from) * 190 + 95,
                  x2 = b.participants.indexOf(s.to) * 190 + 95,
                  y = 95 + i * 80;
                return (
                  <g key={s.id}>
                    <line
                      x1={x1}
                      x2={x2}
                      y1={y}
                      y2={y}
                      stroke="#356b60"
                      markerEnd="url(#eng-arrow)"
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={y - 12}
                      textAnchor="middle"
                      fontSize="12"
                    >
                      {i + 1}. {s.message}
                    </text>
                    <text
                      x={(x1 + x2) / 2}
                      y={y + 18}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#68786e"
                    >
                      {s.condition}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>发送者</th>
                  <th>接收者</th>
                  <th>消息</th>
                  <th>条件/超时</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {b.steps.map((s) => (
                  <tr key={s.id}>
                    {(["from", "to"] as const).map((key) => (
                      <td key={key}>
                        <select
                          aria-label={key === "from" ? "发送者" : "接收者"}
                          value={s[key]}
                          onChange={(e) =>
                            edit((d) => {
                              d.behaviors
                                .find((x) => x.id === b.id)!
                                .steps.find((x) => x.id === s.id)![key] =
                                e.target.value;
                            })
                          }
                        >
                          {b.participants.map((id) => (
                            <option key={id} value={id}>
                              {model.entities.find((x) => x.id === id)?.name ??
                                id}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td>
                      <input
                        aria-label="时序消息"
                        value={s.message}
                        onChange={(e) =>
                          edit((d) => {
                            d.behaviors
                              .find((x) => x.id === b.id)!
                              .steps.find((x) => x.id === s.id)!.message =
                              e.target.value;
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label="时序条件"
                        value={s.condition}
                        onChange={(e) =>
                          edit((d) => {
                            d.behaviors
                              .find((x) => x.id === b.id)!
                              .steps.find((x) => x.id === s.id)!.condition =
                              e.target.value;
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        disabled={b.steps.indexOf(s) === 0}
                        onClick={() =>
                          edit((d) => {
                            const steps = d.behaviors.find(
                                (x) => x.id === b.id,
                              )!.steps,
                              i = steps.findIndex((x) => x.id === s.id);
                            [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                          })
                        }
                      >
                        上移
                      </button>
                      <button
                        onClick={() =>
                          edit((d) => {
                            const x = d.behaviors.find((x) => x.id === b.id)!;
                            x.steps = x.steps.filter((x) => x.id !== s.id);
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
          <button
            disabled={b.participants.length < 2}
            onClick={() =>
              edit((d) =>
                d.behaviors
                  .find((x) => x.id === b.id)!
                  .steps.push({
                    id: uid("step"),
                    from: b.participants[0],
                    to: b.participants[1],
                    message: "新消息",
                    condition: "",
                  }),
              )
            }
          >
            添加消息
          </button>
        </>
      ) : (
        <p className="empty">添加行为时序，记录正常流程及故障恢复交互。</p>
      )}
    </section>
  );
}

import { useState } from "react";
import type {
  EngineeringModel,
  Logic,
  AnalysisCase,
} from "../../../../packages/modeling/src/schema";
import { type ModelEdit, uid } from "./shared";
import LogicDiagram from "./LogicDiagram";
function LogicEditor({
  node,
  onChange,
  model,
  method,
}: {
  node: Logic;
  onChange: (n: Logic) => void;
  model: EngineeringModel;
  method: string;
}) {
  const gates =
    method === "rbd"
      ? ["event", "series", "parallel", "kofn"]
      : ["event", "and", "or", "kofn"];
  return (
    <div className="eng-logic-edit">
      <select
        aria-label="逻辑类型"
        value={node.type}
        onChange={(e) => {
          const type = e.target.value as Logic["type"];
          onChange(
            type === "event"
              ? { type, id: model.failureModes[0]?.id }
              : {
                  type,
                  k: type === "kofn" ? 1 : undefined,
                  children: node.children ?? [
                    { type: "event", id: model.failureModes[0]?.id },
                  ],
                },
          );
        }}
      >
        {gates.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      {node.type === "event" ? (
        <select
          aria-label="基本事件"
          value={node.id ?? ""}
          onChange={(e) => onChange({ ...node, id: e.target.value })}
        >
          <option value="">选择故障事件</option>
          {model.failureModes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      ) : (
        <>
          {node.type === "kofn" && (
            <label>
              {method === "fta" ? "至少发生数 k" : "至少成功数 k"}
              <input
                type="number"
                min="1"
                max={node.children?.length}
                value={node.k ?? 1}
                onChange={(e) =>
                  onChange({ ...node, k: Number(e.target.value) })
                }
              />
            </label>
          )}
          {node.children?.map((c, i) => (
            <div className="eng-logic-child" key={i}>
              <LogicEditor
                node={c}
                model={model}
                method={method}
                onChange={(changed) =>
                  onChange({
                    ...node,
                    children: node.children!.map((n, j) =>
                      i === j ? changed : n,
                    ),
                  })
                }
              />
              <button
                aria-label={"移除分支 " + (i + 1)}
                onClick={() =>
                  onChange({
                    ...node,
                    children: node.children!.filter((_, j) => i !== j),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              onChange({
                ...node,
                children: [
                  ...(node.children ?? []),
                  { type: "event", id: model.failureModes[0]?.id },
                ],
              })
            }
          >
            添加分支
          </button>
        </>
      )}
    </div>
  );
}
export default function AnalysisPanel({
  model,
  edit,
  onRun,
  onValidate,
  busy,
  dirty,
  tools,
}: {
  model: EngineeringModel;
  edit: ModelEdit;
  onRun: (id: string) => void;
  onValidate: () => void;
  busy: boolean;
  dirty: boolean;
  tools: any[];
}) {
  const [caseId, setCaseId] = useState(model.cases[0]?.id ?? "");
  const c = model.cases.find((c) => c.id === caseId) ?? model.cases[0];
  const runnable =
    c &&
    (c.method === "rbd" ||
      c.method === "fta" ||
      tools.some(
        (t) =>
          t.id === c.toolId &&
          t.methods.includes(c.method) &&
          t.available &&
          t.mode !== "file",
      ));
  const change = (fn: (c: AnalysisCase) => void) =>
    edit((d) => {
      const x = d.cases.find((x) => x.id === c!.id)!;
      fn(x);
    });
  const add = (method: AnalysisCase["method"]) => {
    const id = uid("case");
    edit((d) =>
      d.cases.push({
        id,
        name: "新的 " + method + " 案例",
        question: "",
        method,
        metric: ["rbd", "fta"].includes(method)
          ? "mission-reliability"
          : "verification",
        hours: 100,
        logic: ["rbd", "fta"].includes(method)
          ? { type: "event", id: d.failureModes[0]?.id }
          : undefined,
        files: [],
        propertyRefs: [],
        entityRefs: d.entities.map((e) => e.id),
        assumptions: [],
        mechanismRefs: [],
        categories: [],
        impacts: [],
        scope: "请填写适用范围",
      }),
    );
    setCaseId(id);
  };
  return (
    <section>
      <div className="eng-toolbar">
        <label>
          分析与验证案例
          <select
            aria-label="分析与验证案例"
            value={c?.id ?? ""}
            onChange={(e) => setCaseId(e.target.value)}
          >
            {model.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {(["rbd", "fta", "p", "external"] as const).map((m) => (
          <button key={m} onClick={() => add(m)}>
            ＋{m.toUpperCase()}
          </button>
        ))}
      </div>
      {c ? (
        <>
          <div className="eng-case-summary">
            <label>
              案例名称
              <input
                value={c.name}
                onChange={(e) =>
                  change((c) => {
                    c.name = e.target.value;
                  })
                }
              />
            </label>
            <label>
              要回答的问题
              <input
                value={c.question}
                onChange={(e) =>
                  change((c) => {
                    c.question = e.target.value;
                  })
                }
              />
            </label>
            <label>
              适用范围
              <textarea
                value={c.scope}
                onChange={(e) =>
                  change((c) => {
                    c.scope = e.target.value;
                  })
                }
              />
            </label>
            <label>
              模型假设（每行一条）
              <textarea
                value={c.assumptions.join("\n")}
                onChange={(e) =>
                  change((c) => {
                    c.assumptions = e.target.value.split("\n");
                  })
                }
              />
            </label>
          </div>
          <details>
            <summary>案例采用的可靠性机制</summary>
            <p className="note">
              静态案例需给出参数作用与条件；形式化案例还需在原生模型中显式实现机制。
            </p>
            {model.mechanisms.map((m) => (
              <label key={m.id} style={{ display: "block", margin: 8 }}>
                <input
                  type="checkbox"
                  checked={c.mechanismRefs.includes(m.id)}
                  onChange={(e) =>
                    change((c) => {
                      c.mechanismRefs = e.target.checked
                        ? [...c.mechanismRefs, m.id]
                        : c.mechanismRefs.filter((id) => id !== m.id);
                    })
                  }
                />
                {m.name} · {m.conditions}
              </label>
            ))}
          </details>
          {["rbd", "fta"].includes(c.method) ? (
            <>
              <div className="eng-toolbar">
                <label>
                  指标
                  <select
                    value={c.metric}
                    onChange={(e) =>
                      change((c) => {
                        c.metric = e.target.value as AnalysisCase["metric"];
                      })
                    }
                  >
                    <option value="mission-reliability">任务窗口可靠度</option>
                    <option value="availability">稳态可用度</option>
                    <option value="probability">直接失效概率</option>
                  </select>
                </label>
                <label>
                  窗口（小时）
                  <input
                    type="number"
                    min="0"
                    value={c.hours}
                    onChange={(e) =>
                      change((c) => {
                        c.hours = Number(e.target.value);
                      })
                    }
                  />
                </label>
                <label>
                  计算故障来源（逗号分隔，空为全部）
                  <input
                    value={c.categories.join(",")}
                    onChange={(e) =>
                      change((c) => {
                        c.categories = e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);
                      })
                    }
                  />
                </label>
                <label>
                  计算影响（逗号分隔）
                  <input
                    value={c.impacts.join(",")}
                    onChange={(e) =>
                      change((c) => {
                        c.impacts = e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);
                      })
                    }
                  />
                </label>
              </div>
              <p className="note">
                {c.method === "fta"
                  ? "故障树计算顶事件发生概率。"
                  : "可靠性框图表示成功路径。"}{" "}
                范围外事件在条件案例中假定不发生；维度结果不能相加。
              </p>
              {c.logic && (
                <>
                  <LogicDiagram
                    logic={c.logic}
                    model={model}
                    method={c.method}
                    analysisCase={c}
                  />
                  <details>
                    <summary>
                      编辑{c.method === "rbd" ? "成功" : "故障"}逻辑与分支
                    </summary>
                    <LogicEditor
                      node={c.logic}
                      model={model}
                      method={c.method}
                      onChange={(n) =>
                        change((c) => {
                          c.logic = n;
                        })
                      }
                    />
                  </details>
                </>
              )}
            </>
          ) : (
            <>
              <div className="eng-toolbar">
                <label>
                  执行工具
                  <select
                    value={c.toolId ?? ""}
                    onChange={(e) =>
                      change((c) => {
                        c.toolId = e.target.value || undefined;
                      })
                    }
                  >
                    <option value="">选择工具适配器</option>
                    {tools
                      .filter(
                        (t) =>
                          t.methods.includes(c.method) && t.id !== "static-bdd",
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.mode}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  验证性质引用
                  <input
                    value={c.propertyRefs.join(",")}
                    onChange={(e) =>
                      change((c) => {
                        c.propertyRefs = e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean);
                      })
                    }
                  />
                </label>
              </div>
              {c.files.map((f, i) => (
                <details key={i} open>
                  <summary>{f.name}</summary>
                  <div className="eng-toolbar">
                    <label>
                      原生文件名
                      <input
                        aria-label={"原生文件名 " + (i + 1)}
                        value={f.name}
                        onChange={(e) =>
                          change((c) => {
                            c.files[i].name = e.target.value;
                          })
                        }
                      />
                    </label>
                    <button
                      onClick={() =>
                        change((c) => {
                          c.files.splice(i, 1);
                        })
                      }
                    >
                      移除文件
                    </button>
                  </div>
                  <textarea
                    className="eng-code"
                    aria-label={f.name}
                    value={f.content}
                    spellCheck={false}
                    onChange={(e) =>
                      change((c) => {
                        c.files[i].content = e.target.value;
                      })
                    }
                  />
                </details>
              ))}
              <button
                onClick={() =>
                  change((c) => {
                    c.files.push({
                      name: `Model${c.files.length + 1}.${c.method === "p" ? "p" : "json"}`,
                      content: "",
                    });
                  })
                }
              >
                添加原生文件
              </button>
              <p className="note">
                原生模型、性质与配置一起保存。工具通过仅适用于该模型与检查范围。
              </p>
            </>
          )}
          <div className="actions">
            <button onClick={onValidate} disabled={busy || dirty}>
              校验保存版本
            </button>
            <button
              className="primary"
              disabled={busy || dirty || !runnable}
              onClick={() => onRun(c.id)}
            >
              运行真实
              {c.method === "rbd" || c.method === "fta" ? " BDD" : "工具"}
            </button>
            {dirty && <span className="note">请先保存当前修改再运行。</span>}
            {!runnable && (
              <span className="note">
                此方法未配置可执行工具。可保留历史证据，或通过文件交换导出输入。
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="empty">建立分析案例，明确问题、模型和验证范围。</p>
      )}
      <details>
        <summary>性质与约束库</summary>
        {model.requirements.map((r) => (
          <label key={r.id} style={{ display: "block", margin: "12px 0" }}>
            {r.id} · {r.kind}
            <textarea
              aria-label={"性质 " + r.id}
              value={r.statement}
              onChange={(e) =>
                edit((d) => {
                  d.requirements.find((x) => x.id === r.id)!.statement =
                    e.target.value;
                })
              }
            />
          </label>
        ))}
        <button
          onClick={() =>
            edit((d) =>
              d.requirements.push({
                id: uid("property"),
                statement: "请明确需要验证的性质及范围",
                kind: "safety",
                sourceRefs: [],
              }),
            )
          }
        >
          添加验证性质
        </button>
      </details>
      <details>
        <summary>已配置工具</summary>
        {tools.map((t) => (
          <p key={t.id}>
            {t.name} · {t.version} · {t.mode} ·{" "}
            {t.available ? "可用" : "未安装"}
          </p>
        ))}
      </details>
    </section>
  );
}

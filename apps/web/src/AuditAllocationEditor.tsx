import { useState } from "react";
import { hardwareScaleEvents } from "../../../packages/contracts/src/audit-hardware";
import {
  auditSubmodelPlan,
  auditHardwareItems,
  hardwareTargetOverrides,
  type AuditSubmodelAllocation,
} from "../../../packages/analysis/src/audit-allocation";
import {
  auditObjects,
  type AuditEventView,
} from "../../../packages/contracts/src/audit-objects";
import type { AuditRequest } from "../../../packages/analysis/src/audit";
const labels: Record<string, string> = {
  equal: "Equal · 均分",
  arinc: "ARINC · 按基线 FIT 等比收缩",
  agree: "AGREE · 复杂度与重要度加权",
  availability: "Availability · 串联对数预算",
};
const pct = (v: number) => (v * 100).toFixed(4) + "%";
export default function AuditAllocationEditor({
  request,
  events,
  onChange,
  onApplyHardware,
}: {
  request: AuditRequest;
  events: AuditEventView[];
  onChange: (r: AuditRequest) => void;
  onApplyHardware: (s: string) => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [text, setText] = useState<string>();
  try {
    events = hardwareScaleEvents(events, request.architecture, request.cards);
  } catch (e) {
    return <p role="alert">请先补齐硬件规模配置：{(e as Error).message}</p>;
  }
  const input = request.submodelAllocation,
    objects = auditObjects(events);
  let plan: ReturnType<typeof auditSubmodelPlan> = null,
    invalid = "";
  try {
    plan = auditSubmodelPlan(input);
  } catch (e) {
    invalid = (e as Error).message;
  }
  const stale =
    input?.source === "event-catalog" &&
    (input.cards !== request.cards ||
      input.items.length !== objects.length ||
      objects.some(
        (o) =>
          Math.abs(
            (input.items.find((i) => i.id === o.id)?.baselineRate ?? -1) -
              (o.fit * request.cards) / 1e9,
          ) > 1e-14,
      ));
  const refresh = (): AuditSubmodelAllocation => ({
    method: "availability",
    metricId: "steady-state-availability",
    target: request.target,
    hours: request.hours,
    ...input,
    source: "event-catalog",
    cards: request.cards,
    recoveryHours: input?.recoveryHours
      ? Object.fromEntries(
          Object.entries(input.recoveryHours).filter(([id]) =>
            objects.some((o) => o.id === id),
          ),
        )
      : undefined,
    items: auditHardwareItems(events, request.cards).map((i) => ({
      ...i,
      ...input?.items.find((old) => old.id === i.id),
      id: i.id,
      name: i.name,
      baselineRate: i.baselineRate,
    })),
  });
  const update = (next: AuditSubmodelAllocation) => {
    onChange({ ...request, submodelAllocation: next });
    setNotice("");
  };
  return (
    <section className="hardware-allocation" aria-label="硬件对象目标分配">
      <h4>按对象分配目标</h4>
      <p>
        先分解计算、内存、互联、存储和基础设施目标，再在第四步选择降
        FIT、检测与恢复措施，第五步统一计算可用度。
      </p>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={!!input}
          onChange={(e) =>
            onChange({
              ...request,
              submodelAllocation: e.target.checked ? refresh() : undefined,
            })
          }
        />
        启用对象目标分配
      </label>
      {input && (
        <>
          <div className="fields">
            <label>
              分配方法
              <select
                aria-label="子模型分配方法"
                value={input.method}
                onChange={(e) =>
                  update({
                    ...input,
                    method: e.target.value as AuditSubmodelAllocation["method"],
                    metricId:
                      e.target.value === "availability"
                        ? "steady-state-availability"
                        : "task-reliability",
                    compareMethods: undefined,
                  })
                }
              >
                {Object.entries(labels).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              子模型指标
              <select
                aria-label="子模型指标"
                value={input.metricId}
                onChange={(e) =>
                  update({
                    ...input,
                    metricId: e.target.value,
                    method:
                      e.target.value === "steady-state-availability"
                        ? "availability"
                        : "equal",
                    compareMethods: undefined,
                  })
                }
              >
                <option value="steady-state-availability">
                  独立串联运行可用度
                </option>
                <option value="task-reliability">
                  任务可靠度（无失效完成概率）
                </option>
              </select>
            </label>
            <label>
              子模型约束（%）
              <input
                aria-label="子模型目标"
                type="number"
                min="0.000001"
                max="100"
                step="any"
                value={input.target * 100}
                onChange={(e) =>
                  update({ ...input, target: Number(e.target.value) / 100 })
                }
              />
            </label>
            {input.method !== "availability" && (
              <label>
                子模型任务窗口（h）
                <input
                  aria-label="子模型窗口"
                  type="number"
                  min="0.01"
                  step="any"
                  value={input.hours}
                  onChange={(e) =>
                    update({ ...input, hours: Number(e.target.value) })
                  }
                />
              </label>
            )}
          </div>
          <p className="allocation-assumption">
            {input.method === "availability"
              ? "Availability：∏Aᵢ 合成为此处的独立串联约束；转换 FIT 还需要二态平均修复时间。"
              : input.method === "agree"
                ? "AGREE：按复杂度 nᵢ 与重要度 Eᵢ 分配任务可靠度，核验 ∏Rᵢ^Eᵢ，不能用普通乘积代替。"
                : "Equal / ARINC：分配独立串联、指数失效的任务可靠度，任务期间无失效的概率与含恢复的可用度不同。"}{" "}
            主流程目标仍为可用度 {pct(request.target)}
            ，需计入保存、回滚及污染后正向仿真验证。
          </p>
          {input.method !== "availability" && (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={!!input.compareMethods}
                onChange={(e) =>
                  update({
                    ...input,
                    compareMethods: e.target.checked
                      ? ["equal", "arinc", "agree"]
                      : undefined,
                  })
                }
              />
              同步对比 Equal、ARINC、AGREE
            </label>
          )}
          {stale && (
            <p role="alert" className="error">
              故障库或规模已变化，请刷新对象后复核分配。
            </p>
          )}
          <button type="button" onClick={() => update(refresh())}>
            按当前故障库刷新对象
          </button>
        </>
      )}
      <p className="note">
        统一为每十亿 NPU
        等效运行小时，含软件与未归因对象。中断、亚健康和静默分别保留当前
        FIT；96.6% / 2% / 1.4% 是参考总量比例，各对象的类内构成以故障库为准。
      </p>
      <div
        className="table-wrap hardware-allocation-table"
        tabIndex={0}
        aria-label="对象 FIT 与分配目标"
      >
        <table>
          <thead>
            <tr>
              <th>对象</th>
              <th>当前 FIT</th>
              <th>中断 / 亚健康 / 静默 FIT</th>
              {input && (
                <>
                  <th>
                    {input.method === "availability" ? "预算权重" : "复杂度 nᵢ"}
                  </th>
                  <th>
                    {input.method === "availability"
                      ? "平均修复 h"
                      : "重要度 Eᵢ"}
                  </th>
                  <th>子目标</th>
                  <th>目标 FIT</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {(input?.items ?? auditHardwareItems(events, request.cards)).map(
              (item) => {
                const object = objects.find((o) => o.id === item.id),
                  result = plan?.selected.items.find((i) => i.id === item.id);
                const target = plan?.objectFitTargets
                  .find((p) => p.method === input?.method)
                  ?.items.find((i) => i.id === item.id)?.fit;
                const edit = (key: string, value: number) =>
                  input &&
                  update({
                    ...input,
                    items: input.items.map((i) =>
                      i.id === item.id ? { ...i, [key]: value } : i,
                    ),
                  });
                return (
                  <tr key={item.id}>
                    <th>
                      {item.name}
                      <small>{object?.category ?? "自定义子系统"}</small>
                    </th>
                    <td>
                      {(input?.source === "event-catalog" || !input
                        ? object?.fit
                        : (item.baselineRate ?? 0) * 1e9
                      )?.toFixed(3) ?? "—"}
                    </td>
                    <td>
                      {object
                        ? ["hard", "slow", "sdc"]
                            .map((t) => object.types[t].toFixed(3))
                            .join(" / ")
                        : "自定义来源"}
                    </td>
                    {input && (
                      <>
                        <td>
                          <input
                            aria-label={`${item.name} ${input.method === "availability" ? "预算权重" : "复杂度"}`}
                            type="number"
                            disabled={
                              input.method === "equal" ||
                              input.method === "arinc"
                            }
                            min="0"
                            step="any"
                            value={
                              input.method === "availability"
                                ? (item.weight ?? 1)
                                : (item.complexity ?? 1)
                            }
                            onChange={(e) =>
                              edit(
                                input.method === "availability"
                                  ? "weight"
                                  : "complexity",
                                Number(e.target.value),
                              )
                            }
                          />
                        </td>
                        <td>
                          {input.method === "availability" ? (
                            <input
                              aria-label={`${item.name}平均修复时间`}
                              type="number"
                              min="0.000001"
                              step="any"
                              placeholder="待提供"
                              value={input.recoveryHours?.[item.id] ?? ""}
                              onChange={(e) => {
                                const recoveryHours = {
                                  ...input.recoveryHours,
                                };
                                if (e.target.value === "")
                                  delete recoveryHours[item.id];
                                else
                                  recoveryHours[item.id] = Number(
                                    e.target.value,
                                  );
                                update({ ...input, recoveryHours });
                              }}
                            />
                          ) : (
                            <input
                              aria-label={`${item.name}重要度`}
                              type="number"
                              disabled={
                                input.method === "equal" ||
                                input.method === "arinc"
                              }
                              min="0.000001"
                              step="any"
                              value={item.importance ?? 1}
                              onChange={(e) =>
                                edit("importance", Number(e.target.value))
                              }
                            />
                          )}
                        </td>
                        <td>{result ? pct(result.target) : "—"}</td>
                        <td>
                          {input.source !== "event-catalog"
                            ? (result?.targetFit?.toFixed(3) ?? "需恢复模型")
                            : target == null
                              ? "需修复时间"
                              : target.toFixed(3)}
                        </td>
                      </>
                    )}
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
      {input && (
        <>
          {plan && (
            <p>
              回合成：{plan.selected.recomposition.formula} ={" "}
              {pct(plan.selected.recomposition.achieved)}。目标 FIT
              仅是工程设计约束；载入时按上限处理，不调高已满足预算的对象。
            </p>
          )}
          {plan && plan.comparisons.length > 1 && (
            <div className="table-wrap">
              <table aria-label="分配方法对比">
                <thead>
                  <tr>
                    <th>方法</th>
                    <th>回合成</th>
                    <th>约束关系</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.comparisons.map((p) => (
                    <tr key={p.method}>
                      <th>{labels[p.method]}</th>
                      <td>{pct(p.recomposition.achieved)}</td>
                      <td>{p.recomposition.formula}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            disabled={stale || !plan || input.source !== "event-catalog"}
            onClick={() => {
              try {
                onApplyHardware(
                  JSON.stringify(
                    hardwareTargetOverrides(input, events),
                    null,
                    2,
                  ),
                );
                setNotice(
                  "已载入第四步硬件改进目标，按对象当前故障构成拆分。请确认工程可行性后重新评估。",
                );
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            将分配 FIT 载入硬件改进目标
          </button>
          <details className="audit-help">
            <summary>高级：自定义子系统参数 JSON</summary>
            <p className="note">
              自定义 baselineRate 单位 /h，脱离故障库映射后目标 FIT
              按子系统小时计算，不能直接替换 NPU 等效事件。
            </p>
            <textarea
              aria-label="子模型分配参数"
              rows={7}
              value={text ?? JSON.stringify(input.items, null, 2)}
              onChange={(e) => {
                setText(e.target.value);
                try {
                  const next = {
                    ...input,
                    source: undefined,
                    cards: undefined,
                    recoveryHours: undefined,
                    items: JSON.parse(e.target.value),
                  };
                  auditSubmodelPlan(next);
                  update(next);
                  setError("");
                } catch (err) {
                  setError((err as Error).message);
                  update({ ...input, items: [] });
                }
              }}
            />
          </details>
        </>
      )}
      {(error || invalid) && (
        <p role="alert" className="error">
          {error || invalid}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

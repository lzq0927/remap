import { useState } from "react";
import {
  auditSubmodelPlan,
  type AuditSubmodelAllocation,
} from "../../../packages/analysis/src/audit-allocation";
import type { AuditRequest } from "../../../packages/analysis/src/audit";

export default function AuditAllocationEditor({
  request,
  onChange,
}: {
  request: AuditRequest;
  onChange: (r: AuditRequest) => void;
}) {
  const [text, setText] = useState(
    JSON.stringify(
      request.submodelAllocation?.items ?? [
        {
          id: "compute",
          name: "计算子系统",
          baselineRate: 0.00002,
          complexity: 2,
          importance: 1,
        },
        {
          id: "network",
          name: "网络子系统",
          baselineRate: 0.00001,
          complexity: 1,
          importance: 1,
        },
      ],
      null,
      2,
    ),
  );
  const [error, setError] = useState("");
  const input = request.submodelAllocation;
  let plan: ReturnType<typeof auditSubmodelPlan> = null;
  let validationError = "";
  try {
    plan = auditSubmodelPlan(input);
  } catch (err) {
    validationError = (err as Error).message;
  }
  function update(next: AuditSubmodelAllocation) {
    onChange({ ...request, submodelAllocation: next });
  }
  return (
    <details className="allocation-editor">
      <summary>子模型目标分配 · Equal / ARINC / AGREE / Availability</summary>
      <p>
        训练正确有效产出使用上面的损失预算。若需要分解任务可靠度或运行可用度，在这里明确独立目标；示例参数是演示假设，需替换为自己的系统数据。
      </p>
      <label>
        <input
          type="checkbox"
          checked={!!input}
          onChange={(e) => {
            if (!e.target.checked) {
              onChange({ ...request, submodelAllocation: undefined });
              return;
            }
            try {
              update({
                method: "equal",
                metricId: "task-reliability",
                target: 0.99,
                hours: request.hours,
                items: JSON.parse(text),
              });
              setError("");
            } catch {
              setError("请先修正子系统 JSON");
            }
          }}
        />
        启用独立子模型分配
      </label>
      {input && (
        <>
          <div className="fields">
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
                <option value="task-reliability">
                  任务可靠度（无失效完成概率）
                </option>
                <option value="steady-state-availability">
                  稳态运行可用度（独立串联）
                </option>
              </select>
            </label>
            <label>
              分配方法
              <select
                aria-label="子模型分配方法"
                value={input.method}
                onChange={(e) =>
                  update({
                    ...input,
                    method: e.target.value as AuditSubmodelAllocation["method"],
                  })
                }
              >
                {input.metricId === "steady-state-availability" ? (
                  <option value="availability">Availability · 对数预算</option>
                ) : (
                  <>
                    <option value="equal">Equal · 均分</option>
                    <option value="arinc">ARINC · 等比收缩</option>
                    <option value="agree">AGREE · 加权任务可靠度</option>
                  </>
                )}
              </select>
            </label>
            <label>
              独立子模型目标（%）
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
            <label>
              任务窗口（h）
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
          </div>
          {input.metricId === "task-reliability" && (
            <label>
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
          <p className="note">
            baselineRate 单位 /h；complexity 为复杂度 nᵢ；importance 为重要度
            Eᵢ；operatingHours 为 tᵢ；Availability 使用
            weight、baselineAvailability，可设置
            locked、bounds。参数来源须在过程说明中记录。
          </p>
          <label>
            子系统参数 JSON
            <textarea
              aria-label="子模型分配参数"
              rows={8}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                try {
                  const next = { ...input, items: JSON.parse(e.target.value) };
                  auditSubmodelPlan(next);
                  update(next);
                  setError("");
                } catch (err) {
                  setError((err as Error).message);
                  onChange({
                    ...request,
                    submodelAllocation: { ...input, items: [] },
                  });
                }
              }}
            />
          </label>
          {plan && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>方法</th>
                    <th>子系统</th>
                    <th>当前值</th>
                    <th>子目标</th>
                    <th>目标 FIT</th>
                    <th>合成目标</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.comparisons.flatMap((result) =>
                    result.items.map((item) => (
                      <tr key={result.method + item.id}>
                        <td>{result.method}</td>
                        <td>{item.name}</td>
                        <td>
                          {item.current === null
                            ? "未输入"
                            : (item.current * 100).toFixed(4) + "%"}
                        </td>
                        <td>{(item.target * 100).toFixed(4)}%</td>
                        <td>
                          {item.targetFit?.toFixed(3) ?? "需恢复模型验证"}
                        </td>
                        <td>
                          {(result.recomposition.achieved * 100).toFixed(4)}%
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="note">
            AGREE 检查
            ∏Rᵢ^Eᵢ；分配结果是设计约束，措施不改变源故障率，训练指标仍需正向仿真验证。
          </p>
        </>
      )}
      {(error || validationError) && (
        <p role="alert">{error || validationError}</p>
      )}
    </details>
  );
}

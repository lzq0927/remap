import { useState } from "react";
import type { AuditRequest } from "../../../packages/analysis/src/audit";

export default function AuditWorkbench({
  defaults,
  events,
  mechanisms,
  busy,
  onRun,
}: {
  defaults: AuditRequest;
  events: any[];
  mechanisms: any[];
  busy: boolean;
  onRun: (request: AuditRequest) => void;
}) {
  const [request, setRequest] = useState<AuditRequest>(() =>
    structuredClone(defaults),
  );
  const [overrides, setOverrides] = useState("[]"),
    [hardware, setHardware] = useState("[]");
  const [error, setError] = useState("");
  const [model, setModel] = useState(JSON.stringify(defaults.model, null, 2));
  const [policy, setPolicy] = useState(
    JSON.stringify(defaults.policy, null, 2),
  );
  const [allScales, setAllScales] = useState(false);
  return (
    <section
      className="paper audit-workbench"
      aria-label="故障事件与机制收益审核"
    >
      <div className="section-head">
        <div>
          <span className="eyebrow">事件 · 机制 · 决策</span>
          <h2>故障事件与可靠性机制收益审核</h2>
        </div>
        <span className="badge">专家审核口径 · 2026-10-09</span>
      </div>
      <p>
        从目标分配到工程措施，再用仿真验证组合收益。期末保留最后干净检查点；下方旧
        V4 流程仍采用整任务清零，两者分别记录。
      </p>
      <div className="fields">
        {[
          ["cards", "审核卡数", 1, 1000000],
          ["hours", "审核窗口（小时）", 0.01, 8760],
          ["target", "审核产出目标（0–1）", 0, 1],
          ["trials", "每场景轨迹数", 2, 8192],
          ["seed", "审核随机种子", 0, 4294967295],
          ["attributionTrials", "每组合轨迹数", 2, 2048],
        ].map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              aria-label={String(label)}
              type="number"
              min={Number(min)}
              max={Number(max)}
              step={key === "target" ? 0.001 : 1}
              value={(request as any)[key]}
              onChange={(e) =>
                setRequest({ ...request, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <div className="fields">
        <label>
          <input
            type="checkbox"
            checked={allScales}
            onChange={(e) => setAllScales(e.target.checked)}
          />
          同时对比万卡、十万卡、二十万卡、五十万卡
        </label>
        <label>
          <input
            type="checkbox"
            checked={request.attribution ?? true}
            onChange={(e) =>
              setRequest({ ...request, attribution: e.target.checked })
            }
          />
          计算组合 Shapley 与交互
        </label>
        <label>
          <input
            type="checkbox"
            checked={request.sensitivity ?? true}
            onChange={(e) =>
              setRequest({ ...request, sensitivity: e.target.checked })
            }
          />
          扫描静默检出率与兜底时延
        </label>
        <label>
          物理恢复顺序
          <select
            aria-label="物理恢复顺序"
            value={request.recoveryOrder?.join(",")}
            onChange={(e) =>
              setRequest({
                ...request,
                recoveryOrder: e.target.value.split(","),
              })
            }
          >
            <option value="replay,elastic,process">重执行 → 弹性 → 进程</option>
            <option value="replay,process,elastic">重执行 → 进程 → 弹性</option>
            <option value="elastic,replay,process">弹性 → 重执行 → 进程</option>
            <option value="elastic,process,replay">弹性 → 进程 → 重执行</option>
            <option value="process,replay,elastic">进程 → 重执行 → 弹性</option>
            <option value="process,elastic,replay">进程 → 弹性 → 重执行</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>所选组合（单项收益仍分别计算）</legend>
        <div className="fields">
          {mechanisms.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                checked={request.mechanisms?.includes(m.id) ?? false}
                onChange={(e) =>
                  setRequest({
                    ...request,
                    mechanisms: e.target.checked
                      ? [...(request.mechanisms ?? []), m.id]
                      : (request.mechanisms ?? []).filter((id) => id !== m.id),
                  })
                }
              />
              {m.name}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="note">
        Shapley 的加入顺序用于分摊收益，物理恢复顺序由上面的恢复链决定。无检测时
        step 不能自行发现静默错误；机制改变后果，不自动降低源 FIT。
      </p>
      <details>
        <summary>基线参数、机制目标与成本</summary>
        <div className="fields">
          <label>
            基线参数 JSON
            <textarea
              aria-label="审核基线参数"
              className="json"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label>
            机制目标 JSON
            <textarea
              aria-label="审核机制参数"
              className="json"
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
            />
          </label>
        </div>
        <div className="fields">
          {mechanisms
            .filter((m) => request.mechanisms?.includes(m.id))
            .map((m) => (
              <label key={m.id}>
                {m.name}成本（统一单位，可留空）
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={request.costs?.[m.id] ?? ""}
                  onChange={(e) => {
                    const costs = { ...request.costs };
                    if (e.target.value === "") delete costs[m.id];
                    else costs[m.id] = Number(e.target.value);
                    setRequest({ ...request, costs });
                  }}
                />
              </label>
            ))}
        </div>
      </details>
      <details>
        <summary>内网中断数据替换与硬件降 FIT</summary>
        <p>
          只替换明确提供的事件。中断总量或 CORE-hard
          等细分比例变化时，静默和亚健康保留各自外网先验，不随旧比例缩放。零观测不能直接推断零
          FIT。
        </p>
        <p>
          每项填写 id、fit、source、evidence（internal-measured / external-prior
          / scenario）、rateBasis（npu-equivalent-hour）。这要求已换算为 NPU
          等效运行小时；器件物理 FIT
          不可直接混用。内网真实数据只在公司内部部署中录入。
        </p>
        <label>
          基线事件更新 JSON
          <textarea
            aria-label="基线事件更新"
            className="json"
            value={overrides}
            onChange={(e) => setOverrides(e.target.value)}
          />
        </label>
        <label>
          硬件改进目标 JSON
          <textarea
            aria-label="硬件目标更新"
            className="json"
            value={hardware}
            onChange={(e) => setHardware(e.target.value)}
          />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>事件</th>
                <th>领域</th>
                <th>参考 FIT</th>
                <th>证据</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.domain}</td>
                  <td>{e.fit.toFixed(3)}</td>
                  <td>{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          try {
            const eventOverrides = JSON.parse(overrides),
              candidateFitOverrides = JSON.parse(hardware);
            if (
              !Array.isArray(eventOverrides) ||
              !Array.isArray(candidateFitOverrides)
            )
              throw new Error("事件更新必须是数组");
            setError("");
            onRun({
              ...request,
              scales: allScales
                ? [...new Set([request.cards, 10000, 100000, 200000, 500000])]
                : [request.cards],
              model: JSON.parse(model),
              policy: JSON.parse(policy),
              eventOverrides,
              candidateFitOverrides,
              costs: Object.fromEntries(
                Object.entries(request.costs ?? {}).filter(([id]) =>
                  request.mechanisms?.includes(id),
                ),
              ),
            });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        运行事件与机制审核
      </button>
      <p className="note">
        作为独立审核实验保存输入与结果，可在“实验与报告”下载完整
        HTML。不自动替代旧 V4 流程的人工作业确认。
      </p>
    </section>
  );
}

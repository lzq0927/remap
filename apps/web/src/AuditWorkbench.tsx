import {
  auditLossBudgetLabels,
  auditBudgetDefaults,
} from "../../../packages/analysis/src/audit-design";
import { useEffect, useState } from "react";
import { EventEditor, NumericParameters } from "./AuditEditors";
import type { AuditRequest } from "../../../packages/analysis/src/audit";

import {
  auditDraftInput,
  type AuditDraft,
} from "../../../packages/contracts/src/audit-draft";
export {
  auditDraftInput,
  type AuditDraft,
} from "../../../packages/contracts/src/audit-draft";
export default function AuditWorkbench({
  defaults,
  draft,
  onDraftChange,
  events,
  mechanisms,
  busy,
  onRun,
}: {
  defaults: AuditRequest;
  draft?: AuditDraft;
  onDraftChange: (draft: AuditDraft) => void;
  events: any[];
  mechanisms: any[];
  busy: boolean;
  onRun: (request: AuditRequest) => void;
}) {
  const [request, setRequest] = useState<AuditRequest>(() =>
    structuredClone(draft?.request ?? defaults),
  );
  const [overrides, setOverrides] = useState(draft?.overrides ?? "[]"),
    [hardware, setHardware] = useState(draft?.hardware ?? "[]");
  const [error, setError] = useState("");
  const [model, setModel] = useState(
    draft?.model ?? JSON.stringify(defaults.model, null, 2),
  );
  const [policy, setPolicy] = useState(
    draft?.policy ?? JSON.stringify(defaults.policy, null, 2),
  );
  const [allScales, setAllScales] = useState(draft?.allScales ?? false);
  useEffect(() => {
    onDraftChange({ request, overrides, hardware, model, policy, allScales });
  }, [request, overrides, hardware, model, policy, allScales, onDraftChange]);
  let parsedModel: Record<string, number> | undefined,
    parsedPolicy: Record<string, Record<string, number>> | undefined;
  try {
    parsedModel = JSON.parse(model);
    parsedPolicy = JSON.parse(policy);
  } catch {
    /* keep advanced JSON editable */
  }
  const descriptions: Record<string, string> = {
    hardDetect: "更早发现中断，减少检测等待。",
    slowDetect: "缩短降速持续时间，恢复正常吞吐。",
    sdcDetect: "发现静默错误，启动正确性恢复。",
    step: "依赖错误检测，回到干净 step。",
    replay: "适用瞬态故障，先尝试局部重执行。",
    process: "局部尝试失败后重新调度进程。",
    elastic: "隔离受影响 DP 域，保留其他域产出。",
    fast: "缩短回滚距离，同时计入保存开销。",
  };
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
      <p className="audit-lead">
        哪些故障消耗了训练产出？哪些措施值得组合？在同一组故障假设下比较基线、单项和组合，形成可复核的设计依据。
      </p>
      <div className="audit-context">
        <strong>本次衡量：窗口结束时保留的正确计算进度</strong>
        <span>外网参考参数 · 中断数据待内网校准 · 机制能力为待验证假设</span>
      </div>
      <h3 id="audit-scope" className="audit-step-title">
        01 / 评估范围
      </h3>
      <div className="fields">
        {[
          ["cards", "审核卡数", 1, 1000000],
          ["hours", "审核窗口（小时）", 0.01, 8760],
          ["target", "审核产出目标（0–1）", 0, 1],
        ].map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              aria-label={String(label)}
              type="number"
              min={Number(min)}
              max={Number(max)}
              step={key === "target" ? 0.001 : key === "hours" ? 0.01 : 1}
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
      </div>
      {allScales && (
        <div className="fields" aria-label="分规模目标">
          {[...new Set([request.cards, 10000, 100000, 200000, 500000])]
            .filter((n) => n !== request.cards)
            .map((n) => (
              <label key={n}>
                {n.toLocaleString()} 卡目标（0–1）
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.001"
                  value={request.targets?.[String(n)] ?? request.target}
                  onChange={(e) =>
                    setRequest({
                      ...request,
                      targets: {
                        ...request.targets,
                        [String(n)]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          <p className="note">
            未单独设置的规模沿用主目标；目标由需求给定，不由 MTBF 推导。
          </p>
        </div>
      )}
      <h3 className="audit-step-title">02 / 故障与证据</h3>
      <details id="audit-evidence">
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
        <EventEditor
          title="基线事件更新"
          events={events}
          value={overrides}
          onChange={setOverrides}
        />

        <EventEditor
          title="硬件改进目标"
          events={events}
          value={hardware}
          onChange={setHardware}
        />
        <details>
          <summary>批量 JSON 更新与参考事件库</summary>
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
      </details>
      <section id="audit-budget" aria-label="损失预算分配">
        <h3 className="audit-step-title">03 / 预算与措施</h3>
        <p>
          允许总损失 =（1 − 目标）× 窗口。六项预算用于追踪缺口，不是直接降低 FIT
          的比例；工程措施需再经正向仿真验证。
        </p>
        <p>
          当前规模允许损失{" "}
          <strong>
            {((1 - request.target) * request.hours).toFixed(3)} 小时
          </strong>
          ；权重合计{" "}
          <strong>
            {(
              Object.values(request.lossBudgetWeights ?? {}).reduce(
                (a, b) => a + b,
                0,
              ) * 100
            ).toFixed(2)}
            %
          </strong>
          （需为 100%）。
        </p>
        <div className="fields">
          {Object.entries(auditLossBudgetLabels).map(([id, name]) => (
            <label key={id}>
              {name}预算（%）
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={
                  Math.round((request.lossBudgetWeights?.[id] ?? 0) * 10000) /
                  100
                }
                onChange={(e) =>
                  setRequest({
                    ...request,
                    lossBudgetWeights: {
                      ...request.lossBudgetWeights,
                      [id]: Number(e.target.value) / 100,
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <button
          onClick={() =>
            setRequest({
              ...request,
              lossBudgetWeights: { ...auditBudgetDefaults },
            })
          }
        >
          载入参考预算
        </button>
        <p className="note">
          参考权重为设计假设，请按产品优先级调整并在流程中确认。
        </p>
      </section>
      <fieldset className="mechanism-picker">
        <legend>选择组合措施</legend>
        <p className="note">
          勾选措施用于组合评估；每个单项也会独立计算，避免把单项收益直接相加。
        </p>
        <div className="mechanism-grid">
          {mechanisms.map((m) => (
            <label
              key={m.id}
              className={
                request.mechanisms?.includes(m.id)
                  ? "mechanism-option selected"
                  : "mechanism-option"
              }
            >
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
              <span>
                <strong>{m.name}</strong>
                <small>{descriptions[m.id]}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="note">
        Shapley
        的加入顺序用于分摊收益，物理恢复顺序由“参数核对”中的恢复链决定。无检测时
        step 不能自行发现静默错误；机制改变后果，不自动降低源 FIT。
      </p>
      <h3 className="audit-step-title">04 / 参数核对</h3>
      <details id="audit-parameters">
        <summary>基线参数、机制目标与成本</summary>
        <h3>采样与复核</h3>
        <div className="fields">
          {[
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
                step="1"
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
              checked={request.verifyRecommendation ?? false}
              onChange={(e) =>
                setRequest({
                  ...request,
                  verifyRecommendation: e.target.checked,
                })
              }
            />
            独立种子复核建议组合
          </label>
          <label>
            独立复核轨迹数
            <input
              type="number"
              min="2"
              max="2048"
              value={request.verificationTrials ?? 64}
              onChange={(e) =>
                setRequest({
                  ...request,
                  verificationTrials: Number(e.target.value),
                })
              }
            />
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
              <option value="replay,elastic,process">
                重执行 → 弹性 → 进程
              </option>
              <option value="replay,process,elastic">
                重执行 → 进程 → 弹性
              </option>
              <option value="elastic,replay,process">
                弹性 → 重执行 → 进程
              </option>
              <option value="elastic,process,replay">
                弹性 → 进程 → 重执行
              </option>
              <option value="process,replay,elastic">
                进程 → 重执行 → 弹性
              </option>
              <option value="process,elastic,replay">
                进程 → 弹性 → 重执行
              </option>
            </select>
          </label>
        </div>
        <h3>当前基线</h3>
        {parsedModel && (
          <NumericParameters
            prefix="基线"
            value={parsedModel}
            onChange={(v) => setModel(JSON.stringify(v, null, 2))}
          />
        )}
        <h3>机制目标</h3>
        {parsedPolicy &&
          mechanisms
            .filter((m) => request.mechanisms?.includes(m.id))
            .map((m) => (
              <details key={m.id} className="mechanism-parameters">
                <summary>{m.name} · 编辑目标参数</summary>
                <NumericParameters
                  prefix={m.name}
                  value={parsedPolicy![m.code] ?? {}}
                  onChange={(v) =>
                    setPolicy(
                      JSON.stringify({ ...parsedPolicy, [m.code]: v }, null, 2),
                    )
                  }
                />
              </details>
            ))}
        <details>
          <summary>高级 JSON 参数</summary>
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
        </details>
        <h3>工程成本（可选）</h3>
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="audit-run-summary" id="audit-run">
        <div>
          <strong>05 / 生成审核证据</strong>
          <p>
            {request.mechanisms?.length ?? 0} 项组合措施 · {request.trials}{" "}
            条轨迹 / 场景
            {request.attribution
              ? ` · Shapley ${2 ** (request.mechanisms?.length ?? 0)} 个子集 × ${request.attributionTrials} 条轨迹`
              : " · 未开启收益分摊"}
          </p>
          <small>轨迹越多，采样区间通常越稳定；它不能替代真实参数校准。</small>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            try {
              const input = auditDraftInput({
                request,
                overrides,
                hardware,
                model,
                policy,
                allScales,
              });
              setError("");
              onRun(input);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {busy ? "正在计算…" : "运行事件与机制审核"}
        </button>
      </div>
      <p className="note">
        前四步确认后，运行将关联正式流程；也可先独立试算。结果保留输入快照，
        在“实验与报告”下载完整 HTML。正式交付仍需人工确认。
      </p>
    </section>
  );
}

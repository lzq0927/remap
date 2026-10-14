import { useEffect, useRef, useState } from "react";
import { useTaskApi } from "./api";
import type { AuditOptimizationRequest } from "../../../packages/contracts/src/audit-optimization";
import {
  auditExtensionCatalog,
  extensionScenario,
} from "../../../packages/contracts/src/audit-extensions";
import { NumericParameters, EventEditor } from "./AuditEditors";
import AuditExperimentResult from "./AuditExperimentResult";
import { experimentStatus } from "../../../packages/reports/src/audit-experiments";
const pct = (value: number) => (value * 100).toFixed(4) + "%";
const blank = (): AuditOptimizationRequest => ({
  enabled: true,
  autoTune: false,
  policy: {},
  model: {},
  extensions: [],
});
export default function AuditExperiments({ sourceRun }: { sourceRun: any }) {
  const { api, url } = useTaskApi();
  const [view, setView] = useState("configuration");
  const [configuration, setConfiguration] =
    useState<AuditOptimizationRequest>(blank);
  const [name, setName] = useState("自定义改进方案");
  const [plan, setPlan] = useState<any>();
  const [adoptedPlanId, setAdoptedPlanId] = useState<string>();
  const [pending, setPending] = useState<any>();
  const [history, setHistory] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([sourceRun.id]);
  const [last, setLast] = useState<any>();
  const [comparison, setComparison] = useState<any>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [planningCards, setPlanningCards] = useState(
    sourceRun.result.request.cards,
  );
  const [scale, setScale] = useState(sourceRun.result.request.cards);
  const [extensionId, setExtensionId] = useState("R-LINK-LOCAL");
  const [importance, setImportance] = useState<Record<string, number>>({});
  const mounted = useRef(true);
  const source = sourceRun.result;
  const refresh = async () => {
    const runs = await api("/runs");
    if (!mounted.current) return;
    const evaluated = runs
      .filter(
        (r: any) =>
          r.status === "succeeded" &&
          r.result?.kind === "expert-audit-experiment" &&
          r.result.sourceRunId === sourceRun.id,
      )
      .reverse();
    setHistory(evaluated);
    setLast((current: any) => current ?? evaluated.at(-1));
    const plans = runs.filter(
      (r: any) =>
        r.status === "succeeded" &&
        r.result?.kind === "expert-audit-plan" &&
        r.result.sourceRunId === sourceRun.id,
    );
    if (plans[0]) setPlan(plans[0]);
    const active = runs.find(
      (r: any) =>
        ["audit-plan", "audit-experiment"].includes(r.operation) &&
        ["queued", "running"].includes(r.status) &&
        r.input.source?.id === sourceRun.id,
    );
    if (active) setPending(active);
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
    };
  }, [sourceRun.id]);
  useEffect(() => {
    if (!pending?.id) return;
    let stopped = false;
    const poll = async () => {
      try {
        const run = await api("/runs/" + pending.id);
        if (stopped) return;
        if (["succeeded", "failed", "cancelled"].includes(run.status)) {
          setPending(undefined);
          if (run.status !== "succeeded")
            setError(run.error?.message ?? "运行已取消");
          else if (run.operation === "audit-plan") {
            setPlan(run);
            setView("plan");
          } else {
            setLast(run);
            setView("result");
            setSelected((ids) => [...new Set([...ids, run.id])]);
          }
          await refresh();
        } else setPending(run);
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          setPending(undefined);
        }
      }
    };
    const timer = setInterval(() => void poll(), 1000);
    void poll();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending?.id]);
  const start = async (kind: "plan" | "evaluate") => {
    setLoading(true);
    setError("");
    try {
      const run = await api(
        "/audit/" + kind,
        kind === "plan"
          ? {
              sourceRunId: sourceRun.id,
              options: {
                ...source.request.optimization,
                enabled: true,
                planningCards,
                importance: { [String(planningCards)]: importance },
              },
            }
          : {
              sourceRunId: sourceRun.id,
              name,
              configuration,
              planRunId: adoptedPlanId,
            },
      );
      if (mounted.current) setPending(run);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  const busy = loading || !!pending;
  const updatePolicy = (code: string, key: string, value: number) =>
    setConfiguration((c) => ({
      ...c,
      policy: { ...c.policy, [code]: { ...c.policy?.[code], [key]: value } },
    }));
  const updateModel = (key: string, value: number) =>
    setConfiguration((c) => ({ ...c, model: { ...c.model, [key]: value } }));
  const fields = [
    {
      label: "第二轮静默检出覆盖率（%）",
      code: "D-SDC",
      key: "coverage",
      percent: true,
    },
    { label: "第二轮静默发现时延（秒）", code: "D-SDC", key: "detectSeconds" },
    { label: "第二轮检查点保存阻塞（秒）", code: "C-FAST", key: "saveSeconds" },
    { label: "第二轮检查点周期（秒）", code: "C-FAST", key: "computeSeconds" },
    {
      label: "第二轮弹性完整恢复（秒）",
      code: "R-ELASTIC",
      key: "recoverSeconds",
    },
    {
      label: "第二轮全局恢复耗时（秒）",
      code: "model",
      key: "recoveryAttemptSeconds",
    },
  ];
  const rows = [
    { id: sourceRun.id, name: "第一轮现状 · 原六项", result: source },
    ...history,
  ];
  const rowFor = (run: any) =>
    run.result.kind === "expert-review-audit"
      ? run.result.rows.find(
          (r: any) => r.cards === scale && r.id === "combined",
        )
      : run.result.rows.find((r: any) => r.cards === scale);
  const target =
    scale === source.request.cards
      ? source.request.target
      : (source.request.targets?.[String(scale)] ?? source.request.target);
  return (
    <section
      className="paper audit-experiments"
      aria-label="分轮评估与横向比较"
    >
      <div className="section-head">
        <div>
          <span className="eyebrow">每轮独立保存 · 你决定何时计算</span>
          <h2>分轮评估与横向比较</h2>
        </div>
        <span className="badge">主规模目标 {pct(source.request.target)}</span>
      </div>
      <div className="round-flow">
        <div>
          <b>① 第一轮现状已完成</b>
          <span>
            原六项 · 静默检出率 {pct(source.config.policy["D-SDC"].coverage)}
          </span>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <b>② AGREE生成分配建议</b>
          <span>核对目标、重要度和机制参数</span>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <b>③ 点击评估改进方案</b>
          <span>独立结果 · 可反复修改和对比</span>
        </div>
      </div>
      <p>
        第一轮结果和95%等现状参数已冻结。生成建议只给出待评估方案；你载入或自行修改参数，再点击评估，才会产生新的结果。
      </p>
      <div className="experiment-actions">
        <a href={url(`/runs/${sourceRun.id}/report?format=html`)}>
          下载第一轮现状报告
        </a>
        <label>
          改进分配规模
          <select
            aria-label="改进分配规模"
            value={planningCards}
            onChange={(event) => {
              setPlanningCards(Number(event.target.value));
              setImportance({});
            }}
          >
            {source.rows
              .filter(
                (row: any) =>
                  row.id === "combined" &&
                  (row.cards !== 1000 ||
                    source.request.targets?.["1000"] !== undefined),
              )
              .map((row: any) => (
                <option key={row.cards} value={row.cards}>
                  {row.cards.toLocaleString()} 卡 ·{" "}
                  {pct(
                    row.cards === source.request.cards
                      ? source.request.target
                      : (source.request.targets?.[String(row.cards)] ??
                          source.request.target),
                  )}
                </option>
              ))}
          </select>
        </label>
        <button disabled={busy} onClick={() => void start("plan")}>
          生成AGREE改进分配
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setConfiguration({
              ...blank(),
              policy: { "D-SDC": { coverage: 0.995 } },
            });
            setName("仅提高静默检出率至99.5%");
            setView("configuration");
            setAdoptedPlanId(undefined);
          }}
        >
          仅提高静默检出率至99.5%
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setConfiguration(blank());
            setName("现状复核");
            setView("configuration");
            setAdoptedPlanId(undefined);
          }}
        >
          恢复第一轮参数
        </button>
      </div>
      <nav className="experiment-view-tabs" aria-label="分轮操作">
        <button
          onClick={() =>
            document
              .getElementById("design-result")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          查看第一轮
        </button>
        {[
          { id: "plan", name: "分配建议", disabled: !plan },
          { id: "configuration", name: "编辑改进方案" },
          { id: "result", name: "本轮结论", disabled: !last },
          { id: "comparison", name: "横向比较" },
        ].map((tab) => (
          <button
            key={tab.id}
            disabled={tab.disabled}
            aria-current={view === tab.id ? "page" : undefined}
            onClick={() => setView(tab.id)}
          >
            {tab.name}
          </button>
        ))}
      </nav>
      <details>
        <summary>AGREE重要度与目标约束</summary>
        <p>
          先用第一轮Shapley形成可编辑重要度，分配改进责任，再以主规模总可用度目标反解参数。其他规模独立显示结果；不合并成一套最严参数，不要求各损失子预算都通过。
        </p>
        <div className="fields">
          {(
            source.attribution.find((a: any) => a.cards === planningCards)
              ?.contributions ?? []
          ).map((c: any) => (
            <label key={c.id}>
              {c.name} · 重要度
              <input
                aria-label={"第二轮分配重要度 " + c.id}
                type="number"
                min="0.01"
                max="1"
                step=".01"
                placeholder="按本次Shapley自动计算"
                value={importance[c.id] ?? ""}
                onChange={(e) => {
                  const next = { ...importance };
                  if (e.target.value === "") delete next[c.id];
                  else next[c.id] = Number(e.target.value);
                  setImportance(next);
                }}
              />
            </label>
          ))}
        </div>
      </details>
      {pending && (
        <p role="status">
          {pending.operation === "audit-plan"
            ? "正在生成分配建议（不会启动第二轮评估）"
            : "正在独立评估本次方案"}{" "}
          · {Math.round(pending.progress * 100)}%
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {plan && view === "plan" && (
        <div className="experiment-plan">
          <AuditExperimentResult result={plan.result} />
          <button
            disabled={busy}
            onClick={() => {
              setConfiguration(structuredClone(plan.result.configuration));
              setName("AGREE分配后的改进方案");
              setAdoptedPlanId(plan.id);
              setView("configuration");
            }}
          >
            载入AGREE分配建议
          </button>
          <p className="note">
            尚未运行第二轮。载入后仍可修改参数；规划试算值不作正式达标结论。
          </p>
        </div>
      )}
      <fieldset className="experiment-editor" hidden={view !== "configuration"}>
        <legend>本次待评估的改进方案</legend>
        <label>
          方案名称
          <input
            aria-label="改进方案名称"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="fields">
          {fields.map((f) => {
            const baseline =
              f.code === "model"
                ? source.config.model[f.key]
                : source.config.policy[f.code][f.key];
            const value =
              f.code === "model"
                ? (configuration.model?.[f.key] ?? baseline)
                : (configuration.policy?.[f.code]?.[f.key] ?? baseline);
            return (
              <label key={f.label}>
                {f.label}
                <input
                  aria-label={f.label}
                  type="number"
                  min={f.key === "computeSeconds" ? 1 : 0}
                  max={f.percent ? 100 : 31536000}
                  step="any"
                  value={f.percent ? Number((value * 100).toFixed(6)) : value}
                  onChange={(e) => {
                    const next = Number(e.target.value) / (f.percent ? 100 : 1);
                    if (f.code === "model") updateModel(f.key, next);
                    else updatePolicy(f.code, f.key, next);
                  }}
                />
                <small>
                  第一轮：{f.percent ? pct(baseline) : baseline}；只修改本次方案
                </small>
              </label>
            );
          })}
        </div>
        <details>
          <summary>其他机制参数与正常态成本</summary>
          <NumericParameters
            prefix="第二轮基础能力"
            value={{ ...source.request.model, ...configuration.model }}
            onChange={(value) =>
              setConfiguration((c) => ({ ...c, model: value }))
            }
          />
          {[
            ...new Set<string>(
              (source.request.mechanisms ?? [])
                .map(
                  (id: string) =>
                    (
                      ({
                        sdcDetect: "D-SDC",
                        step: "R-SDC",
                        replay: "R-REPLAY",
                        process: "R-PROCESS",
                        elastic: "R-ELASTIC",
                        fast: "C-FAST",
                        hardDetect: "D-HARD",
                        slowDetect: "D-SLOW",
                      }) as Record<string, string>
                    )[id],
                )
                .filter(Boolean),
            ),
          ].map((code) => (
            <NumericParameters
              key={code}
              prefix={"第二轮 " + code}
              value={{
                ...source.config.policy[code],
                ...configuration.policy?.[code],
              }}
              onChange={(value) =>
                setConfiguration((c) => ({
                  ...c,
                  policy: { ...c.policy, [code]: value },
                }))
              }
            />
          ))}
          <p className="note">
            默认保留第一轮成本假设。提高覆盖率若增加校验开销，请在上方填写“新增检测与复核开销”后再次评估。
          </p>
        </details>
        <details>
          <summary>高级：故障模式FIT方案（需明确来源）</summary>
          <p>
            仅填写已论证的事件目标；每项保留来源，不从可用度缺口自动降低FIT。
          </p>
          <EventEditor
            title="第二轮 FIT目标"
            events={source.events}
            value={JSON.stringify(configuration.fitTargets ?? [])}
            onChange={(value) =>
              setConfiguration((current) => ({
                ...current,
                fitTargets: JSON.parse(value),
              }))
            }
          />
        </details>
        <details>
          <summary>新增专家机制（16项，按范围与成本评估）</summary>
          <label>
            新增机制
            <select
              aria-label="新增专家机制"
              value={extensionId}
              onChange={(e) => setExtensionId(e.target.value)}
            >
              {auditExtensionCatalog.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.id}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={(configuration.extensions ?? []).some(
              (e) => e.id === extensionId,
            )}
            onClick={() =>
              setConfiguration((c) => ({
                ...c,
                extensions: [
                  ...(c.extensions ?? []),
                  extensionScenario(extensionId),
                ],
              }))
            }
          >
            加入本次方案
          </button>
          {(configuration.extensions ?? []).map((e) => (
            <div className="extension-card" key={e.id}>
              <h4>{auditExtensionCatalog.find((m) => m.id === e.id)!.name}</h4>
              <p>{e.source}</p>
              <NumericParameters
                prefix={e.id}
                value={e.parameters}
                onChange={(parameters) =>
                  setConfiguration((c) => ({
                    ...c,
                    extensions: c.extensions!.map((m) =>
                      m.id === e.id ? { ...m, parameters } : m,
                    ),
                  }))
                }
              />
              <button
                onClick={() =>
                  setConfiguration((c) => ({
                    ...c,
                    extensions: c.extensions!.filter((m) => m.id !== e.id),
                  }))
                }
              >
                移除 {e.id}
              </button>
            </div>
          ))}
        </details>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void start("evaluate")}
        >
          评估本次改进方案
        </button>
        <p className="note">
          每次点击创建一个独立运行，采用表中明确参数；不会自动替换为更严参数或自动提高可用度目标。
        </p>
      </fieldset>
      {last && view === "result" && (
        <div className="experiment-latest">
          <h3>刚完成：{last.result.name}</h3>
          <button
            onClick={() => {
              setConfiguration(structuredClone(last.result.configuration));
              setName(last.result.name + " · 迭代");
              setAdoptedPlanId(last.result.planningRunId);
              setView("configuration");
            }}
          >
            继续修改这个方案
          </button>
          <a href={url(`/runs/${last.id}/report?format=html`)}>
            下载本次独立评估报告
          </a>
          <AuditExperimentResult result={last.result} />
        </div>
      )}
      <div hidden={view !== "comparison"}>
        <h3>各轮结果横向比较</h3>
        <label>
          查看规模
          <select
            aria-label="多轮比较规模"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          >
            {source.rows
              .filter((r: any) => r.id === "combined")
              .map((r: any) => (
                <option key={r.cards} value={r.cards}>
                  {r.cards.toLocaleString()} 卡
                </option>
              ))}
          </select>
        </label>
        <div className="table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>选择</th>
                <th>已完成评估</th>
                <th>可用度</th>
                <th>95%均值区间</th>
                <th>目标</th>
                <th>结论</th>
                <th>结果与报告</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => {
                const row = rowFor(run),
                  state =
                    row.statistics.ciLow >= target
                      ? "supported"
                      : row.statistics.ciHigh < target
                        ? "below"
                        : "uncertain";
                return (
                  <tr key={run.id}>
                    <td>
                      <input
                        aria-label={"选择对比 " + run.id}
                        type="checkbox"
                        disabled={run.id === sourceRun.id}
                        checked={selected.includes(run.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, run.id]
                              : ids.filter((id) => id !== run.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {run.name ?? run.result.name}
                      <small className="experiment-run-id">
                        {run.id.slice(0, 8)}
                      </small>
                    </td>
                    <td>{pct(row.statistics.mean)}</td>
                    <td>
                      {pct(row.statistics.ciLow)} ～{" "}
                      {pct(row.statistics.ciHigh)}
                    </td>
                    <td>
                      {scale === 1000 && !source.request.targets?.["1000"]
                        ? "参考点"
                        : pct(target)}
                    </td>
                    <td>
                      {scale === 1000 && !source.request.targets?.["1000"]
                        ? "参考点"
                        : experimentStatus[state]}
                    </td>
                    <td>
                      <a href={url(`/runs/${run.id}/report?format=html`)}>
                        独立报告
                      </a>
                      {run.id !== sourceRun.id && (
                        <button
                          onClick={() => {
                            setLast(run);
                            setView("result");
                          }}
                        >
                          查看本轮结果
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          disabled={busy || selected.length < 2}
          onClick={async () => {
            setError("");
            try {
              setComparison(await api("/audit/compare", { runIds: selected }));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          生成所选评估的对比报告
        </button>
        {comparison && (
          <>
            <a
              className="experiment-export"
              href={url(`/runs/${comparison.id}/report?format=html`)}
            >
              下载多次评估对比报告
            </a>
            <AuditExperimentResult result={comparison.result} />
          </>
        )}
      </div>
    </section>
  );
}

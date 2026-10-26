import { summaryScaleLabel } from "../../../packages/reports/src/audit-scale-summary";
import { auditSummaryRows } from "../../../packages/contracts/src/audit-presets";
import { useEffect, useRef, useState } from "react";
import { useTaskApi } from "./api";
import type { AuditOptimizationRequest } from "../../../packages/contracts/src/audit-optimization";
import {
  auditExtensionCatalog,
  extensionScenario,
} from "../../../packages/contracts/src/audit-extensions";
import { NumericParameters, EventEditor } from "./AuditEditors";
import AuditExperimentResult from "./AuditExperimentResult";
import AuditParameterEditor from "./AuditParameterEditor";
import AuditPlanningEditor from "./AuditPlanningEditor";
import { planningMethodNames } from "../../../packages/contracts/src/audit-planning";
import type { AuditPlanningOptions } from "../../../packages/contracts/src/audit-planning";
import { auditMechanismSummary } from "../../../packages/contracts/src/audit-mechanism-view";
import { auditReferenceOnly } from "../../../packages/contracts/src/audit-presets";
import { experimentStatus } from "../../../packages/reports/src/audit-experiments";
import { auditPercent as pct } from "../../../packages/contracts/src/audit-recovery-budget";
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
  const [planSet, setPlanSet] = useState<any>();
  const [planning, setPlanning] = useState<AuditPlanningOptions>(
    sourceRun.result.request.optimization?.planning ?? {},
  );
  const [alternativeId, setAlternativeId] = useState<string>();
  const [adoptedAlternativeId, setAdoptedAlternativeId] = useState<string>();
  const [adoptedPlanCards, setAdoptedPlanCards] = useState<number>();
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
  const [extensionId, setExtensionId] = useState(
    auditExtensionCatalog[0]?.id ?? "",
  );
  const [importanceByScale, setImportanceByScale] = useState<
    Record<string, Record<string, number>>
  >(() =>
    structuredClone(sourceRun.result.request.optimization?.importance ?? {}),
  );
  const importance = importanceByScale[String(planningCards)] ?? {};
  const setImportance = (values: Record<string, number>) =>
    setImportanceByScale((current) => ({
      ...current,
      [String(planningCards)]: values,
    }));
  const mounted = useRef(true);
  const source = sourceRun.result;
  const chosenAlternative = plan?.result.decisionStudy?.alternatives.find(
    (a: any) =>
      a.id === (alternativeId ?? plan.result.decisionStudy.recommendedId),
  );
  useEffect(() => setAlternativeId(undefined), [plan?.id, plan?.planCards]);
  const mechanismSummary = auditMechanismSummary(
    source.request,
    source.selection,
  );
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
    if (plans[0])
      setPlan((current: any) =>
        current?.planCards !== undefined ? current : plans[0],
      );
    const sets = runs.filter(
      (r: any) =>
        r.status === "succeeded" &&
        r.result?.kind === "expert-audit-plan-set" &&
        r.result.sourceRunId === sourceRun.id,
    );
    if (sets[0]) setPlanSet(sets[0]);
    const active = runs.find(
      (r: any) =>
        ["audit-plan", "audit-plan-scales", "audit-experiment"].includes(
          r.operation,
        ) &&
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
          else if (run.operation === "audit-plan-scales") {
            setPlanSet(run);
            setView("scale-plans");
          } else if (run.operation === "audit-plan") {
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
  const start = async (kind: "plan" | "plan-scales" | "evaluate") => {
    setLoading(true);
    setError("");
    try {
      const run = await api(
        "/audit/" + kind,
        kind === "plan-scales"
          ? {
              sourceRunId: sourceRun.id,
              options: {
                ...source.request.optimization,
                planningCards: undefined,
                enabled: true,
                importance: importanceByScale,
                planning,
              },
            }
          : kind === "plan"
            ? {
                sourceRunId: sourceRun.id,
                options: {
                  ...source.request.optimization,
                  enabled: true,
                  planningCards,
                  importance: { [String(planningCards)]: importance },
                  planning,
                },
              }
            : {
                sourceRunId: sourceRun.id,
                name,
                configuration,
                planRunId: adoptedPlanId,
                planCards: adoptedPlanCards,
                planAlternativeId: adoptedAlternativeId,
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
  const canPlan = source.attribution?.some(
    (row: any) => row.contributions?.length,
  );
  const rows = [
    { id: sourceRun.id, name: "第一轮现状", result: source },
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
      id="audit-scale-plans"
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
            {mechanismSummary.title}
            <small>{mechanismSummary.roles}</small>
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
      <details>
        <summary>现状措施与能力范围</summary>
        <p>
          {mechanismSummary.names.length
            ? mechanismSummary.names.join("、")
            : "使用基础模型，未选择附加措施。"}
        </p>
        <p>
          {mechanismSummary.roles}
          ；基础模型包含的检测、保存和兜底路径按当前输入计算。
        </p>
      </details>
      <p>
        现状方案的措施选择、参数和结果已冻结。生成建议只给出待评估方案；你载入或自行修改参数，再点击评估，才会产生新的结果。
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
            }}
          >
            {auditSummaryRows(source.request, source.rows)
              .filter(
                (row: any) =>
                  row.id === "combined" &&
                  !auditReferenceOnly(source.request, row.cards),
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
        <button
          disabled={busy || !canPlan}
          onClick={() => void start("plan-scales")}
        >
          按各规模分别生成改进建议
        </button>
        <button disabled={busy || !canPlan} onClick={() => void start("plan")}>
          {planning.method && planning.method !== "agree"
            ? "生成" + planningMethodNames[planning.method] + "改进分配"
            : "生成AGREE改进分配"}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setConfiguration(blank());
            setName("自定义改进方案");
            setView("configuration");
            setAdoptedPlanId(undefined);
            setAdoptedAlternativeId(undefined);
            setAdoptedPlanCards(undefined);
          }}
        >
          新建参数方案
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setConfiguration(blank());
            setName("现状复核");
            setView("configuration");
            setAdoptedPlanId(undefined);
            setAdoptedAlternativeId(undefined);
            setAdoptedPlanCards(undefined);
          }}
        >
          恢复第一轮参数
        </button>
      </div>
      <p className="note">
        “按各规模分别生成改进建议”分别规划全部需求规模；“生成AGREE改进分配”仅规划上方选中规模。重要度编辑按规模分别保存。
      </p>
      {!canPlan && (
        <p className="note">
          现状尚无可分配的候选贡献，可先补充Shapley分析，或直接新建参数方案。
        </p>
      )}
      <AuditPlanningEditor
        sourceRun={sourceRun}
        value={planning}
        onChange={setPlanning}
        disabled={busy}
      />
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
          { id: "scale-plans", name: "各规模建议汇总", disabled: !planSet },
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
          先沿架构定位各规模薄弱点，仅在措施适用的故障范围内按第一轮Shapley形成重要度与责任，再用AGREE及总目标反解参数。其他规模独立显示结果；不合并成一套最严参数，不要求各损失子预算都通过。
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
          {["audit-plan", "audit-plan-scales"].includes(pending.operation)
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
      {planSet && view === "scale-plans" && (
        <div className="scale-plan-set">
          <AuditExperimentResult result={planSet.result} />
          <a href={url(`/runs/${planSet.id}/report?format=html`)}>
            下载各规模改进建议汇总报告
          </a>
          <p className="note">
            每个规模都有独立方案；选择一个查看明细、载入并单独评估，规划结果不会自动进入已完成评估比较。
          </p>
          <div className="experiment-actions">
            {planSet.result.plans.map((p: any) => (
              <button
                key={p.prediction.cards}
                disabled={busy}
                onClick={() => {
                  setPlan({
                    id: planSet.id,
                    result: p,
                    planCards: p.prediction.cards,
                  });
                  setView("plan");
                }}
              >
                查看{summaryScaleLabel(p.prediction.cards)}改进建议
              </button>
            ))}
          </div>
        </div>
      )}
      {plan && view === "plan" && (
        <div className="experiment-plan">
          {plan.result.decisionStudy && (
            <label>
              查看备选方案
              <select
                aria-label="查看规划备选方案"
                value={chosenAlternative?.id ?? ""}
                onChange={(e) => setAlternativeId(e.target.value)}
              >
                {plan.result.decisionStudy.alternatives.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · 工作量{a.effort} ·{" "}
                    {pct(a.nominal.statistics.mean)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <AuditExperimentResult
            result={plan.result}
            alternativeId={chosenAlternative?.id}
          />
          <button
            disabled={busy}
            onClick={() => {
              setConfiguration(
                structuredClone(
                  chosenAlternative?.configuration ?? plan.result.configuration,
                ),
              );
              setName(
                plan.planCards
                  ? `${summaryScaleLabel(plan.planCards)} · AGREE改进方案`
                  : "AGREE分配后的改进方案",
              );
              setAdoptedPlanId(plan.id);
              setAdoptedPlanCards(plan.planCards);
              setAdoptedAlternativeId(chosenAlternative?.id);
              setView("configuration");
            }}
          >
            载入AGREE分配建议
          </button>
          <p className="note">
            尚未评估此建议方案。载入后仍可修改参数；规划试算值不作正式达标结论。
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
        <AuditParameterEditor
          source={source}
          configuration={configuration}
          onChange={setConfiguration}
        />
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
          <summary>
            新增机制（{auditExtensionCatalog.length}项可选，按范围与成本评估）
          </summary>
          <label>
            新增机制
            <select
              aria-label="新增可靠性机制"
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
              setAdoptedPlanCards(last.result.planningCards);
              setAdoptedAlternativeId(last.result.planningAlternativeId);
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
            {auditSummaryRows(source.request, source.rows)
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
                      {auditReferenceOnly(source.request, scale)
                        ? "参考点"
                        : pct(target)}
                    </td>
                    <td>
                      {auditReferenceOnly(source.request, scale)
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

import AuditAnalysisWorkbench from "./AuditAnalysisWorkbench";
import AuditTrainingScenarioHistory from "./AuditTrainingScenarioHistory";
import { auditSummaryScales } from "../../../packages/contracts/src/audit-presets";
import AuditArchitectureResult from "./AuditArchitectureResult";
import { useId, useState } from "react";
import { useTaskApi } from "./api";
import WorkspaceViewTabs, { useViewPreference } from "./WorkspaceViewTabs";
import AuditRunContext from "./AuditRunContext";
import AuditContribution from "./AuditContribution";
import AuditReliabilityDiagram from "./AuditReliabilityDiagram";
import AuditOptimizationResult from "./AuditOptimizationResult";
import { gainExplanation } from "../../../packages/reports/src/audit-contributions";
import {
  auditSummary,
  auditScaleSummary,
} from "../../../packages/reports/src/audit-summary";
import {
  auditChartCss,
  auditGainChart,
  auditScaleCurve,
  auditSensitivityCurves,
} from "../../../packages/reports/src/audit-charts";
const pct = (v: number) => (v * 100).toFixed(3) + "%";
export default function AuditResult({
  result: r,
  onApply,
}: {
  result: any;
  onApply?: (request: any) => void;
}) {
  const [scale, setScale] = useState(r.request.cards);
  const viewId = useId();
  const { taskId } = useTaskApi();
  const [savedView, setView] = useViewPreference(
    `remap.results.${taskId}`,
    r.optimization ? "decision" : "overview",
  );
  const view =
    savedView === "decision" && !r.optimization ? "overview" : savedView;
  const [legacyOpen, setLegacyOpen] = useState(view === "all");
  const visible = (name: string) => view === "all" || view === name;
  const cards = r.rows.some((x: any) => x.cards === scale)
    ? scale
    : r.request.cards;
  const s = auditSummary(r, cards);
  const overview = auditScaleSummary(r);
  const selected = r.rows.filter((row: any) => row.cards === cards);
  const budget = r.designReview?.scales.find((x: any) => x.cards === cards);
  const recommendation = r.recommendation;
  const layerDiagnosis = r.architectureDiagnosis?.scales.find(
    (item: any) => item.cards === cards,
  );
  return (
    <>
      <h3>可靠性设计与评估 · 结果</h3>
      {r.request.trainingScenario && <AuditTrainingScenarioHistory />}
      <AuditAnalysisWorkbench
        result={r}
        cards={cards}
        onCardsChange={setScale}
      />
      <details
        className="audit-detail"
        open={legacyOpen}
        onToggle={(e) => setLegacyOpen(e.currentTarget.open)}
      >
        <summary>补充查看原有方案收益、贡献与敏感性</summary>
        <WorkspaceViewTabs
          name="评估结果视图"
          value={view}
          onChange={setView}
          idPrefix={viewId}
          panelId={`${viewId}-panel`}
          options={[
            ...(r.optimization ? [{ id: "decision", label: "两轮决策" }] : []),
            {
              id: "overview",
              label: r.optimization ? "第一轮现状" : "结论概览",
            },
            { id: "gains", label: "方案收益" },
            { id: "architecture", label: "分层诊断" },
            { id: "diagram", label: "可靠性框图" },
            {
              id: "contributions",
              label: r.optimization ? "现状贡献" : "贡献分摊",
            },
            { id: "risks", label: "风险与敏感性" },
            { id: "all", label: "全部分析" },
          ]}
        />
        <div
          id={`${viewId}-panel`}
          role="tabpanel"
          aria-labelledby={`${viewId}-${view}`}
          tabIndex={0}
        >
          <div className="workspace-result-panel" hidden={!visible("decision")}>
            <AuditOptimizationResult result={r} onApply={onApply} />
          </div>
          <AuditRunContext result={r} cards={cards} open={view === "all"} />
          {overview.total > 1 && (
            <p className="note">
              第一轮核对 {overview.total} 个规模：采样支持 {overview.supported}{" "}
              个，低于目标 {overview.below} 个，证据不足 {overview.uncertain}{" "}
              个。下方判读针对当前查看规模，不代表所有规模达标。
            </p>
          )}
          <label className="audit-scale">
            查看规模
            <select
              aria-label="结果规模"
              value={cards}
              onChange={(e) => setScale(Number(e.target.value))}
            >
              {auditSummaryScales(
                r.request,
                r.rows.map((x: any) => x.cards),
              ).map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} 卡
                </option>
              ))}
            </select>
          </label>
          <div
            className="workspace-result-panel"
            hidden={!visible("architecture")}
          >
            <AuditArchitectureResult result={r} cards={cards} />
          </div>
          <div className="workspace-result-panel" hidden={!visible("diagram")}>
            <AuditReliabilityDiagram
              events={r.events}
              result={r}
              cards={cards}
            />
          </div>
          <div className="workspace-result-panel" hidden={!visible("overview")}>
            <div className={"audit-verdict " + s.status}>
              <strong>{s.statusLabel}</strong>
              <p>{s.next}</p>
            </div>
            <div className="audit-metrics">
              <div>
                <span>基线可用度</span>
                <strong>{pct(s.base.statistics.mean)}</strong>
                <small>当前故障与恢复假设</small>
              </div>
              <div>
                <span>组合可用度</span>
                <strong>{pct(s.combined.statistics.mean)}</strong>
                <small>
                  95% 区间 {pct(s.combined.statistics.ciLow)} ～{" "}
                  {pct(s.combined.statistics.ciHigh)}
                </small>
              </div>
              <div>
                <span>新增正确计算</span>
                <strong>
                  {s.additionalHours.toFixed(2)} <small>小时</small>
                </strong>
                <small>{(s.gain * 100).toFixed(3)} 个百分点 · 单窗口</small>
              </div>
              <div>
                <span>距目标（均值 − 目标）</span>
                <strong>
                  {s.referenceOnly ? (
                    "参考规模"
                  ) : (
                    <>
                      {s.gap >= 0 ? "+" : ""}
                      {(s.gap * 100).toFixed(3)} <small>pp</small>
                    </>
                  )}
                </strong>
                <small>
                  {s.referenceOnly
                    ? "未设置需求目标"
                    : `目标 ${pct(s.target)}；pp 为百分点`}
                </small>
              </div>
            </div>
            {layerDiagnosis && (
              <div className="arch-brief">
                <b>分层诊断重点：</b>
                {layerDiagnosis.weaknesses[0]
                  ? `${layerDiagnosis.weaknesses[0].name} · ${layerDiagnosis.weaknesses[0].focus}`
                  : "本次未形成薄弱点排序，可继续核对架构、故障数据和目标。"}
                <br />
                <button type="button" onClick={() => setView("architecture")}>
                  查看分层目标与跨规模薄弱点
                </button>
              </div>
            )}
            {budget && (
              <section aria-label="预算与实际损失">
                <h3>预算与实际损失</h3>
                <p>
                  允许损失 {budget.allowedHours.toFixed(3)} 小时；实际{" "}
                  {budget.actualLossHours.toFixed(3)} 小时；
                  {budget.excessHours > 0 ? "超出" : "余量"}{" "}
                  {Math.abs(budget.excessHours).toFixed(3)} 小时。
                </p>
                <p className="note">
                  无故障参考可用度：基线 {pct(r.designReview.baselineNoFault)}
                  ，所选检查点策略 {pct(r.designReview.selectedNoFault)}
                  。这是保存开销参考，不是任意故障与机制下的可行性上界。
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>损失项</th>
                        <th>预算 / 小时</th>
                        <th>实际 / 小时</th>
                        <th>建议核查</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budget.items.map((x: any) => (
                        <tr key={x.id}>
                          <td>{x.name}</td>
                          <td>{x.allowedHours?.toFixed(3) ?? "未分配"}</td>
                          <td>
                            {x.actualHours.toFixed(3)}
                            {x.excessHours > 0 ? " · 超预算" : ""}
                          </td>
                          <td>{x.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {recommendation && (
              <section aria-label="候选决策与独立复核">
                <h3>候选决策与独立复核</h3>
                <p className="note">
                  这是平台扩展的筛选建议；本次实际组合以前面的冻结清单为准。载入建议后需重新确认并计算。
                </p>
                <p>
                  {r.request.cards.toLocaleString()} 卡 · 已比较{" "}
                  {recommendation.candidateCount} 个候选。{recommendation.rule}
                </p>
                <p>
                  建议组合：
                  <strong>
                    {recommendation.chosen.mechanisms
                      .map(
                        (id: string) =>
                          r.rows.find((m: any) => m.id === id)?.name ?? id,
                      )
                      .join(" + ") || "基线"}
                  </strong>
                  ；筛选均值 {pct(recommendation.chosen.statistics.mean)}；成本{" "}
                  {recommendation.chosen.cost ?? "未完整提供"}。
                </p>
                {recommendation.verification ? (
                  <p>
                    独立复核 {recommendation.verification.trials} 条轨迹：
                    {pct(recommendation.verification.statistics.mean)}，95%
                    均值区间 {pct(recommendation.verification.statistics.ciLow)}{" "}
                    ～ {pct(recommendation.verification.statistics.ciHigh)}
                    。结论：
                    {
                      (
                        {
                          supported: "采样支持达到目标",
                          below: "仍低于目标",
                          uncertain: "目标附近，证据不足",
                        } as any
                      )[recommendation.verification.status]
                    }
                    。此复核不替代现场数据验证。
                  </p>
                ) : (
                  <p>尚未执行独立复核，筛选数据不能同时作为独立验证证据。</p>
                )}
                <button
                  disabled={!onApply}
                  onClick={() =>
                    onApply?.({
                      ...r.request,
                      mechanisms: recommendation.chosen.mechanisms,
                    })
                  }
                >
                  载入建议组合，重新确认
                </button>
              </section>
            )}
          </div>
          <div className="workspace-result-panel" hidden={!visible("risks")}>
            <h3>产出损失去了哪里</h3>
            <p className="note">
              橙色为基线，绿色为组合；全部折算为单作业窗口的等效计算小时。
            </p>
            <div className="audit-loss-chart">
              {s.losses.map((l) => (
                <div className="audit-loss-row" key={l.key}>
                  <span>{l.name}</span>
                  <div>
                    {(["base", "combined"] as const).map((k) => (
                      <div className="audit-bar-line" key={k}>
                        <div className="audit-bar-track">
                          <i
                            className={k}
                            style={{
                              width: `${(Math.max(0, l[k]) / Math.max(1, ...s.losses.flatMap((v) => [v.base, v.combined]))) * 100}%`,
                            }}
                          />
                        </div>
                        <small>{l[k].toFixed(2)} h</small>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <details className="audit-detail" open>
              <summary>优先核对的故障事件</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>事件</th>
                      <th>基线损失 h</th>
                      <th>组合剩余 h</th>
                      <th>数据证据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.drivers.map((d: any) => (
                      <tr key={d.id}>
                        <td>
                          <strong>{d.id}</strong>
                          <br />
                          {d.name}
                        </td>
                        <td>{d.loss.toFixed(3)}</td>
                        <td>{d.remaining.toFixed(3)}</td>
                        <td>
                          {d.evidence === "internal-measured"
                            ? "观测数据"
                            : d.evidence === "scenario"
                              ? "方案假设"
                              : "参考数据"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                按基线损失排序，排除公共保存开销；排序用于定位问题，不代表实施收益排名。
              </p>
            </details>
          </div>
          <div className="workspace-result-panel" hidden={!visible("gains")}>
            <h3>单项与组合方案收益对照</h3>
            <p>{gainExplanation}</p>
            <p>
              {cards.toLocaleString()} 卡 · {r.request.hours} 小时 · 目标{" "}
              {pct(s.target)}。基线、单项与组合使用同一批种子。
            </p>
            <details className="audit-curves" open>
              <summary>规模趋势与机制收益图</summary>
              <style>{auditChartCss}</style>
              <div
                dangerouslySetInnerHTML={{
                  __html: auditScaleCurve(r) + auditGainChart(r, cards),
                }}
              />
            </details>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>方案</th>
                    <th>可用度</th>
                    <th>均值 95% 区间</th>
                    <th>相比基线</th>
                    <th>新增正确小时</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((row: any) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{pct(row.statistics.mean)}</td>
                      <td>
                        {pct(row.statistics.ciLow)} ～{" "}
                        {pct(row.statistics.ciHigh)}
                      </td>
                      <td>{(100 * row.delta.mean).toFixed(3)} pp</td>
                      <td>{(r.request.hours * row.delta.mean).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div
            className="workspace-result-panel"
            hidden={!visible("contributions")}
          >
            <style>{auditChartCss}</style>
            <AuditContribution result={r} cards={cards} onScale={setScale} />
          </div>
          <div className="workspace-result-panel" hidden={!visible("risks")}>
            {!!r.sensitivity?.length && (
              <details className="audit-curves" open>
                <summary>关键参数敏感性曲线</summary>
                <div
                  dangerouslySetInnerHTML={{
                    __html: auditSensitivityCurves(r),
                  }}
                />
              </details>
            )}
          </div>
          <p>
            完整报告含独立故障事件库、数据来源、机制前置条件、失败回退、逐事件损失变化和决策依据。采样通过不等于现场参数与工程能力已经验证。
          </p>
        </div>
      </details>
    </>
  );
}

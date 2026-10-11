import { useState } from "react";
import { auditSummary } from "../../../packages/reports/src/audit-summary";
const pct = (v: number) => (v * 100).toFixed(3) + "%";
export default function AuditResult({
  result: r,
  onApply,
}: {
  result: any;
  onApply?: (request: any) => void;
}) {
  const [scale, setScale] = useState(r.request.cards);
  const cards = r.rows.some((x: any) => x.cards === scale)
    ? scale
    : r.request.cards;
  const s = auditSummary(r, cards);
  const selected = r.rows.filter((row: any) => row.cards === cards);
  const budget = r.designReview?.scales.find((x: any) => x.cards === cards);
  const recommendation = r.recommendation;
  const a = r.attribution.find((row: any) => row.cards === cards);
  return (
    <>
      <h3>事件与机制收益审核 · 保留干净检查点</h3>
      <label className="audit-scale">
        查看规模
        <select
          aria-label="结果规模"
          value={cards}
          onChange={(e) => setScale(Number(e.target.value))}
        >
          {[...new Set<number>(r.rows.map((x: any) => x.cards))].map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()} 卡
            </option>
          ))}
        </select>
      </label>
      <div className={"audit-verdict " + s.status}>
        <strong>{s.statusLabel}</strong>
        <p>{s.next}</p>
      </div>
      <div className="audit-metrics">
        <div>
          <span>基线正确产出</span>
          <strong>{pct(s.base.statistics.mean)}</strong>
          <small>当前故障与恢复假设</small>
        </div>
        <div>
          <span>组合正确产出</span>
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
            {s.gap >= 0 ? "+" : ""}
            {(s.gap * 100).toFixed(3)} <small>pp</small>
          </strong>
          <small>目标 {pct(s.target)}；pp 为百分点</small>
        </div>
      </div>
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
            无故障参考产出：基线 {pct(r.designReview.baselineNoFault)}
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
              {pct(recommendation.verification.statistics.mean)}，95% 均值区间{" "}
              {pct(recommendation.verification.statistics.ciLow)} ～{" "}
              {pct(recommendation.verification.statistics.ciHigh)}。结论：
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
                      ? "内部观测"
                      : d.evidence === "scenario"
                        ? "方案假设"
                        : "外网先验"}
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
      <h3>单项与组合对照</h3>
      <p>
        {cards.toLocaleString()} 卡 · {r.request.hours} 小时 · 目标{" "}
        {pct(s.target)}。基线、单项与组合使用同一批种子。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>方案</th>
              <th>正确产出</th>
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
                  {pct(row.statistics.ciLow)} ～ {pct(row.statistics.ciHigh)}
                </td>
                <td>{(100 * row.delta.mean).toFixed(3)} pp</td>
                <td>{(r.request.hours * row.delta.mean).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a && (
        <>
          <h3>组合贡献</h3>
          <p>
            每个子集 {a.trials} 条轨迹，本批次组合提升{" "}
            {(a.gain * 100).toFixed(3)} pp；主评估使用 {r.request.trials}{" "}
            条轨迹，采样差异会使总提升不同。 组合与单项之和的差值{" "}
            {(a.nonAdditivity * 100).toFixed(3)} pp。Shapley
            是收益分摊，恢复链为 {r.config.recoveryOrder.join(" → ")}。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>机制</th>
                  <th>Shapley 贡献</th>
                  <th>95% 区间</th>
                </tr>
              </thead>
              <tbody>
                {a.contributions.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{(100 * c.statistics.mean).toFixed(3)} pp</td>
                    <td>
                      {(100 * c.statistics.ciLow).toFixed(3)} ～{" "}
                      {(100 * c.statistics.ciHigh).toFixed(3)} pp
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p>
        完整报告含独立故障事件库、数据来源、机制前置条件、失败回退、逐事件损失变化和决策依据。采样通过不等于现场参数与工程能力已经验证。
      </p>
    </>
  );
}

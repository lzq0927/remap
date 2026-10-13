import {
  auditContributionView,
  auditContributionSummary,
  auditContributionEvidence,
} from "../../../packages/reports/src/audit-contributions";
import {
  auditContributionChart,
  auditChartCss,
} from "../../../packages/reports/src/audit-charts";

export default function AuditContribution({
  result: r,
  cards,
  onScale,
}: {
  result: any;
  cards: number;
  onScale: (cards: number) => void;
}) {
  const v = auditContributionView(r, cards),
    detail = auditContributionEvidence(r, cards);
  const scales = [...new Set<number>(r.rows.map((row: any) => row.cards))].sort(
    (a, b) => a - b,
  );
  const num = (n: number | null) => (n === null ? "历史未记录" : n.toFixed(3));
  return (
    <section aria-label="组合贡献分摊" className="audit-contribution">
      <h3>{v.title}</h3>
      <label>
        贡献分摊规模
        <select
          aria-label="贡献分摊规模"
          value={cards}
          onChange={(e) => onScale(Number(e.target.value))}
        >
          {scales.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()} 卡
            </option>
          ))}
        </select>
      </label>
      <p className="note">
        额外固定部署：{v.scope.fixedNames.join("、") || "无"}。新增候选：
        {v.scope.candidateNames.join("、") || "无"}
        。仅作探索对照、不参与本次分摊：
        {v.scope.exploratoryNames.join("、") || "无"}。
      </p>
      <p>{v.rows.length ? auditContributionSummary(v) : v.unavailable}</p>
      <style>{auditChartCss}</style>
      {!!v.rows.length && (
        <>
          <div
            dangerouslySetInnerHTML={{
              __html: auditContributionChart(r, cards),
            }}
          />
          <div className="table-wrap">
            <table aria-label="组合贡献分摊表">
              <thead>
                <tr>
                  <th>机制</th>
                  <th>Shapley贡献</th>
                  <th>95%区间</th>
                  <th>新增正确计算小时</th>
                </tr>
              </thead>
              <tbody>
                {v.rows.map((row: any) => (
                  <tr key={row.id} data-contribution-row={row.id}>
                    <td>{row.name}</td>
                    <td>{num(row.statistics.mean * 100)} pp</td>
                    <td>
                      {Number.isFinite(row.statistics.ciLow) &&
                      Number.isFinite(row.statistics.ciHigh)
                        ? `${num(row.statistics.ciLow * 100)} ～ ${num(row.statistics.ciHigh * 100)} pp`
                        : "历史未记录"}
                    </td>
                    <td>{num(row.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            新增正确计算小时按{v.windowLabel}
            折算；这是组合贡献分摊，完整方案收益另行对照。
          </p>
        </>
      )}
      <details>
        <summary>计算依据与详细审核</summary>
        {detail.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {detail.tables.map((table, i) => (
          <div className="table-wrap" key={i}>
            <table>
              <thead>
                <tr>
                  {table.heads.map((head) => (
                    <th key={head}>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row: any[], index: number) => (
                  <tr key={index}>
                    {row.map((cell, n) => (
                      <td key={n}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </details>
    </section>
  );
}

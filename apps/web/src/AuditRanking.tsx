import { useState } from "react";
export default function AuditRanking({
  result: r,
  cards,
}: {
  result: any;
  cards: number;
}) {
  const [mode, setMode] = useState("shapley");
  const ranking = r.rankings?.find((x: any) => x.cards === cards);
  if (!ranking) return null;
  const selected =
    mode === "shapley" && ranking.shapley !== null ? "shapley" : "single";
  const rows = ranking[selected],
    baseline = r.baseline;
  const mechanismName = (id: string) =>
    r.rows.find((x: any) => x.id === id)?.name ?? id;
  return (
    <section aria-label="剩余机制排序">
      <h3>剩余机制排序</h3>
      <p>
        共同基线：{baseline?.active ? "已选择的已解决条件" : "原始确认基线"}；
        {cards.toLocaleString()}卡，{r.request.hours}小时。
      </p>
      {!!baseline?.mechanisms.length && (
        <p>固定部署：{baseline.mechanisms.map(mechanismName).join("、")}。</p>
      )}
      {!!baseline?.resolvedEvents.length && (
        <details>
          <summary>
            假设已完全消除的故障 · {baseline.resolvedEvents.length}项
          </summary>
          <div className="table-wrap">
            <table aria-label="已消除故障条件表">
              <thead>
                <tr>
                  <th>故障事件</th>
                  <th>原始FIT</th>
                  <th>本次条件FIT</th>
                </tr>
              </thead>
              <tbody>
                {baseline.resolvedEvents.map((e: any) => (
                  <tr key={e.id}>
                    <td>{e.id}</td>
                    <td>{e.originalFit.toFixed(3)}</td>
                    <td>0（假设）</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            这些事件仅在本次假设中FIT置零；未改变故障库，也未据此证明工程风险已消除。
          </p>
        </details>
      )}
      {baseline?.note && <p>{baseline.note}</p>}
      <label>
        排序依据
        <select
          aria-label="剩余机制排序依据"
          value={selected}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="single">单项增量收益</option>
          <option value="shapley" disabled={ranking.shapley === null}>
            条件 Shapley 贡献
          </option>
        </select>
      </label>
      <p className="note">
        单项：A(B＋i)−A(B)；条件Shapley：在所有剩余候选加入顺序中分摊A(B＋S＋i)−A(B＋S)。B中的机制始终启用；新增成本不含已部署成本。排序按收益均值，区间重叠不能据此断言显著优劣，负收益保留。
      </p>
      <div className="table-wrap">
        <table aria-label="剩余机制增量排序表">
          <thead>
            <tr>
              <th>排名</th>
              <th>剩余机制</th>
              <th>新增收益（pp）</th>
              <th>95%区间（pp）</th>
              <th>新增正确小时</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={row.id}>
                <td>{row.rank}</td>
                <td>{row.name}</td>
                <td>{(row.statistics.mean * 100).toFixed(3)}</td>
                <td>
                  {(row.statistics.ciLow * 100).toFixed(3)} ～{" "}
                  {(row.statistics.ciHigh * 100).toFixed(3)}
                </td>
                <td>{(row.statistics.mean * r.request.hours).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p>没有剩余候选机制；可在可靠性措施中增加候选后重新评估。</p>
      )}
    </section>
  );
}

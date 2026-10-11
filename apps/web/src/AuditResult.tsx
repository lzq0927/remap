const pct = (v: number) => (v * 100).toFixed(3) + "%";
export default function AuditResult({ result: r }: { result: any }) {
  const selected = r.rows.filter((row: any) => row.cards === r.request.cards);
  const a = r.attribution.find((row: any) => row.cards === r.request.cards);
  return (
    <>
      <h3>事件与机制收益审核 · 保留干净检查点</h3>
      <p>
        {r.request.cards.toLocaleString()} 卡 · {r.request.hours} 小时 · 目标{" "}
        {pct(r.request.target)}。基线、单项与组合使用同一批种子。
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
            组合与单项之和的差值 {(a.nonAdditivity * 100).toFixed(3)}{" "}
            pp。Shapley 是收益分摊，恢复链为{" "}
            {r.config.recoveryOrder.join(" → ")}。
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

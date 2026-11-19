import { useMemo, useState } from "react";
import { measureScaleStudy } from "../../../../packages/core/src/index";
import { measureCurveSvg } from "./measure-curve";
import { useWorkbench } from "./Workbench";
import { percent, points, hours, scale } from "./format";

export default function MeasureScaleCharts() {
  const { model, analysis } = useWorkbench(),
    [direction, setDirection] = useState("all"),
    [expanded, setExpanded] = useState(false);
  const study = useMemo(() => measureScaleStudy(model), [model]);
  const filtered = study.measures.filter(
    (m) => direction === "all" || m.direction === direction,
  );
  return (
    <section className="rw-card" aria-label="逐措施跨规模收益">
      <div className="rw-card-head">
        <h2>逐措施跨规模收益 · 按50万卡单项增益排序</h2>
        <select
          aria-label="收益曲线措施分类"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        >
          <option value="all">全部措施</option>
          <option value="mtbf">提升MTBF</option>
          <option value="mttr">降低MTTR</option>
        </select>
      </div>
      <p>{study.basis}</p>
      <div className="rw-table-wrap">
        <table className="rw-table">
          <thead>
            <tr>
              <th>规模</th>
              <th>可用度目标</th>
              <th>周损失预算</th>
              <th>现状</th>
              <th>所选组合</th>
              <th>解析判断</th>
            </tr>
          </thead>
          <tbody>
            {study.rows.map((r) => (
              <tr key={r.cards}>
                <th>{scale(r.cards)}</th>
                <td>{percent(r.target, 4)}</td>
                <td>{hours(r.targetLossHours)}</td>
                <td>
                  {percent(r.baseline)} / {hours(r.baselineLossHours)}
                </td>
                <td>
                  {percent(r.combination)} / {hours(r.combinationLossHours)}
                </td>
                <td>{r.met ? "达标，待独立仿真" : "未达标"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(expanded ? filtered : filtered.slice(0, 6)).map((m, i) => {
        const last = m.points.at(-1)!,
          contribution = analysis.contributions.items.find(
            (c) => c.id === m.id,
          );
        return (
          <article
            key={m.id}
            className="rw-scale-measure"
            data-scale-measure={m.id}
          >
            <h3>
              {i + 1}. {m.name}{" "}
              <span>{m.direction === "mtbf" ? "提升MTBF" : "降低MTTR"}</span>
            </h3>
            <p>
              50万卡单项收益 <b>{points(last.gainPp / 100)}</b> · 减损{" "}
              <b>{hours(last.savedHours)}/周</b> · {scale(model.scenario.cards)}
              组合Shapley：
              {m.enabled
                ? points(contribution?.shapley ?? 0)
                : "未纳入当前组合"}
            </p>
            <div
              className="rw-scale-curve"
              dangerouslySetInnerHTML={{ __html: measureCurveSvg(m) }}
            />
            <details>
              <summary>查看五个规模的准确数值</summary>
              <table className="rw-table">
                <thead>
                  <tr>
                    <th>规模</th>
                    <th>仅优化该项可用度</th>
                    <th>周损失</th>
                    <th>增益pp</th>
                    <th>周减损</th>
                  </tr>
                </thead>
                <tbody>
                  {m.points.map((p) => (
                    <tr key={p.cards}>
                      <td>{scale(p.cards)}</td>
                      <td>{percent(p.availability, 4)}</td>
                      <td>{hours(p.lossHours)}</td>
                      <td>{p.gainPp.toFixed(4)}</td>
                      <td>{hours(p.savedHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </article>
        );
      })}
      {filtered.length > 6 && (
        <button className="rw-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : `展开全部${filtered.length}项措施曲线`}
        </button>
      )}
    </section>
  );
}

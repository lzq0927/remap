import { useState } from "react";
import { Play, RefreshCw } from "lucide-react";
import type { SimulationSummary } from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { count, duration, hours, percent, points } from "./format";
import { Disclosure, NumberField, Status, useTooltip, type Tone } from "./ui";

const tones: Record<"pass" | "warn" | "fail", Tone> = {
  pass: "good",
  warn: "warn",
  fail: "bad",
};
const verdictText = {
  pass: ["验证通过", "独立仿真确认所选设计达到目标，各项判定全部通过。"],
  warn: [
    "数值达标，仍有待确认项",
    "仿真结果没有否定这套设计，但下面标出的事项需要在交付前确认。",
  ],
  fail: ["验证未通过", "所选设计在独立仿真中没有达到要求，请回到第 3 步调整。"],
} as const;

export default function StepVerify() {
  const {
      model,
      analysis,
      update,
      verification,
      stale,
      verifying,
      runVerification,
      goto,
    } = useWorkbench(),
    [trials, setTrials] = useState(verification?.trials ?? 2000),
    [fixedSeed, setFixedSeed] = useState(false),
    [seed, setSeed] = useState(verification?.seed ?? 20261117);
  const target = model.scenario.target,
    result = verification;

  return (
    <div className="rw-stack">
      <section className="rw-card rw-verify-run" aria-label="运行验证">
        <div>
          <h2>独立仿真</h2>
          <p className="rw-hint">
            前三步用的是解析公式。这里换一种方法：逐个模拟故障的发生、检出和恢复，重复很多个评估窗口，看所选设计在随机波动下能否达标。
          </p>
        </div>
        <div className="rw-verify-controls">
          <label>
            <span>仿真窗口数</span>
            <NumberField
              label="仿真窗口数"
              value={trials}
              min={100}
              max={20000}
              digits={0}
              width={104}
              onCommit={(v) => setTrials(Math.round(v))}
            />
          </label>
          <label>
            <span>窗口达标比例要求</span>
            <NumberField
              label="窗口达标比例要求（%）"
              value={model.scenario.passRatio}
              factor={100}
              min={0}
              max={1}
              digits={1}
              suffix="%"
              width={96}
              onCommit={(v) => update((d) => void (d.scenario.passRatio = v))}
            />
          </label>
          <label className="rw-check">
            <input
              type="checkbox"
              checked={fixedSeed}
              onChange={(e) => setFixedSeed(e.target.checked)}
            />
            <span>指定随机种子（用于复现）</span>
          </label>
          {fixedSeed && (
            <NumberField
              label="随机种子"
              value={seed}
              min={0}
              max={4294967295}
              digits={0}
              width={132}
              onCommit={(v) => setSeed(Math.round(v))}
            />
          )}
          <button
            className="rw-button is-primary is-large"
            disabled={verifying}
            onClick={() =>
              void runVerification({ trials, ...(fixedSeed ? { seed } : {}) })
            }
          >
            {result ? (
              <RefreshCw size={16} aria-hidden />
            ) : (
              <Play size={16} aria-hidden />
            )}
            {verifying ? "正在仿真…" : result ? "重新验证" : "运行独立验证"}
          </button>
        </div>
      </section>

      {!result && (
        <section className="rw-card rw-empty-state">
          <h2>还没有验证记录</h2>
          <p>
            当前设计的解析结果是 {percent(analysis.design.system.availability)}
            ，目标 {percent(target)}
            。运行验证后，这里会给出仿真均值、置信区间、窗口达标比例，以及是否通过的逐项判定。
          </p>
        </section>
      )}

      {result && (
        <>
          {stale && (
            <p className="rw-alert is-warn" role="status">
              下面是第 {result.sequence}{" "}
              次验证的结果，之后参数已经修改。请重新验证，结论才对应当前设计。
            </p>
          )}
          <section
            className={
              "rw-verdict is-" + (stale ? "idle" : tones[result.verdict])
            }
            aria-label="验证结论"
          >
            <Status tone={stale ? "idle" : tones[result.verdict]}>
              {stale ? "结果已过期" : verdictText[result.verdict][0]}
            </Status>
            <p>
              {stale
                ? "参数修改后尚未重新验证。"
                : verdictText[result.verdict][1]}
            </p>
            <small>
              第 {result.sequence} 次验证 ·{" "}
              {new Date(result.createdAt).toLocaleString("zh-CN")} ·{" "}
              {count(result.trials)} 个窗口 · 随机种子 {result.seed}
            </small>
          </section>

          <section className="rw-stats" aria-label="仿真结果">
            <div className="rw-stat is-lead">
              <span>设计后 · 仿真均值</span>
              <strong>{percent(result.design.mean)}</strong>
              <small>
                95% 置信区间 {percent(result.design.interval[0])} –{" "}
                {percent(result.design.interval[1])}
              </small>
            </div>
            <div className="rw-stat">
              <span>达到目标的窗口</span>
              <strong>{percent(result.design.passRatio, 1)}</strong>
              <small>要求不低于 {percent(model.scenario.passRatio, 0)}</small>
            </div>
            <div className="rw-stat">
              <span>较差的窗口（第 5 百分位）</span>
              <strong>{percent(result.design.p05)}</strong>
              <small>中位数 {percent(result.design.p50)}</small>
            </div>
            <div className="rw-stat">
              <span>与解析结果的偏差</span>
              <strong>
                {points(result.design.mean - result.analytic.design)}
              </strong>
              <small>解析值 {percent(result.analytic.design)}</small>
            </div>
            <div className="rw-stat">
              <span>现状 · 仿真均值</span>
              <strong>{percent(result.baseline.mean)}</strong>
              <small>解析值 {percent(result.analytic.baseline)}</small>
            </div>
          </section>

          <div className="rw-grid is-half">
            <section className="rw-card" aria-label="窗口可用度分布">
              <h2>各窗口可用度的分布</h2>
              <Histogram summary={result.design} target={result.target} />
              <p className="rw-hint">
                每根柱子是可用度落在该区间的窗口数。
                {result.design.histogramTail > 0 &&
                  `最左一根还包含 ${result.design.histogramTail} 个更低的窗口（最低 ${percent(result.design.min)}），通常是遇到了长时间漏检。`}
                系统 MTBF 仿真值 {duration(result.design.mtbfHours)}
                ，单次等效损失 {duration(result.design.mttrHours)}，每个窗口平均{" "}
                {count(result.design.events, 1)} 次故障。
              </p>
            </section>
            <section className="rw-card" aria-label="逐项判定">
              <h2>逐项判定</h2>
              <ul className="rw-checks">
                {result.checks.map((check) => (
                  <li key={check.id}>
                    <Status tone={tones[check.state]}>
                      {check.state === "pass"
                        ? "通过"
                        : check.state === "warn"
                          ? "待确认"
                          : "未通过"}
                    </Status>
                    <div>
                      <strong>{check.title}</strong>
                      <p>{check.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {result.verdict === "fail" && !stale && (
                <button className="rw-button" onClick={() => goto(2)}>
                  回到第 3 步调整设计
                </button>
              )}
            </section>
          </div>

          <section className="rw-card" aria-label="各模块预算核验">
            <h2>各模块预算核验</h2>
            <div className="rw-table-wrap">
              <table className="rw-table">
                <thead>
                  <tr>
                    <th>模块</th>
                    <th className="is-num">仿真损失</th>
                    <th className="is-num">解析损失</th>
                    <th className="is-num">分配预算</th>
                    <th>结论</th>
                  </tr>
                </thead>
                <tbody>
                  {result.modules.map((module) => (
                    <tr key={module.id}>
                      <td>{module.name}</td>
                      <td className="is-num is-strong">
                        {hours(module.simulatedLossHours)}
                      </td>
                      <td className="is-num">
                        {hours(module.analyticLossHours)}
                      </td>
                      <td className="is-num">{hours(module.budgetHours)}</td>
                      <td>
                        <Status tone={module.withinBudget ? "good" : "bad"}>
                          {module.withinBudget
                            ? "预算内"
                            : "超出 " +
                              hours(
                                module.simulatedLossHours - module.budgetHours,
                              )}
                        </Status>
                      </td>
                    </tr>
                  ))}
                  <tr className="rw-row-muted">
                    <td>公共开销</td>
                    <td className="is-num">
                      {hours(result.design.overheadLossHours)}
                    </td>
                    <td className="is-num">
                      {hours(analysis.design.system.overheadLossHours)}
                    </td>
                    <td className="is-num">
                      {hours(analysis.allocation.overheadLossHours)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <Disclosure title="验证方法与判定标准">
        <div className="rw-explain">
          <ol>
            <li>
              <p>
                <strong>为什么需要独立验证。</strong>
                解析公式给出的是长期平均值。实际考核看的是一个个有限的窗口：故障次数有多有少，一次漏检的静默故障可能吃掉大半个窗口。仿真不使用解析公式，直接模拟事件过程，可以检验平均值，也能给出窗口之间的波动。
              </p>
            </li>
            <li>
              <p>
                <strong>仿真怎么做。</strong>
                故障按各模式的事件率随机到达（指数间隔）；每次故障按检出率随机决定是否检出；恢复时间取指数分布，回滚重算取均匀分布，漏检损失取指数分布；窗口结束时截断尚未完成的恢复。现状和设计后使用不同的随机数流，每次验证默认更换随机种子。
              </p>
            </li>
            <li>
              <p>
                <strong>五项判定。</strong>① 仿真均值的 95%
                置信区间下限不低于目标；② 达到目标的窗口比例不低于要求；③
                仿真与解析结果的偏差在容差内（3 倍标准误与 0.5
                个百分点中较大者）；④ 各模块的仿真损失不超过第 1 步的分配预算；⑤
                所选措施都有实测证据。前四项是数值判定，第五项提醒：仿真只能证明“参数成立时可以达标”。
              </p>
            </li>
            <li>
              <p>
                <strong>没有覆盖的不确定性。</strong>
                置信区间只反映随机抽样误差，不包含故障率和恢复参数本身不准带来的误差。参数来自先验或设计假设时，结论应随实测数据更新。
              </p>
            </li>
          </ol>
        </div>
      </Disclosure>
    </div>
  );
}

/** 窗口可用度直方图：达标与未达标的窗口用两种颜色，并标出目标线。 */
function Histogram({
  summary,
  target,
}: {
  summary: SimulationSummary;
  target: number;
}) {
  const tooltip = useTooltip();
  const width = 640,
    height = 240,
    left = 44,
    right = 16,
    top = 28,
    bottom = 34,
    plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const first = summary.histogram[0].from,
    low = Math.min(first, target),
    high = Math.max(summary.max, target),
    pad = (high - low) * 0.04 || 0.001,
    // 左端有并入的低值窗口时不再留白，让“≤”刻度正好对齐最左一箱。
    from =
      low === first && summary.histogramTail > 0
        ? first
        : Math.max(0, low - pad),
    to = Math.min(1, high + pad),
    x = (value: number) => left + ((value - from) / (to - from)) * plotWidth,
    peak = Math.max(...summary.histogram.map((b) => b.count), 1),
    step = niceStep(peak),
    top0 = Math.ceil(peak / step) * step,
    y = (value: number) => top + plotHeight - (value / top0) * plotHeight;
  const ticks = Array.from({ length: top0 / step + 1 }, (_, i) => i * step);
  const targetX = x(target),
    labelLeft = targetX > width - 120;
  return (
    <figure className="rw-chart">
      <div className="rw-legend">
        <span className="rw-key is-pass" />
        达到目标的窗口
        <span className="rw-key is-miss" />
        未达到目标的窗口
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="窗口可用度直方图"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={tick === 0 ? "rw-axis" : "rw-grid-line"}
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text
              className="rw-tick"
              x={left - 8}
              y={y(tick) + 4}
              textAnchor="end"
            >
              {tick}
            </text>
          </g>
        ))}
        {summary.histogram.map((bin, index) => {
          if (!bin.count) return null;
          const x0 = x(bin.from),
            x1 = x(bin.to),
            barWidth = Math.max(1, Math.min(24, x1 - x0 - 2)),
            barX = (x0 + x1) / 2 - barWidth / 2,
            barY = y(bin.count),
            barHeight = top + plotHeight - barY,
            radius = Math.min(4, barWidth / 2, barHeight),
            pass = (bin.from + bin.to) / 2 >= target;
          return (
            <path
              key={index}
              className={"rw-hist-bar " + (pass ? "is-pass" : "is-miss")}
              tabIndex={0}
              d={`M${barX},${barY + barHeight}V${barY + radius}q0,${-radius} ${radius},${-radius}h${barWidth - 2 * radius}q${radius},0 ${radius},${radius}V${barY + barHeight}z`}
              {...tooltip.bind(
                <>
                  <strong>{bin.count} 个窗口</strong>
                  <span>
                    可用度{" "}
                    {index === 0 && summary.histogramTail > 0
                      ? "低于 " + percent(bin.to)
                      : percent(bin.from) + " – " + percent(bin.to)}
                  </span>
                  <strong>{percent(bin.count / summary.trials, 1)}</strong>
                  <span>占全部窗口</span>
                </>,
              )}
            />
          );
        })}
        <line
          className="rw-target-line"
          x1={targetX}
          x2={targetX}
          y1={top - 8}
          y2={top + plotHeight}
        />
        <text
          className="rw-target-label"
          x={targetX + (labelLeft ? -6 : 6)}
          y={top - 12}
          textAnchor={labelLeft ? "end" : "start"}
        >
          目标 {percent(target)}
        </text>
        {[from, (from + to) / 2, to].map((value, index) => (
          <text
            key={index}
            className="rw-tick"
            x={x(value)}
            y={height - 10}
            textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"}
          >
            {(index === 0 && value === first && summary.histogramTail > 0
              ? "≤ "
              : "") + percent(value)}
          </text>
        ))}
      </svg>
      {tooltip.node}
    </figure>
  );
}

function niceStep(peak: number) {
  const rough = peak / 4,
    power = 10 ** Math.floor(Math.log10(Math.max(rough, 1))),
    ratio = rough / power;
  return Math.max(
    1,
    (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power,
  );
}

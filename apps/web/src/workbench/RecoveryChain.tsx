import { Fragment, useMemo, useState } from "react";
import {
  applyMeasures,
  ladderOutcomes,
  lossPerEvent,
  recoveryLevelNames,
  recoveryLevelNotes,
  recoveryLevels,
  stageLoss,
  type FaultMode,
  type LadderLevel,
  type RecoveryLevel,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { duration, frequency, hours, percent } from "./format";
import { DurationField, NumberField } from "./ui";

const ink = "#101828",
  muted = "#667085",
  line = "#98a2b3",
  accent = "#1d5fd0";

/** 恢复阶梯编辑：每一级的成功率、耗时、失败耗时、影响范围和是否回滚。 */
export function LadderEditor({
  mode,
  onChange,
}: {
  mode: FaultMode;
  onChange: (level: RecoveryLevel, change: Partial<LadderLevel>) => void;
}) {
  return (
    <div className="rw-table-wrap">
      <table className="rw-table is-edit is-ladder">
        <thead>
          <tr>
            <th>恢复级别（从小到大）</th>
            <th className="is-num">成功率</th>
            <th>成功耗时</th>
            <th>失败白费</th>
            <th className="is-num">影响范围</th>
            <th>成功后回滚</th>
          </tr>
        </thead>
        <tbody>
          {recoveryLevels.map((level, index) => {
            const step = mode.ladder[level],
              name = `${mode.name} · ${recoveryLevelNames[level]}`,
              off = step.success <= 0;
            return (
              <tr key={level} className={off ? "is-off" : ""}>
                <td>
                  <strong>
                    {index + 1}　{recoveryLevelNames[level]}
                  </strong>
                  <small>{recoveryLevelNotes[level]}</small>
                </td>
                <td>
                  <NumberField
                    label={name + "的成功率（%）"}
                    value={step.success}
                    factor={100}
                    min={0}
                    max={1}
                    digits={3}
                    suffix="%"
                    width={88}
                    onCommit={(success) => onChange(level, { success })}
                  />
                </td>
                <td>
                  <DurationField
                    label={name + "的成功耗时"}
                    value={step.hours}
                    disabled={off}
                    onCommit={(value) => onChange(level, { hours: value })}
                  />
                </td>
                <td>
                  <DurationField
                    label={name + "的失败耗时"}
                    value={step.failHours}
                    disabled={off}
                    onCommit={(failHours) => onChange(level, { failHours })}
                  />
                </td>
                <td>
                  <NumberField
                    label={name + "的影响范围（%）"}
                    value={step.impact}
                    factor={100}
                    min={0}
                    max={1}
                    digits={2}
                    suffix="%"
                    width={84}
                    disabled={off}
                    onCommit={(impact) => onChange(level, { impact })}
                  />
                </td>
                <td>
                  <label className="rw-check">
                    <input
                      type="checkbox"
                      aria-label={name + "成功后回滚"}
                      checked={step.rollback}
                      disabled={off}
                      onChange={(e) =>
                        onChange(level, { rollback: e.target.checked })
                      }
                    />
                    <span>{step.rollback ? "回滚" : "不回滚"}</span>
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="rw-hint">
        成功率填 0
        表示不使用这一级。故障被发现后从上到下依次尝试：成功就结束，失败则白费“失败白费”的时间再升到下一级；最后一个使用的级别按必定成功计算。
      </p>
    </div>
  );
}

/** 恢复链示意图：故障发生 → 检测 → 逐级升级的恢复阶梯。 */
function ChainFigure({
  mode,
  label,
  perWeek,
}: {
  mode: FaultMode;
  label: string;
  perWeek: number;
}) {
  const outcomes = ladderOutcomes(mode),
    width = 1180,
    stepX = 166,
    stepY = 40,
    boxW = 154,
    boxH = 64,
    startX = 372,
    height = 44 + boxH + Math.max(0, outcomes.length - 1) * stepY + 18;
  const Arrow = ({ d }: { d: string }) => (
    <path
      d={d}
      fill="none"
      stroke={line}
      strokeWidth={1.6}
      markerEnd="url(#rw-arrow)"
    />
  );
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${mode.name}的恢复链（${label}）`}
    >
      <defs>
        <marker
          id="rw-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0L8 4L0 8z" fill={line} />
        </marker>
      </defs>
      <text x={0} y={14} fontSize={12.5} fontWeight={650} fill={accent}>
        {label}
      </text>
      {/* 故障发生 */}
      <rect
        x={0}
        y={26}
        width={132}
        height={boxH}
        rx={8}
        fill="#f1f4f8"
        stroke="#cdd3dc"
      />
      <text x={12} y={48} fontSize={12.5} fontWeight={650} fill={ink}>
        故障发生
      </text>
      <text x={12} y={68} fontSize={12} fill={muted}>
        {frequency(perWeek)}
      </text>
      <Arrow d={`M132 ${26 + boxH / 2}H164`} />
      {/* 检测 */}
      <rect
        x={166}
        y={26}
        width={176}
        height={boxH}
        rx={8}
        fill="#fff"
        stroke="#cdd3dc"
      />
      <text x={178} y={46} fontSize={12.5} fontWeight={650} fill={ink}>
        检测
      </text>
      <text x={178} y={63} fontSize={11.5} fill={muted}>
        检出 {percent(mode.coverage, 1)} ·{" "}
        {duration(mode.detectHours) || "即时"}
      </text>
      <text x={178} y={79} fontSize={11.5} fill={muted}>
        漏检 {percent(1 - mode.coverage, 1)} · {duration(mode.lateDetectHours)}
        后发现
      </text>
      {outcomes.length > 0 && (
        <Arrow d={`M342 ${26 + boxH / 2}H${startX - 2}`} />
      )}
      {/* 恢复阶梯 */}
      {outcomes.map((outcome, index) => {
        const step = mode.ladder[outcome.level],
          x = startX + index * stepX,
          y = 26 + index * stepY,
          last = index === outcomes.length - 1;
        return (
          <g key={outcome.level}>
            <rect
              x={x}
              y={y}
              width={boxW}
              height={boxH}
              rx={8}
              fill="#fff"
              stroke={accent}
            />
            <text
              x={x + 10}
              y={y + 19}
              fontSize={12.5}
              fontWeight={650}
              fill={ink}
            >
              {recoveryLevelNames[outcome.level]}
            </text>
            <text x={x + 10} y={y + 36} fontSize={11.5} fill={muted}>
              到达 {percent(outcome.reach, outcome.reach < 0.01 ? 2 : 1)} · 成功{" "}
              {percent(outcome.success, 1)}
            </text>
            <text x={x + 10} y={y + 53} fontSize={11.5} fill={muted}>
              {duration(step.hours) || "0"}
              {step.impact < 1 ? ` · 影响 ${percent(step.impact, 1)}` : ""}
              {step.rollback ? " · 回滚" : " · 不回滚"}
            </text>
            {!last && (
              <>
                <Arrow
                  d={`M${x + boxW} ${y + 22}H${x + stepX + 28}V${y + stepY - 2}`}
                />
                <text x={x + boxW + 6} y={y + 14} fontSize={11} fill={muted}>
                  失败 {percent(1 - outcome.success, 1)}
                  {step.failHours > 0
                    ? ` · 白费 ${duration(step.failHours)}`
                    : ""}
                </text>
              </>
            )}
          </g>
        );
      })}
      {outcomes.length === 0 && (
        <text x={startX} y={26 + boxH / 2 + 4} fontSize={12} fill={muted}>
          没有配置恢复级别
        </text>
      )}
      {/* 结果 */}
      <text x={width} y={20} fontSize={11.5} fill={muted} textAnchor="end">
        回滚重算 {duration(mode.reworkHours) || "0"}（需要回滚的级别成功后计入）
      </text>
      <text
        x={width}
        y={height - 6}
        fontSize={13}
        fontWeight={700}
        fill={ink}
        textAnchor="end"
      >
        单次等效损失 {duration(lossPerEvent(mode))}
      </text>
    </svg>
  );
}

/** 恢复链与计算过程：选一个故障模式，对比措施前后的每一环。 */
export default function RecoveryChain() {
  const { model, analysis } = useWorkbench(),
    designModes = useMemo(() => applyMeasures(model).modes, [model]),
    results = analysis.baseline.modules.flatMap((m) => m.modes),
    designResults = analysis.design.modules.flatMap((m) => m.modes),
    ranked = [...results].sort((a, b) => b.lossHours - a.lossHours),
    [picked, setPicked] = useState<string>();
  const modeId = model.modes.some((m) => m.id === picked)
      ? picked!
      : ranked[0]?.id,
    before = model.modes.find((m) => m.id === modeId),
    after = designModes.find((m) => m.id === modeId);
  if (!before || !after) return null;
  const moduleName = (id: string) =>
      model.modules.find((m) => m.id === id)?.name ?? "",
    beforeResult = results.find((m) => m.id === modeId)!,
    afterResult = designResults.find((m) => m.id === modeId)!,
    beforeStages = stageLoss(before),
    afterStages = stageLoss(after),
    beforeLadder = ladderOutcomes(before),
    afterLadder = ladderOutcomes(after),
    changed = JSON.stringify(before) !== JSON.stringify(after);
  const cell = (value: number) => (value > 0 ? duration(value) : "—");
  const levelText = (
    mode: FaultMode,
    level: RecoveryLevel,
    outcomes: typeof beforeLadder,
  ) => {
    const outcome = outcomes.find((o) => o.level === level),
      step = mode.ladder[level];
    if (!outcome) return <span className="rw-muted">不使用</span>;
    return (
      <>
        到达 {percent(outcome.reach, outcome.reach < 0.01 ? 2 : 1)} · 成功{" "}
        {percent(outcome.success, 1)} · {duration(step.hours) || "0"}
        {step.failHours > 0 && outcome.success < 1
          ? `（失败白费 ${duration(step.failHours)}）`
          : ""}
        {step.impact < 1 ? ` · 影响 ${percent(step.impact, 1)}` : ""}
      </>
    );
  };
  const rows: [string, React.ReactNode, number, React.ReactNode, number][] = [
    [
      "检测 · 检出",
      <>
        {percent(before.coverage, 1)} × {duration(before.detectHours) || "0"}
      </>,
      beforeStages.detect,
      <>
        {percent(after.coverage, 1)} × {duration(after.detectHours) || "0"}
      </>,
      afterStages.detect,
    ],
    [
      "检测 · 漏检后发现",
      <>
        {percent(1 - before.coverage, 1)} × {duration(before.lateDetectHours)}
      </>,
      beforeStages.late,
      <>
        {percent(1 - after.coverage, 1)} × {duration(after.lateDetectHours)}
      </>,
      afterStages.late,
    ],
    ...recoveryLevels
      .filter(
        (level) =>
          before.ladder[level].success > 0 || after.ladder[level].success > 0,
      )
      .map(
        (level, index) =>
          [
            `恢复 ${index + 1} · ${recoveryLevelNames[level]}`,
            levelText(before, level, beforeLadder),
            beforeStages.levels[level],
            levelText(after, level, afterLadder),
            afterStages.levels[level],
          ] as [string, React.ReactNode, number, React.ReactNode, number],
      ),
    [
      "回滚重算",
      <>
        {duration(before.reworkHours) || "0"} ×{" "}
        {percent(
          beforeLadder.reduce(
            (sum, o) =>
              sum + (before.ladder[o.level].rollback ? o.resolved : 0),
            0,
          ),
          1,
        )}
      </>,
      beforeStages.rework,
      <>
        {duration(after.reworkHours) || "0"} ×{" "}
        {percent(
          afterLadder.reduce(
            (sum, o) => sum + (after.ladder[o.level].rollback ? o.resolved : 0),
            0,
          ),
          1,
        )}
      </>,
      afterStages.rework,
    ],
  ];

  return (
    <section className="rw-card" aria-label="恢复链与计算过程">
      <div className="rw-card-head">
        <h2>恢复链：每一环的概率和时间</h2>
        <label className="rw-inline-select">
          <span>故障模式</span>
          <select
            aria-label="选择故障模式"
            value={modeId}
            onChange={(e) => setPicked(e.target.value)}
          >
            {ranked.map((m) => (
              <option key={m.id} value={m.id}>
                {moduleName(m.moduleId)} · {m.name}（{hours(m.lossHoursPerWeek)}
                /周）
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="rw-hint">
        故障发生后先被检出，或漏检后被兜底手段发现；然后沿恢复阶梯从小到大逐级尝试，失败才升到下一级。每一环的“概率
        × 时间”相加就是单次等效损失，再乘故障频次得到每周损失。
      </p>
      <div className="rw-chain-figures">
        <ChainFigure
          mode={before}
          label="现状"
          perWeek={beforeResult.eventsPerWeek}
        />
        {changed && (
          <ChainFigure
            mode={after}
            label="设计后（已启用措施生效）"
            perWeek={afterResult.eventsPerWeek}
          />
        )}
      </div>
      <div className="rw-table-wrap">
        <table className="rw-table">
          <thead>
            <tr>
              <th>环节</th>
              <th>现状：概率 × 时间</th>
              <th className="is-num">期望损失</th>
              <th>设计后：概率 × 时间</th>
              <th className="is-num">期望损失</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(
              ([name, beforeText, beforeValue, afterText, afterValue]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="rw-muted">{beforeText}</td>
                  <td className="is-num">{cell(beforeValue)}</td>
                  <td className="rw-muted">{afterText}</td>
                  <td
                    className={
                      "is-num" +
                      (Math.abs(afterValue - beforeValue) > 1e-12
                        ? " is-changed"
                        : "")
                    }
                  >
                    {cell(afterValue)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
          <tfoot>
            {(
              [
                [
                  "单次等效损失" +
                    (before.impact < 1 || after.impact < 1
                      ? "（已乘影响系数）"
                      : ""),
                  duration(beforeResult.mttrHours),
                  duration(afterResult.mttrHours),
                ],
                [
                  "× 故障频次",
                  frequency(beforeResult.eventsPerWeek),
                  frequency(afterResult.eventsPerWeek),
                ],
                [
                  "= 每周损失",
                  hours(beforeResult.lossHoursPerWeek),
                  hours(afterResult.lossHoursPerWeek),
                ],
              ] as const
            ).map(([name, beforeValue, afterValue]) => (
              <tr key={name}>
                <td>{name}</td>
                <td />
                <td className="is-num">{beforeValue}</td>
                <td />
                <td className="is-num">{afterValue}</td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** 可用度是怎么算出来的：各故障模式的频次 × 单次损失，合成系统可用度。 */
export function ComputationTrace() {
  const { model, analysis } = useWorkbench(),
    [view, setView] = useState<"baseline" | "design">("baseline"),
    assessed = view === "design" ? analysis.design : analysis.baseline,
    system = assessed.system,
    rows = assessed.modules
      .flatMap((module) =>
        module.modes.map((mode) => ({ ...mode, module: module.name })),
      )
      .sort((a, b) => b.lossHours - a.lossHours);
  return (
    <section className="rw-card" aria-label="可用度计算过程">
      <div className="rw-card-head">
        <h2>可用度是怎么算出来的</h2>
        <div className="rw-tabs" role="tablist" aria-label="计算过程显示">
          {(
            [
              ["baseline", "现状"],
              ["design", "设计后"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              className={view === id ? "is-active" : ""}
              onClick={() => setView(id)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="rw-table-wrap">
        <table className="rw-table is-compact">
          <thead>
            <tr>
              <th>模块</th>
              <th>故障模式</th>
              <th className="is-num">每卡 FIT</th>
              <th className="is-num">故障频次</th>
              <th className="is-num">× 单次等效损失</th>
              <th className="is-num">= 每周损失</th>
              <th className="is-num">损失负荷 ρ</th>
              <th className="is-num">占比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.module}</td>
                <td>{row.name}</td>
                <td className="is-num">
                  {row.fitPerCard >= 100
                    ? row.fitPerCard.toFixed(0)
                    : row.fitPerCard.toPrecision(3)}
                </td>
                <td className="is-num">{frequency(row.eventsPerWeek)}</td>
                <td className="is-num">{duration(row.mttrHours)}</td>
                <td className="is-num is-strong">
                  {hours(row.lossHoursPerWeek)}
                </td>
                <td className="is-num">{row.load.toFixed(4)}</td>
                <td className="is-num">{percent(row.share, 1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>故障损失合计</td>
              <td className="is-num">{frequency(system.eventsPerWeek)}</td>
              <td className="is-num">{duration(system.mttrHours)}</td>
              <td className="is-num">
                {hours(system.failureLossHoursPerWeek)}
              </td>
              <td className="is-num">{system.load.toFixed(4)}</td>
              <td className="is-num">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="rw-trace">
        {(
          [
            [
              "① 损失负荷",
              `ρ = Σ 事件率 × 单次等效损失 = ${system.load.toFixed(4)}`,
              "每运行 1 小时，平均因故障损失 ρ 小时",
            ],
            [
              "② 运行时间",
              `${model.scenario.hours} ÷ (1 + ${system.load.toFixed(4)}) = ${hours(model.scenario.hours / (1 + system.load))}`,
              "窗口里真正在运行的时间；其余是故障损失",
            ],
            [
              "③ 公共开销",
              `${hours(model.scenario.hours / (1 + system.load))} × ${percent(system.overhead)} = ${hours(system.overheadLossHours)}`,
              "运行时间里用于保存检查点等的固定损耗",
            ],
            [
              "④ 可用度",
              `A = (1 − ${percent(system.overhead)}) ÷ (1 + ${system.load.toFixed(4)}) = ${percent(system.availability)}`,
              `窗口损失 ${hours(system.lossHours)} = 故障 ${hours(system.failureLossHours)} + 开销 ${hours(system.overheadLossHours)}`,
            ],
          ] as const
        ).map(([name, formula, note]) => (
          <Fragment key={name}>
            <strong>{name}</strong>
            <code>{formula}</code>
            <span>{note}</span>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

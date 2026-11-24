import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  applyMeasures,
  eventPaths,
  ladderOutcomes,
  levelBenefit,
  lossPerEvent,
  recoveryLevelNames,
  recoveryLevelNotes,
  recoveryLevels,
  stageLoss,
  type FaultMode,
  type LadderLevel,
  type RecoveryLevel,
  type RecoveryPath,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { duration, frequency, hours, percent } from "./format";
import { DurationField, NumberField, useTooltip } from "./ui";

const ink = "#101828",
  muted = "#667085",
  line = "#98a2b3",
  accent = "#1d5fd0";

/** 恢复链各环节的固定配色：同一环节在所有图里用同一个颜色。 */
type StageKey = "detect" | "late" | RecoveryLevel;
const stageOrder: StageKey[] = ["detect", "late", ...recoveryLevels];
const stageColors: Record<StageKey, string> = {
  detect: "#98a2b3",
  late: "#e87ba4",
  replay: "#1baf7a",
  process: "#2a78d6",
  elastic: "#eda100",
  restart: "#eb6834",
  manual: "#008300",
};
const stageNames: Record<StageKey, string> = {
  detect: "检测",
  late: "漏检后发现",
  ...recoveryLevelNames,
};
const share = (value: number) =>
  percent(value, value > 0 && value < 0.01 ? 2 : 1);

/** 恢复链编辑：每一级的成功率、耗时、走向、影响范围和是否回滚。 */
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
            <th>成功后</th>
            <th>失败后</th>
            <th className="is-num">影响范围</th>
            <th>回滚</th>
            <th>必经</th>
          </tr>
        </thead>
        <tbody>
          {recoveryLevels.map((level, index) => {
            const step = mode.ladder[level],
              name = `${mode.name} · ${recoveryLevelNames[level]}`,
              off = step.success <= 0 && !step.gate;
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
                    width={84}
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
                  <select
                    aria-label={name + "成功后"}
                    value={step.then}
                    disabled={off || level === "manual"}
                    onChange={(e) =>
                      onChange(level, {
                        then: e.target.value as LadderLevel["then"],
                      })
                    }
                  >
                    <option value="done">恢复</option>
                    <option value="next">再走下一级</option>
                  </select>
                </td>
                <td>
                  <select
                    aria-label={name + "失败后"}
                    value={step.onFail}
                    disabled={off || level === "manual"}
                    onChange={(e) =>
                      onChange(level, {
                        onFail: e.target.value as LadderLevel["onFail"],
                      })
                    }
                  >
                    <option value="next">走下一级</option>
                    <option value="manual">转人工</option>
                  </select>
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
                    width={80}
                    disabled={off}
                    onCommit={(impact) => onChange(level, { impact })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={name + "恢复后回滚重算"}
                    title="在这一级恢复后，还要回滚到检查点重算"
                    checked={step.rollback}
                    disabled={off}
                    onChange={(e) =>
                      onChange(level, { rollback: e.target.checked })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={name + "是必经环节"}
                    title="必经：成功率为 0 时不跳过，按失败处理"
                    checked={step.gate}
                    disabled={level === "manual"}
                    onChange={(e) =>
                      onChange(level, { gate: e.target.checked })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="rw-hint">
        故障被发现后从上到下走：每一级成功后或者就此恢复，或者再走下一级（如弹性恢复换好资源后还要
        CKPT
        回滚）；失败后白费“失败白费”的时间，再走下一级或直接转人工。成功率填 0
        的级别默认跳过；勾选“必经”后不跳过，按失败处理（表示这一步绕不开，但现在还不具备）。失败后无处可去的级别按必定成功计算。
      </p>
    </div>
  );
}

/** 恢复链示意图：故障发生 → 检测 → 各恢复级别及其走向。 */
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
    boxW = 172,
    boxH = 66,
    gap = 78,
    top = 64,
    startX = 372,
    x = (index: number) => startX + index * (boxW + gap),
    width = Math.max(1180, x(outcomes.length) - gap + 4),
    rail = top + boxH + 48,
    height = rail + 30,
    indexOf = (level: RecoveryLevel | null) =>
      outcomes.findIndex((o) => o.level === level),
    marker = "rw-arrow-" + label.length + "-" + mode.id;
  const Arrow = ({ d, dashed }: { d: string; dashed?: boolean }) => (
    <path
      d={d}
      fill="none"
      stroke={line}
      strokeWidth={1.6}
      strokeDasharray={dashed ? "5 4" : undefined}
      markerEnd={`url(#${marker})`}
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
          id={marker}
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
      <text x={width} y={14} fontSize={11.5} fill={muted} textAnchor="end">
        回滚重算 {duration(mode.reworkHours) || "0"}
        （在需要回滚的级别恢复后计入）
      </text>
      {/* 故障发生 */}
      <rect
        x={0}
        y={top}
        width={132}
        height={boxH}
        rx={8}
        fill="#f1f4f8"
        stroke="#cdd3dc"
      />
      <text x={12} y={top + 24} fontSize={12.5} fontWeight={650} fill={ink}>
        故障发生
      </text>
      <text x={12} y={top + 44} fontSize={12} fill={muted}>
        {frequency(perWeek)}
      </text>
      <Arrow d={`M132 ${top + boxH / 2}H164`} />
      {/* 检测 */}
      <rect
        x={166}
        y={top}
        width={176}
        height={boxH}
        rx={8}
        fill="#fff"
        stroke="#cdd3dc"
      />
      <rect
        x={166}
        y={top}
        width={176}
        height={4}
        rx={2}
        fill={stageColors.detect}
      />
      <text x={178} y={top + 22} fontSize={12.5} fontWeight={650} fill={ink}>
        检测
      </text>
      <text x={178} y={top + 39} fontSize={11.5} fill={muted}>
        检出 {percent(mode.coverage, 1)} ·{" "}
        {duration(mode.detectHours) || "即时"}
      </text>
      <text x={178} y={top + 55} fontSize={11.5} fill={muted}>
        漏检 {percent(1 - mode.coverage, 1)} · {duration(mode.lateDetectHours)}
        后发现
      </text>
      {outcomes.length > 0 && (
        <Arrow d={`M342 ${top + boxH / 2}H${startX - 2}`} />
      )}
      {/* 任务恢复 */}
      {outcomes.length > 0 && (
        <>
          <line
            x1={startX}
            x2={x(outcomes.length - 1) + boxW}
            y1={rail}
            y2={rail}
            stroke="#0ca30c"
            strokeWidth={2}
          />
          <text x={startX} y={rail + 18} fontSize={12} fill="#067647">
            任务恢复
          </text>
        </>
      )}
      {outcomes.map((outcome, index) => {
        const step = mode.ladder[outcome.level],
          left = x(index),
          unavailable = step.success <= 0,
          next = index + 1 < outcomes.length ? index + 1 : -1,
          successIndex = indexOf(outcome.successTo),
          failIndex = indexOf(outcome.failTo),
          middle = top + boxH / 2,
          failed = outcome.reach * (1 - outcome.success);
        return (
          <g key={outcome.level}>
            <rect
              x={left}
              y={top}
              width={boxW}
              height={boxH}
              rx={8}
              fill="#fff"
              stroke={unavailable ? line : "#8c98a8"}
              strokeDasharray={unavailable ? "5 4" : undefined}
            />
            <rect
              x={left}
              y={top}
              width={boxW}
              height={4}
              rx={2}
              fill={stageColors[outcome.level]}
              opacity={unavailable ? 0.35 : 1}
            />
            <text
              x={left + 10}
              y={top + 22}
              fontSize={12.5}
              fontWeight={650}
              fill={ink}
            >
              {recoveryLevelNames[outcome.level]}
            </text>
            <text x={left + 10} y={top + 39} fontSize={11.5} fill={muted}>
              {unavailable
                ? "现在不具备（成功率 0）"
                : `成功率 ${percent(outcome.success, 1)} · ${duration(step.hours) || "0"}`}
            </text>
            <text x={left + 10} y={top + 55} fontSize={11.5} fill={muted}>
              到达 {share(outcome.reach)}
              {step.impact < 1 ? ` · 影响 ${percent(step.impact, 1)}` : ""}
            </text>
            {/* 成功后再走下一级 */}
            {successIndex >= 0 && outcome.passed > 0 && (
              <>
                <Arrow d={`M${left + boxW} ${middle}H${x(successIndex) - 2}`} />
                <text
                  x={left + boxW + gap / 2}
                  y={middle - 7}
                  fontSize={11}
                  fill="#067647"
                  textAnchor="middle"
                >
                  成功
                </text>
              </>
            )}
            {/* 在这一级恢复 */}
            {outcome.resolved > 0 && (
              <>
                <Arrow d={`M${left + boxW / 2} ${top + boxH}V${rail - 2}`} />
                <text
                  x={left + boxW / 2 + (index === outcomes.length - 1 ? -8 : 8)}
                  y={top + boxH + 28}
                  fontSize={11}
                  fill="#067647"
                  textAnchor={index === outcomes.length - 1 ? "end" : "start"}
                >
                  恢复 {share(outcome.resolved)}
                  {step.rollback ? "，回滚" : ""}
                </text>
              </>
            )}
            {/* 失败：走下一级，或越过中间的级别转人工 */}
            {failIndex >= 0 &&
              failed > 0 &&
              (failIndex === next && successIndex < 0 ? (
                <>
                  <Arrow
                    dashed
                    d={`M${left + boxW} ${middle}H${x(failIndex) - 2}`}
                  />
                  <text
                    x={left + boxW + gap / 2}
                    y={middle - 7}
                    fontSize={11}
                    fill={muted}
                    textAnchor="middle"
                  >
                    失败 {share(1 - outcome.success)}
                  </text>
                </>
              ) : (
                <>
                  <Arrow
                    dashed
                    d={`M${left + boxW - 30} ${top}V${top - 22 - (index % 2) * 12}H${x(failIndex) + 40 + (index % 2) * 24}V${top - 2}`}
                  />
                  <text
                    x={left + boxW - 22}
                    y={top - 28 - (index % 2) * 12}
                    fontSize={11}
                    fill={muted}
                  >
                    失败 {share(1 - outcome.success)}，转
                    {recoveryLevelNames[outcome.failTo!]}
                  </text>
                </>
              ))}
          </g>
        );
      })}
      {outcomes.length === 0 && (
        <text x={startX} y={top + boxH / 2 + 4} fontSize={12} fill={muted}>
          没有配置恢复级别
        </text>
      )}
      <text
        x={width}
        y={height - 8}
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

interface Segment {
  key: StageKey;
  hours: number;
  /** 这一级失败白费的时间：用浅色表示。 */
  failed?: boolean;
  /** 悬停提示里的补充说明。 */
  note?: string;
}
/** 一条横向的堆叠条：每一段是一个环节的时间，长度与时间成正比。 */
function TimeBar({
  segments,
  full,
  bind,
  label,
}: {
  segments: Segment[];
  /** 条的满宽对应多少小时。 */
  full: number;
  bind: ReturnType<typeof useTooltip>["bind"];
  label: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.hours, 0);
  return (
    <div className="rw-timebar" role="img" aria-label={label}>
      <div className="rw-timebar-track">
        {segments
          .filter((s) => s.hours > 0)
          .map((s, index) => (
            <span
              key={index}
              tabIndex={0}
              className={s.failed ? "is-failed" : ""}
              style={{
                width: (s.hours / full) * 100 + "%",
                background: stageColors[s.key],
              }}
              {...bind(
                <>
                  <strong>{duration(s.hours)}</strong>
                  <span>
                    {stageNames[s.key]}
                    {s.failed ? "（失败白费）" : ""}
                  </span>
                  <strong>{share(total > 0 ? s.hours / total : 0)}</strong>
                  <span>占这一条的比例</span>
                  {s.note && (
                    <>
                      <strong />
                      <span>{s.note}</span>
                    </>
                  )}
                </>,
              )}
            />
          ))}
      </div>
      <div className="rw-timebar-labels">
        {segments
          .filter((s) => s.hours > 0)
          .map((s, index) => (
            <span key={index} style={{ width: (s.hours / full) * 100 + "%" }}>
              {s.hours / full > 0.085 && (
                <>
                  {stageNames[s.key]}
                  {s.failed ? "失败" : ""}
                  <b>{duration(s.hours)}</b>
                </>
              )}
            </span>
          ))}
      </div>
    </div>
  );
}

/** 期望耗时的构成：检测与各恢复级别的“概率 × 时间”，回滚重算并入恢复的那一级。 */
const expectedSegments = (mode: FaultMode): Segment[] => {
  const stages = stageLoss(mode);
  return [
    { key: "detect" as const, hours: stages.detect },
    { key: "late" as const, hours: stages.late },
    ...recoveryLevels.map((level) => ({
      key: level,
      hours: stages.levels[level] + stages.levelRework[level],
      note:
        stages.levelRework[level] > 0
          ? `其中回滚重算 ${duration(stages.levelRework[level])}`
          : undefined,
    })),
  ];
};
/** 把路径整理成横条：回滚重算并入恢复的那一级；检测差别很小时把检出与漏检合并。 */
function pathRows(mode: FaultMode) {
  const paths = eventPaths(mode).filter((p) => p.probability > 0),
    total = lossPerEvent(mode),
    lateShare =
      total > 0
        ? (mode.impact * (1 - mode.coverage) * mode.lateDetectHours) / total
        : 0,
    merge = lateShare < 0.05;
  const rows = new Map<
    string,
    { probability: number; wait: number; path: RecoveryPath; missed: boolean }
  >();
  for (const path of paths) {
    const key =
        (merge || path.detected ? "" : "late|") +
        path.segments
          .slice(1)
          .map((s) => s.stage + (s.ok ? "" : "!"))
          .join(">"),
      row = rows.get(key);
    if (row) {
      row.wait += path.probability * path.segments[0].hours;
      row.probability += path.probability;
    } else
      rows.set(key, {
        probability: path.probability,
        wait: path.probability * path.segments[0].hours,
        path,
        missed: !merge && !path.detected,
      });
  }
  return [...rows.values()]
    .map(({ probability, wait, path, missed }) => {
      const segments: Segment[] = [
        { key: missed ? "late" : "detect", hours: wait / probability },
      ];
      for (const s of path.segments.slice(1))
        if (s.stage === "rework") {
          const last = segments[segments.length - 1];
          last.hours += s.hours;
          last.note = `其中回滚重算 ${duration(s.hours)}`;
        } else
          segments.push({
            key: s.stage as RecoveryLevel,
            hours: s.hours,
            failed: !s.ok,
          });
      const steps = path.segments
        .slice(1)
        .filter((s) => s.stage !== "rework")
        .map(
          (s) =>
            recoveryLevelNames[s.stage as RecoveryLevel] + (s.ok ? "" : "失败"),
        );
      return {
        probability,
        segments,
        hours: segments.reduce((sum, s) => sum + s.hours, 0),
        name:
          (missed ? "漏检 → " : "") +
          (steps.length ? steps.join(" → ") : "无需恢复"),
      };
    })
    .sort((a, b) => b.probability - a.probability);
}

/** 各环节耗时：一条线看出时间花在哪里；再按路径拆开，看每条路径多长、多大概率走到。 */
function StageTimes({
  before,
  after,
  changed,
}: {
  before: FaultMode;
  after: FaultMode;
  changed: boolean;
}) {
  const tooltip = useTooltip(),
    [sameScale, setSameScale] = useState(false),
    [view, setView] = useState<"before" | "after">("after");
  const states = [
      { id: "before" as const, name: "现状", mode: before },
      ...(changed
        ? [{ id: "after" as const, name: "设计后", mode: after }]
        : []),
    ],
    bars = states.map((state) => {
      const segments = expectedSegments(state.mode);
      return {
        ...state,
        segments,
        total: segments.reduce((sum, s) => sum + s.hours, 0),
      };
    }),
    longest = Math.max(...bars.map((b) => b.total), 1e-12),
    used = stageOrder.filter((key) =>
      bars.some((bar) =>
        bar.segments.some((s) => s.key === key && s.hours > 0),
      ),
    );
  const shown = changed && view === "after" ? after : before,
    rows = pathRows(shown),
    visible = rows.slice(0, 8),
    rest = rows.slice(8),
    longestPath = Math.max(...visible.map((r) => r.hours), 1e-12);
  return (
    <div className="rw-stage-times">
      <div className="rw-card-head">
        <h3>各环节耗时：时间花在哪一块</h3>
        <span className="rw-legend">
          {used.map((key) => (
            <span key={key} className="rw-legend-item">
              <i className="rw-dot" style={{ background: stageColors[key] }} />
              {stageNames[key]}
            </span>
          ))}
        </span>
      </div>
      <div className="rw-timebars">
        {bars.map((bar) => (
          <Fragment key={bar.id}>
            <strong>{bar.name}</strong>
            <TimeBar
              segments={bar.segments}
              full={sameScale ? longest : bar.total || 1e-12}
              bind={tooltip.bind}
              label={`${bar.name}单次等效损失 ${duration(bar.total)} 的构成：${bar.segments
                .filter((s) => s.hours > 0)
                .map((s) => `${stageNames[s.key]} ${duration(s.hours)}`)
                .join("，")}`}
            />
            <em>{duration(bar.total)}</em>
          </Fragment>
        ))}
      </div>
      <p className="rw-hint">
        每一段是这个环节的期望耗时（走到它的概率 ×
        时间），整条的长度就是单次等效损失；回滚重算并入恢复的那一级，所以“CKPT
        回滚”一段 ≈ 恢复时间 + 保存间隔的一半。
        {changed &&
          (sameScale
            ? "两条用同一时间尺度，可以直接比长短。"
            : "两条各自撑满，方便看清构成；总时长见右侧。")}
        {changed && (
          <button className="rw-link" onClick={() => setSameScale(!sameScale)}>
            {sameScale ? "改为各自撑满" : "改为同一时间尺度"}
          </button>
        )}
      </p>

      <div className="rw-card-head">
        <h3>按路径看：每条路径多长、多大概率走到</h3>
        {changed && (
          <div className="rw-tabs" role="tablist" aria-label="路径显示">
            {states.map((state) => (
              <button
                key={state.id}
                role="tab"
                aria-selected={view === state.id}
                className={view === state.id ? "is-active" : ""}
                onClick={() => setView(state.id)}
              >
                {state.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rw-paths">
        {visible.map((row) => (
          <Fragment key={row.name}>
            <b>{share(row.probability)}</b>
            <span>{row.name}</span>
            <TimeBar
              segments={row.segments}
              full={longestPath}
              bind={tooltip.bind}
              label={`${row.name}，概率 ${share(row.probability)}，耗时 ${duration(row.hours)}`}
            />
            <em>{duration(row.hours)}</em>
          </Fragment>
        ))}
      </div>
      <p className="rw-hint">
        每一行是一种可能的经过，条的长度是这条路径实际花的时间（同一时间尺度），左边是走到它的概率；浅色段是失败白费的时间。各行“概率
        × 时间”相加就是上面的单次等效损失。
        {rest.length > 0 &&
          `另有 ${rest.length} 条更少见的路径未列出，合计 ${share(rest.reduce((sum, r) => sum + r.probability, 0))}。`}
      </p>
      {tooltip.node}
    </div>
  );
}

/** 恢复链与计算过程：选一个故障模式，对比措施前后的每一环。 */
export default function RecoveryChain() {
  const { model, analysis, update } = useWorkbench(),
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
    benefit = levelBenefit(after),
    changed = JSON.stringify(before) !== JSON.stringify(after);
  // 成功后还要走下一级的环节（如弹性恢复）：不具备时是转人工，还是跳过它直接走下一级
  const gated = model.modes.filter((m) =>
      recoveryLevels.some((level) => m.ladder[level].then === "next"),
    ),
    gateOn = gated.some((m) =>
      recoveryLevels.some(
        (level) => m.ladder[level].then === "next" && m.ladder[level].gate,
      ),
    );
  const cell = (value: number) => (value > 0 ? duration(value) : "—");
  const levelText = (
    mode: FaultMode,
    level: RecoveryLevel,
    outcomes: typeof beforeLadder,
  ): ReactNode => {
    const outcome = outcomes.find((o) => o.level === level),
      step = mode.ladder[level];
    if (!outcome) return <span className="rw-muted">不使用</span>;
    if (step.success <= 0)
      return (
        <>
          到达 {share(outcome.reach)} · 现在不具备，转
          {outcome.failTo ? recoveryLevelNames[outcome.failTo] : "—"}
        </>
      );
    return (
      <>
        到达 {share(outcome.reach)} · 成功 {percent(outcome.success, 1)} ·{" "}
        {duration(step.hours) || "0"}
        {step.failHours > 0 && outcome.success < 1
          ? `（失败白费 ${duration(step.failHours)}）`
          : ""}
        {step.impact < 1 ? ` · 影响 ${percent(step.impact, 1)}` : ""}
        {outcome.successTo
          ? ` · 成功后再走${recoveryLevelNames[outcome.successTo]}`
          : ""}
      </>
    );
  };
  const reworkShare = (mode: FaultMode, outcomes: typeof beforeLadder) =>
    outcomes.reduce(
      (sum, o) => sum + (mode.ladder[o.level].rollback ? o.resolved : 0),
      0,
    );
  const rows: [string, ReactNode, number, ReactNode, number, ReactNode][] = [
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
      null,
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
      null,
    ],
    ...recoveryLevels
      .filter(
        (level) =>
          beforeLadder.some((o) => o.level === level) ||
          afterLadder.some((o) => o.level === level),
      )
      .map((level, index) => {
        const saved = benefit[level];
        return [
          `恢复 ${index + 1} · ${recoveryLevelNames[level]}`,
          levelText(before, level, beforeLadder),
          beforeStages.levels[level],
          levelText(after, level, afterLadder),
          afterStages.levels[level],
          saved === null || Math.abs(saved) < 1e-12 ? null : saved > 0 ? (
            <>每次省 {duration(saved)}</>
          ) : (
            <span className="rw-warn-text">
              每次反而多花 {duration(-saved)}
            </span>
          ),
        ] as [string, ReactNode, number, ReactNode, number, ReactNode];
      }),
    [
      "回滚重算",
      <>
        {duration(before.reworkHours) || "0"} ×{" "}
        {percent(reworkShare(before, beforeLadder), 1)}
      </>,
      beforeStages.rework,
      <>
        {duration(after.reworkHours) || "0"} ×{" "}
        {percent(reworkShare(after, afterLadder), 1)}
      </>,
      afterStages.rework,
      null,
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
        故障发生后先被检出，或漏检后被兜底手段发现；然后沿恢复链从小到大走：进程重调度成功即恢复，失败走弹性恢复；弹性恢复成功后再走
        CKPT 回滚，失败转人工；CKPT 回滚失败也转人工。每一环的“概率 ×
        时间”相加就是单次等效损失，再乘故障频次和运行时间占比得到每周损失。
      </p>
      {gated.length > 0 && (
        <p className="rw-chain-option">
          <label className="rw-inline-select">
            <span>还不具备弹性恢复时，进程重调度失败后</span>
            <select
              aria-label="不具备弹性恢复时的走法"
              value={gateOn ? "manual" : "skip"}
              onChange={(e) =>
                update((d) => {
                  for (const mode of d.modes)
                    for (const level of recoveryLevels)
                      if (mode.ladder[level].then === "next")
                        mode.ladder[level].gate = e.target.value === "manual";
                })
              }
            >
              <option value="manual">只能转人工（弹性恢复是必经环节）</option>
              <option value="skip">跳过它，直接走 CKPT 回滚</option>
            </select>
          </label>
          <span className="rw-muted">
            这决定“现状”怎么算，对全部 {gated.length}{" "}
            个故障模式生效；弹性恢复具备之后两种走法结果相同。
          </span>
        </p>
      )}
      <div className="rw-chain-figures">
        <ChainFigure
          mode={before}
          label="现状"
          perWeek={beforeResult.ratePerWeek}
        />
        {changed && (
          <ChainFigure
            mode={after}
            label="设计后（已启用措施生效）"
            perWeek={afterResult.ratePerWeek}
          />
        )}
      </div>
      <StageTimes before={before} after={after} changed={changed} />
      <div className="rw-table-wrap">
        <table className="rw-table rw-chain-table">
          <thead>
            <tr>
              <th>环节</th>
              <th>现状：概率 × 时间</th>
              <th className="is-num">期望损失</th>
              <th>设计后：概率 × 时间</th>
              <th className="is-num">期望损失</th>
              <th>这一级值多少</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(
              ([
                name,
                beforeText,
                beforeValue,
                afterText,
                afterValue,
                worth,
              ]) => (
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
                  <td>{worth ?? <span className="rw-muted">—</span>}</td>
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
                  "× 故障频次（每连续运行一周）",
                  frequency(beforeResult.ratePerWeek),
                  frequency(afterResult.ratePerWeek),
                ],
                [
                  "× 运行时间占比（停机时不产生新故障）",
                  percent(analysis.baseline.system.runShare, 1),
                  percent(analysis.design.system.runShare, 1),
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
                <td />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <p className="rw-hint">
        “这一级值多少”按设计后的恢复链算：把这一级拿掉（成功率设为
        0）后，单次等效损失会增加多少。写“反而多花”的级别，是成功率太低或耗时太长，先试它比直接走后面的级别更慢，需要提高成功率或缩短耗时才值得保留。
      </p>
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
              <th className="is-num">÷ 168 h = 损失负荷 ρ</th>
              <th className="is-num">每周损失</th>
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
                <td className="is-num">{frequency(row.ratePerWeek)}</td>
                <td className="is-num">{duration(row.mttrHours)}</td>
                <td className="is-num is-strong">{row.load.toFixed(4)}</td>
                <td className="is-num">{hours(row.lossHoursPerWeek)}</td>
                <td className="is-num">{percent(row.share, 1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>故障损失合计</td>
              <td className="is-num">{frequency(system.ratePerWeek)}</td>
              <td className="is-num">{duration(system.mttrHours)}</td>
              <td className="is-num">{system.load.toFixed(4)}</td>
              <td className="is-num">
                {hours(system.failureLossHoursPerWeek)}
              </td>
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
              `ρ = Σ 故障频次 × 单次等效损失 ÷ 168 = ${system.load.toFixed(4)}`,
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

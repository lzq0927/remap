import { useRef, type ReactNode } from "react";
import { useTooltip } from "./ui";

/** 图表配色：分类色按固定顺序取用（已通过色觉区分校验），其余为中性色。 */
export const seriesColors = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
];
export const chartInk = "#101828";
export const chartMuted = "#667085";
export const chartNeutral = "#98a2b3";
const grid = "#e4e7ec",
  axis = "#cdd3dc";

export interface LineSeries {
  name: string;
  color: string;
  dashed?: boolean;
  points: { x: number; y: number }[];
  /** 线上需要强调的点（如计划值、给定的目标点）。 */
  marks?: { x: number; y: number }[];
  /** 悬停提示里跟在名称后面的补充（如这一点对应的参数取值）。 */
  detail?: (x: number) => string;
}

function niceTicks(min: number, max: number, count = 5) {
  const span = max - min || 1,
    rough = span / count,
    power = 10 ** Math.floor(Math.log10(rough)),
    ratio = rough / power,
    step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power,
    start = Math.ceil(min / step - 1e-9) * step,
    ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step)
    ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/**
 * 折线图：单一纵轴；悬停时十字准线吸附到最近的横坐标，并列出各条线的数值。
 * 两条以上的线配图例；数值也都在相邻的表格里。
 */
export function LineChart({
  series,
  label,
  xLabel,
  yLabel,
  xLog,
  xTicks,
  formatX,
  formatY,
  yMin,
  yMax,
  horizontal,
  vertical,
  height = 300,
  describe,
}: {
  series: LineSeries[];
  label: string;
  xLabel: string;
  yLabel: string;
  xLog?: boolean;
  xTicks: number[];
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  yMin?: number;
  yMax?: number;
  /** 水平参考线（如目标）。 */
  horizontal?: { y: number; label: string; align?: "start" | "end" }[];
  /** 竖直参考线（如当前规模）。 */
  vertical?: { x: number; label: string }[];
  height?: number;
  /** 悬停提示里附加的说明行。 */
  describe?: (x: number) => ReactNode;
}) {
  const tooltip = useTooltip(),
    svg = useRef<SVGSVGElement>(null);
  const width = 720,
    left = 56,
    right = 18,
    top = 22,
    bottom = 44,
    plotW = width - left - right,
    plotH = height - top - bottom;
  const all = series.flatMap((s) => s.points),
    xs = all.map((p) => p.x),
    x0 = Math.min(...xTicks, ...xs),
    x1 = Math.max(...xTicks, ...xs),
    lowY = Math.min(
      ...all.map((p) => p.y),
      ...(horizontal ?? []).map((h) => h.y),
    ),
    highY = Math.max(
      ...all.map((p) => p.y),
      ...(horizontal ?? []).map((h) => h.y),
    ),
    pad = (highY - lowY) * 0.08 || 0.01,
    y0 = yMin ?? lowY - pad,
    y1 = yMax ?? highY + pad,
    yTicks = niceTicks(y0, y1);
  const tx = (v: number) => (xLog ? Math.log(v) : v),
    px = (v: number) => left + ((tx(v) - tx(x0)) / (tx(x1) - tx(x0))) * plotW,
    py = (v: number) => top + plotH - ((v - y0) / (y1 - y0)) * plotH;
  const columns = [...new Set(xs)].sort((a, b) => a - b);
  const move = (e: React.PointerEvent) => {
    const box = svg.current!.getBoundingClientRect(),
      cursor = ((e.clientX - box.left) / box.width) * width;
    let nearest = columns[0];
    for (const c of columns)
      if (Math.abs(px(c) - cursor) < Math.abs(px(nearest) - cursor))
        nearest = c;
    const lineX = px(nearest);
    svg.current!.style.setProperty("--rw-cross", String(lineX));
    const cross = svg.current!.querySelector<SVGLineElement>(".rw-cross");
    if (cross) {
      cross.setAttribute("x1", String(lineX));
      cross.setAttribute("x2", String(lineX));
      cross.style.opacity = "1";
    }
    tooltip.show(
      e.clientX,
      e.clientY,
      <>
        <strong>{formatX(nearest)}</strong>
        <span>{xLabel}</span>
        {series.map((s) => {
          const point = s.points.find((p) => p.x === nearest);
          return (
            point && (
              <FragmentRow
                key={s.name}
                color={s.color}
                name={s.detail ? `${s.name} · ${s.detail(nearest)}` : s.name}
              >
                {formatY(point.y)}
              </FragmentRow>
            )
          );
        })}
        {describe?.(nearest)}
      </>,
    );
  };
  const leave = () => {
    const cross = svg.current?.querySelector<SVGLineElement>(".rw-cross");
    if (cross) cross.style.opacity = "0";
    tooltip.hide();
  };
  return (
    <figure className="rw-chart">
      {series.length > 1 && (
        <div className="rw-legend">
          {series.map((s) => (
            <span key={s.name} className="rw-legend-item">
              <svg width="18" height="8" aria-hidden>
                <line
                  x1="1"
                  x2="17"
                  y1="4"
                  y2="4"
                  stroke={s.color}
                  strokeWidth="2.4"
                  strokeDasharray={s.dashed ? "4 3" : undefined}
                  strokeLinecap="round"
                />
              </svg>
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        onPointerMove={move}
        onPointerLeave={leave}
      >
        <text x={left} y={12} fontSize={11.5} fill={chartMuted}>
          {yLabel}
        </text>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={py(tick)}
              y2={py(tick)}
              stroke={grid}
            />
            <text
              x={left - 8}
              y={py(tick) + 4}
              fontSize={11.5}
              fill={chartMuted}
              textAnchor="end"
            >
              {formatY(tick)}
            </text>
          </g>
        ))}
        <line
          x1={left}
          x2={width - right}
          y1={top + plotH}
          y2={top + plotH}
          stroke={axis}
        />
        {xTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={px(tick)}
              x2={px(tick)}
              y1={top + plotH}
              y2={top + plotH + 4}
              stroke={axis}
            />
            <text
              x={px(tick)}
              y={top + plotH + 18}
              fontSize={11.5}
              fill={chartMuted}
              textAnchor={px(tick) > width - right - 24 ? "end" : "middle"}
            >
              {formatX(tick)}
            </text>
          </g>
        ))}
        <text
          x={left + plotW / 2}
          y={height - 6}
          fontSize={11.5}
          fill={chartMuted}
          textAnchor="middle"
        >
          {xLabel}
        </text>
        {(vertical ?? []).map((v) => (
          <g key={v.label}>
            <line
              x1={px(v.x)}
              x2={px(v.x)}
              y1={top}
              y2={top + plotH}
              stroke={chartNeutral}
              strokeDasharray="3 3"
            />
            <text
              x={px(v.x) + (px(v.x) > width - 130 ? -5 : 5)}
              y={top + 11}
              fontSize={11.5}
              fill={chartMuted}
              textAnchor={px(v.x) > width - 130 ? "end" : "start"}
            >
              {v.label}
            </text>
          </g>
        ))}
        {(horizontal ?? []).map((h) => (
          <g key={h.label}>
            <line
              x1={left}
              x2={width - right}
              y1={py(h.y)}
              y2={py(h.y)}
              stroke={chartInk}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text
              x={h.align === "start" ? left + 6 : width - right}
              y={py(h.y) - 6}
              fontSize={11.5}
              fontWeight={600}
              fill={chartInk}
              textAnchor={h.align === "start" ? "start" : "end"}
            >
              {h.label}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <path
              d={s.points
                .map(
                  (p, i) =>
                    `${i ? "L" : "M"}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`,
                )
                .join("")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
            {(s.marks ?? []).map((m, i) => (
              <circle
                key={i}
                cx={px(m.x)}
                cy={py(m.y)}
                r={5}
                fill={s.color}
                stroke="#fff"
                strokeWidth={2}
              />
            ))}
          </g>
        ))}
        <line
          className="rw-cross"
          y1={top}
          y2={top + plotH}
          stroke={chartInk}
          strokeWidth={1}
          opacity={0}
        />
      </svg>
      {tooltip.node}
    </figure>
  );
}

function FragmentRow({
  color,
  name,
  children,
}: {
  color: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <>
      <strong>{children}</strong>
      <span className="rw-tip-key">
        <i style={{ background: color }} />
        {name}
      </span>
    </>
  );
}

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

export interface ScatterPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  /** 措施生效后的位置；与现状不同时画一条连线。 */
  toX?: number;
  toY?: number;
  labelled?: boolean;
  tip: ReactNode;
}
/**
 * 频次—单次损失图（双对数）。每周损失 = 频次 × 单次损失，所以等损失线是斜率为 −1 的直线：
 * 越靠右上损失越大；往左移是降低故障频次（提升 MTBF），往下移是缩短单次损失（降低 MTTR）。
 */
export function RiskMap({
  points,
  label,
  onSelect,
}: {
  points: ScatterPoint[];
  label: string;
  onSelect?: (id: string) => void;
}) {
  const tooltip = useTooltip();
  const width = 720,
    height = 380,
    left = 64,
    right = 20,
    top = 20,
    bottom = 46,
    plotW = width - left - right,
    plotH = height - top - bottom;
  const valid = points.filter((p) => p.x > 0 && p.y > 0),
    allX = valid.flatMap((p) => [p.x, p.toX ?? p.x]).filter((v) => v > 0),
    allY = valid.flatMap((p) => [p.y, p.toY ?? p.y]).filter((v) => v > 0),
    // 取整到十倍刻度；下边多留一些，避免一排点贴在横轴上
    decade = (v: number, up: boolean, pad = 0.05) =>
      10 **
      (up ? Math.ceil(Math.log10(v) + pad) : Math.floor(Math.log10(v) - pad)),
    x0 = decade(Math.min(...allX), false),
    x1 = decade(Math.max(...allX), true),
    y0 = decade(Math.min(...allY), false, 0.3),
    y1 = decade(Math.max(...allY), true);
  const px = (v: number) =>
      left +
      ((Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) *
        plotW,
    py = (v: number) =>
      top +
      plotH -
      ((Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))) *
        plotH;
  const decades = (from: number, to: number) => {
    const ticks: number[] = [];
    for (let v = from; v <= to * 1.0001; v *= 10) ticks.push(v);
    return ticks;
  };
  const time = (h: number) =>
    h >= 1
      ? `${Number(h.toPrecision(2))} 小时`
      : h >= 1 / 60
        ? `${Number((h * 60).toPrecision(2))} 分钟`
        : `${Number((h * 3600).toPrecision(2))} 秒`;
  const rate = (v: number) =>
    v >= 1
      ? `${Number(v.toPrecision(2))}`
      : v >= 0.001
        ? String(Number(v.toPrecision(1)))
        : v.toExponential(0);
  // 等损失线：每周损失 0.01、0.1、1、10、100 小时
  const iso = [0.01, 0.1, 1, 10, 100].filter(
    (loss) => loss / x1 < y1 && loss / x0 > y0,
  );
  // 标签避让：按横坐标依次摆放，与已放好的标签重叠时往上错开一行
  const placed: { x: number; y: number; w: number }[] = [],
    labelAt = new Map<string, { x: number; y: number; lead: boolean }>();
  for (const p of valid
    .filter((v) => v.labelled)
    .sort((a, b) => px(a.x) - px(b.x))) {
    const w = p.name.length * 12 + 6,
      x = Math.min(px(p.x) + 9, width - right - w);
    let offset = -8;
    for (const dy of [-8, -24, -40, -56, -72, 20, 36]) {
      const y = py(p.y) + dy;
      if (y < top + 26 || y > top + plotH - 4) continue;
      if (
        !placed.some(
          (o) => Math.abs(o.y - y) < 15 && x < o.x + o.w && o.x < x + w,
        )
      ) {
        offset = dy;
        break;
      }
    }
    placed.push({ x, y: py(p.y) + offset, w });
    labelAt.set(p.id, { x, y: py(p.y) + offset, lead: Math.abs(offset) > 10 });
  }
  return (
    <figure className="rw-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <defs>
          <clipPath id="rw-risk-clip">
            <rect x={left} y={top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        <text x={left} y={12} fontSize={11.5} fill={chartMuted}>
          单次等效损失（等效 MTTR）
        </text>
        {decades(y0, y1).map((tick) => (
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
              {time(tick)}
            </text>
          </g>
        ))}
        {decades(x0, x1).map((tick) => (
          <g key={tick}>
            <line
              x1={px(tick)}
              x2={px(tick)}
              y1={top}
              y2={top + plotH}
              stroke={grid}
            />
            <text
              x={px(tick)}
              y={top + plotH + 18}
              fontSize={11.5}
              fill={chartMuted}
              textAnchor="middle"
            >
              {rate(tick)}
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
        <text
          x={left + plotW / 2}
          y={height - 6}
          fontSize={11.5}
          fill={chartMuted}
          textAnchor="middle"
        >
          故障频次（次 / 周）
        </text>
        <g clipPath="url(#rw-risk-clip)">
          {iso.map((loss) => (
            <line
              key={loss}
              x1={px(x0)}
              y1={py(loss / x0)}
              x2={px(x1)}
              y2={py(loss / x1)}
              stroke={chartNeutral}
              strokeDasharray="4 4"
            />
          ))}
        </g>
        {iso.map((loss) => {
          // 标在等损失线与绘图区上边或右边的交点附近
          const atTop = loss / y1 >= x0 && loss / y1 <= x1,
            x = atTop ? px(loss / y1) : px(x1),
            y = atTop ? top : py(loss / x1);
          return (
            <text
              key={loss}
              x={Math.min(x + 4, width - right - 2)}
              y={Math.max(y + 12, top + 12)}
              fontSize={11}
              fill={chartMuted}
              textAnchor={x > width - 90 ? "end" : "start"}
            >
              每周损失 {loss} h
            </text>
          );
        })}
        {valid.map((p) => {
          const moved =
            p.toX !== undefined &&
            p.toY !== undefined &&
            p.toX > 0 &&
            p.toY > 0 &&
            (Math.abs(Math.log(p.toX / p.x)) > 0.02 ||
              Math.abs(Math.log(p.toY / p.y)) > 0.02);
          return (
            <g
              key={p.id}
              className={"rw-risk-point" + (onSelect ? " is-button" : "")}
              tabIndex={0}
              role={onSelect ? "button" : "group"}
              aria-label={p.name}
              onClick={onSelect ? () => onSelect(p.id) : undefined}
              onKeyDown={(e) => {
                if (onSelect && (e.key === "Enter" || e.key === " "))
                  onSelect(p.id);
              }}
              {...tooltip.bind(p.tip)}
            >
              {moved && (
                <>
                  <line
                    x1={px(p.x)}
                    y1={py(p.y)}
                    x2={px(p.toX!)}
                    y2={py(p.toY!)}
                    stroke={seriesColors[0]}
                    strokeWidth={1.6}
                  />
                  <circle
                    cx={px(p.toX!)}
                    cy={py(p.toY!)}
                    r={5}
                    fill={seriesColors[0]}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                </>
              )}
              <circle cx={px(p.x)} cy={py(p.y)} r={12} fill="transparent" />
              <circle
                cx={px(p.x)}
                cy={py(p.y)}
                r={5}
                fill={chartNeutral}
                stroke="#fff"
                strokeWidth={2}
              />
              {labelAt.has(p.id) && (
                <>
                  {labelAt.get(p.id)!.lead && (
                    <line
                      x1={px(p.x)}
                      y1={py(p.y)}
                      x2={labelAt.get(p.id)!.x - 2}
                      y2={labelAt.get(p.id)!.y - 4}
                      stroke={chartNeutral}
                      strokeWidth={1}
                    />
                  )}
                  <text
                    x={labelAt.get(p.id)!.x}
                    y={labelAt.get(p.id)!.y}
                    fontSize={11.5}
                    fill={chartInk}
                  >
                    {p.name}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {tooltip.node}
    </figure>
  );
}

import {
  applyMeasures,
  assess,
  createEvaluator,
  effectSweep,
  evidenceStateNames,
  higherIsBetter,
  layerOf,
  layerPotential,
  loadByStage,
  measureCategoryNames,
  measureLayerNames,
  measureParamNames,
  minimumDegrees,
  priorityPath,
  readParam,
  recoveryLevelNames,
  recoveryRoute,
  type Analysis,
  type CoreModel,
  type Measure,
  type VerificationResult,
} from "../../../../packages/core/src/index";
import { applyEffect, baseValue, formatParam, isRatio } from "./helpers";
import { duration, frequency, hours, percent, points, scale } from "./format";

/**
 * 汇报页的内容模型：每页是一组画在 13.333 × 7.5 英寸画布上的图元。
 * 同一份图元既输出 PPT，也输出网页，所以两种报告的数字、图和版式完全一致。
 */
export type Run = { text: string; bold?: boolean; color?: string };
export type Align = "left" | "center" | "right";
export type Cell = string | { text: string; bold?: boolean; color?: string };
export type Prim =
  | {
      t: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      line?: string;
      radius?: number;
    }
  | {
      t: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width?: number;
      dash?: boolean;
    }
  | {
      t: "text";
      x: number;
      y: number;
      w: number;
      h: number;
      runs: Run[];
      size: number;
      bold?: boolean;
      color?: string;
      align?: Align;
      valign?: "top" | "middle" | "bottom";
    }
  | {
      t: "table";
      x: number;
      y: number;
      w: number;
      colW: number[];
      head: string[];
      rows: Cell[][];
      size: number;
      align?: Align[];
    };
export interface BriefSlide {
  title: string;
  prims: Prim[];
}
export interface Brief {
  title: string;
  subtitle: string;
  slides: BriefSlide[];
}

export const briefSize = { width: 13.333, height: 7.5 };
/** 白底配色：蓝 = 组件级（降频次），橙 = 系统级（缩短单次损失），绿 = 目标与达标。 */
export const briefColors = {
  ink: "101828",
  ink2: "475467",
  muted: "667085",
  line: "E4E7EC",
  soft: "F4F6F9",
  accent: "1D5FD0",
  blue: "2A78D6",
  orange: "EB6834",
  green: "0E9F6E",
  greenSoft: "E7F6EC",
  grey: "B9BEC7",
  greyLight: "D9DDE4",
  bad: "C4320A",
  warn: "B54708",
  white: "FFFFFF",
};
const C = briefColors,
  LEFT = 0.6,
  RIGHT = briefSize.width - 0.6,
  WIDTH = RIGHT - LEFT,
  TOP = 1.95,
  BOTTOM = 6.85;

/** 估算文字宽度（英寸）：中文按一个字宽，数字和拉丁字母约半个字宽。 */
const textWidth = (text: string, size: number) =>
  ([...text].reduce(
    (sum, ch) => sum + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56),
    0,
  ) *
    size) /
  72;
const lineCount = (text: string, size: number, width: number) =>
  Math.max(1, Math.ceil(textWidth(text, size) / (width * 0.94)));
const lineHeight = (size: number) => (size / 72) * 1.5;
/** 按字数截断（中文计 1，数字和拉丁字母约计半个字），超出时加省略号。 */
const clip = (text: string, limit: number) => {
  let used = 0,
    out = "";
  for (const ch of text) {
    used += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56;
    if (used > limit) return out + "…";
    out += ch;
  }
  return out;
};

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: string,
  line?: string,
  radius?: number,
): Prim => ({ t: "rect", x, y, w, h, fill, line, radius });
const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width = 1,
  dash = false,
): Prim => ({ t: "line", x1, y1, x2, y2, color, width, dash });
const text = (
  x: number,
  y: number,
  w: number,
  h: number,
  content: string | Run[],
  size: number,
  options: Partial<Extract<Prim, { t: "text" }>> = {},
): Prim => ({
  t: "text",
  x,
  y,
  w,
  h,
  runs: typeof content === "string" ? [{ text: content }] : content,
  size,
  ...options,
});

/** 每页的公共部分：标题、一句话结论、页脚。 */
function frame(title: string, lead: string, footer: string, page: number) {
  // 标题太长时缩小字号，保证一行放得下
  const size = Math.min(
    26,
    Math.max(18, Math.floor((26 * WIDTH) / (textWidth(title, 26) * 1.08))),
  );
  return [
    text(LEFT, 0.42, WIDTH, 0.62, title, size, {
      bold: true,
      color: C.ink,
      valign: "middle",
    }),
    text(LEFT, 1.08, WIDTH, 0.72, lead, 14.5, { color: C.ink2 }),
    line(LEFT, 7.02, RIGHT, 7.02, C.line),
    text(LEFT, 7.08, 8, 0.28, footer, 10, { color: C.muted }),
    text(RIGHT - 2, 7.08, 2, 0.28, String(page), 10, {
      color: C.muted,
      align: "right",
    }),
  ];
}

/** 指标卡：小标题、大数字、一行说明。 */
function kpi(
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  note: string,
  color = C.ink,
): Prim[] {
  return [
    rect(x, y, w, h, C.white, C.line, 0.08),
    text(x + 0.22, y + 0.16, w - 0.44, 0.3, label, 12, { color: C.muted }),
    text(
      x + 0.22,
      y + 0.46,
      w - 0.44,
      h - 1.0,
      value,
      // 数字太长时缩小字号，保证一行放得下（按偏宽的字体估算）
      Math.min(
        30,
        Math.max(
          16,
          Math.floor((30 * (w - 0.5)) / (textWidth(value, 30) * 1.3)),
        ),
      ),
      { bold: true, color, valign: "middle" },
    ),
    text(x + 0.22, y + h - 0.5, w - 0.44, 0.36, note, 11.5, { color: C.ink2 }),
  ];
}

/** 要点列表：小方块做项目符号，可带加粗的小标题。 */
function bullets(
  x: number,
  y: number,
  w: number,
  items: { head?: string; text: string }[],
  size = 14,
  gap = 0.17,
) {
  const prims: Prim[] = [];
  let top = y;
  for (const item of items) {
    const full = (item.head ?? "") + item.text,
      height = lineCount(full, size, w - 0.28) * lineHeight(size);
    prims.push(
      rect(x, top + lineHeight(size) / 2 - 0.045, 0.09, 0.09, C.accent),
      text(
        x + 0.28,
        top,
        w - 0.28,
        height,
        [
          ...(item.head ? [{ text: item.head, bold: true, color: C.ink }] : []),
          { text: item.text },
        ],
        size,
        { color: C.ink2 },
      ),
    );
    top += height + gap;
  }
  return { prims, bottom: top };
}

/** 图例：色块加文字，横向排开。 */
function legend(x: number, y: number, items: [string, string][]) {
  const prims: Prim[] = [];
  let left = x;
  for (const [color, name] of items) {
    prims.push(
      rect(left, y + 0.06, 0.16, 0.16, color, undefined, 0.02),
      text(left + 0.22, y, textWidth(name, 11) + 0.2, 0.28, name, 11, {
        color: C.ink2,
        valign: "middle",
      }),
    );
    left += 0.22 + textWidth(name, 11) + 0.36;
  }
  return prims;
}

interface BarRow {
  name: string;
  value: number;
  label: string;
  color: string;
  /** 浅色的延伸段（如做到极限）。 */
  extra?: number;
  /** 行内的参考竖线（如预算）。 */
  mark?: number;
  sub?: string;
}
/** 横向条形图：名称在左，数值写在条的右边。 */
function hbars(
  x: number,
  y: number,
  w: number,
  h: number,
  rows: BarRow[],
  options: {
    nameW?: number;
    labelW?: number;
    max?: number;
    /** 横轴起点；默认从 0 开始。 */
    min?: number;
    /** 每行的最大高度。 */
    rowH?: number;
    target?: number;
    targetLabel?: string;
  } = {},
) {
  const prims: Prim[] = [],
    nameW = options.nameW ?? 2.6,
    labelW = options.labelW ?? 1.5,
    trackX = x + nameW + 0.12,
    trackW = w - nameW - labelW - 0.24,
    max =
      options.max ??
      Math.max(
        1e-12,
        ...rows.map((r) => Math.max(r.value, r.extra ?? 0, r.mark ?? 0)),
        options.target ?? 0,
      ),
    rowH = Math.min(options.rowH ?? 0.52, h / Math.max(rows.length, 1)),
    barH = Math.min(options.rowH ? 0.34 : 0.24, rowH * 0.5),
    min = options.min ?? 0,
    at = (value: number) =>
      Math.min(1, Math.max(0, (value - min) / (max - min || 1))) * trackW;
  rows.forEach((row, index) => {
    const top = y + index * rowH,
      mid = top + rowH / 2;
    prims.push(
      text(x, top, nameW, rowH, clip(row.name, 18), 11.5, {
        color: C.ink,
        valign: "middle",
        align: "right",
      }),
      rect(trackX, mid - barH / 2, trackW, barH, C.soft),
    );
    if (row.extra !== undefined && row.extra > row.value)
      prims.push(
        rect(trackX, mid - barH / 2, at(row.extra), barH, C.greyLight),
      );
    if (row.value > min)
      prims.push(
        rect(
          trackX,
          mid - barH / 2,
          Math.max(at(row.value), 0.02),
          barH,
          row.color,
        ),
      );
    if (row.mark !== undefined)
      prims.push(
        line(
          trackX + at(row.mark),
          mid - barH / 2 - 0.05,
          trackX + at(row.mark),
          mid + barH / 2 + 0.05,
          C.ink,
          1.5,
        ),
      );
    prims.push(
      text(trackX + trackW + 0.12, top, labelW, rowH, row.label, 11.5, {
        color: C.ink,
        bold: true,
        valign: "middle",
      }),
    );
  });
  if (options.target !== undefined) {
    const tx = trackX + at(options.target);
    prims.push(
      line(tx, y - 0.08, tx, y + rows.length * rowH + 0.04, C.green, 1.5, true),
      text(tx - 1.5, y - 0.36, 3, 0.28, options.targetLabel ?? "目标", 11, {
        color: C.green,
        bold: true,
        align: "center",
      }),
    );
  }
  return { prims, bottom: y + rows.length * rowH };
}

const layerColor = (measure: { category: Measure["category"] }) =>
  layerOf(measure.category) === "component" ? C.blue : C.orange;
const layerName = (measure: { category: Measure["category"] }) =>
  layerOf(measure.category) === "component"
    ? "组件级"
    : "系统级·" + measureCategoryNames[measure.category];
const ratioText = (value: number) => Number((value * 100).toFixed(2)) + "%";
const paramText = (
  param: Measure["effects"][number]["param"],
  value: number,
) => (isRatio(param) ? ratioText(value) : formatParam(param, value));

/** “a → b”：两边单位相同时只在后面写一次单位。 */
function fromTo(a: string, b: string) {
  const unit = (text: string) => text.replace(/^[\d.,\s]+/, "");
  return unit(a) && unit(a) === unit(b)
    ? `${a.slice(0, a.length - unit(a).length).trim()} → ${b}`
    : `${a} → ${b}`;
}

/** 措施主要参数“现状 → 计划”的写法。 */
export function effectSummary(model: CoreModel, measure: Measure) {
  const effect = measure.effects[0],
    name = measureParamNames[effect.param]
      .replace(" · ", "")
      .replace(" FIT", "");
  if (effect.op === "reduce")
    return `${effect.param === "coverage" ? "漏检率" : name.replace(" FIT", "")}降低 ${percent(effect.value, 0)}`;
  if (effect.op === "subtract")
    return `${name}减少 ${paramText(effect.param, effect.value)}`;
  if (effect.op === "add")
    return `${name}增加 ${paramText(effect.param, effect.value)}`;
  const base = baseValue(model, measure, effect.param);
  if (base !== null)
    return `${name} ${paramText(effect.param, base)} → ${paramText(effect.param, applyEffect(effect, base, measure.applicability))}`;
  const values = model.modes
      .filter((mode) => measure.modeIds.includes(mode.id))
      .map((mode) => readParam(mode, effect.param)),
    worst = higherIsBetter(effect.param)
      ? Math.min(...values)
      : Math.max(...values);
  return `${name} ${paramText(effect.param, worst)} → ${paramText(effect.param, effect.value)}`;
}

/** 组合路径瀑布：每一行是加入一项措施后可用度从哪里到哪里。 */
function waterfall(
  x: number,
  y: number,
  w: number,
  h: number,
  base: number,
  rows: {
    name: string;
    sub: string;
    from: number;
    to: number;
    color: string;
  }[],
  target: number,
) {
  const prims: Prim[] = [],
    nameW = 3.5,
    valueW = 2.3,
    trackX = x + nameW + 0.15,
    trackW = w - nameW - valueW - 0.3,
    rowH = Math.min(0.46, (h - 0.35) / (rows.length + 1)),
    barH = Math.min(0.22, rowH * 0.5),
    top = y + 0.35,
    at = (value: number) => trackX + Math.min(1, Math.max(0, value)) * trackW;
  for (const tick of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    prims.push(
      line(
        at(tick),
        top - 0.04,
        at(tick),
        top + (rows.length + 1) * rowH,
        C.line,
      ),
      text(at(tick) - 0.5, y, 1, 0.28, percent(tick, 0), 10, {
        color: C.muted,
        align: "center",
      }),
    );
  }
  const all = [
    { name: "现状", sub: "不做任何措施", from: 0, to: base, color: C.grey },
    ...rows,
  ];
  all.forEach((row, index) => {
    const rowTop = top + index * rowH,
      mid = rowTop + rowH / 2;
    prims.push(
      text(
        x,
        rowTop,
        nameW,
        rowH,
        [
          {
            text: (index === 0 ? "" : index + "  ") + clip(row.name, 16),
            bold: true,
            color: C.ink,
          },
          { text: "  " + row.sub, color: C.muted },
        ],
        11,
        { valign: "middle" },
      ),
      rect(
        // 负收益的一步向左画
        Math.min(at(row.from), at(row.to)),
        mid - barH / 2,
        Math.max(Math.abs(at(row.to) - at(row.from)), 0.03),
        barH,
        row.color,
        undefined,
        0.02,
      ),
      text(
        trackX + trackW + 0.15,
        rowTop,
        valueW,
        rowH,
        [
          {
            text: index === 0 ? "" : points(row.to - row.from) + "  ",
            bold: true,
            color: C.ink,
          },
          { text: "→ " + percent(row.to), color: C.ink2 },
        ],
        11,
        { valign: "middle" },
      ),
    );
    if (index > 0)
      prims.push(
        line(
          at(row.from),
          rowTop - rowH / 2 + barH / 2,
          at(row.from),
          mid - barH / 2,
          C.grey,
          0.75,
        ),
      );
  });
  prims.push(
    line(
      at(target),
      top - 0.04,
      at(target),
      top + all.length * rowH,
      C.green,
      1.75,
      true,
    ),
    text(
      at(target) - 1.3,
      top + all.length * rowH + 0.02,
      2.6,
      0.28,
      "目标 " + percent(target),
      11,
      {
        color: C.green,
        bold: true,
        align: "center",
      },
    ),
  );
  return prims;
}

/** 差距从哪边补：每个模块三根横条（只降频次、只缩短单次损失、两边都做），对数刻度。 */
function leverChart(
  x: number,
  y: number,
  w: number,
  h: number,
  rows: {
    name: string;
    now: number;
    component: number;
    system: number;
    both: number;
    verdict: string;
    tone: string;
  }[],
) {
  const prims: Prim[] = [],
    nameW = 2.5,
    verdictW = 2.7,
    trackX = x + nameW + 0.15,
    trackW = w - nameW - verdictW - 0.3,
    values = rows
      .flatMap((r) => [r.now, r.component, r.system, r.both])
      .filter((v) => v > 0),
    low = Math.floor(Math.log10(Math.max(0.01, Math.min(0.5, ...values)))),
    high = Math.log10(Math.max(2, ...values)) + 0.35,
    at = (value: number) =>
      trackX +
      ((Math.log10(Math.max(value, 10 ** low)) - low) / (high - low)) * trackW,
    top = y + 0.32,
    rowH = Math.min(0.5, (h - 0.32) / Math.max(rows.length, 1)),
    barH = Math.min(0.085, rowH / 5.2),
    multiple = (value: number) =>
      value >= 100
        ? value.toFixed(0) + "×"
        : value >= 10
          ? value.toFixed(1) + "×"
          : value.toFixed(2) + "×";
  prims.push(
    rect(trackX, top, at(1) - trackX, rows.length * rowH, C.greenSoft),
  );
  for (let power = low; power <= Math.floor(high); power++) {
    const tick = 10 ** power;
    prims.push(
      line(
        at(tick),
        top,
        at(tick),
        top + rows.length * rowH,
        tick === 1 ? C.green : C.line,
        tick === 1 ? 1.75 : 1,
      ),
      text(
        at(tick) - 0.7,
        y,
        1.4,
        0.28,
        tick === 1
          ? "预算 1×"
          : (tick >= 1 ? tick.toFixed(0) : String(tick)) + "×",
        10,
        {
          color: tick === 1 ? C.green : C.muted,
          bold: tick === 1,
          align: "center",
        },
      ),
    );
  }
  rows.forEach((row, index) => {
    const rowTop = top + index * rowH,
      lanes: [number, string][] = [
        [row.component, C.blue],
        [row.system, C.orange],
        [row.both, C.green],
      ];
    prims.push(
      text(x, rowTop, nameW, rowH, clip(row.name, 16), 11.5, {
        color: C.ink,
        bold: true,
        valign: "middle",
        align: "right",
      }),
    );
    lanes.forEach(([to, color], lane) => {
      if (row.now - to < row.now * 0.005) return;
      prims.push(
        rect(
          at(to),
          rowTop + rowH / 2 + (lane - 1.5) * barH * 1.35,
          Math.max(at(row.now) - at(to), 0.03),
          barH,
          color,
          undefined,
          0.02,
        ),
      );
    });
    prims.push(
      line(
        at(row.now),
        rowTop + rowH * 0.12,
        at(row.now),
        rowTop + rowH * 0.88,
        C.ink,
        1.5,
      ),
      text(at(row.now) + 0.06, rowTop, 0.9, rowH, multiple(row.now), 10, {
        color: C.ink,
        bold: true,
        valign: "middle",
      }),
      text(trackX + trackW + 0.15, rowTop, verdictW, rowH, row.verdict, 11, {
        color: row.tone,
        bold: true,
        valign: "middle",
      }),
    );
    if (index > 0) prims.push(line(x, rowTop, x + w, rowTop, C.line, 0.5));
  });
  return prims;
}

/** 两行百分比堆叠条：单次故障的损失花在了哪个环节，改进前后对比。 */
function stageBars(
  x: number,
  y: number,
  w: number,
  rows: {
    name: string;
    total: string;
    parts: { name: string; share: number }[];
  }[],
  colors: Map<string, string>,
) {
  const prims: Prim[] = [],
    nameW = 1.2,
    totalW = 1.7,
    trackX = x + nameW,
    trackW = w - nameW - totalW,
    rowH = 0.62;
  rows.forEach((row, index) => {
    const top = y + index * rowH;
    let left = trackX;
    prims.push(
      text(x, top, nameW - 0.1, 0.4, row.name, 12, {
        color: C.ink,
        bold: true,
        valign: "middle",
      }),
    );
    for (const part of row.parts) {
      const width = part.share * trackW;
      if (width < 0.01) continue;
      prims.push(
        rect(left, top + 0.04, width, 0.32, colors.get(part.name) ?? C.grey),
      );
      if (width > 0.75)
        prims.push(
          text(left, top + 0.04, width, 0.32, percent(part.share, 0), 10, {
            color: C.white,
            bold: true,
            align: "center",
            valign: "middle",
          }),
        );
      left += width;
    }
    prims.push(
      text(trackX + trackW + 0.12, top, totalW, 0.4, row.total, 12, {
        color: C.ink,
        bold: true,
        valign: "middle",
      }),
    );
  });
  return { prims, bottom: y + rows.length * rowH };
}

const stagePalette = [
  "2A78D6",
  "EB6834",
  "0E9F6E",
  "EDA100",
  "9B6AD6",
  "5B7083",
  "D15B8A",
  "8C99A8",
];

/** 参数名里的字段部分：“进程重调度 · 成功率”取“成功率”。 */
const fieldName = (param: Measure["effects"][number]["param"]) =>
  measureParamNames[param].split(" · ").pop()!.replace(" FIT", "");
/** 把扫描点取整到便于阅读的值：比例按 5% 或 1%，时长按 30 秒、1 分钟等。 */
function niceValue(
  effect: Measure["effects"][number],
  value: number,
  span: number,
) {
  if (effect.op === "reduce" || isRatio(effect.param)) {
    const step =
      Math.abs(span) >= 0.3 ? 0.05 : Math.abs(span) >= 0.06 ? 0.01 : 0.001;
    return Number((Math.round(value / step) * step).toFixed(6));
  }
  if (effect.param === "fit") return Number(value.toPrecision(2));
  const range = Math.abs(span) * 3600,
    step =
      range >= 6 * 3600
        ? 1800
        : range >= 1200
          ? 60
          : range >= 120
            ? 30
            : range >= 20
              ? 5
              : 1;
  return (Math.round((value * 3600) / step) * step) / 3600;
}
const effectText = (effect: Measure["effects"][number], value: number) =>
  effect.op === "reduce"
    ? "降低 " + percent(value, 0)
    : effect.op === "subtract"
      ? "减少 " + paramText(effect.param, value)
      : paramText(effect.param, value);

/** 在一组候选里找数量最少、能把可用度推到目标的补充组合；找不到返回 null。 */
function smallestReaching(
  evaluate: (ids: Set<string>) => number,
  base: string[],
  pool: Measure[],
  target: number,
) {
  if (pool.length > 12) return null;
  let best: { picked: Measure[]; value: number } | null = null;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    const picked = pool.filter((_, i) => mask & (1 << i));
    if (best && picked.length > best.picked.length) continue;
    const value = evaluate(new Set([...base, ...picked.map((m) => m.id)]));
    if (value < target) continue;
    if (!best || picked.length < best.picked.length || value > best.value)
      best = { picked, value };
  }
  return best;
}

/** 画汇报页用的图元工具：定制或追加页面时复用，保证与内置页面同一套版式。 */
export const briefKit = {
  frame,
  rect,
  line,
  text,
  kpi,
  bullets,
  legend,
  hbars,
  content: { left: LEFT, right: RIGHT, width: WIDTH, top: TOP, bottom: BOTTOM },
};

/**
 * 生成立项汇报：结论、差距、改进方向、方案、组合收益、关键指标、验证、风险与下一步。
 * “方案”指当前已启用的措施；数字与界面取自同一份解析结果。
 */
export function buildBrief(
  title: string,
  model: CoreModel,
  analysis: Analysis,
  verification: VerificationResult | null,
): Brief {
  const { scenario } = model,
    {
      baseline,
      design,
      baselineGaps,
      designGaps,
      contributions,
      recommendation,
    } = analysis,
    target = scenario.target,
    before = baseline.system,
    after = design.system,
    met = after.availability >= target && recommendation.kind === "met",
    enabled = model.measures.filter((m) => m.enabled),
    enabledIds = new Set(enabled.map((m) => m.id)),
    component = enabled.filter((m) => layerOf(m.category) === "component"),
    system = enabled.filter((m) => layerOf(m.category) === "system"),
    share = new Map(contributions.items.map((c) => [c.id, c] as const)),
    byShare = [...enabled].sort(
      (a, b) => share.get(b.id)!.shapley - share.get(a.id)!.shapley,
    ),
    // 先算组件级措施（升 MTBF），再算系统级措施（降 MTTR）：各段内部按提升大小逐项加入
    path = priorityPath(model, 30, enabledIds, "layer"),
    evaluateIds = createEvaluator(model),
    // 每项措施按这个顺序加入时带来的提升；在这组里没有提升的措施接在最后
    sequence = (() => {
      const chosen = new Set<string>(),
        gains = new Map<string, number>();
      for (const step of path.steps) {
        gains.set(step.id, step.gain);
        chosen.add(step.id);
      }
      for (const m of enabled) {
        if (chosen.has(m.id)) continue;
        const start = evaluateIds(chosen);
        chosen.add(m.id);
        gains.set(m.id, evaluateIds(chosen) - start);
      }
      return gains;
    })(),
    seqGain = (list: Measure[]) =>
      list.reduce((sum, m) => sum + (sequence.get(m.id) ?? 0), 0),
    // 组件级措施做完时的状态：两段的分界
    afterComponent = assess(
      model,
      applyMeasures(model, new Set(component.map((m) => m.id))),
    ).system,
    stageGain = {
      component: afterComponent.availability - before.availability,
      system: after.availability - afterComponent.availability,
    },
    minimum = minimumDegrees(model, [...enabledIds]),
    potential = layerPotential(model),
    nameOf = (id: string) =>
      model.measures.find((m) => m.id === id)?.name ?? id,
    footer = `${title} · ${scale(scenario.cards)} · 窗口 ${scenario.hours} 小时 · ReMAP 可靠性建模与分析`,
    slides: BriefSlide[] = [],
    add = (heading: string, lead: string, prims: Prim[]) =>
      slides.push({
        title: heading,
        prims: [...frame(heading, lead, footer, slides.length + 1), ...prims],
      });
  const gapText = met
      ? `高于目标 ${points(after.availability - target).replace("+", "")}`
      : `距目标还差 ${((target - after.availability) * 100).toFixed(2)} pp`,
    totalGain = after.availability - before.availability,
    worst = [...baseline.modules].sort(
      (a, b) => b.lossHoursPerWeek - a.lossHoursPerWeek,
    ),
    simulated = verification
      ? `独立仿真均值 ${percent(verification.design.mean)}，${percent(verification.design.passRatio, 1)} 的窗口达到目标`
      : "尚未运行独立仿真验证";

  // ---------- 1 封面 ----------
  slides.push({
    title,
    prims: [
      rect(0, 0, briefSize.width, 0.16, C.accent),
      text(LEFT, 1.55, WIDTH, 0.4, "立项汇报 · 可用度提升方案", 16, {
        color: C.accent,
        bold: true,
      }),
      text(LEFT, 2.05, WIDTH, 1.3, title, 40, {
        bold: true,
        color: C.ink,
        valign: "middle",
      }),
      text(
        LEFT,
        3.4,
        WIDTH,
        0.5,
        `${scale(scenario.cards)}集群 · 评估窗口 ${scenario.hours} 小时 · 可用度目标 ${percent(target)}`,
        16,
        { color: C.ink2 },
      ),
      ...kpi(
        LEFT,
        4.35,
        3.85,
        1.75,
        "现状可用度",
        percent(before.availability),
        `每周损失 ${hours(before.lossHoursPerWeek)}`,
        C.bad,
      ),
      ...kpi(
        LEFT + 4.14,
        4.35,
        3.85,
        1.75,
        "方案后可用度（解析）",
        percent(after.availability),
        gapText,
        met ? C.green : C.warn,
      ),
      ...kpi(
        LEFT + 8.28,
        4.35,
        3.85,
        1.75,
        "可用度目标",
        percent(target),
        `允许每周损失 ${hours(168 * (1 - target))}`,
        C.ink,
      ),
      line(LEFT, 7.02, RIGHT, 7.02, C.line),
      text(
        LEFT,
        7.08,
        9,
        0.28,
        "ReMAP 可靠性建模与分析平台 · 四步工作台：目标分配 → 可用度评估 → 机制设计 → 机制验证",
        10,
        { color: C.muted },
      ),
      text(
        RIGHT - 3,
        7.08,
        3,
        0.28,
        new Date().toISOString().slice(0, 10),
        10,
        { color: C.muted, align: "right" },
      ),
    ],
  });

  // ---------- 2 结论 ----------
  {
    const items = [
      {
        head: "差距：",
        text: `现状可用度 ${percent(before.availability)}，每连续运行一周发生 ${frequency(before.ratePerWeek).replace(" 次/周", "")} 次故障，单次等效损失 ${duration(before.mttrHours)}；目标 ${percent(target)} 只允许每周损失 ${hours(168 * (1 - target))}。`,
      },
      {
        head: "方案：",
        text: `${enabled.length} 项措施（${measureLayerNames.component} ${component.length} 项、${measureLayerNames.system} ${system.length} 项），把可用度从 ${percent(before.availability)} 提到 ${percent(after.availability)}，${gapText}。`,
      },
      ...(component.length && system.length
        ? [
            {
              head: "先升 MTBF：",
              text: `${measureLayerNames.component} ${component.length} 项把 MTBF 从 ${duration(before.mtbfHours)} 提到 ${duration(afterComponent.mtbfHours)}，可用度到 ${percent(afterComponent.availability)}（${points(stageGain.component)}）。`,
            },
            {
              head: "再降 MTTR：",
              text: `${measureLayerNames.system} ${system.length} 项把单次等效损失从 ${duration(afterComponent.mttrHours)} 缩到 ${duration(after.mttrHours)}，可用度到 ${percent(after.availability)}（${points(stageGain.system)}）。`,
            },
          ]
        : []),
      {
        head: "验证：",
        text: simulated + "。",
      },
      ...(!met && recommendation.kind !== "met"
        ? [
            {
              head: "还差：",
              text:
                recommendation.kind === "add"
                  ? `再启用 ${recommendation.add.map(nameOf).join("、")} 可达 ${percent(recommendation.availability)}。`
                  : `措施库里参与设计的措施全部做足只到 ${percent(recommendation.ceiling)}，需要加码参数或新增措施。`,
            },
          ]
        : []),
    ];
    add(
      met
        ? `结论：${enabled.length} 项措施可把可用度从 ${percent(before.availability, 1)} 提到 ${percent(after.availability, 1)}，达到目标`
        : `结论：当前方案可到 ${percent(after.availability, 1)}，${gapText}`,
      `每周损失从 ${hours(before.lossHoursPerWeek)} 降到 ${hours(after.lossHoursPerWeek)}；故障频次 ${frequency(before.ratePerWeek)} → ${frequency(after.ratePerWeek)}，单次等效损失 ${duration(before.mttrHours)} → ${duration(after.mttrHours)}。`,
      [
        ...kpi(
          LEFT,
          TOP,
          2.85,
          1.6,
          "现状",
          percent(before.availability),
          `MTBF ${duration(before.mtbfHours)}`,
          C.bad,
        ),
        ...kpi(
          LEFT + 3.09,
          TOP,
          2.85,
          1.6,
          "方案后（解析）",
          percent(after.availability),
          gapText,
          met ? C.green : C.warn,
        ),
        ...kpi(
          LEFT + 6.18,
          TOP,
          2.85,
          1.6,
          "方案后（仿真）",
          verification ? percent(verification.design.mean) : "—",
          verification
            ? `窗口达标 ${percent(verification.design.passRatio, 1)}`
            : "待运行独立验证",
          C.ink,
        ),
        ...kpi(
          LEFT + 9.27,
          TOP,
          2.86,
          1.6,
          "目标",
          percent(target),
          `${scale(scenario.cards)} · ${scenario.hours} h 窗口`,
          C.ink,
        ),
        ...bullets(LEFT, TOP + 1.95, WIDTH, items, 14.5).prims,
      ],
    );
  }

  // ---------- 路线与关键措施：先算公共量 ----------
  const evaluate = createEvaluator(model),
    idSet = (list: Measure[]) => new Set(list.map((m) => m.id)),
    heldList = model.measures.filter((m) => m.hold && !m.enabled),
    // 关键措施：有“暂不优化”的机制时看它（做了值多少）；否则看去掉后跌得最多的那一项
    keyMeasure: Measure | undefined = heldList.length
      ? [...heldList].sort((a, b) => {
          const top = (m: Measure) =>
            effectSweep(model, m.id, 0, 1)?.points[1].availability ?? 0;
          return top(b) - top(a);
        })[0]
      : [...enabled].sort(
          (a, b) => share.get(b.id)!.marginal - share.get(a.id)!.marginal,
        )[0],
    // 关键措施保持现状、措施库其余参与设计的措施全部做足能到多少
    restIds = keyMeasure
      ? new Set(
          model.measures
            .filter((m) => m.id !== keyMeasure.id && !(m.hold && !m.enabled))
            .map((m) => m.id),
        )
      : new Set<string>(),
    restPath = keyMeasure ? priorityPath(model, 40, restIds) : null,
    restCeiling = restPath
      ? (restPath.steps[restPath.steps.length - 1]?.availability ??
        restPath.base)
      : before.availability,
    restStages = restPath
      ? loadByStage(
          assess(
            model,
            applyMeasures(model, new Set(restPath.steps.map((s) => s.id))),
          ),
        )
      : [];

  // ---------- 路线：分几步走到目标 ----------
  {
    const firm = enabled.filter((m) => m.evidence !== "assumed"),
      soft = enabled.filter((m) => m.evidence === "assumed"),
      split = firm.length > 0 && soft.length > 0,
      firmValue = split ? evaluate(idSet(firm)) : null,
      reaches = after.availability >= target,
      minimal =
        reaches && split && firmValue! < target
          ? smallestReaching(
              evaluate,
              firm.map((m) => m.id),
              soft,
              target,
            )
          : null,
      showMinimal = minimal !== null && minimal.picked.length < soft.length,
      keyNeeded =
        reaches && keyMeasure?.enabled === true && restCeiling < target,
      rows: (BarRow & { note: string })[] = [
        {
          name: "现状",
          value: before.availability,
          color: C.grey,
          note: "",
          label: "",
        },
      ],
      notes: { head: string; text: string }[] = [],
      gap = (value: number) =>
        value >= target
          ? `高于目标 ${((value - target) * 100).toFixed(2)} pp`
          : `距目标还差 ${((target - value) * 100).toFixed(2)} pp`;
    if (split) {
      rows.push({
        name: `已有证据或已立项的 ${firm.length} 项`,
        value: firmValue!,
        color: C.blue,
        note: firmValue! >= target ? "已达标" : "",
        label: "",
      });
      notes.push({
        head: `已有证据或已立项的 ${firm.length} 项：`,
        text: `把可用度从 ${percent(before.availability)} 提到 ${percent(firmValue!)}，${gap(firmValue!)}。`,
      });
    }
    if (keyNeeded) {
      rows.push({
        name: `措施库其余全做，${clip(keyMeasure!.name, 8)}不动`,
        value: restCeiling,
        color: C.warn,
        note: "上限",
        label: "",
      });
      notes.push({
        head: `“${keyMeasure!.name}”不能不做：`,
        text: `它保持现状时，措施库里其余 ${restPath!.steps.length} 项有提升的措施全部做足也只到 ${percent(restCeiling)}，${gap(restCeiling)}。`,
      });
    }
    if (showMinimal) {
      rows.push({
        name: `＋${minimal!.picked.length} 项（共 ${firm.length + minimal!.picked.length} 项）`,
        value: minimal!.value,
        color: C.green,
        note: "刚好达标",
        label: "",
      });
      notes.push({
        head: `再加 ${minimal!.picked.length} 项达标：`,
        text: `${minimal!.picked.map((m) => m.name).join("、")}，到 ${percent(minimal!.value)}，余量只有 ${((minimal!.value - target) * 100).toFixed(2)} pp；均值刚过线时，窗口波动会让一部分周不达标。`,
      });
    }
    rows.push({
      name: reaches
        ? `全部方案 ${enabled.length} 项`
        : `当前方案 ${enabled.length} 项`,
      value: after.availability,
      color: reaches ? C.green : C.orange,
      note: reaches ? "达标" : "",
      label: "",
    });
    notes.push({
      head: reaches
        ? `全部 ${enabled.length} 项：`
        : `当前方案 ${enabled.length} 项：`,
      text:
        `到 ${percent(after.availability)}，${gap(after.availability)}` +
        (verification
          ? `；独立仿真里 ${percent(verification.design.passRatio, 1)} 的窗口达到目标。`
          : "。"),
    });
    if (!reaches && recommendation.kind === "add") {
      rows.push({
        name: `＋推荐的 ${recommendation.add.length} 项`,
        value: recommendation.availability,
        color: C.green,
        note: "达标",
        label: "",
      });
      notes.push({
        head: `再启用 ${recommendation.add.length} 项达标：`,
        text: `${recommendation.add.map(nameOf).join("、")}，到 ${percent(recommendation.availability)}。`,
      });
    }
    if (!reaches && recommendation.kind === "short") {
      rows.push({
        name: "措施库里参与设计的全部做足",
        value: recommendation.ceiling,
        color: C.warn,
        note: "上限",
        label: "",
      });
      notes.push({
        head: "措施库的上限：",
        text:
          `参与设计的措施全部做足也只到 ${percent(recommendation.ceiling)}，${gap(recommendation.ceiling)}` +
          (heldList.length
            ? `；“${heldList.map((m) => m.name).join("、")}”标为暂不优化，没有计入。`
            : "，需要加码参数或新增措施。"),
      });
    }
    for (const row of rows)
      row.label = `${percent(row.value)}${row.note ? "　" + row.note : ""}`;
    if (rows.length >= 3)
      add(
        reaches && split && firmValue! < target
          ? `路线：已有证据或已立项的 ${firm.length} 项只到 ${percent(firmValue!, 1)}，补上 ${soft.length} 项后达到 ${percent(after.availability, 1)}`
          : reaches
            ? `路线：${enabled.length} 项措施把可用度从 ${percent(before.availability, 1)} 带到 ${percent(after.availability, 1)}`
            : recommendation.kind === "add"
              ? `路线：当前方案到 ${percent(after.availability, 1)}，再启用 ${recommendation.add.length} 项可达标`
              : `路线：当前方案到 ${percent(after.availability, 1)}，措施库全做也只到 ${percent(recommendation.ceiling, 1)}`,
        "横条是系统可用度，虚线是目标。按措施参数的把握程度分步：先看已有实测证据或已立项的措施能到哪里，再看还要补什么、补到什么程度才稳。",
        [
          ...hbars(LEFT, TOP + 0.55, WIDTH * 0.62, 4.2, rows, {
            nameW: 3.6,
            labelW: 2.3,
            rowH: 0.8,
            max: 1,
            target,
            targetLabel: "目标 " + percent(target),
          }).prims,
          ...bullets(LEFT + WIDTH * 0.66, TOP + 0.2, WIDTH * 0.34, notes, 12.5)
            .prims,
        ],
      );
  }

  // ---------- 关键措施的指标要求：两个参数 × 系统可用度 ----------
  if (keyMeasure) {
    const key = keyMeasure,
      active = new Set([...enabledIds, key.id]),
      ranges = key.effects.map((effect, index) => {
        const sweep = effectSweep(model, key.id, index, 1);
        if (!sweep) return null;
        const moved = Math.abs(sweep.planned - sweep.start) > 1e-12,
          hi = moved ? sweep.planned : sweep.limit;
        return {
          effect,
          index,
          lo: sweep.start,
          hi,
          limit: sweep.limit,
          moved,
        };
      }),
      a = ranges[0],
      // 第二个轴：下一个有调整范围的参数；与它同级、同取值的“失败耗时”跟着一起变
      b = ranges.find((r, i) => i > 0 && r !== null) ?? null,
      level = (param: string) => param.split(".")[0],
      tied = b
        ? key.effects
            .map((effect, index) => ({ effect, index }))
            .filter(
              ({ effect, index }) =>
                index !== a?.index &&
                index !== b.index &&
                effect.op === b.effect.op &&
                effect.value === b.effect.value &&
                effect.param.includes(".") &&
                level(effect.param) === level(b.effect.param) &&
                /hours$/i.test(effect.param) &&
                /hours$/i.test(b.effect.param),
            )
            .map(({ index }) => index)
        : [],
      at = (va: number, vb: number | null) =>
        createEvaluator({
          ...model,
          measures: model.measures.map((m) =>
            m.id !== key.id
              ? m
              : {
                  ...m,
                  effects: m.effects.map((effect, index) =>
                    index === a?.index
                      ? { ...effect, value: va }
                      : vb !== null &&
                          (index === b?.index || tied.includes(index))
                        ? { ...effect, value: vb }
                        : effect,
                  ),
                },
          ),
        })(active);
    if (a) {
      const values = (
          range: NonNullable<typeof a>,
          fractions: number[],
          beyond: boolean,
        ) => {
          const span = range.hi - range.lo,
            list = fractions.map((f) =>
              f === 0
                ? range.lo
                : f === 1
                  ? range.hi
                  : niceValue(range.effect, range.lo + f * span, span),
            );
          if (beyond && range.moved && Math.abs(range.limit - range.hi) > 1e-12)
            list.push(
              niceValue(
                range.effect,
                range.hi + 0.5 * (range.limit - range.hi),
                range.limit - range.hi,
              ),
            );
          return list.filter(
            (v, i) => list.findIndex((w) => Math.abs(w - v) < 1e-9) === i,
          );
        },
        rowValues = values(a, [0, 0.3, 0.6, 0.8, 0.9, 1], false),
        colValues = b ? values(b, [0, 1 / 3, 2 / 3, 1], true) : [],
        planA = a.moved ? a.hi : a.lo,
        planB = b ? (b.moved ? b.hi : b.lo) : null,
        // 另一个参数按计划时，这个参数最少要做到多少才达标
        threshold = (
          range: NonNullable<typeof a>,
          value: (v: number) => number,
        ): { kind: "none" | "free" | "value"; value: number } => {
          if (value(range.hi) < target)
            return { kind: "none", value: range.hi };
          if (value(range.lo) >= target)
            return { kind: "free", value: range.lo };
          let bad = range.lo,
            good = range.hi;
          for (let i = 0; i < 30; i++) {
            const middle = (bad + good) / 2;
            if (value(middle) >= target) good = middle;
            else bad = middle;
          }
          return { kind: "value", value: good };
        },
        needA = threshold(a, (v) => at(v, planB)),
        needB = b ? threshold(b, (v) => at(planA, v)) : null,
        planValue = at(planA, planB),
        bestValue = at(a.hi, b ? b.hi : null),
        nameA = fieldName(a.effect.param),
        nameB = b ? fieldName(b.effect.param) : "",
        bound = (range: NonNullable<typeof a>) =>
          range.effect.op === "reduce" || higherIsBetter(range.effect.param)
            ? "不低于"
            : "不超过",
        // 达标线往计划一侧取整（比例取 0.1%，时长取 1 秒），写出来的数一定够用
        toward = (range: NonNullable<typeof a>, value: number) => {
          const step =
              range.effect.op === "reduce" || isRatio(range.effect.param)
                ? 0.001
                : range.effect.param === "fit"
                  ? 1
                  : 1 / 3600,
            scaled = value / step;
          return (
            (range.hi > range.lo
              ? Math.ceil(scaled - 1e-9)
              : Math.floor(scaled + 1e-9)) * step
          );
        },
        needText = (
          range: NonNullable<typeof a>,
          need: typeof needA,
          name: string,
        ) =>
          need.kind === "free"
            ? `${name}保持现状即可`
            : need.kind === "none"
              ? `${name}做到 ${effectText(range.effect, range.hi)} 也不够`
              : `${name}${bound(range)} ${effectText(range.effect, toward(range, need.value))}`,
        prims: Prim[] = [],
        gx = LEFT,
        headW = 1.9,
        gridW = 7.3,
        colW = b ? Math.min(1.18, (gridW - headW) / colValues.length) : 0,
        rowH = 0.5,
        gy = TOP + 0.95,
        cellStyle = (value: number, current: boolean) => {
          const ok = value >= target,
            edge = !ok && value >= target - 0.0005;
          return {
            fill: ok
              ? C.green
              : edge
                ? C.greenSoft
                : current
                  ? C.greyLight
                  : C.soft,
            line: edge ? C.green : undefined,
            color: ok ? C.white : edge ? C.green : C.ink,
            bold: ok || edge || current,
          };
        };
      if (b) {
        prims.push(
          text(
            gx,
            TOP - 0.02,
            gridW,
            0.3,
            `${key.name}：${nameA} × ${nameB} → 系统可用度（其余措施按当前方案）`,
            12.5,
            { bold: true, color: C.ink },
          ),
          text(gx + headW, gy - 0.72, colW * colValues.length, 0.3, nameB, 11, {
            color: C.muted,
            align: "center",
          }),
        );
        colValues.forEach((vb, j) =>
          prims.push(
            text(
              gx + headW + j * colW,
              gy - 0.42,
              colW,
              0.36,
              effectText(b.effect, vb),
              12,
              { bold: true, color: C.ink, align: "center", valign: "middle" },
            ),
          ),
        );
        rowValues.forEach((va, i) => {
          prims.push(
            text(
              gx,
              gy + i * rowH,
              headW - 0.12,
              rowH,
              `${nameA} ${effectText(a.effect, va)}`,
              12,
              { bold: true, color: C.ink, align: "right", valign: "middle" },
            ),
          );
          colValues.forEach((vb, j) => {
            const value = at(va, vb),
              style = cellStyle(
                value,
                Math.abs(va - a.lo) < 1e-9 && Math.abs(vb - b.lo) < 1e-9,
              ),
              planned =
                Math.abs(va - planA) < 1e-9 && Math.abs(vb - planB!) < 1e-9;
            prims.push(
              rect(
                gx + headW + j * colW + 0.03,
                gy + i * rowH + 0.03,
                colW - 0.06,
                rowH - 0.06,
                style.fill,
                planned ? C.ink : style.line,
                0.04,
              ),
              text(
                gx + headW + j * colW,
                gy + i * rowH,
                colW,
                rowH,
                percent(value),
                12,
                {
                  bold: style.bold,
                  color: style.color,
                  align: "center",
                  valign: "middle",
                },
              ),
            );
          });
        });
        prims.push(
          ...legend(gx + headW, gy + rowValues.length * rowH + 0.15, [
            [C.green, "达到目标"],
            [C.greenSoft, "刚好压线"],
            [C.greyLight, "现状参数"],
          ]),
          text(
            gx + headW,
            gy + rowValues.length * rowH + 0.5,
            gridW - headW,
            0.3,
            "黑框是计划取值。",
            10.5,
            { color: C.muted },
          ),
        );
      } else {
        prims.push(
          text(
            gx,
            TOP - 0.02,
            gridW,
            0.3,
            `${key.name}：${nameA}取不同值时的系统可用度（其余措施按当前方案）`,
            12.5,
            { bold: true, color: C.ink },
          ),
          ...hbars(
            gx,
            TOP + 0.75,
            gridW,
            4,
            rowValues.map((va) => {
              const value = at(va, null);
              return {
                name: `${nameA} ${effectText(a.effect, va)}`,
                value,
                label: percent(value),
                color: value >= target ? C.green : C.orange,
              };
            }),
            {
              nameW: 2.6,
              labelW: 1.2,
              rowH: 0.6,
              max: 1,
              target,
              targetLabel: "目标 " + percent(target),
            },
          ).prims,
        );
      }
      const reachable =
          needA.kind !== "none" && (!needB || needB.kind !== "none"),
        spare = at(a.lo, b ? b.lo : null) >= target,
        stageLead = restStages
          .slice(0, 2)
          .map((s) => `${percent(s.share, 0)} 在${s.name}`)
          .join("、");
      add(
        spare
          ? `关键措施：“${key.name}”保持现状也能达标，优化它提供的是余量`
          : reachable
            ? `关键立项点：“${key.name}”` +
              (b ? `${nameB} ${effectText(b.effect, planB!)}时，` : "的") +
              needText(a, needA, nameA)
            : `关键立项点：只把“${key.name}”做到头也只到 ${percent(bestValue, 1)}，还要配合其他措施`,
        `“${key.name}”保持现状时，措施库里其余措施全部做足只到 ${percent(restCeiling)}${stageLead ? `；那时剩余故障损失的 ${stageLead}` : ""}。`,
        [
          ...prims,
          ...bullets(
            LEFT + 7.9,
            TOP + 0.1,
            WIDTH - 7.9,
            [
              {
                head: "不优化的上限：",
                text: `其余 ${restPath?.steps.length ?? 0} 项有提升的措施全部做足，系统可用度到 ${percent(restCeiling)}，${restCeiling >= target ? "已经达标，这一项是余量" : "到不了目标"}。`,
              },
              {
                head: "指标要求：",
                text: b
                  ? `${nameB}按计划（${effectText(b.effect, planB!)}）时，${needText(a, needA, nameA)}；${nameA}按计划（${effectText(a.effect, planA)}）时，${needText(b, needB!, nameB)}。`
                  : `${needText(a, needA, nameA)}。`,
              },
              {
                head: "按计划做到：",
                text: `系统可用度 ${percent(planValue)}，${planValue >= target ? `比目标高 ${((planValue - target) * 100).toFixed(2)} pp` : `距目标还差 ${((target - planValue) * 100).toFixed(2)} pp`}${key.enabled ? "" : "（这项措施目前没有启用，表里按启用它来算）"}。`,
              },
              {
                head: "怎么读这张表：",
                text: b
                  ? `每一格是${nameA}和${nameB}取这组值时的系统可用度，其余措施按当前方案。绿色是达到目标的组合；只动一个参数往往不够，要两个一起做。`
                  : `每一行是${nameA}取这个值时的系统可用度，其余措施按当前方案；越过虚线即达到目标。`,
              },
            ],
            12.5,
          ).prims,
        ],
      );
    }
  }

  // ---------- 3 现状与差距 ----------
  {
    const rows = worst.slice(0, 8).map((m) => {
      const gap = baselineGaps.find((g) => g.id === m.id)!,
        budget = (gap.budgetHours * 168) / scenario.hours;
      return {
        name: m.name,
        value: m.lossHoursPerWeek,
        mark: budget,
        label: `${hours(m.lossHoursPerWeek)}（预算 ${hours(budget)}）`,
        color: C.grey,
      };
    });
    add(
      `现状：每周损失 ${hours(before.lossHoursPerWeek)}，是目标允许值的 ${(before.lossHoursPerWeek / Math.max(168 * (1 - target), 1e-9)).toFixed(0)} 倍`,
      `每周损失 = 故障频次 × 单次等效损失 × 运行时间占比。损失最大的是 ${worst
        .slice(0, 3)
        .map((m) => m.name)
        .join("、")}；竖线是分配给各模块的预算。`,
      [
        ...kpi(
          LEFT,
          TOP,
          3.0,
          1.45,
          "故障频次（连续运行一周）",
          frequency(before.ratePerWeek),
          `MTBF ${duration(before.mtbfHours)}`,
        ),
        ...kpi(
          LEFT,
          TOP + 1.62,
          3.0,
          1.45,
          "单次等效损失",
          duration(before.mttrHours),
          "检测 + 恢复链 + 回滚重算",
        ),
        ...kpi(
          LEFT,
          TOP + 3.24,
          3.0,
          1.45,
          "现状可用度",
          percent(before.availability),
          `运行时间占 ${percent(before.runShare, 0)}`,
          C.bad,
        ),
        text(
          LEFT + 3.4,
          TOP - 0.02,
          8.7,
          0.3,
          "各模块现状每周损失（小时）与预算",
          12.5,
          { bold: true, color: C.ink },
        ),
        ...hbars(LEFT + 3.4, TOP + 0.4, 8.73, 4.3, rows, {
          nameW: 2.5,
          labelW: 2.5,
        }).prims,
      ],
    );
  }

  // ---------- 4 差距从哪边补 ----------
  {
    const multiple = (value: number) =>
      value >= 100
        ? value.toFixed(0) + "×"
        : value >= 10
          ? value.toFixed(1) + "×"
          : value.toFixed(2) + "×";
    const rows = baselineGaps
      .filter((gap) => Number.isFinite(gap.usage) && gap.usage > 1)
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 9)
      .map((gap) => {
        const reach = potential.get(gap.id) ?? {
            component: 0,
            system: 0,
            both: 0,
          },
          now = gap.usage,
          c = now * (1 - reach.component),
          s = now * (1 - reach.system),
          both = now * (1 - reach.both);
        return {
          name: gap.name,
          now,
          component: c,
          system: s,
          both,
          cut: reach,
          verdict:
            s <= 1 && c <= 1
              ? "任选一边都能达标"
              : s <= 1
                ? "缩短单次损失即可达标"
                : c <= 1
                  ? "降低频次即可达标"
                  : both <= 1
                    ? "两边都做才达标"
                    : `两边都做仍是预算的 ${multiple(both)}`,
          tone: s <= 1 || c <= 1 ? C.green : both <= 1 ? C.warn : C.bad,
        };
      });
    const systemFirst = rows.filter(
      (r) => r.cut.system >= r.cut.component,
    ).length;
    if (rows.length)
      add(
        `差距从哪边补：${systemFirst >= rows.length - systemFirst ? "主要靠缩短单次损失，降频次补其余" : "主要靠降低频次，缩短单次损失补其余"}`,
        `每个模块三根横条，从现状（竖线）向左画到“措施库里这一边全部做足”能压到的位置，进入绿色区域即回到预算以内。${rows.length} 个超预算模块里 ${systemFirst} 个主要靠缩短单次损失。`,
        [
          ...legend(LEFT, TOP - 0.1, [
            [C.blue, "只降频次（组件级措施全做）"],
            [C.orange, "只缩短单次损失（系统级措施全做）"],
            [C.green, "两边都做"],
          ]),
          ...leverChart(LEFT, TOP + 0.3, WIDTH, BOTTOM - TOP - 0.3, rows),
        ],
      );
  }

  // ---------- 5 恢复链改进前后 ----------
  {
    const designed = applyMeasures(model),
      modeLoads = baseline.modules
        .flatMap((m) => m.modes)
        .sort((a, b) => b.load - a.load),
      pick = modeLoads.find((m) => m.kind === "hard") ?? modeLoads[0],
      beforeMode = model.modes.find((m) => m.id === pick.id)!,
      afterMode = designed.modes.find((m) => m.id === pick.id)!,
      levels = [
        ...new Set([
          ...recoveryRoute(beforeMode.ladder).map((s) => s.level),
          ...recoveryRoute(afterMode.ladder).map((s) => s.level),
        ]),
      ],
      ordered = (
        ["replay", "process", "elastic", "restart", "manual"] as const
      ).filter((l) => levels.includes(l)),
      cell = (mode: typeof beforeMode, level: (typeof ordered)[number]) => {
        const step = mode.ladder[level],
          used = step.success > 0 || step.gate;
        return !used || step.success <= 0
          ? "不具备"
          : `${level === "manual" ? "兜底" : "成功率 " + percent(step.success, 0)} · ${duration(step.hours)}`;
      },
      rows: Cell[][] = [
        [
          "检测",
          `检出率 ${percent(beforeMode.coverage, 0)} · ${duration(beforeMode.detectHours)}`,
          `检出率 ${percent(afterMode.coverage, 0)} · ${duration(afterMode.detectHours)}`,
        ],
        ...ordered.map((level): Cell[] => {
          const a = cell(beforeMode, level),
            b = cell(afterMode, level);
          return [
            recoveryLevelNames[level],
            a,
            a === b
              ? { text: b, color: C.muted }
              : { text: b, bold: true, color: C.accent },
          ];
        }),
        [
          "回滚重算",
          duration(beforeMode.reworkHours),
          beforeMode.reworkHours === afterMode.reworkHours
            ? { text: duration(afterMode.reworkHours), color: C.muted }
            : {
                text: duration(afterMode.reworkHours),
                bold: true,
                color: C.accent,
              },
        ],
      ],
      stagesBefore = loadByStage(baseline),
      stagesAfter = loadByStage(design),
      names = [
        ...new Set([...stagesBefore, ...stagesAfter].map((s) => s.name)),
      ],
      colors = new Map(
        names.map(
          (name, i) => [name, stagePalette[i % stagePalette.length]] as const,
        ),
      ),
      partsOf = (stages: typeof stagesBefore) =>
        names.map((name) => ({
          name,
          share: stages.find((s) => s.name === name)?.share ?? 0,
        }));
    const bars = stageBars(
      LEFT + 6.5,
      TOP + 0.75,
      WIDTH - 6.5,
      [
        {
          name: "改进前",
          total: `单次 ${duration(before.mttrHours)}`,
          parts: partsOf(stagesBefore),
        },
        {
          name: "改进后",
          total: `单次 ${duration(after.mttrHours)}`,
          parts: partsOf(stagesAfter),
        },
      ],
      colors,
    );
    const legendRows: Prim[] = [];
    names.forEach((name, index) => {
      const col = index % 3,
        row = Math.floor(index / 3);
      legendRows.push(
        rect(
          LEFT + 6.5 + col * 1.9,
          bars.bottom + 0.2 + row * 0.32,
          0.16,
          0.16,
          colors.get(name)!,
        ),
        text(
          LEFT + 6.72 + col * 1.9,
          bars.bottom + 0.14 + row * 0.32,
          1.65,
          0.28,
          name,
          11,
          { color: C.ink2, valign: "middle" },
        ),
      );
    });
    const legendBottom = bars.bottom + 0.2 + Math.ceil(names.length / 3) * 0.32,
      topAfter = stagesAfter.slice(0, 2);
    add(
      `恢复链：单次故障损失从 ${duration(before.mttrHours)} 缩到 ${duration(after.mttrHours)}`,
      `故障沿恢复链从小到大逐级尝试：${ordered.map((l) => recoveryLevelNames[l]).join(" → ")}。左表以损失最大的“${pick.name}”为例，右图是全系统单次损失的构成。`,
      [
        text(
          LEFT,
          TOP - 0.02,
          6.1,
          0.3,
          `各环节改进前后（${clip(pick.name, 14)}）`,
          12.5,
          { bold: true, color: C.ink },
        ),
        {
          t: "table",
          x: LEFT,
          y: TOP + 0.38,
          w: 6.1,
          colW: [1.5, 2.3, 2.3],
          head: ["环节", "改进前", "改进后"],
          rows,
          size: 11.5,
        },
        text(
          LEFT + 6.5,
          TOP - 0.02,
          WIDTH - 6.5,
          0.3,
          "单次故障的损失花在哪个环节",
          12.5,
          { bold: true, color: C.ink },
        ),
        text(
          LEFT + 6.5,
          TOP + 0.34,
          WIDTH - 6.5,
          0.3,
          "按损失负荷占比；每一级不论成败都要花掉它的尝试时间",
          10.5,
          { color: C.muted },
        ),
        ...bars.prims,
        ...legendRows,
        ...bullets(
          LEFT + 6.5,
          legendBottom + 0.25,
          WIDTH - 6.5,
          [
            {
              head: "改进后的主要矛盾：",
              text:
                topAfter
                  .map((s) => `${s.name}占 ${percent(s.share, 0)}`)
                  .join("，") + "，继续提升要从这里下手。",
            },
          ],
          12.5,
        ).prims,
      ],
    );
  }

  // ---------- 6 方案总览 ----------
  {
    const column = (
      x: number,
      w: number,
      heading: string,
      goal: string,
      color: string,
      list: Measure[],
    ) => {
      const prims: Prim[] = [
          rect(x, TOP - 0.05, w, 0.62, C.soft, undefined, 0.06),
          rect(x + 0.18, TOP + 0.16, 0.2, 0.2, color, undefined, 0.02),
          text(
            x + 0.48,
            TOP - 0.05,
            w - 0.6,
            0.62,
            [
              { text: heading, bold: true, color: C.ink },
              {
                text: `  ${goal} · ${list.length} 项 · ${points(stageGain[layerOf(list[0]?.category ?? "prevent")])}`,
                color: C.ink2,
              },
            ],
            13,
            { valign: "middle" },
          ),
        ],
        sorted = [...list].sort(
          (a, b) => (sequence.get(b.id) ?? 0) - (sequence.get(a.id) ?? 0),
        ),
        shown = sorted.slice(0, 9),
        rowH = Math.min(0.5, (BOTTOM - TOP - 0.75) / Math.max(shown.length, 1));
      shown.forEach((m, index) => {
        const top = TOP + 0.7 + index * rowH;
        prims.push(
          text(
            x + 0.1,
            top,
            w - 1.45,
            rowH,
            [
              { text: clip(m.name, 15), bold: true, color: C.ink },
              { text: "  " + clip(effectSummary(model, m), 30), color: C.ink2 },
            ],
            11,
            { valign: "middle" },
          ),
          text(
            x + w - 1.3,
            top,
            1.2,
            rowH,
            points(sequence.get(m.id) ?? 0),
            11.5,
            {
              bold: true,
              color: (sequence.get(m.id) ?? 0) < -0.0005 ? C.bad : C.ink,
              align: "right",
              valign: "middle",
            },
          ),
          line(x, top + rowH, x + w, top + rowH, C.line, 0.5),
        );
      });
      if (sorted.length > shown.length)
        prims.push(
          text(
            x + 0.1,
            TOP + 0.7 + shown.length * rowH,
            w,
            0.3,
            `另有 ${sorted.length - shown.length} 项，合计 ${points(seqGain(sorted.slice(shown.length)))}`,
            10.5,
            { color: C.muted },
          ),
        );
      return prims;
    };
    const half = (WIDTH - 0.3) / 2;
    add(
      `方案：${enabled.length} 项措施，先升 MTBF，再降 MTTR`,
      `${measureLayerNames.component}让故障更少发生（提升 MTBF）；${measureLayerNames.system}让每次故障的损失更小（降低 MTTR）。右侧数字是按“先组件级、后系统级”的顺序逐项加入时，每一项带来的可用度提升，合计 ${points(totalGain)}。`,
      [
        ...column(
          LEFT,
          half,
          measureLayerNames.component,
          "降低故障频次",
          C.blue,
          component,
        ),
        ...column(
          LEFT + half + 0.3,
          half,
          measureLayerNames.system,
          "缩短单次损失",
          C.orange,
          system,
        ),
      ],
    );
  }

  // ---------- 先升 MTBF，再降 MTTR：两段各拿到多少 ----------
  if (component.length && system.length) {
    const rows = [
        {
          name: "现状",
          value: before.availability,
          color: C.grey,
          label: percent(before.availability),
        },
        {
          name: `先做${measureLayerNames.component}（${component.length} 项）`,
          value: afterComponent.availability,
          color: C.blue,
          label: `${percent(afterComponent.availability)}（${points(stageGain.component)}）`,
        },
        {
          name: `再做${measureLayerNames.system}（${system.length} 项）`,
          value: after.availability,
          color: C.orange,
          label: `${percent(after.availability)}（${points(stageGain.system)}）`,
        },
      ],
      // 组件级措施去掉的多是恢复较快的故障，剩下的故障平均单次损失可能反而变长
      mixShift = afterComponent.mttrHours > before.mttrHours * 1.05;
    add(
      `先升 MTBF 再降 MTTR：组件级 ${points(stageGain.component)}，系统级 ${points(stageGain.system)}`,
      `组件级措施把 MTBF 从 ${duration(before.mtbfHours)} 提到 ${duration(afterComponent.mtbfHours)}，可用度到 ${percent(afterComponent.availability)}；在此基础上系统级措施把单次等效损失从 ${duration(afterComponent.mttrHours)} 缩到 ${duration(after.mttrHours)}，可用度到 ${percent(after.availability)}。`,
      [
        ...hbars(LEFT, TOP + 0.6, WIDTH * 0.6, 3.0, rows, {
          nameW: 3.3,
          labelW: 2.5,
          rowH: 0.95,
          max: 1,
          target,
          targetLabel: "目标 " + percent(target),
        }).prims,
        ...kpi(
          LEFT,
          TOP + 3.55,
          2.35,
          1.3,
          "MTBF",
          fromTo(
            duration(before.mtbfHours),
            duration(afterComponent.mtbfHours),
          ),
          "组件级措施",
          C.blue,
        ),
        ...kpi(
          LEFT + 2.5,
          TOP + 3.55,
          2.35,
          1.3,
          "故障频次（每周）",
          `${frequency(before.ratePerWeek).replace(" 次/周", "")} → ${frequency(after.ratePerWeek).replace(" 次/周", "")}`,
          "连续运行一周的次数",
          C.blue,
        ),
        ...kpi(
          LEFT + 5.0,
          TOP + 3.55,
          2.35,
          1.3,
          "单次等效损失",
          fromTo(duration(afterComponent.mttrHours), duration(after.mttrHours)),
          "系统级措施",
          C.orange,
        ),
        ...bullets(
          LEFT + WIDTH * 0.64,
          TOP + 0.3,
          WIDTH * 0.36,
          [
            {
              head: `第一段 · ${measureLayerNames.component}（升 MTBF）：`,
              text: `${component.map((m) => m.name).join("、")}。每卡 FIT 从 ${Math.round(before.fitPerCard)} 降到 ${Math.round(afterComponent.fitPerCard)}，MTBF ${duration(before.mtbfHours)} → ${duration(afterComponent.mtbfHours)}，可用度 ${points(stageGain.component)}。`,
            },
            {
              head: `第二段 · ${measureLayerNames.system}（降 MTTR）：`,
              text: `检测、恢复、隔离与弹性、检查点共 ${system.length} 项，MTBF 不变，单次等效损失 ${duration(afterComponent.mttrHours)} → ${duration(after.mttrHours)}，可用度 ${points(stageGain.system)}。`,
            },
            ...(mixShift
              ? [
                  {
                    head: "为什么第一段之后单次损失变长：",
                    text: `组件级措施去掉的主要是恢复较快的中断类故障，剩下的故障里静默故障等长尾的占比变大，平均单次损失从 ${duration(before.mttrHours)} 变成 ${duration(afterComponent.mttrHours)}；每一次故障本身并没有变慢。`,
                  },
                ]
              : []),
            {
              head: "到目标还要多少：",
              text: `MTBF ${duration(afterComponent.mtbfHours)} 时，${percent(target)} 允许的单次等效损失是 ${duration(((1 - after.overhead) / target - 1) * afterComponent.mtbfHours)}；方案做到 ${duration(after.mttrHours)}。`,
            },
          ],
          12,
          0.13,
        ).prims,
      ],
    );
  }

  // ---------- 7 组合收益 ----------
  if (path.steps.length) {
    // 路径只收有提升的措施；已启用但在这组里没有提升（甚至为负）的措施接在后面，
    // 这样瀑布的终点就是方案的可用度
    const chosen = new Set(path.steps.map((s) => s.id)),
      extra: { name: string; category: Measure["category"]; gain: number }[] =
        [];
    for (const m of enabled) {
      if (chosen.has(m.id)) continue;
      const before = evaluate(chosen);
      chosen.add(m.id);
      extra.push({
        name: m.name,
        category: m.category,
        gain: evaluate(chosen) - before,
      });
    }
    const negative = extra.filter((s) => s.gain < -0.0005),
      major = path.steps
        .filter((s) => s.gain >= 0.005 || layerOf(s.category) === "component")
        .slice(0, 10),
      rest = [
        ...path.steps.filter((s) => !major.includes(s)),
        ...extra.filter((s) => !negative.includes(s)),
      ],
      restGain = rest.reduce((sum, s) => sum + s.gain, 0),
      rows: {
        name: string;
        sub: string;
        from: number;
        to: number;
        color: string;
      }[] = [];
    let level = path.base;
    const push = (name: string, sub: string, gain: number, color: string) => {
      rows.push({ name, sub, from: level, to: level + gain, color });
      level += gain;
    };
    for (const s of major) push(s.name, layerName(s), s.gain, layerColor(s));
    if (rest.length)
      push(`其余 ${rest.length} 项`, "每项不到 0.5 pp", restGain, C.grey);
    for (const s of negative)
      push(s.name, "在这组措施里是负收益", s.gain, C.bad);
    add(
      `组合收益：组件级 ${points(stageGain.component)}，系统级 ${points(stageGain.system)}，逐项叠加到 ${percent(level)}`,
      `先把组件级措施逐项加入（升 MTBF），再逐项加入系统级措施（降 MTTR）；每一段内每一步取“在已选措施基础上提升最大”的一项，已扣除措施之间的重叠。${
        negative.length
          ? `${negative.map((s) => `“${s.name}”`).join("、")}在这组措施里是负收益（合计 ${points(negative.reduce((sum, s) => sum + s.gain, 0))}）。`
          : ""
      }`,
      [
        ...legend(LEFT, TOP - 0.12, [
          [C.blue, "组件级（降频次）"],
          [C.orange, "系统级（缩短单次损失）"],
          [C.grey, "现状 / 小项合计"],
          ...(negative.length
            ? ([[C.bad, "负收益"]] as [string, string][])
            : []),
        ]),
        ...waterfall(
          LEFT,
          TOP + 0.25,
          WIDTH,
          BOTTOM - TOP - 0.45,
          path.base,
          rows,
          target,
        ),
      ],
    );
  }

  // ---------- 8 缺一不可 ----------
  if (byShare.length) {
    const shown = byShare.slice(0, 9),
      shapleyRows = shown.map((m) => ({
        name: m.name,
        value: share.get(m.id)!.shapley,
        label: points(share.get(m.id)!.shapley),
        color: layerColor(m),
      })),
      critical = [...enabled]
        .sort((a, b) => share.get(b.id)!.marginal - share.get(a.id)!.marginal)
        .slice(0, 9),
      dropRows = critical.map((m) => {
        const without = after.availability - share.get(m.id)!.marginal;
        return {
          name: m.name,
          value: without,
          label: `${percent(without)}（${points(-share.get(m.id)!.marginal)}）`,
          color: without >= target ? C.green : C.bad,
        };
      }),
      fatal = critical.filter(
        (m) => after.availability - share.get(m.id)!.marginal < target,
      ),
      half = (WIDTH - 0.4) / 2;
    add(
      met && fatal.length
        ? `哪些必须做：去掉这 ${fatal.length} 项中的任何一项都会跌破目标`
        : "各措施的贡献，以及去掉任何一项的后果",
      `左图把总提升 ${points(totalGain)} 按 Shapley 值分摊到各项措施；右图是“只去掉这一项、其余照做”系统可用度会掉到多少。`,
      [
        text(LEFT, TOP - 0.02, half, 0.3, "各措施的分摊贡献（百分点）", 12.5, {
          bold: true,
          color: C.ink,
        }),
        ...hbars(LEFT, TOP + 0.4, half, BOTTOM - TOP - 0.5, shapleyRows, {
          nameW: 2.5,
          labelW: 1.2,
        }).prims,
        text(
          LEFT + half + 0.4,
          TOP - 0.02,
          half,
          0.3,
          "去掉这一项后的系统可用度",
          12.5,
          { bold: true, color: C.ink },
        ),
        ...hbars(
          LEFT + half + 0.4,
          TOP + 0.75,
          half,
          BOTTOM - TOP - 0.85,
          dropRows,
          {
            nameW: 2.3,
            labelW: 2.25,
            // 横轴不从 0 起，才看得出各项之间的差别
            min: Math.max(
              0,
              Math.floor(
                (Math.min(...dropRows.map((r) => r.value)) - 0.04) * 20,
              ) / 20,
            ),
            max: 1,
            target,
            targetLabel: "目标 " + percent(target),
          },
        ).prims,
      ],
    );
  }

  // ---------- 9 关键指标要求 ----------
  if (byShare.length) {
    const rows: Cell[][] = byShare.slice(0, 10).map((m, index) => {
      const degree = minimum.get(m.id),
        effect = m.effects[0],
        base = baseValue(model, m, effect.param),
        floor =
          degree === null || degree === undefined
            ? "方案未达标，需全部做足"
            : degree <= 1e-6
              ? "可作为余量"
              : `兑现 ≥ ${percent(degree, 0)}` +
                (base !== null && effect.op !== "add"
                  ? `（${higherIsBetter(effect.param) ? "≥" : "≤"} ${paramText(effect.param, applyEffect(effect, base, m.applicability * degree))}）`
                  : "");
      return [
        String(index + 1),
        { text: m.name, bold: true },
        layerName(m),
        effectSummary(model, m) +
          (m.effects.length > 1 ? ` 等 ${m.effects.length} 项` : ""),
        degree !== null && degree !== undefined && degree > 0.9
          ? { text: floor, bold: true, color: C.bad }
          : floor,
        points(share.get(m.id)!.shapley),
        evidenceStateNames[m.evidence],
      ];
    });
    const tight = byShare.filter((m) => (minimum.get(m.id) ?? 0) > 0.9);
    add(
      "关键措施与指标要求：每一项要做到什么程度",
      tight.length
        ? `“最低要求”是其余各项按计划兑现时，这一项至少要兑现多少仍能达标。${tight
            .slice(0, 3)
            .map((m) => `“${m.name}”`)
            .join("、")}几乎没有打折余地，是立项后要重点保证的指标。`
        : "“最低要求”是其余各项按计划兑现时，这一项至少要兑现多少仍能达标；比例越接近 100%，越没有打折的余地。",
      [
        {
          t: "table",
          x: LEFT,
          y: TOP,
          w: WIDTH,
          colW: [0.55, 2.35, 1.45, 3.15, 2.6, 0.95, 1.08],
          head: ["#", "措施", "层级", "计划做到", "最低要求", "贡献", "证据"],
          rows,
          size: 10.5,
          align: ["center", "left", "left", "left", "left", "right", "left"],
        },
      ],
    );
  }

  // ---------- 10 验证 ----------
  {
    const stateText = { pass: "通过", warn: "待确认", fail: "未通过" } as const,
      stateColor = { pass: C.green, warn: C.warn, fail: C.bad } as const;
    add(
      verification
        ? `独立仿真验证：均值 ${percent(verification.design.mean)}，${verification.verdict === "pass" ? "全部判定通过" : verification.verdict === "warn" ? "数值达标，仍有待确认项" : "有判定未通过"}`
        : "验证：方案数值来自解析评估，独立仿真待运行",
      verification
        ? `用与解析公式相互独立的事件仿真复算：${verification.trials.toLocaleString("zh-CN")} 个窗口，随机种子 ${verification.seed}。置信区间只反映抽样误差，不含参数本身的不确定性。`
        : "第 4 步用与解析公式相互独立的事件仿真复算方案，并检查窗口波动、各模块预算和措施证据；立项前建议先运行一次。",
      verification
        ? [
            ...kpi(
              LEFT,
              TOP,
              2.85,
              1.5,
              "仿真均值",
              percent(verification.design.mean),
              `解析 ${percent(verification.analytic.design)}`,
              verification.design.mean >= target ? C.green : C.bad,
            ),
            ...kpi(
              LEFT + 3.09,
              TOP,
              2.85,
              1.5,
              "95% 置信区间",
              `${percent(verification.design.interval[0], 1)}–${percent(verification.design.interval[1], 1)}`,
              "均值的抽样误差范围",
            ),
            ...kpi(
              LEFT + 6.18,
              TOP,
              2.85,
              1.5,
              "达到目标的窗口",
              percent(verification.design.passRatio, 1),
              `要求 ≥ ${percent(scenario.passRatio, 0)}`,
              verification.design.passRatio >= scenario.passRatio
                ? C.green
                : C.bad,
            ),
            ...kpi(
              LEFT + 9.27,
              TOP,
              2.86,
              1.5,
              "现状（仿真）",
              percent(verification.baseline.mean),
              `解析 ${percent(verification.analytic.baseline)}`,
            ),
            {
              t: "table",
              x: LEFT,
              y: TOP + 1.8,
              w: WIDTH,
              colW: [2.6, 1.1, 8.43],
              head: ["判定", "结果", "说明"],
              rows: verification.checks.slice(0, 7).map((c): Cell[] => [
                { text: c.title, bold: true },
                {
                  text: stateText[c.state],
                  bold: true,
                  color: stateColor[c.state],
                },
                clip(c.detail, 86),
              ]),
              size: 10.5,
            },
          ]
        : bullets(
            LEFT,
            TOP + 0.1,
            WIDTH,
            [
              {
                head: "均值：",
                text: "仿真得到的窗口可用度均值及其置信区间是否不低于目标。",
              },
              {
                head: "窗口波动：",
                text: `达到目标的窗口比例是否不低于 ${percent(scenario.passRatio, 0)}，避免“平均达标、多数窗口不达标”。`,
              },
              {
                head: "一致性：",
                text: "仿真与解析评估的差是否在抽样误差之内，相互校核公式和实现。",
              },
              {
                head: "模块预算：",
                text: "每个模块的仿真损失是否在分配给它的预算内。",
              },
              {
                head: "证据：",
                text: "标为“设计假设”“已立项待验证”的措施参数，需要工程实测确认。",
              },
            ],
            14.5,
          ).prims,
    );
  }

  // ---------- 11 风险与下一步 ----------
  {
    const byEvidence = (state: Measure["evidence"]) =>
        enabled.filter((m) => m.evidence === state),
      assumed = byEvidence("assumed"),
      planned = byEvidence("planned"),
      verified = byEvidence("verified"),
      tight = byShare.filter((m) => (minimum.get(m.id) ?? 0) > 0.9).slice(0, 4),
      over = designGaps.filter((g) => g.status === "over" || g.usage > 1),
      held = model.measures.filter((m) => m.hold && !m.enabled),
      // 去掉后可用度反而更高的已启用措施
      harmful = enabled.filter((m) => share.get(m.id)!.marginal < -0.0005),
      risks = [
        {
          head: "参数证据：",
          text: `${enabled.length} 项措施里已有实测证据 ${verified.length} 项、已立项待验证 ${planned.length} 项、设计假设 ${assumed.length} 项${
            assumed.length
              ? `（${assumed
                  .slice(0, 3)
                  .map((m) => m.name)
                  .join("、")}${assumed.length > 3 ? " 等" : ""}）`
              : ""
          }；未实测的参数若打折，结果相应下降。`,
        },
        ...(tight.length
          ? [
              {
                head: "没有余量的指标：",
                text: `${tight.map((m) => `“${m.name}”`).join("、")}至少要兑现计划的九成以上，任何一项不到位都会低于目标。`,
              },
            ]
          : []),
        ...(over.length
          ? [
              {
                head: "仍超预算的模块：",
                text: `${over
                  .slice(0, 4)
                  .map((g) => g.name)
                  .join(
                    "、",
                  )}${over.length > 4 ? ` 等 ${over.length} 个` : ""}在方案后仍高于分配预算，系统靠其他模块的余量达标。`,
              },
            ]
          : []),
        ...(harmful.length
          ? [
              {
                head: "负收益的措施：",
                text: `${harmful.map((m) => `“${m.name}”（${points(share.get(m.id)!.marginal)}）`).join("、")}按现在的参数去掉后可用度反而更高，需要核对它的参数或作用方式。`,
              },
            ]
          : []),
        ...(held.length
          ? [
              {
                head: "暂不优化的机制：",
                text: `${held.map((m) => m.name).join("、")}保持现状，未计入方案。`,
              },
            ]
          : []),
        {
          head: "模型边界：",
          text: "解析评估是稳态均值；窗口波动、参数不确定性和共因失效需结合仿真与工程数据判断。",
        },
      ],
      next = [
        {
          head: "立项范围：",
          text: `按贡献排序落实 ${byShare
            .slice(0, 5)
            .map((m) => m.name)
            .join(
              "、",
            )}${byShare.length > 5 ? " 等" : ""}，明确各项的指标要求和责任方。`,
        },
        {
          head: "先验证关键参数：",
          text: `优先对${(tight.length ? tight : byShare.slice(0, 3)).map((m) => `“${m.name}”`).join("、")}做原型或现网实测，把“设计假设”变成“已有实测证据”。`,
        },
        {
          head: "跟踪口径：",
          text: "以周为粒度跟踪故障频次、单次等效损失和每周损失，与本方案的分模块预算逐项对照。",
        },
        {
          head: "滚动更新：",
          text: "实测数据回填 ReMAP 后重新评估与验证，按新的差距调整措施和参数。",
        },
      ],
      half = (WIDTH - 0.5) / 2;
    add(
      "风险与下一步",
      "方案的数值建立在措施参数能够兑现的前提上；立项后先把贡献最大、余量最小的几项参数用实测坐实。",
      [
        text(LEFT, TOP - 0.02, half, 0.34, "主要风险", 15, {
          bold: true,
          color: C.ink,
        }),
        line(LEFT, TOP + 0.38, LEFT + half, TOP + 0.38, C.line),
        ...bullets(LEFT, TOP + 0.55, half, risks, 12.5, 0.14).prims,
        text(LEFT + half + 0.5, TOP - 0.02, half, 0.34, "下一步", 15, {
          bold: true,
          color: C.ink,
        }),
        line(LEFT + half + 0.5, TOP + 0.38, RIGHT, TOP + 0.38, C.line),
        ...bullets(LEFT + half + 0.5, TOP + 0.55, half, next, 12.5, 0.14).prims,
      ],
    );
  }

  return {
    title,
    subtitle: `${scale(scenario.cards)} · 目标 ${percent(target)}`,
    slides,
  };
}

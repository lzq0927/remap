import { briefSize, type Brief, type Cell, type Prim } from "./brief";

const PX = 96; // 每英寸像素：13.333 英寸 = 1280 像素
const escape = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const px = (inches: number) => (inches * PX).toFixed(1) + "px";
const box = (x: number, y: number, w: number, h: number) =>
  `left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)}`;
const fontPx = (points: number) => ((points * PX) / 72).toFixed(1) + "px";

function primHtml(prim: Prim): string {
  if (prim.t === "rect")
    return `<div class="b-rect" style="${box(prim.x, prim.y, prim.w, prim.h)};${
      prim.fill ? `background:#${prim.fill};` : ""
    }${prim.line ? `border:1px solid #${prim.line};` : ""}${
      prim.radius ? `border-radius:${px(prim.radius)};` : ""
    }"></div>`;
  if (prim.t === "line") {
    const vertical = Math.abs(prim.x1 - prim.x2) < 1e-6,
      stroke = Math.max(1, (prim.width ?? 1) * (PX / 72)).toFixed(1) + "px",
      style = prim.dash ? "dashed" : "solid";
    return vertical
      ? `<div class="b-line" style="left:${px(prim.x1)};top:${px(Math.min(prim.y1, prim.y2))};height:${px(Math.abs(prim.y2 - prim.y1))};border-left:${stroke} ${style} #${prim.color};margin-left:-${(Number.parseFloat(stroke) / 2).toFixed(1)}px"></div>`
      : `<div class="b-line" style="left:${px(Math.min(prim.x1, prim.x2))};top:${px(prim.y1)};width:${px(Math.abs(prim.x2 - prim.x1))};border-top:${stroke} ${style} #${prim.color};margin-top:-${(Number.parseFloat(stroke) / 2).toFixed(1)}px"></div>`;
  }
  if (prim.t === "text") {
    const align =
        prim.valign === "middle"
          ? "center"
          : prim.valign === "bottom"
            ? "flex-end"
            : "flex-start",
      runs = prim.runs
        .map(
          (run) =>
            `<span style="${run.bold ? "font-weight:700;" : ""}${run.color ? `color:#${run.color};` : ""}">${escape(run.text)}</span>`,
        )
        .join("");
    return `<div class="b-text" style="${box(prim.x, prim.y, prim.w, prim.h)};align-items:${align};font-size:${fontPx(prim.size)};${
      prim.bold ? "font-weight:700;" : ""
    }${prim.color ? `color:#${prim.color};` : ""}"><p style="text-align:${prim.align ?? "left"}">${runs}</p></div>`;
  }
  const total = prim.colW.reduce((sum, w) => sum + w, 0),
    cell = (value: Cell, index: number) => {
      const item = typeof value === "string" ? { text: value } : value;
      return `<td style="text-align:${prim.align?.[index] ?? "left"};${item.bold ? "font-weight:700;" : ""}${item.color ? `color:#${item.color};` : ""}">${escape(item.text)}</td>`;
    };
  return `<table class="b-table" style="left:${px(prim.x)};top:${px(prim.y)};width:${px(prim.w)};font-size:${fontPx(prim.size)}"><colgroup>${prim.colW
    .map((w) => `<col style="width:${((w / total) * 100).toFixed(2)}%">`)
    .join("")}</colgroup><thead><tr>${prim.head
    .map(
      (head, index) =>
        `<th style="text-align:${prim.align?.[index] ?? "left"}">${escape(head)}</th>`,
    )
    .join("")}</tr></thead><tbody>${prim.rows
    .map((row) => `<tr>${row.map(cell).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export const briefStyles = `
.brief{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px 0;background:#eef0f3}
.b-wrap{width:calc(${briefSize.width * PX}px * var(--b-scale,1));height:calc(${briefSize.height * PX}px * var(--b-scale,1))}
.b-slide{position:relative;width:${briefSize.width * PX}px;height:${briefSize.height * PX}px;background:#fff;box-shadow:0 1px 3px rgba(16,24,40,.12);overflow:hidden;transform:scale(var(--b-scale,1));transform-origin:top left;font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Source Han Sans SC",system-ui,sans-serif;color:#101828}
.b-rect,.b-line,.b-text,.b-table{position:absolute;box-sizing:border-box}
.b-text{display:flex;line-height:1.5}
.b-text p{margin:0;width:100%}
.b-table{border-collapse:collapse;line-height:1.4}
.b-table th{padding:5px 8px;background:#f4f6f9;color:#475467;font-weight:700;border-bottom:1px solid #cdd3dc;text-align:left}
.b-table td{padding:5px 8px;border-bottom:1px solid #e4e7ec;vertical-align:middle;color:#101828}
@media print{@page{size:${briefSize.width}in ${briefSize.height}in;margin:0}.brief{gap:0;padding:0;background:#fff}.b-wrap{width:auto;height:auto;break-after:page}.b-slide{box-shadow:none;transform:none}}
`;
/** 汇报页的网页片段：每页一块 1280 × 720 的画布，随窗口宽度等比缩放。 */
export const briefBody = (brief: Brief) =>
  `<div class="brief" id="brief">${brief.slides
    .map(
      (slide, index) =>
        `<div class="b-wrap"><section class="b-slide" aria-label="第 ${index + 1} 页：${escape(slide.title)}">${slide.prims.map(primHtml).join("")}</section></div>`,
    )
    .join("")}</div>`;
export const briefScript = `<script>(function(){var r=document.getElementById("brief");function f(){r.style.setProperty("--b-scale",Math.min(1,(document.documentElement.clientWidth-32)/${briefSize.width * PX}))}f();addEventListener("resize",f)})();</script>`;

/** 可离线打开的汇报网页：与 PPT 同一份页面，可直接打印成 PDF。 */
export function briefHtml(brief: Brief, appendix = "") {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(brief.title)} · 可用度提升方案汇报</title><style>body{margin:0;background:#eef0f3}${briefStyles}</style></head><body>${briefBody(brief)}${appendix}${briefScript}</body></html>`;
}

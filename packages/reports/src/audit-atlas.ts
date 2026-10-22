import {
  auditAtlas,
  type AuditAtlas,
  type AtlasNode,
} from "../../analysis/src/audit-atlas";
import {
  atlasDomainNames,
  mechanismCapabilities,
} from "../../contracts/src/audit-atlas";
import {
  hardwareCount,
  hardwareLevels,
} from "../../contracts/src/audit-hardware";
import { faultTypeLabels } from "../../contracts/src/audit-objects";
import { mechanismStages } from "../../contracts/src/audit-extensions";
import { parameterLabels } from "./audit-labels";
import {
  supernodeSvg,
  supernodeSummaryHtml,
  supportsSupernodeDiagram,
} from "./audit-supernode";

export const atlasEscape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const atlasNumber = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "待补充"
    : Math.abs(n) > 0 && Math.abs(n) < 1e-6
      ? n.toExponential(3)
      : n.toLocaleString("zh-CN", {
          maximumFractionDigits: Math.abs(n) < 0.01 ? 6 : 3,
        });
export const atlasColors: Record<string, string> = {
  compute: "#e4f3eb",
  network: "#e7effd",
  storage: "#fff0d3",
  facility: "#e9edf1",
  control: "#efe6f8",
  other: "#f2f3f5",
  mixed: "#f6f9fb",
  overhead: "#f6e7db",
};
export type AtlasMetric =
  | "structure"
  | "summary"
  | "availability"
  | "target"
  | "loss"
  | "gap"
  | "fit"
  | "improvement";
export const atlasMetricNames = {
  structure: "纯架构",
  summary: "数量・FIT・可用度",
  availability: "分层当前可用度",
  target: "分层目标可用度",
  loss: "已建模损失 / h",
  gap: "已建模超预算 / h",
  fit: "本规模NPU等效FIT",
  improvement: "相对对照减少损失 / h",
};
export type AtlasViewOptions = {
  includeOverhead?: boolean;
  focus?: string;
  depth?: number;
  domain?: string;
  query?: string;
  faultType?: string;
  stage?: string;
  capability?: string;
  status?: string;
  metric?: AtlasMetric;
  spatial?: boolean;
  yaw?: number;
  pitch?: number;
  spacing?: number;
  links?: boolean;
  topology?: boolean;
  idPrefix?: string;
};
export function atlasVisible(atlas: AuditAtlas, o: AtlasViewOptions = {}) {
  const root =
    atlas.nodes.find((n) => n.id === o.focus) ??
    atlas.nodes.find((n) => !n.parentId)!;
  const group = atlas.nodes.filter(
    (n) =>
      root.descendants.includes(n.id) &&
      (o.includeOverhead || n.kind !== "overhead") &&
      n.depth <= root.depth + (o.depth ?? 10),
  );
  const ms = atlas.mechanisms.filter(
    (m) =>
      (!o.stage || m.stages.includes(o.stage as any)) &&
      (!o.capability || m.capabilities.includes(o.capability as any)) &&
      (!o.status || m.status === o.status),
  );
  const filterMechanisms = !!(o.stage || o.capability || o.status);
  const matching = atlas.nodes.filter(
    (n) =>
      root.descendants.includes(n.id) &&
      (!o.domain || n.domain === o.domain) &&
      (!o.query ||
        [n.name, n.id, ...n.eventIds]
          .join(" ")
          .toLowerCase()
          .includes(o.query.toLowerCase())) &&
      (!o.faultType ||
        atlas.events.some(
          (e) => n.eventIds.includes(e.id) && e.type === o.faultType,
        )) &&
      (!filterMechanisms || ms.some((m) => n.mechanismIds.includes(m.id))),
  );
  const keep = new Set(matching.flatMap((n) => n.path));
  return group.filter((n) => keep.has(n.id));
}
export function atlasValue(n: AtlasNode, metric: AtlasMetric) {
  if (metric === "structure") return null;
  if (metric === "fit") return n.npuEquivalentFit;
  if (metric === "target") return n.targetAvailability;
  if (metric === "availability") return n.attributedAvailability;
  if (metric === "summary") return n.measured?.excessHours ?? null;
  if (!n.measured || n.measured.dataStatus === "unknown") return null;
  if (metric === "loss") return n.actualHours;
  if (metric === "gap") return n.measured.excessHours;
  if (metric === "improvement") return n.improvementHours;
  return n.measured.fit;
}
const pureName = (n: AtlasNode) =>
  n.id === "hardware-board-extra"
    ? "板级补充对象"
    : n.id.startsWith("unassigned")
      ? "待归属对象"
      : n.name;
function heat(
  v: number | null,
  max: number,
  metric: AtlasMetric,
  n: AtlasNode,
) {
  if (metric === "structure") return atlasColors[n.domain];
  if (metric === "target") return "#e4edf8";
  if (v === null || n.measured?.dataStatus !== "modeled") return "#e7ebef";
  const good =
    metric === "improvement"
      ? v > 0
      : metric === "availability"
        ? n.targetAvailability !== null && v >= n.targetAvailability
        : ["gap", "summary"].includes(metric) && v <= 0;
  const target = good ? [44, 139, 114] : [209, 111, 50];
  const t = max > 0 ? Math.min(1, Math.abs(v) / max) * 0.72 : 0;
  return `rgb(${target.map((c) => Math.round(250 + (c - 250) * t)).join(",")})`;
}
type Box = { id: string; x: number; y: number; w: number; h: number };
export function atlasLayout(nodes: AtlasNode[]) {
  const boxes: Box[] = [];
  if (!nodes.length) return { boxes, width: 960, height: 240 };
  const root = nodes.find((n) => !nodes.some((p) => p.id === n.parentId))!;
  type Pack = {
    w: number;
    h: number;
    children: { node: AtlasNode; box: Pack }[];
    cols: number;
    widths: number[];
    heights: number[];
  };
  const size = (n: AtlasNode): Pack => {
    const children = nodes
      .filter((c) => c.parentId === n.id)
      .map((node) => ({ node, box: size(node) }));
    const cols = Math.min(3, Math.ceil(Math.sqrt(children.length)));
    const widths: number[] = [],
      heights: number[] = [];
    children.forEach(({ box }, i) => {
      widths[i % cols] = Math.max(widths[i % cols] ?? 0, box.w);
      heights[Math.floor(i / cols)] = Math.max(
        heights[Math.floor(i / cols)] ?? 0,
        box.h,
      );
    });
    return {
      w: Math.max(
        270,
        widths.reduce((a, b) => a + b, 0) + Math.max(0, cols - 1) * 18 + 36,
      ),
      h: children.length
        ? 94 + heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * 18
        : 108,
      children,
      cols,
      widths,
      heights,
    };
  };
  const measured = size(root);
  const place = (
    n: AtlasNode,
    b: ReturnType<typeof size>,
    x: number,
    y: number,
  ) => {
    boxes.push({ id: n.id, x, y, w: b.w, h: b.h });
    b.children.forEach(({ node, box }, i) =>
      place(
        node,
        box,
        x + 18 + b.widths.slice(0, i % b.cols).reduce((a, b) => a + b + 18, 0),
        y +
          76 +
          b.heights
            .slice(0, Math.floor(i / b.cols))
            .reduce((a, b) => a + b + 18, 0),
      ),
    );
  };
  place(root, measured, 22, 94);
  return {
    boxes,
    width: Math.max(1100, measured.w + 44),
    height: measured.h + 132,
  };
}
function spatialLayout(nodes: AtlasNode[], o: AtlasViewOptions) {
  const yaw = ((o.yaw ?? -22) * Math.PI) / 180,
    pitch = ((o.pitch ?? 38) * Math.PI) / 180;
  const groups = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
  const project = (x: number, y: number, z: number) => {
    const xx = x * Math.cos(yaw) - y * Math.sin(yaw);
    const yy = x * Math.sin(yaw) + y * Math.cos(yaw);
    return { x: xx, y: yy * Math.cos(pitch) - z * Math.sin(pitch) };
  };
  const points = groups.flatMap((depth) =>
    nodes
      .filter((n) => n.depth === depth)
      .map((n, i) => ({
        id: n.id,
        depth,
        ...project(
          (i % 3) * 330 + depth * 50,
          Math.floor(i / 3) * 175,
          depth * (o.spacing ?? 160),
        ),
      })),
  );
  const minX = points.length ? Math.min(...points.map((p) => p.x)) : 0,
    minY = points.length ? Math.min(...points.map((p) => p.y)) : 0;
  const boxes = points.map((p) => ({
    id: p.id,
    x: p.x - minX + 35,
    y: p.y - minY + 120,
    w: 270,
    h: 108,
  }));
  // Keep projected object labels legible. Projection anchors remain available as leader lines.
  const anchors = boxes.map((b) => ({ ...b }));
  const placed: Box[] = [];
  for (const b of [...boxes].sort((a, b) => a.y - b.y)) {
    let hit: Box | undefined;
    while (
      (hit = placed.find(
        (p) =>
          b.x < p.x + p.w + 14 &&
          b.x + b.w + 14 > p.x &&
          b.y < p.y + p.h + 14 &&
          b.y + b.h + 14 > p.y,
      ))
    )
      b.y = hit.y + hit.h + 14;
    placed.push(b);
  }
  return {
    boxes,
    anchors,
    width: Math.max(1100, ...boxes.map((b) => b.x + b.w + 35)),
    height: Math.max(400, ...boxes.map((b) => b.y + b.h + 35)),
  };
}
export function atlasSvg(atlas: AuditAtlas, o: AtlasViewOptions = {}) {
  if (
    o.topology &&
    supportsSupernodeDiagram(atlas) &&
    (o.depth === undefined || o.depth >= 10) &&
    (!o.focus || !atlas.nodes.find((n) => n.id === o.focus)?.parentId) &&
    !o.domain &&
    !o.faultType &&
    !o.stage &&
    !o.capability &&
    !o.status &&
    ["structure", "summary"].includes(o.metric ?? "summary")
  )
    return supernodeSvg(atlas, o);
  const nodes = atlasVisible(atlas, o),
    metric = o.metric ?? "structure";
  const layout = o.spatial ? spatialLayout(nodes, o) : atlasLayout(nodes);
  const { width, height, boxes } = layout;
  const anchorLines =
    "anchors" in layout
      ? (layout.anchors as Box[])
          .map((a) => {
            const b = boxes.find((v) => v.id === a.id)!;
            return Math.abs(a.y - b.y) > 1
              ? `<path pointer-events="none" d="M ${a.x + 8} ${a.y + 8} L ${b.x + 8} ${b.y + 8}" stroke="#b4c3cc" stroke-dasharray="3 4" fill="none"/><circle cx="${a.x + 8}" cy="${a.y + 8}" r="3" fill="#5e8295"/>`
              : "";
          })
          .join("")
      : "";
  const max = Math.max(
    0,
    ...nodes.map((n) => Math.abs(atlasValue(n, metric) ?? 0)),
  );
  const find = (id: string) => boxes.find((b) => b.id === id);
  const endpoint = (id: string) => {
    const n = atlas.nodes.find((n) => n.id === id);
    return n ? [...n.path].reverse().map(find).find(Boolean) : undefined;
  };
  const edges: {
    from: string;
    to: string;
    label: string;
    kind?: string;
    source: string;
  }[] = o.spatial
    ? nodes
        .filter((n) => n.parentId && find(n.parentId))
        .map((n) => ({
          from: n.parentId!,
          to: n.id,
          label: "包含",
          kind: "contains",
          source: n.source,
        }))
    : [];
  if (o.links !== false) edges.push(...atlas.architecture.dependencies);
  const lines = edges
    .map((e) => {
      const a = endpoint(e.from),
        b = endpoint(e.to);
      if (!a || !b || a.id === b.id) return "";
      const x = a.x + a.w,
        y = a.y + 38,
        xx = b.x,
        yy = b.y + 38;
      const col =
        e.kind === "contains"
          ? "#b0bac7"
          : e.kind === "connection"
            ? "#4778ae"
            : "#8b6bb0";
      return `<path pointer-events="none" d="M ${x} ${y} C ${x + 30} ${y}, ${xx - 30} ${yy}, ${xx} ${yy}" fill="none" stroke="${col}" stroke-width="2" ${e.kind !== "connection" ? 'stroke-dasharray="6 5"' : ""}><title>${atlasEscape(e.label + "；" + e.source)}</title></path>`;
    })
    .join("");
  const shapes = boxes
    .map((b) => {
      const n = nodes.find((n) => n.id === b.id)!;
      const v = atlasValue(n, metric);
      let qty: number | null = null;
      try {
        qty = hardwareCount(atlas.architecture, n.id, atlas.cards);
      } catch {
        /* validated by solver */
      }
      const label = `${atlasDomainNames[n.domain]}${n.hardwareLevel ? " · " + hardwareLevels[n.hardwareLevel] : ""}${qty !== null ? " · 数量 " + atlasNumber(qty) : ""}`;
      const info =
        metric === "summary"
          ? `数量 ${atlasNumber(n.quantity)} · 等效FIT ${atlasNumber(n.npuEquivalentFit)}`
          : metric === "structure"
            ? label
            : `${atlasMetricNames[metric]} ${metric === "availability" || metric === "target" ? (v === null ? "待评估" : (v * 100).toFixed(4) + "%") : atlasNumber(v)}${n.coverageStatus !== "modeled" ? " · 数据不完整" : ""}`;
      const title = pureName(n);
      const infoLines = info.match(/.{1,24}/gu) ?? [info];
      return `<g data-atlas-node="${atlasEscape(n.id)}" role="button" tabindex="0" aria-label="${atlasEscape(title)}">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="${heat(v, max, metric, n)}" stroke="#a9bdc9" stroke-width="1.5"/>
      <title>${atlasEscape(title + "；" + info + (metric === "structure" ? "" : "；" + n.source))}</title>
      <text x="${b.x + 14}" y="${b.y + 29}" font-size="16" font-weight="700" fill="#1d3946">${atlasEscape(title.slice(0, Math.max(14, Math.floor((b.w - 28) / 16))))}</text>
      <text x="${b.x + 14}" y="${b.y + 53}" font-size="11" fill="#526978">${infoLines
        .slice(0, 2)
        .map(
          (line, i) =>
            `<tspan x="${b.x + 14}" dy="${i ? 14 : 0}">${atlasEscape(line + (i === 1 && infoLines.length > 2 ? "…" : ""))}</tspan>`,
        )
        .join("")}</text>
      ${metric === "summary" ? `<text x="${b.x + 14}" y="${b.y + 88}" font-size="10" fill="#526978">可用度 ${n.attributedAvailability === null ? "待评估" : (n.attributedAvailability * 100).toFixed(4) + "%"} / 目标 ${n.targetAvailability === null ? "未分配" : (n.targetAvailability * 100).toFixed(4) + "%"}</text>` : o.spatial ? `<text x="${b.x + 14}" y="${b.y + 83}" font-size="12" fill="#526978">物理层级 ${n.depth} · ${atlasEscape(atlasDomainNames[n.domain])}</text>` : ""}
    </g>`;
    })
    .join("");
  const legend =
    metric === "structure"
      ? "容器表示包含；蓝线连接，虚线依赖 / 支撑。点击对象联动明细。"
      : `线性色阶 | ${atlasMetricNames[metric]} | 最大绝对值 ${atlasNumber(max)} | 灰：未计算 / 数据不完整；筛选仅定位，数值为完整对象账。`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${o.spatial ? "分层空间投影" : "架构全景图"}" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif">
    <rect width="100%" height="100%" fill="#f8fafc"/>
    <text x="22" y="29" font-size="19" font-weight="700" fill="#1d3946">${atlasEscape(atlas.architecture.name)} · ${atlas.cards.toLocaleString()}卡 · ${atlasEscape(atlasMetricNames[metric])}${o.spatial ? " / 分层空间投影" : ""}</text>
    <text x="22" y="57" font-size="12" fill="#526978">${atlasEscape(legend)}</text>
    ${nodes.length ? (o.spatial ? anchorLines + lines + shapes : shapes + lines) : '<text x="24" y="126" font-size="18" fill="#526978">当前筛选无匹配对象，请清除筛选。</text>'}
  </svg>`;
}
function table(heads: string[], rows: unknown[][]) {
  return `<div class="atlas-table-wrap"><table><thead><tr>${heads.map((h) => `<th>${atlasEscape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${atlasEscape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
export const atlasCss = `.atlas-report{margin:20px 0}.atlas-report h3{color:#204b59}.atlas-report .atlas-figure{max-height:700px;overflow:auto;border:1px solid #cedde5;border-radius:12px}.atlas-report svg{display:block;width:100%;height:auto;min-width:700px}.atlas-table-wrap{overflow:auto;max-width:100%}.atlas-table-wrap table{border-collapse:collapse;width:100%;min-width:650px}.atlas-table-wrap th,.atlas-table-wrap td{border-bottom:1px solid #dbe3e9;padding:10px;vertical-align:top;text-align:left}.atlas-table-wrap th{background:#edf3f7}.atlas-report details{margin:12px 0}.atlas-report pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{.atlas-report .atlas-figure{max-height:none}.atlas-report svg{min-width:0}.atlas-table-wrap{overflow:visible}}`;
export function atlasDetailHtml(atlas: AuditAtlas, nodeId: string) {
  const n = atlas.nodes.find((v) => v.id === nodeId);
  if (!n) return "";
  const es = atlas.events.filter((e) => n.eventIds.includes(e.id));
  const ms = atlas.mechanisms.filter((m) => n.mechanismIds.includes(m.id));
  return `<h3>${atlasEscape(n.name)}</h3><p>${n.path.map((id) => atlasEscape(atlas.nodes.find((v) => v.id === id)?.name)).join(" → ")}</p>
    <p>功能域：${atlasDomainNames[n.domain]}（${n.domainBasis}）；当前损失 ${atlasNumber(n.actualHours)} h；对照 ${atlasNumber(n.baselineHours)} h；减少损失 ${atlasNumber(n.improvementHours)} h（${atlasEscape(atlas.comparisonBasis)}，无对象级置信区间）。</p>
    <p>数量 ${atlasNumber(n.quantity)}；NPU等效FIT ${atlasNumber(n.npuEquivalentFit)}；区域总事件FIT ${atlasNumber(n.aggregateEventFit)}；分层目标 ${n.targetAvailability === null ? "未分配" : (n.targetAvailability * 100).toFixed(4) + "%"}；当前可用度 ${n.attributedAvailability === null ? "待评估" : (n.attributedAvailability * 100).toFixed(4) + "%"}（已建模损失责任投影）。</p>
    ${table(
      [
        "事件",
        "类型",
        "本规模等效FIT",
        "事件率 / h",
        "当前 / 对照损失 h",
        "来源",
      ],
      es.map((e) => [
        e.id,
        faultTypeLabels[e.type] ?? e.type,
        atlasNumber(e.fit),
        atlasNumber(e.rate),
        `${atlasNumber(e.actualLossHours)} / ${atlasNumber(e.baselineLossHours)}`,
        e.source,
      ]),
    )}
    <h4>机制适用范围与参数</h4>${ms
      .map(
        (
          m,
        ) => `<details><summary>${atlasEscape(m.name)} · ${m.status === "candidate" ? "未选候选" : m.status === "deployed" ? "固定部署" : "本轮已选"}</summary>
      <p>${m.stages.map((v) => mechanismStages[v]).join(" / ")}；${m.capabilities.map((v) => mechanismCapabilities[v]).join(" / ")}；${atlasEscape(m.effect)}</p>
      <p>${atlasEscape(m.applicability)}</p>
      ${table(
        ["参数", "保存值"],
        Object.entries(m.parameters).map(([k, v]) => [
          parameterLabels[k] ?? k,
          v,
        ]),
      )}
      <p>来源：${atlasEscape(m.source)}</p></details>`,
      )
      .join("")}`;
}
export function atlasReport(result: any) {
  if (!result?.events || !result?.architectureDiagnosis) return "";
  const a = auditAtlas({ result, events: result.events }, result.request.cards);
  return `<section class="atlas-report"><style>${atlasCss}</style><h3>架构—故障—机制全景</h3>
    <p>先看纯组成与连接，再按对象查阅实际事件账和机制参数。以下从本次保存结果派生，功能域不改变计算。</p>
    <div class="atlas-figure">${atlasSvg(a)}</div>
    ${a.architecture.topology ? `<h4>超节点组网与量化诊断</h4><div class="atlas-figure">${supernodeSvg(a, { metric: "summary" })}</div>${supernodeSummaryHtml(a)}` : ""}
    <details><summary>全景损失热力图与前后对照</summary><div class="atlas-figure">${atlasSvg(a, { metric: "loss" })}</div>
    ${table(
      ["功能域（叶层互斥汇总）", "已建模损失 h", "分配预算 h", "数据状态"],
      a.domains.map((d) => [
        atlasDomainNames[d.id],
        atlasNumber(d.actualHours),
        atlasNumber(d.allowedHours),
        d.incomplete ? "含待补充对象" : "已有模型",
      ]),
    )}</details>
    <details><summary>故障类型损失矩阵</summary><div class="atlas-figure">${atlasMatrixSvg(
      a,
      "fault",
      a.nodes.filter((n) => n.leaf),
      Object.entries(faultTypeLabels),
    )}</div></details>
    <details><summary>分层空间全景（标签避让投影）</summary><div class="atlas-figure">${atlasSvg(a, { spatial: true, depth: 3 })}</div></details>
    <details><summary>逐对象完整故障与可靠性机制映射（含参数和来源）</summary>${a.nodes
      .filter((n) => n.leaf)
      .map(
        (n) =>
          `<details><summary>${atlasEscape(n.name)} · ${atlasDomainNames[n.domain]}</summary>${atlasDetailHtml(a, n.id)}</details>`,
      )
      .join("")}</details>
    <details><summary>全景数据与方法追溯</summary>${a.notes.map((n) => `<p>${atlasEscape(n)}</p>`).join("")}<pre>${atlasEscape(JSON.stringify(a.provenance, null, 2))}</pre></details></section>`;
}
export function atlasStandaloneHtml(atlas: AuditAtlas) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>ReMAP 架构全景交付</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#203745;background:#f8fafc}summary{cursor:pointer}button{padding:8px 14px} ${atlasCss}</style><main class="atlas-report"><h1>架构、故障与机制全景 · ${atlas.cards.toLocaleString()}卡</h1><p>本报告包含全部对象和来源；界面筛选不裁剪完整数据。浏览器打印可保存为PDF。</p>
    <div class="atlas-figure">${atlasSvg(atlas)}</div><h2>损失与差距</h2><div class="atlas-figure">${atlasSvg(atlas, { metric: "gap" })}</div>
    ${atlas.architecture.topology ? `<h2>超节点组网与区域指标</h2><div class="atlas-figure">${supernodeSvg(atlas, { metric: "summary" })}</div>${supernodeSummaryHtml(atlas)}` : ""}
    ${`<h2>对象与故障损失矩阵</h2><div class="atlas-figure">${atlasMatrixSvg(
      atlas,
      "fault",
      atlas.nodes.filter((n) => n.leaf),
      Object.entries(faultTypeLabels),
    )}</div>`}
    ${atlas.nodes.map((n) => `<details><summary>${atlasEscape(n.name)} · ${atlasDomainNames[n.domain]}</summary>${atlasDetailHtml(atlas, n.id)}</details>`).join("")}
    <h2>计算口径</h2>${atlas.notes.map((n) => `<p>${atlasEscape(n)}</p>`).join("")}<details><summary>完整关联数据JSON</summary><pre>${atlasEscape(JSON.stringify(atlas, null, 2))}</pre></details></main></html>`;
}
export function atlasMarkdown(result: any) {
  if (!result?.architectureDiagnosis || !result.events) return "";
  const a = auditAtlas({ result, events: result.events }, result.request.cards);
  const cell = (v: unknown) =>
    atlasEscape(v)
      .replaceAll("|", "\\|")
      .replace(/[\r\n]/g, " ");
  return (
    "\n\n### 架构—故障—机制全景\n\n" +
    a.notes.join("\n\n") +
    "\n\n|对象|功能域|数量|NPU等效FIT|区域总事件FIT|分层目标可用度|当前可用度（损失责任投影）|当前损失 h|对照损失 h|减少损失 h|故障ID|适用机制ID（含候选）|\n|---|---|---|---|---|---|---|---|---|---|---|---|\n" +
    a.nodes
      .map((n) =>
        [
          n.name,
          atlasDomainNames[n.domain],
          atlasNumber(n.quantity),
          atlasNumber(n.npuEquivalentFit),
          atlasNumber(n.aggregateEventFit),
          n.targetAvailability === null
            ? "未分配"
            : (n.targetAvailability * 100).toFixed(4) + "%",
          n.attributedAvailability === null
            ? "待评估"
            : (n.attributedAvailability * 100).toFixed(4) + "%",
          atlasNumber(n.actualHours),
          atlasNumber(n.baselineHours),
          atlasNumber(n.improvementHours),
          n.eventIds.join("、"),
          n.mechanismIds.join("、"),
        ]
          .map(cell)
          .join(" | "),
      )
      .map((r) => "| " + r + " |")
      .join("\n")
  );
}

export function matrixCell(
  a: AuditAtlas,
  id: string,
  axis: string,
  key: string,
  scales: AuditAtlas[],
) {
  const n = a.nodes.find((n) => n.id === id)!;
  if (axis === "mechanism") {
    const m = a.mechanisms.find((m) => m.id === key);
    const matched = n.mechanismIds.includes(key);
    return {
      text:
        matched && m
          ? (
              {
                selected: "本轮已选",
                deployed: "固定部署",
                candidate: "未选候选",
              } as Record<string, string>
            )[m.status]
          : "—",
      value: matched ? 1 : null,
      title: matched
        ? "目录适用范围，非覆盖成功率或局部贡献"
        : "未匹配适用事件",
      state: matched ? m?.status : "empty",
    };
  }
  const value =
    axis === "scale"
      ? scales
          .find((s) => s.cards === Number(key))
          ?.nodes.find((v) => v.id === id)
      : n;
  if (!value?.measured || value.measured.dataStatus === "unknown")
    return {
      text: "待补充",
      value: null,
      title: "未计算或缺少故障数据",
      state: "unknown",
    };
  const amount =
    axis === "fault"
      ? (value.measured.types.find((t: any) => t.type === key)?.lossHours ?? 0)
      : value.actualHours;
  return {
    text: atlasNumber(amount),
    value: amount as number | null,
    title: `已建模损失 h；预算 ${atlasNumber(value.measured.allowedHours)} h；${value.measured.dataStatus === "partial" ? "含未知对象" : "已建模"}`,
    state: value.measured.dataStatus,
  };
}

export function atlasMatrixSvg(
  a: AuditAtlas,
  axis: string,
  rows: AtlasNode[],
  columns: string[][],
  scales: AuditAtlas[] = [a],
) {
  const max = Math.max(
    0,
    ...rows.flatMap((r) =>
      columns.map(([key]) =>
        Math.abs(matrixCell(a, r.id, axis, key, scales).value ?? 0),
      ),
    ),
  );
  const width = Math.max(1100, 270 + columns.length * 155),
    height = 160 + rows.length * 58;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="多维热力矩阵" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif"><rect width="100%" height="100%" fill="#f8fafc"/>
  <text x="22" y="30" font-size="20" fill="#244d5c">对象 × ${axis === "fault" ? "故障类型损失" : axis === "scale" ? "规模损失" : "机制适用关系"} · ${a.cards.toLocaleString()}卡</text>
  <text x="22" y="58" font-size="12" fill="#56717e">${axis === "mechanism" ? "绿色：已选 / 固定部署；浅蓝：未选候选；仅表示适用关系，不代表覆盖成功或局部贡献。" : `损失单位 h · 共用线性色标 0～${atlasNumber(max)} · 灰色：未计算或数据不完整 · 父子层不得重复相加`}</text>
  ${columns.map(([, name], i) => `<text x="${270 + i * 155}" y="96" font-size="11" fill="#244d5c">${atlasEscape(name.slice(0, 13))}<title>${atlasEscape(name)}</title></text>`).join("")}
  ${rows
    .map(
      (r, i) =>
        `<text x="22" y="${132 + i * 58}" font-size="13" fill="#244d5c">${atlasEscape(r.name.slice(0, 17))}</text><text x="22" y="${151 + i * 58}" font-size="11" fill="#68808f">${atlasDomainNames[r.domain]}</text>` +
        columns
          .map(([key], j) => {
            const c = matrixCell(a, r.id, axis, key, scales);
            const color =
              c.state === "unknown" || c.state === "partial"
                ? "#e5eaf0"
                : axis === "mechanism"
                  ? c.state === "selected" || c.state === "deployed"
                    ? "#c4e2d9"
                    : "#eef3fa"
                  : `rgb(247,${Math.round(247 - (max ? (90 * (c.value ?? 0)) / max : 0))},${Math.round(247 - (max ? (150 * (c.value ?? 0)) / max : 0))})`;
            return `<g><rect x="${260 + j * 155}" y="${110 + i * 58}" width="148" height="50" rx="5" fill="${color}"/><title>${atlasEscape(r.name + "；" + c.title)}</title><text x="${274 + j * 155}" y="${140 + i * 58}" font-size="13" fill="#244d5c">${atlasEscape(c.text)}</text></g>`;
          })
          .join(""),
    )
    .join("")}</svg>`;
}

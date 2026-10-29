import type {
  TopologyDecision,
  TopologyDecisionNode,
} from "../../analysis/src/audit-topology-decision";
import type { AuditArchitecture } from "../../contracts/src/audit-architecture";
import type { AuditEventView } from "../../contracts/src/audit-objects";
import { auditAtlas } from "../../analysis/src/audit-atlas";
import { ascendTopologySvg } from "./audit-ascend-diagram";
import {
  decisionDomains,
  decisionLosses,
  lossHours,
  lossFill,
  esc,
} from "./audit-decision-pages";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";
type Stage = TopologyDecision["scales"][number]["scenarios"][number];

export function domainGapDetail(stage: Stage, id: string) {
  const parent = stage.nodes.find((n) => n.id === id)!;
  const children = (node: TopologyDecisionNode): TopologyDecisionNode[] => {
    const direct = stage.nodes.filter((n) => n.parentId === node.id);
    return direct.length ? direct.flatMap(children) : [node];
  };
  const weak = children(parent)
    .filter((n) => (n.gapHours ?? 0) > 0)
    .sort((a, b) => b.gapHours! - a.gapHours!)
    .slice(0, 2);
  const path = decisionLosses
    .map((l, i) => ({ name: l.name, hours: lossHours(parent, i) }))
    .sort((a, b) => b.hours - a.hours)[0];
  return { weak, path };
}

/** Reuse the Atlas 950 reference geometry; responsibility budgets are an explicit companion panel. */
export function physicalTopology(
  stage: Stage,
  counts?: TopologyDecision["scales"][number]["counts"],
  architecture?: AuditArchitecture,
  events: AuditEventView[] = [],
) {
  const root = stage.nodes.find((n) => n.id === "system")!;
  const text = (
    x: number,
    y: number,
    value: string,
    size = 15,
    fill = "#28495e",
    bold = false,
  ) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${bold ? 650 : 400}">${esc(value)}</text>`;
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    stroke = "#c5d5df",
  ) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}"/>`;
  const duration = (v: number | null) =>
    v == null ? "—" : v >= 1 ? num(v, 2) + " h" : num(v * 60, 2) + " min";
  const atlas = architecture?.topology
    ? auditAtlas({ architecture, events }, root.quantity ?? 0)
    : null;
  // The decision snapshot includes topology-estimated inventory absent from the generic preview.
  if (atlas)
    for (const node of atlas.nodes) {
      const measured = stage.nodes.find((n) => n.id === node.id);
      if (measured?.quantity != null) node.quantity = measured.quantity;
    }
  let reference = atlas
    ? ascendTopologySvg(atlas, { metric: "structure", links: true })
    : "";
  reference = reference
    .replace(/<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(
      /data-atlas-node="([^"]+)"/g,
      'data-atlas-node="$1" data-analysis-node="$1"',
    );
  reference = reference
    .replace("计算柜展开 ·", "01 计算柜展开 ·")
    .replace("跨超节点参数面", "02 网络 · 跨超节点参数面")
    .replace("VPC / 存储面", "03 VPC / 存储面")
    .replace("基础设施支撑", "04 基础设施支撑")
    .replace("软件与业务", "05 软件与业务")
    .replaceAll("保存与检测开销", "06 保存与检测开销")
    .replace(
      "配置预览 · 当前可用度待独立计算",
      "结构参考 · 六域责任指标见右侧冻结快照",
    );
  const optics = stage.nodes.find((n) => n.id === "object-OPT");
  if (optics)
    reference = reference
      .replace(
        /(<text x="772" y="712"[^>]*>)[^<]*(<\/text>)/,
        `$1${esc(`等效FIT ${num(optics.fit, 2)} · 损失 ${num(optics.actualHours, 3)} / 预算 ${num(optics.allowedHours, 3)}h`)}$2`,
      )
      .replace(
        "2+2 光模块保护组",
        `2+2 光模块保护组 · 约${num((optics.quantity ?? 0) / 10000, 1)}万`,
      );
  let panel =
    text(1224, 35, "六层目标分配与缺口", 24, "#194b6c", true) +
    text(
      1224,
      65,
      `${stage.name} · ${num(root.quantity, 0)}卡 · A ${pct(root.availability)} → ${pct(root.target)}`,
      17,
    ) +
    text(
      1224,
      91,
      `总损失 ${num(root.actualHours, 3)} / 预算 ${num(root.allowedHours, 3)} h；与左图01–06对应`,
      15,
    );
  decisionDomains.forEach(([id, name], i) => {
    const n = stage.nodes.find((v) => v.id === id)!;
    const { weak, path } = domainGapDetail(stage, id);
    const y = 111 + i * 140,
      bad = (n.gapHours ?? 0) > 0,
      color = bad ? "#a84d36" : "#23796e";
    panel += `<g data-analysis-node="${id}" data-allocation-domain="${id}" role="button" tabindex="0" aria-label="${esc(name)}分配与差距">${rect(1210, y, 688, 130, bad ? "#fff4f0" : "#eef7f4", bad ? "#d69b87" : "#9bc6bb")}${text(1226, y + 24, `${name}   A ${pct(n.availability)} → 目标 ${pct(n.target, 3)}`, 17, color, true)}${text(1226, y + 49, `损失 ${num(n.actualHours, 3)} / 预算 ${num(n.allowedHours, 3)} h  ·  ${n.gapHours == null ? "未分配" : bad ? "超预算 " + num(n.gapHours, 3) + " h" : "余量 " + num(-n.gapHours, 3) + " h"}`, 15, color)}${text(1226, y + 73, `等效FIT ${num(n.fit, 2)} · MTBF ${duration(n.mtbfHours)} · 等效MTTR ${num(n.mttrSeconds, 2)} s`, 14)}${text(1226, y + 96, weak.length ? "缺口定位：" + weak.map((v) => `${v.name} +${num(v.gapHours, 2)}h`).join("；") : n.gapHours == null ? "此责任域尚未分配预算；不能据此判断达标" : "责任域预算内；继续验证共因与工程能力边界", 14, color)}${text(1226, y + 118, `主要损失：${path.name} ${num(path.hours, 3)}h · 本MTBF条件MTTR预算 ${num(n.targetMttrSeconds, 2)}s`, 13, "#607485")}</g>`;
  });
  panel += text(
    1224,
    974,
    "A为损失责任投影，六层损失相加；不可将六层A相乘。FIT为每NPU等效口径。",
    13,
    "#607485",
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" class="analysis-physical-svg" viewBox="0 0 1920 990" width="1920" height="990" role="img" aria-label="Atlas 950参考架构与六层目标分配" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${rect(0, 0, 1920, 990, "#fff", "none")}${reference || text(28, 65, "此快照未记录Atlas 950拓扑配置", 22)}${panel}</svg>`;
}

export function scaleWeaknessHtml(d: TopologyDecision, stageName: string) {
  return `<h4>规模变化后，薄弱点在哪里 · ${esc(stageName)}</h4><div class="analysis-table-scroll"><table class="analysis-scale-gaps" aria-label="四规模六层分配缺口"><thead><tr><th>规模 / A</th>${decisionDomains.map(([, name]) => `<th>${name}</th>`).join("")}</tr></thead><tbody>${d.scales
    .map((scale) => {
      const stage = scale.scenarios.find((s) => s.name === stageName);
      if (!stage) return "";
      const root = stage.nodes.find((n) => n.id === "system")!;
      return `<tr><th>${scale.cards / 10000}万卡<small>${pct(root.availability)}</small></th>${decisionDomains
        .map(([id]) => {
          const n = stage.nodes.find((n) => n.id === id)!,
            { weak } = domainGapDetail(stage, id),
            gap = n.gapHours;
          return `<td style="background:${gap != null && gap > 0 ? lossFill(gap, d.hours) : "#edf6f3"}"><b>${gap == null ? "未分配" : gap > 0 ? "+" + num(gap, 3) + " h" : "预算内"}</b><small>A目标 ${pct(n.target, 3)}</small><small>${weak[0] ? esc(weak[0].name) + " +" + num(weak[0].gapHours, 3) + " h" : gap == null ? "未分配预算" : "无超预算叶节点"}</small></td>`;
        })
        .join("")}</tr>`;
    })
    .join(
      "",
    )}</tbody></table></div><p class="analysis-note">格内为相对各规模冻结分配的超预算小时；第二行列出主要缺口部件。同一责任域的分配随规模证据变化，不把50万卡分配直接复用到其他规模。六层为互斥损失责任域，物理设备之间仍存在共享依赖。</p>`;
}

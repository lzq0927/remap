import type {
  TopologyDecision,
  TopologyDecisionNode,
} from "../../analysis/src/audit-topology-decision";
import { esc } from "./audit-decision-pages";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";
type Stage = TopologyDecision["scales"][number]["scenarios"][number];
/** Representative physical topology. Device counts and every metric are read from the selected snapshot. */
export function physicalTopology(
  stage: Stage,
  counts?: TopologyDecision["scales"][number]["counts"],
) {
  const n = (id: string) => stage.nodes.find((v) => v.id === id)!;
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill = "#fff",
    stroke = "#b2c7d6",
  ) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}" stroke="${stroke}"/>`;
  const t = (
    x: number,
    y: number,
    s: string,
    size = 14,
    color = "#28495e",
    bold = false,
  ) =>
    `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${bold ? 650 : 400}">${esc(s)}</text>`;
  const tm = (v: number | null) =>
    v == null ? "—" : v >= 1 ? num(v, 1) + "h" : num(v * 60, 1) + "min";
  const metric = (
    v: TopologyDecisionNode,
    x: number,
    y: number,
    w: number,
    color = "#316b9a",
  ) =>
    `<g data-analysis-node="${v.id}" role="button" tabindex="0" aria-label="${esc(v.name)}">${box(x, y, w, 86, "#fff", color)}${t(x + 12, y + 21, v.name, 15, color, true)}${t(x + 12, y + 44, `A ${pct(v.availability)} → ${pct(v.target)}`, 13)}${t(x + 12, y + 64, `损失 ${num(v.actualHours, 2)} / ${num(v.allowedHours, 2)}h`, 12, (v.gapHours ?? 0) > 0 ? "#a85a32" : "#267b6a")}${t(x + 12, y + 80, `FIT ${num(v.fit, 1)} · MTBF ${tm(v.mtbfHours)}`, 11)}</g>`;
  let s =
    box(10, 10, 1270, 610, "#f8fafb", "#9bb4c6") +
    t(
      28,
      38,
      `Atlas 950 代表性超节点 · ${num(counts?.supernodes, 0)}个超节点 / ${num(counts?.racks, 0)}个计算柜 / ${num(n("system").quantity, 0)}卡`,
      18,
      "#264f6b",
      true,
    );
  s += t(
    28,
    62,
    "实线为双向通信；虚线为共享依赖；嵌套为物理包含。数量为全规模汇总，单超节点按本快照配置展示。",
    12,
    "#60798b",
  );
  s +=
    box(28, 82, 856, 436, "#eaf2f8", "#8daec7") +
    t(
      42,
      107,
      "超节点：16计算柜；展开1柜中的1个计算框 / 8 NPU板",
      16,
      "#316b9a",
      true,
    );
  for (let i = 0; i < 16; i++)
    s +=
      box(42 + i * 33, 121, 27, 29, i === 0 ? "#8bb4d1" : "#fff", "#8daec7") +
      t(48 + i * 33, 141, String(i + 1), 11);
  s += t(
    591,
    141,
    `互联柜 ${num(counts?.interconnectRacks != null ? counts.interconnectRacks / counts.supernodes : null, 0)} / 超节点`,
    13,
    "#397e85",
    true,
  );
  s += `<g data-contains="hardware-rack">${box(42, 166, 514, 336, "#fff", "#316b9a")}${t(54, 190, "计算柜（64 NPU）", 15, "#316b9a", true)}<g data-contains="hardware-node">${box(54, 200, 490, 202, "#f2f7fb")}${t(66, 222, "计算框：主机 + 8 NPU计算板", 14)}<g data-contains="hardware-board">${box(66, 232, 314, 112, "#e6eff7")}${t(77, 254, "计算板", 13)}<g data-contains="hardware-module"><g data-contains="hardware-chip">`;
  for (let i = 0; i < 8; i++)
    s +=
      box(77 + i * 36, 268, 29, 52, "#c9ddec", "#7c9fb9") +
      t(80 + i * 36, 289, "NPU", 10) +
      t(88 + i * 36, 313, String(i + 1), 12);
  s += "</g></g></g>";
  s +=
    box(391, 232, 140, 112, "#fff", "#8daec7") +
    t(402, 254, "单NPU / 模组展开", 12, "#316b9a", true);
  ["CORE", "SRAM", "IOD", "HBM"].forEach((id, i) => {
    s += `<g role="button" tabindex="0" aria-label="${id}" data-analysis-node="object-${id}">${box(400 + (i % 2) * 63, 266 + Math.floor(i / 2) * 35, 58, 27, "#edf3f8")}${t(407 + (i % 2) * 63, 285 + Math.floor(i / 2) * 35, id, 11)}</g>`;
  });
  ["CPU", "DDR", "SSD"].forEach(
    (id, i) =>
      (s += `<g data-analysis-node="object-${id}">${box(69 + i * 155, 355, 145, 32, "#fff")}${t(100 + i * 155, 377, id === "SSD" ? "本地SSD" : id, 13)}</g>`),
  );
  s +=
    "</g>" + t(65, 426, "柜内网络设备（预算归02网络域）", 13, "#397e85", true);
  [
    ["hardware-l1", "L1交换"],
    ["hardware-io", "IO总线"],
    ["hardware-ubnic", "UB网卡"],
  ].forEach(
    ([id, label], i) =>
      (s += `<g data-analysis-node="${id}">${box(66 + i * 159, 441, 148, 39, "#e5f2ef", "#73a39e")}${t(88 + i * 159, 467, label, 14, "#397e85", true)}</g>`),
  );
  s += "</g>";
  s += `<g stroke="#397e85" stroke-width="3" fill="none"><path d="M165 344V349H60V433H137V441M306 344V349H374V433H296V441M455 387V441"/><path d="M556 459H575V322H595M575 459V454H595"/><path d="M717 322H738V234H748M717 454H738V356H748"/></g>`;
  s +=
    box(595, 282, 122, 84, "#fff2d8", "#bf923f") +
    t(609, 306, "光模块 / 光链路", 12, "#91681d", true) +
    t(607, 330, `约${num(n("object-OPT").quantity, 0)}个`, 11) +
    t(607, 350, `损失 ${num(n("object-OPT").actualHours, 2)}h`, 11);
  s +=
    box(595, 416, 122, 76, "#edf6f4", "#73a39e") +
    t(608, 440, "域间IO / UB链路", 12) +
    t(607, 465, "含光电转换与线缆", 11);
  for (let i = 0; i < 2; i++) {
    s +=
      box(748, 174 + i * 122, 121, 103, "#f6fbfa", "#397e85") +
      t(760, 198 + i * 122, `互联柜${i + 1} · L2`, 13, "#397e85", true);
    for (let j = 0; j < 8; j++)
      s +=
        box(
          760 + (j % 4) * 25,
          209 + i * 122 + Math.floor(j / 4) * 26,
          20,
          20,
          "#c5ded8",
          "#82aca2",
        ) +
        t(
          766 + (j % 4) * 25,
          223 + i * 122 + Math.floor(j / 4) * 26,
          String(j + 1),
          9,
        );
  }
  s +=
    t(744, 449, "8交换平面示意", 12, "#397e85") +
    t(744, 470, "配置以BOM为准", 11, "#60798b");
  s +=
    metric(n("domain-1"), 904, 82, 358) +
    metric(n("hardware-network"), 904, 183, 358, "#397e85");
  const c = n("domain-1"),
    net = n("hardware-network");
  s +=
    t(
      916,
      286,
      `等效MTTR / 条件预算：计算 ${num(c.mttrSeconds, 1)} / ${num(c.targetMttrSeconds, 1)}s`,
      12,
    ) +
    t(
      916,
      307,
      `网络 ${num(net.mttrSeconds, 1)} / ${num(net.targetMttrSeconds, 1)}s`,
      12,
    );
  s +=
    box(904, 330, 358, 92, "#edf6f4", "#397e85") +
    t(919, 355, "跨超节点：Leaf ⇄ Spine ⇄ 共享存储", 15, "#397e85", true) +
    t(918, 381, "光模块与交换设备独立归属；不等同独立容错域。", 12) +
    t(918, 404, "TP/PP/DP映射与共享故障需单独验证。", 12, "#60798b");
  s += `<path d="M869 356H904" stroke="#397e85" stroke-width="3"/><path d="M530 518V534H1090V422" stroke="#8f9ea8" stroke-width="2" stroke-dasharray="7 5" fill="none"/>`;
  [
    "hardware-storage",
    "hardware-facility",
    "hardware-other",
    "overhead",
  ].forEach(
    (id, i) =>
      (s += metric(
        n(id),
        28 + i * 311,
        534,
        300,
        ["#8b743c", "#75688c", "#626f82", "#9b7a25"][i],
      )),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1290 636" class="analysis-physical-svg" role="img" aria-label="设备通信连接关系" style="font-family:system-ui,'Noto Sans CJK SC',sans-serif">${s}</svg>`;
}

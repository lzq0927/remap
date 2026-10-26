import type { AuditAtlas, AtlasNode } from "../../analysis/src/audit-atlas";
import type { AtlasViewOptions } from "./audit-atlas";
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const num = (n: number | null | undefined) =>
  n == null
    ? "待补充"
    : n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (n: number | null) =>
  n === null ? "待评估" : `${(n * 100).toFixed(3)}%`;

/** Representative physical containment, separate from fault ownership and success gates. */
export function ascendTopologySvg(a: AuditAtlas, o: AtlasViewOptions) {
  const q = a.topologySummary!,
    t = a.architecture.topology!,
    pure = o.metric === "structure";
  const root = a.nodes.find((n) => !n.parentId)!;
  const lookup = (id: string) => a.nodes.find((n) => n.id === id);
  const ink = "#182c42",
    muted = "#62738a",
    green = "#0d7668",
    blue = "#4362bc";
  const text = (
    x: number,
    y: number,
    s: unknown,
    size = 13,
    fill = ink,
    weight = 400,
  ) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${esc(s)}</text>`;
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill = "#fff",
    stroke = "#d4dfea",
    r = 8,
  ) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
  const line = (d: string, color = blue, dashed = false) =>
    o.links === false
      ? ""
      : `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"${dashed ? ' stroke-dasharray="5 4"' : ""}/>`;
  const metric = (n?: AtlasNode) => {
    if (!n || pure) return "";
    if (o.metric === "fit") return `等效FIT ${num(n.npuEquivalentFit)}`;
    if (o.metric === "target") return `分层目标 ${pct(n.targetAvailability)}`;
    if (o.metric === "loss") return `损失 ${num(n.actualHours)} h`;
    if (o.metric === "gap") return `超预算 ${num(n.measured?.excessHours)} h`;
    if (o.metric === "improvement")
      return `减少损失 ${num(n.improvementHours)} h`;
    return `${o.metric === "summary" ? "等效FIT " + num(n.npuEquivalentFit) + " · A " : "可用度 "}${pct(n.attributedAvailability)}${n.coverageStatus !== "modeled" ? " *" : ""}`;
  };
  const badge = (id: string, x: number, y: number) => {
    const n = lookup(id);
    if (!n || pure) return "";
    const known = n.actualHours !== null && n.coverageStatus === "modeled";
    const bad = known && n.measured?.excessHours > 0;
    return (
      rect(x, y - 16, 218, 23, bad ? "#fff1e9" : "#f1f5f9", "none", 4) +
      text(x + 8, y, metric(n), 12, bad ? "#a34418" : muted)
    );
  };
  const group = (id: string, body: string) => {
    const n = lookup(id);
    if (!n) return body;
    const match =
      (!o.query ||
        [n.name, id, ...n.eventIds]
          .join(" ")
          .toLowerCase()
          .includes(o.query.toLowerCase())) &&
      (!o.domain || n.domain === o.domain || n.domain === "mixed");
    return `<g data-atlas-node="${esc(id)}" role="button" tabindex="0" aria-label="${esc(n.name)}" opacity="${match ? 1 : 0.25}"><title>${esc(n.name)}；全规模数量 ${num(n.quantity)}${pure ? "" : `；等效FIT ${num(n.npuEquivalentFit)}；${metric(n)}`}</title>${body}</g>`;
  };
  const equipment = (
    x: number,
    y: number,
    w: number,
    label: string,
    color = blue,
  ) =>
    rect(x, y, w, 28, "#fff", color, 4) +
    text(x + 8, y + 19, label, 12, color, 600) +
    Array.from({ length: 4 }, (_, i) =>
      rect(x + w - 30 + i * 6, y + 10, 3, 7, color, "none", 1),
    ).join("");
  const racks = [0, 1, 2, 3, 4, 5, 6, 7]
    .map((i) => {
      const x = 54 + i * 78;
      return (
        rect(x, 258, 62, 103, "#fff", "#9fbcb7", 5) +
        Array.from({ length: 6 }, (_, j) =>
          rect(x + 8, 268 + j * 12, 46, 8, "#e9f4ef", "#b9d9cd", 2),
        ).join("") +
        text(x + 8, 351, i === 7 ? "…末柜" : `柜${i + 1}`, 11, green)
      );
    })
    .join("");
  const npuCells = Array.from(
    { length: Math.min(8, t.cardsPerBoard) },
    (_, i) => {
      const x = 70 + (i % 4) * 54,
        y = 476 + Math.floor(i / 4) * 41;
      return (
        rect(x, y, 43, 29, "#e4f4ed", "#80b5a3", 5) +
        text(x + 7, y + 19, "NPU", 11, green, 600)
      );
    },
  ).join("");
  const planes = Math.min(t.planesPerSupernode ?? 0, 8),
    cabinetCount = t.interconnectRacksPerSupernode;
  const representedCabinets =
    cabinetCount && cabinetCount <= 4 ? cabinetCount : 2;
  const cabinetHeight = representedCabinets > 2 ? 140 : 272;
  const cabinets = Array.from({ length: representedCabinets }, (_, c) => {
    const x = 774 + (c % 2) * 190,
      y = 277 + Math.floor(c / 2) * 151;
    const rows = Array.from({ length: planes }, (_, i) => i).filter(
      (i) => Math.floor((i * representedCabinets) / Math.max(1, planes)) === c,
    );
    return (
      rect(x, y, 176, cabinetHeight, "#f5f7fd", "#c2cce6", 8) +
      text(x + 12, y + 25, `互联柜 ${c + 1}`, 13, blue, 650) +
      rows
        .map((i, j) => {
          const yy = y + 40 + j * (representedCabinets > 2 ? 38 : 52);
          return (
            text(x + 10, yy + 18, `P${i + 1}`, 12, blue, 600) +
            equipment(x + 36, yy, 62, "L2") +
            equipment(x + 104, yy, 62, "L2")
          );
        })
        .join("")
    );
  }).join("");
  const footerBox = (
    id: string,
    x: number,
    label: string,
    subtitle: string,
    color: string,
  ) =>
    group(
      id,
      rect(x, 774, 272, 94, "#fff", "#d9e2eb") +
        rect(x, 790, 4, 53, color, "none", 2) +
        text(x + 17, 799, label, 15, ink, 650) +
        text(x + 17, 823, subtitle, 12, muted) +
        (pure
          ? text(x + 17, 850, "点击查看组成与关联", 12, muted)
          : badge(id, x + 17, 850)),
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="982" viewBox="0 0 1200 982" role="img" aria-label="超节点组网拓扑" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif">
  <rect width="1200" height="982" rx="12" fill="#fff"/>
  ${text(28, 33, "ATLAS 950 / 架构参考", 12, blue, 700)}
  ${text(28, 66, `${num(a.cards)}卡 · ${num(lookup("hardware-supernode")?.quantity)}个超节点`, 25, ink, 700)}
  ${text(28, 91, `${q.fullSupernodes}个满超节点${q.tailCards ? ` + 尾部${q.tailCards}卡` : ""} · ${num(lookup("hardware-rack")?.quantity)}计算柜 · ${num(q.interconnectRacks)}互联柜 · 图中绘制代表性实例`, 13, muted)}
  ${text(820, 34, pure ? "结构与数量 / 点击区域查看关联" : `总体可用度 ${pct(root.attributedAvailability)}`, 13, muted)}
  ${text(820, 58, pure ? "计算  ·  超节点互联  ·  参数/存储面" : `可用度目标 ${pct(root.targetAvailability)}`, 13, muted)}
  ${group("hardware-scaleout", rect(28, 114, 750, 75, "#f4f7fc") + text(44, 140, "跨超节点参数面", 15, ink, 650) + text(44, 166, `Leaf ${num(lookup("hardware-leaf-extra")?.quantity)} / Spine ${num(lookup("hardware-spine-extra")?.quantity)} 台（全规模）`, 12, muted) + equipment(416, 128, 136, "Spine") + equipment(594, 148, 152, "Leaf") + line("M552 142H570V162H594") + text(416, 176, "上行不收敛 · 各Spine等链路数", 11, muted) + (pure ? "" : text(44, 183, metric(lookup("hardware-scaleout")), 11, muted)))}
  ${group("hardware-storage", rect(796, 114, 376, 75, "#faf7f0") + text(813, 141, "VPC / 存储面", 15, ink, 650) + text(813, 168, pure ? "双上联示意 · 数量与故障清单待校准" : metric(lookup("hardware-storage")), 12, muted))}
  ${rect(28, 207, 1144, 548, "#fafcfe", "#c6d5e2", 12)}
  ${text(46, 233, `代表性超节点 · ${t.cardsPerSupernode} NPU模组`, 16, ink, 700)}
  ${text(772, 233, `${num(t.planesPerSupernode)}平面 · L2总数 ${num(lookup("hardware-l2")?.quantity)}（全规模）`, 14, blue, 650)}
  ${group("hardware-rack", rect(44, 246, 656, 130, "#f4f9f6", "#d5e6dc") + racks + text(60, 371, `每超节点 ${t.cardsPerSupernode / t.cardsPerRack} 计算柜 × ${t.cardsPerRack} 模组；当前全规模 ${num(lookup("hardware-rack")?.quantity)} 柜`, 11, green))}
  ${group("hardware-node", rect(44, 393, 656, 337, "#fff", "#bed6ca", 9) + text(60, 418, `计算柜展开 · ${t.cardsPerRack / t.cardsPerNode} 个节点/框 × ${t.cardsPerNode} 模组（节点密度为设计输入）`, 13, green, 650))}
  ${group("hardware-board", rect(60, 436, 256, 138, "#f5faf7", "#bed6ca") + text(72, 460, `代表性计算板 · ${t.cardsPerBoard}模组/板`, 13, green, 650) + npuCells)}
  ${group("hardware-l1", rect(338, 436, 344, 89, "#f4f6fc", "#bccbe9") + text(352, 460, `L1刀片 × ${num(t.scaleUpSwitchesPerRack)}/柜`, 14, blue, 650) + equipment(354, 478, 144, "L1 / P1,P2") + equipment(516, 478, 144, "…P7,P8") + (pure ? "" : text(352, 520, metric(lookup("hardware-l1")), 11, muted)))}
  ${group("hardware-io", rect(338, 548, 344, 90, "#f4f6fc", "#bccbe9") + text(352, 572, `IO转换刀片 × ${num(t.ioBladesPerRack)}/柜`, 14, blue, 650) + equipment(354, 588, 144, "IO 1") + equipment(516, 588, 144, "IO 2") + (pure ? "" : text(352, 632, metric(lookup("hardware-io")), 11, muted)))}
  ${group("hardware-ubnic", rect(338, 653, 344, 61, "#fff", "#cdd9ea") + text(352, 677, `UB NIC × ${num(t.ubNicsPerIoBlade)}/IO`, 14, blue, 650) + text(352, 700, `全规模 ${num(lookup("hardware-ubnic")?.quantity)} 张 · 通过IO接入参数面`, 12, muted))}
  ${group("hardware-chip", rect(60, 590, 256, 124, "#eef7f2", "#bed6ca") + text(74, 615, "NPU模组内部", 14, green, 650) + ["Core", "SRAM", "IOD"].map((name, i) => rect(74 + i * 75, 628, 66, 31, "#fff", "#9dbfb0", 5) + text(84 + i * 75, 649, name, 12, green)).join("") + (pure ? text(74, 688, "含HBM等对象 · 点击继续下钻", 12, muted) : badge("hardware-chip", 74, 689)))}
  ${group("hardware-l2", rect(756, 249, 398, 323, "#fff", "#cbd6e6") + (pure ? "" : text(772, 267, metric(lookup("hardware-l2")), 11, muted)) + cabinets)}
  ${group("hardware-scaleup", rect(756, 580, 398, 67, "#eef2fb", "#c8d3ed") + text(772, 603, "L1 ↔ L2 · 超节点内互联", 14, blue, 650) + text(772, 629, pure ? `L1 ${num(lookup("hardware-l1")?.quantity)} / L2 ${num(lookup("hardware-l2")?.quantity)}（全规模）` : metric(lookup("hardware-scaleup")), 12, muted))}
  ${group("object-OPT", rect(756, 663, 398, 67, "#fff", "#cbd6e6") + text(772, 686, "2+2 光模块保护组", 14, blue, 650) + text(772, 712, pure ? `光模块总数 ${num(lookup("object-OPT")?.quantity)} · 完整BOM待补` : metric(lookup("object-OPT")), 12, muted))}
  ${line("M316 495H338", green)}${line("M682 491H727V270H756")}${line("M727 491V614H756")}
  ${line("M510 638V653")}${line("M682 681H714V178H746", blue, true)}
  ${text(706, 525, "UB", 10, blue)}
  ${footerBox("hardware-facility", 28, "基础设施支撑", "供电 · 冷却 · 管理 · 共同故障域", "#728295")}
  ${footerBox("hardware-other", 318, "软件与业务", "算子 · 任务编排 · 未归因事件", "#8f76ad")}
  ${footerBox("overhead", 608, "保存与检测开销", "与故障损失分账，避免重复计入", "#c2924d")}
  ${rect(898, 774, 274, 94, "#f5f8fc", "#d9e2eb")}${text(914, 800, "目标 → 差距 → 机制", 15, ink, 650)}${text(914, 825, "Shapley归因 → 预算分配", 12, muted)}${text(914, 849, "确认参数 → 独立复评", 12, muted)}
  ${text(28, 896, pure ? "连线：实线 UB / 示意连接，虚线 IO以太出口；不表示全互联或已验证满带宽。点击区域查看组成、数量与关联。" : "连线：实线 UB / 示意连接，虚线 IO以太出口；不表示全互联或已验证满带宽。区域点击后查看数量、FIT、目标与损失。", 12, muted)}
  ${text(28, 920, pure ? "证据差异：正文2互联柜×8台L2；图1画到4柜×4台L2。当前采用所填柜数，需按BOM确认共同故障域。" : "* 数据含待补项。区域可用度是损失责任投影；等效FIT × 实际卡数 = 区域总事件FIT，不再乘设备数量。", 12, muted)}
  ${text(28, 944, pure ? "全规模数量优先采用清单覆写；代表单元按拓扑配置绘制。模组/芯片、板/节点密度和端口清单需项目校准。" : "模组/芯片须校准；板/节点密度为工程输入。L1/L2残余事件已含保护，网络辅助模型不能再次扣减同一冗余收益。", 12, muted)}
  ${text(28, 967, a.evaluated ? `结果快照 · ${num(a.provenance.hours)} h窗口 · 主采样 ${num(a.provenance.statistics?.n ?? a.provenance.trials)} 次；置信区间见评估结论。` : "配置预览 · 当前可用度待独立计算 · 华为云指定页面及用户提供PDF（2026-10-21版）", 11, muted)}
  </svg>`;
}

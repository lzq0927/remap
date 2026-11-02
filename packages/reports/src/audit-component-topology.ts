import type { AuditAtlas } from "../../analysis/src/audit-atlas";
import type { TopologyDecision } from "../../analysis/src/audit-topology-decision";
import { esc } from "./audit-decision-pages";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";

type Stage = TopologyDecision["scales"][number]["scenarios"][number];

/** Rank disjoint leaves: a parent and its children must never compete in the same loss ranking. */
export function componentLossSources(stage: Stage) {
  const parents = new Set(stage.nodes.map((n) => n.parentId));
  return stage.nodes
    .filter(
      (n) => !parents.has(n.id) && n.id !== "overhead" && n.id !== "system",
    )
    .sort((a, b) => b.actualHours - a.actualHours || a.id.localeCompare(b.id));
}

/** Fixed absolute-hour scale shared by every cluster size and scenario. */
export function architectureLossFill(hours: number) {
  const stops = [
    [0, [241, 247, 252]],
    [10, [221, 236, 248]],
    [30, [244, 217, 223]],
    [100, [233, 150, 162]],
    [600, [223, 101, 114]],
  ] as const;
  const v = Math.max(0, Math.min(600, hours));
  const index = stops.findIndex(([h]) => h >= v);
  const [lo, a] = stops[Math.max(0, index - 1)],
    [hi, b] = stops[Math.max(0, index)];
  const t =
    hi === lo
      ? 0
      : (Math.log1p(v) - Math.log1p(lo)) / (Math.log1p(hi) - Math.log1p(lo));
  return (
    "#" +
    a
      .map((c, i) =>
        Math.round(c + (b[i] - c) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const tone = (hours: number) => ["#132738", architectureLossFill(hours)];
export const architectureLossStroke = (hours: number) =>
  hours <= 10 ? "#719cb9" : "#ad6871";
const text = (
  x: number,
  y: number,
  value: string,
  size = 14,
  fill = "#132738",
  bold = false,
) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${bold ? 650 : 400}">${esc(value)}</text>`;
const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "#fff",
  stroke = "#a2b9ca",
  radius = 5,
) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
const path = (d: string, dashed = false) =>
  `<path d="${d}" fill="none" stroke="#175b8f" stroke-width="2"${dashed ? ' stroke-dasharray="6 4"' : ""}/>`;

/** Same Atlas 950 hierarchy; every evaluated module carries its absolute loss hours. */
export function componentTopologyReference(stage: Stage, atlas: AuditAtlas) {
  const t = atlas.architecture.topology!,
    root = stage.nodes.find((n) => n.id === "system")!,
    lookup = (id: string) => stage.nodes.find((n) => n.id === id),
    ranking = componentLossSources(stage),
    rank = new Map(ranking.map((n, i) => [n.id, i + 1]));
  const hours = (id: string) => {
    const n = lookup(id);
    return n ? `${num(n.actualHours, 2)}h` : "待评估";
  };
  const fill = (id: string) =>
    lookup(id) ? architectureLossFill(lookup(id)!.actualHours) : "#f1f5f8";
  const stroke = (id: string) =>
    architectureLossStroke(lookup(id)?.actualHours ?? 0);
  const group = (id: string, content: string) => {
    const n = lookup(id);
    return `<g data-atlas-node="${esc(id)}" data-analysis-node="${esc(id)}"${n ? ` data-module-loss="${n.actualHours}"` : ""} role="button" tabindex="0" aria-label="${esc(n?.name ?? id)}"><title>${esc(n ? `${n.name}；${stage.name}损失${num(n.actualHours, 3)}h；目标损失预算${num(n.allowedHours, 3)}h；A ${pct(n.availability, 3)}；分配目标 ${pct(n.target, 3)}；全规模数量 ${num(n.quantity, 0)}` : "快照未包含此部件")}</title>${content}</g>`;
  };
  const part = (
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) =>
    group(
      id,
      rect(x, y, w, h, fill(id), stroke(id)) +
        text(
          x + 7,
          y + 21,
          label,
          id === "object-IOD" ? 10 : 13,
          "#132738",
          true,
        ) +
        text(x + 7, y + 49, hours(id), 17, "#132738", true) +
        (h >= 78
          ? text(x + 7, y + 70, `损失 TOP${rank.get(id) ?? "—"}`, 11)
          : ""),
    );
  const network = (
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) =>
    group(
      id,
      rect(x, y, w, h, fill(id), stroke(id)) +
        text(x + 12, y + 24, label, 15, "#132738", true) +
        text(x + 12, y + 49, `损失 ${hours(id)}`, 15, "#132738", true),
    );
  const header = (
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size = 14,
  ) =>
    group(
      id,
      rect(x, y, w, h, "#fff", "#9db3c2") +
        rect(x, y, w, 34, fill(id), "none", 0) +
        text(x + 12, y + 23, label, size, "#132738", true),
    );
  const racks = t.cardsPerSupernode / t.cardsPerRack;
  const cabinetCount = t.interconnectRacksPerSupernode ?? 2;
  let body =
    text(28, 34, "ATLAS 950 / 部件损失定位", 17, "#175b8f", true) +
    text(
      28,
      68,
      `${num(root.quantity, 0)}卡 · ${stage.name} · 总损失 ${num(root.actualHours, 3)}h`,
      23,
      "#153b56",
      true,
    ) +
    text(
      28,
      94,
      "数字为全规模损失；低损失浅蓝，损失越多越红。图中仅展开代表单元，父层汇总不重复相加。",
      14,
    ) +
    network("hardware-leaf-extra", "02 跨超节点 · Leaf", 28, 114, 366, 75) +
    network("hardware-spine-extra", "02 跨超节点 · Spine", 412, 114, 366, 75) +
    network(
      "hardware-storage",
      "03 共享存储 / 检查点与数据服务",
      796,
      114,
      376,
      75,
    ) +
    rect(28, 207, 1144, 548, "#f8fafc", "#9db3c2", 12) +
    text(
      46,
      234,
      `参考超节点（物理范围示意） · ${t.cardsPerSupernode}NPU · ${racks}计算柜 + ${cabinetCount}互联柜`,
      17,
      "#153b56",
      true,
    ) +
    header(
      "hardware-rack",
      `01 计算柜 · 计算责任损失 ${hours("hardware-rack")}`,
      44,
      250,
      656,
      118,
      16,
    ) +
    text(
      60,
      318,
      `每柜 ${t.cardsPerRack} NPU；全规模 ${num(lookup("hardware-rack")?.quantity, 0)}柜`,
      16,
    ) +
    text(
      60,
      350,
      `× ${racks}柜 / 超节点；下方只展开1个。柜内IO / UB / L1另归02网络预算。`,
      14,
    ) +
    header(
      "hardware-node",
      `计算节点 · 计算责任损失 ${hours("hardware-node")}`,
      44,
      388,
      656,
      359,
      15,
    ) +
    header(
      "hardware-board",
      `计算板 · 计算责任 ${hours("hardware-board")} · ${t.cardsPerBoard} NPU/板`,
      60,
      433,
      430,
      273,
      13,
    ) +
    header(
      "hardware-module",
      `NPU模组 · 计算责任 ${hours("hardware-module")}`,
      68,
      482,
      414,
      201,
      14,
    ) +
    header(
      "hardware-chip",
      `NPU芯片 · 计算责任 ${hours("hardware-chip")}`,
      76,
      523,
      296,
      126,
      12,
    ) +
    part("object-CORE", "CORE", 82, 562, 90, 78) +
    part("object-SRAM", "SRAM", 179, 562, 90, 78) +
    part("object-IOD", "IOD · 02网络", 276, 562, 90, 78) +
    part("object-HBM", "HBM", 382, 523, 92, 126) +
    path("M372 595H382") +
    group(
      "object-MODULE",
      rect(
        76,
        654,
        398,
        25,
        fill("object-MODULE"),
        stroke("object-MODULE"),
        2,
      ) +
        text(
          82,
          672,
          `模组连接 ${hours("object-MODULE")}`,
          12,
          "#132738",
          true,
        ),
    ) +
    group(
      "hardware-board-extra",
      rect(
        76,
        686,
        398,
        17,
        fill("hardware-board-extra"),
        stroke("hardware-board-extra"),
        2,
      ) +
        text(
          82,
          699,
          `板级互联 ${hours("hardware-board-extra")}`,
          10,
          "#132738",
          true,
        ),
    ) +
    network(
      "hardware-l1",
      `02 L1 · ${num(t.scaleUpSwitchesPerRack, 0)}/柜`,
      510,
      433,
      172,
      68,
    ) +
    network(
      "hardware-io",
      `02 IO · ${num(t.ioBladesPerRack, 0)}/柜`,
      510,
      546,
      172,
      68,
    ) +
    network("hardware-ubnic", "02 UB NIC", 510, 654, 172, 67) +
    path("M490 474H510") +
    path("M366 556H376V476H500V580H510") +
    path("M596 614V654") +
    ["CPU", "DDR", "SSD"]
      .map((name, i) => {
        const id = "object-" + name,
          x = 60 + i * 146;
        return group(
          id,
          rect(x, 709, 138, 29, fill(id), stroke(id)) +
            text(x + 7, 729, `${name} ${hours(id)}`, 12, "#132738", true),
        );
      })
      .join("") +
    header(
      "hardware-l2",
      `02 互联柜 / L2 · 损失 ${hours("hardware-l2")}`,
      756,
      250,
      398,
      343,
      16,
    ) +
    text(
      772,
      315,
      `${cabinetCount}互联柜 / 超节点；${num(t.planesPerSupernode ?? 0, 0)}个交换平面`,
      16,
    ) +
    text(772, 343, "损失为全规模L2汇总，不按示意柜数重复计入。", 13) +
    rect(778, 368, 354, 63, fill("hardware-l2"), stroke("hardware-l2")) +
    text(
      794,
      395,
      `L2交换集合 · ${hours("hardware-l2")}`,
      17,
      "#132738",
      true,
    ) +
    text(794, 420, "多平面互联 · 逻辑汇总展示", 13) +
    path("M862 431V466H1048V431") +
    text(778, 501, "通信路径：NPU → L1 → 光模块 → L2", 15, "#175b8f", true) +
    text(778, 536, "故障与冗余条件以模式参数为准", 14) +
    text(778, 568, "可点击L2查看模式、分配及前后损失", 14) +
    group(
      "object-OPT",
      rect(756, 626, 398, 103, fill("object-OPT"), stroke("object-OPT")) +
        text(772, 652, "02 光模块 · 2+2保护组", 16, "#132738", true) +
        text(772, 680, `损失 ${hours("object-OPT")}`, 18, "#132738", true) +
        text(
          772,
          710,
          `全规模 ${num(lookup("object-OPT")?.quantity, 0)}个；保护后残余故障不重复扣减`,
          12,
        ),
    ) +
    path("M682 467H728V676H756") +
    path("M955 626V593") +
    path("M682 687H713V189", true) +
    path("M984 189V207", true);
  for (const [id, x, title, detail] of [
    [
      "hardware-facility",
      28,
      "04 供电 / 冷却 / 管理",
      `供电${hours("object-POWER")} · 冷却${hours("object-COOL")} · 管理${hours("object-MGMT")}`,
    ],
    ["hardware-other", 414, "05 软件与其他", "含软件故障与未归因事件"],
    ["overhead", 800, "06 保存 / 检测开销", "保存阻塞单列；回滚归触发故障部件"],
  ] as const) {
    body +=
      path(`M${x + 180} 755V783`, true) +
      group(
        id,
        rect(x, 783, 372, 94, fill(id), stroke(id)) +
          text(x + 15, 808, `${title} · ${hours(id)}`, 16, "#132738", true) +
          text(x + 15, 837, detail, 13) +
          text(
            x + 15,
            863,
            `A ${pct(lookup(id)?.availability ?? null, 3)} / 目标 ${pct(lookup(id)?.target ?? null, 3)}`,
            13,
          ),
      );
  }
  body +=
    text(
      28,
      904,
      "边界表示物理包含；实线为通信/数据路径，虚线为跨域连接。IOD及柜内网络刀片归02网络；计算汇总不含IOD。",
      14,
    ) + text(28, 928, "共用损失色尺：低损失浅蓝 → 高损失红（h）", 13);
  for (let i = 0; i < 120; i++) {
    const loss = Math.expm1((i / 119) * Math.log1p(600));
    body += rect(
      28 + i * 4.5,
      939,
      4.6,
      12,
      architectureLossFill(loss),
      "none",
      0,
    );
  }
  for (const v of [0, 1, 10, 30, 100, 600])
    body += text(28 + (Math.log1p(v) / Math.log1p(600)) * 534, 972, `${v}`, 12);
  return (
    body +
    text(
      610,
      940,
      "父层为子部件汇总，不能重复相加；色深不表示超预算比例。",
      13,
    ) +
    text(610, 968, "结构为950参考；数量、端口与BOM按项目输入核对。", 13)
  );
}

/** Horizontal source bars directly below the topology, with a shared absolute-hour axis. */
export function componentLossBars(stage: Stage, compare?: Stage) {
  const ranked = componentLossSources(stage).slice(0, 10),
    max = Math.max(1, ...ranked.map((n) => n.actualHours));
  let out =
    text(28, 1033, "部件损失 TOP10 · 按所选快照损失排序", 23, "#153b56", true) +
    text(
      28,
      1061,
      `${stage.name}${compare ? ` → ${compare.name}` : ""} / h；仅列叶部件，06公共开销另计。条形拆为停机、回滚、其他损失。`,
      15,
    );
  const labels: Record<string, string> = {
    "object-HBM": "HBM / 内存路径",
    "object-UNKNOWN": "软件 / 未归因",
    "object-MODULE": "模组连接",
    "object-SSD": "本地SSD",
  };
  ranked.forEach((n, i) => {
    const x = 28 + Math.floor(i / 5) * 958,
      y = 1110 + (i % 5) * 48;
    const [color] = tone(n.actualHours),
      next = compare?.nodes.find((v) => v.id === n.id);
    let parts = "",
      at = x + 225;
    const values = [
      n.loss.downtime,
      n.loss.rollback,
      Math.max(0, n.actualHours - n.loss.downtime - n.loss.rollback),
    ];
    values.forEach((v, j) => {
      const w = (480 * v) / max;
      parts += rect(
        at,
        y - 17,
        w,
        22,
        ["#cc6e42", "#487fa9", "#438178"][j],
        "none",
        0,
      );
      at += w;
    });
    out += `<g data-analysis-node="${esc(n.id)}" data-component-rank="${i + 1}" data-component-loss="${n.actualHours}" role="button" tabindex="0">${text(x, y, `${i + 1}. ${labels[n.id] ?? n.name}`, 16, color, true)}${rect(x + 225, y - 17, 480, 22, "#edf1f4", "none", 0)}${parts}${text(x + 722, y, `${num(n.actualHours, 3)}${next ? " → " + num(next.actualHours, 3) : ""}`, 15, color, true)}</g>`;
  });
  ["停机", "回滚", "其他损失"].forEach((label, i) => {
    const x = 28 + i * 140;
    out +=
      rect(x, 1350, 15, 15, ["#cc6e42", "#487fa9", "#438178"][i], "none", 0) +
      text(x + 25, 1363, label, 14);
  });
  return (
    out +
    text(
      500,
      1363,
      "柱长为所选快照的损失；前后差值为组合减损，不能替代单项措施Shapley收益。",
      14,
    )
  );
}

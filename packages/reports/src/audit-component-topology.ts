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

const tone = (hours: number) =>
  hours >= 50
    ? ["#a51f2d", "#fff0f2"]
    : hours >= 20
      ? ["#9d3a06", "#fff2e9"]
      : ["#175b8f", "#eff5fa"];
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

/** Same Atlas 950 reference hierarchy, with loss labels inside the actual component positions. */
export function componentTopologyReference(stage: Stage, atlas: AuditAtlas) {
  const t = atlas.architecture.topology!,
    root = stage.nodes.find((n) => n.id === "system")!,
    lookup = (id: string) => stage.nodes.find((n) => n.id === id),
    ranking = componentLossSources(stage),
    rank = new Map(ranking.map((n, i) => [n.id, i + 1]));
  const value = (id: string) => lookup(id)?.actualHours;
  const hours = (id: string) =>
    value(id) == null ? "待评估" : `${num(value(id), 2)}h`;
  const group = (id: string, content: string) => {
    const n = lookup(id);
    return `<g data-atlas-node="${esc(id)}" data-analysis-node="${esc(id)}" role="button" tabindex="0" aria-label="${esc(n?.name ?? id)}"><title>${esc(n ? `${n.name}；当前损失${num(n.actualHours, 3)}h；等效FIT ${num(n.fit, 2)}；A ${pct(n.availability, 3)}；分配目标 ${pct(n.target, 3)}；全规模数量 ${num(n.quantity, 0)}` : "快照未包含此部件")}</title>${content}</g>`;
  };
  const part = (
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) => {
    const n = lookup(id),
      [color, fill] = tone(n?.actualHours ?? 0);
    return group(
      id,
      rect(x, y, w, h, fill, color) +
        text(
          x + 7,
          y + 21,
          `${rank.has(id) ? "TOP" + rank.get(id) + " " : ""}${label}`,
          12,
          color,
          true,
        ) +
        text(x + 7, y + 49, hours(id), 17, color, true) +
        (h > 78 ? text(x + 7, y + 70, `FIT ${num(n?.fit, 1)}`, 11) : ""),
    );
  };
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
      rect(x, y, w, h, "#edf4fa", "#7097b5") +
        text(x + 12, y + 24, label, 15, "#175b8f", true) +
        text(x + 12, y + 49, `损失 ${hours(id)}`, 14, "#175b8f", true),
    );
  const racks = t.cardsPerSupernode / t.cardsPerRack;
  const cabinetCount = t.interconnectRacksPerSupernode ?? 2;
  const drawnCabinets = Math.min(4, Math.max(1, cabinetCount));
  const planeCount = Math.max(0, t.planesPerSupernode ?? 0);
  const cabHeight = drawnCabinets > 2 ? 134 : 286;
  let body =
    text(28, 34, "ATLAS 950 / 部件损失定位", 17, "#175b8f", true) +
    text(
      28,
      68,
      `${num(root.quantity, 0)}卡 · ${esc(stage.name)} · 总损失 ${num(root.actualHours, 3)}h`,
      23,
      "#153b56",
      true,
    ) +
    text(
      28,
      94,
      "部件数字为全规模汇总；图中展开代表单元。红≥50h，橙20–50h，蓝<20h。",
      14,
    ) +
    group(
      "hardware-scaleout",
      rect(28, 114, 750, 75, "#eff5fa") +
        text(44, 140, "02 跨超节点参数面 · Leaf / Spine", 16, "#175b8f", true) +
        text(
          44,
          167,
          `Leaf ${num(lookup("hardware-leaf-extra")?.quantity, 0)}台 / ${hours("hardware-leaf-extra")}；Spine ${num(lookup("hardware-spine-extra")?.quantity, 0)}台 / ${hours("hardware-spine-extra")}`,
          14,
        ),
    ) +
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
      `代表性超节点 · ${t.cardsPerSupernode}NPU · ${racks}计算柜 + ${cabinetCount}互联柜`,
      17,
      "#153b56",
      true,
    ) +
    group(
      "hardware-rack",
      rect(44, 250, 656, 118, "#f0f5f8") +
        text(
          60,
          278,
          `01 计算柜：每柜 ${t.cardsPerRack} NPU；全规模 ${num(lookup("hardware-rack")?.quantity, 0)}柜`,
          15,
          "#153b56",
          true,
        ) +
        Array.from({ length: Math.min(16, racks) }, (_, i) => {
          const x = 60 + i * 39;
          return (
            rect(x, 297, 32, 42, "#e2ebf3", "#95aebe", 2) +
            text(x + 6, 322, `${i + 1}`, 13, "#175b8f")
          );
        }).join("") +
        text(
          60,
          357,
          "下方展开柜内一个节点 / 一组计算板；各部件损失不能乘绘制数量。",
          13,
        ),
    ) +
    group(
      "hardware-node",
      rect(44, 388, 656, 359, "#fff", "#8fa9bc") +
        text(
          60,
          415,
          "计算柜内：计算板 / NPU模组 / 主机侧 / 网络刀片",
          15,
          "#153b56",
          true,
        ),
    ) +
    group(
      "hardware-board",
      rect(60, 433, 430, 262, "#f8fbfc", "#95aebe") +
        text(72, 456, `计算板 · ${t.cardsPerBoard} NPU`, 13, "#153b56", true) +
        Array.from(
          { length: Math.min(8, t.cardsPerBoard) },
          (_, i) =>
            rect(
              190 + i * 35,
              442,
              28,
              23,
              i ? "#eaf1f6" : "#d5e6f3",
              "#9fb8c9",
              2,
            ) + text(199 + i * 35, 458, `${i + 1}`, 11, "#175b8f"),
        ).join(""),
    ) +
    group(
      "hardware-module",
      rect(68, 482, 414, 201, "#fff", "#7d9ab0") +
        text(80, 505, "NPU1模组：芯片 + HBM + 模组连接", 14, "#153b56", true),
    ) +
    group(
      "hardware-chip",
      rect(76, 523, 296, 126, "#f4f7fa", "#9bb1c2") +
        text(86, 542, "NPU芯片", 12, "#153b56", true),
    ) +
    part("object-CORE", "CORE", 82, 551, 90, 88) +
    part("object-SRAM", "SRAM", 179, 551, 90, 88) +
    part("object-IOD", "IOD", 276, 551, 90, 88) +
    part("object-HBM", "HBM", 382, 523, 92, 126) +
    path("M372 595H382") +
    group(
      "object-MODULE",
      text(
        80,
        671,
        `TOP${rank.get("object-MODULE") ?? "—"} 模组连接 ${hours("object-MODULE")}；板级 ${hours("hardware-board-extra")}`,
        13,
        "#175b8f",
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
    path("M366 551H376V476H500V580H510") +
    path("M596 614V654") +
    ["CPU", "DDR", "SSD"]
      .map((name, i) => {
        const id = "object-" + name,
          x = 60 + i * 146,
          [color, fill] = tone(value(id) ?? 0);
        return group(
          id,
          rect(x, 709, 138, 29, fill, color) +
            text(
              x + 7,
              729,
              `TOP${rank.get(id) ?? "—"} ${name} ${hours(id)}`,
              11,
              color,
              true,
            ),
        );
      })
      .join("") +
    group(
      "hardware-l2",
      rect(756, 250, 398, 343) +
        text(
          772,
          273,
          `02 互联柜 / L2汇总 ${hours("hardware-l2")}`,
          16,
          "#175b8f",
          true,
        ) +
        Array.from({ length: drawnCabinets }, (_, c) => {
          const x = 768 + (c % 2) * 191,
            y = 290 + Math.floor(c / 2) * 144;
          const planes = Array.from(
            { length: Math.min(8, planeCount) },
            (_, i) => i,
          ).filter(
            (i) =>
              Math.floor((i * drawnCabinets) / Math.max(1, planeCount)) === c,
          );
          return (
            rect(x, y, 183, cabHeight, "#f3f7fb") +
            text(x + 12, y + 24, `互联柜${c + 1}`, 15, "#175b8f", true) +
            planes
              .map((i, j) => {
                const yy = y + 43 + j * (drawnCabinets > 2 ? 39 : 51);
                return (
                  text(x + 8, yy + 21, `P${i + 1}`, 12, "#175b8f", true) +
                  [0, 1]
                    .map(
                      (k) =>
                        rect(x + 39 + k * 68, yy, 59, 29, "#dfeaf4") +
                        text(x + 56 + k * 68, yy + 20, "L2", 13, "#175b8f"),
                    )
                    .join("")
                );
              })
              .join("")
          );
        }).join(""),
    ) +
    group(
      "object-OPT",
      rect(756, 626, 398, 103, "#edf4fa", "#7097b5") +
        text(772, 652, "02 光模块 · 2+2保护组", 16, "#175b8f", true) +
        text(
          772,
          680,
          `损失 ${hours("object-OPT")} · 等效FIT ${num(lookup("object-OPT")?.fit, 2)}`,
          15,
          "#175b8f",
          true,
        ) +
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
    [
      "hardware-other",
      414,
      "05 软件与其他",
      `TOP${rank.get("object-UNKNOWN") ?? "—"} 软件/未归因 ${hours("object-UNKNOWN")}`,
    ],
    [
      "overhead",
      800,
      "06 保存 / 检测开销",
      `保存检测 ${hours("overhead")}；回滚归入触发故障部件`,
    ],
  ] as const) {
    body +=
      path(`M${x + 180} 755V783`, true) +
      group(
        id,
        rect(x, 783, 372, 94, "#f1f6fa") +
          text(x + 15, 810, title, 17, "#153b56", true) +
          text(x + 15, 839, detail, 13, "#175b8f", true) +
          text(
            x + 15,
            863,
            `A ${pct(lookup(id)?.availability ?? null, 3)} / 目标 ${pct(lookup(id)?.target ?? null, 3)}`,
            13,
          ),
      );
  }
  return (
    body +
    text(
      28,
      909,
      "边界表示物理包含；实线通信/数据路径，虚线跨域连接。IO/UB/L1在计算柜内，预算归02网络。",
      14,
    ) +
    text(
      28,
      938,
      "FIT为每NPU等效事件率，已含规模与拓扑分担；各器件A、目标和完整模式可点击查看。",
      14,
    ) +
    text(
      28,
      967,
      "父层损失包含子部件，不可重复累加。结构为950参考；节点密度、柜数、端口及BOM仍按项目输入核对。",
      13,
    )
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

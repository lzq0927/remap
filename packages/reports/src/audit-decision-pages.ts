import { reliabilityEvidence } from "./audit-research";
import {
  topologyDecision,
  type TopologyDecision,
  type TopologyDecisionNode,
} from "../../analysis/src/audit-topology-decision";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";

export const decisionDomains = [
  ["domain-1", "01 计算资源", "#316b9a"],
  ["hardware-network", "02 网络互联", "#397e85"],
  ["hardware-storage", "03 共享存储", "#8b743c"],
  ["hardware-facility", "04 供电冷却管理", "#75688c"],
  ["hardware-other", "05 软件与其他", "#626f82"],
  ["overhead", "06 保存检测开销", "#9b7a25"],
] as const;
export const decisionLosses = [
  { name: "停机", keys: ["downtime"], mechanisms: "M3·M4·M8" },
  { name: "回滚", keys: ["rollback"], mechanisms: "M4·M5·M6" },
  { name: "降速", keys: ["slowdown", "localLoss"], mechanisms: "M2·M7" },
  { name: "污染", keys: ["terminalInvalid"], mechanisms: "M6" },
  { name: "保存", keys: ["save"], mechanisms: "M5" },
  { name: "检测", keys: ["mechanismOverhead"], mechanisms: "M3·M6·M7" },
] as const;
export const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const text = (
  x: number,
  y: number,
  v: unknown,
  size = 16,
  fill = "#233c51",
  weight = 400,
) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${esc(v)}</text>`;
const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "#fff",
  stroke = "#d7e1e7",
  r = 8,
) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" rx="${r}"/>`;
type Stage = TopologyDecision["scales"][number]["scenarios"][number];
const node = (s: Stage, id: string) => s.nodes.find((n) => n.id === id);
const time = (h: number | null | undefined) =>
  h == null ? "—" : h >= 1 ? num(h, 1) + "h" : num(h * 60, 1) + "min";
const gap = (n: TopologyDecisionNode) =>
  n.gapHours == null
    ? "未分配"
    : `${n.gapHours > 0 ? "超预算" : "余量"} ${num(Math.abs(n.gapHours), 2)}h`;
const gapColor = (n: TopologyDecisionNode) =>
  n.gapHours == null ? "#677887" : n.gapHours > 0 ? "#a45131" : "#257466";
const stageName = (s: Stage) =>
  s.trainingScenario?.id === "current"
    ? "现状"
    : s.trainingScenario?.id === "extension"
      ? "延长线"
      : s.trainingScenario?.id === "breakthrough"
        ? "突破"
        : s.name;
const stageColors = ["#316b9a", "#a07c27", "#277c70"];
export function lossHours(n: TopologyDecisionNode, index: number) {
  return decisionLosses[index].keys.reduce((sum, k) => sum + n.loss[k], 0);
}
/** Fixed shared yellow scale, anchored at one minute and the complete assessment window. */
export function lossFill(hours: number, window: number) {
  const t = Math.max(
    0,
    Math.min(1, Math.log1p(hours * 60) / Math.log1p(window * 60)),
  );
  const a = [255, 253, 235],
    b = [189, 132, 21];
  return (
    "#" +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function frame(title: string, subtitle: string, body: string, height = 1080) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="${height}" viewBox="0 0 1800 ${height}" role="img" aria-label="${esc(title)}" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${rect(0, 0, 1800, height, "#f4f7f9", "none", 0)}${rect(0, 0, 1800, 102, "#17384d", "none", 0)}${text(30, 43, title, 28, "#fff", 700)}${text(30, 78, subtitle, 16, "#d5e3ec")}${body}</svg>`;
}
function metricCard(
  stages: Stage[],
  id: string,
  label: string,
  color: string,
  x: number,
  y: number,
  w: number,
  h = 188,
) {
  const first = node(stages[0], id);
  if (!first) return "";
  let out =
    `<g data-decision-node="${esc(id)}" data-atlas-node="${esc(id)}" tabindex="0" role="button" aria-label="${esc(label)}">` +
    rect(x, y, w, h, "#fff", color) +
    rect(x, y, 5, h, color, "none", 0) +
    text(x + 16, y + 29, label, 20, color, 700);
  out += text(
    x + 16,
    y + 54,
    `分配目标 A ${pct(first.target)} · 损失预算 ${num(first.allowedHours)}h`,
    14,
  );
  out +=
    text(x + 16, y + 78, "阶段", 12, "#60798b") +
    text(x + 78, y + 78, "可用度", 12, "#60798b") +
    text(x + 175, y + 78, "MTBF / 条件需", 12, "#60798b") +
    text(x + 305, y + 78, "MTTR / 预算", 12, "#60798b");
  stages.forEach((s, i) => {
    const n = node(s, id);
    if (!n) return;
    const yy = y + 102 + i * 24;
    out +=
      text(x + 16, yy, stageName(s), 14, stageColors[i], 600) +
      text(x + 78, yy, pct(n.availability), 14) +
      text(
        x + 175,
        yy,
        `${time(n.mtbfHours)} / ${time(n.target != null && n.target < 1 && n.mttrSeconds != null ? ((n.mttrSeconds / 3600) * n.target) / (1 - n.target) : null)}`,
        12,
      ) +
      text(
        x + 305,
        yy,
        `${num(n.mttrSeconds, 1)} / ${num(n.targetMttrSeconds, 1)}s`,
        12,
      );
  });
  const last = node(stages.at(-1)!, id)!;
  out += text(
    x + 16,
    y + h - 13,
    `${stageName(stages.at(-1)!)} ${gap(last)} · 损失 ${Math.abs(last.actualHours) < 1e-9 ? "≈0" : num(last.actualHours)}h`,
    14,
    gapColor(last),
    600,
  );
  out += `<title>${esc(first.name)}；MTBF为本模块中断范围，等效MTTR含所有损失。目标MTTR为条件预算；MTBF条件需为保持当前等效MTTR的单侧预算；不与MTTR预算同时强制。正贡献投影 ${num(first.gain * 100)}pp。</title></g>`;
  return out;
}
function overview(d: TopologyDecision, cards: number) {
  const scale = d.scales.find((s) => s.cards === cards) ?? d.scales[0],
    stages = scale.scenarios.slice(0, 3);
  let b = "";
  stages.forEach((s, i) => {
    const n = node(s, "system")!,
      x = 30 + i * 585;
    b +=
      rect(x, 120, 570, 113) +
      rect(x, 120, 570, 4, stageColors[i], "none", 0) +
      text(x + 16, 152, s.name, 20, stageColors[i], 650) +
      text(x + 16, 194, pct(n.availability), 32, stageColors[i], 700) +
      text(
        x + 195,
        182,
        `MTBF ${time(n.mtbfHours)} · 等效MTTR ${num(n.mttrSeconds, 1)}s`,
        16,
      ) +
      text(
        x + 195,
        210,
        `目标 ${pct(scale.target)} · ${gap(n)}`,
        15,
        gapColor(n),
      ) +
      text(
        x + 195,
        229,
        `条件MTTR预算 ${num(n.targetMttrSeconds, 1)}s（保持当前MTBF）`,
        12,
      );
  });
  b +=
    rect(30, 254, 1008, 520, "#eaf1f7", "#b8cddd") +
    text(50, 285, "物理连接与关键部件 · 代表性超节点", 22, "#316b9a", 650);
  b += text(
    50,
    310,
    `${num(scale.counts.supernodes, 0)}超节点 / ${num(scale.counts.racks, 0)}计算柜 / ${num(cards, 0)}卡；图形为示意，数量以快照为准`,
    14,
  );
  // Physical links are behind the devices, use orthogonal paths and independent planes.
  b += `<g fill="none" stroke="#397e85" stroke-width="4"><path d="M185 481V538H810V481"/><path d="M445 538V576M810 538V576M810 632V675H445V632"/><path d="M445 675H185V715"/></g>`;
  for (let i = 0; i < 16; i++) {
    const x = 52 + i * 59;
    b +=
      rect(x, 331, 49, 52, "#fff", "#8baec5", 4) +
      text(x + 9, 361, String(i + 1).padStart(2, "0"), 15);
  }
  b += text(53, 402, "16计算柜示意 · 展开一个计算框", 14, "#316b9a");
  b +=
    rect(52, 416, 256, 90, "#fff", "#316b9a") +
    text(65, 438, "8 NPU（缩小显示）", 14, "#316b9a", 600);
  for (let i = 0; i < 8; i++)
    b +=
      rect(65 + i * 29, 449, 23, 33, "#d6e5f1", "#7a9bb8", 3) +
      text(71 + i * 29, 470, i + 1, 11);
  const chips: [string, string[]][] = [
    ["CORE / SRAM / IOD", ["object-CORE", "object-SRAM", "object-IOD"]],
    ["HBM / 模组连接", ["object-HBM", "object-MODULE"]],
    ["CPU / DDR / 本地SSD", ["object-CPU", "object-DDR", "object-SSD"]],
  ];
  chips.forEach(([label, ids], i) => {
    const x = 326 + i * 230,
      parts = ids.map((id) => node(stages[0], id)!),
      n = {
        actualHours: parts.reduce((v, n) => v + n.actualHours, 0),
        mtbfHours:
          parts.reduce((v, n) => v + n.hardFit, 0) > 0
            ? 1e9 / cards / parts.reduce((v, n) => v + n.hardFit, 0)
            : null,
      };
    b +=
      `<g><title>${esc(label)}：所列部件损失及中断FIT合计</title>` +
      rect(x, 416, 215, 90, "#fff", "#8baec5") +
      text(x + 12, 443, label, 15, "#316b9a", 600) +
      text(x + 12, 470, `现状损失 ${num(n.actualHours)}h`, 14) +
      text(x + 12, 491, `MTBF ${time(n.mtbfHours)}`, 13) +
      "</g>";
  });
  [
    ["L1 → L2 多平面互联", 330],
    ["IO / UB → Leaf / Spine", 695],
  ].forEach(([label, x]) => {
    b +=
      rect(Number(x), 576, 300, 56, "#e0eeec", "#397e85") +
      text(Number(x) + 14, 610, label, 17, "#397e85", 600);
  });
  b += text(
    340,
    655,
    `互联柜 ${num(scale.counts.interconnectRacks == null ? null : scale.counts.interconnectRacks / scale.counts.supernodes, 0)}个/超节点 · L2 ${num(scale.counts.l2Devices == null ? null : scale.counts.l2Devices / scale.counts.supernodes, 0)}台（本快照配置）`,
    14,
    "#397e85",
  );
  const opt = node(stages[0], "object-OPT")!;
  b +=
    `<g data-decision-node="object-OPT">` +
    rect(330, 684, 665, 66, "#fff1d6", "#ad7e2b") +
    text(
      347,
      708,
      "光模块 / 光链路 · M2 冗余、链路遥测、降lane与隔离",
      18,
      "#91661d",
      650,
    ) +
    text(
      347,
      733,
      `现状损失 ${num(opt.actualHours)}h · 中断MTBF ${time(opt.mtbfHours)} · 数量 ${num(opt.quantity, 0)}（含估算，见明细）`,
      14,
    ) +
    "</g>";
  b += text(55, 735, "共享存储 / 检查点", 17, "#8b743c", 650);
  b += text(
    55,
    760,
    "供电、冷却、管理是跨模块共同依赖；连线表达连接关系，不代表独立串并联。",
    14,
    "#617684",
  );
  decisionDomains.slice(0, 2).forEach(([id, label, color], i) => {
    b += metricCard(stages, id, label, color, 1060, 254 + i * 226, 710, 210);
  });
  b +=
    rect(1060, 714, 710, 60, "#fff7e4", "#d0b569") +
    text(
      1076,
      739,
      "MTBF：本图各模块分别统计中断事件范围",
      16,
      "#866820",
      600,
    ) +
    text(1076, 761, "MTBF条件需：固定本轮MTTR反推；与MTTR预算择一诊断。", 14);
  decisionDomains.slice(2).forEach(([id, label, color], i) => {
    b += metricCard(stages, id, label, color, 30 + i * 440, 797, 420, 196);
  });
  b += text(
    30,
    1021,
    "A 为损失责任折算可用度；父子项不可相加。等效MTTR含停机、回滚、降速、污染和开销；目标秒数不写入仿真。",
    15,
  );
  b += text(
    30,
    1051,
    "查看“跨规模薄弱点”按超预算小时比较；查看“损失—措施”追踪每层损失及具体参数。点击模块查看数值。",
    15,
    "#5e7483",
  );
  return frame(
    "架构与指标差距",
    `${num(cards, 0)}卡 · ${d.hours}小时 · ${d.allocationLabel} · 同一现状预算用于各阶段比较`,
    b,
  );
}
const mechanismRows = [
  [
    "M1",
    "MTBF · 筛查 / ECC / 预防维护",
    "01·03·04",
    "FIT与暴露分项；收益需证据",
  ],
  [
    "M2",
    "MTBF · 跨柜多路径 / 存储冗余",
    "02·03·04",
    "BDD+MC验证容量、光链路和共因",
  ],
  ["M3", "MTTR · 中断检测 / 心跳 / 定位", "01–05", "D-HARD"],
  ["M4", "MTTR · 温备 / 局部重启 / 自动恢复", "01–05", "recovery"],
  ["M5", "开销 / 回滚 · 异步分级检查点", "01–06", "C-FAST"],
  ["M6", "MTTR · 静默检测 / 校验与回退", "01–05", "D-SDC"],
  ["M7", "MTTR · 亚健康定位 / 隔离慢节点", "01–05", "D-SLOW"],
  ["M8", "MTTR · 失败升级 / 人工兜底", "01–05", "manual"],
];
function parameter(s: Stage, id: string) {
  const c = s.configuration,
    p = c?.policy,
    m = c?.model;
  if (id === "D-HARD" || id === "D-SDC" || id === "D-SLOW")
    return `${pct(p?.[id]?.coverage)} / ${num(p?.[id]?.detectSeconds)}s`;
  if (id === "C-FAST")
    return `${num(p?.[id]?.computeSeconds)} / ${num(p?.[id]?.saveSeconds)}s`;
  if (id === "recovery")
    return `${pct(m?.recoverySuccess)} / ${num(m?.recoveryAttemptSeconds)}s`;
  if (id === "manual")
    return `${num(m?.manualAdditionalSeconds == null ? null : m.manualAdditionalSeconds / 3600)}h；SDC兜底 ${num(m?.sdcDelayHours)}h`;
  return "候选方向；本轮未单独验证";
}
function heat(d: TopologyDecision, cards: number) {
  const scale = d.scales.find((s) => s.cards === cards) ?? d.scales[0],
    stages = scale.scenarios.slice(0, 3);
  let b = text(
    30,
    130,
    "损失单位 h · 共用黄色对数色尺 log(1+小时/1分钟)，0 → 600h；格内为真实时长",
    16,
  );
  for (let i = 0; i < 120; i++)
    b += rect(
      1450 + i * 2.5,
      116,
      3,
      17,
      lossFill(Math.expm1((i / 119) * Math.log1p(d.hours * 60)) / 60, d.hours),
      "none",
      0,
    );
  const sx = 228,
    sw = 505,
    cw = sw / 6;
  stages.forEach((s, i) => {
    b +=
      rect(sx + i * sw, 148, sw - 8, 42, "#e7eef3", "none") +
      text(sx + 12 + i * sw, 177, s.name, 20, stageColors[i], 650);
    decisionLosses.forEach((g, j) => {
      b +=
        text(sx + i * sw + j * cw + 5, 214, g.name, 16) +
        text(sx + i * sw + j * cw + 5, 235, g.mechanisms, 11, "#597080");
    });
  });
  decisionDomains.forEach(([id, label, color], r) => {
    const y = 250 + r * 53,
      n = node(stages[0], id)!;
    b +=
      text(30, y + 22, label, 17, color, 650) +
      text(
        30,
        y + 42,
        `预算 ${num(n.allowedHours)}h · ${["M1/3/4/6/7", "M2/3/4/7", "M2/4/5", "M1/2/3/8", "M3/4/6/8", "M5/6/7"][r]}`,
        11,
      );
    stages.forEach((s, i) => {
      const n = node(s, id)!;
      decisionLosses.forEach((_g, j) => {
        const v = lossHours(n, j),
          x = sx + i * sw + j * cw;
        b +=
          `<g data-loss-domain="${id}" data-loss-index="${j}" data-hours="${v}">` +
          rect(x, y, cw - 5, 47, lossFill(v, d.hours), "#e4d7ac", 3) +
          text(
            x + 9,
            y + 29,
            Math.abs(v) < 1e-9
              ? "0"
              : v > 0 && v < 0.001
                ? "<0.001"
                : num(v, 3),
            17,
          ) +
          `<title>${esc(s.name)} / ${esc(label)} / ${decisionLosses[j].name} ${v}h</title></g>`;
      });
    });
  });
  b += text(
    30,
    601,
    "措施编号 → 作用域 → 关键生效参数（读取本轮配置；数值不代表产品承诺）",
    21,
    "#17384d",
    650,
  );
  b += text(
    30,
    628,
    "M1/M2减少事件或传播；其余措施减少损失。列名是适用方向，单项贡献需另看Shapley。",
    14,
    "#617684",
  );
  stages.forEach((s, i) => {
    b += text(625 + i * 376, 651, s.name, 16, stageColors[i], 600);
  });
  mechanismRows.forEach(([id, label, domain, key], i) => {
    const y = 665 + i * 41;
    b +=
      rect(30, y, 1740, 39, i % 2 ? "#eaf0f4" : "#fff", "none", 3) +
      text(42, y + 25, id, 17, "#316b9a", 700) +
      text(90, y + 25, label, 16) +
      text(480, y + 25, domain, 15, "#617684");
    stages.forEach((s, j) => {
      b += text(
        625 + j * 376,
        y + 25,
        key === "D-HARD" || key === "D-SDC" || key === "D-SLOW"
          ? parameter(s, key) + "（覆盖/检测）"
          : key === "C-FAST"
            ? parameter(s, key) + "（周期/阻塞）"
            : parameter(s, key),
        14,
      );
    });
  });
  b += text(
    30,
    1020,
    "M4：成功率 / 恢复合计；M5：周期 / 阻塞。温备、局部重启、异步分级是实现候选，未单独验证或另计收益。",
    15,
  );
  b += text(
    30,
    1050,
    "六类损失守恒；降速含局部损失，污染为期末无效进度。零阻塞仍需验证持久化、带宽竞争与失败回退。",
    15,
  );
  return frame(
    "损失—可靠性措施 · 三阶段逐层对照",
    `${num(cards, 0)}卡 · 01–06责任域贯通架构 / M1–M8机制贯通损失与参数`,
    b,
  );
}
function weaknesses(d: TopologyDecision) {
  let b = text(
    30,
    134,
    "按各规模独立分配的超预算小时排名；相同排名不代表不同规模应采用相同改进参数。",
    17,
  );
  const w = 418;
  d.scales.forEach((s, i) => {
    const x = 30 + i * 440,
      stages = s.scenarios.slice(0, 3);
    b +=
      rect(x, 159, w, 810) +
      text(x + 15, 194, `${num(s.cards / 10000)}万卡`, 26, "#17384d", 700);
    stages.forEach((stage, j) => {
      const yy = 221 + j * 243,
        root = node(stage, "system")!;
      b +=
        rect(x + 12, yy, w - 24, 38, "#e7eef3", "none", 4) +
        text(
          x + 23,
          yy + 25,
          `${stageName(stage)} · ${pct(root.availability)}`,
          20,
          stageColors[j],
          600,
        );
      const ranked = decisionDomains
        .map(([id, label]) => ({ n: node(stage, id)!, label }))
        .sort(
          (a, b) => (b.n.gapHours ?? -Infinity) - (a.n.gapHours ?? -Infinity),
        );
      ranked.forEach(({ n, label }, k) => {
        const y = yy + 64 + k * 28;
        b +=
          text(x + 19, y, `${k + 1}  ${label}`, 15) +
          text(
            x + 216,
            y,
            gap(n),
            15,
            gapColor(n),
            n.gapHours! > 0 ? 600 : 400,
          );
      });
      b += text(
        x + 19,
        yy + 231,
        `MTBF ${time(root.mtbfHours)} · MTTR ${num(root.mttrSeconds, 1)}s`,
        14,
      );
    });
  });
  b += text(
    30,
    1004,
    "AGREE预算固定于现状；“余量”表示该阶段该层在预算内。分层目标是设计责任，不能当作独立器件可靠度。",
    16,
  );
  b += text(
    30,
    1035,
    "优先顺序：缺口小时 → 可覆盖损失路径 → Shapley增量 → 成本、容量与参数边界 → 独立复评。",
    16,
  );
  return frame(
    "跨规模薄弱点 · 分阶段独立排序",
    "万卡 / 十万 / 二十万 / 五十万 · 总体与局部达标分别判断",
    b,
  );
}
function research() {
  let b = text(
    30,
    135,
    "来源支持机制方向；具体覆盖率、时延、FIT改善和工程成本仍需本项目独立验证。",
    18,
  );
  reliabilityEvidence.forEach((e, i) => {
    const y = 162 + i * 126;
    b +=
      rect(30, y, 1740, 115) +
      text(48, y + 29, e.id + " · " + e.name, 21, "#316b9a", 650) +
      text(48, y + 57, "责任域 " + e.domain, 15) +
      `<a href="${esc(e.url)}" target="_blank">` +
      text(48, y + 87, e.source, 15, "#316b9a") +
      "</a>";
    b +=
      text(600, y + 33, e.recommendation, 18) +
      text(600, y + 72, e.validation, 16, "#617684");
  });
  b += text(
    30,
    957,
    "分解：总损失9h → 各规模故障/损失证据 → Shapley工程重要度 → AGREE责任预算 → 候选参数与拓扑。",
    18,
  );
  b += text(
    30,
    994,
    "评估：结构BDD+独立MC验证冗余；动态仿真计算600h损失。容量降级、共因和正常态开销须同时计入。",
    18,
  );
  b += text(
    30,
    1031,
    "建议：先用真实BOM与日志校准现状；再比较检测恢复、检查点、冗余三类组合的边际贡献及成本。",
    18,
  );
  return frame(
    "业界依据与改进建议",
    "公开原始资料核对：2026-10-27 · 不直接移植跨平台收益数字",
    b,
  );
}
export type DecisionView = "architecture" | "loss" | "scales" | "research";
export const decisionViews: { id: DecisionView; name: string }[] = [
  { id: "architecture", name: "架构与指标" },
  { id: "loss", name: "损失—措施—参数" },
  { id: "scales", name: "跨规模薄弱点" },
  { id: "research", name: "业界依据与建议" },
];
export function decisionPageSvg(
  result: any,
  cards = 500000,
  view: DecisionView = "architecture",
) {
  const d: TopologyDecision | null =
    result.topologyDecision ?? topologyDecision(result);
  if (!d?.scales.length) return "";
  return view === "research"
    ? research()
    : view === "loss"
      ? heat(d, cards)
      : view === "scales"
        ? weaknesses(d)
        : overview(d, cards);
}
export function decisionPagesHtml(result: any, cards: number) {
  return decisionViews
    .map(
      (v) =>
        `<section style="break-after:page"><div class="table-wrap">${decisionPageSvg(result, cards, v.id)}</div></section>`,
    )
    .join("");
}

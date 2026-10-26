import {
  topologyDecision,
  type TopologyDecision,
  type TopologyDecisionNode,
} from "../../analysis/src/audit-topology-decision";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";
import { trainingRecoveryBudget } from "../../contracts/src/audit-training-scenario";

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const colors = ["#376baf", "#b8782b", "#087f73"];
const domains = [
  "domain-1",
  "hardware-network",
  "hardware-storage",
  "hardware-facility",
  "hardware-other",
  "overhead",
];
const mechanisms: Record<string, [string, string]> = {
  "domain-1": [
    "频率：筛查、NPO/OIO、HBM纠错",
    "损失：静默在线检测、温备/局部恢复",
  ],
  "hardware-network": [
    "频率/传播：降lane、冗余与快速倒换",
    "损失：预建链、局部重执行、故障隔离",
  ],
  "hardware-storage": [
    "损失：CKPT加载、异步/极致CKPT",
    "检查可持久化副本与失败回退",
  ],
  "hardware-facility": [
    "频率/传播：供电冗余、热管理、隔离",
    "损失：自动检测、温备与快速恢复",
  ],
  "hardware-other": [
    "损失：算子打点、编译缓存、Agent定位",
    "缩短人工排查及失败后追加恢复",
  ],
  overhead: ["损失：极致CKPT、step级保存", "同时检查保存阻塞与正常态检测成本"],
};
const node = (
  s: TopologyDecision["scales"][number]["scenarios"][number],
  id: string,
) => s.nodes.find((n) => n.id === id)!;
const time = (hours: number | null) =>
  hours == null
    ? "—"
    : hours >= 1
      ? num(hours, 1) + "h"
      : num(hours * 60, 1) + "m";
const tag = (s: any, i: number) =>
  ({ current: "现", extension: "延", breakthrough: "突" })[
    s.trainingScenario?.id as "current"
  ] ?? String(i + 1);

/** One zoomable, exportable diagram: topology, frozen allocation, loss/measure heatmap,
 * and four scale panels. Every displayed outcome comes from saved independent runs. */
export function topologyDecisionSvg(result: any, cards = 500000): string {
  const d: TopologyDecision | null =
    result.topologyDecision ?? topologyDecision(result);
  if (!d) return "";
  const main =
    d.scales.find((s) => s.cards === cards) ??
    d.scales.find((s) => s.cards === 500000) ??
    d.scales[0];
  if (!main) return "";
  const cases = main.scenarios.slice(0, 3),
    W = 2400;
  const compareTop = 2610,
    tableHeight = 126 + domains.length * Math.max(1, cases.length) * 30;
  const H =
    compareTop + Math.ceil(d.scales.length / 2) * (tableHeight + 38) + 180;
  const text = (
    x: number,
    y: number,
    v: unknown,
    size = 18,
    fill = "#243b50",
    weight = 400,
  ) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${esc(v)}</text>`;
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill = "#fff",
    stroke = "#d9e4ec",
    r = 12,
  ) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" rx="${r}"/>`;
  const markerId = "topology-arrow-" + main.cards + "-" + cases.length;
  const arrow = (x: number, y: number, x2: number, y2: number) =>
    `<path d="M${x} ${y}L${x2} ${y2}" stroke="#7092a5" stroke-width="2" marker-end="url(#${markerId})" fill="none"/>`;
  let body =
    rect(0, 0, W, H, "#f4f7fa", "none", 0) +
    `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#7092a5"/></marker></defs>`;
  body +=
    rect(0, 0, W, 164, "#142f46", "none", 0) +
    text(
      34,
      48,
      "超节点组网｜可用度分配｜损失与机制｜跨规模决策",
      34,
      "#fff",
      700,
    );
  body += text(
    34,
    89,
    `${num(main.cards, 0)}卡主图 · ${d.hours}小时 · 共同目标线 ${pct(main.target)} · 总预算 ${num(d.hours * (1 - main.target))} h`,
    23,
    "#d6e8ef",
  );
  body += text(
    34,
    124,
    "图中包含工程估算；每个模块均为全规模责任汇总。估算方法、FIT拆分及来源见故障模式详情。",
    18,
    "#bcd5df",
  );
  cases.forEach((s, i) => {
    const x = 32 + i * 788,
      n = node(s, "system");
    body +=
      rect(x, 188, 760, 180) +
      rect(x, 188, 760, 5, colors[i], "none", 0) +
      text(x + 20, 226, s.name, 24, colors[i], 650);
    body +=
      text(x + 20, 281, pct(n.availability), 40, colors[i], 700) +
      text(
        x + 260,
        264,
        `MTBF ${time(n.mtbfHours)} · 等效MTTR ${num(n.mttrSeconds, 1)} s`,
        20,
      );
    body += text(
      x + 260,
      300,
      `损失 ${num(n.actualHours)} h / 预算 ${num(n.allowedHours)} h`,
      20,
    );
    body += text(
      x + 20,
      330,
      `目标 ${pct(n.target)} · ${n.gapHours! > 0 ? "超预算" : "预算余量"} ${num(Math.abs(n.gapHours ?? 0))} h`,
      17,
      "#64798a",
    );
    if (s.trainingScenario) {
      const b = trainingRecoveryBudget(
        s.trainingScenario,
        main.cards,
        main.target,
        d.hours,
      );
      body += text(
        x + 20,
        353,
        `模板MTBF ${time(b.target.mtbfHours)} → 目标等效MTTR ${num(b.target.equivalentMttrSeconds, 1)} s（所选故障范围）`,
        15,
        "#487788",
      );
    }
  });
  if (cases.length < 3)
    body += text(
      850,
      241,
      "分别完成三档评估后，在场景历史中选择并比较，即可叠加三档结果。",
      22,
      "#637d8b",
    );
  body +=
    rect(32, 380, 1448, 1006, "#eaf4ef") +
    rect(1504, 380, 864, 1006, "#edf2fb");
  body += text(
    54,
    417,
    `计算域：${num(main.counts.supernodes, 0)}超节点 → ${num(main.counts.racks, 0)}柜 → ${num(main.counts.nodes, 0)}框 → ${num(main.counts.cards, 0)}模组`,
    22,
    "#246959",
    650,
  );
  body += text(
    1528,
    417,
    "L1/L2内互联 + IO/UB出口 + 参数面Leaf/Spine",
    22,
    "#355c94",
    650,
  );
  const card = (id: string, x: number, y: number, w = 332, h = 206) => {
    const values = cases.map((s) => node(s, id)),
      n = values[0];
    if (!n) return;
    body += `<g data-atlas-node="${esc(id)}" data-decision-node="${esc(id)}" role="button" tabindex="0" aria-label="${esc(n.name)}">`;
    body += rect(x, y, w, h) + text(x + 14, y + 27, n.name, 21, "#183b52", 650);
    if (n.quantity !== null)
      body += text(
        x + w - 14,
        y + 27,
        num(n.quantity, 0) + "单元",
        14,
        "#65808e",
      ).replace(`x="${x + w - 14}"`, `x="${x + w - 14}" text-anchor="end"`);
    body += text(
      x + 14,
      y + 53,
      `分配 ${pct(n.target)} · ${num(n.allowedHours)} h`,
      17,
      "#087f73",
      600,
    );
    body += text(
      x + 14,
      y + 76,
      "阶段     可用度         MTBF        等效MTTR",
      13,
      "#748593",
    );
    values.forEach((v, i) => {
      const yy = y + 103 + i * 28;
      body +=
        text(x + 14, yy, tag(cases[i], i), 16, colors[i], 600) +
        text(x + 52, yy, pct(v.availability), 17, colors[i], 600) +
        text(x + w * 0.49, yy, time(v.mtbfHours), 15) +
        text(x + w * 0.74, yy, num(v.mttrSeconds, 1) + "s", 15) +
        text(
          x + w * 0.74,
          yy + 12,
          v.targetMttrSeconds === null
            ? ""
            : "预算 " + num(v.targetMttrSeconds, 1) + "s",
          10,
          "#087f73",
        );
    });
    body += text(
      x + 14,
      y + h - 12,
      "FIT " +
        num(n.fit) +
        " · 损失h " +
        values.map((v) => num(v.actualHours)).join(" → "),
      13,
      "#6a7f8d",
    );
    body += `<title>${esc(n.name)}；分配依据：C ${num(n.complexity)} / E ${num(n.importance)} / 正贡献投影 ${num(n.gain * 100)} pp。${esc(d.metricBasis)}</title></g>`;
  };
  const computeRows = [
    ["hardware-supernode", "hardware-rack", "hardware-node", "hardware-board"],
    ["hardware-module", "hardware-chip", "object-HBM", "object-MODULE"],
    ["object-CORE", "object-SRAM", "object-IOD", "hardware-board-extra"],
    ["object-CPU", "object-DDR", "object-SSD", "domain-1"],
  ];
  computeRows.forEach((ids, row) =>
    ids.forEach((id, col) => card(id, 52 + col * 354, 446 + row * 230)),
  );
  for (let i = 0; i < 3; i++)
    body += arrow(387 + i * 354, 544, 401 + i * 354, 544);
  body +=
    text(68, 676, "板内与模组责任 ↓", 14, "#447963") +
    text(68, 906, "NPU内部与板级连接 ↓", 14, "#447963") +
    text(68, 1136, "节点配套资源 / 计算域汇总 ↓", 14, "#447963");
  const networkRows = [
    ["hardware-l1", "hardware-l2"],
    ["hardware-io", "hardware-ubnic"],
    ["hardware-leaf-extra", "hardware-spine-extra"],
    ["object-OPT", "hardware-network"],
  ];
  networkRows.forEach((ids, row) =>
    ids.forEach((id, col) => card(id, 1524 + col * 418, 446 + row * 230, 396)),
  );
  networkRows
    .slice(0, 3)
    .forEach(
      (_, row) => (body += arrow(1923, 544 + row * 230, 1939, 544 + row * 230)),
    );
  body +=
    arrow(1482, 545, 1501, 545) +
    text(1528, 676, "IO转换与UB出口 ↓", 14, "#5673a4") +
    text(1528, 906, "跨超节点参数面 ↓", 14, "#5673a4") +
    text(1528, 1136, "光介质与网络域汇总 ↓", 14, "#5673a4");
  [
    "hardware-storage",
    "object-POWER",
    "object-COOL",
    "object-MGMT",
    "hardware-other",
    "overhead",
  ].forEach((id, i) => card(id, 32 + i * 394, 1420, 366, 206));
  body += text(
    34,
    1664,
    "模块与父层使用同一损失账；MTBF为中断事件间隔，MTTR为包含全部损失的等效值，绿色小字为本档目标预算。公共开销不定义故障周期。",
    17,
    "#667e8e",
  );

  // Aligned loss / measure heatmap, with signed bundled improvements.
  body += text(34, 1720, "损失—可靠性机制热力图", 28, "#173c52", 650);
  body += text(
    34,
    1753,
    "橙色越深，损失越大；绿色净减损，红色净增损。右侧为适用机制方向，阶段净变化包含全部参数与组合变化，不是单机制因果归因。",
    18,
    "#637c8d",
  );
  const groups = [
    { name: "恢复停机", keys: ["downtime"] },
    { name: "回滚重算", keys: ["rollback"] },
    { name: "降速/局部", keys: ["slowdown", "localLoss"] },
    { name: "期末污染", keys: ["terminalInvalid"] },
    { name: "保存/检测", keys: ["save", "mechanismOverhead"] },
  ];
  const cw = 1260 / Math.max(1, cases.length),
    cell = cw / 5;
  const maxima = groups.map((g) =>
    Math.max(
      1e-9,
      ...domains.flatMap((id) =>
        cases.map((s) =>
          g.keys.reduce(
            (sum, k) =>
              sum +
              (node(s, id).loss[k as keyof TopologyDecisionNode["loss"]] ?? 0),
            0,
          ),
        ),
      ),
    ),
  );
  body +=
    rect(32, 1778, 2336, 72, "#e3ebf1", "none", 8) +
    text(48, 1824, "责任层", 18, "#24475b", 650);
  cases.forEach((s, i) => {
    body += text(222 + i * cw, 1805, s.name, 20, colors[i], 650);
    groups.forEach(
      (g, j) =>
        (body += text(222 + i * cw + j * cell, 1835, g.name + " h", 15)),
    );
  });
  body +=
    text(1490, 1805, "延长线", 17) +
    text(1490, 1835, "净减损 h", 15) +
    text(1620, 1805, "突破档", 17) +
    text(1620, 1835, "净减损 h", 15) +
    text(1770, 1824, "损失消减方向 / 可靠性机制", 19, "#24475b", 650);
  domains.forEach((id, row) => {
    const y = 1862 + row * 108,
      n = node(cases[0], id);
    body +=
      rect(32, y, 2336, 100, "#fff", "none", 8) +
      text(46, y + 36, n.name, 18, "#23465a", 600) +
      text(46, y + 65, "预算 " + num(n.allowedHours) + " h", 16, "#587789");
    cases.forEach((s, i) =>
      groups.forEach((g, j) => {
        const v = g.keys.reduce(
            (sum, k) =>
              sum +
              (node(s, id).loss[k as keyof TopologyDecisionNode["loss"]] ?? 0),
            0,
          ),
          intensity = Math.sqrt(v / maxima[j]);
        body +=
          `<rect x="${210 + i * cw + j * cell}" y="${y + 10}" width="${cell - 5}" height="80" rx="5" fill="rgba(211,107,54,${0.04 + 0.7 * intensity})"/>` +
          text(220 + i * cw + j * cell, y + 56, num(v, 1), 17);
      }),
    );
    [1, 2].forEach((index, j) => {
      const v =
        cases[index] && cases[index - 1]
          ? node(cases[index - 1], id).actualHours -
            node(cases[index], id).actualHours
          : null;
      const x = 1482 + j * 130;
      body +=
        rect(
          x,
          y + 10,
          120,
          80,
          v == null ? "#f4f6f8" : v >= 0 ? "#deeee8" : "#f6e1da",
          "none",
          6,
        ) +
        text(
          x + 10,
          y + 56,
          v == null ? "—" : (v < 0 ? "−" : "+") + num(Math.abs(v), 1),
          18,
          v != null && v < 0 ? "#a24a35" : "#286d59",
          600,
        );
    });
    mechanisms[id].forEach(
      (v, j) => (body += text(1770, y + 35 + j * 31, v, 17, "#3e6277")),
    );
    const last = node(cases.at(-1)!, id);
    body += text(
      1770,
      y + 88,
      `末档${last.gapHours! > 0 ? "仍超预算" : "预算余量"} ${num(Math.abs(last.gapHours ?? 0))} h`,
      15,
      last.gapHours! > 0 ? "#b05a30" : "#2c7964",
    );
  });

  body += text(
    34,
    2560,
    "四种规模同图对照：识别各规模的薄弱子系统与改进重点",
    28,
    "#173c52",
    650,
  );
  body += text(
    34,
    2590,
    "同一目标，不同的故障暴露、分层责任与机制收益；下表保留各档实际值，允许小规模结果高于目标。",
    18,
    "#637c8d",
  );
  d.scales.forEach((scale, index) => {
    const x = 32 + (index % 2) * 1184,
      y = compareTop + Math.floor(index / 2) * (tableHeight + 38),
      stages = scale.scenarios.slice(0, 3);
    body +=
      rect(x, y, 1152, tableHeight) +
      text(
        x + 18,
        y + 35,
        `${num(scale.cards / 10000)}万卡 · 总体目标 ${pct(scale.target)}`,
        24,
        "#173c52",
        650,
      );
    const last = stages.at(-1)!,
      weak = domains
        .map((id) => node(last, id))
        .sort((a, b) => (b.gapHours ?? 0) - (a.gapHours ?? 0))[0];
    body += text(
      x + 18,
      y + 65,
      `末档首要核查：${weak.name} · ${weak.gapHours! > 0 ? "差距" : "余量"} ${num(Math.abs(weak.gapHours ?? 0))} h`,
      16,
      "#8b613f",
    );
    body += rect(x + 12, y + 79, 1128, 31, "#e5edf3", "none", 0);
    const xs = [18, 242, 462, 620, 802, 1002];
    [
      "子系统 / 阶段",
      "可用度 / 分配目标",
      "MTBF",
      "MTTR / 预算 秒",
      "损失 / 预算 h",
      "差距 h",
    ].forEach(
      (v, i) => (body += text(x + xs[i], y + 101, v, 15, "#315269", 600)),
    );
    domains.forEach((id, di) =>
      stages.forEach((s, si) => {
        const n = node(s, id),
          yy = y + 112 + (di * stages.length + si) * 30;
        body += rect(
          x + 12,
          yy,
          1128,
          30,
          di % 2 ? "#f2f6f9" : "#fff",
          "none",
          0,
        );
        const cells = [
          n.name + " / " + tag(s, si),
          pct(n.availability) + " / " + pct(n.target),
          time(n.mtbfHours),
          num(n.mttrSeconds, 1) + " / " + num(n.targetMttrSeconds, 1),
          num(n.actualHours, 1) + " / " + num(n.allowedHours, 1),
          num(n.gapHours, 1),
        ];
        cells.forEach(
          (v, i) =>
            (body += text(
              x + xs[i],
              yy + 21,
              v,
              15,
              i === 0
                ? colors[si]
                : i === 5 && n.gapHours! > 0
                  ? "#b15a3b"
                  : "#345267",
              i === 0 ? 600 : 400,
            )),
        );
      }),
    );
  });
  body += text(
    34,
    H - 125,
    "流程支撑：现状仿真识别差距 → Shapley组合归因 → AGREE分层/措施预算 → 参数改进与独立复评；BDD/蒙特卡洛用于组网辅助验证。",
    18,
    "#496e80",
  );
  body += text(
    34,
    H - 92,
    `分配方法：${d.allocationLabel ?? "AGREE故障/损失/正贡献证据"}；三档沿用同一现状拓扑分配，细节见模块分配账。`,
    18,
    "#496e80",
  );
  body += text(
    34,
    H - 60,
    "措施重点由实际损失账确定；机制方向需结合覆盖率、时延、失败回退及正常态成本共同复评。数值为本次保存的采样结果。",
    18,
    "#496e80",
  );
  body += text(
    34,
    H - 27,
    d.allocationIssues.length
      ? "存在分配不可行项，详见分配明细；未伪造达标数值。"
      : "总FIT、事件损失与预算守恒；数量和分摊假设仅在故障模式详情中逐项标注。",
    16,
    "#6c8390",
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="分层分配与机制决策图" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif">${body}</svg>`;
}

export function topologyEstimateDetails(result: any, cards: number) {
  const d: TopologyDecision | null =
    result.topologyDecision ?? topologyDecision(result);
  if (!d) return "";
  const rows = d.estimates.filter((e) => e.cards === cards);
  const scale = d.scales.find((s) => s.cards === cards),
    baseline = scale?.scenarios[0];
  const trace = scale
    ? `<h4>${num(d.hours)}小时仿真 → 可用度 → 等效MTTR</h4><p>各模式FIT确定到达率；逐事件匹配检测、恢复与失败回退后，互斥损失账合计L。A=1−L/T；MTBF=10⁹/(卡数×中断等效FIT)；实际等效MTTR=MTBF×L/(T−L)。目标MTTR用目标A换算。目标秒数不写入仿真；单次停机、检测或恢复耗时不是这个总等效值。</p><div class="table-wrap"><table><thead><tr><th>场景</th><th>中断MTBF / 分钟</th><th>逐事件损失+公共开销 h</th><th>可用度</th><th>实际等效MTTR / 秒</th><th>目标MTTR预算 / 秒</th></tr></thead><tbody>${scale.scenarios
        .map((s) => {
          const r = node(s, "system"),
            o = node(s, "overhead");
          return `<tr><th>${esc(s.name)}</th><td>${num(r.mtbfHours === null ? null : r.mtbfHours * 60)}</td><td>${num(r.actualHours - o.actualHours)} + ${num(o.actualHours)}</td><td>${pct(r.availability)}</td><td>${num(r.mttrSeconds, 1)}</td><td>${num(r.targetMttrSeconds, 1)}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : "";
  const allocation = baseline
    ? `<h4>主图模块分配账 · 沿用${esc(scale!.reference)}预算</h4><p>当前方法：${esc(d.allocationLabel ?? "AGREE证据分配")}。启用分配时，同级子层预算之和等于父层。AGREE证据模式的分数复杂度乘设计权重；E=[0.2+0.8×max(同级归一化损失,正贡献投影)]×人工重要度，无损失/贡献时参考FIT。所得损失小时属于工程责任预算，非器件可靠度乘积。</p><div class="table-wrap"><table><thead><tr><th>模块</th><th>父层</th><th>C复杂度</th><th>E工程重要度</th><th>正贡献投影 pp</th><th>分配目标</th><th>预算 h</th></tr></thead><tbody>${baseline.nodes.map((n) => `<tr><th>${esc(n.name)}</th><td>${esc(baseline.nodes.find((p) => p.id === n.parentId)?.name ?? "总体")}</td><td>${num(n.complexity)}</td><td>${num(n.importance)}</td><td>${num(n.gain * 100)}</td><td>${pct(n.target)}</td><td>${num(n.allowedHours)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  return `<details class="arch-evidence"><summary>故障模式详细列表 · 拓扑估算、分配与来源</summary><p>${esc(d.basis)}</p><p>${esc(d.inventoryBasis)}</p><p>${esc(d.metricBasis)}</p>${d.allocationIssues.map((v) => `<p>${esc(v)}</p>`).join("")}${trace}${allocation}<h4>源故障模式与拓扑映射</h4><div class="table-wrap"><table style="min-width:1400px;table-layout:auto"><thead><tr><th>场景 / 模块</th><th>源故障模式</th><th>类型</th><th>源FIT</th><th>分摊比例</th><th>模块FIT</th><th>采样事件次数</th><th>停机 h</th><th>总损失 h</th><th>证据</th><th>方法与来源</th></tr></thead><tbody>${rows.map((e) => `<tr><th>${esc(e.scenario)} / ${esc(e.nodeName)}</th><td>${esc(e.eventId)}</td><td>${esc(e.type)}</td><td>${num(e.sourceFit)}</td><td>${pct(e.fraction)}</td><td>${num(e.fit)}</td><td>${num(e.sampledEvents)}</td><td>${num(e.downtimeHours)}</td><td>${num(e.lossHours)}</td><td>${e.estimated ? "工程估算" : "源事件映射"}</td><td style="min-width:420px">${esc(e.method)}<br/>${esc(e.source)}</td></tr>`).join("")}</tbody></table></div></details>`;
}

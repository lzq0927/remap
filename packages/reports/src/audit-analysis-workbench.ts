import { physicalTopology } from "./audit-physical-topology";
import { trainingReferenceAvailability } from "../../contracts/src/audit-training-scenario";
import { reliabilityStages } from "../../contracts/src/reliability-workflow";
import {
  topologyDecision,
  type TopologyDecision,
  type TopologyDecisionNode,
} from "../../analysis/src/audit-topology-decision";
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
import {
  reliabilityEvidence,
  foundationalEvidence,
  parallelismEvidence,
} from "./audit-research";
export type AnalysisView =
  | "overview"
  | "architecture"
  | "loss"
  | "scales"
  | "research";
export type WorkflowAnalysisView = AnalysisView | "verification";
export type AnalysisStage =
  TopologyDecision["scales"][number]["scenarios"][number];
export const analysisViews = [
  { id: "architecture", name: "01 可用度目标分解分配" },
  { id: "overview", name: "02 可用度评估" },
  { id: "loss", name: "03 可靠性机制设计" },
  { id: "verification", name: "04 可靠性机制验证" },
] as const;
const hours = (v: number | null | undefined) =>
  v == null
    ? "—"
    : Math.abs(v) < 1e-8
      ? "0"
      : v > 0 && v < 0.001
        ? "<0.001"
        : num(v, 3);
const period = (h: number | null | undefined) =>
  h == null ? "—" : h >= 1 ? num(h, 2) + " 小时" : num(h * 60, 2) + " 分钟";
const get = (s: AnalysisStage, id: string) => s.nodes.find((n) => n.id === id)!;
const card = (title: string, body: string, extra = "") =>
  `<section class="analysis-card ${extra}"><h3>${title}</h3>${body}</section>`;
const table = (heads: string[], rows: string[][]) =>
  `<div class="analysis-table-scroll"><table><thead><tr>${heads.map((v) => `<th>${v}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v, i) => `<${i ? "td" : "th"}>${v}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody></table></div>`;
export function analysisContext(
  result: any,
  cards: number,
  stageName?: string,
) {
  const d: TopologyDecision | null =
    result.topologyDecision ?? topologyDecision(result);
  if (!d) return null;
  const scale = d.scales.find((s) => s.cards === cards) ?? d.scales[0];
  if (!scale?.scenarios.length) return null;
  const baseline =
    scale.scenarios.find((s) => s.name === scale.reference) ??
    scale.scenarios.find((s) => s.trainingScenario?.id === "current") ??
    scale.scenarios[0];
  const stage = scale.scenarios.find((s) => s.name === stageName) ?? baseline;
  return { d, scale, stage, baseline, root: get(stage, "system") };
}
export function domainLossSources(stage: AnalysisStage) {
  return decisionDomains
    .map(([id, name, color]) => ({
      id,
      name,
      color,
      node: get(stage, id),
      hours: get(stage, id).actualHours,
      parts: decisionLosses.map((l, i) => ({
        name: l.name,
        hours: lossHours(get(stage, id), i),
      })),
    }))
    .sort((a, b) => b.hours - a.hours);
}
export function sourceEvents(
  d: TopologyDecision,
  cards: number,
  stageName: string,
) {
  const map = new Map<
    string,
    {
      id: string;
      fit: number;
      hours: number;
      estimated: boolean;
      source: string;
    }
  >();
  for (const e of d.estimates.filter(
    (e) => e.cards === cards && e.scenario === stageName,
  )) {
    const prior = map.get(e.eventId) ?? {
      id: e.eventId,
      fit: 0,
      hours: 0,
      estimated: false,
      source: e.source,
    };
    prior.fit += e.fit;
    prior.hours += e.lossHours;
    prior.estimated ||= e.estimated;
    map.set(e.eventId, prior);
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours);
}
export function resourceAccounting(
  activeCards: number,
  activePerDomain = 64,
  installedPerDomain = 72,
  extraDomainFraction = 0.02,
  availability = 0.985,
  horizon = 600,
) {
  if (
    !Number.isSafeInteger(activeCards) ||
    activeCards < 1 ||
    !Number.isSafeInteger(activePerDomain) ||
    activePerDomain < 1 ||
    !Number.isSafeInteger(installedPerDomain) ||
    installedPerDomain < activePerDomain ||
    !Number.isFinite(extraDomainFraction) ||
    extraDomainFraction < 0 ||
    extraDomainFraction > 1 ||
    !Number.isFinite(availability) ||
    availability < 0 ||
    availability > 1 ||
    !Number.isFinite(horizon) ||
    horizon <= 0
  )
    throw Error("资源核算输入无效");
  const activeDomains = Math.ceil(activeCards / activePerDomain),
    deployedDomains = Math.ceil(activeDomains * (1 + extraDomainFraction)),
    deployedCards = deployedDomains * installedPerDomain,
    extraCards = deployedCards - activeCards;
  return {
    activeCards,
    activeDomains,
    deployedDomains,
    deployedCards,
    extraCards,
    reserveShare: extraCards / deployedCards,
    extraRelativeToActive: extraCards / activeCards,
    jobAvailability: availability,
    effectiveGpuHours: activeCards * horizon * availability,
    deployedNormalizedOutput: (availability * activeCards) / deployedCards,
    costFactor:
      availability > 0 ? deployedCards / (activeCards * availability) : null,
  };
}
function systemMetrics(
  d: TopologyDecision,
  stage: AnalysisStage,
  root: TopologyDecisionNode,
) {
  return `<div class="analysis-kpis">${[
    [
      "本轮作业可用度",
      pct(root.availability),
      `目标 ${pct(root.target)} · 均值95%采样区间 ${pct(stage.statistics?.ciLow)}–${pct(stage.statistics?.ciHigh)}`,
    ],
    [
      "实际损失 / 总预算",
      `${hours(root.actualHours)} / ${hours(root.allowedHours)} h`,
      `${d.hours}小时固定窗口`,
    ],
    ["MTBF", period(root.mtbfHours), "本规模全部已建模中断事件"],
    [
      "等效 MTTR / 条件预算",
      `${num(root.mttrSeconds, 1)} / ${num(root.targetMttrSeconds, 1)} 秒`,
      "由全部损失折算；工程恢复耗时另见参数",
    ],
  ]
    .map(
      ([name, v, note]) =>
        `<div><span>${name}</span><strong>${v}</strong><small>${note}</small></div>`,
    )
    .join("")}</div>`;
}
function assessmentReading(
  d: TopologyDecision,
  stage: AnalysisStage,
  cards: number,
) {
  const root = get(stage, "system"),
    domains = domainLossSources(stage),
    gap = domains
      .filter((r) => r.node.gapHours != null && r.node.gapHours > 1e-8)
      .sort((a, b) => b.node.gapHours! - a.node.gapHours!)[0];
  const loss = decisionLosses
    .map((l, i) => ({ name: l.name, index: i, hours: lossHours(root, i) }))
    .sort((a, b) => b.hours - a.hours)[0];
  const event = sourceEvents(d, cards, stage.name)[0];
  return `<div class="analysis-reading"><b>本轮判读（按保存的均值）</b><p>总体${root.allowedHours == null ? "预算未分配" : root.actualHours > root.allowedHours ? "超出预算 " + hours(root.actualHours - root.allowedHours) + " h" : "在预算内，余量 " + hours(root.allowedHours - root.actualHours) + " h"}；${gap ? `${gap.name}仍超预算 ${hours(gap.node.gapHours)} h` : "已分配责任域内无超预算项"}。${domains[0] && root.actualHours > 0 ? `损失最多的是${domains[0].name}，占总损失 ${pct(domains[0].hours / root.actualHours)}。` : ""}</p><p>${
    loss && loss.hours > 0
      ? `优先损失路径：${loss.name} ${hours(loss.hours)} h。对应措施 ${concreteMeasures
          .filter((m) => m.loss.includes(loss.index))
          .map((m) => m.id)
          .join(" / ")}，需按覆盖范围和工程条件验证。`
      : ""
  }${event && event.hours > 0 ? `最大源事件为 ${esc(event.id)}，归属损失 ${hours(event.hours)} h；这属于来源诊断，单项收益仍需独立评估。` : ""}</p></div>`;
}
function metricRows(stage: AnalysisStage, ids: readonly string[]) {
  return ids
    .map((id) => {
      const n = get(stage, id);
      if (!n) return [];
      return [
        `<button type="button" data-analysis-node="${esc(id)}">${esc(n.name)}</button>`,
        `${pct(n.availability)}<small>目标 ${pct(n.target)}</small>`,
        `${hours(n.actualHours)}<small>预算 ${hours(n.allowedHours)} h</small>`,
        `${num(n.fit, 3)}<small>中断 ${num(n.hardFit, 3)}</small>`,
        period(n.mtbfHours),
        `${num(n.mttrSeconds, 1)}<small>条件预算 ${num(n.targetMttrSeconds, 1)} 秒</small>`,
        n.gapHours == null
          ? "未分配"
          : `<b class="${n.gapHours > 1e-8 ? "analysis-gap" : "analysis-within"}">${n.gapHours > 1e-8 ? "超出" : "余量"} ${hours(Math.abs(n.gapHours))} h</b>`,
      ];
    })
    .filter((row) => row.length);
}
export function allocationMetrics(stage: AnalysisStage, parentId = "system") {
  const ids =
    parentId === "system"
      ? decisionDomains.map(([id]) => id)
      : stage.nodes.filter((n) => n.parentId === parentId).map((n) => n.id);
  return card(
    "子系统现状与分解目标",
    `<p>先对照本轮实际值与冻结的责任预算；点击子系统可查看部件、故障来源及机制条件。</p>${table(["子系统 / 部件", "可用度 / 分解目标", "损失 / 预算 h", "全类等效FIT / 中断FIT", "MTBF", "等效MTTR / 预算", "损失差距"], metricRows(stage, ids))}<p class="analysis-note">FIT单位为每NPU等效十亿小时，已按本规模数量/暴露折算；中断到达率 = 卡数 × 中断FIT / 10⁹。可用度是责任损失折算，父子层不能重复相加或连乘。</p>`,
  );
}
function containment(
  stage: AnalysisStage,
  id: string,
  children: string = "",
  className = "",
) {
  const n = get(stage, id);
  if (!n) return "";
  return `<div class="analysis-enclosure ${className}" data-contains="${id}" data-budget-status="${n.allowedHours == null ? "unallocated" : (n.gapHours ?? 0) > 1e-8 ? "gap" : "within"}"><div class="analysis-enclosure-title"><button type="button" data-analysis-node="${id}">${esc(n.name)}</button><span>数量 ${num(n.quantity, 0)}</span></div><small>A ${pct(n.availability)} → ${pct(n.target)} · 损失 ${hours(n.actualHours)} / ${hours(n.allowedHours)} h</small><b class="analysis-node-gap">${n.allowedHours == null ? "目标待分配" : (n.gapHours ?? 0) > 1e-8 ? `超预算 ${hours(n.gapHours)} h` : `预算余量 ${hours(-(n.gapHours ?? 0))} h`}</b>${n.hardFit > 0 ? `<small class="analysis-node-metrics">等效FIT ${num(n.fit, 2)} · MTBF ${period(n.mtbfHours)} · MTTR ${num(n.mttrSeconds, 1)}s</small>` : ""}${children}</div>`;
}
function communicationGraph() {
  const t = (x: number, y: number, v: string) =>
    `<text x="${x}" y="${y}" text-anchor="middle">${esc(v)}</text>`;
  const box = (x: number, y: number, v: string) =>
    `<rect x="${x}" y="${y}" width="190" height="40" rx="5"/>${t(x + 95, y + 25, v)}`;
  let b = "";
  [
    [
      "域内高速互联",
      ["NPU", "L1交换", "光模块 / 光纤", "L2交换", "对端L1 / NPU"],
    ],
    [
      "跨超节点 / 存储网络",
      [
        "框 → IO / UB NIC",
        "光模块 / 光纤",
        "Leaf",
        "Spine",
        "远端超节点 / 存储",
      ],
    ],
  ].forEach(([label, labels], row) => {
    const y = 35 + row * 87;
    b += `<text x="10" y="${y - 12}" class="analysis-path-label">${esc(label)}</text>`;
    (labels as string[]).forEach((v, i) => {
      const x = 10 + i * 217;
      b += box(x, y, v);
      if (i < 4)
        b += `<path d="M${x + 190} ${y + 20}H${x + 217}"/><polygon points="${x + 213},${y + 16} ${x + 217},${y + 20} ${x + 213},${y + 24}"/>`;
    });
  });
  return `<svg class="analysis-connections" viewBox="0 0 1100 175" role="img" aria-label="设备通信连接关系">${b}</svg>`;
}
export function architectureRelations(
  stage: AnalysisStage,
  counts?: TopologyDecision["scales"][number]["counts"],
) {
  const chip = containment(
    stage,
    "hardware-chip",
    `<div class="analysis-chips">${["object-CORE", "object-SRAM", "object-IOD"].map((id) => `<button type="button" data-analysis-node="${id}">${esc(get(stage, id).name)}</button>`).join("")}</div>`,
  );
  const module = containment(
    stage,
    "hardware-module",
    `<div class="analysis-nested-row">${chip}<div class="analysis-memory">${["object-HBM", "object-MODULE"].map((id) => containment(stage, id)).join("")}</div></div>`,
  );
  const board = containment(
    stage,
    "hardware-board",
    module + containment(stage, "hardware-board-extra"),
  );
  const frame = containment(
    stage,
    "hardware-node",
    board +
      `<div class="analysis-host-parts">${["object-CPU", "object-DDR", "object-SSD"].map((id) => containment(stage, id)).join("")}</div>`,
  );
  const rack = containment(stage, "hardware-rack", frame);
  const compute = containment(
    stage,
    "hardware-supernode",
    rack,
    "analysis-compute",
  );
  const network = `<div class="analysis-enclosure analysis-network"><div class="analysis-enclosure-title">网络物理位置与责任归属</div><p>L1、IO、UB网卡位于计算柜；L2位于互联柜。责任预算统一计入02网络域。</p><div class="analysis-enclosure"><b>计算柜内网络设备</b>${["hardware-l1", "hardware-io", "hardware-ubnic"].map((id) => containment(stage, id)).join("")}</div><div class="analysis-enclosure"><b>互联柜 / 域内交换 · 柜数 ${num(counts?.interconnectRacks, 0)}</b>${containment(stage, "hardware-l2")}</div><div class="analysis-enclosure"><b>跨超节点网络 / 光介质</b>${["hardware-leaf-extra", "hardware-spine-extra", "object-OPT"].map((id) => containment(stage, id)).join("")}</div></div>`;
  return card(
    "架构：物理包含与通信连接",
    `<div class="analysis-table-scroll">${physicalTopology(stage, counts)}</div><details><summary>展开完整包含层级与部件指标</summary><div class="analysis-relation-key"><span>嵌套框：物理包含</span><span>蓝色连线：通信路径</span><span>共享服务：跨域依赖</span></div><div class="analysis-system-envelope" data-contains="system"><header><b>集群总体 · ${num(get(stage, "system").quantity, 0)}卡</b><span>A ${pct(get(stage, "system").availability)} / 目标 ${pct(get(stage, "system").target)}</span></header><div class="analysis-physical"><div>${compute}</div>${network}</div>${communicationGraph()}<div class="analysis-services">${["hardware-storage", "hardware-facility", "hardware-other"].map((id) => `<span>⇢ ${esc(get(stage, id).name)}<small>${id === "hardware-storage" ? "检查点/训练数据服务，传播范围按输入" : id === "hardware-facility" ? "供电/冷却/管理，需核对公共依赖" : "训练框架/控制面/未归因事件，按事件界定范围"}</small></span>`).join("")}</div></div><p class="analysis-note">图内数量、FIT与A均为当前规模该类部件的责任汇总，不是单件器件指标。框表示包含关系，不表示独立串并联。CPU/DDR/SSD数量可为责任代理单元，光模块/Leaf/Spine可含拓扑估算，需以BOM核对。</p></details>`,
  );
}
export function allocationLogic(
  d: TopologyDecision,
  stage: AnalysisStage,
  baseline: AnalysisStage,
  cards?: number,
  architecture?: any,
) {
  const root = get(stage, "system"),
    children = baseline.nodes.filter((n) => n.parentId === "system");
  const designWeight = (n: TopologyDecisionNode) => {
    const a = architecture?.nodes?.find((v: any) => v.id === n.id);
    return a?.scaleWeights?.[cards ?? 0] ?? a?.weight ?? 1;
  };
  return card(
    "分解与分配：从总目标到每层责任",
    `<div class="analysis-method-flow"><span>① ${d.hours}h × (1 − ${pct(root.target)})<b>总预算 ${hours(root.allowedHours)}h</b></span><span>② 冻结 ${esc(baseline.name)}<b>故障 / 损失 / 正贡献证据</b></span><span>③ ${esc(d.allocationLabel)}<b>父预算分给同级子层</b></span><span>④ 机制参数与拓扑备选<b>独立仿真检验目标</b></span></div><p>当前使用<strong>${esc(d.allocationLabel)}</strong>。AGREE证据模式以模式复杂度C、损失及正Shapley贡献的工程投影形成重要度E，并结合人工权重；重要度较高时分配更严格的允许损失。每个规模单独分配，后续阶段沿用现状预算。目标A对应多种FIT/MTBF/MTTR组合；表内MTTR预算固定本轮MTBF反推，拟定措施后需重新评估。</p><p class="analysis-note">这里是固定窗口损失的工程责任分配；Shapley投影不是条件故障概率，也不是模块独立Shapley。预算不等于产品能力，最终仍以逐事件仿真核验。</p><details><summary>查看实际C / E / 权重依据与预算守恒</summary>${table(
      [
        "责任域",
        "模式复杂度C",
        "设计权重",
        "有效C",
        "重要度E",
        "正贡献投影 pp",
        "现状损失 h",
        "分配预算 h",
      ],
      children.map((n) => [
        esc(n.name),
        num(n.complexity),
        num(designWeight(n)),
        num(
          d.allocationMethod === "agree-evidence"
            ? n.complexity * designWeight(n)
            : designWeight(n),
        ),
        num(n.importance),
        num(n.gain * 100),
        hours(n.actualHours),
        hours(n.allowedHours),
      ]),
    )}<p>同级预算合计 ${hours(children.reduce((v, n) => v + (n.allowedHours ?? 0), 0))} h / 父层 ${hours(get(baseline, "system").allowedHours)} h。若某层未分配，不据此宣称分配完成。</p><p>AGREE适配：R*=exp(−B/T)，qᵢ=[1−(R*)^(Cᵢ/ΣC)]/Eᵢ，wᵢ=−ln(1−qᵢ)，Bᵢ=B×wᵢ/Σw。qᵢ≥1表示不可行，平台保留诊断。</p><p>E=[0.2+0.8×max(同级归一化损失,正贡献投影)]×人工重要度；缺少损失/贡献时参考FIT。C再乘设计权重。</p></details>${d.allocationIssues.map((v) => `<p class="analysis-gap">${esc(v)}</p>`).join("")}`,
  );
}
function horizontalRows(
  rows: {
    id: string;
    name: string;
    hours: number;
    parts?: { name: string; hours: number }[];
  }[],
  total: number,
  title: string,
) {
  const max = Math.max(1e-9, ...rows.map((r) => r.hours));
  return `<figure class="analysis-bars" aria-label="${esc(title)}"><figcaption>${title} · 线性长度 / 小时</figcaption><div class="analysis-bar-axis"><span>0</span><span>${hours(max)} h</span></div>${rows.map((r) => `<div class="analysis-source-row" data-loss-source="${esc(r.id)}" data-hours="${r.hours}"><span>${esc(r.name)}</span><div class="analysis-source-track"><div class="analysis-source-stack" style="width:${(Math.max(0, r.hours) / max) * 100}%">${(r.parts ?? [{ name: r.name, hours: r.hours }]).map((p, i) => `<i title="${esc(p.name)} ${hours(p.hours)}h" style="width:${r.hours > 0 ? (Math.max(0, p.hours) / r.hours) * 100 : 0}%;background:${r.parts ? ["#cf9b35", "#587caa", "#6d9a91", "#aa7764", "#b9a261", "#8997a7"][i % 6] : "#7c94aa"}"></i>`).join("")}</div></div><b>${hours(r.hours)} h<small>${total > 0 ? pct(r.hours / total) : "0%"}总损失</small></b></div>`).join("")}</figure>`;
}
export function lossSourceCharts(
  d: TopologyDecision,
  stage: AnalysisStage,
  cards: number,
) {
  const root = get(stage, "system"),
    events = sourceEvents(d, cards, stage.name),
    overhead = get(stage, "overhead");
  const eventRows = events
    .slice(0, 8)
    .map((e) => ({ id: e.id, name: e.id, hours: e.hours }));
  const rest = events.slice(8).reduce((v, e) => v + e.hours, 0);
  if (rest > 0)
    eventRows.push({
      id: "remaining-events",
      name: "其他故障模式",
      hours: rest,
    });
  eventRows.push({
    id: "public-overhead",
    name: "公共保存与检测开销",
    hours: overhead.actualHours,
  });
  return card(
    "损失来源：按责任域与故障事件定位",
    `<div class="analysis-source-grid">${horizontalRows(domainLossSources(stage), root.actualHours, "责任域损失构成")}${horizontalRows(eventRows, root.actualHours, "故障事件损失来源")}</div><div class="analysis-loss-key">${decisionLosses.map((l, i) => `<span><i style="background:${["#cf9b35", "#587caa", "#6d9a91", "#aa7764", "#b9a261", "#8997a7"][i]}"></i>${l.name}</span>`).join("")}</div><p class="analysis-note">责任域图按颜色分损失类型，事件图单色表示总计。两张图是同一总损失的不同归属视角。事件图按源事件合并拓扑拆分，前8项之外合并为“其他”，公共开销单列；按损失大小排序。</p>`,
  );
}
export const concreteMeasures = [
  {
    id: "M1",
    category: "MTBF · 预防",
    name: "上线/回归压测、弱链路筛查、HBM/DDR纠错与退役",
    scope: "01 / 02 / 03",
    loss: [0, 2, 3],
    condition: "按代际、固件、工作负载验证FIT与复发；误隔离和巡检成本计入。",
    param: "FIT / 检出覆盖 / 误隔离 / 巡检开销",
  },
  {
    id: "M2",
    category: "MTBF · 传播抑制",
    name: "跨柜多路径、故障绕行、存储冗余与共享依赖隔离",
    scope: "02 / 03 / 04",
    loss: [0, 2],
    condition: "BDD/MC验证剩余容量和共因；降lane和功率限制按持续吞吐损失计账。",
    param: "成功门k/n / 共因 / 倒换 / 降容比例",
  },
  {
    id: "M3",
    category: "MTTR · 检测定位",
    name: "心跳与hang检测、算子/链路遥测、自动定界",
    scope: "01–05",
    loss: [0, 2],
    condition: "检出率与定位时延按故障类型核验；误报和正常态开销另计。",
    param: "D-HARD",
  },
  {
    id: "M4",
    category: "MTTR · 恢复",
    name: "拓扑兼容备用替换、DP副本级恢复与全局升级",
    scope: "01–05",
    loss: [0, 1, 2],
    condition:
      "显式TP/PP/DP映射、有限备用、维修补回和同步协议；不能把柜等同DP副本。",
    param: "recovery",
  },
  {
    id: "M5",
    category: "回滚 / 正常态开销",
    name: "异步保存、内存暂存、增量及多层持久化检查点",
    scope: "01–06",
    loss: [1, 4],
    condition: "同时核对保存阻塞、持久化滞后、可恢复副本、加载带宽及存储共因。",
    param: "C-FAST",
  },
  {
    id: "M6",
    category: "MTTR · 正确性检测",
    name: "在线SDC校验、可信检查点选择与污染回退",
    scope: "01–05",
    loss: [1, 3, 5],
    condition: "持续运行不等于正确产出；检测与恢复后均需校验状态可信性。",
    param: "D-SDC",
  },
  {
    id: "M7",
    category: "MTTR · 亚健康处理",
    name: "慢节点/弱链路定位、隔离替换与受控降容",
    scope: "01–05",
    loss: [2, 5],
    condition: "将持续降速、限功率、误隔离和重平衡损失共同纳入。",
    param: "D-SLOW",
  },
  {
    id: "M8",
    category: "MTTR · 失败升级",
    name: "自动恢复失败后的全局重启、人工排查与修复回归",
    scope: "01–05",
    loss: [0, 1],
    condition: "区分作业恢复与硬件维修；人工兜底在自动失败后追加。",
    param: "manual",
  },
];
function parameter(stage: AnalysisStage, key: string) {
  const c = stage.configuration,
    p = c?.policy,
    m = c?.model;
  if (key.startsWith("D-"))
    return `覆盖 ${pct(p?.[key]?.coverage)} / 检测 ${num(p?.[key]?.detectSeconds)}s`;
  if (key === "recovery")
    return `成功 ${pct(m?.recoverySuccess)} / 合计 ${num(m?.recoveryAttemptSeconds)}s`;
  if (key === "C-FAST")
    return `周期 ${num(p?.[key]?.computeSeconds)}s / 阻塞 ${num(p?.[key]?.saveSeconds)}s`;
  if (key === "manual")
    return `人工追加 ${num(m?.manualAdditionalSeconds == null ? null : m.manualAdditionalSeconds / 3600)}h`;
  return "候选要求；尚无独立生效值";
}
export function lossMeasureMap(d: TopologyDecision, stage: AnalysisStage) {
  const totals = decisionLosses.map((l, i) => ({
    name: l.name,
    hours: lossHours(get(stage, "system"), i),
    measures: concreteMeasures.filter((m) => m.loss.includes(i)),
  }));
  return card(
    "损失 → 具体可靠性措施",
    `<p>本轮先定位损失，再判断措施所需资源与工程条件。图中列出优先消减方向，已计算参数和候选要求见下方明细。MTBF类减少发生/传播，MTTR类缩短检测恢复，检查点类减少回滚和开销。</p><div class="analysis-measure-map">${totals.map((t) => `<div><header><b>${t.name}</b><strong>${hours(t.hours)} h</strong></header>${t.measures.map((m) => `<span><b>${m.id}</b> <em>${m.category}</em><br/>${m.name}</span>`).join("")}</div>`).join("")}</div><details><summary>查看每项措施的分类、实际参数和成立条件</summary>${table(
      [
        "编号 / 分类",
        "具体措施 / 责任域",
        `${esc(stage.name)}冻结配置参数或候选要求`,
        "资源与工程条件",
      ],
      concreteMeasures.map((m) => [
        `${m.id}<small>${m.category}</small>`,
        `${m.name}<small>作用域 ${m.scope}</small>`,
        m.param === "FIT / 检出覆盖 / 误隔离 / 巡检开销" || m.id === "M2"
          ? "待独立评估；不叠加已计保护收益"
          : parameter(stage, m.param) +
            (m.id === "M4"
              ? "<small>基础恢复链；有限备用/PAFT动态条件待验证</small>"
              : ""),
        m.condition,
      ]),
    )}<p class="analysis-note">M1–M8是展示映射编号。参数来自冻结配置，启用能力以原输入开关为准。PAFT、跨柜冗余等具体实现需要各自适用性和资源证据，不能仅凭名称领取收益。</p></details><p class="analysis-note">六类损失共用 ${d.hours} 小时窗口；措施可能作用多类损失，收益不按行直接相加。组合增量仍用同一冻结基线与Shapley评估。</p>`,
  );
}
function detailedLoss(d: TopologyDecision, stage: AnalysisStage) {
  return card(
    "逐层损失明细与参数映射",
    table(
      ["责任域", ...decisionLosses.map((l) => l.name + " h"), "允许损失 h"],
      decisionDomains.map(([id, name]) => {
        const n = get(stage, id);
        return [
          name,
          ...decisionLosses.map(
            (_l, i) =>
              `<span class="analysis-heat" style="background:${lossFill(lossHours(n, i), d.hours)}">${hours(lossHours(n, i))}</span>`,
          ),
          hours(n.allowedHours),
        ];
      }),
    ) +
      `<p class="analysis-note">共用黄色对数色尺；格内为实际小时，损失总和与指标表守恒。正常态开销为0时仍需核对配置假设。</p>`,
  );
}
export function stageLossComparison(d: TopologyDecision, cards: number) {
  const scale = d.scales.find((s) => s.cards === cards) ?? d.scales[0];
  const gap = '<td class="analysis-stage-gap" aria-hidden="true"></td>';
  const split = (parts: string[]) => parts.join(gap);
  const cell = (n: TopologyDecisionNode, i: number, stage: string) => {
    const value = lossHours(n, i);
    return `<td data-loss-hours="${value}" data-loss-kind="${decisionLosses[i].keys.join("+")}" style="background:${lossFill(value, d.hours)}" title="${esc(stage)} · ${esc(n.name)} · ${decisionLosses[i].name} ${hours(value)} h">${hours(value)}</td>`;
  };
  const rows = [
    ...decisionDomains.map(([id, label]) => ({ id, label })),
    { id: "system", label: "全系统合计" },
  ];
  return card(
    "当前规模：三阶段逐层损失对照",
    `<p>横向比较同一责任域与损失路径；每格为 ${d.hours} 小时窗口内的损失小时。分组之间留白，三阶段共用黄色色尺。</p><div class="analysis-table-scroll"><table class="analysis-stage-matrix" aria-label="三阶段分组损失热力图"><thead><tr><th rowspan="2" scope="col">责任域</th>${split(scale.scenarios.map((s, i) => `<th colspan="7" scope="colgroup" class="analysis-stage-head stage-${i}">${esc(s.name)}<span>可用度 ${pct(get(s, "system").availability)} · 损失 ${hours(get(s, "system").actualHours)} h</span></th>`))}</tr><tr>${split(scale.scenarios.map(() => decisionLosses.map((l) => `<th scope="col">${l.name}<small>${l.mechanisms}</small></th>`).join("") + '<th scope="col">合计<br/>/ 预算</th>'))}</tr></thead><tbody>${rows
      .map(
        ({ id, label }) =>
          `<tr data-loss-domain="${id}" class="${id === "system" ? "analysis-total-row" : ""}"><th scope="row"><button type="button" data-analysis-node="${id}">${label}</button></th>${split(
            scale.scenarios.map((s) => {
              const n = get(s, id);
              return (
                decisionLosses.map((_, i) => cell(n, i, s.name)).join("") +
                `<td class="analysis-domain-total ${(n.gapHours ?? 0) > 0 ? "analysis-gap" : "analysis-within"}"><b>${hours(n.actualHours)}</b><small>/ ${hours(n.allowedHours)}</small></td>`
              );
            }),
          )}</tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><div class="analysis-heat-legend"><b>损失小时</b>${[0, 1 / 60, 0.1, 1, 10, 100, 600].map((v) => `<span style="background:${lossFill(v, d.hours)}">${v === 1 / 60 ? "1分钟" : num(v) + "h"}</span>`).join("")}<span>log(1 + 小时 / 1分钟)</span></div><p class="analysis-note">合计旁标注冻结预算；棕色表示超预算。停机含检测、恢复及失败升级；降速含局部降容；污染为窗口末仍未挽回的进度。回滚可能来自静默故障，需结合 M6 共同处理。保存/检测开销统一归06，避免跨域重复计数。</p>` +
      `<details><summary>展开三阶段关键参数与损失路径映射</summary>${table(
        ["措施 / 分类", "对应损失", ...scale.scenarios.map((s) => esc(s.name))],
        [
          [
            "M3 中断检测 · MTTR",
            "停机",
            ...scale.scenarios.map((s) => parameter(s, "D-HARD")),
          ],
          [
            "M4 自动恢复 · MTTR",
            "停机 / 回滚",
            ...scale.scenarios.map((s) => parameter(s, "recovery")),
          ],
          [
            "M5 检查点 · 回滚/开销",
            "回滚 / 保存",
            ...scale.scenarios.map((s) => parameter(s, "C-FAST")),
          ],
          [
            "M6 静默检测与排查 · 正确性",
            "回滚 / 污染",
            ...scale.scenarios.map(
              (s) =>
                parameter(s, "D-SDC") +
                "；漏检排查 " +
                num(s.configuration?.model?.sdcDelayHours) +
                "h",
            ),
          ],
          [
            "M7 亚健康处理 · MTTR",
            "降速",
            ...scale.scenarios.map((s) => parameter(s, "D-SLOW")),
          ],
          [
            "M8 失败升级 · MTTR",
            "停机",
            ...scale.scenarios.map((s) => parameter(s, "manual")),
          ],
        ],
      )}</details>`,
  );
}
function scaleComparison(d: TopologyDecision) {
  return card(
    "各规模现状与三阶段差距",
    d.scales
      .map(
        (s) =>
          `<h4>${num(s.cards, 0)}卡 · 目标 ${pct(s.target)}</h4>${table(
            [
              "阶段",
              "作业可用度 / 95%均值区间",
              "总体损失 / 预算 h",
              "首要超预算责任域",
            ],
            s.scenarios.map((stage) => {
              const r = get(stage, "system"),
                weak = domainLossSources(stage)
                  .filter((v) => v.node.gapHours != null && v.node.gapHours > 0)
                  .sort((a, b) => b.node.gapHours! - a.node.gapHours!);
              return [
                esc(stage.name),
                `${pct(r.availability)}<small>${pct(stage.statistics?.ciLow)}–${pct(stage.statistics?.ciHigh)}</small>`,
                `${hours(r.actualHours)} / ${hours(r.allowedHours)}`,
                weak[0]
                  ? `${weak[0].name} 超 ${hours(weak[0].node.gapHours)}h`
                  : "已分配责任范围内无超预算项",
              ];
            }),
          )}`,
      )
      .join("") +
      `<p class="analysis-note">各阶段是独立快照；95%区间只反映采样误差。小规模可高于目标，局部差距和总体目标分别判断。</p>`,
  );
}
function research() {
  const a = resourceAccounting(32768);
  return card(
    "近期厂商实践与技术规划 · 核查至2026-10-27",
    `<p>“已运行实践”“厂商产品披露”“未来部署规划”分别标注；公开指标只作为证据和情景参考。</p><div class="analysis-evidence">${reliabilityEvidence.map((e) => `<article><header><b>${e.name}</b><span>${e.status}</span></header><a href="${esc(e.url)}" target="_blank" rel="noreferrer">${e.source}</a><p>${e.claim}</p><p><strong>ReMAP建议：</strong>${e.recommendation}</p><small>${e.validation}</small></article>`).join("")}</div><h4>公开指标与本项目目标的口径</h4>${table(
      ["公开指标", "含义 / 分母", "在ReMAP中的使用边界"],
      [
        ["Meta中断下降99%", "相对早期峰值的改善幅度", "不等于绝对可用度99%"],
        [
          "Meta预训练>85%、RL>90% goodput",
          "厂商特定训练任务的有效产出统计",
          "与600小时干净进度指标分别记录",
        ],
        [
          "Meta >54,000 GPU·小时 MTBI",
          "中断暴露卡时口径",
          "需活动卡数、事件集合及统计周期对齐后才可比较",
        ],
        [
          "ReMAP 98.5% / 600小时",
          "正确保留进度；总损失预算9小时",
          "停机、回滚、局部降容、保存和污染共同占用预算",
        ],
      ],
    )}<h4>备用资源的分母：32,768张活动卡示例</h4>${table(["活动域", "部署域 / 总卡数", "备用占总部署", "额外卡 / 活动卡", "98.5%作业有效率对应总部署产出", "有效GPU·小时 / 600h", "等成本系数"], [[num(a.activeDomains, 0), `${num(a.deployedDomains, 0)} / ${num(a.deployedCards, 0)}`, pct(a.reserveShare), pct(a.extraRelativeToActive), pct(a.deployedNormalizedOutput), num(a.effectiveGpuHours, 0), num(a.costFactor, 3) + "×"]])}<p>计算条件：每域64活动/72部署，活动域之外增加2%域并向上取整。部署 ${num(a.deployedCards, 0)} 卡，多出 ${num(a.extraCards, 0)} 卡。约13%的备用占比与约14.92%的活动卡增配比例分母不同。</p><p class="analysis-note">这是同卡性能、线性折算的容量核算示例；未模拟备用占用/耗尽/维修补回，也不是Meta goodput复现。成本系数是总部署GPU·小时 / 有效GPU·小时，仅按每卡等成本折算，未计电力、网络和运维。正式方案还需动态验证备用占用与耗尽。</p><h4>训练并行方式的直接依据（2026）</h4><p><a href="${parallelismEvidence.url}" target="_blank" rel="noreferrer">${parallelismEvidence.source}</a>：${parallelismEvidence.use}</p><h4>下一步专题验证的成立条件</h4><p>在相同故障样本下比较全局恢复、有限备用池、DP副本恢复、再加异步检查点；需要物理故障到TP/PP/DP的映射、可替换拓扑、维修补回及持久化/恢复带宽。当前DP容量近似不能自动证明PAFT可行。</p><details><summary>补充方法基础（2024–2025）</summary>${foundationalEvidence.map((e) => `<p><a href="${e.url}" target="_blank" rel="noreferrer">${e.source}</a>：${e.use}</p>`).join("")}</details>`,
  );
}
export function analysisNodeDetail(
  stage: AnalysisStage,
  d: TopologyDecision,
  cards: number,
  id: string,
) {
  const n = get(stage, id);
  if (!n) return "";
  const descendants = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const x of stage.nodes)
      if (x.parentId && descendants.has(x.parentId) && !descendants.has(x.id)) {
        descendants.add(x.id);
        changed = true;
      }
  }
  const sources = d.estimates.filter(
    (e) =>
      e.cards === cards &&
      e.scenario === stage.name &&
      descendants.has(e.nodeId),
  );
  return card(
    `${esc(n.name)} · 来源与目标`,
    table(
      [
        "现状可用度 / 目标",
        "数量 / 全类等效FIT",
        "MTBF",
        "等效MTTR / 条件预算",
        "损失 / 允许",
      ],
      [
        [
          `${pct(n.availability)} / ${pct(n.target)}`,
          `${num(n.quantity, 0)} / ${num(n.fit)}`,
          period(n.mtbfHours),
          `${num(n.mttrSeconds, 1)} / ${num(n.targetMttrSeconds, 1)}s`,
          `${hours(n.actualHours)} / ${hours(n.allowedHours)}h`,
        ],
      ],
    ) +
      (stage.nodes.some((c) => c.parentId === id)
        ? allocationMetrics(stage, id)
        : "<p>本项为叶节点；不再重复分解预算。</p>") +
      table(
        ["故障模式", "等效FIT", "损失 h", "归属依据 / 来源"],
        sources.map((e) => [
          esc(e.eventId),
          num(e.fit),
          hours(e.lossHours),
          `${e.estimated ? "工程估算" : "源事件映射"}<small>${esc(e.method)}</small><small>${esc(e.source)}</small>`,
        ]),
      ),
  );
}
export function mechanismContributions(result: any, cards: number) {
  const studies = result.mechanismStudies ?? [];
  const entries = studies.length
    ? studies
    : (result.entries ?? [
        {
          ...result,
          name: result.name ?? result.request?.trainingScenario?.name ?? "本轮",
          round:
            result.kind === "expert-audit-experiment" ? "scenario" : "current",
        },
      ]);
  const labels: Record<string, string> = {
    fit: "M1 故障源FIT改进",
    "policy:D-HARD": "M3 中断检测",
    "model:recovery": "M4/M8 恢复链与失败升级",
    "policy:C-FAST": "M5 检查点周期与保存",
    "policy:D-SDC": "M6 静默检出",
    "model:silent": "M6 漏检后排查",
    "policy:D-SLOW": "M7 亚健康检测",
  };
  return card(
    "Shapley：各轮机制收益与对应基线",
    entries
      .map((entry: any) => {
        const attr = entry.attribution?.find((a: any) => a.cards === cards);
        if (!attr)
          return `<p>${esc(entry.name)}：未记录增量Shapley，不能从热力图差值倒推单项贡献。</p>`;
        const incremental =
          studies.length > 0 ||
          (entry.round === "scenario" &&
            result.comparisonMode !== "training-scenarios");
        const ranked = [...attr.contributions].sort(
          (a: any, b: any) => b.statistics.mean - a.statistics.mean,
        );
        const max = Math.max(
          1e-9,
          ...ranked.map((c: any) =>
            Math.max(
              Math.abs(c.statistics.mean),
              Math.abs(c.statistics.ciLow),
              Math.abs(c.statistics.ciHigh),
            ),
          ),
        );
        return `<figure class="analysis-gain-chart" aria-label="${esc(entry.name)}措施收益排序"><figcaption><b>${esc(entry.name)}</b> · ${incremental ? "相对冻结现状的改进增量" : "相对本快照固定基线的所选措施贡献"}</figcaption><p>配对 ${num(attr.trials, 0)} 条轨迹${attr.permutations ? " × " + num(attr.permutations, 0) + " 个排列" : ""}；组合增量 ${num(attr.gain * 100, 3)} pp（${num(attr.gain * (result.request?.hours ?? 600), 2)} h减损）。</p>${ranked.map((c: any, i: number) => `<div class="analysis-gain-row"><span>${i + 1}. ${esc(labels[c.id] ?? c.name ?? c.id)}</span><div class="analysis-gain-track"><i style="width:${(Math.abs(c.statistics.mean) / max) * 100}%;background:${c.statistics.mean < 0 ? "#b77946" : "#4a8a82"}"></i></div><b>${c.statistics.mean >= 0 ? "+" : ""}${num(c.statistics.mean * 100, 3)} pp<small>${num(c.statistics.mean * (result.request?.hours ?? 600), 2)} h · 95% [${num(c.statistics.ciLow * 100, 3)}, ${num(c.statistics.ciHigh * 100, 3)}]</small></b></div>`).join("")}<p class="analysis-note">${incremental ? "来源现状运行 " + esc(entry.sourceRunId) + "；增量研究独立采样，组合增量与主表跨档差值可能略有不同。" : "这是本轮已选能力的贡献，尚非现状→改进的参数增量。"} 排列采样区间未包含参数、模型及全部排列误差；区间重叠时不强判排名。</p></figure>`;
      })
      .join("") +
      '<p class="analysis-note">正值表示减少损失；负值表示增加损失。组合收益与单项分摊使用明确的冻结基线，不能跨研究重复相加。M2冗余/PAFT等未建模候选不领取收益。</p>',
  );
}

export function optimizationAdvice(
  result: any,
  d: TopologyDecision,
  cards: number,
) {
  const scale = d.scales.find((s) => s.cards === cards)!,
    last = scale.scenarios.at(-1)!;
  const root = get(last, "system"),
    weak = domainLossSources(last).filter((x) => (x.node.gapHours ?? 0) > 0);
  return card(
    "可靠性措施优化建议",
    `<p><b>先兑现已计算参数，再验证新增结构措施。</b>${esc(last.name)}整体损失 ${hours(root.actualHours)} / ${hours(root.allowedHours)} h；${weak.length ? weak.map((x) => x.name + "超预算 " + hours(x.node.gapHours) + "h").join("，") : "各责任域均在已分配预算内"}。</p>` +
      table(
        ["优先方向 / 依据", "精确情景参数或候选条件", "验收方式"],
        [
          [
            "M6 静默检测与可信恢复：同时压低回滚及污染",
            parameter(last, "D-SDC") +
              "；漏检排查 " +
              num(last.configuration?.model?.sdcDelayHours) +
              "h",
            "注入静默错误，记录检出/误报、发现延时、污染回退与干净进度。",
          ],
          [
            "M5 异步多层检查点：减少回滚与正常态开销",
            parameter(last, "C-FAST") + "；零阻塞是情景假设",
            "验证持久化滞后、共享存储故障与恢复带宽，不能仅测保存接口返回时间。",
          ],
          [
            "M3/M4/M8 检测与恢复链：决定剩余停机",
            parameter(last, "D-HARD") +
              "；" +
              parameter(last, "recovery") +
              "；" +
              parameter(last, "manual"),
            "端到端故障注入，同时检验恢复时长、成功率、失败升级尾部和状态正确性。",
          ],
          [
            "M1 故障源治理 / M7 亚健康处理：优先薄弱责任域",
            parameter(last, "D-SLOW") + "；FIT改善仍需按代际与负载校准",
            "选定中断范围MTBF与全系统MTBF分别验收；记录事件暴露卡时，避免数量与倍率重复翻倍。",
          ],
          [
            "M2 新增冗余 / 备用池 / 副本级恢复：作为下一轮候选",
            "容量门、光链路与跨域共因；TP/PP/DP映射、备用耗尽及维修补回",
            "先用RBD/BDD验证结构与容量，再以相同故障样本做DES对照；并列报告有效GPU·小时与备用成本。",
          ],
        ],
      ) +
      '<p class="analysis-note">上方排序是当前假设下的配对增量贡献，并不直接等于投入产出优先级；尚缺工程成本和能力证据。新增机制未计入当前达标结果。</p>',
  );
}

export function verificationSummary(
  result: any,
  d: TopologyDecision,
  cards: number,
) {
  const scale = d.scales.find((s) => s.cards === cards)!;
  const rows = scale.scenarios.map((s) => {
    const n = get(s, "system"),
      st = s.statistics;
    const local = domainLossSources(s)
      .filter((v) => (v.node.gapHours ?? 0) > 1e-8)
      .sort((a, b) => b.node.gapHours! - a.node.gapHours!);
    return [
      esc(s.name),
      `${pct(n.availability)} / ${pct(n.target)}`,
      st ? `${pct(st.ciLow)}–${pct(st.ciHigh)}` : "未保存",
      num(st?.n, 0),
      st?.achievementProbability == null
        ? "未保存"
        : pct(st.achievementProbability),
      n.target == null || !st
        ? "待核验"
        : st.ciLow >= n.target
          ? "均值区间高于目标"
          : st.ciHigh < n.target
            ? "未达目标"
            : "区间跨目标",
      local.length
        ? local.map((v) => `${v.name}超 ${hours(v.node.gapHours)} h`).join("；")
        : "责任域内无超预算项",
    ];
  });
  const params: [string, (s: AnalysisStage) => string][] = [
    ["M3 中断检出 / 时延", (s) => parameter(s, "D-HARD")],
    ["M7 亚健康检出 / 时延", (s) => parameter(s, "D-SLOW")],
    ["M6 静默检出 / 时延", (s) => parameter(s, "D-SDC")],
    ["M4 恢复成功 / 尝试总时长", (s) => parameter(s, "recovery")],
    ["M5 检查点周期 / 保存阻塞", (s) => parameter(s, "C-FAST")],
    ["M8 自动失败后人工追加", (s) => parameter(s, "manual")],
  ];
  const provenance = result.workflowContext?.verification;
  return (
    card(
      "DES验证结果与达成情况",
      table(
        [
          "方案",
          "可用度 / 目标",
          "均值95%采样区间",
          "轨迹数",
          "窗口达标比例",
          "总体判定",
          "局部未达项",
        ],
        rows,
      ) +
        `<p class="analysis-note">${provenance ? `独立验证：来源运行 ${esc(provenance.sourceRunId)}，种子 ${num(provenance.seed, 0)}；精确参数哈希 ${esc(provenance.parameterHash)}。` : "以下读取各方案已保存的真实DES快照；独立复核运行及种子由任务运行记录追溯。"}均值区间仅含采样误差；窗口达标比例是另一项统计，不等于均值置信度。</p>`,
    ) +
    card(
      "验证采用的精确生效参数",
      table(
        ["机制 / 参数", ...scale.scenarios.map((s) => esc(s.name))],
        params.map(([name, value]) => [name, ...scale.scenarios.map(value)]),
      ) +
        '<p class="analysis-note">参数来自各轮冻结配置；启用范围仍以原输入开关为准。恢复尝试总时长不包含另列的检测和失败升级；零保存阻塞不消除持久化滞后风险。</p>',
    ) +
    card(
      "优化或新增机制建议与验证条件",
      '<ol><li><b>优化已有检测恢复与检查点：</b>按未达责任域及停机、回滚、污染路径，选择上表参数的独立对照；保持目标和基线不变。</li><li><b>新增有限备用与副本级恢复：</b>需补充TP/PP/DP映射、拓扑可替换性、备用占用/耗尽及维修补回；当前容量等效近似不能证明PAFT能力。</li><li><b>新增跨故障域冗余与异步多层检查点：</b>BDD验证容量门与共享原因，DES验证倒换、加载带宽、持久化滞后和持续降容；在满足这些条件前保留为候选。</li></ol><p class="analysis-note">模型达标给出精确情景参数，产品能力还需测量与故障注入验证。建议不是已取得的额外收益。</p>',
    )
  );
}

/** Older snapshots without per-scale rates can omit generation-only exposure. Keep them traceable, but flag their conclusion. */
export function legacyExposureNotice(result: any) {
  const entries = result.entries ?? [result];
  return entries.some((e: any) => {
    const architecture =
      e.request?.architecture ?? result.request?.architecture;
    return e.rows?.some(
      (row: any) =>
        !row.scaleEvents &&
        architecture?.nodes?.some(
          (n: any) =>
            n.exposure && (n.exposure.multipliers?.[row.cards] ?? 1) !== 1,
        ),
    );
  })
    ? '<p class="analysis-reference" role="alert"><b>此旧快照缺少逐规模暴露率记录：</b>它可能受已确认的暴露倍率漏用问题影响，请用当前引擎重新评估。原值保留供追溯，旧达标结论暂不采用。</p>'
    : "";
}

export function analysisWorkbenchHtml(
  result: any,
  cards: number,
  view: WorkflowAnalysisView = "overview",
  stageName?: string,
  parentId = "system",
) {
  const ctx = analysisContext(result, cards, stageName);
  if (!ctx) return "";
  const { d, stage, baseline, root } = ctx;
  cards = ctx.scale.cards;
  const architecture =
    result.architectureDiagnosis?.architecture ??
    result.entries?.[0]?.architectureDiagnosis?.architecture ??
    result.request?.architecture;
  let body = "";
  if (view === "overview")
    body =
      systemMetrics(d, stage, root) +
      assessmentReading(d, stage, cards) +
      stageLossComparison(d, cards) +
      lossMeasureMap(d, stage) +
      lossSourceCharts(d, stage, cards) +
      allocationMetrics(stage) +
      allocationLogic(d, stage, baseline, cards, architecture) +
      architectureRelations(stage, ctx.scale.counts);
  if (view === "architecture")
    body =
      systemMetrics(d, stage, root) +
      architectureRelations(stage, ctx.scale.counts) +
      allocationMetrics(stage, parentId) +
      allocationLogic(d, stage, baseline, cards, architecture);
  if (view === "loss")
    body =
      stageLossComparison(d, cards) +
      lossMeasureMap(d, stage) +
      mechanismContributions(result, cards) +
      optimizationAdvice(result, d, cards) +
      `<details><summary>当前选中快照的独立损失明细</summary>${detailedLoss(d, stage)}</details>`;
  if (view === "verification") body = verificationSummary(result, d, cards);
  if (view === "scales")
    body = scaleComparison(d) + stageLossComparison(d, cards);
  if (view === "research") body = research();
  const reference = stage.trainingScenario
    ? trainingReferenceAvailability(stage.trainingScenario, cards)
    : null;
  const basis =
    reference == null
      ? ""
      : `<p class="analysis-reference">情景参考 ${pct(reference)} / 本轮计算 ${pct(root.availability)} · 差 ${num((root.availability - reference) * 100, 3)} pp。参考点未作为强制拟合输出，需核对事件与参数口径。</p>`;
  const phase =
    reliabilityStages[
      ["architecture", "overview", "loss", "verification"].indexOf(view)
    ];
  const method = phase
    ? `<div class="analysis-method"><b>${phase.name}</b><span>方法：${phase.methods}</span><p>${phase.hint}</p>${view === "overview" ? "<p>本训练结果采用逐事件离散事件仿真的正确进度损失账；RBD/BDD可用于结构成功门辅助评估，其稳态可用度单独记录。</p>" : ""}<details><summary>Agent执行依据</summary>同一个ReMAP Agent · Skill：${phase.skill} · ${phase.toolset}<br/>${phase.tools.join(" / ")}</details></div>`
    : "";
  return `<div class="reliability-analysis" data-analysis-view="${view}"><div class="analysis-snapshot-label"><b>${num(ctx.scale.cards, 0)}卡 · ${esc(stage.name)}</b><span>${ctx.scale.reference === stage.name ? "分配参照快照" : `预算沿用 ${esc(ctx.scale.reference)}`} · ${d.hours}小时</span></div>${legacyExposureNotice(result)}${method}${basis}${body}</div>`;
}

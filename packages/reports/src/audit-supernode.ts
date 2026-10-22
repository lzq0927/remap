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
    : n.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const pct = (n: number | null | undefined) =>
  n == null ? "待评估" : (n * 100).toFixed(4) + "%";

/** A reference projection must not misrepresent a user-edited containment tree. */
export function supportsSupernodeDiagram(a: AuditAtlas) {
  const expected = {
    "hardware-supernode": "hardware-pod",
    "hardware-rack": "hardware-supernode",
    "hardware-node": "hardware-rack",
    "hardware-board": "hardware-node",
    "hardware-module": "hardware-board",
    "hardware-chip": "hardware-module",
    "hardware-scaleup": "hardware-network",
    "hardware-scaleout": "hardware-network",
    "hardware-optics": "hardware-network",
    "object-BOXIO": "hardware-scaleup",
    "object-FABRIC": "hardware-scaleout",
    "object-OPT": "hardware-optics",
  };
  return (
    !!a.architecture.topology &&
    Object.entries(expected).every(
      ([id, parent]) => a.nodes.find((n) => n.id === id)?.parentId === parent,
    )
  );
}

export function supernodeMetricLines(n: AtlasNode, pure: boolean) {
  if (pure) return [`数量 ${num(n.quantity)}`, "组成、连接与故障归属可编辑"];
  return [
    `数量 ${n.kind === "overhead" ? "不适用" : num(n.quantity)} · 等效FIT ${n.kind === "overhead" ? "不适用" : num(n.npuEquivalentFit)}`,
    `区域总事件FIT ${n.kind === "overhead" ? "不适用" : num(n.aggregateEventFit)}`,
    `可用度 ${pct(n.attributedAvailability)} / 目标 ${pct(n.targetAvailability)}`,
    n.coverageStatus !== "modeled"
      ? "含待补故障 · 已建模部分"
      : `损失 ${num(n.actualHours)} h · 预算 ${num(n.allowedHours)} h`,
  ];
}

/** Aggregate network diagram, not a claim of calibrated ports, routes or redundancy. */
export function supernodeSvg(a: AuditAtlas, options: AtlasViewOptions = {}) {
  const t = a.architecture.topology,
    q = a.topologySummary;
  if (!t || !q || !supportsSupernodeDiagram(a)) return "";
  const pure = options.metric === "structure";
  const markerId =
    `${options.idPrefix ?? `supernode-${a.cards}-${options.metric ?? "summary"}`}-arrow`.replace(
      /[^a-zA-Z0-9_-]/g,
      "-",
    );
  const nodes = a.nodes;
  const card = (
    id: string,
    title: string,
    x: number,
    y: number,
    w: number,
    color: string,
  ) => {
    const n = nodes.find((n) => n.id === id);
    if (!n) return "";
    const lines =
      w < 400 && !pure
        ? [
            `数量 ${n.kind === "overhead" ? "不适用" : num(n.quantity)} · ${n.kind === "overhead" ? "公共开销" : n.coverageStatus === "modeled" ? "已有故障模型" : "故障数据待补"}`,
            `等效FIT ${n.kind === "overhead" ? "不适用" : num(n.npuEquivalentFit)}`,
            `总事件FIT ${n.kind === "overhead" ? "不适用" : num(n.aggregateEventFit)}`,
            `可用度 ${pct(n.attributedAvailability)}`,
            `分层目标 ${pct(n.targetAvailability)}`,
          ]
        : supernodeMetricLines(n, pure);
    const selected =
      !options.query ||
      [n.name, n.id, ...n.eventIds]
        .join(" ")
        .toLowerCase()
        .includes(options.query.toLowerCase());
    return `<g data-atlas-node="${esc(id)}" role="button" tabindex="0" aria-label="${esc(n.name)}" opacity="${selected ? 1 : 0.32}">
    <rect x="${x}" y="${y}" width="${w}" height="132" rx="12" fill="${color}" stroke="#b4c8d6"/>
    <title>${esc(n.name + "；" + lines.join("；") + (pure ? "" : "；" + n.source))}</title>
    <text x="${x + 14}" y="${y + 26}" font-size="17" font-weight="700" fill="#193d50">${esc(title)}</text>
    ${lines.map((v, i) => `<text x="${x + 14}" y="${y + 49 + i * (w < 400 ? 18 : 22)}" font-size="12" fill="#425d6c">${esc(v)}</text>`).join("")}</g>`;
  };
  const down = (x: number, y: number, label: string) =>
    `<path d="M${x} ${y}v24" stroke="#789aac" stroke-width="2" marker-end="url(#${markerId})"/><text x="${x + 10}" y="${y + 17}" font-size="11" fill="#526e7c">${esc(label)}</text>`;
  const connector = (
    path: string,
    label: string,
    x: number,
    y: number,
    from: string,
    to: string,
  ) =>
    options.links === false ||
    !a.architecture.dependencies.some((e) => e.from === from && e.to === to)
      ? ""
      : `<path d="${path}" stroke="#4b80b0" stroke-width="2.3" fill="none" marker-end="url(#${markerId})"/><text x="${x}" y="${y}" font-size="12" fill="#38678d">${esc(label)}</text>`;
  const root = nodes.find((n) => !n.parentId)!;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1540" height="1510" viewBox="0 0 1540 1510" role="img" aria-label="超节点组网拓扑" style="font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif">
  <defs><marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#5685a3"/></marker></defs>
  <rect width="1540" height="1510" fill="#f7fafc"/>
  <text x="28" y="36" font-size="24" font-weight="700" fill="#193d50">超节点组网 · ${num(a.cards)}卡 · ${pure ? "纯架构" : "数量 / FIT / 可用度"}</text>
  <text x="28" y="64" font-size="13" fill="#587382">${t.cardsPerSupernode}卡/超节点参考 · 分组密度为工程假设 · 网络设备数量依据所填端口/BOM配置</text>
  <rect x="28" y="86" width="1484" height="102" rx="14" fill="#e5eff6" stroke="#a6c2d5"/>
  <text x="46" y="116" font-size="18" font-weight="700" fill="#193d50">公式参考 ${num(q.cards)}卡 · ${q.supernodes}个超节点 · ${q.pods}个Pod分组 · ${q.racks}个使用中机柜</text>
  <text x="46" y="144" font-size="14" fill="#425d6c">${q.fullSupernodes}个满超节点${q.tailCards ? ` + 尾部${q.tailCards}卡` : ""}；按整超节点预留容量 ${num(q.provisionedCards)}卡，闲置容量不自动计入故障暴露</text>
  <text x="46" y="169" font-size="14" fill="#425d6c">${pure ? "计算包含关系与超节点内/间连接示意；不表示已经验证冗余或路径可达性。" : `总体可用度 ${pct(root.attributedAvailability)} / 目标 ${pct(root.targetAvailability)}；区域分层百分比为系统损失责任投影。`}</text>
  <rect x="28" y="215" width="510" height="1174" rx="16" fill="#eff7f3" stroke="#c0dacb"/>
  <text x="48" y="245" font-size="18" font-weight="700" fill="#244f40">计算层 · 代表性组成逐层展开</text>
  ${card("hardware-pod", "Pod / 分组", 48, 264, 470, "#e4f3eb")}
  ${down(280, 396, `每组至多${t.supernodesPerPod}超节点`)}
  ${card("hardware-supernode", "超节点 / 网络性能域", 48, 422, 470, "#e4f3eb")}
  ${down(280, 554, `每超节点${t.cardsPerSupernode / t.cardsPerRack}柜`)}
  ${card("hardware-rack", "机柜", 48, 580, 470, "#e4f3eb")}
  ${down(280, 712, `每柜${t.cardsPerRack / t.cardsPerNode}节点`)}
  ${card("hardware-node", "计算节点 / 框", 48, 738, 470, "#e4f3eb")}
  ${down(280, 870, `每节点${t.cardsPerNode / t.cardsPerBoard}板`)}
  ${card("hardware-board", "计算板", 48, 896, 470, "#e4f3eb")}
  ${down(280, 1028, `每板${t.cardsPerBoard}张评估卡`)}
  ${card("hardware-module", "NPU模组 / 评估卡", 48, 1054, 470, "#e4f3eb")}
  ${down(280, 1186, "默认1卡对应1NPU，封装需校准")}
  ${card("hardware-chip", "NPU芯片 · 点击下钻Core / SRAM / IOD", 48, 1212, 470, "#d7ecdf")}
  <rect x="570" y="215" width="600" height="1174" rx="16" fill="#eff4fc" stroke="#c0cede"/>
  <text x="590" y="245" font-size="18" font-weight="700" fill="#2c4f78">网络层 · 性能域内与跨域分别建模</text>
  ${card("hardware-scaleup", "超节点内高速互联 / Scale-up", 590, 264, 560, "#e2ecfc")}
  ${card("object-BOXIO", "接入 / 板柜内交换对象组", 590, 422, 560, "#edf2fb")}
  ${connector("M518 1278H552V330H578", "NPU互联", 540, 320, "hardware-chip", "hardware-scaleup")}
  ${connector("M875 554V588", "超节点出口，端口/介质待确认", 890, 575, "hardware-scaleup", "hardware-scaleout")}
  ${card("hardware-scaleout", "超节点间扩展网络 / Scale-out", 590, 600, 560, "#e2ecfc")}
  ${card("hardware-leaf-extra", "Leaf接入交换机（待校准）", 590, 758, 560, "#edf2fb")}
  ${connector("M870 890V914", "参考连接，端口与冗余需核对", 890, 907, "hardware-leaf-extra", "object-FABRIC")}
  ${card("object-FABRIC", "Spine / 集群互联对象组", 590, 922, 560, "#edf2fb")}
  ${card("object-OPT", "光模块 / 光链路端点", 590, 1212, 560, "#e2ecfc")}
  ${connector("M875 1198V1054", "光链路支撑（非Spine串联子层）", 890, 1138, "hardware-optics", "hardware-scaleout")}
  ${card("hardware-storage", "存储层", 1202, 264, 310, "#fff0d3")}
  ${card("hardware-facility", "供电 / 冷却 / 管理", 1202, 600, 310, "#e9edf1")}
  ${card("hardware-other", "软件与未归因", 1202, 922, 310, "#f0ebf7")}
  ${card("overhead", "保存与检测开销", 1202, 1212, 310, "#f6e7db")}
  ${connector("M1150 666H1184V330H1190", "存储访问", 1250, 425, "hardware-scaleout", "hardware-storage")}
  <text x="28" y="1420" font-size="13" fill="#486473">${pure ? "点击区域进入组成、故障模式、机制与证据；数量按当前配置推导。" : "等效FIT按每NPU业务影响口径；区域总事件FIT = 等效FIT × 实际卡数，含多类故障，不是业务中断频率。"}</text>
  <text x="28" y="1446" font-size="13" fill="#486473">${pure ? "未填设备数量显示待补充；未核实的板柜密度不作为官方BOM。" : "可用度 = 1 − 区域已建模损失 / 评估窗口；分层目标同理由预算推导，父子层不可重复相加或直接连乘。"}</text>
  <text x="28" y="1472" font-size="13" fill="#486473">未建模故障显示未知；后续沿此架构做目标分配 → 故障薄弱点 → 机制映射 → Shapley / AGREE → 独立复评。</text>
  <text x="28" y="1496" font-size="12" fill="#486473">${a.evaluated ? `保存结果 · 窗口 ${num(a.provenance.hours)} h · 主采样 ${num(a.provenance.statistics?.n ?? a.provenance.trials)} 次；区间见报告，结果不等同现场实测。` : "配置预览：当前可用度待独立计算；参考容量与BOM须按项目资料校准。"}</text>
  </svg>`;
}

export function supernodeSummaryHtml(a: AuditAtlas) {
  if (!a.architecture.topology) return "";
  const regions = [
    "system",
    "domain-1",
    "hardware-scaleup",
    "hardware-scaleout",
    "hardware-optics",
    "hardware-storage",
    "hardware-facility",
    "hardware-other",
    "overhead",
  ];
  const rows = regions
    .map((id) => a.nodes.find((n) => n.id === id))
    .filter((n): n is AtlasNode => !!n);
  return `<section data-supernode="summary"><h4>区域数量、FIT与可用度对应</h4><p>区域总事件FIT为输入事件强度，不是单器件物理FIT；可用度为已建模损失责任投影。未知故障不视为零风险，父子区域不重复相加。</p><div class="atlas-table-wrap"><table><thead><tr><th>区域</th><th>数量</th><th>NPU等效FIT</th><th>区域总事件FIT</th><th>分层目标</th><th>当前可用度</th><th>故障/机制</th></tr></thead><tbody>${rows.map((n) => `<tr><td>${esc(n.name)}</td><td>${num(n.quantity)}</td><td>${num(n.npuEquivalentFit)}</td><td>${num(n.aggregateEventFit)}</td><td>${pct(n.targetAvailability)}</td><td>${pct(n.attributedAvailability)}${n.coverageStatus !== "modeled" ? "（数据不完整）" : ""}</td><td>${n.eventIds.length} / ${n.mechanismIds.length}（含候选）</td></tr>`).join("")}</tbody></table></div><details><summary>超节点参考配置与数量来源</summary><p>${esc(a.architecture.topology.source)}</p><p>数量显式覆盖优先，随后按拓扑公式推导；闲置整超节点容量与实际使用数量分开，不自动增加故障率。光模块数=2×（节点数×已填每节点光链路+超节点数×已填跨域光链路），其他链路需按清单另补。</p></details></section>`;
}

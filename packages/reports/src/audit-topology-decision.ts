import {
  topologyDecision,
  type TopologyDecision,
} from "../../analysis/src/audit-topology-decision";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const node = (
  s: TopologyDecision["scales"][number]["scenarios"][number],
  id: string,
) => s.nodes.find((n) => n.id === id)!;
export { decisionPageSvg as topologyDecisionSvg } from "./audit-decision-pages";

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

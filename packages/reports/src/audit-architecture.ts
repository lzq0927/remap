import { auditExtensionCatalog } from "../../contracts/src/audit-extensions";
import type { AuditArchitectureDiagnosis } from "../../analysis/src/audit-architecture";
import type { AuditArchitecture } from "../../contracts/src/audit-architecture";
import { auditMechanismNames } from "../../contracts/src/audit-mechanism-view";
import type { AuditSection } from "./audit";
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const num = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "—"
    : (Math.abs(v) < 1e-9 ? 0 : v).toLocaleString("zh-CN", {
        maximumFractionDigits:
          Math.abs(v) > 1e-9 && Math.abs(v) < Math.pow(10, -digits)
            ? Math.max(6, digits)
            : digits,
      });
const pct = (v: number) => num(v * 100) + "%";
const scaleName = (cards: number) =>
  cards >= 10000 ? num(cards / 10000) + "万卡" : num(cards) + "卡";

export function architectureTree(
  architecture: AuditArchitecture,
  diagnosis?: AuditArchitectureDiagnosis,
  cards?: number,
  maxDepth = 10,
) {
  const scale = diagnosis?.scales.find((s) => s.cards === cards);
  const children = (id: string) =>
    architecture.nodes.filter((n) => n.parentId === id);
  const root = architecture.nodes.find((n) => !n.parentId)!;
  const render = (id: string, depth: number): string => {
    const n = architecture.nodes.find((n) => n.id === id)!;
    const measured = scale?.nodes.find((c) => c.id === id);
    const state =
      measured?.excessHours === null || !measured
        ? "pending"
        : measured.excessHours > 0
          ? "gap"
          : "within";
    const nested = children(id);
    const visibleChildren = depth < maxDepth ? nested : [];
    return `<div class="arch-branch depth-${depth}"><div class="arch-node ${state}"><b>${esc(n.name)}</b>${measured ? `<span>损失 ${num(measured.actualHours)} h · ${pct(measured.lossFraction)}</span><small>预算 ${measured.allowedHours === null ? "未分配" : num(measured.allowedHours) + " h"} · ${measured.kind === "overhead" ? "公共开销" : "FIT " + num(measured.fit)}</small>` : `<small>${nested.length ? nested.length + " 个下级" : n.eventIds.length + " 类故障模式"}</small>`}</div>${visibleChildren.length ? `<span class="arch-arrow" aria-hidden="true">↓</span><div class="arch-children">${visibleChildren.map((c) => render(c.id, depth + 1)).join("")}</div>` : ""}</div>`;
  };
  return `<div class="arch-tree" role="group" aria-label="系统分层架构图">${render(root.id, 0)}</div>${architecture.dependencies.length ? `<div class="arch-dependencies"><b>共同依赖关系</b>${architecture.dependencies.map((d) => `<p>${esc(architecture.nodes.find((n) => n.id === d.from)?.name)} → ${esc(architecture.nodes.find((n) => n.id === d.to)?.name)}：${esc(d.label)} <small>依据：${esc(d.source)}</small></p>`).join("")}</div>` : ""}`;
}

export function architectureHeatmap(
  d: AuditArchitectureDiagnosis,
  level: "subsystem" | "leaf" = "subsystem",
) {
  const root = d.architecture.nodes.find((n) => !n.parentId)!;
  const branches = d.architecture.nodes.filter((n) =>
    level === "subsystem"
      ? n.parentId === root.id
      : !d.architecture.nodes.some((c) => c.parentId === n.id),
  );
  return `<div class="arch-chart"><h3>${level === "leaf" ? "故障对象的跨规模损失与目标差距" : "各规模的分层损失与目标差距"}</h3><p class="note">${level === "leaf" ? "叶层对象" : "同级子系统"}互斥汇总；单元格为实际损失 / 允许损失（小时）。橙色为超出分层预算，绿色为预算内；未分配时按损失大小定位。</p><div class="table-wrap" tabindex="0"><table class="arch-heatmap"><thead><tr><th>${level === "leaf" ? "故障对象" : "子系统"}</th>${d.scales.map((s) => `<th>${scaleName(s.cards)}<small>${s.referenceOnly ? "参考点" : "目标 " + pct(s.target)}</small></th>`).join("")}</tr></thead><tbody>${branches
    .map(
      (n) =>
        `<tr><th>${esc(n.name)}</th>${d.scales
          .map((s) => {
            const item = s.nodes.find((i) => i.id === n.id)!;
            return `<td class="${item.excessHours === null ? "pending" : item.excessHours > 0 ? "gap" : "within"}"><b>${num(item.actualHours)} / ${num(item.allowedHours)}</b><small>${item.excessHours === null ? "未分配" : (item.excessHours > 0 ? "超出 " : "余量 ") + num(Math.abs(item.excessHours)) + " h"}</small></td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div></div>`;
}

export function architectureRankings(d: AuditArchitectureDiagnosis) {
  const scales = d.scales.filter((s) => s.ranking.length);
  const max = Math.max(
    1e-9,
    ...scales.flatMap((s) =>
      s.ranking.map((c: any) => Math.abs(c.statistics.mean)),
    ),
  );
  return `<div class="arch-chart"><h3>不同规模的措施贡献排序</h3><p class="note">${d.version.includes("incremental") ? "本次改进相对冻结第一轮的增量贡献。" : "现有候选措施相对固定基线的Shapley贡献。"}统一条形刻度，单位为百分点；保留负贡献。现有贡献不等于继续改善该项的边际收益。</p>${scales.length ? `<div class="arch-ranking-grid">${scales.map((s) => `<div class="arch-ranking"><h4>${scaleName(s.cards)}</h4>${s.ranking.map((c: any) => `<div class="arch-rank-row"><span>${c.rank}. ${esc(c.name)}</span><b>${num(c.statistics.mean * 100)} pp</b><div class="arch-track"><i style="width:${Math.min(100, (Math.abs(c.statistics.mean) / max) * 100)}%;background:${c.statistics.mean < 0 ? "#ab5945" : "#237b6a"}"></i></div><small>95%区间 ${num(c.statistics.ciLow * 100)} ～ ${num(c.statistics.ciHigh * 100)} pp</small></div>`).join("")}</div>`).join("")}</div>` : '<p class="note">本次未计算措施贡献；不能据此推断收益可加或生成贡献排序。</p>'}</div>`;
}

export function architectureScaleDetail(
  d: AuditArchitectureDiagnosis,
  cards: number,
  includeTree = true,
  expandObjects = false,
) {
  const scale = d.scales.find((s) => s.cards === cards)!;
  const top = scale.weaknesses[0];
  return `<div class="arch-scale-detail"><div class="arch-conclusion"><b>${scaleName(cards)} · ${scale.referenceOnly ? "参考规模" : "目标 " + pct(scale.target)}</b><p>本轮可用度 ${pct(scale.statistics.mean)}；损失 ${num(scale.actualHours)} h，预算 ${num(scale.allowedHours)} h。${top ? "首要核查：" + esc(top.name) + "，主要损失为" + esc(top.focus) + "；" + esc(top.action) + "。" : "本次样本未观察到事件损失；仍需核对暴露量与常态开销。"}</p><small>损失账汇总残差 ${num(scale.residualHours, 9)} h${Math.abs(scale.residualHours) > 1e-6 ? " · 数据账不一致，请复核，不能据此确认分层结论" : " · 父子汇总与总损失一致"}</small></div><details class="arch-evidence"><summary>本规模薄弱点排序与改善方向（前5项）</summary><p class="note">按叶层超预算排序，未分配时按实际损失排序；这是样本诊断，不能仅凭高FIT或低频样本判定风险。</p><div class="table-wrap"><table><thead><tr><th>排名</th><th>对象</th><th>实际 / 允许损失 h</th><th>主要损失</th><th>改善方向</th></tr></thead><tbody>${scale.weaknesses
    .slice(0, 5)
    .map(
      (w) =>
        `<tr><td>${w.rank}</td><th>${esc(w.name)}</th><td>${num(w.lossHours)} / ${num(scale.nodes.find((n) => n.id === w.id)?.allowedHours)}</td><td>${esc(w.focus)}</td><td>${esc(w.action)}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div></details>${includeTree ? architectureTree(d.architecture, d, cards, expandObjects ? 10 : 1) : ""}<details class="arch-evidence"><summary>展开各层MTBF、恢复与损失明细</summary><div class="table-wrap" tabindex="0"><table><thead><tr><th>层级 / 对象</th><th>目标损失 / h</th><th>实际损失 / h</th><th>中断MTBF / h</th><th>亚健康间隔 / h</th><th>静默间隔 / h</th><th>恢复停机 / 次（秒）</th><th>等效损失 / 事件（秒）</th><th>薄弱环节与改善方向</th></tr></thead><tbody>${scale.nodes.map((n) => `<tr><td>${esc(n.name)}<small>${n.leaf ? "叶层" : "汇总层"} · FIT ${num(n.fit)}</small></td><td>${num(n.allowedHours)}</td><td>${num(n.actualHours)}<small>${n.excessHours === null ? "未分配" : (n.excessHours > 0 ? "超出 " : "余量 ") + num(Math.abs(n.excessHours)) + " h"}</small></td>${n.types.map((t) => `<td>${num(t.intervalHours)}<small>FIT ${num(t.fit)}</small></td>`).join("")}<td>${num(n.recoveryPauseSeconds)}</td><td>${num(n.equivalentLossSeconds)}</td><td>${esc(n.focus)}<small>${esc(n.action)}</small></td></tr>`).join("")}</tbody></table></div></details><details class="arch-evidence"><summary>展开故障、措施覆盖与参数依据</summary>${scale.nodes
    .filter((n) => n.leaf)
    .map(
      (n) =>
        `<details><summary>${esc(n.name)} · ${num(n.actualHours)} h</summary><p>现有适用措施：${n.mechanisms.map((id) => esc(auditMechanismNames[id] ?? auditExtensionCatalog.find((m) => m.id === id)?.name ?? id)).join("、") || "无已选附加措施；保留基础恢复链"}。</p><p>${esc(n.source)}</p>${n.drivers.map((e) => `<p><b>${esc(e.id)}</b> · FIT ${num(e.fit, 6)} · 损失 ${num(e.lossHours)} h <small>来源：${esc(e.source)}</small></p>`).join("")}<p>专家库中可进一步核对的候选方向（未计入本轮收益）：${n.extensions.map((e) => esc(e.id) + " " + esc(e.name)).join("；") || "需补充适用机制与证据"}。</p></details>`,
    )
    .join("")}</details></div>`;
}

export function architectureReport(result: any) {
  const d: AuditArchitectureDiagnosis | undefined =
    result.architectureDiagnosis;
  if (!d) return "<p>本历史结果未保存分层诊断；原结果与口径保持不变。</p>";
  return `<div class="architecture-diagnosis"><p class="note">${esc(d.architecture.basis)}</p>${architectureHeatmap(d)}<details class="arch-evidence"><summary>展开故障对象的跨规模差距</summary>${architectureHeatmap(d, "leaf")}</details>${architectureRankings(d)}${d.scales.map((s) => `<details class="arch-scale-panel" ${s.cards === result.request.cards ? "open" : ""}><summary>${scaleName(s.cards)} · 分层目标、MTBF与恢复损失诊断</summary>${architectureScaleDetail(d, s.cards, true, true)}</details>`).join("")}<details class="arch-evidence"><summary>分层方法、计量与适用边界</summary>${d.notes.map((note) => `<p>${esc(note)}</p>`).join("")}</details></div>`;
}
export function architectureSections(result: any): AuditSection[] {
  if (!result.architectureDiagnosis) return [];
  return [
    {
      title:
        result.kind === "expert-audit-experiment"
          ? "本次方案分层诊断"
          : result.kind === "expert-audit-plan"
            ? "第一轮分层诊断与改进责任来源"
            : "系统分层目标与现状诊断",
      visual: "architecture",
      paragraphs: [
        "从各规模总体目标出发，按架构查看分层损失预算，再用原故障模式与现有机制计算现状。分层目标为诊断参照，不修改第一轮FIT或措施参数；图中的父子关系不自动转化为串并联可靠性假设。",
      ],
    },
  ];
}

export function architectureMarkdown(result: any) {
  const d: AuditArchitectureDiagnosis | undefined =
    result.architectureDiagnosis;
  if (!d) return "";
  const cell = (v: unknown) =>
    esc(v).replaceAll("|", "\\|").replaceAll("\n", " ");
  const table = (heads: string[], rows: unknown[][]) =>
    "| " +
    heads.map(cell).join(" | ") +
    " |\n| " +
    heads.map(() => "---").join(" | ") +
    " |\n" +
    rows.map((row) => "| " + row.map(cell).join(" | ") + " |").join("\n");
  return (
    "\n\n" +
    cell(d.architecture.basis) +
    "\n\n" +
    d.scales
      .map((scale) => {
        const rows = scale.nodes.map((n) => [
          n.name,
          n.parentId
            ? d.architecture.nodes.find((p) => p.id === n.parentId)?.name
            : "系统根",
          num(n.fit),
          num(n.allowedHours),
          num(n.actualHours),
          num(n.excessHours),
          ...n.types.map((t) => num(t.intervalHours)),
          num(n.recoveryPauseSeconds),
          num(n.equivalentLossSeconds),
          n.focus,
          n.action,
        ]);
        return (
          "### " +
          scaleName(scale.cards) +
          " · 分层目标与现状\n\n" +
          table(
            [
              "层级 / 对象",
              "父级",
              "FIT",
              "允许损失 h",
              "实际损失 h",
              "超预算 h",
              "中断MTBF h",
              "亚健康间隔 h",
              "静默间隔 h",
              "恢复停机/次 s",
              "等效损失/事件 s",
              "薄弱环节",
              "改善方向",
            ],
            rows,
          ) +
          "\n\n" +
          table(
            ["排名", "措施", "Shapley pp", "95%区间 pp"],
            scale.ranking.map((c: any) => [
              c.rank,
              c.name,
              num(c.statistics.mean * 100),
              num(c.statistics.ciLow * 100) +
                " ～ " +
                num(c.statistics.ciHigh * 100),
            ]),
          )
        );
      })
      .join("\n\n") +
    "\n\n" +
    d.notes.join("\n\n")
  );
}

export const architectureCss = `
.architecture-diagnosis,.audit-architecture-editor{min-width:0;scroll-margin-top:calc(var(--workflow-navigation-height,150px) + 15px)}.arch-tree{padding:18px 0}.arch-branch{min-width:0;text-align:center}.arch-node{padding:12px;border:1px solid #d2ded7;border-top:3px solid #387968;border-radius:8px;background:#f2f7f3;overflow-wrap:anywhere}.arch-node b,.arch-node span,.arch-node small{display:block}.arch-node b{font-size:14px}.arch-node span{font-size:12px;margin:6px 0}.arch-node small{font-size:11px;color:#526c61;line-height:1.7}.arch-arrow{display:block;color:#718e81;line-height:24px}.arch-children{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px}.arch-children .arch-children{display:flex;flex-direction:column;gap:8px;border-left:1px solid #c9d8ce;padding-left:9px}.arch-node.gap{border-top-color:#c57f40;background:#fff7ec}.arch-node.within{border-top-color:#29826b}.arch-node.pending{border-top-color:#87958b}.arch-chart{margin:24px 0}.arch-heatmap{font-variant-numeric:tabular-nums}.arch-heatmap td,.arch-heatmap th{min-width:132px}.architecture-diagnosis td small,.architecture-diagnosis th small{display:block;font-weight:400;font-size:11px;margin-top:5px;line-height:1.7}.arch-heatmap td.gap{background:#fff2e0;color:#875219}.arch-heatmap td.within{background:#e8f4ee;color:#22624e}.arch-heatmap td.pending{background:#f0f2ee;color:#54655a}.arch-ranking-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.arch-ranking{padding:16px;border:1px solid #dce6df;border-radius:8px;background:#fafcf9}.arch-ranking h4{margin:0 0 12px}.arch-rank-row{display:grid;grid-template-columns:1fr auto;gap:5px 12px;margin:14px 0;font-size:12px}.arch-rank-row span{overflow-wrap:anywhere}.arch-rank-row b{font-variant-numeric:tabular-nums}.arch-track{grid-column:1/-1;height:7px;border-radius:4px;background:#e8eee8;overflow:hidden}.arch-track i{display:block;height:100%}.arch-rank-row small{grid-column:1/-1;color:#657b6d}.arch-conclusion{padding:16px;background:#edf5ef;border-left:3px solid #2d806b;border-radius:6px;margin:12px 0}.arch-conclusion p{font-size:13px;margin:8px 0}.arch-conclusion small{font-size:11px}.arch-scale-panel,.arch-evidence{border:1px solid #dde7df;border-radius:8px;padding:8px 14px;margin:14px 0}.arch-evidence p{font-size:12px;overflow-wrap:anywhere}.arch-evidence small{display:block}.arch-dependencies{border-left:2px dashed #86a08d;padding-left:14px;text-align:left}.arch-dependencies p{font-size:12px}.arch-dependencies small{display:block}.architecture-diagnosis .table-wrap table{min-width:1050px}.architecture-diagnosis .arch-heatmap{min-width:650px}.architecture-diagnosis td:last-child{min-width:190px}.arch-editor-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.arch-editor-table input,.arch-editor-table select{min-width:95px;max-width:220px}.arch-editor-table input[type=number]{width:95px}.arch-editor-table td{min-width:100px}.arch-editor-table label{font-size:12px}.arch-budget-table{min-width:650px}.arch-short-note{font-size:12px;color:#627568}.arch-toggle{display:flex!important;flex-direction:row!important;align-items:center;justify-content:flex-start;gap:8px;font-size:12px;margin:12px 0}.arch-toggle input[type=checkbox]{width:16px;height:16px;flex:0 0 16px;margin:0}.arch-brief{padding:12px 16px;background:#f2f6f1;border-radius:8px;font-size:13px}.arch-brief button{margin-top:8px}
@media(max-width:650px){.arch-children{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.arch-node{padding:10px 6px}.arch-node b{font-size:12px}.arch-ranking-grid{grid-template-columns:1fr}.arch-conclusion{padding:12px}.arch-rank-row{font-size:11px}.arch-evidence{padding:6px 10px}.arch-editor-actions button{flex:1}.arch-children .arch-children{padding-left:5px}}
@media print{.arch-node,.arch-heatmap td,.arch-track i{print-color-adjust:exact;-webkit-print-color-adjust:exact}.arch-ranking-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.arch-ranking{break-inside:avoid}.arch-tree{break-inside:avoid}.architecture-diagnosis .table-wrap table{min-width:0;width:100%}.architecture-diagnosis td:last-child{min-width:0}.arch-scale-panel{break-before:auto}.arch-evidence{font-size:10px}}
`;

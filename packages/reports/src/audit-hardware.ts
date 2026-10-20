import type { AuditArchitectureDiagnosis } from "../../analysis/src/audit-architecture";
import { architectureLossNames } from "../../analysis/src/audit-architecture";
import { auditMechanismNames } from "../../contracts/src/audit-mechanism-view";
import { auditExtensionCatalog } from "../../contracts/src/audit-extensions";
import {
  orderedDiagnosisScales,
  summaryEscape as esc,
  summaryNumber as num,
  summaryScaleLabel as label,
} from "./audit-scale-summary";

export const hardwareCss = `
.hardware-panel{margin:18px 0;padding:16px;border:1px solid #d3e2dc;border-radius:12px;background:#f8fbf9;min-width:0}
.hardware-panel h4{margin:0 0 12px}.hardware-panel .table-wrap{overflow:auto;max-width:100%}
.hardware-panel table{border-collapse:collapse;width:100%;min-width:620px}
.hardware-panel td,.hardware-panel th{padding:10px;text-align:left;border-bottom:1px solid #dce5df;vertical-align:top}
.hardware-panel small{display:block;font-size:11px;color:#526a60;margin-top:5px;overflow-wrap:anywhere}
.hardware-panel td.unknown{background:#edf0ef;color:#64746b}.hardware-chain{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.hardware-chain b{padding:7px 10px;background:#e4f0e9;border-radius:5px;font-size:12px}.hardware-chain span{color:#648478}
.hardware-numbers{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px}
.hardware-numbers>div{padding:12px;background:white;border:1px solid #dae6df;border-radius:6px}
.hardware-numbers strong{display:block;font-size:19px;color:#235e50;margin:6px 0}
.hardware-edit-form{padding:12px 0;display:grid;gap:12px;min-width:0}
.hardware-edit-form .fields{margin:0}.hardware-edit-form label{min-width:0}
.hardware-edit-form input,.hardware-edit-form select{max-width:100%;box-sizing:border-box}
.hardware-path-editor{padding-left:22px}.hardware-path-editor li{margin:8px 0}
.hardware-path-editor select{max-width:60%}.hardware-path-editor button{margin-left:8px}
.hardware-nav{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0}
.hardware-scatter{min-width:650px;width:100%;height:auto;display:block}
.hardware-focus .arch-node[data-node-id]{cursor:pointer}.hardware-focus .arch-node[data-node-id]:hover{outline:2px solid #458c75}
@media print{.hardware-panel td{print-color-adjust:exact}.hardware-panel table{min-width:0}.hardware-scatter{min-width:0}}
`;
function focusedNodes(
  d: AuditArchitectureDiagnosis,
  cards: number,
  focus: string,
) {
  const s = d.scales.find((v) => v.cards === cards)!;
  const children = s.nodes.filter((n) => n.parentId === focus);
  return children.length ? children : s.nodes.filter((n) => n.id === focus);
}
export function hardwareInventorySummary(d: AuditArchitectureDiagnosis) {
  const scales = orderedDiagnosisScales(d, true);
  const rows = d.architecture.nodes.filter(
    (n) =>
      n.parentId &&
      n.kind !== "overhead" &&
      (n.hardwareLevel || n.inventory || n.rateModel),
  );
  return `<div class="hardware-panel"><h4>并列规模的硬件组成与数量</h4><p class="note">数量为空表示待补充。总数量优先于上级组成比例；计数包含在父子关系中，不将各层数量或FIT再次相加。</p><div class="table-wrap"><table data-hardware="inventory"><thead><tr><th>硬件对象 / 事件率口径</th>${scales.map((s) => `<th>${label(s.cards)}</th>`).join("")}<th>依据</th></tr></thead><tbody>${rows.map((n) => `<tr><th>${esc(n.name)}<small>${n.rateModel ? `数量折算：${label(n.rateModel.referenceCards)} / ${num(n.rateModel.referenceCount, 0)}件` : "沿用每NPU等效事件率；数量只展示"}</small></th>${scales.map((s) => `<td>${num(s.nodes.find((v) => v.id === n.id)?.quantity, 0)}</td>`).join("")}<td><details><summary>查看依据</summary>${esc(n.inventory?.source ?? "数量待补充")}<p>${esc(n.rateModel?.source ?? n.source)}</p></details></td></tr>`).join("")}</tbody></table></div></div>`;
}
export function hardwareFaultHeatmap(
  d: AuditArchitectureDiagnosis,
  cards: number,
  focus: string,
  mode: "type" | "loss" = "type",
) {
  const nodes = focusedNodes(d, cards, focus);
  const columns =
    mode === "type"
      ? [
          ["hard", "中断"],
          ["slow", "亚健康"],
          ["sdc", "静默"],
        ]
      : Object.entries(architectureLossNames);
  const value = (n: (typeof nodes)[number], key: string) =>
    mode === "type"
      ? (n.types.find((t) => t.type === key)?.lossHours ?? 0)
      : (n.loss[key] ?? 0);
  const maximum = Math.max(
    1e-12,
    ...nodes.flatMap((n) => columns.map(([key]) => value(n, key))),
  );
  return `<div class="hardware-panel"><h4>${mode === "type" ? "故障表现与硬件损失热力图" : "损失环节与硬件热力图"} · ${label(cards)}</h4><p class="note">同级对象互斥汇总，单元格为等效损失小时；色深按本图实际损失变化。灰色表示缺少故障模型。${mode === "type" ? "公共保存与检测开销单列，不归入故障类型。" : ""}</p><div class="table-wrap"><table data-hardware="${mode === "type" ? "fault-heatmap" : "loss-heatmap"}"><thead><tr><th>硬件对象</th>${columns.map(([, name]) => `<th>${name}</th>`).join("")}<th>预算 / 已建模差距 h</th></tr></thead><tbody>${nodes
    .map(
      (n) =>
        `<tr><th>${esc(n.name)}${n.dataStatus === "partial" ? "<small>含未建模对象</small>" : ""}</th>${columns
          .map(([key]) => {
            const v = value(n, key);
            return `<td ${n.dataStatus === "unknown" ? 'class="unknown"' : `style="background:rgba(210,130,73,${(0.04 + (0.55 * v) / maximum).toFixed(3)})"`}>${n.dataStatus === "unknown" ? "待补充" : mode === "type" && n.kind === "overhead" ? "公共开销" : num(v)}</td>`;
          })
          .join(
            "",
          )}<td>${num(n.allowedHours)} / ${n.dataStatus === "unknown" ? "未知" : num(n.excessHours)}</td></tr>`,
    )
    .join("")}</tbody></table></div></div>`;
}
export function hardwareDiagnosisDetail(
  d: AuditArchitectureDiagnosis,
  cards: number,
  focus: string,
) {
  const n = d.scales
    .find((s) => s.cards === cards)!
    .nodes.find((v) => v.id === focus);
  if (!n) return "";
  const hz = n.types.reduce((s, t) => s + t.rate, 0);
  return `<div class="hardware-panel" data-hardware="diagnostic"><h4>${esc(n.name)} · 频率、恢复与措施</h4>
  <div class="hardware-numbers"><div>硬件数量<strong>${num(n.quantity, 0)}</strong><small>当前${label(cards)}配置</small></div>
  <div>中断事件间隔<strong>${num(n.types.find((t) => t.type === "hard")?.intervalHours)} h</strong><small>等效FIT推得；不等同业务中断MTBF</small></div>
  <div>恢复停机 / 次<strong>${num(n.recoveryPauseSeconds)} s</strong><small>含检测与失败回退，受窗口截断影响</small></div>
  <div>等效损失 / 事件<strong>${num(n.equivalentLossSeconds)} s</strong><small>含回滚、污染、降速与局部损失</small></div></div>
  <p>事件频率 ${num(hz, 6)} 次/非全局停机小时；业务中断MTBF：待独立中断定义与观测。${n.dataStatus === "unknown" ? "该对象故障数据待补充。" : n.dataStatus === "partial" ? `尚缺：${n.missingObjects?.map(esc).join("、")}。` : ""}</p>
  <p>目标预算 ${num(n.allowedHours)} h；已建模损失 ${num(n.actualHours)} h；差距 ${num(n.excessHours)} h。${esc(n.action)}</p>
  <p class="note">提高MTBF的方向：有依据的故障预防、筛查或业务故障屏蔽；降低MTTR的方向：检测、定位、隔离和恢复。快速倒换仍有停顿时计入恢复损失，不能重复领取“降FIT”收益。</p>
  <div class="table-wrap"><table><thead><tr><th>当前适用措施</th><th>主要作用</th></tr></thead><tbody>${(n.mechanismEffects ?? []).map((m) => `<tr><td>${esc(auditMechanismNames[m.id] ?? auditExtensionCatalog.find((c) => c.id === m.id)?.name ?? m.id)}</td><td>${esc(m.effect)}</td></tr>`).join("") || '<tr><td colspan="2">未选附加措施；保留基础恢复链</td></tr>'}</tbody></table></div>
  <details><summary>适用故障与证据</summary>${n.drivers.map((e) => `<p><b>${esc(e.id)}</b> · 等效FIT ${num(e.fit, 6)} · 已建模损失 ${num(e.lossHours)} h<small>${esc(e.source)}</small></p>`).join("") || "<p>尚无故障数据。</p>"}</details>
  <details><summary>专家库中可进一步评估的措施</summary>${n.extensions.map((e) => `<p>${esc(e.id)} · ${esc(e.name)}<small>候选，未自动部署；依据：${esc(e.source)}</small></p>`).join("") || "<p>需要补充适用性证据。</p>"}</details></div>`;
}
export function hardwarePropagation(
  d: AuditArchitectureDiagnosis,
  focus?: string,
) {
  const records = d.architecture.propagations ?? [];
  const ids = focus
    ? d.scales[0].nodes.find((n) => n.id === focus)?.eventIds
    : undefined;
  const selected = records.filter((p) => !ids || ids.includes(p.eventId));
  return `<div class="hardware-panel" data-hardware="propagation"><h4>根故障、传播与业务影响</h4><p class="note">每个根故障只记一次损失。下列路径为项目证据；没有自动增加概率、共因事件或冗余收益。</p>${selected.map((p) => `<details open><summary>${esc(p.eventId)} · ${esc(p.manifestation)}</summary><div class="hardware-chain">${p.path.map((id, i) => `${i ? "<span>→</span>" : ""}<b>${esc(d.architecture.nodes.find((n) => n.id === id)?.name)}</b>`).join("")}</div><p>影响范围：${esc(p.impact)}；隔离与恢复条件：${esc(p.containment)}</p><small>依据：${esc(p.source)}</small></details>`).join("") || "<p>尚未记录传播证据；组成关系不作为已验证的故障传播路径。</p>"}</div>`;
}
export function hardwareFrequencyRecovery(
  d: AuditArchitectureDiagnosis,
  cards: number,
  focus: string,
) {
  const candidates = focusedNodes(d, cards, focus).filter(
    (n) => n.kind !== "overhead" && n.dataStatus !== "unknown",
  );
  const points = candidates.filter((n) => n.recoveryPauseSeconds !== null);
  const maxX = Math.max(
    1e-9,
    ...points.map((n) => n.types.reduce((s, t) => s + t.rate, 0)),
  );
  const maxY = Math.max(1, ...points.map((n) => n.recoveryPauseSeconds!));
  const maxLoss = Math.max(1e-9, ...points.map((n) => n.actualHours));
  const omitted = candidates.length - points.length;
  return `<div class="hardware-panel" data-hardware="frequency-recovery"><h4>故障频率与恢复停机 · ${label(cards)}</h4><p class="note">气泡大小表示已建模损失；同级对象比较。恢复未观测到的${omitted}项不绘成零秒；横轴为输入事件频率，包含中断、亚健康和静默，不能读作业务中断频率。</p>${
    points.length
      ? `<div class="table-wrap"><svg class="hardware-scatter" viewBox="0 0 760 335" role="img" aria-label="故障发生频率与恢复停机散点图"><path d="M80 30V275H700" fill="none" stroke="#8ba698"/>${[0, 0.25, 0.5, 0.75, 1].map((v) => `<path d="M80 ${275 - v * 225}H700" stroke="#e0e9e3"/><text x="72" y="${279 - v * 225}" text-anchor="end" font-size="11" fill="#476355">${num(v * maxY, 1)}</text><text x="${80 + v * 600}" y="295" text-anchor="middle" font-size="11" fill="#476355">${num(v * maxX, 4)}</text>`).join("")}${points
          .map(
            (n) =>
              `<g><title>${esc(n.name)}：${num(
                n.types.reduce((s, t) => s + t.rate, 0),
                6,
              )}次/h；${num(n.recoveryPauseSeconds)}s；损失${num(n.actualHours)}h</title><circle cx="${80 + (600 * n.types.reduce((s, t) => s + t.rate, 0)) / maxX}" cy="${275 - (225 * n.recoveryPauseSeconds!) / maxY}" r="${5 + 12 * Math.sqrt(n.actualHours / maxLoss)}" fill="#408b76" fill-opacity=".65"/><text x="${Math.min(610, 88 + (600 * n.types.reduce((s, t) => s + t.rate, 0)) / maxX)}" y="${260 - (225 * n.recoveryPauseSeconds!) / maxY}" font-size="11" fill="#264f43">${esc(n.name)}</text></g>`,
          )
          .join(
            "",
          )}<text x="390" y="325" text-anchor="middle" font-size="12" fill="#476355">事件频率 / 次每小时</text><text x="82" y="17" font-size="12" fill="#476355">恢复停机 / 次（秒）</text></svg></div>`
      : "<p>本样本没有可绘制的恢复观测，不能据此判断无风险。</p>"
  }</div>`;
}
export function hardwareReport(d: AuditArchitectureDiagnosis, cards: number) {
  if (
    d.architecture.view !== "hardware" &&
    !d.architecture.propagations?.length &&
    !d.architecture.nodes.some((n) => n.inventory)
  )
    return "";
  const root = d.architecture.nodes.find((n) => !n.parentId)!;
  return `<style>${hardwareCss}</style><details class="arch-evidence"><summary>硬件规模配置、传播与恢复诊断</summary>${hardwareInventorySummary(d)}${hardwarePropagation(d)}${orderedDiagnosisScales(
    d,
    true,
  )
    .map(
      (s) =>
        `<details ${s.cards === cards ? "open" : ""}><summary>${label(s.cards)} · 硬件诊断</summary>${hardwareFaultHeatmap(d, s.cards, root.id)}${hardwareFaultHeatmap(d, s.cards, root.id, "loss")}${hardwareFrequencyRecovery(d, s.cards, root.id)}${hardwareDiagnosisDetail(d, s.cards, root.id)}</details>`,
    )
    .join("")}</details>`;
}
export function hardwareMarkdown(d: AuditArchitectureDiagnosis) {
  if (
    d.architecture.view !== "hardware" &&
    !d.architecture.propagations?.length
  )
    return "";
  const scales = orderedDiagnosisScales(d, true);
  const safe = (s: unknown) =>
    esc(s).replaceAll("|", "\\|").replaceAll("\n", " ");
  return (
    "\n\n### 硬件规模配置与传播证据\n\n| 对象 | " +
    scales.map((s) => label(s.cards)).join(" | ") +
    " | 事件率口径与依据 |\n| --- | " +
    scales.map(() => "---").join(" | ") +
    " | --- |\n" +
    d.architecture.nodes
      .filter((n) => n.hardwareLevel || n.rateModel)
      .map(
        (n) =>
          "| " +
          safe(n.name) +
          " | " +
          scales
            .map((s) => num(s.nodes.find((v) => v.id === n.id)?.quantity, 0))
            .join(" | ") +
          " | " +
          safe(
            n.rateModel
              ? `数量折算；参考${n.rateModel.referenceCards}卡/${n.rateModel.referenceCount}件；${n.rateModel.source}`
              : "沿用每NPU等效FIT；" + (n.inventory?.source ?? "数量待补充"),
          ) +
          " |",
      )
      .join("\n") +
    "\n\n" +
    (d.architecture.propagations ?? [])
      .map(
        (p) =>
          `${safe(p.eventId)}：${p.path.map((id) => safe(d.architecture.nodes.find((n) => n.id === id)?.name)).join(" → ")}；${safe(p.manifestation)}；影响${safe(p.impact)}；恢复条件${safe(p.containment)}；依据${safe(p.source)}`,
      )
      .join("\n\n") +
    "\n\n未建模对象不代表零风险；业务中断MTBF待独立观测。传播记录本身不产生额外收益。\n\n"
  );
}

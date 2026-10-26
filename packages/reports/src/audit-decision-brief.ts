import type { AuditArchitectureDiagnosis } from "../../analysis/src/audit-architecture";
import {
  orderedDiagnosisScales,
  summaryNumber as num,
  summaryScaleLabel as scale,
  summaryEscape as esc,
} from "./audit-scale-summary";

/** Read only: observations and applicable candidates, never invented improvement gains. */
export function architectureDecisionBrief(d: AuditArchitectureDiagnosis) {
  return `<div class="decision-brief" aria-label="各规模薄弱点与改进路径">${orderedDiagnosisScales(
    d,
  )
    .map((s) => {
      const weak = s.weaknesses[0],
        node = s.nodes.find((n) => n.id === weak?.id);
      const freq = node?.frequencyRecovery,
        leader = s.ranking[0];
      return `<article><header><b>${scale(s.cards)}</b><span>${num(s.statistics.mean * 100)}% → ${num(s.target * 100)}%</span></header><p class="decision-brief-gap">${s.statistics.mean >= s.target ? "均值达到目标，仍需检查区间与模型覆盖" : `可用度差距 ${num((s.target - s.statistics.mean) * 100)} pp`}</p>
      ${node ? `<h4>优先核对：${esc(node.name)}</h4><p>${esc(node.focus)} · 损失 ${num(node.actualHours)} h / 预算 ${num(node.allowedHours)} h</p><dl><dt>频率侧</dt><dd>输入中断事件间隔 ${num(freq?.hardEventIntervalHours)} h；源器件FIT保持原证据。冗余与故障屏蔽需独立建模。</dd><dt>时间与产出损失侧</dt><dd>${esc(node.action)}。${freq?.recoveryOnlyFeasible === false ? "本层非恢复损失已经超预算，仅缩短恢复仍不足。" : freq?.requiredPauseSeconds != null ? `固定本轮次数下，单次恢复预算 ${num(freq.requiredPauseSeconds)} s；此为单侧诊断，非产品指标。` : "恢复次数或预算不足，暂不反推暂停要求。"}</dd></dl>` : "<p>本次未观察到可排序损失，需补充样本。</p>"}
      <p class="decision-brief-leader">现有组合贡献首位：${leader ? `${esc(leader.name ?? leader.id)} · ${num(leader.statistics.mean * 100)} pp` : "尚未归因"}</p>
      <small>下一步：按薄弱点适用范围与本规模Shapley形成工程重要度，先分配责任预算，再生成参数建议、单独复评。现有贡献不等于追加收益；以上为已建模样本。</small></article>`;
    })
    .join("")}</div>`;
}

export const decisionBriefCss = `.decision-brief{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0}.decision-brief article{border:1px solid #dbe4ef;border-radius:10px;padding:18px;background:#fff;break-inside:avoid}.decision-brief header{display:flex;justify-content:space-between;gap:12px;color:#23486d;font-size:13px}.decision-brief header b{font-size:17px}.decision-brief h4{font-size:15px;margin:14px 0 6px;color:#243f5e}.decision-brief p,.decision-brief dd{font-size:12px;line-height:1.8;margin:6px 0}.decision-brief .decision-brief-gap{color:#a35c2f;font-size:12px}.decision-brief dt{color:#426a93;font-size:11px;margin-top:12px;font-weight:650}.decision-brief dd{color:#5e7188}.decision-brief small{display:block;color:#7b8da0;font-size:10px;line-height:1.8}.decision-brief-leader{border-top:1px solid #e5ebf2;padding-top:10px}@media(max-width:700px){.decision-brief{grid-template-columns:1fr}.decision-brief header{flex-wrap:wrap}}`;

import { auditSummary } from "./audit-summary";
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const number = (v: number) =>
  v.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const pct = (v: number) => number(v * 100) + "%";
export function auditVisuals(r: any) {
  const scales = [...new Set<number>(r.rows.map((x: any) => x.cards))];
  return `<section class="executive" id="decision-summary"><div class="section-heading"><div><span class="kicker">DECISION BRIEF / 先看结论</span><h2>从产出缺口，定位设计重点</h2></div><label>查看规模 <select id="summary-scale" aria-label="摘要规模">${scales.map((n) => `<option value="${n}" ${n === r.request.cards ? "selected" : ""}>${number(n)} 卡</option>`).join("")}</select></label></div>${scales
    .map((cards) => {
      const s = auditSummary(r, cards);
      const max = Math.max(1, ...s.losses.flatMap((l) => [l.base, l.combined]));
      const a = r.attribution.find((x: any) => x.cards === cards);
      const contributionMax = a
        ? Math.max(
            0.000001,
            ...a.contributions.map((c: any) => Math.abs(c.statistics.mean)),
          )
        : 1;
      return `<div data-summary-scale="${cards}" ${cards !== r.request.cards ? "hidden" : ""}><div class="verdict ${s.status}"><strong>${esc(s.statusLabel)}</strong><p>${esc(s.next)}</p></div><div class="metric-cards">
      <div><span>基线正确产出</span><b>${pct(s.base.statistics.mean)}</b><small>当前故障与恢复假设</small></div>
      <div><span>组合正确产出</span><b>${pct(s.combined.statistics.mean)}</b><small>95% 区间 ${pct(s.combined.statistics.ciLow)} ～ ${pct(s.combined.statistics.ciHigh)}</small></div>
      <div><span>新增正确计算</span><b>${number(s.additionalHours)} <em>小时</em></b><small>提升 ${number(s.gain * 100)} 个百分点 · 单窗口</small></div>
      <div><span>距目标（均值 − 目标）</span><b>${s.gap >= 0 ? "+" : ""}${number(s.gap * 100)} <em>pp</em></b><small>目标 ${pct(s.target)}；pp 为百分点</small></div></div>
      <div class="brief-grid"><div><h3>产出损失去了哪里</h3><p class="chart-note">橙色：基线 · 绿色：组合 · 单窗口等效计算小时</p>${s.losses.map((l) => `<div class="loss-row"><span>${esc(l.name)}</span><div>${(["base", "combined"] as const).map((k) => `<div class="bar-pair"><div class="track"><div class="bar ${k}" style="width:${(Math.max(0, l[k]) / max) * 100}%"></div></div><small>${number(l[k])} h</small></div>`).join("")}</div></div>`).join("")}</div>
      <div><h3>优先核对的故障事件</h3><p class="chart-note">按基线损失排序，排除公共保存开销。</p><div class="table-wrap"><table><thead><tr><th>事件</th><th>基线损失 h</th><th>组合剩余 h</th></tr></thead><tbody>${s.drivers.map((d: any) => `<tr><td><b>${esc(d.id)}</b><small class="event-description">${esc(d.name)}</small></td><td>${number(d.loss)}</td><td>${number(d.remaining)}</td></tr>`).join("")}</tbody></table></div></div></div>
      ${a ? `<h3>组合收益由谁贡献</h3><p class="chart-note">Shapley 分摊组合增益，保留负贡献；每个子集 ${a.trials} 条轨迹，本批次组合提升 ${number(a.gain * 100)} pp；上方主评估使用 ${r.request.trials} 条轨迹，采样差异会使总提升不同。区间详见组合贡献章节。</p><div class="contribution-grid">${a.contributions.map((c: any) => `<div class="contribution"><span>${esc(c.name)}</span><strong class="${c.statistics.mean < 0 ? "negative" : "positive"}">${c.statistics.mean >= 0 ? "+" : ""}${number(c.statistics.mean * 100)} pp</strong><div class="track"><div class="bar ${c.statistics.mean < 0 ? "negative" : "combined"}" style="width:${(Math.abs(c.statistics.mean) / contributionMax) * 100}%"></div></div></div>`).join("")}</div>` : '<p class="chart-note">本次未计算 Shapley，不能据此判断收益完全可加。</p>'}
      <p class="evidence-note">数据证据：${r.events.length} 条事件中 ${s.internal} 条来自内部观测。其余为外网先验或方案假设；采样区间仅反映抽样误差。${r.decision.totalCost === null ? "成本尚未完整录入，不能判断最优性价比。" : "成本仅包含已录入的机制成本，未纳入硬件换型与组合耦合成本。"}</p></div>`;
    })
    .join("")}</section>`;
}
export const reportEnhancementCss = `
*{box-sizing:border-box}[hidden]{display:none!important}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}header{background:linear-gradient(125deg,#123b38,#235a50)}header p{overflow-wrap:anywhere}nav{gap:6px}nav a{font-size:13px}.report-actions{display:flex;gap:10px;margin:18px 0}.report-actions button,select,input{font:inherit;border:1px solid #ccdcd4;background:white;border-radius:6px;padding:8px 12px;color:#264c40}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #17816a;outline-offset:3px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:20px}.section-heading label{white-space:nowrap;font-size:13px}.kicker{font-size:11px;letter-spacing:2px;color:#587d6d}.section-heading h2{margin:8px 0 18px}.verdict{border-left:4px solid #218269;background:#eef7f2;padding:16px 20px}.verdict p{margin:6px 0 0}.verdict.below,.verdict.uncertain{background:#fff7e9;border-color:#bd8948}.metric-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0 30px}.metric-cards>div{background:#f1f6f1;border:1px solid #dfe9e0;padding:18px;border-radius:10px}.metric-cards span{font-size:12px;color:#526d61}.metric-cards b{display:block;font-size:28px;letter-spacing:-.5px;color:#156a52;margin:8px 0;font-variant-numeric:tabular-nums}.metric-cards em{font-style:normal;font-size:14px}.metric-cards small{font-size:11px;display:block;line-height:1.6}.brief-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}.chart-note{color:#62786e;font-size:12px}.loss-row{display:grid;grid-template-columns:100px 1fr;gap:12px;align-items:center;margin:18px 0;font-size:13px}.bar-pair{display:flex;align-items:center;gap:10px;margin:5px 0}.bar-pair small{width:70px;text-align:right;font-size:11px}.bar-pair .track{height:9px}.event-description{display:block;max-width:220px;font-size:11px}.evidence-note{padding:14px 18px;background:#f9f6ed;color:#796642;font-size:13px;border-radius:8px}.contribution-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.contribution{padding:14px;background:#f6f8f4;border-radius:8px;font-size:12px}.contribution strong{display:block;margin:6px 0 10px;font-size:19px}.contribution .track{height:7px}.positive{color:#187b60}.negative{color:#a3483a}.bar.negative{background:#a3483a}.table-tools{display:flex;align-items:center;gap:10px;margin:18px 0 0;flex-wrap:wrap}.table-tools input{max-width:350px;min-width:120px}.table-count{font-size:12px;color:#607a6e}.table-wrap{border:1px solid #e0e7e0;border-radius:8px;margin:14px 0}table{margin:0;font-variant-numeric:tabular-nums}th{white-space:nowrap}td{min-width:90px;max-width:420px}td:first-child{font-weight:550}th:first-child,td:first-child{position:sticky;left:0;background:#f3f7f1;z-index:1}td:last-child{overflow-wrap:anywhere}section>p{max-width:1050px}section:has(>details){padding:10px 24px;margin:12px 0}section>details>summary{font-size:16px}section>details>p{border-left:2px solid #c9dbd0;padding-left:16px;font-size:13px}.report-evidence{margin:14px 0;padding:14px;background:#eef3ed;border-radius:8px}h3{font-size:17px;color:#244f40}.print-only{display:none}
@media(max-width:900px){.metric-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.brief-grid{grid-template-columns:1fr}.contribution-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){body{margin:12px auto}h1{font-size:25px}h2{font-size:20px}.section-heading{display:block}.section-heading label{display:block;margin-bottom:16px}.metric-cards>div{padding:12px}.metric-cards b{font-size:23px}.loss-row{grid-template-columns:80px 1fr}.table-tools input{width:100%}.chart-row strong{width:75px;font-size:13px}}
@media print{@page{size:A4 landscape;margin:12mm}body{max-width:none;font-size:11px;padding:0}.report-actions,.table-tools,.report-evidence,nav{display:none!important}[data-summary-scale][hidden]{display:none!important}tr[hidden]{display:table-row!important}header{background:white;color:#173c37;padding:12px}header p{color:#435f53}section{margin:14px 0;padding:12px 0}section>details{display:block}details::details-content{display:block!important;content-visibility:visible!important}.table-wrap{overflow:visible}table{font-size:9px;table-layout:auto}th,td{padding:5px;min-width:0;white-space:normal;position:static!important;overflow-wrap:anywhere}.metric-cards{grid-template-columns:repeat(4,1fr)}.brief-grid{grid-template-columns:1fr 1fr}.print-only{display:block}.bar{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
export const reportInteractionScript = `<script>
(()=>{
 const scale=document.getElementById('summary-scale');
 scale?.addEventListener('change',()=>document.querySelectorAll('[data-summary-scale]').forEach(el=>{el.hidden=el.dataset.summaryScale!==scale.value;}));
 document.querySelectorAll('section .table-wrap').forEach(wrap=>{
 const table=wrap.querySelector('table'),rows=Array.from(table.tBodies[0]?.rows||[]);if(rows.length<10)return;
 const tools=document.createElement('div');tools.className='table-tools';
 const input=document.createElement('input');input.type='search';input.placeholder='搜索事件、机制或来源';input.setAttribute('aria-label','筛选表格');
 const count=document.createElement('span');count.className='table-count';count.setAttribute('role','status');
 const heads=Array.from(table.tHead.rows[0].cells).map(c=>c.textContent);const typeIndex=heads.indexOf('类型');
 let select;if(typeIndex>=0){select=document.createElement('select');select.setAttribute('aria-label','事件类型');['全部类型','中断','亚健康','静默'].forEach((v,i)=>{const o=document.createElement('option');o.value=i?v:'';o.textContent=v;select.append(o);});tools.append(select);}
 const filter=()=>{let n=0;const query=input.value.trim().toLowerCase();const exactId=!!query&&rows.some(row=>row.cells[0].textContent.trim().toLowerCase()===query);rows.forEach(row=>{row.hidden=!((exactId?row.cells[0].textContent.trim().toLowerCase()===query:row.textContent.toLowerCase().includes(query))&&(!select?.value||row.cells[typeIndex].textContent===select.value));if(!row.hidden)n++;});count.textContent=n+' / '+rows.length+' 条';};
 input.addEventListener('input',filter);select?.addEventListener('change',filter);tools.append(input,count);wrap.before(tools);filter();
 });
 document.getElementById('report-print')?.addEventListener('click',()=>window.print());
 document.getElementById('report-expand')?.addEventListener('click',e=>{const open=e.currentTarget.getAttribute('aria-expanded')!=='true';document.querySelectorAll('section>details').forEach(d=>d.open=open);e.currentTarget.setAttribute('aria-expanded',String(open));e.currentTarget.textContent=open?'收起机制明细':'展开机制明细';});
})();
</script>`;

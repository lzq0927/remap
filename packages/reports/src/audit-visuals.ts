import {
  auditSelectedMechanisms,
  auditSamplingDescription,
} from "./audit-context";
import { auditSummary, auditScaleSummary } from "./audit-summary";
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
export function auditMethodVisual(r: any) {
  return `<div class="audit-method-flow"><div><span>01 / 输入</span><h3>故障事件库</h3><p>${r.events.length} 条事件，分别记录硬件域、类型、FIT 与来源。当前中断、亚健康、静默总量和占比均从本次冻结输入计算。</p><code>λᵢ(N) = N × FITᵢ / 10⁹<br>MTBFᵢ = 1 / λᵢ</code></div><div><span>02 / 行为</span><h3>机制匹配与失败回退</h3><p>检测 → ${esc(r.config.recoveryOrder.join(" → "))} → 全局 CKPT → 人工。</p><p>只走已启用且事件适用的节点，成功即停止；失败耗时累计。静默使用独立的正确性恢复链，恢复机制不修改源 FIT。</p></div><div><span>03 / 结果</span><h3>有限窗口与正确进度</h3><p>${number(r.request.hours)} 小时，按故障、发现、恢复、保存等时刻推进。停机、保存、降速、局部容量、回滚和期末污染分别记账。</p><p>同一污染期合并，保留最后干净检查点；亚健康恢复保留进度，重算不重复扣账。</p></div></div>`;
}
export function auditVisuals(r: any) {
  const scales = [...new Set<number>(r.rows.map((x: any) => x.cards))];
  const overview = auditScaleSummary(r);
  const context = `<p class="evidence-note">${esc(auditSamplingDescription(r))}</p><details class="actual-combination" open><summary>本次实际启用组合 · ${auditSelectedMechanisms(r).length}项</summary><p class="chart-note">这是冻结输入中的实际组合；推荐子集不会自动替换它。常规CKPT与人工兜底已在基线中，预置样例不限定措施数量，也不代表最优部署。</p><div class="table-wrap"><table><thead><tr><th>措施</th><th>名称</th><th>本次参数</th></tr></thead><tbody>${auditSelectedMechanisms(
    r,
  )
    .map(
      (m) =>
        `<tr><td>${esc(m.code)}</td><td>${esc(m.name)}</td><td>${esc(m.parameters)}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div>${r.referenceComparison?.differences.length ? `<details><summary>与专家原始配置的差异</summary><ul>${r.referenceComparison.differences.map((d: string) => `<li>${esc(d)}</li>`).join("")}</ul></details>` : ""}</details>`;
  return `<section class="executive" id="decision-summary"><div class="section-heading"><div><span class="kicker">DECISION BRIEF / 先看结论</span><h2>从产出缺口，定位设计重点</h2></div><label>查看规模 <select id="summary-scale" aria-label="摘要规模">${scales.map((n) => `<option value="${n}" ${n === r.request.cards ? "selected" : ""}>${number(n)} 卡</option>`).join("")}</select></label></div>${context}<p class="evidence-note">本次共核对 ${overview.total} 个规模：采样支持 ${overview.supported} 个，低于目标 ${overview.below} 个，证据不足 ${overview.uncertain} 个。下方结论针对当前查看规模，某一规模通过不代表所有规模达标；完整要求对照见“确认口径与数据证据”。</p>${scales
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
      <div><span>基线可用度</span><b>${pct(s.base.statistics.mean)}</b><small>当前故障与恢复假设</small></div>
      <div><span>组合可用度</span><b>${pct(s.combined.statistics.mean)}</b><small>95% 区间 ${pct(s.combined.statistics.ciLow)} ～ ${pct(s.combined.statistics.ciHigh)}</small></div>
      <div><span>新增正确计算</span><b>${number(s.additionalHours)} <em>小时</em></b><small>提升 ${number(s.gain * 100)} 个百分点 · 单窗口</small></div>
      <div><span>距目标（均值 − 目标）</span><b>${s.referenceOnly ? "参考规模" : `${s.gap >= 0 ? "+" : ""}${number(s.gap * 100)} <em>pp</em>`}</b><small>${s.referenceOnly ? "未设置需求目标" : `目标 ${pct(s.target)}；pp 为百分点`}</small></div></div>
      <div class="brief-grid"><div><h3>产出损失去了哪里</h3><p class="chart-note">橙色：基线 · 绿色：组合 · 单窗口等效计算小时</p>${s.losses.map((l) => `<div class="loss-row"><span>${esc(l.name)}</span><div>${(["base", "combined"] as const).map((k) => `<div class="bar-pair"><div class="track"><div class="bar ${k}" style="width:${(Math.max(0, l[k]) / max) * 100}%"></div></div><small>${number(l[k])} h</small></div>`).join("")}</div></div>`).join("")}</div>
      <div><h3>优先核对的故障事件</h3><p class="chart-note">按基线损失排序，排除公共保存开销。</p><div class="table-wrap"><table><thead><tr><th>事件</th><th>基线损失 h</th><th>组合剩余 h</th></tr></thead><tbody>${s.drivers.map((d: any) => `<tr><td><b>${esc(d.id)}</b><small class="event-description">${esc(d.name)}</small></td><td>${number(d.loss)}</td><td>${number(d.remaining)}</td></tr>`).join("")}</tbody></table></div></div></div>
      ${a ? `<h3>组合收益由谁贡献</h3><p class="chart-note">Shapley 分摊组合增益，保留负贡献；每个子集 ${a.trials} 条轨迹，本批次组合提升 ${number(a.gain * 100)} pp；上方主评估使用 ${r.request.trials} 条轨迹，采样差异会使总提升不同。区间详见组合贡献章节。</p><div class="contribution-grid">${a.contributions.map((c: any) => `<div class="contribution"><span>${esc(c.name)}</span><strong class="${c.statistics.mean < 0 ? "negative" : "positive"}">${c.statistics.mean >= 0 ? "+" : ""}${number(c.statistics.mean * 100)} pp</strong><div class="track"><div class="bar ${c.statistics.mean < 0 ? "negative" : "combined"}" style="width:${(Math.abs(c.statistics.mean) / contributionMax) * 100}%"></div></div></div>`).join("")}</div>` : '<p class="chart-note">本次未计算 Shapley，不能据此判断收益完全可加。</p>'}
      <p class="evidence-note">数据证据：${r.events.length} 条事件中 ${s.internal} 条来自观测数据。其余为参考数据或方案假设；采样区间仅反映抽样误差。${r.decision.totalCost === null ? "成本尚未完整录入，不能判断最优性价比。" : "成本仅包含已录入的机制成本，未纳入硬件换型与组合耦合成本。"}</p></div>`;
    })
    .join("")}</section>`;
}
export const reportEnhancementCss = `
*{box-sizing:border-box}[hidden]{display:none!important}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}header{background:linear-gradient(125deg,#123b38,#235a50)}header p{overflow-wrap:anywhere}nav{gap:6px}nav a{font-size:13px}.report-actions{display:flex;gap:10px;margin:18px 0}.report-actions button,select,input{font:inherit;border:1px solid #ccdcd4;background:white;border-radius:6px;padding:8px 12px;color:#264c40}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #17816a;outline-offset:3px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:20px}.section-heading label{white-space:nowrap;font-size:13px}.kicker{font-size:11px;letter-spacing:2px;color:#587d6d}.section-heading h2{margin:8px 0 18px}.verdict{border-left:4px solid #218269;background:#eef7f2;padding:16px 20px}.verdict p{margin:6px 0 0}.verdict.below,.verdict.uncertain{background:#fff7e9;border-color:#bd8948}.metric-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0 30px}.metric-cards>div{background:#f1f6f1;border:1px solid #dfe9e0;padding:18px;border-radius:10px}.metric-cards span{font-size:12px;color:#526d61}.metric-cards b{display:block;font-size:28px;letter-spacing:-.5px;color:#156a52;margin:8px 0;font-variant-numeric:tabular-nums}.metric-cards em{font-style:normal;font-size:14px}.metric-cards small{font-size:11px;display:block;line-height:1.6}.brief-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}.chart-note{color:#62786e;font-size:12px}.loss-row{display:grid;grid-template-columns:100px 1fr;gap:12px;align-items:center;margin:18px 0;font-size:13px}.bar-pair{display:flex;align-items:center;gap:10px;margin:5px 0}.bar-pair small{width:70px;text-align:right;font-size:11px}.bar-pair .track{height:9px}.event-description{display:block;max-width:220px;font-size:11px}.evidence-note{padding:14px 18px;background:#f9f6ed;color:#796642;font-size:13px;border-radius:8px}.contribution-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.contribution{padding:14px;background:#f6f8f4;border-radius:8px;font-size:12px}.contribution strong{display:block;margin:6px 0 10px;font-size:19px}.contribution .track{height:7px}.positive{color:#187b60}.negative{color:#a3483a}.bar.negative{background:#a3483a}.table-tools{display:flex;align-items:center;gap:10px;margin:18px 0 0;flex-wrap:wrap}.table-tools input{max-width:350px;min-width:120px}.table-count{font-size:12px;color:#607a6e}.table-wrap{border:1px solid #e0e7e0;border-radius:8px;margin:14px 0}table{margin:0;font-variant-numeric:tabular-nums}th{white-space:nowrap}td{min-width:90px;max-width:420px}td:first-child{font-weight:550}th:first-child,td:first-child{position:sticky;left:0;background:#f3f7f1;z-index:1}td:last-child{overflow-wrap:anywhere}section>p{max-width:1050px}section:has(>details){padding:10px 24px;margin:12px 0}section>details>summary{font-size:16px}section>details>p{border-left:2px solid #c9dbd0;padding-left:16px;font-size:13px}.report-evidence{margin:14px 0;padding:14px;background:#eef3ed;border-radius:8px}h3{font-size:17px;color:#244f40}.print-only{display:none}
.event-library-table table{width:max-content;min-width:100%}.event-library-table td{min-width:0;white-space:nowrap}.event-library-table td:nth-child(2){white-space:normal;min-width:240px;max-width:280px}.event-library-table td:last-child{min-width:118px}.evidence-badge{display:inline-block;font-size:11px;color:#586f61;padding:2px 7px;background:#edf3ed;border-radius:4px;white-space:nowrap}.source-link{display:block;font-size:12px;color:#17775e;margin-top:5px;text-decoration:underline;text-underline-offset:3px}.event-sources{margin-top:28px}.event-sources>p{max-width:100%;margin-top:0}.event-source{border:1px solid #dee7df;border-radius:8px;margin:10px 0;background:#f9fbf8;scroll-margin-top:20px}.event-source:target{border-color:#28846c;box-shadow:0 0 0 2px #e5f2eb}.event-source>summary{display:flex;align-items:baseline;gap:10px;padding:12px 16px;font-size:13px;font-weight:400;flex-wrap:wrap}.event-source>summary:before{content:'▸';color:#497660}.event-source[open]>summary:before{content:'▾'}.event-source>summary strong{min-width:120px;font-weight:650;color:#315849}.event-source>summary>span:not(.evidence-badge){flex:1;min-width:160px}.event-source dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px 18px;margin:0;padding:10px 18px 18px;font-size:13px;border-top:1px solid #e3ebe4}.event-source dt{color:#667d6d;font-weight:500}.event-source dd{margin:0;min-width:0;overflow-wrap:anywhere;line-height:1.8}.gain-scale-control{display:block;margin:22px 0 0;font-size:13px}.table-wrap:focus-visible,.reliability-plot:focus-visible{outline:2px solid #17816a;outline-offset:2px}
@media(max-width:900px){.metric-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.brief-grid{grid-template-columns:1fr}.contribution-grid{grid-template-columns:repeat(2,1fr)}}
.source-register>summary{color:#244f40;font-size:16px}.source-register>summary small{display:block;font-size:12px;font-weight:400;margin-top:4px}.source-register>p{max-width:100%}
.audit-method-flow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:22px 0}.audit-method-flow>div{padding:18px;background:#f5f9f6;border:1px solid #dbe5dd;border-radius:8px}.audit-method-flow span{font-size:11px;letter-spacing:1px;color:#5e7a6a}.audit-method-flow h3{margin:6px 0 12px}.audit-method-flow p,.audit-method-flow code{font-size:13px}.scale-table-control{display:flex;align-items:center;gap:10px;margin:18px 0 8px;font-size:13px}.scale-table-control select{min-width:150px}
@media(max-width:800px){.audit-method-flow{grid-template-columns:1fr}}
@media print{.audit-method-flow{grid-template-columns:repeat(3,minmax(0,1fr));break-inside:avoid}.scale-table-control{display:none!important}}
@media(max-width:640px){.event-source>summary{padding:12px}.event-source>summary strong{min-width:110px}.event-source>summary>span:not(.evidence-badge){min-width:120px}.event-source dl{display:block;padding:12px}.event-source dt{margin:10px 0 3px}.event-source dt:first-child{margin-top:0}.event-source dd{font-size:13px}.event-library-table td:nth-child(2){min-width:200px;max-width:240px}.gain-scale-control select{max-width:100%}}
@media(max-width:640px){body{margin:12px auto}h1{font-size:25px}h2{font-size:20px}.section-heading{display:block}.section-heading label{display:block;margin-bottom:16px}.metric-cards>div{padding:12px}.metric-cards b{font-size:23px}.loss-row{grid-template-columns:80px 1fr}.table-tools input{width:100%}.chart-row strong{width:75px;font-size:13px}}
.table-tools label{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.table-tools input[type=checkbox]{width:16px;min-width:16px;max-width:16px}.actual-combination{border:1px solid #dce7de;border-radius:10px;padding:8px 16px;margin:16px 0}.actual-combination td:last-child{min-width:260px;white-space:normal;line-height:1.8}
@media(max-width:640px){.actual-combination .table-wrap{border:0;overflow:visible}.actual-combination table,.actual-combination tbody{display:block;width:100%}.actual-combination thead{display:none}.actual-combination tr{display:grid;grid-template-columns:90px minmax(0,1fr);margin:12px 0;border:1px solid #e0e7e0;border-radius:8px;overflow:hidden}.actual-combination td{display:block;min-width:0;max-width:none;position:static;padding:8px;white-space:normal}.actual-combination td:last-child{grid-column:1/-1;min-width:0;background:#f1f6f1;border:0;overflow-wrap:normal}}
@media print{@page{size:A4 landscape;margin:12mm}body{max-width:none;font-size:11px;padding:0}.report-actions,.table-tools,.report-evidence,nav{display:none!important}[data-summary-scale][hidden]{display:none!important}tr[hidden]{display:table-row!important}header{background:white;color:#173c37;padding:12px}header p{color:#435f53}section{margin:14px 0;padding:12px 0}section>details{display:block}details::details-content{display:block!important;content-visibility:visible!important}.table-wrap{overflow:visible}table{font-size:9px;table-layout:auto}th,td{padding:5px;min-width:0;white-space:normal;position:static!important;overflow-wrap:anywhere}.metric-cards{grid-template-columns:repeat(4,1fr)}.brief-grid{grid-template-columns:1fr 1fr}.print-only{display:block}.bar{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
@media print{.event-library-table table{width:100%;table-layout:fixed}.event-library-table td{white-space:normal;min-width:0;max-width:none}.event-library-table td:nth-child(2){min-width:0;max-width:none;width:15%}.event-library-table td:last-child{min-width:0}.event-library-table th:nth-child(2){width:15%}.source-link,.gain-scale-control{display:none}.event-source{break-inside:avoid;background:white}.event-source>summary{padding:6px 10px;font-size:10px}.event-source dl{font-size:10px;padding:8px 12px}.event-source>summary>span:not(.evidence-badge){min-width:0}.event-source .evidence-badge{font-size:9px}.event-sources>h3{break-after:avoid}}
@media print{.event-source>summary{display:flex!important;gap:8px}.event-source dl{display:grid!important;grid-template-columns:80px minmax(0,1fr);gap:4px 12px;line-height:1.6}.event-source dd{font-size:10px;line-height:1.6}.event-source dt{margin:0}.source-register>summary small{display:none}.source-register>summary{display:block!important}.event-source{margin:6px 0}.event-source>summary:before{display:none}}
`;
export const reportInteractionScript = `<script>
(()=>{
 const scale=document.getElementById('summary-scale');
 scale?.addEventListener('change',()=>document.querySelectorAll('[data-summary-scale]').forEach(el=>{el.hidden=el.dataset.summaryScale!==scale.value;}));
 const gain=document.getElementById('gain-scale');
 gain?.addEventListener('change',()=>document.querySelectorAll('[data-gain-scale]').forEach(el=>{el.hidden=el.dataset.gainScale!==gain.value;}));
 const contribution=document.getElementById('contribution-scale');
 contribution?.addEventListener('change',()=>document.querySelectorAll('[data-contribution-scale]').forEach(el=>{el.hidden=el.dataset.contributionScale!==contribution.value;}));
 const revealSource=id=>{const detail=document.getElementById(id);if(detail){detail.open=true;const register=detail.closest('.source-register');if(register)register.open=true;}};
 document.addEventListener('click',e=>{const link=e.target.closest?.('.source-link');if(link)revealSource(link.getAttribute('href').slice(1));});
 const openSource=()=>{const id=location.hash.slice(1);if(id.startsWith('event-source-'))revealSource(id);};openSource();window.addEventListener('hashchange',openSource);
 document.querySelectorAll('section .table-wrap').forEach(wrap=>{
 const table=wrap.querySelector('table');if(!table)return;const getRows=()=>Array.from(table.tBodies[0]?.rows||[]);if(getRows().length<10)return;
 const tools=document.createElement('div');tools.className='table-tools';
 const input=document.createElement('input');input.type='search';input.placeholder='搜索事件、机制或来源';input.setAttribute('aria-label','筛选表格');
 const count=document.createElement('span');count.className='table-count';count.setAttribute('role','status');
 const heads=Array.from(table.tHead.rows[0].cells).map(c=>c.textContent);const typeIndex=heads.indexOf('类型');
 let select;if(typeIndex>=0){select=document.createElement('select');select.setAttribute('aria-label','事件类型');['全部类型','中断','亚健康','静默'].forEach((v,i)=>{const o=document.createElement('option');o.value=i?v:'';o.textContent=v;select.append(o);});tools.append(select);}
 let zero;if(wrap.classList.contains('event-library-table')){const label=document.createElement('label');zero=document.createElement('input');zero.type='checkbox';zero.setAttribute('aria-label','隐藏零FIT事件');label.append(zero,document.createTextNode('隐藏零FIT事件'));tools.append(label);}
 const filter=()=>{let n=0;const rows=getRows();const query=input.value.trim().toLowerCase();const exactId=!!query&&rows.some(row=>row.cells[0].textContent.trim().toLowerCase()===query);rows.forEach(row=>{row.hidden=!((exactId?row.cells[0].textContent.trim().toLowerCase()===query:(row.textContent+' '+(row.dataset.search||'')).toLowerCase().includes(query))&&(!select?.value||row.cells[typeIndex].textContent===select.value)&&(!zero?.checked||Number((row.dataset.fit||'').replaceAll(',',''))!==0));if(!row.hidden)n++;});count.textContent=n+' / '+rows.length+' 条';};
 input.addEventListener('input',filter);select?.addEventListener('change',filter);zero?.addEventListener('change',filter);table.addEventListener('remap-scale-change',filter);tools.append(input,count);wrap.before(tools);filter();
 });
 document.querySelectorAll('[data-table-scale]').forEach(select=>select.addEventListener('change',()=>{const id=select.dataset.tableScale,table=document.getElementById(id),template=document.getElementById(id+'-'+select.value);if(!table||!template)return;table.tBodies[0].replaceChildren(...Array.from(template.content.querySelector('tbody').children).map(row=>row.cloneNode(true)));table.dispatchEvent(new Event('remap-scale-change'));const caption=document.querySelector('[data-table-caption="'+id+'"]');if(caption)caption.textContent='当前对照规模：'+Number(select.value).toLocaleString('zh-CN')+' 卡';}));
 document.getElementById('report-print')?.addEventListener('click',()=>window.print());
 document.getElementById('report-expand')?.addEventListener('click',e=>{const open=e.currentTarget.getAttribute('aria-expanded')!=='true';document.querySelectorAll('section>details').forEach(d=>d.open=open);e.currentTarget.setAttribute('aria-expanded',String(open));e.currentTarget.textContent=open?'收起机制明细':'展开机制明细';});
})();
</script>`;

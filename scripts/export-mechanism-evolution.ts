/** Presentation-only export: all results are read from an immutable, independently evaluated snapshot. */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  analysisWorkbenchHtml,
  analysisNodeDetail,
  type WorkflowAnalysisView,
} from "../packages/reports/src/audit-analysis-workbench";
import { analysisWorkbenchCss } from "../packages/reports/src/audit-analysis-styles";
import {
  mechanismBenefitMatrix,
  recoveryEvolution,
} from "../packages/reports/src/audit-mechanism-evolution";
import {
  physicalTopology,
  domainGapDetail,
} from "../packages/reports/src/audit-physical-topology";
import { decisionDomains } from "../packages/reports/src/audit-decision-pages";
const source = resolve(
  process.argv[2] ??
    "/workspace/artifacts/remap-loss-matrix-20261029/source/presentation-data.json",
);
const out = resolve(
  process.argv[3] ?? "/workspace/artifacts/remap-mtbf-mttr-heatmaps-20261029",
);
mkdirSync(out + "/source", { recursive: true });
const raw = readFileSync(source),
  data = JSON.parse(raw.toString()),
  c = data.comparison,
  d = c.topologyDecision;
copyFileSync(source, out + "/source/presentation-data.json");
const matrix = mechanismBenefitMatrix(c);
const visual = {
  sourceSha256: createHash("sha256").update(raw).digest("hex"),
  matrix,
  scales: d.scales.map((s: any) => ({
    cards: s.cards,
    evolution: recoveryEvolution(d, s.cards),
    scenarios: s.scenarios.map((st: any) => ({
      name: st.name,
      domains: decisionDomains.map(([id]) => ({
        id,
        ...domainGapDetail(st, id),
      })),
    })),
  })),
};
writeFileSync(
  out + "/source/visual-data.json",
  JSON.stringify(visual, null, 2),
);
const architecture = c.entries[0].architectureDiagnosis.architecture;
for (const s of d.scales)
  for (const st of s.scenarios)
    writeFileSync(
      `${out}/source/topology-${s.cards}-${st.trainingScenario.id}.svg`,
      physicalTopology(
        st,
        s.counts,
        architecture,
        c.entries.find((e: any) => e.name === st.name).events,
      ),
    );
const views: WorkflowAnalysisView[] = [
  "architecture",
  "overview",
  "loss",
  "verification",
];
const names = [
  "01 目标分解分配",
  "02 可用度评估",
  "03 机制设计",
  "04 机制验证",
];
const panels = d.scales
  .flatMap((s: any) =>
    views.map(
      (v, i) =>
        `<article data-panel="${s.cards}-${v}" ${s.cards === 500000 && i === 0 ? "" : "hidden"}>${analysisWorkbenchHtml(c, s.cards, v)}</article>`,
    ),
  )
  .join("");
const details = d.scales
  .flatMap((s: any) =>
    s.scenarios[0].nodes.map(
      (n: any) =>
        `<template id="detail-${s.cards}-${n.id}">${analysisNodeDetail(s.scenarios[0], d, s.cards, n.id)}</template>`,
    ),
  )
  .join("");
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ReMAP · 六层分配、损失与措施收益</title><style>body{margin:0;background:#f4f7f9;font:15px system-ui,'Noto Sans CJK SC',sans-serif;color:#20384a}main{max-width:1840px;margin:auto;padding:25px}nav{position:sticky;top:0;background:#18394f;color:white;padding:16px 25px;z-index:5;display:flex;gap:16px;align-items:center}button,select{padding:9px;font:inherit;border:1px solid #b8cddd;border-radius:5px;background:#f4f8fc;color:#245e83}button[aria-pressed=true]{background:#6d9bbe;color:white}dialog{width:90%;max-width:1600px;border:1px solid #b2c5d3;border-radius:10px}dialog::backdrop{background:#18394f88}[hidden]{display:none!important}${analysisWorkbenchCss}</style><nav><b>ReMAP 可靠性设计与评估</b><select aria-label="分析规模" id="scale">${d.scales.map((s: any) => `<option value="${s.cards}" ${s.cards === 500000 ? "selected" : ""}>${s.cards / 10000}万卡</option>`).join("")}</select>${views.map((v, i) => `<button data-view="${v}" aria-pressed="${i === 0}">${names[i]}</button>`).join("")}</nav><main><p>流程：先定位损失与分配缺口 → 比较措施收益 → 明确参数变化 → 独立仿真验证。三阶段使用原冻结计算快照；此版更新展示。</p>${panels}</main>${details}<dialog id="detail"><button id="close">关闭</button><div id="content" class="reliability-analysis"></div></dialog><script>let view='architecture';const scale=document.getElementById('scale');function show(){document.querySelectorAll('[data-panel]').forEach(e=>e.hidden=e.dataset.panel!==scale.value+'-'+view);document.querySelectorAll('[data-view]').forEach(e=>e.setAttribute('aria-pressed',e.dataset.view===view));}scale.addEventListener('change',show);document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b){view=b.dataset.view;show();}const n=e.target.closest('[data-analysis-node]');if(n){const t=document.getElementById('detail-'+scale.value+'-'+n.dataset.analysisNode);if(t){document.getElementById('content').replaceChildren(t.content.cloneNode(true));document.getElementById('detail').showModal();}}});document.getElementById('close').onclick=()=>document.getElementById('detail').close();</script></html>`;
writeFileSync(out + "/ReMAP-六层分配与双热力图.html", html);
console.log(
  JSON.stringify(
    {
      out,
      sourceSha256: visual.sourceSha256,
      stages: matrix.stages.map((s) => ({
        name: s.name,
        measured: s.cells.flat().filter((c) => c.pp != null).length,
        gains: s.gains,
      })),
      evolution: visual.scales.at(-1).evolution.map((s: any) => ({
        name: s.name,
        total: s.total,
        mtbf: s.mtbfMinutes,
        mttr: s.equivalentMttrSeconds,
      })),
    },
    null,
    2,
  ),
);

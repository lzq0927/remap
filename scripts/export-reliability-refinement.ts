import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
} from "../packages/analysis/src/audit";
import {
  applyTrainingScenario,
  trainingScenarioPreset,
} from "../packages/contracts/src/audit-training-scenario";
import { compareAuditExperiments } from "../packages/reports/src/audit-experiments";
import {
  decisionPageSvg,
  decisionViews,
  esc,
} from "../packages/reports/src/audit-decision-pages";
import { compareNetworkLayouts } from "../packages/analysis/src/audit-network-study";
import { networkStudyDemo } from "../packages/contracts/src/audit-network-study";
import { networkStudyHtml } from "../packages/reports/src/audit-network-study";
import { reliabilityEvidence } from "../packages/reports/src/audit-research";
const out = process.argv[2] ?? "/workspace/artifacts/remap-refinement-20261027";
mkdirSync(out, { recursive: true });
const events = getAuditEvents();
const scope = events
  .filter(
    (e) =>
      e.type === "hard" &&
      [
        "CORE",
        "SRAM",
        "IOD",
        "MODULE",
        "MEMT",
        "MEMP",
        "CPU",
        "DDR",
        "SSD",
      ].includes(e.id.split("-")[0]),
  )
  .map((e) => e.id);
const defaults = getAuditDefaults();
const source =
  "2026-10-27 用户交接参数重建独立情景；原未提交文件/快照在本环境缺失，非原结果重放；保留所有继承参数";
const runs = ["current", "extension", "breakthrough"].map((id, i) => {
  if (process.argv.includes("--render-only"))
    return JSON.parse(readFileSync(`${out}/${id}-snapshot.json`, "utf8"));
  const preset = trainingScenarioPreset(
    id as "current" | "extension" | "breakthrough",
  );
  const s = {
    ...preset,
    source,
    mtbfEventIds: scope,
    exposureByScale: { 10000: 1, 100000: 2, 200000: 2, 500000: 2 },
    checkpointSeconds: id === "current" ? 600 : 1,
    sdcCoverage: id === "current" ? 0.8 : id === "extension" ? 0.95 : 0.9991,
    investigationMapping: "sdc-only" as const,
    assumptionsConfirmed: true,
    ...(id === "breakthrough"
      ? {
          detectionSuccess: 0.998,
          detectionSeconds: 1,
          slowCoverage: 0.975,
          slowDetectionSeconds: 52.6,
          recoverySuccess: 0.999,
          communicationSeconds: 8,
          constructionSeconds: 0,
          loadSeconds: 2,
          compilationSeconds: 5,
        }
      : {}),
  };
  const input = applyTrainingScenario(
    {
      ...defaults,
      seed: 7419231,
      attributionSeed: 7419241,
      trials: id === "breakthrough" ? 1024 : 128,
      attributionTrials: 32,
      verificationTrials: 32,
      verifyRecommendation: false,
      scales: [10000, 100000, 200000, 500000],
      targets: { 10000: 0.985, 100000: 0.985, 200000: 0.985, 500000: 0.985 },
      sensitivity: false,
      optimization: { enabled: false },
    },
    s,
    events,
  );
  const inputHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const result = audit(input);
  const run = {
    id: "refinement-" + i,
    status: "succeeded",
    inputHash,
    createdAt: new Date().toISOString(),
    result,
  };
  writeFileSync(`${out}/${id}-snapshot.json`, JSON.stringify(run, null, 2));
  console.log(
    id,
    result.rows
      .filter((r: any) => r.id === "combined")
      .map((r: any) => ({
        cards: r.cards,
        availability: r.statistics.mean,
        ci: [r.statistics.ciLow, r.statistics.ciHigh],
      })),
  );
  return run;
});
const comparison = compareAuditExperiments(runs as any);
writeFileSync(`${out}/comparison.json`, JSON.stringify(comparison, null, 2));
const network = compareNetworkLayouts(
  { ...networkStudyDemo, trials: 200000, seed: 7419231 },
  489,
);
const capacity = compareNetworkLayouts(
  { ...networkStudyDemo, requiredPlanes: 7, trials: 200000, seed: 7419231 },
  489,
);
writeFileSync(
  `${out}/network-study.json`,
  JSON.stringify({ full: network, degraded: capacity }, null, 2),
);
console.log(
  "network",
  network.rows.map((r) => ({
    name: r.name,
    bdd: r.availability,
    mc: r.sample.availability,
    ci: r.sample.interval95,
  })),
);
let pages = "";
for (const view of decisionViews.filter((v) => v.id !== "research")) {
  const svg = decisionPageSvg(comparison, 500000, view.id);
  writeFileSync(`${out}/${view.id}.svg`, svg);
  pages += `<section class="slide">${svg}</section>`;
}
for (const cards of [10000, 100000, 200000])
  for (const view of ["architecture", "loss"] as const)
    writeFileSync(
      `${out}/${view}-${cards}.svg`,
      decisionPageSvg(comparison, cards, view),
    );
const evidence = `<h1>下一代集群：候选措施与验证路线</h1><p>公开证据核对：2026-10-27。下列措施须按本项目约束复评；不将论文收益直接作为产品FIT或承诺。</p><table><thead><tr><th>机制 / 责任域</th><th>设计建议</th><th>验证要求</th><th>公开依据</th></tr></thead><tbody>${reliabilityEvidence.map((e) => `<tr><th>${e.id} ${e.name}<br>${e.domain}</th><td>${e.recommendation}</td><td>${e.validation}</td><td><a href="${esc(e.url)}">${e.source}</a></td></tr>`).join("")}</tbody></table>`;
const appendix = [10000, 100000, 200000]
  .map(
    (c) =>
      `<section class="slide">${decisionPageSvg(comparison, c, "loss")}</section>`,
  )
  .join("");
writeFileSync(
  `${out}/research.svg`,
  decisionPageSvg(comparison, 500000, "research"),
);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ReMAP 架构与可靠性措施评审</title><style>body{margin:0;font-family:'Noto Sans CJK SC',sans-serif;color:#233c51;background:#edf2f5}.slide{width:1800px;background:white;break-after:page}.slide svg{display:block}.content{box-sizing:border-box;padding:40px;width:1800px;background:#fff;break-after:page}table{width:100%;border-collapse:collapse;font-size:19px}td,th{border:1px solid #d7e1e7;padding:16px;text-align:left}th{background:#eaf1f7}p{line-height:1.6;font-size:20px}small{display:block}h1{color:#17384d}a{color:#316b9a}@page{size:1800px 1080px;margin:0}@media print{body{background:white}}</style><section class="content"><h1>ReMAP · 架构、损失与措施评审包</h1><p>本包为当前仓库版本重新计算的独立情景；上一轮未提交源码及快照在本环境中未恢复，不能视为此前97.11%等数值的原样重放。</p><p>600小时、98.5%目标、9小时总预算。万卡所选中断暴露×1，较大规模×2；卡数与硬件数量不重复翻倍。MTBF统一命名，事件范围单独记录。</p><p>现状/延长线128条，突破1024条独立主轨迹；主种子7419231。Shapley每组合32条，单列采样误差，不用低样本排名证明显著性。完整输入、继承参数、哈希与结果见JSON快照。</p><p>新代存储、链路数量及单位FIT尚无确认BOM；本包没有将这些未知增量混入正式曲线。可通过独立节点暴露倍率评估，不与已扩大数量重复计算。</p><p>网络验证采用显式演示FIT，故意提高失效概率；用于比较方法，不作为项目达标结论。公开参考与建议均在末页列出来源。</p></section>${pages}<section class="content"><h1>组网辅助对照 · 光模块与共享故障</h1>${networkStudyHtml(network)}<p>容量敏感性：将8/8放宽为7/8时，三种结构BDD值为 ${capacity.rows.map((r) => (r.availability * 100).toFixed(5) + "%").join(" / ")}。这是假设允许少一个平面继续工作；须计入相应吞吐损失，不能据此直接宣布600小时可用度提高。</p></section><section class="content">${evidence}</section>${appendix}</html>`;
writeFileSync(`${out}/ReMAP-review.html`, html);
writeFileSync(
  `${out}/summary.json`,
  JSON.stringify(
    {
      runs: runs.map((r) => ({
        id: r.id,
        hash: r.inputHash,
        trials: r.result.request.trials,
        rows: r.result.rows
          .filter((v: any) => v.id === "combined")
          .map((v: any) => ({ cards: v.cards, statistics: v.statistics })),
      })),
      network: network.rows.map((r) => ({
        name: r.name,
        bdd: r.availability,
        mc: r.sample,
      })),
    },
    null,
    2,
  ),
);

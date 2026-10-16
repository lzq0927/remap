import { hash } from "../packages/assets/src/hash";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { audit, getAuditDefaults } from "../packages/analysis/src/audit";
import { auditExperiment } from "../packages/analysis/src/audit-experiments";
import { auditExperimentPlan } from "../packages/analysis/src/audit-experiment-plan";
import { compareAuditExperiments } from "../packages/reports/src/audit-experiments";
import { report } from "../packages/reports/src/render";
import { auditSamplingPreset } from "../packages/contracts/src/audit-presets";
import { enterProject } from "./runtime.mjs";
enterProject();
const expert = process.argv.includes("--expert");
const output = resolve(
  "artifacts/architecture-diagnosis",
  expert ? "full" : "quick",
);
await mkdir(output, { recursive: true });
const reuse = process.argv.includes("--reuse-first");
const saved = reuse
  ? JSON.parse(await readFile(join(output, "architecture-first.json"), "utf8"))
  : undefined;
const input = saved?.input ??
  saved?.result.request ?? {
    ...getAuditDefaults(),
    ...auditSamplingPreset(expert ? "expert-reproduction" : "quick"),
  };
const createdAt = saved?.createdAt ?? new Date().toISOString();
console.log("开始：冻结现状、分层诊断与独立改进；" + input.trials + "条主采样");
const firstResult: ReturnType<typeof audit> = saved?.result ?? audit(input);
assert.equal(firstResult.request.samplingProfile, input.samplingProfile);
await writeFile(
  join(output, "architecture-first.json"),
  JSON.stringify(
    {
      id: "architecture-first",
      inputHash: hash(input),
      createdAt,
      operation: "audit",
      status: "succeeded",
      input,
      result: firstResult,
    },
    null,
    2,
  ),
);
const source = {
  id: "architecture-first",
  inputHash: hash(input),
  createdAt,
  input,
  result: firstResult,
};
const frozen = JSON.stringify(firstResult);
console.log(
  "第一轮完成：" +
    firstResult.rows.find((r) => r.id === "combined" && r.cards === input.cards)
      .statistics.mean,
);
const planResult = auditExperimentPlan({
  source,
  options: { enabled: true, screeningTrials: 128 },
});
assert.equal(planResult.scenarioEvaluated, false);
for (const allocation of planResult.allocations)
  assert(Math.abs(allocation.responsibilityResidualHours) < 1e-7);
console.log("分配建议完成；未自动替换第一轮：" + planResult.prediction.mean);
const scenarioResult = auditExperiment({
  source,
  name: "分层诊断后AGREE改进",
  configuration: planResult.configuration,
  plan: { id: "architecture-plan", inputHash: "planning", result: planResult },
});
assert.equal(JSON.stringify(firstResult), frozen);
const runs = [
  {
    id: source.id,
    inputHash: source.inputHash,
    createdAt,
    operation: "audit",
    status: "succeeded",
    input,
    result: firstResult,
  },
  {
    id: "architecture-plan",
    inputHash: "planning",
    createdAt,
    operation: "audit-plan",
    status: "succeeded",
    result: planResult,
  },
  {
    id: "architecture-scenario",
    inputHash: scenarioResult.configurationHash,
    createdAt,
    operation: "audit-experiment",
    status: "succeeded",
    result: scenarioResult,
  },
];
const comparison = compareAuditExperiments([runs[0], runs[2]] as any);
runs.push({
  id: "architecture-comparison",
  inputHash: "comparison",
  createdAt,
  operation: "audit-compare",
  status: "succeeded",
  result: comparison,
} as any);
for (const run of runs) {
  for (const scale of run.result.architectureDiagnosis?.scales ?? [])
    assert(Math.abs(scale.residualHours) < 1e-7);
  await writeFile(join(output, run.id + ".json"), JSON.stringify(run, null, 2));
  await writeFile(join(output, run.id + ".html"), report(run as any, "html"));
  await writeFile(join(output, run.id + ".md"), report(run as any, "md"));
}
const evidence = {
  createdAt,
  profile: input.samplingProfile,
  firstRoundUnchanged: true,
  layerAccountingConserved: true,
  planningIsNotEvaluation: true,
  first: firstResult.architectureDiagnosis.scales.map((s) => ({
    cards: s.cards,
    referenceOnly: s.referenceOnly,
    target: s.referenceOnly ? null : s.target,
    mean: s.statistics.mean,
    residualHours: s.residualHours,
    weaknesses: s.weaknesses.slice(0, 3),
    ranking: s.ranking.map((c: any) => ({
      id: c.id,
      rank: c.rank,
      mean: c.statistics.mean,
    })),
  })),
  prediction: planResult.prediction,
  configuration: planResult.configuration,
  scenario: scenarioResult.rows.map((r) => ({
    cards: r.cards,
    mean: r.statistics.mean,
    ciLow: r.statistics.ciLow,
    ciHigh: r.statistics.ciHigh,
    referenceOnly: r.referenceOnly,
    target: r.referenceOnly ? null : r.target,
    status: r.referenceOnly ? "reference-only" : r.status,
  })),
  notes: [
    "计算验证，不是产品实测或工程可行性签认",
    "功能分层模板与均分预算需按真实项目复核",
  ],
};
await writeFile(
  join(output, "verification.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(
  JSON.stringify({ output, firstUnchanged: true, scales: evidence.scenario }),
);

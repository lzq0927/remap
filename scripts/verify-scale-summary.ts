import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { audit, getAuditDefaults } from "../packages/analysis/src/audit";
import { auditSamplingPreset } from "../packages/contracts/src/audit-presets";
import { auditPlanScales } from "../packages/analysis/src/audit-plan-scales";
import {
  lossTimeSegments,
  orderedDiagnosisScales,
} from "../packages/reports/src/audit-scale-summary";
import { report } from "../packages/reports/src/render";
import { hash } from "../packages/assets/src/hash";
import { enterProject } from "./runtime.mjs";
enterProject();
const expert = process.argv.includes("--expert"),
  decision = process.argv.includes("--decision"),
  directory = resolve(
    "artifacts",
    decision ? "decision-study" : "scale-summary",
    expert ? "full" : "quick",
  );
await mkdir(directory, { recursive: true });
const cached = resolve(
  "artifacts/architecture-diagnosis/full/architecture-first.json",
);
const stored =
  expert && existsSync(cached)
    ? JSON.parse(await readFile(cached, "utf8"))
    : undefined;
const input = stored?.result.request ?? {
  ...getAuditDefaults(),
  ...auditSamplingPreset(expert ? "expert-reproduction" : "quick"),
};
const first: ReturnType<typeof audit> = stored?.result ?? audit(input),
  frozen = JSON.stringify(first);
if (expert) assert.equal(first.request.trials, 4000);
const source = {
  id: stored?.id ?? "summary-first",
  inputHash: stored?.inputHash ?? hash(input),
  createdAt: stored?.createdAt ?? new Date().toISOString(),
  input,
  result: first,
};
console.log("现状已读取；主采样" + input.trials + "，开始按需求规模分别规划。");
const result = auditPlanScales(
  { source, options: { enabled: true, screeningTrials: expert ? 128 : 16 } },
  (fraction) => {
    if (fraction === 1) console.log("全部规模建议已生成，未启动独立复评。");
  },
);
assert.equal(JSON.stringify(first), frozen);
assert.equal(result.scenarioEvaluated, false);
const scales = orderedDiagnosisScales(first.architectureDiagnosis);
for (const mode of ["loss", "layer", "type"] as const)
  for (const s of lossTimeSegments(first.architectureDiagnosis, mode))
    assert(
      Math.abs(s.segments.reduce((sum, p) => sum + p.hours, 0) - s.totalHours) <
        1e-7,
    );
for (const [name, operation, value] of [
  ["first", "audit", first],
  ["plans", "audit-plan-scales", result],
] as const) {
  const run = {
    id: name === "first" ? source.id : "summary-plans",
    inputHash: name === "first" ? source.inputHash : hash(result),
    createdAt: source.createdAt,
    status: "succeeded",
    operation,
    input: name === "first" ? input : { source },
    result: value,
  };
  await writeFile(
    join(directory, name + ".json"),
    JSON.stringify(run, null, 2),
  );
  for (const format of ["html", "md"])
    await writeFile(
      join(directory, name + "." + format),
      report(run as any, format),
    );
}
if (decision)
  for (const p of result.plans) {
    const run = {
      id: "decision-plan-" + p.prediction.cards,
      operation: "audit-plan",
      status: "succeeded",
      input: { source },
      result: p,
    };
    for (const format of ["html", "md", "json"])
      await writeFile(
        join(directory, "plan-" + p.prediction.cards + "." + format),
        format === "json"
          ? JSON.stringify(run, null, 2)
          : report(run as any, format),
      );
  }
const evidence = {
  profile: input.samplingProfile,
  trials: input.trials,
  sourceRunId: source.id,
  firstUnchanged: true,
  scenarioEvaluated: false,
  summaryOrder: scales.map((s) => s.cards),
  ledgerConserved: true,
  plans: result.plans.map((p) => ({
    cards: p.prediction.cards,
    target: p.prediction.target,
    prediction: p.prediction.mean,
    planningSupported: p.prediction.supported,
    configuration: p.configuration,
    measures: p.factors.map((f: any) => ({ id: f.id, name: f.name })),
    notes: p.prediction.note,
    decision: p.decisionStudy
      ? {
          search: p.decisionStudy.search,
          alternatives: p.decisionStudy.alternatives.map((a: any) => ({
            id: a.id,
            label: a.label,
            effort: a.effort,
            mean: a.nominal.statistics.mean,
            conservative: a.conservative?.statistics.mean,
          })),
          curveTrials: p.decisionStudy.trials,
        }
      : undefined,
  })),
};
await writeFile(
  join(directory, "verification.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(
  JSON.stringify({
    directory,
    scales: evidence.summaryOrder,
    plans: evidence.plans.map((p) => ({
      cards: p.cards,
      target: p.target,
      prediction: p.prediction,
    })),
  }),
);

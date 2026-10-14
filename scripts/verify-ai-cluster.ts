import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import JSZip from "jszip";
import { buildApp } from "../apps/api/src/server";
import { draftFromAuditRequest } from "../packages/contracts/src/audit-draft";
import {
  auditDefaultTargets,
  auditReferenceMechanisms,
  auditSamplingPreset,
} from "../packages/contracts/src/audit-presets";
import { enterProject } from "./runtime.mjs";

enterProject();
const output = resolve("artifacts/ai-cluster");
await mkdir(output, { recursive: true });
const app = await buildApp({ dataDir: ":memory:", seed: false });
const evidence: any = {
  startedAt: new Date().toISOString(),
  scope:
    "Versioned fault baseline and explicit engineering scenarios; workflow acceptance, not measured achievement or expert sign-off",
  agentInference: false,
};
try {
  const task = app.taskServices.create("AI 集群 · 六阶段样例验收"),
    base = `/api/tasks/${task.id}`;
  const call = async (path: string, payload?: any) => {
    const response = await app.inject({
      method: payload === undefined ? "GET" : "POST",
      url: base + path,
      ...(payload === undefined ? {} : { payload }),
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const defaults = (await app.inject("/api/defaults")).json();
  const request = {
    ...defaults.audit,
    ...auditSamplingPreset(
      process.argv.includes("--expert") ? "expert-reproduction" : "quick",
    ),
  };
  assert.deepEqual(request.targets, auditDefaultTargets);
  assert.deepEqual(request.mechanisms, auditReferenceMechanisms);
  const design = await call("/design", {
    scenario: "training",
    activeAssessment: "audit",
    request: defaults.training,
    auditDraft: draftFromAuditRequest(request),
  });
  assert(design.assessment.valid);
  assert.equal(design.assessment.metricId, "training.retained-clean-progress");
  let flow = await call("/workflow/start", {
    inputRevision: design.revision,
    mode: "manual",
  });
  const confirm = async (stepId: string, runId?: string) => {
    flow = await call("/workflow", {
      executionId: flow.executionId,
      expectedRevision: flow.revision,
      inputRevision: design.revision,
      stepId,
      status: "confirmed",
      ...(runId ? { artifacts: [{ type: "evaluation", runId }] } : {}),
    });
  };
  for (const step of ["clarify", "describe", "select", "prepare"])
    await confirm(step);
  const started = await call("/runs", {
    executionId: flow.executionId,
    inputRevision: design.revision,
    operation: "audit",
    input: design.assessment.input,
  });
  let run;
  const deadline = Date.now() + 10 * 60_000;
  do {
    await new Promise((r) => setTimeout(r, 500));
    run = await call("/runs/" + started.id);
  } while (["queued", "running"].includes(run.status) && Date.now() < deadline);
  assert.equal(run.status, "succeeded", JSON.stringify(run.error));
  const { assetSnapshot, ...frozenInput } = run.input;
  assert.deepEqual(frozenInput, design.assessment.input);
  assert.deepEqual(assetSnapshot, []);
  assert.equal(run.result.events.length, 54);
  assert.equal(request.cards, 500000);
  assert.equal(request.target, 0.985);
  assert(
    Math.abs(
      run.result.events.find((e: any) => e.id === "CORE-hard").withinTypeShare -
        0.06,
    ) < 1e-14,
  );
  assert(
    Math.abs(
      run.result.events.find((e: any) => e.id === "SRAM-hard").withinTypeShare -
        0.1,
    ) < 1e-14,
  );
  assert.equal(run.result.optimization.status, "evaluated");
  assert.equal(run.result.optimization.scales.length, 4);
  assert.equal(run.result.optimization.attribution.length, 4);
  for (const row of run.result.optimization.scales) {
    assert.equal(
      row.status === "supported",
      row.optimized.statistics.ciLow >= row.target,
    );
    assert(
      Math.abs(
        Object.values(row.optimized.ledger).reduce(
          (s: number, x: any) => s + x,
          0,
        ) +
          row.optimized.statistics.mean * request.hours -
          request.hours,
      ) < 1e-7,
    );
  }
  for (const row of run.result.optimization.attribution)
    assert(Math.abs(row.residual) < 1e-10);
  assert(
    Math.abs(
      run.result.events.reduce((sum: number, e: any) => sum + e.share, 0) - 1,
    ) < 1e-10,
  );
  for (const type of ["hard", "slow", "sdc"])
    assert(
      Math.abs(
        run.result.events
          .filter((e: any) => e.type === type)
          .reduce((sum: number, e: any) => sum + e.withinTypeShare, 0) - 1,
      ) < 1e-10,
    );
  assert.deepEqual(
    run.result.attribution
      .map((a: any) => a.cards)
      .sort((a: number, b: number) => a - b),
    [10000, 100000, 200000, 500000],
  );
  assert(run.result.sensitivity.length > 0);
  assert(run.result.recommendation.verification);
  const comparisons = request.scales.map((cards: number) => {
    const baseline = run.result.rows.find(
        (r: any) => r.cards === cards && r.id === "base",
      ),
      combined = run.result.rows.find(
        (r: any) => r.cards === cards && r.id === "combined",
      );
    assert(baseline && combined);
    const target = request.targets[String(cards)] ?? null;
    return {
      cards,
      target,
      baseline: baseline.statistics.mean,
      combined: combined.statistics.mean,
      ciLow: combined.statistics.ciLow,
      ciHigh: combined.statistics.ciHigh,
      referenceOnly: target === null,
    };
  });
  flow = await call("/workflow");
  assert.equal(flow.steps[4].status, "awaiting-review");
  await confirm("evaluate", run.id);
  await confirm("validate-deliver", run.id);
  assert.equal(flow.status, "succeeded");
  assert(flow.steps.every((s: any) => s.status === "confirmed"));
  const response = await app.inject(base + `/runs/${run.id}/report?format=zip`);
  assert.equal(response.statusCode, 200);
  await writeFile(join(output, "ai-cluster-report.zip"), response.rawPayload);
  const zip = await JSZip.loadAsync(response.rawPayload);
  let html = "";
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name.includes("/") || entry.name.includes("\\"))
      continue;
    await writeFile(join(output, entry.name), await entry.async("nodebuffer"));
    if (entry.name.endsWith(".html")) html = await entry.async("string");
  }
  assert(html.includes("可靠性框图与对象改善"));
  assert(html.includes("独立故障事件库"));
  assert(html.includes("Shapley"));
  assert(!/正确有效产出|正确产出|内网|外网/.test(html));
  assert(html.includes("两轮评估与设计决策"));
  assert(html.includes("优化增量排名"));
  Object.assign(evidence, {
    status: "passed",
    samplingProfile: request.samplingProfile,
    taskId: task.id,
    runId: run.id,
    inputHash: run.inputHash,
    workflow: flow,
    comparisons,
    recommendation: run.result.recommendation,
    optimization: run.result.optimization,
    report: "ai-cluster-report.zip",
  });
  console.log(
    JSON.stringify(
      { status: evidence.status, comparisons, reportDirectory: output },
      null,
      2,
    ),
  );
} catch (error) {
  evidence.status = "failed";
  evidence.error = (error as Error).message;
  process.exitCode = 1;
  console.error(evidence.error);
} finally {
  evidence.completedAt = new Date().toISOString();
  await writeFile(
    join(output, "verification.json"),
    JSON.stringify(evidence, null, 2),
  );
  await app.close();
}

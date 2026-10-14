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
const output = resolve(
  process.argv.includes("--separate")
    ? "artifacts/separate-rounds"
    : "artifacts/ai-cluster",
);
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
  assert.equal(run.result.optimization, null);
  assert.equal(run.result.config.policy["D-SDC"].coverage, 0.95);
  console.log("第一轮现状已完成，原六项与95%覆盖保持冻结");
  const frozenFirst = JSON.stringify(run.result);
  const waitRun = async (id: string) => {
    let next;
    const limit = Date.now() + 10 * 60_000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 300));
      next = await call("/runs/" + id);
    } while (["queued", "running"].includes(next.status) && Date.now() < limit);
    assert.equal(next.status, "succeeded", JSON.stringify(next.error));
    return next;
  };
  const manual = await waitRun(
    (
      await call("/audit/evaluate", {
        sourceRunId: run.id,
        name: "仅提高静默检出率至99.5%",
        configuration: {
          enabled: true,
          policy: { "D-SDC": { coverage: 0.995 } },
        },
      })
    ).id,
  );
  assert.equal(manual.result.factors.length, 1);
  assert.deepEqual(manual.result.factors[0].value, { coverage: 0.995 });
  console.log("单项99.5%改进已独立完成");
  const plan = await waitRun(
    (
      await call("/audit/plan", {
        sourceRunId: run.id,
        options: { screeningTrials: 128 },
      })
    ).id,
  );
  assert.equal(plan.result.scenarioEvaluated, false);
  assert.equal(
    (await call("/runs")).filter((r: any) => r.operation === "audit-experiment")
      .length,
    1,
  );
  console.log("AGREE分配建议已完成，第二轮尚未启动");
  const improved = await waitRun(
    (
      await call("/audit/evaluate", {
        sourceRunId: run.id,
        name: "AGREE分配后的改进方案",
        configuration: plan.result.configuration,
        planRunId: plan.id,
      })
    ).id,
  );
  assert.deepEqual(improved.result.configuration, {
    ...plan.result.configuration,
    enabled: true,
    autoTune: false,
  });
  for (const scenario of [manual, improved]) {
    for (const row of scenario.result.rows) {
      assert.equal(
        row.status === "supported",
        row.statistics.ciLow >= row.target,
      );
      assert(
        Math.abs(
          Object.values(row.ledger).reduce(
            (sum: number, value: any) => sum + value,
            0,
          ) +
            row.statistics.mean * request.hours -
            request.hours,
        ) < 1e-7,
      );
    }
    for (const attribution of scenario.result.attribution)
      assert(Math.abs(attribution.residual) < 1e-10);
  }
  assert.equal(
    JSON.stringify((await call("/runs/" + run.id)).result),
    frozenFirst,
  );
  const comparison = await call("/audit/compare", {
    runIds: [run.id, manual.id, improved.id],
  });
  assert.equal(comparison.result.entries.length, 3);
  for (const [label, evaluated] of [
    ["first", run],
    ["manual", manual],
    ["allocation", plan],
    ["improved", improved],
    ["comparison", comparison],
  ] as const) {
    const packageResponse = await app.inject(
      base + `/runs/${evaluated.id}/report?format=zip`,
    );
    assert.equal(packageResponse.statusCode, 200);
    await writeFile(
      join(output, label + "-report.zip"),
      packageResponse.rawPayload,
    );
    const packageZip = await JSZip.loadAsync(packageResponse.rawPayload);
    for (const file of Object.values(packageZip.files)) {
      if (file.dir || file.name.includes("/") || file.name.includes("\\"))
        continue;
      await writeFile(join(output, file.name), await file.async("nodebuffer"));
      if (file.name.endsWith(".html"))
        await writeFile(
          join(output, label + "-report.html"),
          await file.async("nodebuffer"),
        );
    }
  }
  Object.assign(evidence, {
    firstRoundUnchanged: true,
    separateExecution: true,
    planRunId: plan.id,
    manualRunId: manual.id,
    improvedRunId: improved.id,
    comparisonRunId: comparison.id,
    roundComparison: comparison.result.entries.map((entry: any) => ({
      name: entry.name,
      id: entry.id,
      rows: entry.rows.map((row: any) => ({
        cards: row.cards,
        mean: row.statistics.mean,
        ciLow: row.statistics.ciLow,
        ciHigh: row.statistics.ciHigh,
        target: row.target,
        status: row.status,
      })),
    })),
    proposedConfiguration: plan.result.configuration,
    planningPrediction: plan.result.prediction,
  });
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
  assert(!html.includes("两轮评估与设计决策"));
  const comparisonHtml = (
    await app.inject(base + `/runs/${comparison.id}/report?format=html`)
  ).body;
  assert(comparisonHtml.includes("参数横向比较"));
  assert(comparisonHtml.includes("独立结论"));
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
      {
        status: evidence.status,
        comparisons: evidence.roundComparison,
        proposedConfiguration: evidence.proposedConfiguration,
        reportDirectory: output,
      },
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

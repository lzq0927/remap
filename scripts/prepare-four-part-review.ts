/** Reproducible review task: retain original scenarios, run the four-part workflow,
 * and compare frozen current/extension snapshots against a new independent validation. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { buildApp } from "../apps/api/src/server";
import { importTask, exportTask } from "../packages/tasks/src/portable";
import { draftFromAuditRequest } from "../packages/contracts/src/audit-draft";
import { analysisWorkbenchHtml } from "../packages/reports/src/audit-analysis-workbench";
import { analysisWorkbenchCss } from "../packages/reports/src/audit-analysis-styles";
import { hash } from "../packages/assets/src/hash";
import type { AuditRequest } from "../packages/analysis/src/audit";
const source = resolve(
  process.argv[2] ??
    "/workspace/artifacts/remap-platform-analysis-20261027/task-bundle.json",
);
const output = resolve(
  process.argv[3] ?? "/workspace/artifacts/remap-four-part-20261029",
);
mkdirSync(output + "/source", { recursive: true });
const app = await buildApp({
  dataDir: resolve(process.env.DATA_DIR ?? "data"),
  seed: false,
  automaticStageDisplayMs: 0,
});
try {
  const task = importTask(
    app.taskServices,
    JSON.parse(readFileSync(source, "utf8")),
    "ReMAP · 四部分流程与独立验证 · 2026-10-29",
  );
  const { store } = app.taskServices.resolve(task.id),
    base = `/api/tasks/${task.id}`;
  const originals = ["current", "extension", "breakthrough"].map(
    (id) =>
      store
        .runs()
        .find(
          (r) =>
            r.operation === "audit" &&
            r.result?.request.trainingScenario?.id === id,
        )!,
  );
  const post = async (path: string, payload: any) => {
    const r = await app.inject({ method: "POST", url: base + path, payload });
    if (r.statusCode >= 300) throw Error(r.body);
    return r.json();
  };
  const draft = {
    ...structuredClone(originals[2].input as AuditRequest),
    samplingProfile: undefined,
    trials: 128,
    verificationTrials: 1024,
    sensitivity: false,
    verifyRecommendation: false,
  };
  const design = await post("/design", {
    request: {},
    scenario: "training",
    activeAssessment: "audit",
    auditDraft: draftFromAuditRequest(draft),
    stage: 0,
  });
  const started = await post("/workflow/automatic", {
    inputRevision: design.revision,
  });
  console.log(
    JSON.stringify({
      taskId: task.id,
      executionId: started.executionId,
      status: "running",
    }),
  );
  let state: any;
  const deadline = Date.now() + 20 * 60 * 1000;
  while (true) {
    state = (await app.inject(base + "/workflow")).json();
    if (state.steps.some((s: any) => s.status === "failed"))
      throw Error(
        JSON.stringify({
          taskId: task.id,
          failed: state.steps
            .filter((s: any) => s.status === "failed")
            .map((s: any) => ({ id: s.id, notes: s.notes })),
        }),
      );
    if (state.steps[3].status === "awaiting-review") break;
    if (Date.now() > deadline) throw Error("Workflow timed out");
    await pause(300);
  }
  const verification = (await app.inject(base + "/runs/" + state.runId)).json();
  const assessment = store.getRun(state.assessmentRunId);
  const compareQueued = await post("/audit/compare", {
    runIds: [originals[0].id, originals[1].id, verification.id],
  });
  let comparison: any;
  while (true) {
    comparison = store.getRun(compareQueued.id);
    if (comparison.status === "failed")
      throw Error(JSON.stringify(comparison.error));
    if (comparison.status === "succeeded") break;
    await pause(300);
  }
  await post("/design", {
    ...design,
    expectedRevision: design.revision,
    runId: comparison.id,
    stage: 3,
  });
  const provenance = {
    createdAt: new Date().toISOString(),
    source,
    sourceHash: hash(JSON.parse(readFileSync(source, "utf8"))),
    taskId: task.id,
    comparisonRunId: comparison.id,
    assessmentRunId: assessment.id,
    verificationRunId: verification.id,
    originalRunIds: originals.map((r) => r.id),
    url: `http://127.0.0.1:5173/?task=${task.id}`,
    note: "前两档沿用2026-10-27平台冻结重建情景；突破档采用本次独立种子1024轨迹复核。非此前98.719%快照重放；现状基线待校准。模型参数不代表产品已具备能力。",
  };
  for (const [name, data] of Object.entries({
    "task-bundle": exportTask(app.taskServices, task.id),
    "platform-task": provenance,
    comparison: comparison,
    verification: verification,
    assessment: assessment,
    workflow: state,
  }))
    writeFileSync(
      `${output}/source/${name}.json`,
      JSON.stringify(data, null, 2),
    );
  writeFileSync(
    `${output}/source/presentation-data.json`,
    JSON.stringify(
      {
        comparison: comparison.result,
        verification: verification.result,
        assessment: assessment.result,
        originals: originals.map((r) => ({
          id: r.id,
          input: r.input,
          attribution: r.result.attribution,
        })),
        provenance,
      },
      null,
      2,
    ),
  );
  const views = ["architecture", "overview", "loss", "verification"] as const;
  writeFileSync(
    `${output}/ReMAP-四部分分析.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ReMAP 四部分分析</title><style>body{margin:0 auto;padding:24px;max-width:1500px;background:#f4f7f9;font-family:Arial,sans-serif}nav{position:sticky;top:0;background:white;padding:14px;z-index:20}nav a{margin-right:24px}section[id]{scroll-margin-top:60px}${analysisWorkbenchCss}</style><h1>ReMAP · 四部分可靠性分析</h1><p>600 h固定窗口 · 四种规模统一98.5%目标 · 2026-10-29</p><p>${provenance.note}</p><nav>${views.map((v, i) => `<a href="#${v}">${i + 1} ${["目标分解分配", "可用度评估", "可靠性机制设计", "可靠性机制验证"][i]}</a>`).join("")}</nav>${views.map((v) => `<section id="${v}">${analysisWorkbenchHtml(comparison.result, 500000, v)}</section>`).join("")}<section>${analysisWorkbenchHtml(comparison.result, 500000, "scales")}</section><section>${analysisWorkbenchHtml(comparison.result, 500000, "research")}</section></html>`,
  );
  console.log(
    JSON.stringify({
      ...provenance,
      output,
      status: "completed-awaiting-human-review",
    }),
  );
} finally {
  await app.close();
}

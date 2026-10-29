/** Persist independently computed snapshots, paired improvement studies and a four-part verification task. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { buildApp } from "../apps/api/src/server";
import { exportTask } from "../packages/tasks/src/portable";
import { draftFromAuditRequest } from "../packages/contracts/src/audit-draft";
import { analysisWorkbenchHtml } from "../packages/reports/src/audit-analysis-workbench";
import { analysisWorkbenchCss } from "../packages/reports/src/audit-analysis-styles";
import type { AuditOptimizationRequest } from "../packages/contracts/src/audit-optimization";
const out = resolve(
  process.argv[2] ?? "/workspace/artifacts/remap-loss-matrix-20261029",
);
const read = (name: string) =>
  JSON.parse(readFileSync(`${out}/source/${name}.json`, "utf8"));
const save = (name: string, data: any) =>
  writeFileSync(`${out}/source/${name}.json`, JSON.stringify(data, null, 2));
const app = await buildApp({
  dataDir: resolve(process.env.DATA_DIR ?? "data"),
  seed: false,
  automaticStageDisplayMs: 0,
});
try {
  const prior = existsSync(out + "/source/platform-task.json")
    ? read("platform-task")
    : undefined;
  const task = prior
    ? app.taskServices.resolve(prior.taskId).task
    : app.taskServices.create("ReMAP · 三阶段损失矩阵与措施收益 · 2026-10-29");
  const { store, runs } = app.taskServices.resolve(task.id),
    base = `/api/tasks/${task.id}`;
  const post = async (path: string, payload: any) => {
    const r = await app.inject({ method: "POST", url: base + path, payload });
    if (r.statusCode >= 300) throw Error(r.body);
    return r.json();
  };
  const wait = async (id: string) => {
    for (;;) {
      const r = store.getRun(id);
      if (r.status === "succeeded") return r;
      if (r.status === "failed") throw Error(JSON.stringify(r.error));
      await pause(400);
    }
  };
  const snapshots = [
    "current",
    "extension",
    "breakthrough",
    "attachment-parameters",
  ].map((id) => {
    const s = read(id + "-snapshot");
    const old = store.runs().find((r) => r.input?.reviewSnapshot === id);
    if (old) return old;
    const started = runs.start("audit", { ...s.input, reviewSnapshot: id });
    // The solver has already executed these exact inputs; preserve its raw output.
    return runs.complete(started.id, s.result);
  });
  const meta = {
    taskId: task.id,
    createdAt: new Date().toISOString(),
    snapshotRunIds: snapshots.map((r) => r.id),
    supersedes: {
      taskId: "ebc380cf-d319-4789-a9d6-ecd8165cfd9c",
      invalidAvailability: 0.99069,
      reason:
        "Exposure-only architecture was omitted in the main solver; corrected rates now match diagnostic rates.",
    },
  };
  save("platform-task", meta);
  console.log(JSON.stringify(meta));
  const source = snapshots[0];
  const studyIds: string[] = [];
  for (const [index, label] of [
    [1, "现状 → 延长线：参数组合增量"],
    [2, "现状 → 突破：参数组合增量"],
  ] as const) {
    const target = snapshots[index].result,
      old = store
        .runs()
        .find(
          (r) =>
            r.operation === "audit-experiment" &&
            r.input?.name === label &&
            r.status === "succeeded",
        );
    if (old) {
      studyIds.push(old.id);
      continue;
    }
    const configuration: AuditOptimizationRequest = {
      enabled: true,
      autoTune: false,
      allowFitTargets: true,
      attributionTrials: 64,
      permutations: 32,
      policy: Object.fromEntries(
        ["D-HARD", "D-SDC", "D-SLOW", "C-FAST"].map((k) => [
          k,
          target.config.policy[k],
        ]),
      ),
      model: Object.fromEntries(
        [
          "recoveryAttemptSeconds",
          "recoverySuccess",
          "manualAdditionalSeconds",
          "sdcDelayHours",
          "slowLifetimeHours",
          "slowLoss",
          "timeoutSeconds",
          "validationOverhead",
        ]
          .map((k) => [k, target.config.model[k]])
          .filter(([, v]) => typeof v === "number"),
      ),
      fitTargets: target.events
        .filter(
          (e: any) =>
            e.fit !== source.result.events.find((b: any) => b.id === e.id)?.fit,
        )
        .map((e: any) => ({
          id: e.id,
          fit: e.fit,
          source: "已冻结突破MTBF情景的逐事件FIT；工程目标，待实测校准",
          evidence: "scenario",
          rateBasis: "npu-equivalent-hour",
        })),
    };
    const queued = await post("/audit/evaluate", {
      sourceRunId: source.id,
      name: label,
      configuration,
    });
    const study = await wait(queued.id);
    studyIds.push(study.id);
    save(index === 1 ? "extension-study" : "breakthrough-study", study);
    console.log(
      JSON.stringify({
        study: label,
        id: study.id,
        attribution: study.result.attribution.find(
          (a: any) => a.cards === 500000,
        ),
      }),
    );
  }
  const comparison = prior?.comparisonRunId
    ? store.getRun(prior.comparisonRunId)
    : await post("/audit/compare", {
        runIds: snapshots.slice(0, 3).map((r) => r.id),
        mechanismStudyRunIds: studyIds,
      });
  const draft = {
    ...read("breakthrough-snapshot").input,
    trials: 128,
    seed: 7419231,
    verificationTrials: 1024,
    verifyRecommendation: false,
  };
  const existingDesign = store.documents("design").at(-1);
  const design =
    existingDesign ??
    (await post("/design", {
      request: {},
      scenario: "training",
      activeAssessment: "audit",
      auditDraft: draftFromAuditRequest(draft),
      stage: 0,
    }));
  let state = (await app.inject(base + "/workflow")).json();
  if (!state.executionId) {
    await post("/workflow/automatic", { inputRevision: design.revision });
  }
  for (;;) {
    state = (await app.inject(base + "/workflow")).json();
    if (state.steps?.some((s: any) => s.status === "failed"))
      throw Error(JSON.stringify(state));
    if (state.steps?.[3]?.status === "awaiting-review") break;
    await pause(400);
  }
  const verification = (await app.inject(base + "/runs/" + state.runId)).json();
  await post("/design", {
    ...design,
    expectedRevision: design.revision,
    runId: comparison.id,
    stage: 3,
  });
  const provenance = {
    ...meta,
    comparisonRunId: comparison.id,
    mechanismStudyRunIds: studyIds,
    verificationRunId: state.runId,
    assessmentRunId: state.assessmentRunId,
    url: `http://127.0.0.1:5173/?task=${task.id}`,
    note: "修复暴露倍率漏用后独立复算；三档固定同一架构/范围/目标，现状及延长线256条，突破1024条独立轨迹。98.696%来自实际损失账，旧99.069%结论失效。现状仍待实测校准。",
  };
  save("platform-task", provenance);
  save("comparison", comparison);
  save("verification", verification);
  save("workflow", state);
  save("task-bundle", exportTask(app.taskServices, task.id));
  const studies = studyIds.map((id) => store.getRun(id));
  save("presentation-data", {
    comparison: comparison.result,
    verification: verification.result,
    studies: studies.map((r) => r.result),
    attachmentCandidate: snapshots[3].result,
    provenance,
  });
  const views = [
    "architecture",
    "overview",
    "loss",
    "verification",
    "scales",
    "research",
  ] as const;
  writeFileSync(
    out + "/ReMAP-三阶段损失与措施分析.html",
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ReMAP三阶段损失与措施</title><style>body{margin:0 auto;padding:24px;max-width:1680px;background:#f4f7f9;font-family:Arial,sans-serif}nav{position:sticky;top:0;background:white;padding:14px;z-index:20}nav a{margin-right:24px}section[id]{scroll-margin-top:60px}${analysisWorkbenchCss}</style><h1>ReMAP · 三阶段损失与措施收益</h1><p>${provenance.note}</p><nav>${views.map((v) => `<a href="#${v}">${{ architecture: "目标分解", overview: "可用度评估", loss: "机制设计", verification: "独立验证", scales: "规模对比", research: "近期实践" }[v]}</a>`).join("")}</nav>${views.map((v) => `<section id="${v}">${analysisWorkbenchHtml(comparison.result, 500000, v)}</section>`).join("")}</html>`,
  );
  console.log(JSON.stringify(provenance));
} finally {
  await app.close();
}

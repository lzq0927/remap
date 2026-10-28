/** Rehydrate genuine completed snapshots into a separate platform task; never mark human workflow review complete. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { TaskServices } from "../packages/tasks/src/service";
import { importTask, exportTask } from "../packages/tasks/src/portable";
import { hash } from "../packages/assets/src/hash";
import { draftFromAuditRequest } from "../packages/contracts/src/audit-draft";
import { compareAuditExperiments } from "../packages/reports/src/audit-experiments";
import { analysisWorkbenchHtml } from "../packages/reports/src/audit-analysis-workbench";
import { analysisWorkbenchCss } from "../packages/reports/src/audit-analysis-styles";
const source = resolve(
  process.argv[2] ?? "/workspace/artifacts/remap-refinement-20261027",
);
const output = resolve(
  process.argv[3] ?? "/workspace/artifacts/remap-platform-analysis-20261027",
);
mkdirSync(output, { recursive: true });
const createdAt = new Date().toISOString();
const runs = ["current", "extension", "breakthrough"].map((id) => {
  const prior = JSON.parse(
    readFileSync(`${source}/${id}-snapshot.json`, "utf8"),
  );
  const input = prior.result.request;
  return {
    id: randomUUID(),
    operation: "audit",
    status: "succeeded" as const,
    input,
    inputHash: hash({ operation: "audit", input }),
    result: prior.result,
    createdAt: prior.createdAt,
    completedAt: prior.createdAt,
    progress: 1,
    events: [],
    provenance: {
      sourceFile: `${id}-snapshot.json`,
      sourceHash: hash(prior),
      sourceInputHash: prior.inputHash,
      importedAt: createdAt,
    },
  };
});
const comparison = compareAuditExperiments(runs),
  input = { runIds: runs.map((r) => r.id) };
const compareRun = {
  id: randomUUID(),
  operation: "audit-compare",
  status: "succeeded" as const,
  input,
  inputHash: hash({ operation: "audit-compare", input }),
  result: comparison,
  createdAt,
  completedAt: createdAt,
  progress: 1,
  events: [],
};
const design = {
  id: "current",
  revision: 1,
  activeAssessment: "audit",
  request: {},
  auditDraft: draftFromAuditRequest(runs[0].input),
  scenario: "training",
  stage: 4,
  confirmed: [],
  runId: compareRun.id,
  savedAt: createdAt,
};
const payload = {
  schemaVersion: "1.0.0",
  task: {
    id: "reliability-analysis-frozen-source",
    name: "ReMAP · 现状分解与可靠性措施分析",
    createdAt,
  },
  rows: {
    assets: [],
    runs: [...runs, compareRun].map((r) => ({
      id: r.id,
      idempotency_key: null,
      payload: JSON.stringify(r),
    })),
    documents: [
      { id: "current", kind: "design", payload: JSON.stringify(design) },
      {
        id: "analysis-provenance",
        kind: "analysis-provenance",
        payload: JSON.stringify({
          source,
          createdAt,
          note: "本任务加载已完成独立情景的冻结快照；仅更新展示与研究证据，不重算或替换历史输入。",
          runs: runs.map((r) => r.provenance),
        }),
      },
    ],
    audit: [],
  },
};
const services = new TaskServices(resolve(process.env.DATA_DIR ?? "data"), {
  autoStart: false,
});
try {
  const task = importTask(
    services,
    { ...payload, contentHash: hash(payload) },
    "ReMAP · 现状分解与可靠性措施分析",
  );
  const { store } = services.resolve(task.id);
  const imported = store.documents("design").at(-1)!;
  // stage is the visible editor tab; human confirmation remains empty.
  store.putDocument("design", { ...imported, stage: 4 }, imported.id);
  writeFileSync(
    `${output}/task-bundle.json`,
    JSON.stringify(exportTask(services, task.id), null, 2),
  );
  writeFileSync(
    `${output}/platform-task.json`,
    JSON.stringify(
      {
        taskId: task.id,
        runId: compareRun.id,
        url: `http://127.0.0.1:5173/?task=${task.id}`,
        dataDir: services.registry.root,
        source,
      },
      null,
      2,
    ),
  );
  const section = (view: any) =>
    analysisWorkbenchHtml(comparison, 500000, view);
  writeFileSync(
    `${output}/ReMAP-平台分析.html`,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ReMAP 平台分析</title><style>body{margin:0 auto;padding:24px;max-width:1440px;background:#f4f7f9}${analysisWorkbenchCss}</style>${section("overview")}${section("scales")}${section("research")}</html>`,
  );
  console.log(
    JSON.stringify({
      taskId: task.id,
      url: `http://127.0.0.1:5173/?task=${task.id}`,
      output,
    }),
  );
} finally {
  await services.close();
}

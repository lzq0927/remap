/** Reproduce the recovery-semantics correction; preserve the historical case verbatim. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../apps/api/src/server";
import {
  analyze,
  applyMeasures,
  correctLibraryMeasures,
  measureScaleStudy,
  modelHash,
  parseCoreModel,
  type VerificationResult,
} from "../packages/core/src/index";
import { exportTask } from "../packages/tasks/src/portable";
import { buildReport } from "../apps/web/src/workbench/report";

const out = resolve(
  process.argv[2] ?? "/workspace/artifacts/remap-measure-audit-20261119",
);
mkdirSync(resolve(out, "source"), { recursive: true });
const original = JSON.parse(
  readFileSync(
    "references/remap-studies/2026-11-19-constrained-five-scales.json",
    "utf8",
  ),
);
const app = await buildApp({
  dataDir: resolve(process.env.DATA_DIR ?? "data"),
  seed: false,
  autoStartRuns: false,
});
const save = (name: string, value: unknown) =>
  writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + "\n");
try {
  const task = process.env.TASK_ID
      ? app.taskServices.resolve(process.env.TASK_ID).task
      : app.taskServices.create("恢复阶段收益审计 · MTBF独立对照 · 2026-11-19"),
    path = `/api/tasks/${task.id}/core`;
  const post = async (url: string, payload: Record<string, unknown>) => {
    const response = await app.inject({ method: "POST", url, payload });
    if (response.statusCode >= 300) throw new Error(response.body);
    return response.json();
  };
  if (!process.env.TASK_ID) await post(path, { model: original.model });
  // 快照保存的是当时的字段，先升级为当前结构再修正
  const model = correctLibraryMeasures(parseCoreModel(original.model));
  model.name = "恢复阶段收益修正 · 原14项组合未达95%";
  model.source +=
    " 2026-11-19收益审计：六项阶段节省改为从冻结现状减少绝对时长，保留校准残差；三项降FIT措施按现状恢复链独立评价。原95.93%结论撤回，旧快照仅供审计。";
  if (!process.env.TASK_ID) await post(path, { model });
  // New seed fixed before inspecting the corrected result. No parameter selection on this sample.
  const verification = (
    process.env.TASK_ID
      ? (await app.inject({ method: "GET", url: path })).json().verification
      : await post(path + "/verify", { trials: 4096, seed: 741921120 })
  ) as VerificationResult;
  if (!verification || verification.modelHash !== modelHash(model))
    throw new Error("恢复任务的验证与修正模型不一致，不能复用历史验证。");
  const analysis = analyze(model),
    resolved = applyMeasures(model),
    study = measureScaleStudy(model);
  const data = {
    taskId: task.id,
    sourceCommit: process.env.SOURCE_COMMIT ?? "measure-audit working tree",
    model,
    analysis,
    resolved,
    study,
    verification,
    firstVerification: original.finalVerification,
  };
  save("source/presentation-data.json", data);
  save("model.json", model);
  save("analysis.json", analysis);
  save("measure-scale-study.json", study);
  save("verification-final.json", verification);
  save("task-bundle.json", exportTask(app.taskServices, task.id));
  save("historical-result-superseded.json", {
    reason: "恢复阶段节省误写为整段恢复时长；原95.93%不再作为达成证据。",
    source: original.case,
    verification: original.finalVerification,
  });
  writeFileSync(
    resolve(out, "ReMAP-恢复口径与MTBF收益修正.html"),
    buildReport(task.name, model, analysis, verification),
  );
  const quote = (v: unknown) => '"' + String(v).replaceAll('"', '""') + '"';
  writeFileSync(
    resolve(out, "逐措施独立收益.csv"),
    "\ufeff" +
      [
        [
          "措施",
          "类别",
          "卡数",
          "现状A",
          "单项A",
          "净增益pp",
          "整系统净减损h/周",
          "固定现状暴露避免部件损失h/周",
          "50万卡MTBF组Shapley pp",
        ],
        ...study.measures.flatMap((m) =>
          m.points.map((p) => [
            m.name,
            m.direction,
            p.cards,
            p.baseline,
            p.availability,
            p.gainPp,
            p.savedHours,
            p.fixedExposureSavedHours ?? "不适用",
            m.mtbfOnlyShapleyPp ?? "未纳入MTBF组",
          ]),
        ),
      ]
        .map((row) => row.map(quote).join(","))
        .join("\n"),
  );
  const summary = {
    taskId: task.id,
    baseline: analysis.baseline.system.availability,
    analytic: analysis.design.system.availability,
    mean: verification.design.mean,
    interval: verification.design.interval,
    weeklyLoss: 168 * (1 - verification.design.mean),
    passRatio: verification.design.passRatio,
    verdict: verification.verdict,
    mtbfOnly: study.mtbfOnly,
    recommendation: analysis.recommendation,
    domainResults: verification.domains?.filter((d) => d.cards === 500000),
    checks: verification.checks,
  };
  save("study-summary.json", summary);
  writeFileSync(
    "references/remap-studies/2026-11-19-measure-benefits-corrected.json",
    JSON.stringify(
      {
        case: "2026-11-19-measure-benefits-corrected",
        supersedes: original.case,
        model,
        verification,
        summary,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await app.close();
}

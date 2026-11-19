/** Reproduce the November constrained study through the real task API, retaining failed and final snapshots. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../apps/api/src/server";
import {
  analyze,
  applyMeasures,
  measureScaleStudy,
  novemberReferenceScenario,
  type CoreModel,
  type VerificationResult,
} from "../packages/core/src/index";
import { exportTask } from "../packages/tasks/src/portable";
import { buildReport } from "../apps/web/src/workbench/report";

const out = resolve(
  process.argv[2] ?? "/workspace/artifacts/remap-constrained-scales-20261119",
);
mkdirSync(out, { recursive: true });
const save = (name: string, value: unknown) =>
  writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + "\n");
const app = await buildApp({
  dataDir: resolve(process.env.DATA_DIR ?? "data"),
  seed: false,
  autoStartRuns: false,
});
try {
  const task = app.taskServices.create(
    "网络63%与非网络60% · AGREE五规模评估 · 2026-11-19",
  );
  const path = `/api/tasks/${task.id}/core`;
  const post = async (url: string, payload: Record<string, unknown>) => {
    const response = await app.inject({ method: "POST", url, payload });
    if (response.statusCode >= 300) throw new Error(response.body);
    return response.json();
  };
  const baseline = novemberReferenceScenario();
  await post(path, { model: baseline });
  const initial = analyze(baseline),
    minimal = structuredClone(baseline);
  for (const measure of minimal.measures)
    if (initial.recommendation.add.includes(measure.id)) measure.enabled = true;
  await post(path, { model: minimal });
  const first = await post(path + "/verify", { trials: 2000, seed: 20261119 });
  const final: CoreModel = structuredClone(minimal);
  for (const measure of final.measures) {
    if (["sdc-abft", "sdc-step-recover"].includes(measure.id))
      measure.enabled = true;
    if (measure.id === "sdc-detection") {
      measure.effects.find((e) => e.param === "coverage")!.value = 0.98;
      measure.evidence = "assumed";
      measure.source = "本轮模型建议；原用户方案95%，提高至98%待验证";
      measure.rationale =
        "在线检出率由现状90%提高到98%；与AICore ABFT覆盖剩余漏检90%的条件相配合，AICore组合检出率99.8%。需验证两层检测覆盖、误报与开销，不默认产品已实现。";
    }
  }
  final.source +=
    " 第一版解析刚达95%，开发仿真窗口达标不足90%；增加ABFT和干净step恢复、在线检出98%后冻结，使用不同种子独立复核。";
  await post(path, { model: final });
  // Held-out seed fixed before this run; do not choose a favorable seed after seeing the result.
  const verification = (await post(path + "/verify", {
    trials: 4096,
    seed: 741921119,
  })) as VerificationResult;
  const analysis = analyze(final),
    study = measureScaleStudy(final),
    parameters = applyMeasures(final);
  save("model.json", final);
  save("analysis.json", analysis);
  save("measure-scale-study.json", study);
  save("verification-first.json", first);
  save("verification-final.json", verification);
  save("task-bundle.json", exportTask(app.taskServices, task.id));
  const metadata = {
    taskId: task.id,
    url: `http://localhost:5173/?task=${task.id}`,
    baseline: analysis.baseline.system.availability,
    baselineWeeklyLoss: analysis.baseline.system.lossHours,
    analytic: analysis.design.system.availability,
    analyticWeeklyLoss: analysis.design.system.lossHours,
    mean: verification.design.mean,
    interval: verification.design.interval,
    weeklyLoss: 168 * (1 - verification.design.mean),
    passRatio: verification.design.passRatio,
    topGaps: [...analysis.baselineGaps]
      .sort(
        (a, b) => b.lossHours - b.budgetHours - (a.lossHours - a.budgetHours),
      )
      .slice(0, 3),
    scales: verification.scales,
    domains: verification.domains,
    checks: verification.checks,
  };
  save("study-summary.json", metadata);
  writeFileSync(
    resolve(out, "ReMAP-五规模约束评估报告.html"),
    buildReport(task.name, final, analysis, verification),
  );
  const quote = (v: unknown) => '"' + String(v).replaceAll('"', '""') + '"';
  const csv = (rows: unknown[][]) =>
    "\ufeff" + rows.map((r) => r.map(quote).join(",")).join("\n");
  writeFileSync(
    resolve(out, "逐措施五规模收益.csv"),
    csv([
      [
        "措施",
        "类别",
        "卡数",
        "目标",
        "现状",
        "单项改进",
        "收益pp",
        "周损失h",
        "周减损h",
      ],
      ...study.measures.flatMap((m) =>
        m.points.map((p) => [
          m.name,
          m.direction,
          p.cards,
          p.target,
          p.baseline,
          p.availability,
          p.gainPp,
          p.lossHours,
          p.savedHours,
        ]),
      ),
    ]),
  );
  writeFileSync(
    resolve(out, "部件故障模式恢复链.csv"),
    csv([
      [
        "部件",
        "故障模式",
        "阶段",
        "频次每周",
        "FIT每件",
        "检出率",
        "检测h",
        "恢复h",
        "回滚h",
        "漏检h",
        "影响系数",
        "周损失h",
        "措施",
      ],
      ...analysis.baseline.modules
        .flatMap((m) => m.modes)
        .sort((a, b) => b.lossHours - a.lossHours)
        .flatMap((b) =>
          [false, true].map((improved) => {
            const mode = (improved ? parameters.modes : final.modes).find(
              (m) => m.id === b.id,
            )!;
            const result = (
              improved ? analysis.design : analysis.baseline
            ).modules
              .flatMap((m) => m.modes)
              .find((m) => m.id === b.id)!;
            return [
              final.modules.find((m) => m.id === b.moduleId)!.name,
              b.name,
              improved ? "设计后" : "现状",
              result.rate * 168,
              mode.fit,
              mode.coverage,
              mode.detectHours,
              mode.recoverHours,
              mode.reworkHours,
              mode.missedLossHours,
              mode.impact,
              result.lossHours,
              improved
                ? final.measures
                    .filter((m) => m.enabled && m.modeIds.includes(b.id))
                    .map((m) => m.name)
                    .join("；")
                : "冻结现状",
            ];
          }),
        ),
    ]),
  );
  console.log(JSON.stringify(metadata, null, 2));
} finally {
  await app.close();
}

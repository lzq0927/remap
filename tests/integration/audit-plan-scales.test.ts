import { expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { audit, getAuditDefaults } from "../../packages/analysis/src/audit";
import { auditPlanScales } from "../../packages/analysis/src/audit-plan-scales";
import { auditExperiment } from "../../packages/analysis/src/audit-experiments";
it("freezes scoped multi-scale plans and requires the chosen scale when evaluating a batch suggestion", async () => {
  const app = await buildApp({
    dataDir: ":memory:",
    seed: false,
    autoStartRuns: false,
  });
  try {
    const context = app.taskServices.resolve(
        app.taskServices.create("分规模分配").id,
      ),
      other = app.taskServices.create("其他任务"),
      prefix = `/api/tasks/${context.task.id}`;
    const input = {
      ...getAuditDefaults(),
      hours: 24,
      trials: 8,
      attributionTrials: 4,
      verificationTrials: 4,
      sensitivity: false,
    };
    const first = context.runs.complete(
        context.runs.start("audit", input).id,
        audit(input),
      ),
      before = JSON.stringify(first);
    const response = await app.inject({
      method: "POST",
      url: prefix + "/audit/plan-scales",
      payload: {
        sourceRunId: first.id,
        scales: [500000, 10000],
        options: { screeningTrials: 4, exploreExtensions: false },
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const queued = response.json(),
      set = context.runs.complete(queued.id, auditPlanScales(queued.input));
    expect(set.result.plans.map((p: any) => p.prediction.cards)).toEqual([
      10000, 500000,
    ]);
    expect(
      context.store.runs().some((r) => r.operation === "audit-experiment"),
    ).toBe(false);
    for (const planCards of [undefined, 200000]) {
      const rejected = await app.inject({
        method: "POST",
        url: prefix + "/audit/evaluate",
        payload: {
          sourceRunId: first.id,
          name: "错误规模",
          planRunId: set.id,
          planCards,
          configuration: set.result.plans[0].configuration,
        },
      });
      expect(rejected.statusCode).toBe(400);
    }
    const adopted = await app.inject({
      method: "POST",
      url: prefix + "/audit/evaluate",
      payload: {
        sourceRunId: first.id,
        name: "万卡方案",
        planRunId: set.id,
        planCards: 10000,
        planAlternativeId: set.result.plans[0].decisionStudy.recommendedId,
        configuration: {
          ...set.result.plans[0].configuration,
          attributionTrials: 2,
          permutations: 2,
        },
      },
    });
    expect(adopted.statusCode, adopted.body).toBe(200);
    const result = auditExperiment(adopted.json().input);
    expect(result.planningRunId).toBe(set.id);
    expect(result.planningCards).toBe(10000);
    expect(result.planningAlternativeId).toBe(
      set.result.plans[0].decisionStudy.recommendedId,
    );
    expect(result.decision.cards).toBe(10000);
    expect(JSON.stringify(context.store.getRun(first.id))).toBe(before);
    const report = await app.inject(
      prefix + `/runs/${set.id}/report?format=html`,
    );
    expect(report.statusCode).toBe(200);
    expect(report.body.includes("各规模参数要求对照")).toBe(true);
    const wrongAlternative = await app.inject({
      method: "POST",
      url: prefix + "/audit/evaluate",
      payload: {
        sourceRunId: first.id,
        name: "错误备选",
        planRunId: set.id,
        planCards: 10000,
        planAlternativeId: "missing",
        configuration: { enabled: true },
      },
    });
    expect(wrongAlternative.statusCode).toBe(400);
    const badBound = await app.inject({
      method: "POST",
      url: prefix + "/audit/plan",
      payload: {
        sourceRunId: first.id,
        options: {
          planning: {
            bounds: [{ path: "model.unknown", min: 1, source: "invalid" }],
          },
        },
      },
    });
    expect(badBound.statusCode).toBe(400);
    const invalid = await app.inject({
      method: "POST",
      url: prefix + "/audit/plan-scales",
      payload: { sourceRunId: first.id, scales: [1000] },
    });
    expect(invalid.statusCode).toBe(400);
    const cross = await app.inject({
      method: "POST",
      url: `/api/tasks/${other.id}/audit/plan-scales`,
      payload: { sourceRunId: first.id },
    });
    expect(cross.statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

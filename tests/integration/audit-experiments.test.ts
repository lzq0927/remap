import { expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { audit, getAuditDefaults } from "../../packages/analysis/src/audit";
import { auditExperiment } from "../../packages/analysis/src/audit-experiments";
it("freezes task-owned first evidence, starts planning/evaluation separately, and compares selected completed runs", async () => {
  const app = await buildApp({
    dataDir: ":memory:",
    seed: false,
    autoStartRuns: false,
  });
  try {
    const context = app.taskServices.resolve(
        app.taskServices.create("分轮评估").id,
      ),
      other = app.taskServices.create("其他任务"),
      prefix = `/api/tasks/${context.task.id}`;
    const input = {
      ...getAuditDefaults(),
      hours: 24,
      trials: 8,
      attributionTrials: 4,
      sensitivity: false,
      verificationTrials: 8,
      scales: [500000, 200000, 100000, 10000],
    };
    const started = context.runs.start("audit", input),
      first = context.runs.complete(started.id, audit(input));
    const before = JSON.stringify(first);
    const plan = await app.inject({
      method: "POST",
      url: prefix + "/audit/plan",
      payload: { sourceRunId: first.id, options: { screeningTrials: 8 } },
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.json().operation).toBe("audit-plan");
    expect(
      context.store.runs().some((r) => r.operation === "audit-experiment"),
    ).toBe(false);
    const run = await app.inject({
      method: "POST",
      url: prefix + "/audit/evaluate",
      payload: {
        sourceRunId: first.id,
        name: "只提高覆盖率",
        configuration: {
          enabled: true,
          policy: { "D-SDC": { coverage: 0.995 } },
          attributionTrials: 4,
          permutations: 2,
        },
        source: { input: { policy: { "D-SDC": { coverage: 1 } } } },
      },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().input.source.result.config.policy["D-SDC"].coverage).toBe(
      0.95,
    );
    const completed = context.runs.complete(
      run.json().id,
      auditExperiment(run.json().input),
    );
    expect(JSON.stringify(context.store.getRun(first.id))).toBe(before);
    const compared = await app.inject({
      method: "POST",
      url: prefix + "/audit/compare",
      payload: { runIds: [first.id, completed.id] },
    });
    expect(compared.statusCode).toBe(200);
    expect(compared.json().result.entries).toHaveLength(2);
    const report = await app.inject(
      prefix + `/runs/${compared.json().id}/report?format=html`,
    );
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain("参数横向比较");
    expect(report.body).toContain("独立结论");
    const unauthorized = await app.inject({
      method: "POST",
      url: `/api/tasks/${other.id}/audit/evaluate`,
      payload: {
        sourceRunId: first.id,
        name: "cross",
        configuration: { enabled: true },
      },
    });
    expect(unauthorized.statusCode).toBe(404);
    const comparePlan = await app.inject({
      method: "POST",
      url: prefix + "/audit/compare",
      payload: { runIds: [first.id, plan.json().id] },
    });
    expect(comparePlan.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});

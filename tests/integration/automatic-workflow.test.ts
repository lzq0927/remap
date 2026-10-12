import { expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { getAuditDefaults } from "../../packages/analysis/src/audit";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";

async function setup(autoStartRuns = true, automaticStageDisplayMs = 0) {
  const app = await buildApp({
    dataDir: ":memory:",
    seed: false,
    autoStartRuns,
    automaticStageDisplayMs,
  });
  const task = app.taskServices.create("Automatic · synthetic"),
    base = "/api/tasks/" + task.id;
  const payload = {
    scenario: "training",
    request: {},
    activeAssessment: "audit",
    auditDraft: draftFromAuditRequest({
      ...getAuditDefaults(),
      scales: [10000],
      targets: undefined,
      hours: 2,
      trials: 4,
      attributionTrials: 4,
      sensitivity: false,
      mechanisms: ["sdcDetect", "step"],
      verificationTrials: 4,
    }),
  };
  const saved = await app.inject({
    method: "POST",
    url: base + "/design",
    payload,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const design = saved.json();
  const token = app.taskServices.getAgentCredential(task.id),
    headers = { authorization: "Bearer " + token };
  return {
    app,
    task,
    base,
    payload,
    design,
    headers,
    post: (path: string, body: any, agent = true) =>
      app.inject({
        method: "POST",
        url: base + path,
        headers: agent ? headers : {},
        payload: body,
      }),
  };
}
it("automatic stages expose real artifacts for reading and can be cancelled before solving", async () => {
  const { app, base, post, design } = await setup(false, 200);
  try {
    const start = Date.now();
    const started = (
      await post("/workflow/automatic", { inputRevision: design.revision })
    ).json();
    let state: any;
    await vi.waitFor(
      async () => {
        state = (await app.inject(base + "/workflow")).json();
        expect(state.steps[0].status).toBe("running");
      },
      { interval: 10 },
    );
    expect(state.steps[0].artifacts[0].type).toBe("task-brief");
    expect(state.steps[0].notes).toContain("已保存需求");
    await vi.waitFor(
      async () => {
        state = (await app.inject(base + "/workflow")).json();
        expect(state.steps[1].status).toBe("running");
      },
      { interval: 10 },
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(200);
    await post("/workflow/cancel", { executionId: started.executionId }, false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    state = (await app.inject(base + "/workflow")).json();
    expect(state.status).toBe("cancelled");
    expect(state.runId).toBeUndefined();
  } finally {
    await app.close();
  }
});
it("MCP/Agent launches actual audit, exposes sequential artifacts, generates reports and requires final human review", async () => {
  const { app, base, post, design, task } = await setup();
  try {
    const started = await post("/workflow/automatic", {
      inputRevision: design.revision,
    });
    expect(started.statusCode, started.body).toBe(202);
    const flow = started.json();
    expect(
      (await post("/workflow/automatic", { inputRevision: design.revision }))
        .statusCode,
    ).toBe(409);
    let state: any;
    await vi.waitFor(
      async () => {
        state = (await app.inject(base + "/workflow")).json();
        expect(state.steps[5].status).toBe("awaiting-review");
      },
      { timeout: 10000 },
    );
    expect(state.executionId).toBe(flow.executionId);
    expect(
      state.steps
        .slice(0, 5)
        .every((s: any) => s.status === "completed" && !s.confirmedBy),
    ).toBe(true);
    const run = (await app.inject(base + "/runs/" + state.runId)).json();
    expect(run.status).toBe("succeeded");
    expect(run.result.allocationPlan.lossBudgets[0].method).toBe("equal");
    expect(run.result.attribution[0].contributions).toHaveLength(2);
    const history = (await app.inject(base + "/workflow/history")).json();
    expect(
      history
        .filter((e: any) => e.type === "step.completed")
        .map((e: any) => e.stepId),
    ).toEqual(["clarify", "describe", "select", "prepare", "evaluate"]);
    const reports = app.taskServices
      .resolve(task.id)
      .store.documents("pipeline-report");
    expect(reports[0].html).toContain("目标分配");
    expect(reports[0].html).toContain("自动流水线报告 · 待人工审核");
    const confirm = {
      executionId: state.executionId,
      expectedRevision: state.revision,
      inputRevision: state.inputRevision,
      stepId: "validate-deliver",
      status: "confirmed",
      artifacts: [{ type: "report", runId: state.runId }],
    };
    expect((await post("/workflow", confirm)).statusCode).toBe(403);
    expect((await post("/workflow", confirm, false)).json().status).toBe(
      "succeeded",
    );
    const exported = await app.inject(
      base + "/runs/" + state.runId + "/report?format=html",
    );
    expect(exported.body).toContain("已记录用户交付确认");
  } finally {
    await app.close();
  }
});
it("cancels obsolete input and prevents successful delivery of old results", async () => {
  const { app, base, post, design, payload } = await setup(false);
  try {
    await post("/workflow/automatic", { inputRevision: design.revision });
    await vi.waitFor(async () =>
      expect((await app.inject(base + "/workflow")).json().runId).toBeTruthy(),
    );
    payload.auditDraft.request.target = 0.95;
    expect(
      (await post("/design", { ...payload, expectedRevision: design.revision }))
        .statusCode,
    ).toBe(200);
    await vi.waitFor(async () =>
      expect((await app.inject(base + "/workflow")).json().status).toBe(
        "cancelled",
      ),
    );
    expect(
      (await post("/workflow/automatic", { inputRevision: design.revision }))
        .statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});

it("cancels an automatic run only for the matching execution", async () => {
  const { app, base, post, design } = await setup(false);
  try {
    await post("/workflow/automatic", { inputRevision: design.revision });
    let state: any;
    await vi.waitFor(async () => {
      state = (await app.inject(base + "/workflow")).json();
      expect(state.runId).toBeTruthy();
    });
    expect(
      (await post("/workflow/cancel", { executionId: "obsolete" })).statusCode,
    ).toBe(409);
    expect(
      (await app.inject(base + "/runs/" + state.runId)).json().status,
    ).toBe("queued");
    expect(
      (
        await post("/workflow/cancel", { executionId: state.executionId })
      ).json().status,
    ).toBe("cancelled");
    expect(
      (await app.inject(base + "/runs/" + state.runId)).json().status,
    ).toBe("cancelled");
  } finally {
    await app.close();
  }
});

import { expect, test, vi } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { getAuditDefaults } from "../../packages/analysis/src/audit";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";

test("audit design revision, formal workflow and delivery share exactly one saved assessment", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const task = app.taskServices.create("Audit acceptance · synthetic");
    const base = "/api/tasks/" + task.id;
    const payload: any = {
      scenario: "training",
      activeAssessment: "audit",
      request: { cards: 999, target: 0.1 },
      auditDraft: draftFromAuditRequest({
        ...getAuditDefaults(),
        hours: 2,
        trials: 4,
        mechanisms: ["replay"],
        attribution: false,
        sensitivity: false,
        verificationTrials: 4,
      }),
    };
    const post = async (path: string, body: any) =>
      app.inject({ method: "POST", url: base + path, payload: body });
    const save = await post("/design", payload);
    expect(save.statusCode, save.body).toBe(200);
    const design = save.json();
    expect(design.assessment.metricId).toBe("training.retained-clean-progress");
    expect(design.assessment.input.cards).toBe(500000);
    // Hidden V4 edits and UI stage navigation cannot invalidate the audit input.
    expect(
      (
        await post("/design", { ...payload, request: { cards: 42 }, stage: 1 })
      ).json().revision,
    ).toBe(design.revision);
    let flow = (
      await post("/workflow/start", { inputRevision: design.revision })
    ).json();
    for (const stepId of ["clarify", "describe", "select", "prepare"]) {
      const res = await post("/workflow", {
        executionId: flow.executionId,
        expectedRevision: flow.revision,
        inputRevision: design.revision,
        stepId,
        status: "confirmed",
      });
      expect(res.statusCode, res.body).toBe(200);
      flow = res.json();
    }
    const runArgs = {
      executionId: flow.executionId,
      inputRevision: design.revision,
      operation: "audit",
      input: design.assessment.input,
    };
    expect(
      (
        await post("/runs", {
          ...runArgs,
          operation: "training",
          input: payload.request,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post("/runs", {
          ...runArgs,
          input: { ...runArgs.input, target: 0.5 },
        })
      ).statusCode,
    ).toBe(409);
    const started = await post("/runs", runArgs);
    expect(started.statusCode, started.body).toBe(200);
    const run = started.json();
    await vi.waitFor(
      async () =>
        expect((await app.inject(base + "/runs/" + run.id)).json().status).toBe(
          "succeeded",
        ),
      { timeout: 10000 },
    );
    flow = (await app.inject(base + "/workflow")).json();
    expect(flow.steps[4].status).toBe("awaiting-review");
    for (const stepId of ["evaluate", "validate-deliver"]) {
      const res = await post("/workflow", {
        executionId: flow.executionId,
        expectedRevision: flow.revision,
        inputRevision: design.revision,
        stepId,
        status: "confirmed",
        artifacts: [{ type: "evaluation", runId: run.id }],
      });
      expect(res.statusCode, res.body).toBe(200);
      flow = res.json();
    }
    expect(flow.status).toBe("succeeded");
    payload.auditDraft.request.target = 0.95;
    const revised = (await post("/design", payload)).json();
    expect(revised.revision).toBe(design.revision + 1);
    expect((await app.inject(base + "/workflow")).json().stale).toBe(true);
    // Invalid drafts remain editable but must never masquerade as valid legacy input.
    payload.auditDraft.model = "{";
    payload.assessment = { valid: true, input: payload.request };
    const invalid = (await post("/design", payload)).json();
    expect(invalid.assessment.valid).toBe(false);
    expect(invalid.assessment.input).toBeUndefined();
    flow = (
      await post("/workflow/start", { inputRevision: invalid.revision })
    ).json();
    expect(
      (
        await post("/workflow", {
          executionId: flow.executionId,
          expectedRevision: flow.revision,
          inputRevision: invalid.revision,
          stepId: "clarify",
          status: "confirmed",
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});

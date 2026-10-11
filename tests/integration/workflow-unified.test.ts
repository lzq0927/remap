import { expect, test } from "vitest";
import { buildApp } from "../../apps/api/src/server";

test("task flow uses one state for user and bound Agent and rejects impersonation", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const task = (
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { name: "Flow" },
      })
    ).json();
    const prefix = "/api/tasks/" + task.id;
    const design = (
      await app.inject({
        method: "POST",
        url: prefix + "/design",
        payload: {
          request: { cards: 10000 },
          scenario: "training",
          expectedRevision: 0,
        },
      })
    ).json();
    const headers = {
      authorization: "Bearer " + app.taskServices.getAgentCredential(task.id),
    };
    const flow = (
      await app.inject({
        method: "POST",
        url: prefix + "/workflow/start",
        headers,
        payload: { inputRevision: design.revision },
      })
    ).json();
    const args = {
      executionId: flow.executionId,
      expectedRevision: flow.revision,
      inputRevision: design.revision,
      stepId: "clarify",
      status: "confirmed",
    };
    const blocked = await app.inject({
      method: "POST",
      url: prefix + "/workflow",
      headers,
      payload: args,
    });
    expect(blocked.statusCode).toBe(403);
    const saved = (
      await app.inject({
        method: "POST",
        url: prefix + "/workflow",
        headers,
        payload: {
          ...args,
          status: "awaiting-review",
          artifacts: [{ type: "brief", data: { target: 0.99 } }],
        },
      })
    ).json();
    expect(
      (await app.inject(prefix + "/current")).json().workflow.steps[0].status,
    ).toBe("awaiting-review");
    const confirmed = (
      await app.inject({
        method: "POST",
        url: prefix + "/workflow",
        payload: { ...args, expectedRevision: saved.revision },
      })
    ).json();
    expect(confirmed.steps[1].status).toBe("ready");
    expect(
      (await app.inject(prefix + "/workflow/history")).json(),
    ).toHaveLength(3);
    const stale = await app.inject({
      method: "POST",
      url: prefix + "/workflow",
      payload: args,
    });
    expect(stale.statusCode).toBe(409);
  } finally {
    await app.close();
  }
});

test("formal training run binds execution, exact design and revisions through HTTP", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const task = app.taskServices.create("Formal flow"),
      prefix = "/api/tasks/" + task.id;
    const defaults = (await app.inject("/api/defaults")).json().training;
    const input = { ...defaults, hours: 1, trials: 2 };
    const design = (
      await app.inject({
        method: "POST",
        url: prefix + "/design",
        payload: { request: input, scenario: "training" },
      })
    ).json();
    let flow = (
      await app.inject({
        method: "POST",
        url: prefix + "/workflow/start",
        payload: { inputRevision: design.revision },
      })
    ).json();
    for (const stepId of ["clarify", "describe", "select", "prepare"]) {
      flow = (
        await app.inject({
          method: "POST",
          url: prefix + "/workflow",
          payload: {
            executionId: flow.executionId,
            expectedRevision: flow.revision,
            inputRevision: design.revision,
            stepId,
            status: "confirmed",
          },
        })
      ).json();
    }
    const mismatched = await app.inject({
      method: "POST",
      url: prefix + "/runs",
      payload: {
        executionId: flow.executionId,
        inputRevision: design.revision,
        operation: "training",
        input: { ...input, cards: 123 },
      },
    });
    expect(mismatched.statusCode).toBe(409);
    const run = (
      await app.inject({
        method: "POST",
        url: prefix + "/runs",
        payload: {
          executionId: flow.executionId,
          inputRevision: design.revision,
          operation: "training",
          input,
        },
      })
    ).json();
    const { vi } = await import("vitest");
    await vi.waitFor(
      async () =>
        expect(
          (await app.inject(prefix + "/runs/" + run.id)).json().status,
        ).toBe("succeeded"),
      { timeout: 10000 },
    );
    flow = (await app.inject(prefix + "/workflow")).json();
    expect(flow.runId).toBe(run.id);
    expect(flow.steps[4].status).toBe("awaiting-review");
    for (const stepId of ["evaluate", "validate-deliver"]) {
      const confirmed = await app.inject({
        method: "POST",
        url: prefix + "/workflow",
        payload: {
          executionId: flow.executionId,
          expectedRevision: flow.revision,
          inputRevision: design.revision,
          stepId,
          status: "confirmed",
          artifacts: [{ type: "evaluation", runId: run.id }],
        },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      flow = confirmed.json();
    }
    expect(flow.status).toBe("succeeded");
  } finally {
    await app.close();
  }
});

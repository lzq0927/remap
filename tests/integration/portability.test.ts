import { expect, test } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { hash } from "../../packages/assets/src/hash";

test("task export/import preserves immutable assets and runs without credentials or chat bindings", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const task = app.taskServices.create("Portable"),
      { store } = app.taskServices.resolve(task.id);
    const asset = store.create("failure-mode", "Test", { fit: 100 });
    store.transition(asset.id, 1, "validated");
    const input = { tree: { type: "event", id: "x", probability: 0.99 } };
    const oldRun = {
      id: "immutable-run",
      operation: "rbd",
      input,
      inputHash: hash({ operation: "rbd", input }),
      status: "succeeded" as const,
      createdAt: "2026-10-11",
      progress: 1,
      result: { value: 0.99 },
      events: [],
    };
    store.saveRun(oldRun);
    store.putDocument("design", {
      request: { cards: 10000 },
      revision: 1,
      session: "private-session",
      savedAt: "2026-10-11",
    });
    store.putDocument("agent-binding", { sessionId: "private-session" });
    store.putDocument(
      "workflow-state",
      { executionId: "historic-flow", status: "succeeded" },
      "workflow.current",
    );
    const credential = app.taskServices.getAgentCredential(task.id);
    const response = await app.inject("/api/tasks/" + task.id + "/export");
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(credential);
    expect(response.body).not.toContain("private-session");
    const bundle = response.json();
    const imported = (
      await app.inject({
        method: "POST",
        url: "/api/tasks/import",
        payload: { bundle },
      })
    ).json();
    expect(imported.id).not.toBe(task.id);
    expect(
      app.taskServices.resolve(imported.id).store.getRun(oldRun.id),
    ).toEqual(oldRun);
    expect(
      app.taskServices.resolve(imported.id).store.get(asset.id, 1).contentHash,
    ).toBe(asset.contentHash);
    expect(
      app.taskServices
        .resolve(imported.id)
        .store.documents("workflow-history")[0].executionId,
    ).toBe("historic-flow");
    bundle.rows.assets[0].hash = "tampered";
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks/import",
          payload: { bundle },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
test("task copy rebinds active design and resolves frozen dependency refs within the copy", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const a = app.taskServices.create("Source"),
      { store } = app.taskServices.resolve(a.id);
    const mode = store.create("failure-mode", "Mode", { fit: 12 });
    store.transition(mode.id, 1, "validated");
    const mechanism = store.create("mechanism", "Mechanism", {
      refs: [
        {
          id: mode.id,
          revision: 1,
          contentHash: mode.contentHash,
          taskId: a.id,
        },
      ],
    });
    store.transition(mechanism.id, 1, "validated");
    store.putDocument("design", {
      request: {
        assetRefs: [
          {
            id: mechanism.id,
            revision: 1,
            contentHash: mechanism.contentHash,
            taskId: a.id,
          },
        ],
      },
      scenario: "training",
      revision: 1,
      session: "old",
      savedAt: "now",
    });
    const b = app.taskServices.copy(a.id, "Copy");
    const second = app.taskServices.resolve(b.id).store;
    const copiedDesign = second.documents("design").at(-1);
    expect(copiedDesign.request.assetRefs[0].taskId).toBe(b.id);
    expect(second.snapshot(copiedDesign.request.assetRefs)).toHaveLength(2);
    expect(copiedDesign.session).toBe("");
    const c = app.taskServices.copy(b.id, "Copy twice"),
      third = app.taskServices.resolve(c.id).store;
    expect(
      third.snapshot(third.documents("design").at(-1).request.assetRefs),
    ).toHaveLength(2);
  } finally {
    await app.close();
  }
});

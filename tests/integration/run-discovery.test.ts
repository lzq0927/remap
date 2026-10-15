import { expect, test } from "vitest";
import { buildApp } from "../../apps/api/src/server";

test("run summaries page the full task history without exposing snapshots", async () => {
  const app = await buildApp({
    dataDir: ":memory:",
    seed: false,
    autoStartRuns: false,
  });
  try {
    const task = app.taskServices.create("Long study"),
      other = app.taskServices.create("Separate study"),
      { store } = app.taskServices.resolve(task.id),
      prefix = `/api/tasks/${task.id}/runs`,
      sourceRunId = "older-than-latest-100";
    for (let i = 0; i < 105; i++)
      store.saveRun({
        id: i === 0 ? sourceRunId : `run-${i}`,
        status: "succeeded",
        operation: i === 0 ? "audit" : "audit-experiment",
        input: {
          source: { id: sourceRunId },
          largeSnapshot: "omit-this-snapshot",
        },
        inputHash: `hash-${i}`,
        createdAt: "2026-10-15T00:00:00Z",
        progress: 1,
        events: [],
        result: {
          kind: "expert-audit-experiment",
          sourceRunId,
          name: `Scenario ${i}`,
        },
      });
    const response = await app.inject(
      prefix + "?view=summary&limit=2&offset=103",
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(105);
    expect(response.json().items.map((r: any) => r.id)).toEqual([
      "run-1",
      sourceRunId,
    ]);
    expect(response.body).not.toContain("omit-this-snapshot");
    const filtered = (
      await app.inject(prefix + "?view=summary&operation=audit")
    ).json();
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].id).toBe(sourceRunId);
    expect(
      (
        await app.inject(
          prefix + "?view=summary&sourceRunId=older-than-latest-100",
        )
      ).json().total,
    ).toBe(105);
    expect((await app.inject(prefix)).json()).toHaveLength(100);
    for (const suffix of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "offset=-1",
      "operation=audit&operation=audit-experiment",
    ])
      expect(
        (await app.inject(prefix + "?view=summary&" + suffix)).statusCode,
      ).toBe(400);
    const foreign = await app.inject({
      url: `/api/tasks/${other.id}/runs?view=summary`,
      headers: {
        authorization: "Bearer " + app.taskServices.getAgentCredential(task.id),
      },
    });
    expect(foreign.statusCode).toBe(403);
  } finally {
    await app.close();
  }
});

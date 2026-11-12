import { expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { defaultWeeklyScenario } from "../../packages/contracts/src/weekly-reliability";

it("saves task-specific catalogs and immutable weekly snapshots with revision guards", async () => {
  const app = await buildApp({
    dataDir: ":memory:",
    seed: false,
    autoStartRuns: false,
  });
  try {
    const task = app.taskServices.create("周度场景"),
      other = app.taskServices.create("独立任务");
    const path = `/api/tasks/${task.id}/weekly-reliability`;
    const store = app.taskServices.resolve(task.id).store;
    const original = store.create("failure-mode", "原有HBM", { fit: 587.43 });
    const initial = await app.inject(path);
    expect(initial.json().revision).toBe(0);
    expect(store.list()).toHaveLength(1); // GET does not mutate or replace the user's library.
    const profile = defaultWeeklyScenario();
    const saved = await app.inject({
      method: "POST",
      url: path,
      payload: { baseRevision: 0, profile },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const snapshot = saved.json();
    expect(snapshot.catalogRefs).toHaveLength(12);
    expect(store.list("failure-mode")).toHaveLength(6);
    expect(store.list("mechanism")).toHaveLength(5);
    expect(store.get(original.id)).toEqual(original);
    expect(store.list("mechanism").every((a) => a.state === "validated")).toBe(
      true,
    );
    const correction = store.get("weekly-2026-11-12-hbm-correction");
    expect(correction.payload.modeIds).toEqual(["weekly-2026-11-12-hbm"]);
    expect(correction.payload.refs[0].contentHash).toBe(
      store.get("weekly-2026-11-12-hbm").contentHash,
    );
    profile.detection.improved = 0.99;
    const updated = await app.inject({
      method: "POST",
      url: path,
      payload: { baseRevision: 1, profile },
    });
    expect(updated.statusCode, updated.body).toBe(201);
    expect(updated.json().result.improved.modes[2].missedLossHours).toBeCloseTo(
      1.0875648,
    );
    expect(store.getDocument(snapshot.id)).toEqual(snapshot);
    for (const ref of snapshot.catalogRefs)
      expect(store.get(ref.id, ref.revision).contentHash).toBe(ref.contentHash);
    expect((await app.inject(path)).json().history).toHaveLength(2);
    expect(
      (await app.inject(`/api/tasks/${other.id}/weekly-reliability`)).json()
        .revision,
    ).toBe(0);
    const stale = await app.inject({
      method: "POST",
      url: path,
      payload: { baseRevision: 1, profile },
    });
    expect(stale.statusCode).toBe(409);
    expect(store.documents("weekly-reliability-snapshot")).toHaveLength(2);
    const invalid = await app.inject({
      method: "POST",
      url: path,
      payload: {
        baseRevision: 2,
        profile: { ...profile, detection: { current: 9, improved: 1 } },
      },
    });
    expect(invalid.statusCode).toBe(400);
    const unauthorized = await app.inject({
      method: "POST",
      url: path,
      headers: { authorization: "Bearer invalid" },
      payload: { baseRevision: 2, profile },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(store.runs()).toHaveLength(0); // No synthetic DES run or confirmation.
  } finally {
    await app.close();
  }
});

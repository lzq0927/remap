import { afterEach, expect, test, vi } from "vitest";
import {
  mkdtemp,
  rm,
  rename,
  mkdir,
  symlink,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/server";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "task-isolation-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ dataDir, seed: false });
  cleanups.push(() => app.close());
  const create = async (name: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { name },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  };
  return { app, dataDir, create };
}

test("same-name live files create unconfirmed input revisions only in their own task", async () => {
  const { app, create } = await fixture();
  const a = await create("Watch A"),
    b = await create("Watch B");
  const pa = "/api/tasks/" + a.id,
    pb = "/api/tasks/" + b.id;
  const da = (await app.inject(pa + "/input-watch")).json().directory;
  const db = (await app.inject(pb + "/input-watch")).json().directory;
  await new Promise((resolve) => setTimeout(resolve, 200));
  await writeFile(join(da, "model.json"), '{"cards":10000}');
  await writeFile(join(db, "model.json"), '{"cards":100000}');
  await vi.waitFor(
    async () => {
      expect((await app.inject(pa + "/inputs")).json()[0]).toMatchObject({
        status: "extracted",
        data: { cards: 10000 },
      });
      expect((await app.inject(pb + "/inputs")).json()[0]).toMatchObject({
        status: "extracted",
        data: { cards: 100000 },
      });
    },
    { timeout: 6000 },
  );
});

test("design writes require an explicit registered task and never select the latest task", async () => {
  const { app, create } = await fixture();
  const a = await create("A"),
    b = await create("B");
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/design",
        payload: { request: { marker: "global" } },
      })
    ).json().error.code,
  ).toBe("TASK_REQUIRED");
  await app.inject({
    method: "POST",
    url: `/api/tasks/${a.id}/design`,
    payload: { request: { marker: "A" } },
  });
  await app.inject({
    method: "POST",
    url: `/api/tasks/${b.id}/design`,
    payload: { request: { marker: "B" } },
  });
  expect(
    (await app.inject(`/api/tasks/${a.id}/current`)).json().design.request
      .marker,
  ).toBe("A");
  expect(
    (await app.inject(`/api/tasks/${b.id}/current`)).json().design.request
      .marker,
  ).toBe("B");
  expect((await app.inject("/api/design")).json().error.code).toBe(
    "TASK_REQUIRED",
  );
});

test("equal asset and input IDs are independent while foreign runs, reports, cancellation and references are rejected", async () => {
  const { app, create } = await fixture();
  const a = await create("A"),
    b = await create("B");
  const services = (app as any).taskServices;
  for (const task of [a, b]) {
    const { store } = services.resolve(task.id);
    store.create(
      "failure-mode",
      task.name,
      { fit: 1, rateBasis: "device-hour" },
      "same-asset",
    );
    store.putDocument(
      "input",
      { data: { marker: task.name }, status: "confirmed" },
      "same-input",
    );
  }
  expect(
    (await app.inject(`/api/tasks/${a.id}/catalogs/same-asset`)).json().asset
      .name,
  ).toBe("A");
  expect(
    (await app.inject(`/api/tasks/${b.id}/catalogs/same-asset`)).json().asset
      .name,
  ).toBe("B");
  const { store } = services.resolve(a.id);
  store.create("failure-mode", "private", { fit: 2 }, "only-a");
  store.putDocument(
    "input",
    { data: { cards: 1 }, status: "confirmed" },
    "only-a-input",
  );
  const input = {
    items: [{ id: "x" }],
    target: 0.9,
    hours: 1,
    method: "equal",
  };
  store.saveRun({
    id: "only-a-run",
    status: "succeeded",
    operation: "allocate",
    input,
    inputHash: "hash-a",
    createdAt: new Date().toISOString(),
    progress: 1,
    events: [],
    result: {},
  });
  for (const suffix of [
    "catalogs/only-a",
    "runs/only-a-run",
    "runs/only-a-run/report",
    "inputs/only-a-input/mapping",
  ])
    expect((await app.inject(`/api/tasks/${b.id}/${suffix}`)).statusCode).toBe(
      404,
    );
  for (const suffix of [
    "runs/only-a-run/cancel",
    "runs/only-a-run/replay",
    "inputs/only-a-input/confirm",
  ])
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/tasks/${b.id}/${suffix}`,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  const foreign = await app.inject({
    method: "POST",
    url: `/api/tasks/${b.id}/runs`,
    payload: {
      operation: "allocate",
      input: { ...input, assetRefs: [{ id: "only-a", revision: 1 }] },
    },
  });
  expect(foreign.statusCode).toBe(404);
});

test("registry rename, archive, copy and reopening preserve isolated immutable content", async () => {
  const { app, dataDir, create } = await fixture();
  const a = await create("Original");
  await app.inject({
    method: "POST",
    url: `/api/tasks/${a.id}/design`,
    payload: { request: { value: 7 } },
  });
  const copied = await app.inject({
    method: "POST",
    url: `/api/tasks/${a.id}/copy`,
    payload: { name: "Copy" },
  });
  expect(copied.statusCode).toBe(201);
  const b = copied.json();
  await app.inject({
    method: "PATCH",
    url: `/api/tasks/${b.id}`,
    payload: { name: "Renamed" },
  });
  await app.inject({
    method: "POST",
    url: `/api/tasks/${b.id}/design`,
    payload: { request: { value: 8 } },
  });
  expect(
    (await app.inject(`/api/tasks/${a.id}/current`)).json().design.request
      .value,
  ).toBe(7);
  await app.inject({
    method: "POST",
    url: `/api/tasks/${a.id}/archive`,
    payload: {},
  });
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/tasks/${a.id}/design`,
        payload: { request: {} },
      })
    ).json().error.code,
  ).toBe("TASK_ARCHIVED");
  await app.close();
  cleanups.pop();
  const reopened = await buildApp({ dataDir, seed: false });
  cleanups.push(() => reopened.close());
  expect(
    (await reopened.inject(`/api/tasks/${b.id}/current`)).json(),
  ).toMatchObject({
    task: { name: "Renamed" },
    design: { request: { value: 8 } },
  });
  expect((await reopened.inject(`/api/tasks/${a.id}`)).json().status).toBe(
    "archived",
  );
});

test("unknown, encoded path and externally redirected registered roots are rejected", async () => {
  const { app, create } = await fixture();
  const a = await create("A");
  for (const id of ["unknown-task", "%2e%2e", "a%2fb", "a%5cb"])
    expect(
      (await app.inject(`/api/tasks/${id}/design`)).statusCode,
    ).toBeGreaterThanOrEqual(400);
  const task = (app as any).taskServices.registry.get(a.id);
  const original = task.workspacePath;
  const elsewhere = original + "-moved";
  await rename(original, elsewhere);
  await symlink(
    elsewhere,
    original,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(
    (await app.inject(`/api/tasks/${a.id}/design`)).json().error.code,
  ).toBe("TASK_PATH_INVALID");
  await rm(original, { force: true });
  await mkdir(original);
});

test("task-bound Agent tokens cannot access a different task or human publication actions", async () => {
  const { app, create } = await fixture();
  const a = await create("A"),
    b = await create("B");
  const token = (app as any).taskServices.getAgentCredential(a.id);
  const headers = { authorization: `Bearer ${token}` };
  expect(
    (await app.inject({ url: `/api/tasks/${a.id}/design`, headers }))
      .statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: `/api/tasks/${b.id}/design`, headers }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers,
        payload: { name: "agent" },
      })
    ).statusCode,
  ).toBe(403);
  expect(JSON.stringify((await app.inject("/api/tasks")).json())).not.toContain(
    token,
  );
  const { store } = app.taskServices.resolve(a.id);
  store.putDocument("input", { data: {}, status: "extracted" }, "unconfirmed");
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/tasks/${a.id}/inputs/unconfirmed/confirm`,
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  const asset = store.create("failure-mode", "private", {
    fit: 1,
    rateBasis: "device-hour",
  });
  store.transition(asset.id, 1, "validated");
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/tasks/${a.id}/catalogs/${asset.id}/1/state`,
        headers,
        payload: { state: "published" },
      })
    ).statusCode,
  ).toBe(403);
});

test("design revisions track calculation inputs and reject stale optimistic writes", async () => {
  const { app, create } = await fixture();
  const task = await create("Design");
  const url = `/api/tasks/${task.id}/design`;
  const save = (payload: any) => app.inject({ method: "POST", url, payload });
  const first = (
    await save({
      request: { cards: 10 },
      scenario: "training",
      stage: 0,
      expectedRevision: 0,
    })
  ).json();
  expect(first.revision).toBe(1);
  const stage = (
    await save({
      request: { cards: 10 },
      scenario: "training",
      stage: 1,
      chat: "note",
      expectedRevision: 1,
    })
  ).json();
  expect(stage.revision).toBe(1);
  const changed = (
    await save({
      request: { cards: 20 },
      scenario: "training",
      expectedRevision: 1,
    })
  ).json();
  expect(changed.revision).toBe(2);
  expect(
    (await save({ request: { cards: 30 }, expectedRevision: 1 })).statusCode,
  ).toBe(409);
  expect((await app.inject(url)).json().request.cards).toBe(20);
});

test("validated private assets can be snapshotted without public promotion or mutable content", async () => {
  const { app, create } = await fixture();
  const task = await create("Validated");
  const { store } = app.taskServices.resolve(task.id);
  const asset = store.create("failure-mode", "Private", {
    fit: 1,
    rateBasis: "device-hour",
  });
  store.transition(asset.id, 1, "validated");
  const snapshot = store.snapshot([
    { id: asset.id, revision: 1, contentHash: asset.contentHash },
  ]);
  expect(snapshot[0].state).toBe("validated");
  snapshot[0].payload.fit = 100;
  expect(store.get(asset.id).payload.fit).toBe(1);
  expect(() => store.update(asset.id, 1, "changed", { fit: 100 })).toThrow(
    "REVISION_CONFLICT",
  );
});

test("all task schedulers share the same two running worker slots", async () => {
  const { app, create } = await fixture();
  const a = await create("A"),
    b = await create("B");
  const defaults = (await app.inject("/api/defaults")).json().training;
  const services = app.taskServices;
  for (const task of [a, b])
    for (let index = 0; index < 3; index++)
      services
        .resolve(task.id)
        .runs.start("training", { ...defaults, hours: 2000, trials: 64 });
  await new Promise((r) => setTimeout(r, 20));
  expect(services.budget.active).toBe(2);
  const active = [a, b].flatMap((task) =>
    services.resolve(task.id).store.activeRuns(),
  );
  expect(active.filter((run) => run.status === "running")).toHaveLength(2);
  expect(active.filter((run) => run.status === "queued")).toHaveLength(4);
});

test("registry refuses creation after the workspace parent is redirected", async () => {
  const { app, dataDir } = await fixture();
  const parent = join(dataDir, "tasks"),
    moved = join(dataDir, "tasks-moved");
  await rename(parent, moved);
  await symlink(
    moved,
    parent,
    process.platform === "win32" ? "junction" : "dir",
  );
  const response = await app.inject({
    method: "POST",
    url: "/api/tasks",
    payload: { name: "redirected" },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().error.code).toBe("TASK_PATH_INVALID");
  await rm(parent, { force: true });
  await rename(moved, parent);
});

test("Agent credential persistence never follows a substituted credentials link", async () => {
  const { app, dataDir, create } = await fixture();
  const a = await create("A"),
    b = await create("B");
  app.taskServices.getAgentCredential(a.id);
  const credentials = join(dataDir, "agent-credentials.json"),
    externalDir = join(dataDir, "do-not-overwrite"),
    external = join(externalDir, "marker.txt");
  await mkdir(externalDir);
  await writeFile(external, "must remain unchanged");
  await rm(credentials);
  await symlink(
    externalDir,
    credentials,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => app.taskServices.getAgentCredential(b.id)).toThrow(
    "TASK_PATH_INVALID",
  );
  expect(await readFile(external, "utf8")).toBe("must remain unchanged");
});

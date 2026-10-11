import { expect, test } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Store } from "../../packages/assets/src/store";
import { buildApp } from "../../apps/api/src/server";
import { spawnSync } from "node:child_process";

test("dry-run migration preserves original bytes; real migration keeps old IDs and hashes and is idempotent", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "legacy-migration-"));
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const original = new Store(dataDir);
    const asset = original.create("failure-mode", "Existing", { fit: 12 });
    original.putDocument(
      "input",
      {
        contentHash: "original-input-hash",
        confirmedHash: "original-confirmed-hash",
        status: "confirmed",
        data: { fit: 12 },
      },
      "old-input",
    );
    original.putDocument(
      "design",
      { request: { assetRefs: [asset] }, savedAt: "2026-01-01T00:00:00Z" },
      "old-design",
    );
    original.saveRun({
      id: "old-run",
      inputHash: "original-run-hash",
      operation: "rbd",
      input: { inputId: "old-input", assetSnapshot: [asset] },
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00Z",
      progress: 1,
      events: [],
    });
    original.close();
    const file = join(dataDir, "reliability.sqlite");
    const before = await readFile(file);
    app = await buildApp({ dataDir, seed: false });
    const services = (app as any).taskServices;
    const dry = services.migrateLegacy({ dryRun: true });
    expect(dry.taskId).toBe("legacy");
    expect(await readFile(file)).toEqual(before);
    const migrated = services.migrateLegacy({ dryRun: false });
    expect(migrated.taskId).toBe("legacy");
    expect(migrated.sourceHash).toBe(
      createHash("sha256").update(before).digest("hex"),
    );
    expect(await readFile(migrated.backupPath)).toEqual(before);
    expect(
      (await app.inject("/api/tasks/legacy/runs/old-run")).json().inputHash,
    ).toBe("original-run-hash");
    expect(
      (await app.inject("/api/tasks/legacy/inputs")).json()[0].confirmedHash,
    ).toBe("original-confirmed-hash");
    expect(
      (await app.inject("/api/tasks/legacy/catalogs/" + asset.id)).json().asset
        .contentHash,
    ).toBe(asset.contentHash);
    expect(services.migrateLegacy({ dryRun: false })).toEqual(migrated);
    await app.close();
    app = undefined;
    app = await buildApp({ dataDir, seed: false });
    expect(
      (await app.inject("/api/tasks/legacy/runs/old-run")).json().inputHash,
    ).toBe("original-run-hash");
    expect(await readFile(file)).toEqual(before);
  } finally {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("migration takes a consistent read-only snapshot including uncheckpointed WAL rows", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "legacy-wal-"));
  const oldStore = new Store(dataDir);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    oldStore.putDocument(
      "input",
      { contentHash: "wal-input", status: "confirmed", data: { value: 5 } },
      "wal-only-input",
    );
    const file = join(dataDir, "reliability.sqlite"),
      wal = file + "-wal";
    const originalDatabase = await readFile(file),
      originalWal = await readFile(wal);
    app = await buildApp({ dataDir, seed: false });
    const manifest = app.taskServices.migrateLegacy({ dryRun: false });
    expect(manifest.files.some((file) => file.name.endsWith("-wal"))).toBe(
      true,
    );
    expect(
      (await app.inject("/api/tasks/legacy/inputs")).json()[0],
    ).toMatchObject({ id: "wal-only-input", contentHash: "wal-input" });
    expect(await readFile(file)).toEqual(originalDatabase);
    expect(await readFile(wal)).toEqual(originalWal);
    expect(await readFile(manifest.backupPath)).toEqual(originalDatabase);
  } finally {
    await app?.close();
    oldStore.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("failed legacy migration removes the partial registered task and permits a clean retry", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "legacy-rollback-"));
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const file = join(dataDir, "reliability.sqlite");
    await writeFile(file, "not a database");
    app = await buildApp({ dataDir, seed: false });
    expect(() => app!.taskServices.migrateLegacy({ dryRun: false })).toThrow();
    expect(app.taskServices.registry.list()).toEqual([]);
    await rm(file);
    const original = new Store(dataDir);
    original.putDocument(
      "input",
      { status: "confirmed", contentHash: "retry-hash", data: {} },
      "retry-input",
    );
    original.close();
    expect(app.taskServices.migrateLegacy({ dryRun: false }).taskId).toBe(
      "legacy",
    );
    expect(
      (await app.inject("/api/tasks/legacy/inputs")).json()[0].contentHash,
    ).toBe("retry-hash");
  } finally {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("migration retry never overlays the new source snapshot with WAL left by a failed attempt", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "legacy-stale-wal-"));
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let source: Store | undefined;
  try {
    source = new Store(dataDir);
    source.putDocument(
      "input",
      { status: "confirmed", data: { marker: "old" } },
      "old-input",
    );
    app = await buildApp({ dataDir, seed: false, autoStartRuns: false });
    const { DatabaseSync } = await import("node:sqlite");
    const { vi } = await import("vitest");
    const prepare = DatabaseSync.prototype.prepare;
    const failure = vi
      .spyOn(DatabaseSync.prototype, "prepare")
      .mockImplementation(function (
        this: InstanceType<typeof DatabaseSync>,
        sql: string,
      ) {
        if (sql === "VACUUM INTO ?")
          throw new Error("injected snapshot failure");
        return prepare.call(this, sql);
      });
    try {
      expect(() => app!.taskServices.migrateLegacy({ dryRun: false })).toThrow(
        "injected snapshot failure",
      );
    } finally {
      failure.mockRestore();
    }
    expect(app.taskServices.registry.list()).toEqual([]);
    source.close();
    source = new Store(dataDir);
    source.putDocument(
      "input",
      { status: "confirmed", data: { marker: "new" } },
      "new-input",
    );
    source.close();
    source = undefined;
    const sourceBytes = await readFile(join(dataDir, "reliability.sqlite"));
    const manifest = app.taskServices.migrateLegacy({ dryRun: false });
    expect(manifest.files.map((file) => file.name)).toEqual([
      "reliability.sqlite",
    ]);
    expect(
      app.taskServices
        .resolve("legacy")
        .store.documents("input")
        .map((doc) => doc.id)
        .sort(),
    ).toEqual(["new-input", "old-input"]);
    expect(await readFile(join(dataDir, "reliability.sqlite"))).toEqual(
      sourceBytes,
    );
  } finally {
    source?.close();
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test.each(["VACUUM INTO ?", "INSERT INTO tasks VALUES (?,?)"])(
  "a hard process exit at %s is recoverable on the next launch",
  async (crashSql) => {
    const dataDir = await mkdtemp(join(tmpdir(), "legacy-hard-exit-"));
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    try {
      const source = new Store(dataDir);
      source.putDocument(
        "input",
        { status: "confirmed", data: { marker: "original" } },
        "original",
      );
      source.close();
      const sourceBytes = await readFile(join(dataDir, "reliability.sqlite"));
      const script = `import { DatabaseSync } from 'node:sqlite';
      import { TaskServices } from './packages/tasks/src/service.ts';
      const prepare = DatabaseSync.prototype.prepare;
      DatabaseSync.prototype.prepare = function(sql) { if (sql === process.argv[2]) process.exit(55); return prepare.call(this,sql); };
      new TaskServices(process.argv[1], {seed:false}).migrateLegacy({dryRun:false});`;
      const interrupted = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          script,
          dataDir,
          crashSql,
        ],
        { timeout: 15000 },
      );
      expect(interrupted.status).toBe(55);
      app = await buildApp({ dataDir, seed: false });
      expect(
        (await app.inject("/api/tasks/legacy/inputs")).statusCode,
      ).toBeGreaterThanOrEqual(400);
      expect(app.taskServices.migrateLegacy({ dryRun: false }).taskId).toBe(
        "legacy",
      );
      expect(
        app.taskServices.resolve("legacy").store.documents("input")[0].id,
      ).toBe("original");
      expect(await readFile(join(dataDir, "reliability.sqlite"))).toEqual(
        sourceBytes,
      );
    } finally {
      await app?.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);

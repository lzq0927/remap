import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { rm } from "node:fs/promises";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../assets/src/store";
import { RunBudget, RunService } from "../../workflow/src/runs";
import { DomainError } from "../../contracts/src/errors";
import type { Task, TaskMigrationManifest } from "../../contracts/src/types";
import { getFactors, getTrainingDefaults } from "../../solvers/src/training";
import { TaskRegistry } from "./registry";
import { TaskStore } from "./store";
import { hash } from "../../assets/src/hash";
import { watchInputs } from "../../ingestion/src/watch";

export interface TaskContext {
  task: Task;
  store: Store;
  runs: RunService;
}
export type TaskActor = "user" | "agent";
export interface AuthorizedTaskContext extends TaskContext {
  actor: TaskActor;
}
export interface TaskRequest {
  headers: { authorization?: string };
  method?: string;
}
declare module "fastify" {
  interface FastifyInstance {
    taskServices: TaskServices;
  }
}
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

export class TaskServices {
  readonly registry: TaskRegistry;
  readonly budget = new RunBudget(2);
  readonly examples: Store;
  private contexts = new Map<string, TaskContext>();
  private credentials = new Map<string, string>();
  private temporary: boolean;
  private closed = false;
  private watchers = new Map<string, ReturnType<typeof watchInputs>>();
  constructor(
    dataDir: string,
    private options: { seed?: boolean; autoStart?: boolean } = {},
  ) {
    this.temporary = dataDir === ":memory:";
    this.registry = new TaskRegistry(
      this.temporary
        ? join(tmpdir(), "reliability-tasks-" + randomUUID())
        : dataDir,
    );
    const examplesRoot = join(this.registry.root, "examples");
    if (existsSync(examplesRoot) && lstatSync(examplesRoot).isSymbolicLink())
      throw new DomainError("TASK_PATH_INVALID", "示例资产目录无效", 403);
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const file = join(examplesRoot, "reliability.sqlite" + suffix);
      if (existsSync(file) && lstatSync(file).isSymbolicLink())
        throw new DomainError(
          "TASK_PATH_INVALID",
          "示例数据库路径被重定向",
          403,
        );
    }
    this.examples = new Store(examplesRoot);
    if (options.seed !== false && this.examples.list().length === 0)
      this.seedExamples();
    const credentialsFile = this.credentialsPath();
    if (existsSync(credentialsFile)) {
      if (lstatSync(credentialsFile).isSymbolicLink())
        throw new DomainError("TASK_PATH_INVALID", "凭据路径无效", 403);
      for (const [id, token] of Object.entries(
        JSON.parse(readFileSync(credentialsFile, "utf8")),
      ))
        if (typeof token === "string") this.credentials.set(id, token);
    }
  }
  create(name: unknown): Task {
    return this.registry.create(name);
  }
  resolve(taskId: string): TaskContext {
    if (this.closed)
      throw new DomainError("SERVICE_CLOSED", "任务服务已关闭", 503);
    const task = this.registry.get(taskId);
    if (
      task.origin === "legacy" &&
      existsSync(join(this.registry.root, "legacy-migration.pending.json")) &&
      !existsSync(join(this.registry.root, "legacy-migration.json"))
    )
      throw new DomainError(
        "TASK_MIGRATING",
        "旧任务迁移尚未完成，请先重试迁移",
        409,
      );
    const workspace = this.registry.resolveRoot(taskId);
    let context = this.contexts.get(taskId);
    if (!context) {
      const store = new TaskStore(workspace, taskId);
      context = {
        task,
        store,
        runs: new RunService(store, {
          budget: this.budget,
          autoStart: this.options.autoStart,
        }),
      };
      this.contexts.set(taskId, context);
      if (!this.temporary) {
        const directory = join(workspace, "inputs");
        if (
          existsSync(directory) &&
          (lstatSync(directory).isSymbolicLink() ||
            realpathSync(directory) !== directory)
        )
          throw new DomainError(
            "TASK_PATH_INVALID",
            "任务输入目录被重定向",
            403,
          );
        mkdirSync(directory, { recursive: true });
        this.watchers.set(
          taskId,
          watchInputs(
            store,
            [directory],
            () => !this.closed && this.registry.get(taskId).status === "active",
          ),
        );
      }
    }
    context.task = task;
    return context;
  }
  actor(request: TaskRequest, taskId?: string): TaskActor {
    const header = request.headers.authorization;
    if (!header) return "user";
    const token = /^Bearer (.+)$/.exec(header)?.[1];
    if (!token) throw new DomainError("UNAUTHORIZED", "无效的 Agent 凭据", 401);
    for (const [id, credential] of this.credentials) {
      const left = Buffer.from(token),
        right = Buffer.from(credential);
      if (left.length === right.length && timingSafeEqual(left, right)) {
        if (!taskId || id !== taskId)
          throw new DomainError(
            "TASK_ACCESS_DENIED",
            "Agent 凭据仅允许访问绑定任务",
            403,
          );
        return "agent";
      }
    }
    throw new DomainError("UNAUTHORIZED", "Agent 凭据不存在或已失效", 401);
  }
  authorize(request: TaskRequest, taskId: string): AuthorizedTaskContext {
    const actor = this.actor(request, taskId);
    const context = this.resolve(taskId);
    if (
      context.task.status === "archived" &&
      request.method &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method)
    )
      throw new DomainError("TASK_ARCHIVED", "归档任务不能修改，请先恢复", 409);
    return { ...context, actor };
  }
  requireUser(request: TaskRequest, taskId?: string) {
    if (this.actor(request, taskId) !== "user")
      throw new DomainError("HUMAN_REQUIRED", "此操作需要用户确认", 403);
  }
  getAgentCredential(taskId: string): string {
    this.resolve(taskId);
    const file = this.credentialsPath();
    if (
      existsSync(file) &&
      (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())
    )
      throw new DomainError("TASK_PATH_INVALID", "凭据文件路径被替换", 403);
    let token = this.credentials.get(taskId);
    if (!token) {
      token = randomBytes(32).toString("base64url");
      const pending = new Map(this.credentials);
      pending.set(taskId, token);
      const temporary = file + "." + randomUUID();
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(pending)), {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temporary, file);
      this.credentials.set(taskId, token);
    }
    return token;
  }
  private credentialsPath() {
    return join(this.registry.root, "agent-credentials.json");
  }
  copy(taskId: string, name: unknown): Task {
    const source = this.resolve(taskId);
    if (source.store.activeRuns().length)
      throw new DomainError("TASK_BUSY", "请等待实验完成或取消后复制", 409);
    const task = this.registry.create(name ?? source.task.name + " 副本", {
      copiedFrom: taskId,
    });
    const target = this.resolve(task.id);
    // Copy immutable rows through SQLite, rather than regenerating IDs or content hashes.
    for (const table of ["assets", "runs", "documents", "audit"]) {
      const rows = source.store.db.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        if (
          table === "documents" &&
          (String(row.kind).startsWith("agent-") ||
            String(row.kind).startsWith("workflow"))
        )
          continue;
        const columns = Object.keys(row);
        target.store.db
          .prepare(
            `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          )
          .run(...Object.values(row));
      }
    }
    // Current designs belong to the destination; historical runs remain byte-identical.
    for (const design of target.store.documents("design")) {
      const request = structuredClone(design.request);
      if (Array.isArray(request?.assetRefs))
        request.assetRefs = request.assetRefs.map((ref: any) => ({
          ...ref,
          ...(ref.taskId ? { taskId: task.id } : {}),
        }));
      target.store.putDocument(
        "design",
        {
          ...design,
          request,
          session: "",
          confirmed: [],
          stage: 0,
          inputHash: hash({ request, scenario: design.scenario }),
        },
        design.id,
      );
    }
    // Record provenance so frozen dependency qualifiers resolve in this copy only.
    target.store.putDocument("task-copy", {
      sourceTaskId: taskId,
      copiedAt: new Date().toISOString(),
    });
    return task;
  }
  archive(taskId: string, archived = true): Task {
    const context = this.resolve(taskId);
    if (archived && context.store.activeRuns().length)
      throw new DomainError("TASK_BUSY", "请先完成或取消运行中的实验", 409);
    return this.registry.archive(taskId, archived);
  }
  migrateLegacy({ dryRun = true }: { dryRun?: boolean } = {}):
    | TaskMigrationManifest
    | (Omit<TaskMigrationManifest, "createdAt"> & { dryRun: true }) {
    this.registry.assertRoot();
    const manifestPath = join(this.registry.root, "legacy-migration.json");
    const pendingPath = join(
      this.registry.root,
      "legacy-migration.pending.json",
    );
    if (existsSync(manifestPath)) {
      if (lstatSync(manifestPath).isSymbolicLink())
        throw new DomainError("TASK_PATH_INVALID", "迁移清单路径无效", 403);
      return JSON.parse(readFileSync(manifestPath, "utf8"));
    }
    const sourcePath = join(this.registry.root, "reliability.sqlite");
    if (!existsSync(sourcePath))
      throw new DomainError("LEGACY_NOT_FOUND", "旧工作区数据库不存在", 404);
    const sourceFiles = ["reliability.sqlite", "reliability.sqlite-wal"].filter(
      (name) => existsSync(join(this.registry.root, name)),
    );
    const files = sourceFiles.map((name) => {
      const file = join(this.registry.root, name);
      if (lstatSync(file).isSymbolicLink())
        throw new DomainError(
          "TASK_PATH_INVALID",
          "旧数据库文件不能为符号链接",
          403,
        );
      return { name, contentHash: digest(readFileSync(file)) };
    });
    // Every attempt gets a clean directory; an earlier WAL must never be applied
    // to a later database snapshot after an interrupted migration.
    const backupRoot = join(
      this.registry.root,
      "backups",
      "legacy",
      randomUUID(),
    );
    const manifest = {
      schemaVersion: "1.0.0" as const,
      taskId: "legacy" as const,
      sourcePath,
      sourceHash: files[0].contentHash,
      backupPath: join(backupRoot, "reliability.sqlite"),
      databasePath: join(
        this.registry.workspacesRoot,
        "legacy",
        "reliability.sqlite",
      ),
      files,
    };
    if (dryRun) return { ...manifest, dryRun: true };
    if (existsSync(pendingPath)) {
      if (lstatSync(pendingPath).isSymbolicLink())
        throw new DomainError("TASK_PATH_INVALID", "迁移恢复标记被重定向", 403);
      const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
      const existing = this.registry
        .list()
        .find((task) => task.id === "legacy");
      if (
        pending.taskId !== "legacy" ||
        (existing && existing.origin !== "legacy")
      )
        throw new DomainError("MIGRATION_CONFLICT", "迁移恢复标记不匹配", 409);
      if (existing) this.registry.discardNew(existing.id);
      else {
        // Only this durable migration marker authorizes reclaiming its orphan directory.
        const orphan = join(this.registry.workspacesRoot, "legacy");
        this.registry.assertRoot();
        if (existsSync(orphan)) {
          if (
            lstatSync(orphan).isSymbolicLink() ||
            realpathSync(orphan) !== orphan
          )
            throw new DomainError(
              "TASK_PATH_INVALID",
              "未完成的迁移目录被重定向",
              403,
            );
          rmSync(orphan, { recursive: true });
        }
      }
      rmSync(pendingPath);
    }
    if (this.registry.list().some((task) => task.id === "legacy"))
      throw new DomainError(
        "MIGRATION_CONFLICT",
        "legacy 任务已存在但无迁移清单",
        409,
      );
    for (const directory of [
      join(this.registry.root, "backups"),
      join(this.registry.root, "backups", "legacy"),
      backupRoot,
    ]) {
      if (!existsSync(directory)) mkdirSync(directory);
      if (
        lstatSync(directory).isSymbolicLink() ||
        realpathSync(directory) !== directory
      )
        throw new DomainError("TASK_PATH_INVALID", "迁移备份目录被重定向", 403);
    }
    writeFileSync(
      pendingPath,
      JSON.stringify({
        taskId: "legacy",
        sourceHash: manifest.sourceHash,
        startedAt: new Date().toISOString(),
      }),
      { flag: "wx" },
    );
    const task = this.registry.create("Legacy workspace", {
      id: "legacy",
      origin: "legacy",
    });
    try {
      for (const file of files) {
        const backup = join(backupRoot, file.name);
        if (existsSync(backup) && lstatSync(backup).isSymbolicLink())
          throw new DomainError(
            "TASK_PATH_INVALID",
            "迁移备份文件被重定向",
            403,
          );
        copyFileSync(join(this.registry.root, file.name), backup);
      }
      // Read the verified backup so SQLite cannot create even empty sidecar files in the old workspace.
      // VACUUM INTO yields one snapshot including WAL; source hashes are verified again below.
      const reader = new DatabaseSync(manifest.backupPath, { readOnly: true });
      try {
        reader.prepare("VACUUM INTO ?").run(manifest.databasePath);
      } finally {
        reader.close();
      }
      const latestFiles = [
        "reliability.sqlite",
        "reliability.sqlite-wal",
      ].filter((name) => existsSync(join(this.registry.root, name)));
      if (
        latestFiles.join() !== sourceFiles.join() ||
        files.some(
          (file) =>
            digest(readFileSync(join(this.registry.root, file.name))) !==
              file.contentHash ||
            digest(readFileSync(join(backupRoot, file.name))) !==
              file.contentHash,
        )
      )
        throw new DomainError(
          "MIGRATION_SOURCE_CHANGED",
          "迁移期间源文件变化，请停止旧服务后重试",
          409,
        );
      const completed: TaskMigrationManifest = {
        ...manifest,
        createdAt: new Date().toISOString(),
      };
      const pendingManifest = manifestPath + "." + randomUUID();
      writeFileSync(pendingManifest, JSON.stringify(completed, null, 2), {
        flag: "wx",
      });
      renameSync(pendingManifest, manifestPath);
      rmSync(pendingPath);
      return completed;
    } catch (error) {
      this.registry.discardNew(task.id);
      if (existsSync(pendingPath)) rmSync(pendingPath);
      throw error;
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(
      [...this.watchers.values()].map((watcher) => watcher?.close()),
    );
    for (const { runs, store } of this.contexts.values()) {
      runs.close();
      store.close();
    }
    this.contexts.clear();
    this.examples.close();
    this.registry.close();
    if (this.temporary)
      // Native Agent/MCP and filesystem watchers release Windows handles asynchronously.
      // Keep the event loop available during retries; never remove persistent task data here.
      await rm(this.registry.root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
  }
  private seedExamples() {
    for (const [index, [name, fit]] of [
      ["HBM", 587.431694],
      ["GPU", 1028.005464],
      ["网络", 286.885246],
      ["其他", 1512.978142],
    ].entries()) {
      const asset = this.examples.create("failure-mode", name + "示例模式", {
        fit,
        rateBasis: "device-hour",
        scope: "card",
        modelBinding: { array: "fits", index },
        source: "expert-v4",
        evidenceStatus: "illustrative",
      });
      this.examples.transition(asset.id, asset.revision, "validated");
      this.examples.transition(asset.id, asset.revision, "published");
    }
    for (const factor of getFactors()) {
      const asset = this.examples.create("mechanism", factor.name, {
        patch: factor.patch,
        description: factor.description,
        factorId: factor.id,
        evidenceStatus: "illustrative",
        modeIds: [],
      });
      this.examples.transition(asset.id, asset.revision, "validated");
      this.examples.transition(asset.id, asset.revision, "published");
    }
    this.examples.create("scenario-template", "AI 训练 · V4 基线", {
      ...getTrainingDefaults(),
      evidenceStatus: "illustrative",
    });
  }
}

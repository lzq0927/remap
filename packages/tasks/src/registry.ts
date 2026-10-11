import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DomainError } from "../../contracts/src/errors";
import type { Task } from "../../contracts/src/types";

export function validateTaskId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id))
    throw new DomainError("TASK_ID_INVALID", "任务 ID 无效");
}
function taskName(name: unknown): string {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 200)
    throw new DomainError("SCHEMA_INVALID", "任务名称必须为 1 至 200 个字符");
  return name.trim();
}
export class TaskRegistry {
  readonly root: string;
  readonly workspacesRoot: string;
  private db: DatabaseSync;
  constructor(dataDir: string) {
    mkdirSync(resolve(dataDir), { recursive: true });
    this.root = realpathSync(resolve(dataDir));
    this.workspacesRoot = join(this.root, "tasks");
    if (!existsSync(this.workspacesRoot)) mkdirSync(this.workspacesRoot);
    if (
      lstatSync(this.workspacesRoot).isSymbolicLink() ||
      realpathSync(this.workspacesRoot) !== this.workspacesRoot
    )
      throw new DomainError(
        "TASK_PATH_INVALID",
        "任务目录不得使用符号链接或 junction",
        403,
      );
    const registryPath = join(this.root, "task-registry.sqlite");
    if (existsSync(registryPath) && lstatSync(registryPath).isSymbolicLink())
      throw new DomainError("TASK_PATH_INVALID", "任务注册表路径无效", 403);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const sidecar = registryPath + suffix;
      if (existsSync(sidecar) && lstatSync(sidecar).isSymbolicLink())
        throw new DomainError(
          "TASK_PATH_INVALID",
          "任务注册表副文件被重定向",
          403,
        );
    }
    this.db = new DatabaseSync(registryPath);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
    );
  }
  list(includeArchived = true): Task[] {
    this.assertRoot();
    return this.db
      .prepare("SELECT payload FROM tasks ORDER BY rowid DESC")
      .all()
      .map((row: any) => JSON.parse(row.payload) as Task)
      .filter((task) => includeArchived || task.status === "active");
  }
  get(id: string): Task {
    this.assertRoot();
    validateTaskId(id);
    const row = this.db
      .prepare("SELECT payload FROM tasks WHERE id=?")
      .get(id) as any;
    if (!row) throw new DomainError("TASK_NOT_FOUND", "任务未注册", 404);
    return JSON.parse(row.payload);
  }
  /** Recheck both the registered root and database on every request, including cached contexts. */
  resolveRoot(id: string): string {
    const task = this.get(id);
    const expected = join(this.workspacesRoot, id);
    const rel = relative(this.workspacesRoot, task.workspacePath);
    if (
      task.workspacePath !== expected ||
      isAbsolute(rel) ||
      rel.startsWith("..") ||
      lstatSync(this.workspacesRoot).isSymbolicLink() ||
      realpathSync(this.workspacesRoot) !== this.workspacesRoot ||
      !existsSync(expected) ||
      lstatSync(expected).isSymbolicLink() ||
      realpathSync(expected) !== expected
    )
      throw new DomainError("TASK_PATH_INVALID", "已注册任务路径被重定向", 403);
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const database = join(expected, "reliability.sqlite" + suffix);
      if (
        existsSync(database) &&
        (lstatSync(database).isSymbolicLink() ||
          realpathSync(database) !== database)
      )
        throw new DomainError(
          "TASK_PATH_INVALID",
          "任务数据库路径被重定向",
          403,
        );
    }
    return expected;
  }
  create(
    name: unknown,
    options: { id?: string; copiedFrom?: string; origin?: Task["origin"] } = {},
  ): Task {
    this.assertRoot();
    const id = options.id ?? randomUUID();
    validateTaskId(id);
    name = taskName(name);
    if (this.list().some((task) => task.id === id))
      throw new DomainError("TASK_EXISTS", "任务已注册", 409);
    const workspacePath = join(this.workspacesRoot, id);
    if (existsSync(workspacePath))
      throw new DomainError("TASK_PATH_INVALID", "目标任务目录已存在", 409);
    mkdirSync(workspacePath);
    const now = new Date().toISOString();
    const task: Task = {
      id,
      name: name as string,
      workspacePath,
      status: "active",
      createdAt: now,
      updatedAt: now,
      origin: options.origin ?? "local",
      ...(options.copiedFrom ? { copiedFrom: options.copiedFrom } : {}),
    };
    this.db
      .prepare("INSERT INTO tasks VALUES (?,?)")
      .run(id, JSON.stringify(task));
    return task;
  }
  rename(id: string, name: unknown): Task {
    const task = this.get(id);
    task.name = taskName(name);
    return this.update(task);
  }
  archive(id: string, archived = true): Task {
    const task = this.get(id);
    task.status = archived ? "archived" : "active";
    return this.update(task);
  }
  private update(task: Task) {
    task.updatedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE tasks SET payload=? WHERE id=?")
      .run(JSON.stringify(task), task.id);
    return task;
  }
  assertRoot() {
    for (const directory of [this.root, this.workspacesRoot])
      if (
        !existsSync(directory) ||
        lstatSync(directory).isSymbolicLink() ||
        realpathSync(directory) !== directory
      )
        throw new DomainError(
          "TASK_PATH_INVALID",
          "已注册工作区根目录被重定向",
          403,
        );
  }
  /** Used only to roll back a newly allocated task before any service opens it. */
  discardNew(id: string) {
    const workspace = this.resolveRoot(id);
    this.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
    rmSync(workspace, { recursive: true, force: true });
  }
  close() {
    this.db.close();
  }
}

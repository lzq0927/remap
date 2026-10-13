import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { fork, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "../../assets/src/store";
import { hash } from "../../assets/src/hash";
import { DomainError } from "../../contracts/src/errors";
import type { Run } from "../../contracts/src/types";

/** A single process-wide compute budget, shared by all task schedulers. */
export class RunBudget {
  private running = 0;
  private listeners = new Set<() => void>();
  constructor(readonly limit = 2) {}
  get active() {
    return this.running;
  }
  acquire(owner?: () => void): boolean {
    if (this.running >= this.limit) return false;
    this.running++;
    if (owner && this.listeners.has(owner)) {
      this.listeners.delete(owner);
      this.listeners.add(owner);
    }
    return true;
  }
  release() {
    this.running = Math.max(0, this.running - 1);
    for (const listener of this.listeners) queueMicrotask(listener);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
  }
  unsubscribe(listener: () => void) {
    this.listeners.delete(listener);
  }
}
const defaultBudget = new RunBudget();

export class RunService extends EventEmitter {
  private children = new Map<string, ChildProcess>();
  private closed = false;
  private budget: RunBudget;
  private wake = () => this.pump();
  get(id: string) {
    return this.store.getRun(id);
  }
  constructor(
    public store: Store,
    private options: { autoStart?: boolean; budget?: RunBudget } = {},
  ) {
    super();
    this.budget = options.budget ?? defaultBudget;
    if (options.autoStart !== false) this.budget.subscribe(this.wake);
    for (const run of store.activeRuns())
      if (run.status === "running") {
        run.status = "failed";
        run.error = {
          code: "SERVICE_INTERRUPTED",
          message: "服务在计算期间停止，请基于已保存输入重放",
        };
        run.completedAt = new Date().toISOString();
        store.saveRun(run);
      }
    if (options.autoStart !== false) queueMicrotask(() => this.pump());
  }
  start(operation: string, input: Record<string, any>, key?: string): Run {
    const inputHash = hash({ operation, input });
    if (this.closed) throw new DomainError("SERVICE_CLOSED", "服务已关闭", 503);
    if (key) {
      const existing = this.store.findRun(key);
      if (existing) {
        if (existing.inputHash !== inputHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "相同请求键对应不同输入",
            409,
          );
        return existing;
      }
    }
    if (this.store.activeRuns().length >= 32)
      throw new DomainError(
        "RESOURCE_LIMIT",
        "同时最多排队和运行 32 个实验",
        429,
      );
    const run: Run = {
      id: randomUUID(),
      status: "queued",
      operation,
      input: structuredClone(input),
      inputHash,
      createdAt: new Date().toISOString(),
      progress: 0,
      events: [],
    };
    this.store.saveRun(run, key);
    this.event(run.id, "queued", { operation });
    if (this.options.autoStart !== false) queueMicrotask(() => this.pump());
    return this.store.getRun(run.id);
  }
  event(
    id: string,
    type: string,
    payload: Record<string, any>,
    progress?: number,
  ) {
    const run = this.store.getRun(id);
    if (progress !== undefined) run.progress = progress;
    const event = {
      runId: id,
      sequence: run.events.length + 1,
      stepId: run.operation,
      type,
      payload,
      createdAt: new Date().toISOString(),
    };
    run.events.push(event);
    this.store.saveRun(run);
    this.emit("event", event);
  }
  complete(id: string, result: any, error?: any) {
    const run = this.store.getRun(id);
    if (
      run.status === "cancelled" ||
      run.status === "succeeded" ||
      run.status === "failed"
    )
      return run;
    run.status = error ? "failed" : "succeeded";
    run.result = result;
    if (error)
      run.error = {
        code: error.code ?? "SOLVER_FAILED",
        message: error.message ?? String(error),
      };
    run.progress = error ? run.progress : 1;
    run.completedAt = new Date().toISOString();
    this.store.saveRun(run);
    this.event(id, run.status, { result, error: run.error });
    return this.store.getRun(id);
  }
  cancel(id: string) {
    const run = this.store.getRun(id);
    if (!["queued", "running"].includes(run.status)) return run;
    run.status = "cancelled";
    run.completedAt = new Date().toISOString();
    this.store.saveRun(run);
    const child = this.children.get(id);
    if (child) this.terminate(child);
    this.event(id, "cancelled", {});
    return this.store.getRun(id);
  }
  private pump() {
    if (this.closed) return;
    for (const run of this.store
      .activeRuns()
      .filter((x) => x.status === "queued")) {
      if (!this.budget.acquire(this.wake)) break;
      run.status = "running";
      this.store.saveRun(run);
      this.event(run.id, "running", {});
      if (this.closed || this.store.getRun(run.id).status !== "running") {
        this.budget.release();
        return;
      }
      const child = fork(
        fileURLToPath(new URL("./worker.ts", import.meta.url)),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
          env: process.env,
          detached: process.platform !== "win32",
        },
      );
      this.children.set(run.id, child);
      let stderr = "";
      child.stderr?.on("data", (b) => (stderr += b.toString()));
      child.on("message", (m: any) => {
        if (this.closed) return;
        if (!["running", "queued"].includes(this.store.getRun(run.id).status))
          return;
        if (m.type === "progress")
          this.event(run.id, "progress", m.payload ?? {}, m.progress);
        if (m.type === "result") this.complete(run.id, m.result);
        if (m.type === "error") this.complete(run.id, undefined, m.error);
      });
      child.on("error", (e) => {
        if (!this.closed) this.complete(run.id, undefined, e);
      });
      child.on("close", (code) => {
        this.budget.release();
        if (this.closed) return;
        const latest = this.store.getRun(run.id);
        if (latest.status === "running")
          this.complete(run.id, undefined, {
            code: "WORKER_EXIT",
            message: stderr || "求解器进程退出 " + code,
          });
        this.children.delete(run.id);
      });
      child.send({ operation: run.operation, input: run.input });
    }
  }
  close() {
    this.closed = true;
    this.budget.unsubscribe(this.wake);
    for (const [id] of this.children) {
      this.cancel(id);
    }
    this.children.clear();
    this.removeAllListeners();
  }
  private terminate(child: ChildProcess) {
    if (process.platform === "win32" && child.pid && child.exitCode === null) {
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.on("error", () => child.kill());
    } else if (child.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill();
      }
    }
  }
}

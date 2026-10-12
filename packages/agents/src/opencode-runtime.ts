import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { findOpenCode } from "../../../scripts/runtime.mjs";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
  internalOpenCodeConfig,
} from "../../runtime-policy/src/index";

const executeFile = promisify(execFile);
function assertLocal(path: string) {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error("Agent 运行目录不得重定向");
}
export function nativeTaskEnvironment(directory: string): NodeJS.ProcessEnv {
  const policy = readRuntimePolicy();
  return {
    ...process.env,
    OPENCODE_DB: join(directory, ".opencode-runtime", "opencode.db"),
    XDG_STATE_HOME: join(directory, ".opencode-runtime", "state"),
    ...(policy.profile === "internal"
      ? {
          OPENCODE_DISABLE_AUTOUPDATE: "true",
          OPENCODE_DISABLE_SHARE: "true",
          OPENCODE_DISABLE_MODELS_FETCH: "true",
          OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
          OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
          OPENCODE_DISABLE_CLAUDE_CODE: "true",
          OPENCODE_CONFIG_CONTENT: JSON.stringify(
            internalOpenCodeConfig(policy),
          ),
        }
      : {}),
  };
}

/** Runs the installed native UI per task. Only session/state storage is relocated;
 * provider credentials remain in native OpenCode's existing local credential store. */
export class OpenCodeTaskRuntime {
  private entries = new Map<
    string,
    { ready: Promise<string>; child?: ChildProcess }
  >();
  private closed = false;
  ensure(directory: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error("Agent 服务已关闭"));
    const existing = this.entries.get(directory);
    if (existing) return existing.ready;
    const entry: { ready: Promise<string>; child?: ChildProcess } = {
      ready: Promise.resolve(""),
    };
    this.entries.set(directory, entry);
    entry.ready = this.start(directory, entry).catch((error) => {
      if (entry.child?.connected) entry.child.disconnect();
      if (this.entries.get(directory) === entry) this.entries.delete(directory);
      throw error;
    });
    return entry.ready;
  }
  private async start(directory: string, entry: { child?: ChildProcess }) {
    const binary = findOpenCode();
    if (!binary || /\.(cmd|bat)$/i.test(binary))
      throw new Error(
        "未找到原生 OpenCode，请设置 OPENCODE_BIN 或安装 opencode-ai",
      );
    const root = join(directory, ".opencode-runtime");
    assertLocal(root);
    await mkdir(root, { recursive: true });
    for (const name of [
      "opencode.db",
      "opencode.db-wal",
      "opencode.db-shm",
      "port.json",
      "state",
    ])
      assertLocal(join(root, name));
    try {
      const { stdout } = await executeFile(binary, ["db", "path", "--pure"], {
        cwd: directory,
        env: nativeTaskEnvironment(directory),
        windowsHide: true,
        timeout: 15000,
      });
      if (resolve(stdout.trim()) !== resolve(join(root, "opencode.db")))
        throw new Error("unscoped database");
    } catch {
      throw new Error(
        "当前本地 OpenCode 不支持 OPENCODE_DB 会话隔离，请升级到支持此选项的版本（已验证 1.18.35）",
      );
    }
    const portFile = join(root, "port.json");
    const saved = existsSync(portFile)
      ? JSON.parse(await readFile(portFile, "utf8")).port
      : undefined;
    // Stable origins keep native browser preferences apart across tasks/restarts.
    const preferred =
      Number.isInteger(saved) && saved >= 20000 && saved <= 55000
        ? saved
        : 20000 +
          (createHash("sha256").update(directory).digest().readUInt32BE(0) %
            30000);
    const port = await this.availablePort(preferred);
    const url = "http://127.0.0.1:" + port;
    assertEndpointAllowed(url, "opencode");
    if (this.closed) throw new Error("Agent 服务已关闭");
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../../scripts/opencode-task-host.mjs", import.meta.url),
        ),
        binary,
        directory,
        String(port),
      ],
      {
        cwd: directory,
        env: nativeTaskEnvironment(directory),
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    entry.child = child;
    let failed = false;
    child.once("error", () => {
      failed = true;
    });
    child.once("exit", () => {
      failed = true;
      if (!this.closed && this.entries.get(directory) === entry)
        this.entries.delete(directory);
    });
    const headers: Record<string, string> = {};
    if (process.env.OPENCODE_SERVER_PASSWORD)
      headers.Authorization =
        "Basic " +
        Buffer.from(
          (process.env.OPENCODE_SERVER_USERNAME ?? "opencode") +
            ":" +
            process.env.OPENCODE_SERVER_PASSWORD,
        ).toString("base64");
    const deadline = Date.now() + 45000;
    while (!this.closed && !failed && Date.now() < deadline) {
      try {
        const response = await fetch(url + "/global/health", {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok && (await response.json()).healthy === true) {
          await writeFile(portFile, JSON.stringify({ port }));
          return url;
        }
      } catch {
        /* cold start */
      }
      await pause(150);
    }
    throw new Error("任务 OpenCode 启动失败；请检查本地安装与运行日志");
  }
  private async availablePort(preferred: number): Promise<number> {
    for (let offset = 0; offset < 100; offset++) {
      const port = 20000 + ((preferred - 20000 + offset) % 35001);
      const probe = createServer();
      const free = await new Promise<boolean>((resolve) => {
        probe.once("error", () => resolve(false));
        probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
      });
      if (free) return port;
    }
    throw new Error("没有可用的任务 Agent 本地端口");
  }
  async importSession(directory: string, data: any) {
    const binary = findOpenCode();
    if (!binary) throw new Error("未找到本地 OpenCode");
    const file = join(directory, ".opencode-runtime", "session-import.json");
    assertLocal(file);
    try {
      await writeFile(file, JSON.stringify(data));
      await executeFile(binary, ["import", file, "--pure"], {
        cwd: directory,
        env: nativeTaskEnvironment(directory),
        windowsHide: true,
        timeout: 45000,
      });
    } catch {
      // CLI diagnostics can contain transcript data: never echo them to the UI/log.
      throw new Error(
        "任务历史会话迁移失败；原会话未删除，请检查本机 OpenCode 版本",
      );
    } finally {
      await unlink(file).catch(() => {});
    }
  }
  async migrateSession(directory: string, sessionId: string) {
    const binary = findOpenCode();
    if (!binary) throw new Error("未找到本地 OpenCode");
    let data: any;
    try {
      const { stdout } = await executeFile(
        binary,
        ["export", sessionId, "--pure"],
        {
          cwd: directory,
          env: {
            ...nativeTaskEnvironment(directory),
            OPENCODE_DB: process.env.OPENCODE_DB,
          },
          windowsHide: true,
          timeout: 45000,
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      data = JSON.parse(stdout);
    } catch (error: any) {
      // Missing/deleted historical binding is safe to replace with a new primary.
      if (String(error.stderr).includes("Session not found")) return;
      throw new Error(
        "读取本任务历史会话失败；原会话保留，请检查本地 OpenCode",
      );
    }
    if (data.info?.directory !== directory || data.info?.id !== sessionId)
      throw new Error("历史会话不属于当前任务目录，禁止迁移");
    await this.importSession(directory, data);
  }
  async close() {
    this.closed = true;
    await Promise.allSettled(
      [...this.entries.values()].map(async (entry) => {
        if (entry.child?.connected) entry.child.disconnect();
        await entry.ready.catch(() => {});
        const child = entry.child;
        if (child && child.exitCode === null && child.signalCode === null) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 5000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
      }),
    );
    this.entries.clear();
  }
}

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
} from "../../runtime-policy/src/index";
import {
  toolResultSchema,
  type ToolInput,
  type ToolResult,
  type ToolAdapter,
} from "./tool-contract";

const externalSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[\w-]+$/),
        name: z.string(),
        version: z.string(),
        methods: z.array(z.enum(["p", "external"])),
        mode: z.enum(["cli", "http", "file"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional(),
      })
      .strict(),
  )
  .max(30);
export function externalTools() {
  const path = process.env.REMAP_ENGINEERING_TOOLS;
  return path
    ? externalSchema.parse(
        JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")),
      )
    : [];
}
export function toolCapabilities() {
  return [
    {
      id: "static-bdd",
      name: "内置精确 BDD",
      version: "1",
      methods: ["rbd", "fta"],
      mode: "builtin",
      available: true,
    },
    ...externalTools().map((x) => ({
      id: x.id,
      name: x.name,
      version: x.version,
      methods: x.methods,
      mode: x.mode,
      available: true,
    })),
  ];
}
export async function runExternal(
  id: string,
  method: string,
  input: ToolInput,
): Promise<ToolResult> {
  const tool = externalTools().find(
    (x) => x.id === id && x.methods.includes(method as "p"),
  );
  if (!tool) throw new Error("管理员未配置匹配的工具适配器：" + id);
  if (tool.mode === "file")
    throw new Error("文件适配器需导出输入后由用户导入真实结果");
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 60000
  )
    throw new Error("工具时间预算必须在1到60000毫秒之间");
  let raw: string;
  if (tool.mode === "http") {
    const url = assertEndpointAllowed(tool.url!, "api", readRuntimePolicy());
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(input.timeoutMs),
      redirect: "error",
    });
    if (!r.ok) throw new Error("工具 HTTP " + r.status);
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!r.body) throw new Error("工具 HTTP 响应为空");
    const reader = r.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) throw new Error("工具输出超限");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    raw = Buffer.concat(chunks).toString("utf8");
  } else {
    if (!tool.command) throw new Error("CLI 工具缺少管理员配置的可执行程序");
    if (!isAbsolute(tool.command))
      throw new Error("CLI 工具必须配置绝对可执行路径");
    const directory = await mkdtemp(join(tmpdir(), "remap-tool-"));
    try {
      raw = await new Promise<string>((done, reject) => {
        const child = spawn(tool.command!, tool.args ?? [], {
          cwd: directory,
          windowsHide: true,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "",
          err = "";
        let failure: Error | undefined,
          received = 0;
        const stop = (message: string) => {
          if (failure) return;
          failure = new Error(message);
          if (process.platform === "win32" && child.pid) {
            const killer = spawn(
              "taskkill",
              ["/pid", String(child.pid), "/t", "/f"],
              { windowsHide: true, stdio: "ignore" },
            );
            killer.on("error", () => child.kill());
          } else child.kill();
        };
        const timer = setTimeout(() => {
          stop("外部工具超时");
        }, input.timeoutMs);
        child.stdout.on("data", (b) => {
          received += b.length;
          if (received > 2_000_000) stop("工具输出超限");
          else out += b;
        });
        child.stderr.on("data", (b) => {
          received += b.length;
          if (received > 2_000_000) stop("工具输出超限");
          err = (err + b).slice(-10000);
        });
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (failure) reject(failure);
          else if (code === 0) done(out);
          else reject(new Error("外部工具退出 " + code + ": " + err));
        });
        child.stdin.on("error", () => {
          /* child exit is handled above */
        });
        child.stdin.end(JSON.stringify(input));
      });
    } finally {
      const rel = relative(tmpdir(), directory);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel))
        await rm(directory, { recursive: true, force: true });
    }
  }
  if (raw.length > 2_000_000) throw new Error("工具输出超限");
  return toolResultSchema.parse(JSON.parse(raw));
}
export function getToolAdapter(id: string, method: string): ToolAdapter {
  const capability = toolCapabilities().find(
    (t) => t.id === id && t.methods.includes(method),
  );
  if (!capability) throw new Error("管理员未配置匹配的工具适配器：" + id);
  return {
    id,
    version: capability.version,
    methods: capability.methods,
    describeCapabilities: () => capability,
    validateInputs(input) {
      if (!capability.available) throw new Error("工具尚未安装：" + id);
      if (capability.mode === "file")
        throw new Error("该工具使用文件交换，请导出输入并导入执行结果");
      if (!input.files.length) throw new Error("外部工具需要原生输入文件");
    },
    execute(input) {
      this.validateInputs(input);
      return runExternal(id, method, input);
    },
  };
}

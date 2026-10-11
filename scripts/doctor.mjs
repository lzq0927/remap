import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
  assertDataDirectory,
} from "../packages/runtime-policy/src/index.mjs";
import {
  enterProject,
  projectRoot,
  findOpenCode,
  runCommand,
  probePython,
  writableDirectory,
  apiRequest,
} from "./runtime.mjs";
enterProject();
const checks = [];
const add = (name, required, ok, details) =>
  checks.push({ name, required, ok, details });
const policy = readRuntimePolicy();
add("runtime-policy", true, true, {
  profile: policy.profile,
  allowedOrigins: policy.allowedOrigins,
  provider: policy.provider
    ? { id: policy.provider.id, defaultModel: policy.provider.defaultModel }
    : null,
  adapter: policy.adapter
    ? { id: policy.adapter.id, version: policy.adapter.version }
    : null,
  note: "应用配置校验；网络出口隔离仍需公司网络策略验收",
});
add(
  "node",
  true,
  Number(process.versions.node.split(".")[0]) >= 24,
  process.version,
);
add(
  "dependencies",
  true,
  existsSync(join(projectRoot, "node_modules/tsx")),
  "缺少时运行 pnpm install --frozen-lockfile",
);
add(
  "skill",
  true,
  existsSync(join(projectRoot, "skills/sd-dfr-remap/SKILL.md")),
  "任务工作区会由服务安装 Skill 与任务绑定配置",
);
try {
  await writableDirectory(
    assertDataDirectory(
      resolve(projectRoot, process.env.DATA_DIR ?? "data"),
      policy,
    ),
  );
  add("data-directory", true, true, "目录可写");
} catch {
  add("data-directory", true, false, "数据目录不可写，请配置 DATA_DIR");
}
const binary = findOpenCode();
if (binary) {
  const version = runCommand(binary, ["--version"], {
    encoding: "utf8",
    timeout: 10000,
  });
  add(
    "opencode-installed",
    false,
    version.status === 0,
    version.status === 0
      ? version.stdout.trim().slice(0, 100)
      : "可执行文件存在，但版本检查失败",
  );
} else
  add(
    "opencode-installed",
    false,
    false,
    "OpenCode 可选；配置 OPENCODE_BIN 或 OPENCODE_URL",
  );
try {
  const endpoint = new URL(process.env.OPENCODE_URL ?? "http://127.0.0.1:4096");
  assertEndpointAllowed(endpoint, "opencode", policy);
  const headers = {};
  if (process.env.OPENCODE_SERVER_PASSWORD)
    headers.Authorization =
      "Basic " +
      Buffer.from(
        (process.env.OPENCODE_SERVER_USERNAME ?? "opencode") +
          ":" +
          process.env.OPENCODE_SERVER_PASSWORD,
      ).toString("base64");
  const response = await fetch(new URL("/global/health", endpoint), {
    ...(policy.profile === "internal" ? { redirect: "error" } : {}),
    headers,
    signal: AbortSignal.timeout(2000),
  });
  const data = response.ok ? await response.json() : {};
  add("opencode-service", false, response.ok && data.healthy === true, {
    version: data.version ?? null,
    httpStatus: response.status,
  });
} catch {
  add(
    "opencode-service",
    false,
    false,
    "服务未连接；运行 pnpm agent，数值功能仍可使用",
  );
}
const python = probePython();
add(
  "ctmc-python",
  process.env.RELIABILITY_REQUIRE_CTMC === "1",
  python.available,
  python.available
    ? { python: python.python, scipy: python.scipy, numpy: python.numpy }
    : python.message,
);
try {
  const { register } = await import("tsx/esm/api");
  register();
  const { solveStatic } = await import(
    pathToFileURL(join(projectRoot, "packages/solvers/src/static.ts")).href
  );
  const result = solveStatic({
    tree: { type: "event", id: "doctor", probability: 0.99 },
    method: "rbd",
  });
  add("local-solver", true, Math.abs(result.probability - 0.99) < 1e-12, {
    probability: result.probability,
  });
} catch {
  add("local-solver", true, false, "本地最小求解失败，请检查依赖");
}
const taskIndex = process.argv.indexOf("--task");
if (taskIndex >= 0) {
  const taskId = process.argv[taskIndex + 1];
  let client;
  try {
    if (!taskId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(taskId))
      throw new Error("task ID 无效");
    await apiRequest("/api/tasks/" + encodeURIComponent(taskId));
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    client = new Client({ name: "rem-doctor", version: "0.1.0" });
    const compiledEntry = join(
      projectRoot,
      "packages/mcp-runtime/dist/launch.mjs",
    );
    const compiled = existsSync(compiledEntry);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        ...(compiled
          ? [compiledEntry]
          : [
              "--import",
              pathToFileURL(
                join(projectRoot, "node_modules/tsx/dist/loader.mjs"),
              ).href,
              join(projectRoot, "packages/mcp-runtime/src/launch.ts"),
            ]),
        resolve(projectRoot, process.env.DATA_DIR ?? "data"),
        taskId,
        process.env.RELIABILITY_API_URL ??
          "http://127.0.0.1:" + (process.env.PORT ?? 4178),
      ],
      stderr: "pipe",
    });
    await client.connect(transport);
    const tools = await client.listTools();
    const result = await client.callTool({
      name: "task_current",
      arguments: {},
    });
    add(
      "task-mcp-handshake",
      true,
      !result.isError &&
        tools.tools.some((tool) => tool.name === "task_current"),
      {
        tools: tools.tools.length,
        taskId,
        entry: compiled ? "compiled" : "source",
      },
    );
  } catch {
    add(
      "task-mcp-handshake",
      true,
      false,
      "任务 MCP 检查失败：确认 API 已运行、task ID 正确且数据根一致",
    );
  } finally {
    if (client) await client.close();
  }
}
const ok = checks.every((check) => !check.required || check.ok);
console.log(
  JSON.stringify(
    {
      status: ok ? "passed" : "failed",
      checks,
      model: {
        configured:
          !!process.env.MODEL_API_KEY &&
          !!process.env.MODEL_ID &&
          !!process.env.MODEL_BASE_URL,
        verified: false,
        note: "未调用模型；GLM 与提供商能力须单独验收",
      },
    },
    null,
    2,
  ),
);
process.exitCode = ok ? 0 : 1;

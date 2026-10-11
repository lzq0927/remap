import { spawn } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { enterProject, findOpenCode } from "./runtime.mjs";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
  internalOpenCodeConfig,
} from "../packages/runtime-policy/src/index";
enterProject();
const policy = readRuntimePolicy();
const endpoint = new URL(process.env.OPENCODE_URL ?? "http://127.0.0.1:4096");
assertEndpointAllowed(endpoint, "opencode", policy);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
  endpoint.protocol !== "http:"
)
  throw new Error(
    "pnpm agent 只启动本机 HTTP 服务；远程 OpenCode 请直接配置 OPENCODE_URL 并运行工作台。",
  );
const headers: Record<string, string> = {};
if (process.env.OPENCODE_SERVER_PASSWORD)
  headers.Authorization =
    "Basic " +
    Buffer.from(
      (process.env.OPENCODE_SERVER_USERNAME ?? "opencode") +
        ":" +
        process.env.OPENCODE_SERVER_PASSWORD,
    ).toString("base64");
let serviceReady = false;
try {
  const response = await fetch(new URL("/global/health", endpoint), {
    ...(policy.profile === "internal" ? { redirect: "error" as const } : {}),
    headers,
    signal: AbortSignal.timeout(2000),
  });
  serviceReady = response.ok && (await response.json()).healthy === true;
} catch {
  /* start installed binary if service is not available */
}
if (serviceReady) {
  if (
    policy.profile === "internal" &&
    process.env.RELIABILITY_TRUST_RUNNING_OPENCODE !== "1"
  )
    throw new Error(
      "INTERNAL_OPENCODE_REUSE_FORBIDDEN: 停止旧服务并使用内网配置启动；管理员验收的既有服务需显式 RELIABILITY_TRUST_RUNNING_OPENCODE=1",
    );
  console.log("本地 OpenCode 已运行，保留现有服务。");
  process.exit(0);
}
const binary = findOpenCode();
if (!binary)
  throw new Error(
    "未找到本地 OpenCode。安装 opencode-ai，或在 .env 使用 OPENCODE_BIN 指向本机可执行文件。",
  );
if (/\.(cmd|bat)$/i.test(binary))
  throw new Error(
    "请把 OPENCODE_BIN 指向原生 OpenCode 可执行文件，而非 shell 包装脚本。",
  );
if (!existsSync(".opencode/skills/sd-dfr-remap")) {
  await mkdir(".opencode/skills", { recursive: true });
  await cp("skills/sd-dfr-remap", ".opencode/skills/sd-dfr-remap", {
    recursive: true,
  });
}
const child = spawn(
  binary,
  ["serve", "--port", endpoint.port || "4096", "--hostname", "127.0.0.1"],
  {
    stdio: "inherit",
    windowsHide: true,
    env:
      policy.profile === "internal"
        ? {
            ...process.env,
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
        : process.env,
  },
);
child.on("error", (error) => {
  console.error("OpenCode 启动失败：" + error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill());

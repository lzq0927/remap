import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readRuntimePolicy } from "../packages/runtime-policy/src/index.mjs";
import {
  enterProject,
  projectRoot,
  commandOnPath,
  runCommand,
  findOpenCode,
  apiRequest,
  invocationDirectory,
} from "./runtime.mjs";
enterProject();
const policy = readRuntimePolicy();
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("需要 Node.js 24 或更新版本");
if (process.argv.includes("--install")) {
  const storeIndex = process.argv.indexOf("--store-dir");
  const selectedStore =
    storeIndex < 0 ? undefined : process.argv[storeIndex + 1];
  if (storeIndex >= 0 && (!selectedStore || selectedStore.startsWith("--")))
    throw new Error("--store-dir requires an existing pnpm store directory");
  const storeDirectory = selectedStore
    ? resolve(invocationDirectory, selectedStore)
    : undefined;
  if (
    storeDirectory &&
    (!existsSync(storeDirectory) || !statSync(storeDirectory).isDirectory())
  )
    throw new Error("--store-dir requires an existing pnpm store directory");
  const pnpm = commandOnPath("pnpm");
  if (!pnpm) throw new Error("请先安装 pnpm 11");
  const result = runCommand(
    pnpm,
    [
      "install",
      "--frozen-lockfile",
      ...(policy.profile === "internal" || process.argv.includes("--offline")
        ? ["--offline"]
        : []),
      ...(policy.profile === "internal" ? ["--ignore-scripts"] : []),
      ...(storeDirectory ? ["--store-dir", storeDirectory] : []),
    ],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error("依赖安装失败，请检查 pnpm 和网络");
}
if (!existsSync(join(projectRoot, "node_modules/tsx")))
  throw new Error("请先运行 pnpm install --frozen-lockfile");
const envFile = join(projectRoot, ".env");
if (!process.env.RELIABILITY_ENV_FILE)
  try {
    await writeFile(
      envFile,
      await readFile(join(projectRoot, ".env.example")),
      {
        flag: "wx",
      },
    );
    console.log("已创建本机 .env 模板，请按需要配置。");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    console.log("已有 .env，保留现有配置。");
  }
else console.log("使用指定的 RELIABILITY_ENV_FILE，保留其配置。");
const skill = join(projectRoot, ".opencode/skills/sd-dfr-remap");
if (!existsSync(skill)) {
  await mkdir(skill, { recursive: true });
  await cp(join(projectRoot, "skills/sd-dfr-remap"), skill, {
    recursive: true,
  });
  console.log("已安装本地 Skill。");
} else
  console.log("已有本地 Skill，保留；显式运行 pnpm skill:install 可更新。");
console.log(
  findOpenCode()
    ? "已发现本地 OpenCode。运行 pnpm agent 或配置 OPENCODE_URL 连接已有服务。"
    : "未发现 OpenCode。数值工作台可直接启动；Agent 功能需安装 OpenCode 或设置 OPENCODE_URL。",
);
const taskIndex = process.argv.indexOf("--task");
if (taskIndex >= 0) {
  const taskId = process.argv[taskIndex + 1];
  if (!taskId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(taskId))
    throw new Error("用法：pnpm bootstrap --task <taskId>；API 需已运行");
  await apiRequest(
    "/api/tasks/" + encodeURIComponent(taskId) + "/agent/prepare",
    {},
  );
  console.log("任务 MCP 配置已准备；未创建会话或请求模型。");
}
console.log(
  "下一步：pnpm run doctor，然后 pnpm dev；生产界面使用 pnpm start。",
);

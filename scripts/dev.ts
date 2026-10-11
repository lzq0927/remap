import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { enterProject, findOpenCode } from "./runtime.mjs";
import { cp, mkdir } from "node:fs/promises";
enterProject();
if (process.env.START_AGENT === "1" && !findOpenCode())
  throw new Error(
    "OpenCode 未安装：运行 pnpm agent 检查，或设置 OPENCODE_BIN。",
  );
if (!existsSync(".opencode/skills/sd-dfr-remap")) {
  await mkdir(".opencode/skills", { recursive: true });
  await cp("skills/sd-dfr-remap", ".opencode/skills/sd-dfr-remap", {
    recursive: true,
  });
}
const children = [
  spawn(process.execPath, ["--import", "tsx", "apps/api/src/main.ts"], {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"],
    { stdio: "inherit", windowsHide: true, env: process.env },
  ),
];
if (process.env.START_AGENT === "1") {
  children.push(
    spawn(process.execPath, ["--import", "tsx", "scripts/agent.ts"], {
      stdio: "inherit",
      windowsHide: true,
      env: process.env,
    }),
  );
}
for (const s of ["SIGINT", "SIGTERM"] as const)
  process.on(s, () => {
    for (const p of children) p.kill();
    process.exit(0);
  });
for (const p of children) {
  p.on("error", (error) => {
    console.error("启动失败：" + error.message);
    for (const child of children) child.kill();
    process.exitCode = 1;
  });
  p.on("exit", (code) => {
    if (code) {
      for (const c of children) c.kill();
      process.exit(code);
    }
  });
}

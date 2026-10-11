import { enterProject } from "./runtime.mjs";
enterProject();
const entries = {
  start: "start-api.ts",
  api: "start-api.ts",
  dev: "dev.ts",
  agent: "agent.ts",
  bootstrap: "bootstrap.mjs",
  doctor: "doctor.mjs",
  "task-export": "export-task.ts",
  "task-import": "import-task.ts",
  "task-migrate": "migrate-legacy.ts",
  "verify-portable": "verify-portable.ts",
};
const action = process.argv[2] ?? "start";
if (!(action in entries))
  throw new Error(
    "用法：node scripts/launch.mjs [start|dev|agent|bootstrap|doctor|task-export|task-import|task-migrate|verify-portable]",
  );
process.argv.splice(2, 1);
if (entries[action].endsWith(".ts")) {
  try {
    const { register } = await import("tsx/esm/api");
    register();
  } catch {
    throw new Error(
      "未安装依赖。请在软件目录运行 pnpm install --frozen-lockfile，或 node scripts/launch.mjs bootstrap --install。",
    );
  }
}
await import(new URL(entries[action], import.meta.url).href);

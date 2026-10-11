import { apiRequest, enterProject } from "./runtime.mjs";
enterProject();
const args = process.argv.slice(2);
if (
  args.some((arg) => !["--apply", "--dry-run"].includes(arg)) ||
  (args.includes("--apply") && args.includes("--dry-run"))
)
  throw new Error("用法：pnpm task:migrate [--dry-run|--apply]；默认只预检。");
const dryRun = !args.includes("--apply");
const manifest = await apiRequest("/api/tasks/migrate-legacy", { dryRun });
console.log(
  JSON.stringify({ mode: dryRun ? "预检" : "迁移", ...manifest }, null, 2),
);

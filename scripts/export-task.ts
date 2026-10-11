import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  apiRequest,
  enterProject,
  invocationDirectory,
  projectRoot,
} from "./runtime.mjs";
const [taskId, output] = process.argv.slice(2);
if (!taskId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(taskId))
  throw new Error("用法：pnpm task:export <taskId> [输出.json]");
const target = output
  ? resolve(invocationDirectory, output)
  : resolve(projectRoot, "artifacts/tasks/" + taskId + ".json");
enterProject();
const bundle = await apiRequest(
  "/api/tasks/" + encodeURIComponent(taskId) + "/export",
);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(bundle, null, 2), { flag: "wx" });
console.log(
  "任务包已保存：" + target + "；任务输入可能包含业务数据，请按权限分享。",
);

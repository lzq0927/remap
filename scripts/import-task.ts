import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { apiRequest, enterProject, invocationDirectory } from "./runtime.mjs";
const [input, name] = process.argv.slice(2);
if (!input) throw new Error("用法：pnpm task:import <任务包.json> [新名称]");
const file = resolve(invocationDirectory, input);
enterProject();
const bundle = JSON.parse(await readFile(file, "utf8"));
const task = await apiRequest("/api/tasks/import", {
  bundle,
  ...(name ? { name } : {}),
});
console.log(
  JSON.stringify(
    {
      taskId: task.id,
      name: task.name,
      message: "已创建独立任务；来源与运行摘要保留，会话需要在本机重新关联。",
    },
    null,
    2,
  ),
);

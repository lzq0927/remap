import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "../packages/assets/src/hash";
import { enterProject, apiRequest } from "./runtime.mjs";
enterProject();
const [taskId, id] = process.argv.slice(2);
if (
  !taskId ||
  !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(taskId) ||
  !id ||
  !/^[0-9a-f-]{36}$/i.test(id)
)
  throw new Error("用法：pnpm exec tsx scripts/export-run.ts <taskId> <runId>");
const run = await apiRequest(
  "/api/tasks/" + encodeURIComponent(taskId) + "/runs/" + id,
);
if (run.status !== "succeeded")
  throw new Error("仅完整成功的运行可导出独立复现包");
const dir = join("artifacts", "replay", taskId, id);
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "run.json"), JSON.stringify(run, null, 2));
await writeFile(
  join(dir, "input.json"),
  JSON.stringify({ operation: run.operation, input: run.input }, null, 2),
);
await writeFile(
  join(dir, "manifest.json"),
  JSON.stringify(
    {
      taskId,
      runId: id,
      inputHash: run.inputHash,
      bundleHash: hash(run),
      resultHash: hash(run.result),
      seed: run.input.seed,
      modelVersion: run.result?.modelVersion,
      node: process.version,
    },
    null,
    2,
  ),
);
console.log("Replay bundle: " + dir);

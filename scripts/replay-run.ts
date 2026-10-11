import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hash } from "../packages/assets/src/hash";
import { enterProject } from "./runtime.mjs";
const inputDirectory = process.argv[2];
if (!inputDirectory)
  throw new Error(
    "用法：pnpm exec tsx scripts/replay-run.ts artifacts/replay/<taskId>/<runId>",
  );
const dir = resolve(inputDirectory);
enterProject();
const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
if (
  hash(run) !== manifest.bundleHash ||
  hash({ operation: run.operation, input: run.input }) !== manifest.inputHash
)
  throw new Error("复现包内容摘要不匹配");
const {
  assetSnapshot: _a,
  sourceSnapshot: _s,
  assetRefs: _r,
  inputId: _i,
  ...input
} = run.input;
let result: any;
if (run.operation === "training") {
  const { runTraining } = await import("../packages/solvers/src/training");
  result = runTraining(run.result?.request ?? input);
} else if (["rbd", "fta", "bdd"].includes(run.operation)) {
  const { solveStatic } = await import("../packages/solvers/src/static");
  result = solveStatic({ ...input, method: run.operation });
} else if (run.operation === "ctmc") {
  const { solveCtmc } = await import("../packages/solvers/src/ctmc");
  result = await solveCtmc(input);
} else if (run.operation === "allocate") {
  const { allocate } = await import("../packages/allocation/src/index");
  result = allocate(input);
} else {
  const analysis: any = await import("../packages/analysis/src/index");
  if (!analysis[run.operation]) throw new Error("未知操作");
  result = await analysis[run.operation](input);
}
const resultHash = hash(result),
  expectedHash = manifest.resultHash ?? hash(run.result);
const validation = {
  runId: run.id,
  inputHash: manifest.inputHash,
  resultHash,
  expectedHash,
  matchesOriginal: resultHash === expectedHash,
  validatedAt: new Date().toISOString(),
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/replay-validation.json",
  JSON.stringify(validation, null, 2),
);
console.log(JSON.stringify(validation, null, 2));
if (!validation.matchesOriginal) process.exitCode = 1;

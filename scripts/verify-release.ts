import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { enterProject } from "./runtime.mjs";
enterProject();
const checks = [
  ["doctor", ["scripts/launch.mjs", "doctor"]],
  ["types", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["lint", ["node_modules/eslint/bin/eslint.js", "."]],
  ["tests", ["node_modules/vitest/vitest.mjs", "run"]],
  [
    "build",
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "--config",
      "apps/web/vite.config.ts",
    ],
  ],
  ["mcp-build", ["scripts/build-mcp.mjs"]],
  ["browser", ["node_modules/@playwright/test/cli.js", "test"]],
  ["bundle", ["--import", "tsx", "scripts/build-release.ts"]],
  ["portable", ["scripts/launch.mjs", "verify-portable"]],
] as const;
const evidence: any[] = [];
for (const [name, args] of checks) {
  const startedAt = new Date().toISOString();
  const r = spawnSync(process.execPath, [...args], {
    stdio: "inherit",
    windowsHide: true,
  });
  evidence.push({
    name,
    startedAt,
    exitCode: r.status,
    error: r.error?.message,
  });
  if (r.status !== 0) {
    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/release-validation.json",
      JSON.stringify({ status: "failed", evidence }, null, 2),
    );
    process.exit(r.status ?? 1);
  }
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/release-validation.json",
  JSON.stringify(
    {
      status: "passed",
      scope:
        "prototype engineering and same-computer relocated bundle checks; real model, second physical computer and other Agent acceptance remain separate",
      node: process.version,
      evidence,
    },
    null,
    2,
  ),
);

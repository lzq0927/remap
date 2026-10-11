import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(
  new URL("../../scripts/check-publication.mjs", import.meta.url),
);
async function fixture(
  run: (
    root: string,
    git: (...args: string[]) => void,
    check: (...args: string[]) => ReturnType<typeof spawnSync>,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "remap-publication-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error("Synthetic Git setup failed");
  };
  const check = (...args: string[]) =>
    spawnSync(process.execPath, [checker, ...args], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    git("init", "-q");
    git("config", "user.name", "Synthetic Test");
    git("config", "user.email", "test@example.invalid");
    await run(root, git, check);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("publication allows generic sources and empty secret references", async () =>
  fixture(async (root, git, check) => {
    await writeFile(join(root, ".env.example"), "MODEL_API_KEY=\n");
    await mkdir(join(root, "templates"));
    await writeFile(
      join(root, "templates/input.json"),
      '{"evidenceStatus":"illustrative"}',
    );
    git("add", ".");
    const result = check();
    expect(result.status).toBe(0);
    expect(JSON.parse(String(result.stdout)).indexFiles).toBe(2);
  }));

test("publication blocks the original plan and credentials without printing values", async () =>
  fixture(async (root, git, check) => {
    const syntheticKey = "a".repeat(32) + "." + "b".repeat(20);
    await writeFile(join(root, "系统可靠性工作计划.md"), "synthetic document");
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({ apiKey: syntheticKey }),
    );
    git("add", ".");
    const result = check();
    expect(result.status).toBe(1);
    const output = String(result.stdout);
    expect(output).not.toContain(syntheticKey);
    expect(JSON.parse(output).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "系统可靠性工作计划.md",
          reason: "excluded path",
        }),
        expect.objectContaining({
          file: "config.json",
          reason: "credential pattern",
        }),
      ]),
    );
  }));

test("publication can detect credentials removed from the current tree but retained in history", async () =>
  fixture(async (root, git, check) => {
    const syntheticKey = "a".repeat(32) + "." + "b".repeat(20);
    await writeFile(join(root, "source.txt"), syntheticKey);
    git("add", ".");
    git("commit", "-qm", "Synthetic historical fixture");
    await writeFile(join(root, "source.txt"), "public source");
    git("add", ".");
    expect(check().status).toBe(0);
    const result = check("--history");
    expect(result.status).toBe(1);
    expect(String(result.stdout)).not.toContain(syntheticKey);
    expect(JSON.parse(String(result.stdout)).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "history", file: "source.txt" }),
      ]),
    );
  }));

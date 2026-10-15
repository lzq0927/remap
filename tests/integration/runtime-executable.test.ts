import { expect, test, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findOpenCode, projectRoot } from "../../scripts/runtime.mjs";

test("discovers the installed official Agent entry declared by its package", () => {
  vi.stubEnv("OPENCODE_BIN", undefined);
  try {
    const directory = join(projectRoot, "node_modules/opencode-ai"),
      manifest = JSON.parse(
        readFileSync(join(directory, "package.json"), "utf8"),
      ),
      entry =
        typeof manifest.bin === "string" ? manifest.bin : manifest.bin.opencode;
    const executable = findOpenCode();
    expect(executable).toBeTruthy();
    expect(existsSync(executable!)).toBe(true);
    if (existsSync(resolve(directory, entry)))
      expect([
        resolve(directory, entry),
        join(
          directory,
          "bin",
          process.platform === "win32" ? "opencode.exe" : "opencode",
        ),
      ]).toContain(executable);
  } finally {
    vi.unstubAllEnvs();
  }
});

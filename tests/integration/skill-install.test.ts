import { expect, test } from "vitest";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installProjectSkill } from "../../scripts/skill-install.mjs";
import { registry } from "../../packages/mcp-runtime/src/server";

test("upgrades an installed Skill with all references and exposes every declared tool", async () => {
  const target = await mkdtemp(join(tmpdir(), "remap-skill-"));
  try {
    await writeFile(join(target, "SKILL.md"), "stale guidance");
    expect((await installProjectSkill(target)).updated).toBeGreaterThan(0);
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe(
      await readFile("skills/sd-dfr-remap/SKILL.md", "utf8"),
    );
    const manifest = JSON.parse(
      await readFile(join(target, "manifest.json"), "utf8"),
    );
    for (const file of manifest.references)
      expect(await readFile(join(target, file), "utf8")).toBe(
        await readFile(join("skills/sd-dfr-remap", file), "utf8"),
      );
    for (const tool of manifest.tools)
      expect(
        registry.some(([name]) => name === tool),
        tool,
      ).toBe(true);
    const modified = (await stat(join(target, "SKILL.md"))).mtimeMs;
    expect((await installProjectSkill(target)).updated).toBe(0);
    expect((await stat(join(target, "SKILL.md"))).mtimeMs).toBe(modified);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

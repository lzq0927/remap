import { expect, test } from "vitest";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installProjectSkill } from "../../scripts/skill-install.mjs";
import { reliabilityStages } from "../../packages/contracts/src/reliability-workflow";
import { registry } from "../../packages/mcp-runtime/src/server";

test("upgrades an installed Skill with all references and exposes every declared tool", async () => {
  const target = await mkdtemp(join(tmpdir(), "remap-skill-"));
  try {
    expect((await installProjectSkill(target)).updated).toBeGreaterThan(0);
    expect(reliabilityStages).toHaveLength(4);
    for (const stage of reliabilityStages) {
      const dir = join(target, stage.skill);
      expect(await readFile(join(dir, "SKILL.md"), "utf8")).toBe(
        await readFile(join("skills", stage.skill, "SKILL.md"), "utf8"),
      );
      const manifest = JSON.parse(
        await readFile(join(dir, "manifest.json"), "utf8"),
      );
      for (const tool of manifest.tools)
        expect(
          registry.some(([name]) => name === tool),
          tool,
        ).toBe(true);
      expect(
        await readFile(join(dir, "references/workflow.md"), "utf8"),
      ).toContain("四部分工作流");
    }
    const file = join(target, reliabilityStages[0].skill, "SKILL.md");
    const modified = (await stat(file)).mtimeMs;
    expect((await installProjectSkill(target)).updated).toBe(0);
    expect((await stat(file)).mtimeMs).toBe(modified);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

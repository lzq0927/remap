import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { projectRoot } from "./runtime.mjs";

/** One maintained source; refresh owned files while preserving unchanged timestamps. */
export async function installProjectSkill(
  target = join(projectRoot, ".opencode/skills/sd-dfr-remap"),
) {
  const source = join(projectRoot, "skills/sd-dfr-remap");
  target = resolve(target);
  if (target === source) throw new Error("Skill 安装目录不能是源目录");
  let updated = 0;
  const copy = async (from, to) => {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const original = join(from, entry.name),
        installed = join(to, entry.name);
      if (entry.isDirectory()) await copy(original, installed);
      else if (entry.isFile()) {
        const content = await readFile(original);
        let previous;
        try {
          previous = await readFile(installed);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (!previous?.equals(content)) {
          await writeFile(installed, content);
          updated++;
        }
      }
    }
  };
  await copy(source, target);
  return { target, updated };
}

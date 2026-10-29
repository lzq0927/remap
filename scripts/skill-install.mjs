import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { projectRoot } from "./runtime.mjs";

/** One maintained source; refresh owned files while preserving unchanged timestamps. */
export async function installProjectSkill(
  target = join(projectRoot, ".opencode/skills"),
) {
  const source = join(projectRoot, "skills");
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
  const manifest = JSON.parse(
    await readFile(join(source, "workflow.json"), "utf8"),
  );
  for (const name of manifest.skills) {
    await copy(join(source, name), join(target, name));
    await copy(
      join(source, manifest.sharedReferences),
      join(target, name, "references"),
    );
  }
  // Keep all old content outside native Skill discovery; never discard user edits.
  try {
    await rename(
      join(target, "sd-dfr-remap"),
      join(target, "../remap-legacy-reference-" + Date.now()),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { target, updated };
}

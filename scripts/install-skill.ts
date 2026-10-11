import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { enterProject } from "./runtime.mjs";
enterProject();
const target = resolve(process.argv[2] ?? ".opencode/skills/sd-dfr-remap");
await mkdir(target, { recursive: true });
await cp(resolve("skills/sd-dfr-remap"), target, { recursive: true });
console.log("Skill installed: " + target);

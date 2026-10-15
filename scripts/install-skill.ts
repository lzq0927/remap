import { resolve } from "node:path";
import { enterProject } from "./runtime.mjs";
import { installProjectSkill } from "./skill-install.mjs";
enterProject();
const result = await installProjectSkill(
  process.argv[2] ? resolve(process.argv[2]) : undefined,
);
console.log(
  "Skill installed: " +
    result.target +
    " (updated " +
    result.updated +
    " files)",
);

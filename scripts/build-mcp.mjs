import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { projectRoot } from "./runtime.mjs";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vite/package.json"));
const { build } = await import(
  pathToFileURL(viteRequire.resolve("esbuild")).href
);
await build({
  entryPoints: ["stdio", "http", "launch"].map((name) =>
    join(projectRoot, "packages/mcp-runtime/src/" + name + ".ts"),
  ),
  outdir: join(projectRoot, "packages/mcp-runtime/dist"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
});
console.log("已构建独立 Reliability MCP 标准入口。");

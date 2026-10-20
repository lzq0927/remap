import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
  lstat,
  realpath,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative, isAbsolute, basename } from "node:path";
import { createHash } from "node:crypto";
import { enterProject, projectRoot } from "./runtime.mjs";
import { readRuntimePolicy } from "../packages/runtime-policy/src/index";
enterProject();
if (readRuntimePolicy().profile === "internal")
  throw new Error(
    "INTERNAL_RELEASE_FORBIDDEN: 内网代码和数据不得生成通用外网发布包",
  );
const target = join(projectRoot, "release", "rem-prototype-0.1");
const releaseRoot = resolve(projectRoot, "release");
const releaseTarget = resolve(target);
const targetRelative = relative(releaseRoot, releaseTarget);
if (
  !targetRelative ||
  targetRelative.startsWith("..") ||
  isAbsolute(targetRelative)
)
  throw new Error("发布目录必须位于当前项目 release 目录内");
if (existsSync(releaseRoot) && (await realpath(releaseRoot)) !== releaseRoot)
  throw new Error("发布根目录不能被符号链接重定向");
if (existsSync(releaseTarget) && (await lstat(releaseTarget)).isSymbolicLink())
  throw new Error("发布目标不能为符号链接");
if (
  ![
    "dist/web/index.html",
    ...["launch", "stdio", "http"].map(
      (name) => "packages/mcp-runtime/dist/" + name + ".mjs",
    ),
  ].every((path) => existsSync(join(projectRoot, path)))
)
  throw new Error("请先运行 pnpm build");
await rm(releaseTarget, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const include = [
  "apps",
  "packages",
  "skills",
  "templates",
  ".opencode/commands",
  "scripts",
  "solvers",
  "scenarios",
  "references/expert-v4",
  "references/expert-review-2026-10-09",
  "references/新可靠性机制库-单点量化交付包",
  "docs/分轮评估与Agent协作指南.md",
  "docs/2026-10-15-Skill与平台闭环复核.md",
  "docs/2026-10-15-通用参数试验与场景样例.md",
  "docs/2026-10-16-分层目标与现状诊断.md",
  "docs/2026-10-16-跨规模汇总与独立改进建议.md",
  "docs/superpowers/plans/2026-10-16-availability-decision-planning.md",
  "docs/2026-10-16-有边界分配与备选方案.md",
  "docs/2026-10-20-硬件分层与故障传播.md",
  "docs/superpowers/plans/2026-10-20-hardware-architecture.md",
  "docs/superpowers/plans/2026-10-20-architecture-atlas.md",
  "docs/numerical-methods.md",
  "docs/2026-10-12-专家原始配置复现验收.md",
  "docs/2026-10-12-专家方法与Agent流水线使用指南.md",
  "docs/2026-10-13-已解决条件与剩余机制排序.md",
  "docs/2026-10-13-方案收益与组合贡献展示指南.md",
  "docs/2026-10-13-报告摘要与离线技术附件.md",
  "docs/2026-10-13-前端现状分析与业界调研.md",
  "docs/2026-10-13-聚焦工作台使用指南.md",
  "docs/2026-10-13-Agent工程闭环使用与适配.md",
  "docs/superpowers/specs/2026-10-13-agent-assisted-engineering-design.md",
  "docs/superpowers/specs/2026-10-13-system-modeling-design.md",
  "docs/superpowers/plans/2026-10-13-agent-engineering-loop.md",
  "docs/superpowers/specs/2026-10-13-focused-workspace-design.md",
  "docs/superpowers/plans/2026-10-13-focused-workspace.md",
  "docs/部署与迁移.md",
  "docs/2026-10-11-评估系统使用指南.md",
  "docs/2026-10-11-任务系统实施与验收.md",
  "docs/mcp-contract.md",
  "docs/内网开发指南.md",
  "docs/Git拉取与内网部署.md",
  "docs/云端开发指南.md",
  "docs/事件机制审核与指标分配.md",
  "docs/2026-10-11-ReMAP优化与发布审查.md",
  "docs/内网开发实施与验收.md",
  "docs/superpowers/specs/2026-10-11-internal-development-design.md",
  "docs/superpowers/plans/2026-10-11-internal-development-plan.md",
  "config/internal.example.json",
  "config/internal.env.example",
  "examples/internal-adapter",
  "examples/engineering-loop",
  "dist/web",
  "tests",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vitest.config.ts",
  "playwright.config.ts",
  "eslint.config.js",
  ".env.example",
  ".gitignore",
  ".gitattributes",
  "README.md",
];
const excluded = new Set([
  "node_modules",
  ".python-deps",
  "__pycache__",
  ".pytest_cache",
  ".git",
  "data",
  "artifacts",
  "test-results",
  "playwright-report",
  "auth.json",
  "agent-credentials.json",
]);
for (const path of include) {
  const source = join(projectRoot, path);
  if (!existsSync(source)) throw new Error("发布文件缺失：" + path);
  await cp(source, join(target, path), {
    recursive: true,
    filter: async (sourcePath) => {
      const parts = relative(projectRoot, sourcePath).split(/[\\/]/);
      if (
        parts.some((part) => excluded.has(part)) ||
        (/^\.env(?:\.|$)/.test(basename(sourcePath)) &&
          basename(sourcePath) !== ".env.example") ||
        /\.(sqlite|db)(?:-|$)|\.log$/.test(sourcePath)
      )
        return false;
      if ((await lstat(sourcePath)).isSymbolicLink())
        throw new Error(
          "软件包不能包含符号链接：" + relative(projectRoot, sourcePath),
        );
      return true;
    },
  });
}
const entries: { path: string; sha256: string; bytes: number }[] = [];
async function walk(path: string) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const content = await readFile(file);
      entries.push({
        path: relative(target, file).replaceAll("\\", "/"),
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: content.length,
      });
    }
  }
}
await walk(target);
entries.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(
  join(target, "manifest.json"),
  JSON.stringify(
    {
      schemaVersion: "1.0.0",
      version: "0.1.0",
      kind: "source-and-built-web-and-mcp",
      createdAt: new Date().toISOString(),
      requirements: {
        node: ">=24",
        pnpm: "11",
        python: "optional CTMC: NumPy/SciPy",
        opencode: "optional Agent",
      },
      excluded: [
        "task data",
        "credentials",
        "local configuration",
        "node_modules",
        "Python target dependencies",
        "verification outputs",
      ],
      files: entries,
    },
    null,
    2,
  ),
);
console.log(
  "Release source bundle: release/rem-prototype-0.1 (" +
    entries.length +
    " files)",
);

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  lstat,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectRoot,
  enterProject,
  commandOnPath,
  runCommand,
} from "./runtime.mjs";

const sourceFiles = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function filesAt(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("离线依赖包不允许符号链接");
    if (entry.isDirectory()) files.push(...(await filesAt(root, path)));
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      files.push({
        path: relative(root, path).replaceAll("\\", "/"),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    } else throw new Error("离线依赖包含非普通文件");
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function freshDirectory(target) {
  if (existsSync(target))
    throw new Error("目标已存在，请使用新的空目录；不会覆盖已有文件");
  let parent = dirname(target);
  while (!existsSync(parent)) parent = dirname(parent);
  if (
    (await lstat(parent)).isSymbolicLink() ||
    (await realpath(parent)) !== parent
  )
    throw new Error("目标父目录不能被链接重定向");
  await mkdir(target, { recursive: true });
}

export async function verifyBundle(directory, sourceRoot = projectRoot) {
  const root = resolve(directory);
  if ((await realpath(root)) !== root)
    throw new Error("离线包路径不能被链接重定向");
  const manifestPath = join(root, "manifest.json");
  if ((await lstat(manifestPath)).isSymbolicLink())
    throw new Error("清单不能为符号链接");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.schemaVersion !== "1.0.0" ||
    manifest.kind !== "pnpm-offline-store" ||
    !Array.isArray(manifest.files)
  )
    throw new Error("离线依赖清单格式无效");
  if (manifest.platform !== process.platform || manifest.arch !== process.arch)
    throw new Error("离线依赖包的平台/架构与当前机器不匹配");
  const packageJson = JSON.parse(
    await readFile(join(sourceRoot, "package.json"), "utf8"),
  );
  if (manifest.packageManager !== packageJson.packageManager)
    throw new Error("pnpm 版本要求不匹配");
  for (const name of sourceFiles) {
    if (
      manifest.sourceHashes?.[name] !==
      sha256(await readFile(join(sourceRoot, name)))
    )
      throw new Error("离线依赖包与当前软件配置不匹配：" + name);
  }
  // Enumerate independently, so extra files, traversal and altered entries cannot be hidden by the manifest.
  const actual = (await filesAt(root)).filter(
    (file) => file.path !== "manifest.json",
  );
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files))
    throw new Error("离线依赖包文件摘要不一致");
  if (!existsSync(join(root, "store"))) throw new Error("离线依赖 store 缺失");
  return manifest;
}

export async function prepareBundle(
  directory,
  sourceRoot = projectRoot,
  seedStore,
) {
  if (process.env.RELIABILITY_ENV === "internal")
    throw new Error(
      "内网禁止生成向外交付的依赖包；请在外网通用核心环境准备后单向导入",
    );
  const root = resolve(directory);
  const source = resolve(sourceRoot);
  const location = relative(source, root);
  if (!location || (location.startsWith("..") && !isAbsolute(root)))
    throw new Error("离线包不能覆盖软件目录");
  // Prevent choosing a software ancestor as a target, regardless of CLI working directory.
  const ancestor = relative(root, source);
  if (!ancestor || (!ancestor.startsWith("..") && !isAbsolute(ancestor)))
    throw new Error("离线包目标不能为软件目录或其父目录");
  const pnpm = commandOnPath("pnpm");
  if (!pnpm) throw new Error("请先安装锁文件指定版本的 pnpm");
  const packageJson = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );
  const version = runCommand(pnpm, ["--version"], { encoding: "utf8" });
  if (
    version.status !== 0 ||
    "pnpm@" + version.stdout.trim() !== packageJson.packageManager
  )
    throw new Error("pnpm 版本必须与 packageManager 完全相同");
  await freshDirectory(root);
  const staging = root + ".fetch";
  await freshDirectory(staging);
  const stagingStore = join(staging, "store");
  const copyStore = async (from, to) =>
    cp(from, to, {
      recursive: true,
      filter: async (file) => {
        // pnpm's projects directory contains machine-specific virtual-store links, not package content.
        if (relative(from, file).split(/[\\/]/).includes("projects"))
          return false;
        if ((await lstat(file)).isSymbolicLink())
          throw new Error("依赖内容目录中存在非项目链接");
        return true;
      },
    });
  if (seedStore) await copyStore(resolve(seedStore), stagingStore);
  const request = join(root, "request");
  await mkdir(request);
  const sourceHashes = {};
  for (const name of sourceFiles) {
    sourceHashes[name] = sha256(await readFile(join(source, name)));
    await cp(join(source, name), join(request, name));
    await cp(join(source, name), join(staging, name));
  }
  const result = runCommand(
    pnpm,
    [
      "fetch",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--store-dir",
      stagingStore,
    ],
    { cwd: staging, stdio: "inherit" },
  );
  if (result.status !== 0)
    throw new Error("依赖预取失败，未生成成功清单；请使用新目录重试");
  await copyStore(stagingStore, join(root, "store"));
  // pnpm fetch creates a virtual store of links; only content-addressed store and source descriptors are delivered.
  const files = [
    ...(await filesAt(root, request)),
    ...(await filesAt(root, join(root, "store"))),
  ].sort((a, b) => a.path.localeCompare(b.path));
  // Virtual-store stays in the sibling .fetch preparation directory; deliver only root.
  const manifest = {
    schemaVersion: "1.0.0",
    kind: "pnpm-offline-store",
    createdAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    packageManager: packageJson.packageManager,
    node: ">=24",
    sourceHashes,
    files,
    runtimes: {
      node: "supply separately",
      pnpm: "supply separately",
      opencode:
        "supply native binary separately; installation scripts disabled",
      python: "supply separately with NumPy/SciPy for CTMC",
      browser: "supply separately for end-to-end tests",
    },
    installationScripts: "disabled",
    verification:
      "hashes only; run offline:verify --install for isolated install",
  };
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}

export async function verifyOfflineInstall(
  directory,
  destination,
  sourceRoot = projectRoot,
) {
  const manifest = await verifyBundle(directory, sourceRoot);
  const pnpm = commandOnPath("pnpm");
  if (!pnpm) throw new Error("请安装清单指定的 pnpm 版本");
  const version = runCommand(pnpm, ["--version"], { encoding: "utf8" });
  if (
    version.status !== 0 ||
    "pnpm@" + version.stdout.trim() !== manifest.packageManager
  )
    throw new Error("pnpm 版本必须与清单完全相同");
  const target = resolve(destination);
  await freshDirectory(target);
  for (const file of sourceFiles)
    await cp(join(sourceRoot, file), join(target, file));
  const isolatedStore = join(target, ".pnpm-store");
  await cp(resolve(directory, "store"), isolatedStore, { recursive: true });
  const result = runCommand(
    pnpm,
    [
      "install",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--store-dir",
      isolatedStore,
      "--side-effects-cache=false",
    ],
    { cwd: target, stdio: "inherit" },
  );
  if (result.status !== 0)
    throw new Error("独立目录离线安装失败；未通过冷依赖验收");
  const probe = runCommand(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await import('tsx/esm/api'); await import('fastify'); await import('@modelcontextprotocol/sdk/client/index.js'); console.log('offline-dependencies-ok')",
    ],
    { cwd: target, encoding: "utf8" },
  );
  if (probe.status !== 0) throw new Error("离线安装后核心依赖加载失败");
  const evidence = {
    status: "passed",
    kind: "isolated-offline-npm-install",
    verifiedAt: new Date().toISOString(),
    platform: manifest.platform,
    arch: manifest.arch,
    packageManager: manifest.packageManager,
    sourceHashes: manifest.sourceHashes,
    dependencies: "loaded",
    runtimesIncluded: false,
  };
  await writeFile(
    join(target, "offline-verification.json"),
    JSON.stringify(evidence, null, 2),
  );
  return evidence;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  enterProject();
  const option = (name) => {
    const index = process.argv.indexOf(name);
    if (
      index < 0 ||
      !process.argv[index + 1] ||
      process.argv[index + 1].startsWith("--")
    )
      throw new Error("缺少参数 " + name);
    return process.argv[index + 1];
  };
  const action = process.argv[2];
  if (action === "prepare") {
    const manifest = await prepareBundle(
      option("--output"),
      projectRoot,
      process.argv.includes("--store-source")
        ? option("--store-source")
        : undefined,
    );
    console.log(
      JSON.stringify({
        status: "prepared",
        platform: manifest.platform,
        arch: manifest.arch,
        files: manifest.files.length,
        runtimesIncluded: false,
      }),
    );
  } else if (action === "verify") {
    const bundle = option("--bundle");
    if (process.argv.includes("--install"))
      console.log(
        JSON.stringify(
          await verifyOfflineInstall(bundle, option("--destination")),
        ),
      );
    else {
      const manifest = await verifyBundle(bundle);
      console.log(
        JSON.stringify({
          status: "verified",
          kind: "hashes-only",
          files: manifest.files.length,
        }),
      );
    }
  } else
    throw new Error(
      "用法：offline-bundle.mjs prepare --output <新目录> | verify --bundle <目录> [--install --destination <新目录>]",
    );
}

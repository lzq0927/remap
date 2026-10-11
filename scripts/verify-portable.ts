import {
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  lstat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import {
  enterProject,
  projectRoot,
  commandOnPath,
  runCommand,
} from "./runtime.mjs";
enterProject();
const evidence: any[] = [];
const bundle = join(projectRoot, "release/rem-prototype-0.1");
const destination = join(
  projectRoot,
  "artifacts",
  "portable",
  "中文 迁移 " + randomUUID(),
);
const validationFile = join(
  projectRoot,
  "artifacts",
  "portability-validation.json",
);
let child: ReturnType<typeof spawn> | undefined;
const mark = (name: string, details: unknown) =>
  evidence.push({ name, status: "passed", details });
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
try {
  const manifest = JSON.parse(
    await readFile(join(bundle, "manifest.json"), "utf8"),
  );
  const declared = new Set<string>();
  for (const file of manifest.files) {
    assert(
      typeof file.path === "string" &&
        !isAbsolute(file.path) &&
        !file.path.split(/[\\/]/).includes(".."),
      "清单路径越界",
    );
    assert(!declared.has(file.path), "重复清单路径");
    declared.add(file.path);
    assert(
      !/(?:^|\/)(?:node_modules|data|artifacts|\.python-deps|\.git|auth\.json|agent-credentials\.json)(?:\/|$)|\.(?:sqlite|db)(?:-|$)|(?:^|\/)\.env$/.test(
        file.path,
      ),
      "软件包包含本机数据或凭据路径",
    );
    const content = await readFile(join(bundle, file.path));
    assert(
      content.length === file.bytes &&
        createHash("sha256").update(content).digest("hex") === file.sha256,
      "软件清单摘要不匹配：" + file.path,
    );
    assert(
      !content.toString("utf8").includes(projectRoot.replaceAll("\\", "/")) &&
        !content.toString("utf8").includes(projectRoot.replaceAll("/", "\\")),
      "软件包包含开发机目录：" + file.path,
    );
  }
  async function inspect(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name,
        file = join(directory, entry.name);
      assert(!(await lstat(file)).isSymbolicLink(), "软件包包含符号链接");
      if (entry.isDirectory()) await inspect(file, name + "/");
      else
        assert(
          name === "manifest.json" || declared.has(name),
          "软件包有未登记文件：" + name,
        );
    }
  }
  await inspect(bundle);
  mark("software-manifest", { files: declared.size, excludesUserData: true });
  await mkdir(destination, { recursive: true });
  await cp(bundle, destination, { recursive: true });
  assert(
    !existsSync(join(destination, "node_modules")),
    "目标目录不是干净依赖目录",
  );
  const pnpm = commandOnPath("pnpm");
  assert(pnpm, "需要 pnpm 才能在新目录安装锁定依赖");
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^(MODEL_|OPENCODE_SERVER_|RELIABILITY_TASK|RELIABILITY_AGENT|PYTHON_EXECUTABLE$|RELIABILITY_PYTHON$|PYTHONPATH$|NODE_PATH$)/.test(
          name,
        ),
    ),
  );
  Object.assign(env, {
    DATA_DIR: "./task 数据",
    START_AGENT: "0",
    OPENCODE_URL: "http://127.0.0.1:1",
  });
  const missingDependencies = runCommand(
    process.execPath,
    [join(destination, "scripts/launch.mjs"), "doctor"],
    { cwd: projectRoot, env, encoding: "utf8", timeout: 30000 },
  );
  assert(
    missingDependencies.status === 1 &&
      JSON.parse(missingDependencies.stdout.toString()).checks.some(
        (check: any) => check.name === "dependencies" && !check.ok,
      ),
    "无依赖时 doctor 未给出明确失败状态",
  );
  mark("first-install-diagnostics", {
    pureNodeEntry: true,
    missingDependenciesDiagnosed: true,
  });
  const installed = runCommand(
    process.execPath,
    [
      join(destination, "scripts/launch.mjs"),
      "bootstrap",
      "--install",
      "--offline",
    ],
    { cwd: projectRoot, env, stdio: "inherit", timeout: 180000 },
  );
  assert(
    installed.status === 0,
    "新目录离线依赖安装失败；缓存不齐时请在目标机器 pnpm install --frozen-lockfile 后重试",
  );
  mark("clean-dependency-install", {
    mode: "offline package-manager cache",
    reusedSourceNodeModules: false,
  });
  const invocation = (action: string, args: string[] = []) => [
    join(destination, "scripts/launch.mjs"),
    action,
    ...args,
  ];
  const bootstrap = runCommand(process.execPath, invocation("bootstrap"), {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    timeout: 30000,
  });
  assert(bootstrap.status === 0, "迁移目录 bootstrap 失败");
  const before = await readFile(join(destination, ".env"));
  const again = runCommand(process.execPath, invocation("bootstrap"), {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    timeout: 30000,
  });
  assert(
    again.status === 0 &&
      before.equals(await readFile(join(destination, ".env"))),
    "bootstrap 覆盖了已有配置",
  );
  mark("bootstrap-no-overwrite", {
    pathContainsSpacesAndUnicode: true,
    cwdOutsideBundle: true,
  });
  const { Store } = await import(
    pathToFileURL(join(destination, "packages/assets/src/store.ts")).href
  );
  const { hash } = await import(
    pathToFileURL(join(destination, "packages/assets/src/hash.ts")).href
  );
  const legacyRoot = join(destination, "task 数据");
  const legacy = new Store(legacyRoot);
  const legacyInput = {
    tree: { type: "event", id: "legacy", probability: 0.98 },
  };
  legacy.saveRun({
    id: "portable-history",
    operation: "rbd",
    input: legacyInput,
    inputHash: hash({ operation: "rbd", input: legacyInput }),
    status: "succeeded",
    createdAt: "2026-10-11",
    progress: 1,
    result: { probability: 0.98 },
    events: [],
  });
  legacy.close();
  const legacyHash = createHash("sha256")
    .update(await readFile(join(legacyRoot, "reliability.sqlite")))
    .digest("hex");
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const address = probe.address();
  assert(address && typeof address !== "string", "不能分配测试端口");
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((r) => probe.close(() => r()));
  const apiUrl = "http://127.0.0.1:" + port;
  Object.assign(env, { PORT: String(port), RELIABILITY_API_URL: apiUrl });
  child = spawn(process.execPath, invocation("start"), {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  child.on("error", () => {
    exited = true;
  });
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  let ready = false;
  for (let i = 0; i < 80 && !exited; i++) {
    try {
      ready = (
        await fetch(apiUrl + "/api/defaults", {
          signal: AbortSignal.timeout(1000),
        })
      ).ok;
      if (ready) break;
    } catch {
      /* wait for start */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, "迁移目录 API 启动失败");
  const request = async (route: string, data?: unknown) => {
    const response = await fetch(apiUrl + "/api" + route, {
      method: data === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    assert(response.ok, value.error?.code + ": " + value.error?.message);
    return value;
  };
  const homepage = await fetch(apiUrl);
  assert(
    homepage.ok && (await homepage.text()).includes("root"),
    "迁移界面静态资源不可用",
  );
  const template = await fetch(apiUrl + "/api/templates/training-input.json");
  assert(template.ok, "迁移模板不可用");
  const task = await request("/tasks", { name: "迁移最小求解" });
  const input = { tree: { type: "event", id: "portable", probability: 0.99 } };
  let run = await request("/tasks/" + task.id + "/runs", {
    operation: "rbd",
    input,
  });
  for (let i = 0; i < 80 && ["queued", "running"].includes(run.status); i++) {
    await new Promise((r) => setTimeout(r, 100));
    run = await request("/tasks/" + task.id + "/runs/" + run.id);
  }
  assert(
    run.status === "succeeded" &&
      Math.abs(run.result.probability - 0.99) < 1e-12,
    "迁移目录最小求解失败",
  );
  mark("relocated-api-solver", {
    changedPort: true,
    changedDataRoot: true,
    operation: "rbd",
    probability: run.result.probability,
  });
  const caller = join(destination, "外部调用目录");
  await mkdir(caller);
  const output = "任务包.json";
  const exported = runCommand(
    process.execPath,
    invocation("task-export", [task.id, output]),
    { cwd: caller, env, encoding: "utf8", timeout: 30000 },
  );
  assert(exported.status === 0, "任务导出 CLI 失败");
  assert(existsSync(join(caller, output)), "相对导出路径没有解析到调用者目录");
  const imported = runCommand(
    process.execPath,
    invocation("task-import", [output, "迁移 CLI 导入"]),
    { cwd: caller, env, encoding: "utf8", timeout: 30000 },
  );
  assert(imported.status === 0, "任务导入 CLI 失败");
  const importedId = JSON.parse(imported.stdout.toString()).taskId;
  const restored = await request("/tasks/" + importedId + "/runs/" + run.id);
  assert(
    restored.inputHash === run.inputHash &&
      JSON.stringify(restored.result) === JSON.stringify(run.result),
    "迁移运行内容或摘要改变",
  );
  mark("task-cli-roundtrip", {
    sourceTaskPreserved: true,
    immutableRunPreserved: true,
  });
  const migrationPreflight = runCommand(
    process.execPath,
    invocation("task-migrate"),
    { cwd: projectRoot, env, encoding: "utf8", timeout: 30000 },
  );
  assert(
    migrationPreflight.status === 0 &&
      JSON.parse(migrationPreflight.stdout.toString()).dryRun === true,
    "旧迁移 CLI 默认不是预检",
  );
  const migration = runCommand(
    process.execPath,
    invocation("task-migrate", ["--apply"]),
    { cwd: projectRoot, env, encoding: "utf8", timeout: 30000 },
  );
  assert(migration.status === 0, "旧迁移 CLI apply 失败");
  const repeat = runCommand(
    process.execPath,
    invocation("task-migrate", ["--apply"]),
    { cwd: projectRoot, env, encoding: "utf8", timeout: 30000 },
  );
  assert(
    repeat.status === 0 &&
      JSON.parse(repeat.stdout.toString()).sourceHash === legacyHash,
    "旧迁移 CLI 重试没有保持来源摘要",
  );
  const preserved = await request("/tasks/legacy/runs/portable-history");
  assert(
    preserved.inputHash === hash({ operation: "rbd", input: legacyInput }) &&
      createHash("sha256")
        .update(await readFile(join(legacyRoot, "reliability.sqlite")))
        .digest("hex") === legacyHash,
    "旧迁移改变了历史摘要或源数据库",
  );
  mark("legacy-cli-migration", {
    defaultDryRun: true,
    applyIdempotent: true,
    sourceAndRunHashPreserved: true,
  });
  const prepared = runCommand(
    process.execPath,
    invocation("bootstrap", ["--task", task.id]),
    { cwd: projectRoot, env, encoding: "utf8", timeout: 30000 },
  );
  assert(prepared.status === 0, "离线任务 MCP 配置生成失败");
  const diagnostics = runCommand(
    process.execPath,
    invocation("doctor", ["--task", task.id]),
    { cwd: projectRoot, env, encoding: "utf8", timeout: 60000 },
  );
  assert(diagnostics.status === 0, "迁移 doctor/MCP 检查失败");
  const report = JSON.parse(diagnostics.stdout.toString());
  assert(
    report.checks.some(
      (c: any) =>
        c.name === "task-mcp-handshake" &&
        c.ok &&
        c.details.entry === "compiled",
    ),
    "没有构建后独立 MCP 入口的实际握手证据",
  );
  mark(
    "relocated-doctor-mcp",
    report.checks.map((c: any) => ({
      name: c.name,
      required: c.required,
      ok: c.ok,
      entry: c.details?.entry,
    })),
  );
  await mkdir(join(projectRoot, "artifacts"), { recursive: true });
  await writeFile(
    validationFile,
    JSON.stringify(
      {
        status: "passed",
        scope:
          "same physical computer, relocated clean dependency directory, offline cache install; no second-computer/other-Agent/GLM acceptance",
        createdAt: new Date().toISOString(),
        evidence,
      },
      null,
      2,
    ),
  );
  console.log(
    "可迁移检查通过；证据：artifacts/portability-validation.json（本机目录迁移）",
  );
} catch (error) {
  await mkdir(join(projectRoot, "artifacts"), { recursive: true });
  await writeFile(
    validationFile,
    JSON.stringify(
      {
        status: "failed",
        createdAt: new Date().toISOString(),
        evidence,
        error: (error as Error).message,
      },
      null,
      2,
    ),
  );
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  if (child) {
    child.kill();
    await new Promise<void>((r) => {
      if (child!.exitCode !== null) r();
      else {
        child!.once("exit", () => r());
        setTimeout(r, 5000);
      }
    });
  }
}

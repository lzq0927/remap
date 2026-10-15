import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
} from "../packages/runtime-policy/src/index.mjs";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
// Preserve the caller's directory before launch.mjs switches to the software root.
export const invocationDirectory = process.cwd();
export function loadEnvironment() {
  const selected = process.env.RELIABILITY_ENV_FILE;
  const envFile = selected
    ? resolve(invocationDirectory, selected)
    : join(projectRoot, ".env");
  if (selected && !existsSync(envFile))
    throw new Error("RELIABILITY_ENV_FILE does not exist");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
export function enterProject() {
  process.chdir(projectRoot);
  loadEnvironment();
  readRuntimePolicy();
}
export function commandOnPath(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const suffix of process.platform === "win32"
      ? [".exe", ".cmd", ".bat", ""]
      : [""]) {
      const candidate = join(directory, name + suffix);
      if (existsSync(candidate)) return candidate;
    }
  }
}
export function findOpenCode() {
  if (process.env.OPENCODE_BIN) {
    const candidate = isAbsolute(process.env.OPENCODE_BIN)
      ? process.env.OPENCODE_BIN
      : resolve(projectRoot, process.env.OPENCODE_BIN);
    return existsSync(candidate) ? candidate : undefined;
  }
  const bundled = join(
    projectRoot,
    "node_modules",
    "opencode-ai",
    "bin",
    process.platform === "win32" ? "opencode.exe" : "opencode",
  );
  if (existsSync(bundled)) return bundled;
  // Recent official packages declare bin/opencode.exe on Linux as well.
  // Read the installed package entry instead of assuming its filename.
  try {
    const packageDirectory = join(projectRoot, "node_modules", "opencode-ai");
    const manifest = JSON.parse(
      readFileSync(join(packageDirectory, "package.json"), "utf8"),
    );
    const entry =
      typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.opencode;
    if (entry) {
      const executable = resolve(packageDirectory, entry);
      if (existsSync(executable)) return executable;
    }
  } catch {
    /* absent optional Agent; preserve PATH discovery */
  }
  return commandOnPath("opencode");
}
export function runCommand(command, args, options = {}) {
  // Windows .cmd entry points need cmd.exe; restrict arguments to non-shell text.
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    if ([command, ...args].some((value) => /[&|<>^%\r\n"]/u.test(value)))
      throw new Error("命令路径或参数包含不支持的 shell 字符");
    return spawnSync(
      process.env.ComSpec ?? "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        `""${command}" ${args.map((value) => `"${value}"`).join(" ")}"`,
      ],
      { windowsHide: true, windowsVerbatimArguments: true, ...options },
    );
  }
  return spawnSync(command, args, { windowsHide: true, ...options });
}
export function probePython() {
  const configured =
    process.env.RELIABILITY_PYTHON ?? process.env.PYTHON_EXECUTABLE;
  const candidates = configured
    ? [[configured]]
    : process.platform === "win32"
      ? [["python"], ["py", "-3"], ["python3"]]
      : [["python3"], ["python"]];
  for (const [command, ...prefix] of candidates) {
    const result = runCommand(
      command,
      [
        ...prefix,
        "-c",
        "import json,sys; import scipy,numpy; print(json.dumps({'python':sys.version.split()[0],'scipy':scipy.__version__,'numpy':numpy.__version__}))",
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PYTHONPATH: [
            join(projectRoot, "solvers/ctmc/.python-deps"),
            process.env.PYTHONPATH,
          ]
            .filter(Boolean)
            .join(delimiter),
        },
      },
    );
    if (result.status === 0) {
      try {
        return {
          available: true,
          ...JSON.parse(result.stdout),
          command,
          prefix,
        };
      } catch {
        /* try next interpreter */
      }
    }
  }
  return {
    available: false,
    message:
      "CTMC 可选依赖不可用：安装 Python、NumPy、SciPy 后配置 PYTHON_EXECUTABLE；其他本地求解器仍可使用。",
  };
}
export async function writableDirectory(directory) {
  await mkdir(directory, { recursive: true });
  const probe = join(
    directory,
    ".write-probe-" + process.pid + "-" + Date.now(),
  );
  const handle = await open(probe, "wx");
  await handle.close();
  await unlink(probe);
}
export async function apiRequest(route, body, method) {
  const policy = readRuntimePolicy();
  const base = new URL(
    process.env.RELIABILITY_API_URL ??
      `http://127.0.0.1:${process.env.PORT ?? 4178}`,
  );
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
    throw new Error("本地任务 CLI 只连接回环地址");
  const requestUrl = assertEndpointAllowed(new URL(route, base), "api", policy);
  const response = await fetch(requestUrl, {
    ...(policy.profile === "internal" ? { redirect: "error" } : {}),
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.code + ": " + (data.error?.message ?? "请求失败"),
    );
  return data;
}

import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ToolInput, ToolResult } from "./tool-contract";

export function tlcRuntime() {
  const root = fileURLToPath(
    new URL("../../../.local-runtime/tlc/", import.meta.url),
  );
  let manifest: { java?: string; jar?: string } = {};
  const file = join(root, "runtime.json");
  if (existsSync(file))
    manifest = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const java = process.env.REMAP_JAVA_BIN ?? manifest.java ?? "java";
  const jar =
    process.env.REMAP_TLC_JAR ?? manifest.jar ?? join(root, "tla2tools.jar");
  return {
    java,
    jar,
    available: existsSync(jar) && (java === "java" || existsSync(java)),
  };
}
export function validateTlc(input: ToolInput) {
  const tla = input.files.filter((f) => f.name.endsWith(".tla")),
    cfg = input.files.filter((f) => f.name.endsWith(".cfg"));
  if (tla.length !== 1 || cfg.length !== 1)
    throw new Error("TLC 首轮需要一个 .tla 和一个 .cfg 文件");
  if (
    !/^[A-Za-z][A-Za-z0-9_]*\.tla$/.test(tla[0].name) ||
    !/^[A-Za-z][A-Za-z0-9_]*\.cfg$/.test(cfg[0].name)
  )
    throw new Error("非法原生文件名");
  if (!tla[0].content.includes("MODULE " + tla[0].name.slice(0, -4)))
    throw new Error("模块名称必须与文件名相同");
  if (!/\bINVARIANTS?\s+\w+|\bPROPERT(?:Y|IES)\s+\w+/.test(cfg[0].content))
    throw new Error("检查配置必须显式声明不变量或性质");
  // Restrict this local entry point to pure standard modules. Custom modules use administrator adapters.
  if (/\bINSTANCE\b/.test(tla[0].content))
    throw new Error("自定义模块实例请通过管理员工具适配器运行");
  const extendsLines = [...tla[0].content.matchAll(/\bEXTENDS\s+([^\r\n]+)/g)];
  const allowed = new Set([
    "Naturals",
    "Integers",
    "Reals",
    "Sequences",
    "FiniteSets",
    "TLC",
    "Bags",
  ]);
  for (const match of extendsLines)
    if (match[1].split(",").some((s) => !allowed.has(s.trim())))
      throw new Error("仅支持纯标准 TLA 模块；自定义工具需管理员适配");
}
export async function runTlc(input: ToolInput): Promise<ToolResult> {
  validateTlc(input);
  const runtime = tlcRuntime();
  if (!runtime.available)
    throw Object.assign(
      new Error(
        "TLC 未安装。执行 scripts/setup-tlc.ps1 或配置 REMAP_JAVA_BIN / REMAP_TLC_JAR",
      ),
      { code: "TOOL_UNAVAILABLE" },
    );
  const directory = await mkdtemp(join(tmpdir(), "remap-tlc-"));
  try {
    for (const f of input.files.filter((f) => /\.(tla|cfg)$/.test(f.name)))
      await writeFile(join(directory, f.name), f.content, "utf8");
    const tla = input.files.find((f) => f.name.endsWith(".tla"))!,
      cfg = input.files.find((f) => f.name.endsWith(".cfg"))!;
    const result = await new Promise<{
      output: string;
      code: number | null;
      limited: boolean;
    }>((done, reject) => {
      const child = spawn(
        runtime.java,
        [
          "-Xmx512m",
          "-XX:+UseParallelGC",
          "-cp",
          runtime.jar,
          "tlc2.TLC",
          "-workers",
          "1",
          "-seed",
          "1",
          "-fp",
          "0",
          "-config",
          cfg.name,
          tla.name,
        ],
        {
          cwd: directory,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "",
        limited = false;
      const stop = () => {
        limited = true;
        child.kill();
      };
      const timer = setTimeout(stop, Math.min(60000, input.timeoutMs));
      const append = (b: Buffer) => {
        output += b.toString();
        if (Buffer.byteLength(output) > 2_000_000) stop();
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ output: output.slice(0, 2_000_000), code, limited });
      });
    });
    const violated =
      /Invariant .* is violated|Temporal properties were violated|Deadlock reached/.test(
        result.output,
      );
    const success =
      result.code === 0 &&
      /Model checking completed\. No error has been found/.test(
        result.output,
      ) &&
      !result.limited;
    const trace = [
      ...result.output.matchAll(
        /State (\d+):\s*([^\r\n]*)\r?\n([\s\S]*?)(?=\r?\nState \d+:|\r?\n\d+ states generated|\r?\nFinished in|$)/g,
      ),
    ].map((m) => ({ step: Number(m[1]), label: m[2], state: m[3].trim() }));
    const counts = /(\d+) states generated, (\d+) distinct states found/.exec(
      result.output,
    );
    const version =
      /TLC2 Version[^\r\n]+/.exec(result.output)?.[0] ??
      "TLC (version unavailable)";
    const diagnostics = [
      ...(result.limited ? ["达到时间或输出预算；未完成验证"] : []),
      ...(!success && !violated
        ? ["检查未完成或模型错误，不能解释为性质成立"]
        : []),
    ];
    const artifacts = input.files.map((f) => ({ ...f }));
    for (const name of readdirSync(directory).filter((n) => /\.out$/.test(n)))
      if (readFileSync(join(directory, name)).length < 2_000_000)
        artifacts.push({
          name,
          content: readFileSync(join(directory, name), "utf8"),
        });
    return {
      engine: "TLC",
      version,
      verdict: violated ? "violated" : success ? "satisfied" : "inconclusive",
      completed: success || violated,
      scope: input.scope + "；单工作线程、固定种子1；结论仅覆盖本次有限配置",
      metrics: counts
        ? {
            generatedStates: Number(counts[1]),
            distinctStates: Number(counts[2]),
          }
        : {},
      trace,
      diagnostics,
      rawOutput: result.output,
      artifacts,
    };
  } finally {
    const rel = relative(resolve(tmpdir()), resolve(directory));
    if (rel && !rel.startsWith("..") && !isAbsolute(rel))
      await rm(directory, { recursive: true, force: true });
  }
}

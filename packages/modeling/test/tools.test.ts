import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createServer } from "node:http";
import { runExternal } from "../src/tools";
import { toolResultSchema } from "../src/tool-contract";

const original = process.env.REMAP_ENGINEERING_TOOLS;
let directory = "";
afterEach(async () => {
  if (original === undefined) delete process.env.REMAP_ENGINEERING_TOOLS;
  else process.env.REMAP_ENGINEERING_TOOLS = original;
  if (directory) {
    const rel = relative(resolve(tmpdir()), resolve(directory));
    if (rel && !rel.startsWith("..") && !isAbsolute(rel))
      await rm(directory, { recursive: true, force: true });
    directory = "";
  }
});
const configure = async (tools: any[]) => {
  directory = await mkdtemp(join(tmpdir(), "remap-tools-test-"));
  const config = join(directory, "tools.json");
  await writeFile(config, JSON.stringify(tools));
  process.env.REMAP_ENGINEERING_TOOLS = config;
};
const input = {
  files: [
    {
      name: "Static.json",
      content: JSON.stringify({
        method: "rbd",
        tree: {
          type: "series",
          children: [
            { type: "event", id: "shared", probability: 0.9 },
            { type: "event", id: "shared", probability: 0.9 },
          ],
        },
      }),
    },
  ],
  scope: "synthetic adapter conformance",
  timeoutMs: 5000,
  metadata: {},
};
describe("real tool boundaries", () => {
  it("executes a registered CLI against the real BDD with shared-event semantics", async () => {
    await configure([
      {
        id: "cli",
        name: "BDD",
        version: "1",
        methods: ["external"],
        mode: "cli",
        command: process.execPath,
        args: [resolve("examples/engineering-loop/bdd-cli-adapter.mjs")],
      },
    ]);
    const r = await runExternal("cli", "external", input);
    expect(r.metrics.probability).toBe(0.9);
    expect(r.engine).toBe("ReMAP BDD CLI example");
    expect(r.artifacts).toEqual(input.files);
    await expect(runExternal("cli", "p", input)).rejects.toThrow(/未配置/);
  });
  it("bounds CLI timeout and malformed results", async () => {
    await configure([
      {
        id: "sleep",
        name: "sleep",
        version: "1",
        methods: ["external"],
        mode: "cli",
        command: process.execPath,
        args: ["-e", "setTimeout(()=>{},20000)"],
      },
      {
        id: "bad",
        name: "bad",
        version: "1",
        methods: ["external"],
        mode: "cli",
        command: process.execPath,
        args: ["-e", 'process.stdout.write("{}")'],
      },
    ]);
    await expect(
      runExternal("sleep", "external", { ...input, timeoutMs: 100 }),
    ).rejects.toThrow(/超时/);
    await expect(runExternal("bad", "external", input)).rejects.toThrow();
  });
  it("supports an HTTP adapter and rejects oversized output", async () => {
    const result = {
      engine: "contract-test",
      version: "1",
      verdict: "inconclusive",
      completed: false,
      scope: "transport test only",
      metrics: {},
      trace: [],
      diagnostics: [],
      rawOutput: "No verification performed",
      artifacts: [],
    };
    const server = createServer((req, res) => {
      req.resume();
      res.setHeader("Content-Type", "application/json");
      res.end(
        req.url === "/large" ? "x".repeat(2_000_001) : JSON.stringify(result),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const port = (server.address() as any).port;
      await configure([
        {
          id: "http",
          name: "HTTP",
          version: "1",
          methods: ["external"],
          mode: "http",
          url: `http://127.0.0.1:${port}/`,
        },
        {
          id: "large",
          name: "large",
          version: "1",
          methods: ["external"],
          mode: "http",
          url: `http://127.0.0.1:${port}/large`,
        },
      ]);
      expect(await runExternal("http", "external", input)).toEqual(result);
      await expect(runExternal("large", "external", input)).rejects.toThrow(
        /超限/,
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
  it("does not accept a successful verdict with incomplete verification", () => {
    expect(() =>
      toolResultSchema.parse({
        engine: "x",
        version: "1",
        verdict: "satisfied",
        completed: false,
        scope: "test",
        rawOutput: "",
      }),
    ).toThrow();
  });
});

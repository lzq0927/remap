import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { assertEndpointAllowed } from "../../packages/runtime-policy/src/index";
import { buildApp } from "../../apps/api/src/server";
import { OpenCodeAdapter } from "../../packages/agents/src/opencode-adapter";
import { parseInput } from "../../packages/ingestion/src/parser";
import { prepareTaskAgent } from "../../packages/agents/src/task-binding";
import { TaskServices } from "../../packages/tasks/src/service";

let directory: string;
let configPath: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "internal-mode-"));
  configPath = join(directory, "internal.json");
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: "1.0.0",
      allowedOrigins: ["https://model.synthetic.invalid"],
      provider: {
        id: "enterprise",
        name: "Synthetic enterprise",
        baseURL: "https://model.synthetic.invalid/v1",
        models: { "fixture-model": { name: "Synthetic model" } },
        defaultModel: "fixture-model",
        apiKeyEnv: "SYNTHETIC_MODEL_KEY",
      },
    }),
  );
  for (const name of [
    "MODEL_API_KEY",
    "MODEL_ID",
    "MODEL_BASE_URL",
    "OPENCODE_MODEL",
    "OPENCODE_URL",
    "RELIABILITY_API_URL",
    "RELIABILITY_ENV_FILE",
  ])
    vi.stubEnv(name, undefined);
  vi.stubEnv("RELIABILITY_ENV", "internal");
  vi.stubEnv("RELIABILITY_INTERNAL_CONFIG", configPath);
  vi.stubEnv("DATA_DIR", join(directory, "data"));
  vi.stubEnv("SYNTHETIC_MODEL_KEY", "synthetic-secret-do-not-write");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("../../scripts/skill-install.mjs");
  await rm(directory, { recursive: true, force: true });
});

test("internal bootstrap forwards the offline store, suppresses lifecycle scripts and preserves the selected environment file", async () => {
  const store = join(directory, "store");
  await mkdir(store);
  vi.stubEnv("RELIABILITY_ENV_FILE", configPath);
  const runCommand = vi.fn(
    (_command: string, _args: string[], _options: unknown) => ({ status: 0 }),
  );
  const write = vi.fn();
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const originalArgv = process.argv;
  process.argv = [
    process.execPath,
    "bootstrap.mjs",
    "--install",
    "--store-dir",
    store,
  ];
  vi.doMock("../../scripts/skill-install.mjs", () => ({
    installProjectSkill: vi.fn(async () => ({ updated: 0 })),
  }));
  vi.doMock("../../scripts/runtime.mjs", () => ({
    enterProject: vi.fn(),
    projectRoot: directory,
    invocationDirectory: directory,
    commandOnPath: () => "synthetic-pnpm",
    runCommand,
    findOpenCode: () => "synthetic-opencode",
    apiRequest: vi.fn(),
  }));
  vi.doMock("node:fs", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs")>()),
    existsSync: () => true,
  }));
  vi.doMock("node:fs/promises", async (importOriginal) => ({
    ...(await importOriginal<typeof import("node:fs/promises")>()),
    writeFile: write,
  }));
  try {
    await import("../../scripts/bootstrap.mjs");
    expect(runCommand.mock.calls[0][1]).toEqual([
      "install",
      "--frozen-lockfile",
      "--offline",
      "--ignore-scripts",
      "--store-dir",
      store,
    ]);
    expect(write).not.toHaveBeenCalled();
  } finally {
    process.argv = originalArgv;
    log.mockRestore();
    vi.doUnmock("../../scripts/runtime.mjs");
    vi.doUnmock("../../scripts/skill-install.mjs");
    vi.doUnmock("node:fs");
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  }
});

test("runtime loads an explicitly selected environment file relative to the caller", async () => {
  await writeFile(
    join(directory, "selected.env"),
    "RELIABILITY_SYNTHETIC_MARKER=selected-fixture\n",
  );
  const runtime = pathToFileURL(
    join(process.cwd(), "scripts/runtime.mjs"),
  ).href;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    RELIABILITY_ENV_FILE: "selected.env",
  };
  delete childEnv.RELIABILITY_SYNTHETIC_MARKER;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { loadEnvironment } from ${JSON.stringify(runtime)}; loadEnvironment(); console.log(process.env.RELIABILITY_SYNTHETIC_MARKER);`,
    ],
    { cwd: directory, encoding: "utf8", env: childEnv, timeout: 5000 },
  );
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("selected-fixture");
});

test.each([false, true])(
  "internal Agent launch applies pinned restrictions and rejects unapproved reuse (running=%s)",
  async (running) => {
    vi.stubEnv("RELIABILITY_TRUST_RUNNING_OPENCODE", undefined);
    const spawn = vi.fn((_binary: string, _args: string[], _options: any) => ({
      on: vi.fn(),
      kill: vi.fn(),
    }));
    const previousListeners = new Map(
      (["SIGINT", "SIGTERM"] as const).map((signal) => [
        signal,
        process.listeners(signal),
      ]),
    );
    vi.doMock("../../scripts/skill-install.mjs", () => ({
      installProjectSkill: vi.fn(async () => ({ updated: 0 })),
    }));
    vi.doMock("../../scripts/runtime.mjs", () => ({
      enterProject: vi.fn(),
      findOpenCode: () => "synthetic-opencode",
    }));
    vi.doMock("node:child_process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:child_process")>()),
      spawn,
    }));
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      existsSync: () => true,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ healthy: running }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    try {
      if (running) {
        await expect(import("../../scripts/agent")).rejects.toThrow(
          "INTERNAL_OPENCODE_REUSE_FORBIDDEN",
        );
        expect(spawn).not.toHaveBeenCalled();
      } else {
        await import("../../scripts/agent");
        const environment = spawn.mock.calls[0][2].env;
        for (const flag of [
          "AUTOUPDATE",
          "SHARE",
          "MODELS_FETCH",
          "DEFAULT_PLUGINS",
          "EXTERNAL_SKILLS",
          "CLAUDE_CODE",
        ])
          expect(environment[`OPENCODE_DISABLE_${flag}`]).toBe("true");
        const config = JSON.parse(environment.OPENCODE_CONFIG_CONTENT);
        expect(Object.keys(config.provider)).toEqual(["enterprise"]);
        expect(config.model).toBe("enterprise/fixture-model");
        expect(config.enabled_providers).toEqual(["enterprise"]);
        expect(config.share).toBe("disabled");
        expect(environment.OPENCODE_CONFIG_CONTENT).not.toContain(
          "synthetic-secret",
        );
        expect(environment.OPENCODE_DISABLE_PROJECT_CONFIG).not.toBe("true");
      }
    } finally {
      for (const [signal, listeners] of previousListeners)
        for (const listener of process.listeners(signal))
          if (!listeners.includes(listener))
            process.removeListener(signal, listener);
      vi.doUnmock("../../scripts/runtime.mjs");
      vi.doUnmock("../../scripts/skill-install.mjs");
      vi.doUnmock("node:child_process");
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  },
);

test("API fails before creating a data directory on invalid internal configuration", async () => {
  vi.stubEnv("OPENCODE_URL", "https://external.synthetic.invalid");
  await expect(
    buildApp({ dataDir: join(directory, "unused"), seed: false }),
  ).rejects.toThrow("loopback");
  await expect(stat(join(directory, "unused"))).rejects.toThrow();
});

test("API checks its effective internal data-directory override and permits only explicit ephemeral memory", async () => {
  await expect(
    buildApp({ dataDir: process.cwd(), seed: false }),
  ).rejects.toThrow("outside the software tree");
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  await app.close();
  vi.stubEnv("DATA_DIR", undefined);
  await expect(buildApp({ dataDir: ":memory:", seed: false })).rejects.toThrow(
    "explicit absolute directory",
  );
});

test("internal Agent preparation replaces inherited providers, MCP and secrets", async () => {
  const tasks = new TaskServices(join(directory, "data"), { seed: false });
  try {
    const task = tasks.create("Synthetic internal task");
    const path = join(task.workspacePath, "opencode.json");
    await writeFile(
      path,
      JSON.stringify({
        provider: { external: {} },
        mcp: { outbound: {} },
        plugin: ["external-plugin"],
        command: { custom: {} },
        agent: { custom: {} },
        instructions: ["external"],
        secret: "synthetic-previous-secret",
      }),
    );
    const fetch = vi.fn(
      async (_url: string | URL, _options?: RequestInit) =>
        new Response(JSON.stringify({ healthy: false }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await prepareTaskAgent(tasks, task.id, "http://127.0.0.1:4178");
    const content = await readFile(path, "utf8"),
      config = JSON.parse(content);
    expect(Object.keys(config.provider)).toEqual(["enterprise"]);
    expect(Object.keys(config.mcp)).toEqual(["reliability"]);
    expect(config.enabled_providers).toEqual(["enterprise"]);
    expect(config.model).toBe("enterprise/fixture-model");
    expect(config.small_model).toBe("enterprise/fixture-model");
    expect(config.share).toBe("disabled");
    expect(config.autoupdate).toBe(false);
    expect(config.plugin).toEqual([]);
    expect(Object.keys(config.agent)).toEqual(["remap"]);
    expect(config.default_agent).toBe("remap");
    expect(config.agent.remap.tools.task).toBe(false);
    expect(config.command).toEqual({});
    expect(config.provider.enterprise.options.apiKey).toBe(
      "{env:SYNTHETIC_MODEL_KEY}",
    );
    expect(content).not.toMatch(
      /synthetic-secret|previous-secret|external-plugin|outbound|bigmodel|openai\.com/,
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    await mkdir(join(task.workspacePath, ".opencode/agents"));
    await expect(
      prepareTaskAgent(tasks, task.id, "http://127.0.0.1:4178"),
    ).rejects.toThrow("CONFIG_CONFLICT");
  } finally {
    await tasks.close();
  }
});

test("Agent HTTP and SSE reject external endpoints before invoking fetch", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const agent = new OpenCodeAdapter("https://external.synthetic.invalid");
  await expect(agent.createSession()).rejects.toThrow("loopback");
  await expect(
    agent
      .events("fixture", new AbortController().signal)
      [Symbol.asyncIterator]()
      .next(),
  ).rejects.toThrow("loopback");
  expect(fetch).not.toHaveBeenCalled();
});

test("internal preparation rejects native singular custom command discovery and preserves its files", async () => {
  const tasks = new TaskServices(join(directory, "data"), { seed: false });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  try {
    const task = tasks.create("Synthetic custom command conflict");
    const commands = join(task.workspacePath, ".opencode/command");
    await mkdir(commands, { recursive: true });
    const custom = join(commands, "custom.md");
    await writeFile(custom, "Synthetic custom command fixture");
    await expect(
      prepareTaskAgent(tasks, task.id, "http://127.0.0.1:4178"),
    ).rejects.toThrow("INTERNAL_AGENT_CONFIG_CONFLICT");
    expect(await readFile(custom, "utf8")).toBe(
      "Synthetic custom command fixture",
    );
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      stat(join(task.workspacePath, "opencode.json")),
    ).rejects.toThrow();
  } finally {
    await tasks.close();
  }
});

test("internal extraction rejects unapproved models and uses redirect:error for approved requests", async () => {
  const fetch = vi.fn(
    async (_url: string | URL, _options?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ambiguities":[]}' } }],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const denied = await parseInput(
    "synthetic.txt",
    Buffer.from("synthetic fixture"),
    {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "synthetic-key",
      model: "fixture-model",
    },
  );
  expect(denied.status).toBe("needs-input");
  expect(denied.issues[0].message).toContain("not approved");
  expect(fetch).not.toHaveBeenCalled();
  const approved = await parseInput(
    "synthetic.txt",
    Buffer.from("synthetic fixture"),
    {
      baseUrl: "https://model.synthetic.invalid/v1",
      apiKey: "synthetic-key",
      model: "fixture-model",
    },
  );
  expect(approved.status).toBe("needs-confirmation");
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
});

test("internal release export rejects before accessing or rebuilding the release tree", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/build-release.ts"],
    {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        MODEL_API_KEY: "",
        MODEL_ID: "",
        MODEL_BASE_URL: "",
        OPENCODE_MODEL: "",
        OPENCODE_URL: "http://127.0.0.1:4096",
        RELIABILITY_API_URL: "http://127.0.0.1:4178",
      },
    },
  );
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("INTERNAL_RELEASE_FORBIDDEN");
  expect(result.stderr).not.toContain("synthetic-secret");
});

test.runIf(!!process.env.TEST_OPENCODE_URL)(
  "installed native OpenCode loads approved internal config, Skill and task MCP without inference",
  async () => {
    vi.stubEnv("OPENCODE_URL", process.env.TEST_OPENCODE_URL!);
    vi.stubEnv("SYNTHETIC_MODEL_KEY", undefined);
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    await app.listen({ host: "127.0.0.1", port: 0 });
    let sessionId: string | undefined;
    let workspace: string | undefined;
    const nativeRequest = async (path: string, method = "GET") => {
      const url = new URL(path, process.env.TEST_OPENCODE_URL!);
      if (workspace) url.searchParams.set("directory", workspace);
      assertEndpointAllowed(url, "opencode");
      return fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    };
    const nativeGet = async (path: string) => {
      const response = await nativeRequest(path);
      expect(response.ok).toBe(true);
      return response.json();
    };
    try {
      const task = app.taskServices.create(
        "Internal native smoke · synthetic fixture",
      );
      workspace = task.workspacePath;
      const created = await app.inject({
        method: "POST",
        url: `/api/tasks/${task.id}/agent/session`,
        payload: {},
      });
      expect(created.statusCode, created.body).toBe(200);
      sessionId = created.json().sessionId;
      const providers = await nativeGet("/provider");
      expect(providers.all.map((provider: any) => provider.id)).toEqual([
        "enterprise",
      ]);
      expect(Object.keys(providers.all[0].models)).toEqual(["fixture-model"]);
      const skills = await nativeGet("/skill");
      expect(skills.some((skill: any) => skill.name === "sd-dfr-remap")).toBe(
        true,
      );
      const mcp = await nativeGet("/mcp");
      expect(Object.keys(mcp)).toEqual(["reliability"]);
      expect(mcp.reliability.status).toBe("connected");
      const config = await nativeGet("/config");
      expect(config.enabled_providers).toEqual(["enterprise"]);
      expect(config.model).toBe("enterprise/fixture-model");
      expect(config.small_model).toBe("enterprise/fixture-model");
      expect(config.share).toBe("disabled");
      expect(config.autoupdate).toBe(false);
    } finally {
      try {
        if (sessionId)
          await nativeRequest(
            "/session/" + encodeURIComponent(sessionId),
            "DELETE",
          );
        if (workspace) await nativeRequest("/instance/dispose", "POST");
      } finally {
        await app.close();
      }
    }
  },
  90000,
);

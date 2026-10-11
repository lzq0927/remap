import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { TaskServices } from "../../tasks/src/service";
import { DomainError } from "../../contracts/src/errors";
import { OpenCodeAdapter } from "./opencode-adapter";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
  internalOpenCodeConfig,
} from "../../runtime-policy/src/index";
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
const preparations = new Map<string, Promise<any>>();
function assertConfigPath(path: string) {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (entry && (entry.isSymbolicLink() || realpathSync(path) !== path))
    throw new DomainError("TASK_PATH_INVALID", "Agent 配置路径被重定向", 403);
}
export const bigmodelProvider = {
  npm: "@ai-sdk/openai-compatible",
  name: "智谱 Coding Plan",
  options: { baseURL: "https://open.bigmodel.cn/api/coding/paas/v4" },
  models: { "glm-5.3": { name: "GLM-5.3" } },
};

export async function prepareTaskAgent(
  tasks: TaskServices,
  taskId: string,
  apiUrl: string,
) {
  const workspace = tasks.registry.resolveRoot(taskId);
  const pending = preparations.get(workspace);
  const prepared = (pending ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => prepare(tasks, taskId, apiUrl));
  preparations.set(workspace, prepared);
  try {
    return await prepared;
  } finally {
    if (preparations.get(workspace) === prepared)
      preparations.delete(workspace);
  }
}

async function prepare(tasks: TaskServices, taskId: string, apiUrl: string) {
  const policy = readRuntimePolicy();
  assertEndpointAllowed(apiUrl, "api", policy);
  const { task } = tasks.resolve(taskId);
  const workspace = tasks.registry.resolveRoot(taskId);
  if (policy.profile === "internal") {
    // Preserve existing user files and fail closed if native config discovery
    // could load additional task-local code or configuration.
    for (const name of [
      "opencode.jsonc",
      ".opencode/opencode.json",
      ".opencode/opencode.jsonc",
      ".opencode/agents",
      ".opencode/agent",
      ".opencode/plugins",
      ".opencode/plugin",
      ".opencode/command",
    ])
      if (existsSync(join(workspace, name)))
        throw new Error(
          "INTERNAL_AGENT_CONFIG_CONFLICT: additional task-local Agent configuration requires administrator review",
        );
    const commands = join(workspace, ".opencode/commands");
    assertConfigPath(commands);
    if (
      existsSync(commands) &&
      (await readdir(commands)).some((name) => name !== "sd-dfr-remap.md")
    )
      throw new Error(
        "INTERNAL_AGENT_CONFIG_CONFLICT: custom task commands require administrator review",
      );
  }
  // Generated configuration is local-only. Credentials stay outside task exports.
  for (const name of [
    ".opencode",
    ".opencode/skills",
    ".opencode/skills/sd-dfr-remap",
    ".opencode/commands",
    "opencode.json",
    ".opencode/rem-config-digest",
  ]) {
    assertConfigPath(join(workspace, name));
  }
  tasks.getAgentCredential(taskId);
  await mkdir(join(workspace, ".opencode"), { recursive: true });
  const digest = createHash("sha256");
  const install = async (source: string, target: string) => {
    assertConfigPath(target);
    await mkdir(target, { recursive: true });
    for (const entry of (await readdir(source, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const from = join(source, entry.name),
        to = join(target, entry.name);
      if (entry.isDirectory()) await install(from, to);
      else if (entry.isFile()) {
        assertConfigPath(to);
        const content = await readFile(from);
        digest.update(to).update(content);
        if (!existsSync(to) || !(await readFile(to)).equals(content))
          await writeFile(to, content);
      }
    }
  };
  await install(
    join(projectRoot, "skills/sd-dfr-remap"),
    join(workspace, ".opencode/skills/sd-dfr-remap"),
  );
  await install(
    join(projectRoot, ".opencode/commands"),
    join(workspace, ".opencode/commands"),
  );
  const configFile = join(workspace, "opencode.json");
  const oldConfig = existsSync(configFile)
    ? await readFile(configFile, "utf8")
    : "";
  const previous =
    policy.profile === "external" && oldConfig ? JSON.parse(oldConfig) : {};
  const config = {
    ...previous,
    $schema: "https://opencode.ai/config.json",
    ...(policy.profile === "internal"
      ? internalOpenCodeConfig(policy)
      : {
          provider: {
            "zhipuai-coding-plan": bigmodelProvider,
            ...previous.provider,
          },
        }),
    mcp: {
      ...previous.mcp,
      reliability: {
        type: "local",
        command: [
          process.execPath,
          "--import",
          pathToFileURL(require.resolve("tsx")).href,
          resolve(projectRoot, "packages/mcp-runtime/src/launch.ts"),
          tasks.registry.root,
          taskId,
          apiUrl,
        ],
        enabled: true,
      },
    },
    permission: { ...previous.permission, external_directory: "deny" },
  };
  const content = JSON.stringify(config, null, 2);
  if (oldConfig !== content) await writeFile(configFile, content);
  const installedDigest = digest.update(content).digest("hex");
  const marker = join(workspace, ".opencode/rem-config-digest");
  const loadedDigest = existsSync(marker) ? await readFile(marker, "utf8") : "";
  const agent = new OpenCodeAdapter(undefined, workspace);
  // Native metadata probes can initialize an instance before the Skill exists.
  // Refresh only this directory after changed configuration, never on ordinary reconnects.
  if (loadedDigest !== installedDigest && (await agent.health()).ready) {
    await agent.reloadProject();
    await writeFile(marker, installedDigest);
  }
  return { task, agent };
}

export function assertSessionBound(
  tasks: TaskServices,
  taskId: string,
  sessionId: string,
) {
  const context = tasks.resolve(taskId);
  const binding = context.store
    .documents("agent-binding")
    .find((s) => s.sessionId === sessionId);
  if (!binding)
    throw new DomainError(
      "SESSION_NOT_BOUND",
      "会话未绑定当前任务，请返回任务主会话",
      403,
    );
  return binding;
}

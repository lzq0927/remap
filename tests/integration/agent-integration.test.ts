import { expect, test, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/server";
import type { AgentIntegration } from "../../apps/api/src/agent-integration";
import type { WorkspaceAgentPort } from "../../packages/agents/src/port";

test("administrator can replace Agent integration while keeping task binding and human authorization", async () => {
  const sessions = new Map<
    string,
    Array<{ id: string; title: string; url: string }>
  >();
  const contexts = vi.fn(async () => ({}));
  const forTask = (directory: string): WorkspaceAgentPort => ({
    health: async () => ({ ready: true, version: "synthetic-agent" }),
    webInfo: async () => ({
      ready: true,
      version: "synthetic-agent",
      url: "http://127.0.0.1:4099",
      directory,
      projectUrl: "http://127.0.0.1:4099/task",
      sessions: sessions.get(directory) ?? [],
    }),
    createSession: async (options) => {
      const id = "session-" + sessions.size;
      sessions.set(directory, [
        ...(sessions.get(directory) ?? []),
        {
          id,
          title: options?.title ?? "Synthetic",
          url: "http://127.0.0.1:4099/task/" + id,
        },
      ]);
      return { sessionId: id };
    },
    messages: async () => [],
    sendMessage: async () => ({}),
    runCommand: async () => ({}),
    abort: async () => ({}),
    async *events() {
      /* Synthetic adapter has no event source. */
    },
    metadata: async () => ({ commands: [], tools: {} }),
    providers: async () => ({ connected: [], providers: [] }),
    addContext: contexts,
    pending: async () => ({ questions: [], permissions: [] }),
    reply: async () => ({}),
  });
  const prepareTask: AgentIntegration["prepareTask"] = vi.fn(
    async (tasks, taskId) => ({
      task: tasks.resolve(taskId).task,
      agent: forTask(tasks.registry.resolveRoot(taskId)),
    }),
  );
  const app = await buildApp({
    dataDir: ":memory:",
    agentIntegration: { global: forTask("global"), forTask, prepareTask },
  });
  try {
    expect((await app.inject("/health")).json().agent.version).toBe(
      "synthetic-agent",
    );
    const a = (
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { name: "Adapter A" },
      })
    ).json();
    const b = (
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { name: "Adapter B" },
      })
    ).json();
    const base = "/api/tasks/" + a.id;
    const session = (
      await app.inject({
        method: "POST",
        url: base + "/agent/session",
        payload: {},
      })
    ).json();
    expect(session.sessionId).toBe("session-0");
    expect(
      (
        await app.inject({
          method: "POST",
          url: base + "/agent/session",
          payload: {},
        })
      ).json(),
    ).toEqual(session);
    expect(
      (await app.inject(base + "/agent/web")).json().sessions,
    ).toHaveLength(1);
    expect(
      (await app.inject("/api/tasks/" + b.id + "/agent/web")).json().sessions,
    ).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url:
            "/api/tasks/" + b.id + "/agent/" + session.sessionId + "/context",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const credentials = app.taskServices.getAgentCredential(a.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: base + "/agent/prepare",
          headers: { authorization: "Bearer " + credentials },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(existsSync(join(a.workspacePath, "opencode.json"))).toBe(false);
    expect(contexts).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

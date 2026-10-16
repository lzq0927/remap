import { getAuditDefaults } from "../../packages/analysis/src/audit";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
import { expect, test, vi } from "vitest";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/server";
import { openCodeIntegration } from "../../apps/api/src/agent-integration";
import { OpenCodeAdapter } from "../../packages/agents/src/opencode-adapter";

test("native OpenCode sessions are named and scoped to task directories", async () => {
  const native = Fastify();
  const sessions: any[] = [],
    contexts: any[] = [];
  const reloads: string[] = [];
  let completeCommand: (() => void) | undefined;
  native.post(
    "/session/:id/command",
    async () =>
      new Promise((resolve) => {
        completeCommand = () => resolve({});
      }),
  );
  native.post("/instance/dispose", async (req: any) => {
    reloads.push(req.query.directory);
    return true;
  });
  native.get("/global/health", async () => ({
    healthy: true,
    version: "fixture",
  }));
  native.get("/path", async (req: any) => ({ directory: req.query.directory }));
  native.post("/session", async (req: any) => {
    const s = {
      id: "session-" + sessions.length,
      directory: req.query.directory,
      title: req.body.title,
    };
    sessions.push(s);
    return s;
  });
  native.get("/session", async () => sessions);
  native.post("/session/:id/message", async (req: any) => {
    contexts.push(req.body);
    return {};
  });
  native.get("/provider", async () => ({
    connected: ["zhipuai-coding-plan"],
    all: [
      {
        id: "zhipuai-coding-plan",
        name: "Coding",
        options: { apiKey: "synthetic-do-not-return" },
        models: { "glm-5.3": { id: "glm-5.3", name: "GLM-5.3" } },
      },
    ],
  }));
  await native.listen({ host: "127.0.0.1", port: 0 });
  vi.stubEnv(
    "OPENCODE_URL",
    "http://127.0.0.1:" + (native.server.address() as any).port,
  );
  const app = await buildApp({
    dataDir: ":memory:",
    seed: false,
    agentIntegration: openCodeIntegration({ isolate: false }),
  });
  try {
    const a = (
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { name: "A training" },
      })
    ).json();
    const b = (
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { name: "B training" },
      })
    ).json();
    const prefix = "/api/tasks/" + a.id;
    const session = (
      await app.inject({
        method: "POST",
        url: prefix + "/agent/session",
        payload: {},
      })
    ).json();
    expect(session.sessionId).toBe("session-0");
    expect(sessions[0].title).toContain("A training · 主会话");
    expect(
      (await app.inject(prefix + "/agent/web")).json().sessions,
    ).toHaveLength(1);
    expect(
      (await app.inject("/api/tasks/" + b.id + "/agent/web")).json().sessions,
    ).toEqual([]);
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
    await app.inject({
      method: "POST",
      url: prefix + "/design",
      payload: {
        request: { cards: 10000, model: { large: "not-in-summary" } },
      },
    });
    await app.inject({
      method: "POST",
      url: prefix + "/agent/" + session.sessionId + "/context",
      payload: {},
    });
    expect(contexts[0].noReply).toBe(true);
    expect(contexts[0].parts[0].text).not.toContain("not-in-summary");
    const auditDraft = draftFromAuditRequest({
      ...getAuditDefaults(),
      cards: 20000,
      scales: [20000],
      target: 0.943,
    });
    const saved = (
      await app.inject({
        method: "POST",
        url: prefix + "/design",
        payload: {
          activeAssessment: "audit",
          scenario: "training",
          request: { cards: 999, target: 0.1 },
          auditDraft,
        },
      })
    ).json();
    expect(saved.assessment.valid).toBe(true);
    await app.inject({
      method: "POST",
      url: prefix + "/agent/" + session.sessionId + "/context",
      payload: { cards: 123 },
    });
    expect(contexts[1].parts[0].text).toContain(
      "training.retained-clean-progress",
    );
    expect(contexts[1].parts[0].text).toContain("20000");
    expect(contexts[1].parts[0].text).not.toContain('"cards":999');
    const config = JSON.parse(
      await readFile(join(a.workspacePath, "opencode.json"), "utf8"),
    );
    expect(
      config.provider["zhipuai-coding-plan"].models["glm-5.3"],
    ).toBeDefined();
    expect(JSON.stringify(config)).not.toContain(
      app.taskServices.getAgentCredential(a.id),
    );
    expect(config.permission.external_directory).toBe("deny");
    const skillDirectory = join(
      a.workspacePath,
      ".opencode/skills/sd-dfr-remap",
    );
    const skill = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
    expect(skill).toBe(await readFile("skills/sd-dfr-remap/SKILL.md", "utf8"));
    const manifest = JSON.parse(
      await readFile(join(skillDirectory, "manifest.json"), "utf8"),
    );
    expect(manifest.version).toBe("0.3.2");
    expect(manifest.primaryScenario).toBe("training.retained-clean-progress");
    for (const reference of manifest.references)
      expect(await readFile(join(skillDirectory, reference), "utf8")).toBe(
        await readFile(join("skills/sd-dfr-remap", reference), "utf8"),
      );
    expect(contexts[1].parts[0].text).toContain("audit_evaluate");
    expect(contexts[1].parts[0].text).toContain("生成建议不自动执行改进轮");
    expect(
      JSON.parse(contexts[1].parts[0].text.split("\n").slice(1).join("\n"))
        .assessments,
    ).toEqual([]);
    expect((await app.inject(prefix + "/agent/providers")).body).not.toContain(
      "do-not-return",
    );
    sessions.shift();
    const replacement = (
      await app.inject({
        method: "POST",
        url: prefix + "/agent/session",
        payload: {},
      })
    ).json();
    const reused = (
      await app.inject({
        method: "POST",
        url: prefix + "/agent/session",
        payload: {},
      })
    ).json();
    expect(reused.sessionId).toBe(replacement.sessionId);
    const dispatchPath = prefix + "/agent/" + replacement.sessionId;
    const dispatched = await app.inject({
      method: "POST",
      url: dispatchPath + "/message",
      payload: { text: "/sd-dfr-remap", dispatch: true },
    });
    expect(dispatched.json().dispatched).toBe(true);
    await vi.waitFor(() => expect(completeCommand).toBeDefined());
    expect((await app.inject(dispatchPath + "/dispatch")).json().status).toBe(
      "running",
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: dispatchPath + "/message",
          payload: { text: "/sd-dfr-remap", dispatch: true },
        })
      ).statusCode,
    ).toBe(409);
    completeCommand!();
    await vi.waitFor(async () =>
      expect((await app.inject(dispatchPath + "/dispatch")).json().status).toBe(
        "finished",
      ),
    );
    expect(reloads).toEqual([a.workspacePath]);
  } finally {
    completeCommand?.();
    await app.close();
    await native.close();
    vi.unstubAllEnvs();
  }
});

test.skipIf(!process.env.TEST_OPENCODE_URL)(
  "installed OpenCode loads task Skill, scoped MCP and configured GLM provider",
  async () => {
    vi.stubEnv("OPENCODE_URL", process.env.TEST_OPENCODE_URL!);
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    await app.listen({ host: "127.0.0.1", port: 0 });
    let sessionId: string | undefined;
    let directory: string | undefined;
    let nativeUrl = process.env.TEST_OPENCODE_URL;
    let legacy: OpenCodeAdapter | undefined;
    try {
      const task = app.taskServices.create("Native smoke · synthetic data");
      directory = task.workspacePath;
      const prefix = "/api/tasks/" + task.id;
      // Existing task-bound transcript must survive the move out of the shared service.
      legacy = new OpenCodeAdapter(process.env.TEST_OPENCODE_URL, directory);
      sessionId = (
        await legacy.createSession({ title: "Task A legacy · synthetic" })
      ).sessionId;
      await legacy.addContext(sessionId!, {
        message: "synthetic preserved history",
      });
      app.taskServices.resolve(task.id).store.putDocument(
        "agent-binding",
        {
          sessionId,
          taskId: task.id,
          purpose: "primary",
        },
        sessionId,
      );
      // The UI probes Web metadata before it prepares the task's Agent configuration.
      const nativeProbe = await app.inject(prefix + "/agent/web");
      expect(nativeProbe.statusCode, nativeProbe.body).toBe(200);
      const created = await app.inject({
        method: "POST",
        url: prefix + "/agent/session",
        payload: {},
      });
      expect(created.statusCode, created.body).toBe(200);
      expect(created.json().sessionId).toBe(sessionId);
      const web = (await app.inject(prefix + "/agent/web")).json();
      nativeUrl = web.url;
      expect(nativeUrl).not.toBe(process.env.TEST_OPENCODE_URL);
      expect(web.directory).toBe(directory);
      expect(web.sessions.find((s: any) => s.id === sessionId)).toBeDefined();
      const nativeGet = async (path: string) => {
        const url = new URL(path, nativeUrl);
        url.searchParams.set("directory", directory!);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000),
        });
        expect(response.ok).toBe(true);
        return response.json();
      };
      const skills = await nativeGet("/skill");
      const loadedSkill = skills.find((s: any) => s.name === "sd-dfr-remap");
      expect(loadedSkill).toBeDefined();
      expect(loadedSkill.content).toContain("audit_evaluate");
      expect(loadedSkill.content).toContain("默认配置只是可载入的起点");
      const messages = await nativeGet("/session/" + sessionId + "/message");
      expect(JSON.stringify(messages)).toContain("synthetic preserved history");
      const other = app.taskServices.create("Task B isolated · synthetic");
      const otherPrefix = "/api/tasks/" + other.id;
      const otherSession = (
        await app.inject({
          method: "POST",
          url: otherPrefix + "/agent/session",
          payload: {},
        })
      ).json();
      const otherWeb = (await app.inject(otherPrefix + "/agent/web")).json();
      expect(otherWeb.url).not.toBe(nativeUrl);
      // Check the unfiltered native APIs, not just the workbench's dropdown.
      const allA = await (await fetch(nativeUrl + "/session")).json();
      const allB = await (await fetch(otherWeb.url + "/session")).json();
      expect(allA.map((s: any) => s.id)).toContain(sessionId);
      expect(allA.map((s: any) => s.id)).not.toContain(otherSession.sessionId);
      expect(allB.map((s: any) => s.id)).toContain(otherSession.sessionId);
      expect(allB.map((s: any) => s.id)).not.toContain(sessionId);
      expect((await fetch(otherWeb.url + "/session/" + sessionId)).status).toBe(
        404,
      );
      const mcp = await nativeGet("/mcp");
      expect(mcp.reliability.status).toBe("connected");
      const providers = (await app.inject(prefix + "/agent/providers")).json();
      expect(
        providers.providers
          .find((p: any) => p.id === "zhipuai-coding-plan")
          .models.some((m: any) => m.id === "glm-5.3"),
      ).toBe(true);
    } finally {
      if (sessionId) {
        if (legacy) {
          const original = new URL(
            "/session/" + sessionId,
            process.env.TEST_OPENCODE_URL,
          );
          original.searchParams.set("directory", directory!);
          await fetch(original, { method: "DELETE" });
          await legacy.reloadProject();
        }
        const url = new URL("/session/" + sessionId, nativeUrl);
        if (directory) url.searchParams.set("directory", directory);
        await fetch(url, { method: "DELETE" });
      }
      if (directory) {
        const dispose = new URL("/instance/dispose", nativeUrl);
        dispose.searchParams.set("directory", directory);
        await fetch(dispose, { method: "POST" });
      }
      await app.close();
      vi.unstubAllEnvs();
    }
  },
  90000,
);

test("prepares the task Skill and scoped MCP while the native Agent is unavailable", async () => {
  vi.stubEnv("OPENCODE_BIN", "/missing/synthetic-opencode");
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const task = app.taskServices.create("Offline preparation");
    app.taskServices.resolve(task.id).store.putDocument("agent-binding", {
      sessionId: "synthetic-unavailable-history",
      purpose: "primary",
      taskId: task.id,
    });
    const prepared = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/agent/prepare`,
      payload: {},
    });
    expect(prepared.statusCode, prepared.body).toBe(200);
    const configuration = JSON.parse(
      await readFile(join(task.workspacePath, "opencode.json"), "utf8"),
    );
    expect(configuration.mcp.reliability.enabled).toBe(true);
    const manifest = JSON.parse(
      await readFile(
        join(task.workspacePath, ".opencode/skills/sd-dfr-remap/manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.tools).toContain("audit_evaluate");
    expect(
      app.taskServices.resolve(task.id).store.documents("agent-binding")[0]
        .sessionId,
    ).toBe("synthetic-unavailable-history");
  } finally {
    await app.close();
    vi.unstubAllEnvs();
  }
});

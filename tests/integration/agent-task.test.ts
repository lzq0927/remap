import { getAuditDefaults } from "../../packages/analysis/src/audit";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
import { expect, test, vi } from "vitest";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/server";

test("native OpenCode sessions are named and scoped to task directories", async () => {
  const native = Fastify();
  const sessions: any[] = [],
    contexts: any[] = [];
  const reloads: string[] = [];
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
  const app = await buildApp({ dataDir: ":memory:", seed: false });
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
    expect(reloads).toEqual([a.workspacePath]);
  } finally {
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
    try {
      const task = app.taskServices.create("Native smoke · synthetic data");
      directory = task.workspacePath;
      const prefix = "/api/tasks/" + task.id;
      // The UI probes Web metadata before it prepares the task's Agent configuration.
      expect((await app.inject(prefix + "/agent/web")).statusCode).toBe(200);
      const created = await app.inject({
        method: "POST",
        url: prefix + "/agent/session",
        payload: {},
      });
      expect(created.statusCode, created.body).toBe(200);
      sessionId = created.json().sessionId;
      const web = (await app.inject(prefix + "/agent/web")).json();
      expect(web.directory).toBe(directory);
      expect(web.sessions.find((s: any) => s.id === sessionId)).toBeDefined();
      const nativeGet = async (path: string) => {
        const url = new URL(path, process.env.TEST_OPENCODE_URL);
        url.searchParams.set("directory", directory!);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000),
        });
        expect(response.ok).toBe(true);
        return response.json();
      };
      const skills = await nativeGet("/skill");
      expect(skills.some((s: any) => s.name === "sd-dfr-remap")).toBe(true);
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
        const url = new URL(
          "/session/" + sessionId,
          process.env.TEST_OPENCODE_URL,
        );
        if (directory) url.searchParams.set("directory", directory);
        await fetch(url, { method: "DELETE" });
      }
      if (directory) {
        const dispose = new URL(
          "/instance/dispose",
          process.env.TEST_OPENCODE_URL,
        );
        dispose.searchParams.set("directory", directory);
        await fetch(dispose, { method: "POST" });
      }
      await app.close();
      vi.unstubAllEnvs();
    }
  },
  90000,
);

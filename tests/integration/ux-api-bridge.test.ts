import { afterEach, expect, test, vi } from "vitest";
import Fastify from "fastify";
import { buildApp } from "./task-fixture";
import { OpenCodeAdapter } from "../../packages/agents/src/opencode-adapter";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("design API appends snapshots, restores the newest same-time save and rejects array requests", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    expect((await app.inject("/api/design")).json()).toBeNull();
    const invalid = await app.inject({
      method: "POST",
      url: "/api/design",
      payload: { request: [] },
    });
    expect(invalid.statusCode).toBe(400);
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(
      "2026-10-11T00:00:00.000Z",
    );
    const first = (
      await app.inject({
        method: "POST",
        url: "/api/design",
        payload: { request: { cards: 10000 }, stage: 1, scenario: "training" },
      })
    ).json();
    const second = (
      await app.inject({
        method: "POST",
        url: "/api/design",
        payload: {
          request: { cards: 100000 },
          stage: 4,
          scenario: "training",
          confirmed: ["clarify"],
          session: "session-b",
        },
      })
    ).json();
    expect(second.id).not.toBe(first.id);
    expect((await app.inject("/api/design")).json()).toMatchObject({
      id: second.id,
      request: { cards: 100000 },
      stage: 4,
      session: "session-b",
    });
  } finally {
    await app.close();
  }
});

test("downloaded training, catalog and CSV templates pass actual import confirmation and mapping routes", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    for (const name of [
      "training-input.json",
      "catalog-import.json",
      "fault-modes.csv",
    ]) {
      const template = await app.inject("/api/templates/" + name);
      expect(template.statusCode).toBe(200);
      expect(template.headers["content-disposition"]).toContain(name);
      expect(template.headers["content-type"]).toContain(
        name.endsWith(".csv") ? "text/csv" : "application/json",
      );
      const imported = (
        await app.inject({
          method: "POST",
          url: "/api/inputs",
          payload: {
            name,
            base64: Buffer.from(template.body).toString("base64"),
          },
        })
      ).json();
      const blocked = await app.inject(`/api/inputs/${imported.id}/mapping`);
      expect(blocked.json().error.code).toBe("INPUT_UNCONFIRMED");
      const confirmed = (
        await app.inject({
          method: "POST",
          url: `/api/inputs/${imported.id}/confirm`,
          payload: {},
        })
      ).json();
      expect(confirmed.id).not.toBe(imported.id);
      const preview = await app.inject(`/api/inputs/${confirmed.id}/mapping`);
      expect(preview.statusCode).toBe(200);
      expect(preview.json().unmapped).toEqual([]);
      if (name === "training-input.json")
        expect(preview.json().trainingPatch).toMatchObject({
          cards: 10000,
          target: 0.99,
          model: { saveSeconds: 10 },
        });
      else
        expect(preview.json().assets[0].payload).toMatchObject({
          fit: 1000,
          rateBasis: "device-hour",
          inputSource: { inputId: confirmed.id },
        });
    }
    expect((await app.inject("/api/templates/.env")).statusCode).toBe(404);
    expect((await app.inject("/api/templates/..%2F.env")).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

test("confirmed model extraction becomes training changes and sourced draft assets, never invented FIT", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  const extraction = {
    architecture: {
      nodes: [{ id: "node-a" }, { id: "node-b" }],
      edges: [{ from: "node-a", to: "node-b" }],
    },
    failureModes: [
      { name: "GPU mode without measured rate", source: { page: 2 } },
    ],
    mechanisms: [
      { name: "recovery", patch: { hardSeconds: 10 }, source: { page: 3 } },
    ],
    parameters: [
      {
        name: "checkpoint save",
        modelField: "saveSeconds",
        value: 4,
        unit: "seconds",
        source: { page: 4 },
      },
    ],
    ambiguities: [],
  };
  try {
    const imported = (
      await app.inject({
        method: "POST",
        url: "/api/inputs",
        payload: {
          name: "reviewed-extraction.json",
          base64: Buffer.from(JSON.stringify(extraction)).toString("base64"),
        },
      })
    ).json();
    const confirmed = (
      await app.inject({
        method: "POST",
        url: `/api/inputs/${imported.id}/confirm`,
        payload: { data: extraction },
      })
    ).json();
    const preview = (
      await app.inject(`/api/inputs/${confirmed.id}/mapping`)
    ).json();
    expect(preview.trainingPatch).toEqual({ model: { saveSeconds: 4 } });
    expect(preview.assets.map((a: any) => a.kind)).toEqual([
      "scenario-template",
      "failure-mode",
      "mechanism",
      "parameter-evidence",
    ]);
    expect(preview.assets[1].payload.fit).toBeUndefined();
    expect(preview.assets[1].payload).toMatchObject({
      evidenceStatus: "unverified",
      source: { page: 2 },
      inputSource: { inputId: confirmed.id, contentHash: imported.contentHash },
    });
    expect(preview.warnings.join(" ")).toContain("不能补零");
    expect(preview.warnings.join(" ")).toContain("不会自动改变训练拓扑");
    expect(preview.unmapped).toEqual([]);
  } finally {
    await app.close();
  }
});

test("unresolved extraction cannot confirm and incomplete software rows stay unmapped", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const imported = (
      await app.inject({
        method: "POST",
        url: "/api/inputs",
        payload: {
          name: "unknown.json",
          base64: Buffer.from('{"ambiguities":["missing rate"]}').toString(
            "base64",
          ),
        },
      })
    ).json();
    const refused = await app.inject({
      method: "POST",
      url: `/api/inputs/${imported.id}/confirm`,
      payload: {},
    });
    expect(refused.json().error.code).toBe("UNRESOLVED_AMBIGUITY");
    const corrected = (
      await app.inject({
        method: "POST",
        url: `/api/inputs/${imported.id}/confirm`,
        payload: {
          data: [
            {
              kind: "failure-mode",
              name: "software",
              fit: "1000",
              rateBasis: "job-hour",
            },
          ],
        },
      })
    ).json();
    const preview = (
      await app.inject(`/api/inputs/${corrected.id}/mapping`)
    ).json();
    expect(preview.assets).toEqual([]);
    expect(preview.unmapped[0].reason).toContain("device-hour");
  } finally {
    await app.close();
  }
});

test("seed catalog assigns exact expert FIT order HBM GPU network other", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  try {
    const modes = (await app.inject("/api/catalogs?kind=failure-mode"))
      .json()
      .sort(
        (a: any, b: any) =>
          a.payload.modelBinding.index - b.payload.modelBinding.index,
      );
    expect(
      modes.map((a: any) => ({
        name: a.name,
        index: a.payload.modelBinding.index,
        fit: a.payload.fit,
      })),
    ).toEqual([
      { name: "HBM示例模式", index: 0, fit: 587.431694 },
      { name: "GPU示例模式", index: 1, fit: 1028.005464 },
      { name: "网络示例模式", index: 2, fit: 286.885246 },
      { name: "其他示例模式", index: 3, fit: 1512.978142 },
    ]);
    expect(
      modes.every(
        (a: any) =>
          a.state === "validated" && a.payload.rateBasis === "device-hour",
      ),
    ).toBe(true);
  } finally {
    await app.close();
  }
});

test("official local web metadata filters projects and never returns server authentication or unrelated fields", async () => {
  const server = Fastify();
  const credential = "test-only-secret-never-return";
  vi.stubEnv("OPENCODE_SERVER_USERNAME", "test-user");
  vi.stubEnv("OPENCODE_SERVER_PASSWORD", credential);
  const authorizations: unknown[] = [];
  server.addHook("onRequest", async (req) => {
    authorizations.push(req.headers.authorization);
  });
  server.get("/global/health", async () => ({
    healthy: true,
    version: "1.18.35",
    password: credential,
  }));
  server.get("/path", async () => ({
    directory: "D:\\code\\sys_reliability",
    password: credential,
  }));
  server.get("/session", async () => [
    {
      id: "local-session",
      title: "local",
      directory: "D:\\code\\sys_reliability",
      time: { updated: 123 },
      providerApiKey: credential,
    },
    { id: "other-session", title: "other", directory: "D:\\other" },
  ]);
  await server.listen({ host: "127.0.0.1", port: 0 });
  try {
    const address = server.server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    const info = await new OpenCodeAdapter(url).webInfo();
    expect(info.ready).toBe(true);
    expect(info.url).toBe(url);
    expect(info.sessions).toHaveLength(1);
    expect(info.sessions[0].id).toBe("local-session");
    expect(info.projectUrl).toBe(
      `${url}/${Buffer.from("D:\\code\\sys_reliability").toString("base64url")}/session`,
    );
    expect(JSON.stringify(info)).not.toContain(credential);
    expect(authorizations).toEqual(
      Array(3).fill(
        "Basic " + Buffer.from("test-user:" + credential).toString("base64"),
      ),
    );
  } finally {
    await server.close();
  }
});

test("remote official web addresses are rejected before any outbound request", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unexpected request"));
  await expect(
    new OpenCodeAdapter("https://example.invalid").webInfo(),
  ).rejects.toThrow(/回环/);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("credentials embedded in an OpenCode URL cannot leak through web errors or health metadata", async () => {
  const secret = "test-userinfo-secret";
  const adapter = new OpenCodeAdapter(
    `http://test-user:${secret}@127.0.0.1:4096`,
  );
  let failure = "";
  try {
    await adapter.webInfo();
  } catch (e) {
    failure = String(e);
  }
  expect(failure).toBeTruthy();
  expect(failure).not.toContain(secret);
  expect(JSON.stringify(await adapter.health())).not.toContain(secret);
  await expect(
    adapter
      .events("public-session", new AbortController().signal)
      [Symbol.asyncIterator]()
      .next(),
  ).rejects.toThrow(/不能内嵌凭据/);
});

test("context bridge sends one noReply message without a model override or inference endpoint", async () => {
  const server = Fastify();
  const requests: Array<{ url: string; body: any }> = [];
  vi.stubEnv("OPENCODE_MODEL", "provider/must-not-run");
  server.post("/session/:id/message", async (req) => {
    requests.push({ url: req.url, body: req.body });
    return { info: { role: "user" }, parts: [] };
  });
  await server.listen({ host: "127.0.0.1", port: 0 });
  try {
    const address = server.server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    const context = {
      design: { cards: 10000, target: 0.99 },
      runId: "existing-run",
    };
    await new OpenCodeAdapter(url).addContext("session-with/slash", context);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/session/session-with%2Fslash/message");
    expect(requests[0].body.noReply).toBe(true);
    expect(requests[0].body).not.toHaveProperty("model");
    expect(requests[0].body.parts[0].text).toContain(
      JSON.stringify(context, null, 2),
    );
    vi.stubEnv("OPENCODE_URL", url);
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    try {
      const taskId = app.testTaskId;
      const store = app.taskServices.resolve(taskId).store;
      store.putDocument("agent-binding", {
        sessionId: "session-a",
        taskId,
        purpose: "primary",
      });
      await app.inject({
        method: "POST",
        url: "/api/design",
        payload: { request: context.design, scenario: "training" },
      });
      const response = await app.inject({
        method: "POST",
        url: `/api/tasks/${taskId}/agent/session-a/context`,
        payload: context,
      });
      expect(response.json()).toEqual({
        saved: true,
        sessionId: "session-a",
        inputRevision: 1,
      });
      expect(requests).toHaveLength(2);
      expect(requests[1].body).toMatchObject({ noReply: true });
      expect(requests[1].body).not.toHaveProperty("model");
    } finally {
      await app.close();
    }
  } finally {
    await server.close();
  }
});

test.skipIf(!process.env.TEST_OPENCODE_URL)(
  "installed official OpenCode stores noReply context without creating an assistant reply",
  async () => {
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    const directory = app.taskServices.registry.resolveRoot(app.testTaskId);
    const agent = new OpenCodeAdapter(process.env.TEST_OPENCODE_URL, directory);
    let id: string | undefined;
    try {
      id = String((await agent.createSession()).sessionId);
      const marker = "REM noReply interface regression: public synthetic input";
      await agent.addContext(id, { marker, cards: 10000, target: 0.99 });
      const messages = await agent.messages(id);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].parts.some((p) => p.text?.includes(marker))).toBe(
        true,
      );
    } finally {
      if (id) {
        const url = new URL("/session/" + id, process.env.TEST_OPENCODE_URL);
        url.searchParams.set("directory", directory);
        await fetch(url, { method: "DELETE" });
      }
      await agent.reloadProject();
      await app.close();
    }
  },
);

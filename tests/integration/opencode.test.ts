import { test, expect, vi } from "vitest";
import { OpenCodeAdapter } from "../../packages/agents/src/opencode-adapter";
import { buildApp } from "./task-fixture";
test.skipIf(!process.env.TEST_OPENCODE_URL)(
  "installed OpenCode discovers portable Skill command and reliability MCP",
  async () => {
    vi.stubEnv("OPENCODE_URL", process.env.TEST_OPENCODE_URL!);
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const directory = app.taskServices.registry.resolveRoot(app.testTaskId);
    let agent = new OpenCodeAdapter(process.env.TEST_OPENCODE_URL, directory);
    let id: string | undefined;
    try {
      expect((await agent.health()).ready).toBe(true);
      const created = await app.inject({
        method: "POST",
        url: `/api/tasks/${app.testTaskId}/agent/session`,
        payload: {},
      });
      expect(created.statusCode, created.body).toBe(200);
      id = created.json().sessionId;
      const web = (
        await app.inject(`/api/tasks/${app.testTaskId}/agent/web`)
      ).json();
      agent = new OpenCodeAdapter(web.url, directory);
      const metadata = await agent.metadata();
      expect(
        metadata.commands.some((c: any) => c.name === "sd-dfr-remap"),
      ).toBe(true);
      expect(metadata.tools.reliability.status).toBe("connected");
      expect(id).toBeTruthy();
      expect(await agent.messages(id!)).toEqual([]);
    } finally {
      if (id) {
        const url = new URL("/session/" + id, agent.url);
        url.searchParams.set("directory", directory);
        await fetch(url, { method: "DELETE" });
      }
      await agent.reloadProject();
      await app.close();
      vi.unstubAllEnvs();
    }
  },
  90000,
);

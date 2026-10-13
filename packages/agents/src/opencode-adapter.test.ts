import { afterEach, expect, test, vi } from "vitest";
import { OpenCodeAdapter } from "./opencode-adapter";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("native Agent API, metadata and event stream retain a configured service path prefix", async () => {
  vi.stubEnv("RELIABILITY_ENV", "external");
  const fetch = vi.fn(async (value: string | URL) => {
    const path = new URL(value).pathname;
    if (path.endsWith("/event")) return new Response("");
    const payload = path.endsWith("/global/health")
      ? { healthy: true, version: "synthetic" }
      : path.endsWith("/path")
        ? { directory: "/synthetic" }
        : path.endsWith("/session")
          ? []
          : {};
    return new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const agent = new OpenCodeAdapter(
    "http://127.0.0.1:4096/proxy/opencode/",
    "/synthetic",
  );
  const web = await agent.webInfo();
  expect(web.url).toBe("http://127.0.0.1:4096/proxy/opencode");
  expect(web.projectUrl).toContain("/proxy/opencode/");
  expect(
    await agent
      .events("fixture", new AbortController().signal)
      [Symbol.asyncIterator]()
      .next(),
  ).toMatchObject({ done: true });
  const urls = fetch.mock.calls.map(([url]) => new URL(url));
  expect(urls.every((url) => url.pathname.startsWith("/proxy/opencode/"))).toBe(
    true,
  );
  expect(
    urls
      .find((url) => url.pathname.endsWith("/global/health"))!
      .searchParams.has("directory"),
  ).toBe(false);
  expect(
    urls
      .find((url) => url.pathname.endsWith("/event"))!
      .searchParams.get("directory"),
  ).toBe("/synthetic");
});
test.each([
  "http://127.0.0.1:4096/?token=synthetic",
  "http://127.0.0.1:4096/#fixture",
])("ambiguous service URL is rejected before a request: %s", async (url) => {
  vi.stubEnv("RELIABILITY_ENV", "external");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(new OpenCodeAdapter(url).createSession()).rejects.toThrow(
    "查询参数或片段",
  );
  expect(fetch).not.toHaveBeenCalled();
});
test("surfaces provider failure and only returns safe diagnostic fields", async () => {
  vi.stubEnv("RELIABILITY_ENV", "external");
  const info = {
    role: "assistant",
    id: "m",
    modelID: "synthetic-model",
    providerID: "synthetic-provider",
    error: {
      name: "APIError",
      data: {
        message: "Model not entitled",
        statusCode: 429,
        responseHeaders: { "set-cookie": "fixture-private" },
      },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url, options) =>
        new Response(
          JSON.stringify(
            options?.method === "POST" ? { info } : [{ info, parts: [] }],
          ),
        ),
    ),
  );
  const agent = new OpenCodeAdapter("http://127.0.0.1:4096");
  await expect(agent.sendMessage("fixture", "synthetic")).rejects.toThrow(
    "Model not entitled",
  );
  const messages = await agent.messages("fixture");
  expect(messages[0].model?.id).toBe("synthetic-model");
  expect(JSON.stringify(messages)).not.toContain("fixture-private");
});

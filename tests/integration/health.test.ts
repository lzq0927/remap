import { test, expect } from "vitest";
import { buildApp } from "../../apps/api/src/server";
test("local API health is available without a configured model provider", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  const res = await app.inject("/health");
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe("ok");
  await app.close();
});

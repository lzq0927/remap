import { expect, it } from "vitest";
import { codespacesBrowserUrl, codespacesViteHosts } from "../src/codespaces";

it("maps each task's loopback URL to the same Codespace's HTTPS port while preserving its session path", () => {
  const origin = "https://remap-happy-space-abc-5173.app.github.dev";
  expect(
    codespacesBrowserUrl(
      "http://127.0.0.1:23123/project/ses_123?view=chat#message",
      origin,
    ),
  ).toBe(
    "https://remap-happy-space-abc-23123.app.github.dev/project/ses_123?view=chat#message",
  );
  expect(codespacesBrowserUrl("http://localhost:4096/", origin)).toBe(
    "https://remap-happy-space-abc-4096.app.github.dev/",
  );
  expect(codespacesBrowserUrl("http://[::1]:23124/project", origin)).toBe(
    "https://remap-happy-space-abc-23124.app.github.dev/project",
  );
});

it("keeps local usage and explicit remote Agent endpoints unchanged", () => {
  const local = "http://127.0.0.1:4096/project";
  for (const origin of [
    "http://localhost:5173",
    "https://ordinary.example",
    "https://remap-5173.app.github.dev.attacker.example",
    "http://remap-5173.app.github.dev",
    "invalid",
  ])
    expect(codespacesBrowserUrl(local, origin)).toBe(local);
  for (const endpoint of [
    "https://agent.example:4096/project",
    "not-a-url",
    "http://10.0.0.1:4096/",
  ])
    expect(
      codespacesBrowserUrl(endpoint, "https://remap-5173.app.github.dev"),
    ).toBe(endpoint);
});

it("keeps the preview domain and port identity when using the alternate Codespaces forwarding domain", () => {
  expect(
    codespacesBrowserUrl(
      "http://127.0.0.1:30000/project",
      "https://remap-test-5173.preview.app.github.dev",
    ),
  ).toBe("https://remap-test-30000.preview.app.github.dev/project");
});

it("allows only this Codespace's current Vite preview host, with no wildcard exposure", () => {
  expect(
    codespacesViteHosts({
      CODESPACES: "true",
      CODESPACE_NAME: "remap-demo-abc",
    }),
  ).toEqual(["remap-demo-abc-5173.app.github.dev"]);
  expect(
    codespacesViteHosts({
      CODESPACES: "true",
      CODESPACE_NAME: "remap-demo-abc",
      WEB_PORT: "5174",
    }),
  ).toEqual(["remap-demo-abc-5174.app.github.dev"]);
  for (const env of [
    {},
    { CODESPACES: "false", CODESPACE_NAME: "remap-demo" },
    {
      CODESPACES: "true",
      CODESPACE_NAME: "remap-demo",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "attacker.example",
    },
    { CODESPACES: "true", CODESPACE_NAME: "remap-demo", WEB_PORT: "NaN" },
  ])
    expect(codespacesViteHosts(env)).toEqual([]);
});

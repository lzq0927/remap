import { afterEach, beforeEach, expect, test } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
  assertDataDirectory,
} from "./index";

let directory: string;
let configPath: string;
const fixture = () => ({
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
});
const env = () => ({
  RELIABILITY_ENV: "internal",
  RELIABILITY_INTERNAL_CONFIG: configPath,
  DATA_DIR: join(directory, "data"),
});
const save = (value: unknown) =>
  writeFileSync(configPath, JSON.stringify(value));
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "runtime-policy-"));
  configPath = join(directory, "config.json");
  save(fixture());
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("defaults to external and rejects unknown profiles", () => {
  expect(readRuntimePolicy({}).profile).toBe("external");
  expect(() => readRuntimePolicy({ RELIABILITY_ENV: "internla" })).toThrow(
    "unknown RELIABILITY_ENV",
  );
  expect(() => readRuntimePolicy({ RELIABILITY_ENV: "internal" })).toThrow(
    "RELIABILITY_INTERNAL_CONFIG is required",
  );
});

test("approves exact origins and loopback only, without returning secret values", () => {
  const policy = readRuntimePolicy({
    ...env(),
    SYNTHETIC_MODEL_KEY: "synthetic-secret-do-not-return",
    OPENCODE_SERVER_PASSWORD: "synthetic-password",
  });
  expect(
    assertEndpointAllowed(
      "https://model.synthetic.invalid/v1/chat/completions",
      "extraction",
      policy,
    ).origin,
  ).toBe("https://model.synthetic.invalid");
  for (const origin of [
    "https://model.synthetic.invalid.attacker.invalid",
    "http://model.synthetic.invalid",
    "https://model.synthetic.invalid:9443",
    "https://api.openai.com",
  ])
    expect(() => assertEndpointAllowed(origin, "model", policy)).toThrow(
      "not approved",
    );
  for (const purpose of ["api", "opencode"] as const) {
    expect(
      assertEndpointAllowed("http://[::1]:4178/path", purpose, policy).hostname,
    ).toBe("[::1]");
    expect(() =>
      assertEndpointAllowed("https://model.synthetic.invalid", purpose, policy),
    ).toThrow("loopback");
  }
  expect(JSON.stringify(policy)).not.toContain("synthetic-secret");
  expect(JSON.stringify(policy)).not.toContain("synthetic-password");
});

test.each([
  "https://model.synthetic.invalid/",
  "https://model.synthetic.invalid/v1",
  "https://model.synthetic.invalid?key=synthetic-secret",
  "https://user:synthetic-secret@model.synthetic.invalid",
  "file:///tmp/model",
])(
  "rejects non-origin allowlist entries without echoing config: %s",
  (value) => {
    save({ ...fixture(), allowedOrigins: [value] });
    try {
      readRuntimePolicy(env());
      throw new Error("unexpected pass");
    } catch (error) {
      expect((error as Error).message).toContain("RUNTIME_POLICY_INVALID");
      expect((error as Error).message).not.toContain("synthetic-secret");
    }
  },
);

test("rejects invalid config, missing models, direct secrets and unapproved extraction fallback", () => {
  const valid = fixture();
  for (const config of [
    { ...valid, schemaVersion: "2" },
    {
      ...valid,
      allowedOrigins: [...valid.allowedOrigins, ...valid.allowedOrigins],
    },
    { ...valid, provider: { ...valid.provider, defaultModel: "missing" } },
    { ...valid, provider: { ...valid.provider, apiKey: "synthetic-secret" } },
    {
      ...valid,
      adapter: { id: "example", version: "1", module: "./local.mjs" },
    },
  ]) {
    save(config);
    expect(() => readRuntimePolicy(env())).toThrow("RUNTIME_POLICY_INVALID");
  }
  save(valid);
  expect(() =>
    readRuntimePolicy({
      ...env(),
      OPENCODE_URL: "https://external.synthetic.invalid",
    }),
  ).toThrow("loopback");
  expect(() =>
    readRuntimePolicy({
      ...env(),
      RELIABILITY_API_URL: "https://external.synthetic.invalid",
    }),
  ).toThrow("loopback");
  expect(() =>
    readRuntimePolicy({
      ...env(),
      MODEL_API_KEY: "synthetic",
      MODEL_ID: "fixture-model",
    }),
  ).toThrow("explicit MODEL_BASE_URL");
  expect(() =>
    readRuntimePolicy({
      ...env(),
      MODEL_BASE_URL: "https://api.openai.com/v1",
      MODEL_API_KEY: "synthetic",
      MODEL_ID: "fixture-model",
    }),
  ).toThrow("not approved");
  expect(() =>
    readRuntimePolicy({ ...env(), OPENCODE_MODEL: "external/model" }),
  ).toThrow("internal default model");
  writeFileSync(configPath, '{"synthetic-secret":');
  expect(() => readRuntimePolicy(env())).toThrow("could not be read as JSON");
});

test("internal DATA_DIR must be explicit, absolute and canonically outside the software tree", () => {
  expect(() => readRuntimePolicy({ ...env(), DATA_DIR: undefined })).toThrow(
    "explicit absolute directory",
  );
  expect(() => readRuntimePolicy({ ...env(), DATA_DIR: "data" })).toThrow(
    "explicit absolute directory",
  );
  for (const candidate of [
    process.cwd(),
    join(process.cwd(), "data"),
    join(process.cwd(), "future-synthetic-data", "nested"),
  ])
    expect(() => readRuntimePolicy({ ...env(), DATA_DIR: candidate })).toThrow(
      "outside the software tree",
    );
  const missing = join(directory, "new-data", "nested");
  const policy = readRuntimePolicy({ ...env(), DATA_DIR: missing });
  expect(policy.dataDir).toBe(missing);
  expect(existsSync(missing)).toBe(false);
  expect(() => assertDataDirectory(process.cwd(), policy)).toThrow(
    "outside the software tree",
  );
  const alias = join(directory, "alias-to-core");
  symlinkSync(
    process.cwd(),
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  try {
    expect(() =>
      readRuntimePolicy({ ...env(), DATA_DIR: join(alias, "new-data") }),
    ).toThrow("outside the software tree");
  } finally {
    unlinkSync(alias);
  }
});

test("internal extraction rejects every partial tuple instead of silently disabling or falling back", () => {
  const fields = {
    MODEL_API_KEY: "synthetic",
    MODEL_ID: "fixture-model",
    MODEL_BASE_URL: "https://model.synthetic.invalid/v1",
  };
  const names = Object.keys(fields) as (keyof typeof fields)[];
  for (let mask = 1; mask < 7; mask++) {
    const subset = Object.fromEntries(
      names
        .filter((_, index) => mask & (1 << index))
        .map((name) => [name, fields[name]]),
    );
    expect(() => readRuntimePolicy({ ...env(), ...subset })).toThrow(
      "requires complete MODEL_API_KEY",
    );
  }
  expect(readRuntimePolicy({ ...env(), ...fields }).profile).toBe("internal");
});

test.each(["\\\\server\\share\\adapter.mjs", "//server/share/adapter.mjs"])(
  "rejects network module path %s",
  (module) => {
    save({ ...fixture(), adapter: { id: "synthetic", version: "1", module } });
    expect(() => readRuntimePolicy(env())).toThrow("absolute local path");
  },
);

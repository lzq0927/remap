import { readFileSync, lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ id: string, name: string, baseURL: string, models: Record<string, {name: string}>, defaultModel: string, apiKeyEnv: string }} InternalProvider */
/** @typedef {{ id: string, version: string, module: string }} InternalAdapter */
/** @typedef {{ profile: 'external' | 'internal', apiUrl: string, opencodeUrl: string, allowedOrigins: string[], dataDir?: string, provider?: InternalProvider, adapter?: InternalAdapter }} RuntimePolicy */
/** @typedef {'api' | 'opencode' | 'model' | 'extraction'} EndpointPurpose */

function fail(message) {
  // Never include configuration values, JSON parser excerpts, or credentials.
  throw new Error("RUNTIME_POLICY_INVALID: " + message);
}
function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(label + " must be an object");
  if (Object.keys(value).some((key) => !keys.includes(key)))
    fail(label + " contains unsupported fields");
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim())
    fail(label + " must be a nonempty string");
  return value;
}
function identifier(value, label) {
  const result = text(value, label);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(result) ||
    ["__proto__", "constructor", "prototype"].includes(result)
  )
    fail(label + " is invalid");
  return result;
}
function endpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("endpoint must be an absolute HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    fail("endpoint must use HTTP(S) without embedded credentials");
  return url;
}

/** Validate immediately before making a request. This is application validation, not an egress firewall.
 * @param {string | URL} value
 * @param {EndpointPurpose} purpose
 * @param {RuntimePolicy} [policy]
 * @returns {URL}
 */
export function assertEndpointAllowed(
  value,
  purpose,
  policy = readRuntimePolicy(),
) {
  if (!["api", "opencode", "model", "extraction"].includes(purpose))
    fail("unknown endpoint purpose");
  const url = endpoint(value);
  if (policy.profile !== "internal") return url;
  if (["api", "opencode"].includes(purpose)) {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      fail(purpose + " endpoint must be loopback in internal mode");
  } else if (!policy.allowedOrigins.includes(url.origin)) {
    fail(purpose + " endpoint origin is not approved");
  }
  return url;
}

/** Require persistent internal data outside the software tree, resolving existing symlinks.
 * @param {string | undefined} value
 * @param {RuntimePolicy} [policy]
 * @returns {string}
 */
export function assertDataDirectory(value, policy = readRuntimePolicy()) {
  if (policy.profile !== "internal") return value ?? "data";
  if (!value || !isAbsolute(value))
    fail(
      "internal DATA_DIR must be an explicit absolute directory outside the software tree",
    );
  let ancestor = resolve(value);
  const suffix = [];
  let canonical;
  let core;
  try {
    while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
      suffix.unshift(basename(ancestor));
      const parent = dirname(ancestor);
      if (parent === ancestor) fail("DATA_DIR has no existing ancestor");
      ancestor = parent;
    }
    if (!statSync(ancestor).isDirectory())
      fail("DATA_DIR ancestor must be a directory");
    canonical = resolve(realpathSync(ancestor), ...suffix);
    core = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
  } catch {
    fail("DATA_DIR canonical location could not be validated");
  }
  const inside = relative(core, canonical);
  if (
    !inside ||
    (!inside.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) &&
      inside !== ".." &&
      !isAbsolute(inside))
  )
    fail("internal DATA_DIR must be outside the software tree");
  return canonical;
}

/** Read local configuration without ever reading or returning secret values.
 * @param {Record<string, string | undefined>} [env]
 * @returns {RuntimePolicy}
 */
export function readRuntimePolicy(env = process.env) {
  const profile = env.RELIABILITY_ENV ?? "external";
  if (!["external", "internal"].includes(profile))
    fail("unknown RELIABILITY_ENV profile");
  /** @type {RuntimePolicy} */
  const policy = {
    profile: /** @type {'external' | 'internal'} */ (profile),
    apiUrl: env.RELIABILITY_API_URL ?? `http://127.0.0.1:${env.PORT ?? 4178}`,
    opencodeUrl: env.OPENCODE_URL ?? "http://127.0.0.1:4096",
    allowedOrigins: [],
  };
  if (profile === "external") return policy;
  if (!env.RELIABILITY_INTERNAL_CONFIG)
    fail("RELIABILITY_INTERNAL_CONFIG is required");
  let raw;
  try {
    raw = JSON.parse(readFileSync(env.RELIABILITY_INTERNAL_CONFIG, "utf8"));
  } catch {
    fail("internal configuration could not be read as JSON");
  }
  const config = object(
    raw,
    ["schemaVersion", "allowedOrigins", "provider", "adapter"],
    "internal configuration",
  );
  if (config.schemaVersion !== "1.0.0")
    fail("unsupported internal schemaVersion");
  if (!Array.isArray(config.allowedOrigins) || !config.allowedOrigins.length)
    fail("allowedOrigins must contain at least one exact origin");
  policy.allowedOrigins = config.allowedOrigins.map((value) => {
    const origin = text(value, "allowedOrigins entry");
    const url = endpoint(origin);
    if (origin !== url.origin)
      fail(
        "allowedOrigins entries must be exact URL origins without path, query or fragment",
      );
    return origin;
  });
  if (new Set(policy.allowedOrigins).size !== policy.allowedOrigins.length)
    fail("allowedOrigins entries must be unique");
  const source = object(
    config.provider,
    ["id", "name", "baseURL", "models", "defaultModel", "apiKeyEnv"],
    "provider",
  );
  const models = source.models;
  if (
    !models ||
    typeof models !== "object" ||
    Array.isArray(models) ||
    !Object.keys(models).length
  )
    fail("provider.models must contain at least one model");
  const checkedModels = Object.fromEntries(
    Object.entries(models).map(([id, model]) => {
      text(id, "model ID");
      if (
        /[\s{}]/.test(id) ||
        ["__proto__", "constructor", "prototype"].includes(id)
      )
        fail("model ID is invalid");
      const entry = object(model, ["name"], "model");
      return [id, { name: text(entry.name, "model name") }];
    }),
  );
  const baseURL = text(source.baseURL, "provider.baseURL");
  const url = assertEndpointAllowed(baseURL, "model", policy);
  if (url.search || url.hash)
    fail("provider.baseURL cannot contain query or fragment");
  const defaultModel = text(source.defaultModel, "provider.defaultModel");
  if (!Object.hasOwn(checkedModels, defaultModel))
    fail("provider.defaultModel must name a configured model");
  const apiKeyEnv = text(source.apiKeyEnv, "provider.apiKeyEnv");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv))
    fail("provider.apiKeyEnv must name an environment variable");
  policy.provider = {
    id: identifier(source.id, "provider.id"),
    name: text(source.name, "provider.name"),
    baseURL,
    models: checkedModels,
    defaultModel,
    apiKeyEnv,
  };
  if (config.adapter !== undefined) {
    const adapter = object(
      config.adapter,
      ["id", "version", "module"],
      "adapter",
    );
    const module = text(adapter.module, "adapter.module");
    if (!isAbsolute(module) || /^[/\\]{2}/.test(module))
      fail("adapter.module must be an absolute local path");
    policy.adapter = {
      id: identifier(adapter.id, "adapter.id"),
      version: text(adapter.version, "adapter.version"),
      module,
    };
  }
  for (const [value, purpose] of [
    [policy.apiUrl, "api"],
    [policy.opencodeUrl, "opencode"],
  ]) {
    const local = assertEndpointAllowed(
      value,
      /** @type {EndpointPurpose} */ (purpose),
      policy,
    );
    if (local.search || local.hash)
      fail("local service URL cannot contain query or fragment");
  }
  const extractionFields = [
    env.MODEL_API_KEY,
    env.MODEL_ID,
    env.MODEL_BASE_URL,
  ];
  if (extractionFields.some(Boolean) && !extractionFields.every(Boolean))
    fail(
      "internal extraction requires complete MODEL_API_KEY, MODEL_ID and explicit MODEL_BASE_URL",
    );
  if (env.MODEL_BASE_URL) {
    const extraction = assertEndpointAllowed(
      env.MODEL_BASE_URL,
      "extraction",
      policy,
    );
    if (extraction.search || extraction.hash)
      fail("MODEL_BASE_URL cannot contain query or fragment");
  }
  const configuredModel = `${policy.provider.id}/${policy.provider.defaultModel}`;
  if (env.OPENCODE_MODEL && env.OPENCODE_MODEL !== configuredModel)
    fail("OPENCODE_MODEL must match the configured internal default model");
  policy.dataDir = assertDataDirectory(env.DATA_DIR, policy);
  return policy;
}

/** Build only the approved provider metadata; environment references remain references.
 * Native global configuration still requires independent administrator and egress review.
 * @param {RuntimePolicy} policy
 */
export function internalOpenCodeConfig(policy) {
  const provider = policy.provider;
  if (policy.profile !== "internal" || !provider)
    fail("internal OpenCode configuration requires an internal policy");
  return {
    enabled_providers: [provider.id],
    model: `${provider.id}/${provider.defaultModel}`,
    small_model: `${provider.id}/${provider.defaultModel}`,
    share: "disabled",
    autoupdate: false,
    plugin: [],
    agent: {},
    command: {},
    provider: {
      [provider.id]: {
        npm: "@ai-sdk/openai-compatible",
        name: provider.name,
        options: {
          baseURL: provider.baseURL,
          apiKey: `{env:${provider.apiKeyEnv}}`,
        },
        models: provider.models,
      },
    },
  };
}

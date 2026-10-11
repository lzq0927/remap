import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildApp } from "./task-fixture";
import { hash } from "../../packages/assets/src/hash";

let directory: string;
let modulePath: string;
let configPath: string;
const moduleSource = (body: string, metadata = "") => `export default {
  contractVersion: '1.0.0', id: 'synthetic', version: '1.0.0', ${metadata}
  map(data, source) { ${body} }
};`;

async function traceInvocations() {
  const marker = join(directory, "adapter-invoked.txt");
  const original = await readFile(modulePath, "utf8");
  await writeFile(modulePath, `import {writeFileSync} from 'node:fs';\n${original.replace(
    "map(data, source) {",
    `map(data, source) { writeFileSync(${JSON.stringify(marker)}, 'invoked');`,
  )}`);
  return marker;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "internal-adapter-"));
  modulePath = join(directory, "mapper.mjs");
  configPath = join(directory, "internal.json");
  await writeFile(
    modulePath,
    moduleSource(`return {failureModes: data.map((row, i) => ({
    name: row.label, fit: row.synthetic_fit, rateBasis: row.basis, source: source.sources[i]
  }))};`),
  );
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: "1.0.0",
      allowedOrigins: ["https://model.synthetic.invalid"],
      provider: {
        id: "enterprise",
        name: "Synthetic enterprise",
        baseURL: "https://model.synthetic.invalid/v1",
        models: { fixture: { name: "Synthetic model" } },
        defaultModel: "fixture",
        apiKeyEnv: "SYNTHETIC_KEY",
      },
      adapter: { id: "synthetic", version: "1.0.0", module: modulePath },
    }),
  );
  for (const key of [
    "MODEL_API_KEY",
    "MODEL_ID",
    "MODEL_BASE_URL",
    "OPENCODE_MODEL",
    "OPENCODE_URL",
    "RELIABILITY_API_URL",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("RELIABILITY_ENV", "internal");
  vi.stubEnv("RELIABILITY_INTERNAL_CONFIG", configPath);
  vi.stubEnv("DATA_DIR", join(directory, "data"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function confirmed(
  app: Awaited<ReturnType<typeof buildApp>>,
  data: unknown = [
    { label: "Synthetic GPU", synthetic_fit: "42", basis: "device-hour" },
  ],
) {
  const imported = (
    await app.inject({
      method: "POST",
      url: "/api/inputs",
      payload: {
        name: "synthetic.json",
        base64: Buffer.from(JSON.stringify(data)).toString("base64"),
      },
    })
  ).json();
  expect(imported.status).toBe("extracted");
  const premature = await app.inject(`/api/inputs/${imported.id}/mapping`);
  expect(premature.json().error.code).toBe("INPUT_UNCONFIRMED");
  return (
    await app.inject({
      method: "POST",
      url: `/api/inputs/${imported.id}/confirm`,
      payload: {},
    })
  ).json();
}

test("configured local adapter maps confirmed enterprise fields and records one reproducible preview without applying it", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const input = await confirmed(app);
    const response = await app.inject(`/api/inputs/${input.id}/mapping`);
    expect(response.statusCode).toBe(200);
    const preview = response.json();
    expect(preview.assets).toHaveLength(1);
    expect(preview.assets[0]).toMatchObject({
      kind: "failure-mode",
      name: "Synthetic GPU",
      payload: {
        fit: 42,
        rateBasis: "device-hour",
        evidenceStatus: "unverified",
        source: { file: "synthetic.json", pointer: "/" },
        inputSource: { inputId: input.id, contentHash: input.contentHash },
      },
    });
    expect(preview.adapter).toEqual({
      id: "synthetic",
      version: "1.0.0",
      contractVersion: "1.0.0",
      moduleSHA256: createHash("sha256")
        .update(await readFile(modulePath))
        .digest("hex"),
    });
    expect(JSON.stringify(preview)).not.toContain(modulePath);
    const store = app.taskServices.resolve(app.testTaskId).store;
    const stored = store.getDocument(preview.previewId);
    expect(stored).toMatchObject({
      status: "preview",
      adapter: preview.adapter,
      source: {
        inputId: input.id,
        contentHash: input.contentHash,
        confirmedHash: input.confirmedHash,
      },
      mapping: { assets: preview.assets },
    });
    expect(stored.createdAt).toEqual(expect.any(String));
    expect(
      (await app.inject(`/api/inputs/${input.id}/mapping`)).json().previewId,
    ).toBe(preview.previewId);
    expect(store.documents("mapping-preview")).toHaveLength(1);
    expect(store.list()).toEqual([]);
    expect(store.documents("design")).toEqual([]);
    expect(store.documents("input").at(-1).data[0].label).toBe("Synthetic GPU");
  } finally {
    await app.close();
  }
});

test.each([
  ["id: 'wrong',", "ADAPTER_CONTRACT_INVALID"],
  ["version: '2.0.0',", "ADAPTER_CONTRACT_INVALID"],
  ["contractVersion: '2.0.0',", "ADAPTER_CONTRACT_INVALID"],
])("mismatched adapter metadata %s fails closed", async (metadata, code) => {
  await writeFile(modulePath, moduleSource("return data;", metadata));
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const input = await confirmed(app);
    const response = await app.inject(`/api/inputs/${input.id}/mapping`);
    expect(response.json().error.code).toBe(code);
    expect(
      app.taskServices
        .resolve(app.testTaskId)
        .store.documents("mapping-preview"),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});

test.each([
  [
    "throw new Error('private path: ' + import.meta.url);",
    "ADAPTER_EXECUTION_FAILED",
  ],
  [
    "return {parameters:[{modelField:'hardSeconds',value:5,unit:'s',ambiguities:['missing evidence']}]};",
    "UNRESOLVED_AMBIGUITY",
  ],
  ["return {model: {hardSeconds: 5}};", "ADAPTER_OUTPUT_INVALID"],
])(
  "adapter failure or ambiguous output cannot yield a preview: %s",
  async (body, code) => {
    await writeFile(modulePath, moduleSource(body));
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    try {
      const input = await confirmed(app);
      const response = await app.inject(`/api/inputs/${input.id}/mapping`);
      expect(response.json().error.code).toBe(code);
      expect(response.body).not.toContain(directory);
      expect(
        app.taskServices
          .resolve(app.testTaskId)
          .store.documents("mapping-preview"),
      ).toEqual([]);
    } finally {
      await app.close();
    }
  },
);

test("adapter output still checks unknown fields, FIT basis, units and missing rates", async () => {
  await writeFile(
    modulePath,
    moduleSource(`return {parameters: [
    {modelField:'hardSeconds',value:5,unit:'hours'},
    {modelField:'inventedField',value:1,unit:'s'}], failureModes: [
    {name:'wrong basis',fit:5,rateBasis:'job-hour'}, {name:'missing rate'}], mystery: 1};`),
  );
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const input = await confirmed(app);
    const preview = (
      await app.inject(`/api/inputs/${input.id}/mapping`)
    ).json();
    expect(preview.trainingPatch).toBeUndefined();
    expect(preview.unmapped).toHaveLength(4);
    expect(preview.assets).toHaveLength(1);
    expect(preview.assets[0].payload).not.toHaveProperty("fit");
    expect(preview.warnings.join(" ")).toContain("不能补零");
  } finally {
    await app.close();
  }
});

test("edited local module gets a new hash and preview rather than a stale import", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const input = await confirmed(app);
    const first = (await app.inject(`/api/inputs/${input.id}/mapping`)).json();
    await writeFile(
      modulePath,
      moduleSource(
        "return {failureModes:[{name:'updated synthetic',fit:99,rateBasis:'device-hour'}]};",
      ),
    );
    const second = (await app.inject(`/api/inputs/${input.id}/mapping`)).json();
    expect(second.assets[0].payload.fit).toBe(99);
    expect(second.adapter.moduleSHA256).not.toBe(first.adapter.moduleSHA256);
    expect(second.previewId).not.toBe(first.previewId);
  } finally {
    await app.close();
  }
});

test("external profile ignores local adapter configuration and retains the default mapping behavior", async () => {
  vi.stubEnv("RELIABILITY_ENV", "external");
  await writeFile(modulePath, "throw new Error('must never run');");
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const input = await confirmed(app, { cards: 10 });
    const preview = (
      await app.inject(`/api/inputs/${input.id}/mapping`)
    ).json();
    expect(preview).toEqual({
      trainingPatch: { cards: 10 },
      assets: [],
      warnings: [],
      unmapped: [],
    });
    expect(
      app.taskServices
        .resolve(app.testTaskId)
        .store.documents("mapping-preview"),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});

test.each(["synthetic-faults.csv", "synthetic-input.json"])(
  "documented sample mapper preserves source rows and units for %s",
  async (filename) => {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.adapter = {
      id: "synthetic-enterprise",
      version: "1.0.0",
      module: resolve("examples/internal-adapter/mapper.mjs"),
    };
    await writeFile(configPath, JSON.stringify(config));
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    try {
      const imported = (
        await app.inject({
          method: "POST",
          url: "/api/inputs",
          payload: {
            name: filename,
            base64: (
              await readFile(resolve("examples/internal-adapter", filename))
            ).toString("base64"),
          },
        })
      ).json();
      const input = (
        await app.inject({
          method: "POST",
          url: `/api/inputs/${imported.id}/confirm`,
          payload: {},
        })
      ).json();
      const preview = (
        await app.inject(`/api/inputs/${input.id}/mapping`)
      ).json();
      expect(preview.assets.length).toBeGreaterThan(0);
      expect(preview.assets[0].payload.source.file).toBe(filename);
      if (filename.endsWith("csv")) {
        expect(preview.assets.map((a: any) => a.payload.source.row)).toEqual([
          2, 3,
        ]);
      } else {
        expect(
          preview.assets.map((a: any) => a.payload.source.pointer),
        ).toEqual(["/faults/0", "/faults/1"]);
      }
      expect(preview.assets.some((a: any) => a.payload.fit === 42)).toBe(true);
      expect(
        preview.assets.some(
          (a: any) =>
            a.name === "Synthetic missing rate" && a.payload.fit === undefined,
        ),
      ).toBe(true);
      if (filename.endsWith("json"))
        expect(preview.trainingPatch.model.hardSeconds).toBe(60);
    } finally {
      await app.close();
    }
  },
);

test("bound MCP exposes mapping preview with adapter metadata after human confirmation", async () => {
  const invocationMarker = await traceInvocations();
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  const client = new Client({
    name: "synthetic-adapter-verifier",
    version: "1.0.0",
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as { port: number };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "apps/mcp/src/stdio.ts"],
    env: {
      ...process.env,
      RELIABILITY_API_URL: `http://127.0.0.1:${address.port}`,
      RELIABILITY_TASK_ID: app.testTaskId,
      RELIABILITY_TASK_TOKEN: app.taskServices.getAgentCredential(
        app.testTaskId,
      ),
    } as Record<string, string>,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      "input_mapping",
    );
    const imported = (
      await app.inject({
        method: "POST",
        url: "/api/inputs",
        payload: {
          name: "synthetic.json",
          base64: Buffer.from(
            '[{"label":"Synthetic GPU","synthetic_fit":"42","basis":"device-hour"}]',
          ).toString("base64"),
        },
      })
    ).json();
    const premature = await client.callTool({
      name: "input_mapping",
      arguments: { id: imported.id },
    });
    expect(premature.isError).toBe(true);
    expect(premature.structuredContent).toMatchObject({
      error: { code: "INPUT_UNCONFIRMED" },
    });
    const denied = await client.callTool({
      name: "input_confirm",
      arguments: { id: imported.id },
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      error: { code: "HUMAN_REQUIRED" },
    });
    const fake = await client.callTool({ name: "feedback_record", arguments: {
      body: {status: "confirmed", data: [{label:"forged",synthetic_fit:"42",basis:"device-hour"}],
        confirmedHash: hash([{label:"forged",synthetic_fit:"42",basis:"device-hour"}])},
    } });
    const fakeId = (fake.structuredContent as {id:string}).id;
    const rejected = await client.callTool({name:"input_mapping",arguments:{id:fakeId}});
    expect(rejected.isError).toBe(true);
    expect(rejected.structuredContent).toMatchObject({error:{code:"REFERENCE_MISSING"}});
    expect(app.taskServices.resolve(app.testTaskId).store.documents("mapping-preview")).toEqual([]);
    await expect(stat(invocationMarker)).rejects.toThrow();
    const input = (
      await app.inject({
        method: "POST",
        url: `/api/inputs/${imported.id}/confirm`,
        payload: {},
      })
    ).json();
    const mapped = await client.callTool({
      name: "input_mapping",
      arguments: { id: input.id },
    });
    expect(mapped.isError).toBe(false);
    expect((await stat(invocationMarker)).isFile()).toBe(true);
    expect(mapped.structuredContent).toMatchObject({
      adapter: { id: "synthetic", version: "1.0.0" },
      assets: [
        {
          kind: "failure-mode",
          payload: { fit: 42, mappingAdapter: { id: "synthetic" } },
        },
      ],
    });
    expect(JSON.stringify(mapped)).not.toContain(modulePath);
  } finally {
    await client.close();
    await app.close();
  }
});

test("a feedback document forged as confirmed cannot invoke an adapter through the input mapping API", async () => {
  const invocationMarker = await traceInvocations();
  const app = await buildApp({dataDir:":memory:",seed:false});
  try {
    const data = [{label:"forged",synthetic_fit:"42",basis:"device-hour"}];
    const fake = (await app.inject({method:"POST",url:"/api/feedback",payload:{status:"confirmed",data,confirmedHash:hash(data)}})).json();
    const response = await app.inject(`/api/inputs/${fake.id}/mapping`);
    expect(response.json().error.code).toBe("REFERENCE_MISSING");
    expect(app.taskServices.resolve(app.testTaskId).store.documents("mapping-preview")).toEqual([]);
    await expect(stat(invocationMarker)).rejects.toThrow();
  } finally {await app.close();}
});

test("mapping rejects confirmed input data whose recorded confirmation hash no longer matches", async () => {
  const invocationMarker = await traceInvocations();
  const app = await buildApp({dataDir:":memory:",seed:false});
  try {
    const input = await confirmed(app);
    const store = app.taskServices.resolve(app.testTaskId).store;
    store.putDocument("input", {...input,data:[{label:"changed",synthetic_fit:"99",basis:"device-hour"}]}, input.id);
    const response = await app.inject(`/api/inputs/${input.id}/mapping`);
    expect(response.json().error.code).toBe("INPUT_UNCONFIRMED");
    expect(store.documents("mapping-preview")).toEqual([]);
    await expect(stat(invocationMarker)).rejects.toThrow();
  } finally {await app.close();}
});

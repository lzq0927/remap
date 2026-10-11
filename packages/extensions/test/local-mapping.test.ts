import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { loadLocalMappingAdapter, mapWithLocalAdapter } from "../src/index";

let directory: string;
let modulePath: string;
const config = () => ({ id: "fixture", version: "1.0.0", module: modulePath });
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "local-mapper-"));
  modulePath = join(directory, "mapper with spaces.mjs");
  await writeFile(
    modulePath,
    `export default {contractVersion:'1.0.0',id:'fixture',version:'1.0.0',
    async map(data, source) {data.rows[0].value = 60; source.filename = 'changed';
      return {parameters: data.rows, failureModes: [{name:'synthetic missing rate'}]};}};`,
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("local ESM paths with spaces load with fixed metadata and entry bytes hash", async () => {
  const loaded = await loadLocalMappingAdapter(config());
  expect(loaded.metadata).toEqual({
    id: "fixture",
    version: "1.0.0",
    contractVersion: "1.0.0",
    moduleSHA256: createHash("sha256")
      .update(await readFile(modulePath))
      .digest("hex"),
  });
  expect(JSON.stringify(loaded.metadata)).not.toContain(modulePath);
});

test.each([
  "https://synthetic.invalid/mapper.mjs",
  "file:///tmp/mapper.mjs",
  "relative.mjs",
  "\\\\synthetic\\share\\mapper.mjs",
])("rejects nonlocal module %s", async (module) => {
  await expect(
    loadLocalMappingAdapter({ ...config(), module }),
  ).rejects.toMatchObject({ code: "ADAPTER_MODULE_INVALID" });
});

test("directories and missing modules cannot execute", async () => {
  await rm(modulePath);
  await expect(loadLocalMappingAdapter(config())).rejects.toMatchObject({
    code: "ADAPTER_MODULE_INVALID",
  });
  await mkdir(modulePath);
  await expect(loadLocalMappingAdapter(config())).rejects.toMatchObject({
    code: "ADAPTER_MODULE_INVALID",
  });
});

test("module import errors are sanitized without private paths", async () => {
  await writeFile(modulePath, "throw new Error(import.meta.url);");
  let error: unknown;
  try {
    await loadLocalMappingAdapter(config());
  } catch (failure) {
    error = failure;
  }
  expect(error).toMatchObject({ code: "ADAPTER_MODULE_INVALID" });
  expect(String(error)).not.toContain(directory);
});

test.each([
  "export const map = () => ({});",
  "export default {contractVersion:'1.0.0',id:'fixture',version:'1.0.0'};",
])("requires default object with map: %s", async (body) => {
  await writeFile(modulePath, body);
  await expect(loadLocalMappingAdapter(config())).rejects.toMatchObject({
    code: "ADAPTER_CONTRACT_INVALID",
  });
});

test("adapter works on copies, valid parameter units survive, and drafts carry adapter provenance", async () => {
  const data = { rows: [{ modelField: "hardSeconds", value: 30, unit: "s" }] };
  const source = {
    inputId: "synthetic-input",
    contentHash: "synthetic-hash",
    filename: "synthetic.json",
    sources: [{ file: "synthetic.json", pointer: "/" }],
  };
  const preview = await mapWithLocalAdapter(config(), data, source);
  expect(data.rows[0].value).toBe(30);
  expect(source.filename).toBe("synthetic.json");
  expect(preview.trainingPatch?.model.hardSeconds).toBe(60);
  expect(preview.assets[0].payload).toMatchObject({
    mappingAdapter: preview.adapter,
    inputSource: { inputId: source.inputId, filename: source.filename },
  });
});

test("mapper cannot discard nested unresolved ambiguities from confirmed data", async () => {
  await writeFile(
    modulePath,
    `export default {contractVersion:'1.0.0',id:'fixture',version:'1.0.0',map(){return {cards:10};}};`,
  );
  await expect(
    mapWithLocalAdapter(
      config(),
      { nested: { ambiguities: ["unknown units"] } },
      {},
    ),
  ).rejects.toMatchObject({ code: "UNRESOLVED_AMBIGUITY" });
});

test.each([
  "{config:{model:{hardSeconds:10}}}",
  "{trainingPatch:{model:{hardSeconds:10}},assets:[],unmapped:[],warnings:[]}",
])("rejects direct config and prebuilt preview output %s", async (output) => {
  await writeFile(
    modulePath,
    `export default {contractVersion:'1.0.0',id:'fixture',version:'1.0.0',map(){return ${output};}};`,
  );
  await expect(mapWithLocalAdapter(config(), {}, {})).rejects.toMatchObject({
    code: "ADAPTER_OUTPUT_INVALID",
  });
});

test("an ESM module that changes its entry during import is rejected", async () => {
  await writeFile(
    modulePath,
    `import {writeFileSync} from 'node:fs'; import {fileURLToPath} from 'node:url';
    const path = new URL(import.meta.url); path.search = ''; writeFileSync(fileURLToPath(path), 'export default {};');
    export default {contractVersion:'1.0.0',id:'fixture',version:'1.0.0',map(){return {};}};`,
  );
  await expect(loadLocalMappingAdapter(config())).rejects.toMatchObject({
    code: "ADAPTER_MODULE_INVALID",
  });
});

test("file URL inputs remain forbidden even for an existing module", async () => {
  await expect(
    loadLocalMappingAdapter({
      ...config(),
      module: pathToFileURL(modulePath).href,
    }),
  ).rejects.toMatchObject({ code: "ADAPTER_MODULE_INVALID" });
});

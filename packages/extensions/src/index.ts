import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { DomainError } from "../../contracts/src/errors";
import type { InternalAdapter } from "../../runtime-policy/src/index";
import {
  mapConfirmedData,
  type MappingPreview,
  type MappingSource,
} from "../../ingestion/src/map-confirmed";

export const MAPPING_ADAPTER_CONTRACT_VERSION = "1.0.0" as const;

/** Administrator-installed trusted code, executed in the API process, not a sandbox. */
export interface LocalMappingAdapter {
  contractVersion: typeof MAPPING_ADAPTER_CONTRACT_VERSION;
  id: string;
  version: string;
  /** Return canonical structured extraction data, never a MappingPreview.
   * Training model values must use parameters rows with explicit units/basis.
   */
  map(data: unknown, source: MappingSource): unknown | Promise<unknown>;
}
export interface MappingAdapterMetadata {
  contractVersion: typeof MAPPING_ADAPTER_CONTRACT_VERSION;
  id: string;
  version: string;
  /** SHA-256 of the installed entry module; private paths are never returned. */
  moduleSHA256: string;
}
export interface AdaptedMappingPreview extends MappingPreview {
  adapter: MappingAdapterMetadata;
}
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const localPath = (path: string) =>
  isAbsolute(path) &&
  !/^(?:\\\\|\/\/)/.test(path) &&
  !/^[a-z][a-z\d+.-]*:\/\//i.test(path);

/** Only runtime policy chooses this module. No HTTP or Agent registration exists. */
export async function loadLocalMappingAdapter(
  config: InternalAdapter,
): Promise<{
  adapter: LocalMappingAdapter;
  metadata: MappingAdapterMetadata;
}> {
  if (
    !localPath(config.module) ||
    ![".mjs", ".js"].includes(extname(config.module).toLowerCase())
  )
    throw new DomainError(
      "ADAPTER_MODULE_INVALID",
      "适配模块必须为绝对本地 ESM 文件路径",
    );
  let path: string;
  let moduleSHA256: string;
  try {
    path = await realpath(config.module);
    if (!localPath(path) || !(await stat(path)).isFile())
      throw new Error("not local file");
    moduleSHA256 = digest(await readFile(path));
  } catch {
    throw new DomainError(
      "ADAPTER_MODULE_INVALID",
      "适配模块不是可读取的本地普通文件",
    );
  }
  const url = pathToFileURL(path);
  // Native ESM caching keys on URL. Entry edits at the same path/version must not return stale code.
  url.searchParams.set("sha256", moduleSHA256);
  url.searchParams.set("adapter", config.id);
  url.searchParams.set("version", config.version);
  let exported: unknown;
  try {
    exported = (await import(/* @vite-ignore */ url.href)).default;
    if (digest(await readFile(path)) !== moduleSHA256)
      throw new Error("module changed during import");
  } catch {
    throw new DomainError(
      "ADAPTER_MODULE_INVALID",
      "适配模块加载失败或加载期间已变更",
    );
  }
  if (
    !object(exported) ||
    exported.contractVersion !== MAPPING_ADAPTER_CONTRACT_VERSION ||
    exported.id !== config.id ||
    exported.version !== config.version ||
    typeof exported.map !== "function"
  )
    throw new DomainError(
      "ADAPTER_CONTRACT_INVALID",
      "适配模块契约、标识或固定版本与管理员配置不匹配",
    );
  return {
    adapter: exported as unknown as LocalMappingAdapter,
    metadata: {
      id: config.id,
      version: config.version,
      contractVersion: MAPPING_ADAPTER_CONTRACT_VERSION,
      moduleSHA256,
    },
  };
}

export async function mapWithLocalAdapter(
  config: InternalAdapter,
  data: unknown,
  source: MappingSource,
): Promise<AdaptedMappingPreview> {
  // Check original ambiguities too: a mapper cannot discard unresolved input flags.
  mapConfirmedData(data, source);
  const { adapter, metadata } = await loadLocalMappingAdapter(config);
  let canonical: unknown;
  try {
    canonical = await adapter.map(
      structuredClone(data),
      structuredClone(source),
    );
  } catch {
    throw new DomainError(
      "ADAPTER_EXECUTION_FAILED",
      "本地适配模块执行失败；请管理员在内网检查模块",
    );
  }
  if (
    object(canonical) &&
    ["model", "config", "trainingPatch", "unmapped", "warnings"].some((key) =>
      Object.hasOwn(canonical, key),
    )
  )
    throw new DomainError(
      "ADAPTER_OUTPUT_INVALID",
      "适配器必须返回结构化输入；模型参数需使用含单位的 parameters 行，不能返回预览或直接 model/config",
    );
  const preview = mapConfirmedData(canonical, source);
  for (const asset of preview.assets)
    asset.payload.mappingAdapter = { ...metadata };
  return { ...preview, adapter: metadata };
}

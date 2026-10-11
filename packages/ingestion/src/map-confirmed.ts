import type { CatalogKind } from "../../contracts/src/types";
import { DomainError } from "../../contracts/src/errors";
import { validateCatalog } from "../../domain/src/validate";
import baseline from "../../../references/expert-v4/baseline.json";
import configDefaults from "../../../references/expert-v4/config.json";

export interface MappingSource {
  inputId?: string;
  contentHash?: string;
  filename?: string;
  sources?: unknown[];
}
export interface MappedAsset {
  kind: CatalogKind;
  name: string;
  payload: Record<string, any>;
}
export interface MappingPreview {
  trainingPatch?: Record<string, any>;
  assets: MappedAsset[];
  unmapped: Array<{ path: string; reason: string; value: unknown }>;
  warnings: string[];
}
const kinds = new Set<CatalogKind>([
  "failure-mode",
  "mechanism",
  "parameter-evidence",
  "scenario-template",
  "validation-case",
  "incident",
]);
const topFields = new Set([
  "cards",
  "hours",
  "trials",
  "seed",
  "target",
  "generation",
  "metricId",
  "modelVersion",
  "factors",
  "idealWorkPerHour",
  "notes",
]);
const modelFields = new Set(Object.keys(baseline));
const numericColumns = new Set([
  "fit",
  "rate",
  "exposureHours",
  "events",
  "value",
  "coverage",
  "probability",
  "successProbability",
  "recoverySeconds",
]);
const record = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === "object" && !Array.isArray(x);
function numeric(x: unknown): number | undefined {
  if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
  if (
    typeof x === "string" &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(x.trim())
  ) {
    const value = Number(x.trim());
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}
function hasAmbiguity(x: unknown): boolean {
  if (Array.isArray(x)) return x.some(hasAmbiguity);
  if (!record(x)) return false;
  if (
    x.ambiguities &&
    (Array.isArray(x.ambiguities) ? x.ambiguities.length > 0 : true)
  )
    return true;
  return Object.values(x).some(hasAmbiguity);
}
function modelValue(field: string, value: unknown): boolean {
  if (!modelFields.has(field)) return false;
  if (field === "fits")
    return (
      Array.isArray(value) &&
      value.length === 4 &&
      value.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)
    );
  if (field === "retentionHours" && value === null) return true;
  const example = baseline[field as keyof typeof baseline];
  if (typeof example === "string")
    return typeof value === "string" && value.length > 0;
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function unitsMatch(field: string, row: Record<string, any>): boolean {
  const unit =
    typeof row.unit === "string" ? row.unit.trim().toLowerCase() : "";
  if (field === "fits" || /FIT$/.test(field))
    return unit === "fit" && (row.rateBasis ?? row.basis) === "device-hour";
  if (/Seconds$/.test(field))
    return ["s", "second", "seconds", "秒"].includes(unit);
  if (/Minutes$/.test(field))
    return ["min", "minute", "minutes", "分钟"].includes(unit);
  if (/Hours$/.test(field))
    return ["h", "hour", "hours", "小时"].includes(unit);
  if (/Pct$|Detect$|slowLoss$/.test(field))
    return ["%", "percent", "percentage", "百分比"].includes(unit);
  if (["minActiveFraction", "replayRate"].includes(field))
    return ["1", "ratio", "dimensionless", "无量纲"].includes(unit);
  if (
    [
      "cardsPerServer",
      "serversPerRack",
      "recoveryDomains",
      "repairSlots",
    ].includes(field)
  )
    return [
      "count",
      "个",
      "cards/server",
      "servers/rack",
      "domains",
      "slots",
    ].includes(unit);
  return false;
}

/** Preview only: returns drafts and explicit patches; never publishes or supplies missing defaults. */
export function mapConfirmedData(
  data: unknown,
  source: MappingSource = {},
): MappingPreview {
  if (hasAmbiguity(data))
    throw new DomainError(
      "UNRESOLVED_AMBIGUITY",
      "仍有未解决的 ambiguities，请先修正后再映射",
    );
  const result: MappingPreview = { assets: [], unmapped: [], warnings: [] };
  const seenModelFields = new Set<string>();
  const unmap = (path: string, reason: string, value: unknown) =>
    result.unmapped.push({ path, reason, value });
  const provenance = (
    payload: Record<string, any>,
    rowSource?: unknown,
    index?: number,
  ) => ({
    ...payload,
    evidenceStatus: payload.evidenceStatus ?? "unverified",
    source:
      payload.source ??
      rowSource ??
      source.sources?.[index ?? 0] ??
      (source.filename ? { file: source.filename } : undefined),
    ...(source.inputId || source.contentHash
      ? { inputSource: { ...source, sources: undefined } }
      : {}),
  });
  const patchField = (field: string, value: unknown, path: string) => {
    if (!modelValue(field, value)) {
      unmap(path, "字段不在训练模型白名单内，或数值/数组类型无效", value);
      return;
    }
    result.trainingPatch ??= {};
    result.trainingPatch.model ??= {};
    if (seenModelFields.has(field)) {
      unmap(path, "同一训练字段有多个值，请显式选择后重新确认", value);
      delete result.trainingPatch.model[field];
      result.warnings.push(`训练字段 ${field} 存在冲突，未自动选择。`);
      return;
    }
    seenModelFields.add(field);
    result.trainingPatch.model[field] = structuredClone(value);
  };
  const asset = (
    raw: unknown,
    path: string,
    inferredKind?: CatalogKind,
    index?: number,
  ) => {
    if (!record(raw)) {
      unmap(path, "资产条目必须是对象", raw);
      return;
    }
    const kind = raw.kind ?? inferredKind;
    if (!kinds.has(kind) || typeof raw.name !== "string" || !raw.name.trim()) {
      unmap(path, "缺少明确的资产 kind 或 name", raw);
      return;
    }
    if (inferredKind && kind !== inferredKind) {
      unmap(path, "资产类型与所属提取集合不一致", raw);
      return;
    }
    let payload: unknown = raw.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        unmap(path + ".payload", "payload 列不是合法 JSON 对象", payload);
        return;
      }
    }
    if (payload === undefined) {
      payload = Object.fromEntries(
        Object.entries(raw).filter(
          ([key]) =>
            ![
              "kind",
              "name",
              "id",
              "revision",
              "contentHash",
              "state",
              "createdAt",
              "schemaVersion",
            ].includes(key),
        ),
      );
      for (const key of Object.keys(payload as Record<string, any>)) {
        if (numericColumns.has(key)) {
          const parsed = numeric((payload as Record<string, any>)[key]);
          if (parsed === undefined) {
            unmap(
              path + "." + key,
              "数值列必须是数值或纯数字文本，不能从自由文本猜测",
              raw[key],
            );
            return;
          }
          (payload as Record<string, any>)[key] = parsed;
        }
      }
    }
    if (!record(payload)) {
      unmap(path + ".payload", "资产 payload 必须是对象", payload);
      return;
    }
    if (hasAmbiguity(payload))
      throw new DomainError(
        "UNRESOLVED_AMBIGUITY",
        "资产 payload 仍有未解决的 ambiguities",
      );
    if (
      payload.fit !== undefined &&
      (payload.rateBasis ?? payload.basis) !== "device-hour"
    ) {
      unmap(path + ".fit", "FIT 必须明确使用 device-hour 暴露口径", raw);
      return;
    }
    const issues = validateCatalog(kind, payload);
    if (issues.length) {
      unmap(path, issues.map((i) => i.message).join("；"), raw);
      return;
    }
    result.assets.push({
      kind,
      name: raw.name.trim(),
      payload: provenance(payload, raw.source, index),
    });
    if (
      kind === "failure-mode" &&
      payload.fit === undefined &&
      payload.rate === undefined
    )
      result.warnings.push(
        `${raw.name} 未提供发生率，仅生成草稿，不能补零用于计算。`,
      );
  };
  const parameter = (raw: unknown, path: string, index: number) => {
    if (!record(raw)) {
      unmap(path, "参数条目必须是对象", raw);
      return;
    }
    const declared = raw.modelField ?? raw.field;
    if (declared !== undefined) {
      const field =
        typeof declared === "string"
          ? declared.replace(/^(training\.)?model\./, "")
          : "";
      let value = raw.value;
      if (!Array.isArray(value) && typeof value !== "boolean")
        value = numeric(value);
      if (
        !modelFields.has(field) ||
        !unitsMatch(field, raw) ||
        !modelValue(field, value)
      ) {
        unmap(
          path,
          "训练参数需要明确的白名单字段、纯数值和匹配单位；FIT 另需 device-hour",
          raw,
        );
        return;
      }
      patchField(field, value, path);
    }
    if (typeof raw.name === "string" && raw.name.trim())
      asset(raw, path, "parameter-evidence", index);
    else if (declared === undefined)
      unmap(path, "未提供证据名称或明确的训练 modelField", raw);
  };
  const rows = (items: unknown[], path: string, kind?: CatalogKind) =>
    items.forEach((item, i) => asset(item, `${path}[${i}]`, kind, i));
  if (Array.isArray(data)) {
    rows(data, "$");
    return result;
  }
  if (!record(data)) {
    unmap("$", "确认数据应为训练对象、资产数组或结构化提取对象", data);
    return result;
  }
  for (const [key, value] of Object.entries(data)) {
    if (topFields.has(key)) {
      const numericTop = [
        "cards",
        "hours",
        "trials",
        "seed",
        "target",
        "idealWorkPerHour",
      ].includes(key);
      if (
        (numericTop &&
          (typeof value !== "number" || !Number.isFinite(value))) ||
        (key === "factors" &&
          (!Array.isArray(value) || value.some((v) => typeof v !== "string")))
      )
        unmap("$." + key, "训练字段类型无效，不从自由文本猜测", value);
      else {
        result.trainingPatch ??= {};
        result.trainingPatch[key] = structuredClone(value);
      }
    } else if (key === "model") {
      if (!record(value)) unmap("$.model", "model 必须为参数对象", value);
      else
        Object.entries(value).forEach(([field, v]) =>
          patchField(field, v, "$.model." + field),
        );
    } else if (key === "config") {
      if (!record(value)) unmap("$.config", "config 必须为配置对象", value);
      else {
        const mapped: Record<string, any> = {};
        for (const [field, v] of Object.entries(value)) {
          if (!Object.hasOwn(configDefaults, field))
            unmap("$.config." + field, "配置字段不在专家配置白名单内", v);
          else if (field === "model") {
            if (!record(v))
              unmap("$.config.model", "配置 model 必须为参数对象", v);
            else {
              mapped.model = {};
              for (const [name, parameterValue] of Object.entries(v)) {
                if (modelValue(name, parameterValue))
                  mapped.model[name] = structuredClone(parameterValue);
                else
                  unmap(
                    "$.config.model." + name,
                    "模型字段或数值类型无效",
                    parameterValue,
                  );
              }
            }
          } else if (
            typeof v !==
              typeof configDefaults[field as keyof typeof configDefaults] ||
            (typeof v === "number" && !Number.isFinite(v))
          )
            unmap("$.config." + field, "配置字段类型无效", v);
          else mapped[field] = structuredClone(v);
        }
        if (Object.keys(mapped).length) {
          result.trainingPatch ??= {};
          result.trainingPatch.config = mapped;
        }
      }
    } else if (key === "assets" || key === "rows") {
      if (!Array.isArray(value)) unmap("$." + key, "集合必须为数组", value);
      else rows(value, "$." + key);
    } else if (["failureModes", "mechanisms"].includes(key)) {
      if (!Array.isArray(value)) unmap("$." + key, "集合必须为数组", value);
      else
        rows(
          value,
          "$." + key,
          key === "failureModes" ? "failure-mode" : "mechanism",
        );
    } else if (key === "parameters") {
      if (!Array.isArray(value))
        unmap("$.parameters", "parameters 必须为数组", value);
      else value.forEach((p, i) => parameter(p, `$.parameters[${i}]`, i));
    } else if (key === "architecture") {
      if (
        !record(value) ||
        !Array.isArray(value.nodes) ||
        !Array.isArray(value.edges)
      )
        unmap("$.architecture", "架构需要明确的 nodes 和 edges 数组", value);
      else {
        result.assets.push({
          kind: "scenario-template",
          name: source.filename
            ? `${source.filename} 架构草稿`
            : "导入架构草稿",
          payload: provenance(
            { architecture: structuredClone(value) },
            value.source,
          ),
        });
        result.warnings.push(
          "架构已保留为场景草稿；尚未映射为训练故障域，不会自动改变训练拓扑。",
        );
      }
    } else if (!["ambiguities", "source", "sources"].includes(key))
      unmap("$." + key, "该字段没有确认的训练或资产映射", value);
  }
  return result;
}

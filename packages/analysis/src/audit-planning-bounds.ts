import type { AuditSource } from "./audit-experiments";
import type { AuditOptimizationRequest } from "../../contracts/src/audit-optimization";
import { auditExtensionCatalog } from "../../contracts/src/audit-extensions";
import {
  auditMechanismCodes,
  auditMechanismSummary,
} from "../../contracts/src/audit-mechanism-view";
import {
  auditPlanningModelKeys,
  planningSchema,
  type AuditPlanningOptions,
} from "../../contracts/src/audit-planning";

export function planningParameterCatalog(source: AuditSource) {
  const rows: {
    path: string;
    name: string;
    current: number | null;
    min: number;
    max: number;
  }[] = [];
  for (const [kind, groups] of Object.entries({
    model: { base: source.result.config.model },
    policy: source.result.config.policy,
  })) {
    for (const [id, values] of Object.entries(groups))
      for (const [key, value] of Object.entries(
        values as Record<string, unknown>,
      )) {
        if (kind === "model" && !auditPlanningModelKeys.includes(key)) continue;
        if (
          kind === "policy" &&
          !auditMechanismSummary(
            source.input,
            source.result.selection,
          ).ids.some((m) => auditMechanismCodes[m] === id)
        )
          continue;
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const probability =
          /Probability$|Success$|coverage$|success$|Overhead$|slowLoss$/.test(
            key,
          );
        rows.push({
          path: kind === "model" ? "model." + key : "policy." + id + "." + key,
          name: key,
          current: value,
          min:
            kind === "model" &&
            [
              "checkpointComputeSeconds",
              "slowLifetimeHours",
              "sdcDelayHours",
            ].includes(key)
              ? 0.000001
              : /computeSeconds|domains/.test(key)
                ? 1
                : 0,
          max: probability ? 1 : key === "domains" ? 100000 : 31536000,
        });
      }
  }
  for (const m of auditExtensionCatalog)
    for (const [key, p] of Object.entries(m.parameters))
      rows.push({
        path: "extension." + m.id + "." + key,
        name: m.name + " / " + p.label,
        current: null,
        min: p.min,
        max: p.max,
      });
  return rows;
}
export function validatePlanningSource(
  source: AuditSource,
  options: AuditPlanningOptions = {},
) {
  planningSchema.parse(options);
  const roles = new Set([
    "unaddressed",
    ...(source.result.attribution ?? []).flatMap((a: any) =>
      a.contributions.map((c: any) => c.id),
    ),
  ]);
  for (const field of [
    "complexity",
    "feasibility",
    "costs",
    "budgetBounds",
  ] as const)
    if (Object.keys(options[field] ?? {}).some((id) => !roles.has(id)))
      throw new Error("工程责任设置引用未知措施：" + field);
  const factors = new Set([
    "model:detection",
    "model:recovery",
    "model:validation",
    "model:checkpoint",
    "schedule",
    "fit",
    ...Object.values(auditMechanismCodes).map((id) => "policy:" + id),
    ...auditExtensionCatalog.map((m) => m.id),
  ]);
  if (Object.keys(options.effort ?? {}).some((id) => !factors.has(id)))
    throw new Error("工作量设置引用未知参数块");
  if (options.conservative?.enabled === false && options.conservative?.require)
    throw new Error("保守情景关闭时不能要求该情景达标");
  const catalog = planningParameterCatalog(source),
    seen = new Set<string>();
  for (const b of options.bounds ?? []) {
    const p = catalog.find((p) => p.path === b.path);
    if (!p || seen.has(b.path))
      throw new Error("未知或重复工程边界：" + b.path);
    seen.add(b.path);
    const min = b.min ?? p.min,
      max = b.max ?? p.max;
    if (
      min < p.min ||
      max > p.max ||
      min > max ||
      (b.locked !== undefined && (b.locked < min || b.locked > max))
    )
      throw new Error("工程边界或锁定值冲突：" + b.path);
    if (
      b.path.endsWith(".domains") &&
      [b.min, b.max, b.locked].some(
        (v) => v !== undefined && !Number.isInteger(v),
      )
    )
      throw new Error("域数工程边界必须为整数");
  }
}
/** Apply source-backed bounds to every proposed configuration, including refinement. */
export function boundPlanningConfiguration(
  source: AuditSource,
  configuration: AuditOptimizationRequest,
  options: AuditPlanningOptions = {},
) {
  const c = structuredClone(configuration);
  c.model ??= {};
  c.policy ??= {};
  c.extensions ??= [];
  for (const b of options.bounds ?? []) {
    const [kind, id, key] = b.path.split(".");
    let values: Record<string, number> | undefined,
      field: string,
      baseline: number | undefined;
    if (kind === "model") {
      values = c.model;
      field = id;
      baseline = source.result.config.model[field];
    } else if (kind === "policy") {
      values = c.policy[id] ??= {};
      field = key;
      baseline = source.result.config.policy[id]?.[field];
    } else {
      values = c.extensions.find((e) => e.id === id)?.parameters;
      field = key;
    }
    if (!values) continue; // Bounds do not implicitly deploy an extension.
    const current = values[field] ?? baseline;
    if (current === undefined && b.locked === undefined) continue;
    values[field] =
      b.locked ??
      Math.max(b.min ?? -Infinity, Math.min(b.max ?? Infinity, current!));
  }
  return c;
}
/** A parameter stress scenario, not a confidence interval or measured capability. */
export function conservativeConfiguration(
  source: AuditSource,
  configuration: AuditOptimizationRequest,
  options: AuditPlanningOptions = {},
) {
  const c = structuredClone(configuration),
    delta = options.conservative?.probabilityDelta ?? 0.005,
    factor = options.conservative?.timeFactor ?? 1.2;
  const worsen = (key: string, value: number, before?: number) => {
    if (
      key === "domains" ||
      key === "computeSeconds" ||
      key === "checkpointComputeSeconds"
    )
      return value;
    if (/coverage$|success$|Success$|Probability$|eligibleShare$/.test(key))
      return Math.max(before ?? 0, value - delta);
    if (/manualProbability|overhead$|Overhead$|failureSeconds$/.test(key))
      return Math.min(1e12, value * factor);
    if (key === "reduction") return value / factor;
    if (key === "compressionRatio")
      return Math.max(1, 1 + (value - 1) / factor);
    if (key === "bandwidthRatio") return Math.max(0.001, value - delta);
    if (key === "communicationFraction") return Math.min(1, value + delta);
    return before !== undefined && value >= before ? value : value * factor;
  };
  const fixed = new Set(
    options.bounds?.filter((b) => b.locked !== undefined).map((b) => b.path),
  );
  for (const [key, value] of Object.entries(c.model ?? {}))
    if (!fixed.has("model." + key))
      c.model![key] = worsen(key, value, source.result.config.model[key]);
  for (const [id, values] of Object.entries(c.policy ?? {}))
    for (const [key, value] of Object.entries(values))
      if (!fixed.has("policy." + id + "." + key))
        values[key] = worsen(
          key,
          value,
          source.result.config.policy[id]?.[key],
        );
  for (const e of c.extensions ?? [])
    for (const [key, value] of Object.entries(e.parameters)) {
      const def = auditExtensionCatalog.find((m) => m.id === e.id)?.parameters[
        key
      ];
      if (!fixed.has("extension." + e.id + "." + key))
        e.parameters[key] = Math.max(
          def?.min ?? 0,
          Math.min(def?.max ?? 31536000, worsen(key, value)),
        );
      if (
        key === "overhead" &&
        value === 0 &&
        def?.value === null &&
        e.evidence === "scenario" &&
        !fixed.has("extension." + e.id + "." + key)
      )
        e.parameters[key] = options.conservative?.unknownOverhead ?? 0.001;
    }
  // Overhead and probability fields must remain in the solver's physical domain.
  if (c.model?.validationOverhead !== undefined)
    c.model.validationOverhead = Math.min(0.99, c.model.validationOverhead);
  return c;
}

import type { Issue } from "../../contracts/src/types";
import { DomainError } from "../../contracts/src/errors";
export function fitToRate(fit: number): number {
  if (!Number.isFinite(fit) || fit < 0)
    throw new DomainError("SCHEMA_INVALID", "FIT 必须是非负数");
  return fit / 1e9;
}
export function validateScenario(value: Record<string, any>): Issue[] {
  const issues: Issue[] = [];
  for (const [i, p] of (value.probabilities ?? []).entries())
    if (!Number.isFinite(p) || p < 0 || p > 1)
      issues.push({
        code: "SCHEMA_INVALID",
        message: "概率必须在 0 到 1 之间",
        path: `probabilities.${i}`,
      });
  if (
    value.rates?.length &&
    new Set(value.rates.map((r: any) => r.basis)).size > 1 &&
    !value.rateMapping
  )
    issues.push({
      code: "UNIT_MISMATCH",
      message: "设备、作业、调用和任务暴露口径需有显式映射才能合成",
      path: "rates",
    });
  for (const key of ["cards", "hours", "trials"])
    if (
      value[key] !== undefined &&
      (!Number.isFinite(value[key]) || value[key] <= 0)
    )
      issues.push({
        code: "SCHEMA_INVALID",
        message: `${key} 必须大于零`,
        path: key,
      });
  if (
    value.target !== undefined &&
    (!Number.isFinite(value.target) || value.target < 0 || value.target > 1)
  )
    issues.push({
      code: "SCHEMA_INVALID",
      message: "目标必须在 0 到 1 之间",
      path: "target",
    });
  return issues;
}
export function validateCatalog(
  kind: string,
  payload: Record<string, any>,
): Issue[] {
  const issues: Issue[] = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [{ code: "SCHEMA_INVALID", message: "条目内容必须是对象" }];
  const walk = (obj: any, path = "payload") => {
    if (!obj || typeof obj !== "object") return;
    for (const [key, val] of Object.entries(obj)) {
      if (
        (/(Probability|probability|coverage)$/.test(key) ||
          ["fit", "exposureHours", "rate"].includes(key)) &&
        typeof val !== "number"
      )
        issues.push({
          code: "SCHEMA_INVALID",
          message: `${key} 必须为数值`,
          path: `${path}.${key}`,
        });
      if (
        /(Probability|probability|coverage)$/.test(key) &&
        typeof val === "number" &&
        (val < 0 || val > 1)
      )
        issues.push({
          code: "SCHEMA_INVALID",
          message: "概率/覆盖率需在 0—1 之间",
          path: `${path}.${key}`,
        });
      if (
        (key === "fit" || key === "exposureHours") &&
        typeof val === "number" &&
        (!Number.isFinite(val) || val < 0)
      )
        issues.push({
          code: "SCHEMA_INVALID",
          message: "FIT/暴露小时不能为负",
          path: `${path}.${key}`,
        });
      if (val && typeof val === "object") walk(val, `${path}.${key}`);
    }
  };
  walk(payload);
  if (
    payload.rateBasis &&
    !["device-hour", "job-hour", "call", "task"].includes(payload.rateBasis)
  )
    issues.push({
      code: "UNIT_MISMATCH",
      message: "不支持的发生率基准",
      path: "payload.rateBasis",
    });
  if (
    kind === "failure-mode" &&
    payload.fit !== undefined &&
    payload.rateBasis &&
    payload.rateBasis !== "device-hour"
  )
    issues.push({
      code: "UNIT_MISMATCH",
      message:
        "FIT 是每十亿设备小时，软件作业/调用发生率请使用 rate 并声明基准",
      path: "payload.fit",
    });
  if (
    kind === "parameter-evidence" &&
    payload.basis &&
    !["device-hour", "job-hour", "call", "task"].includes(payload.basis)
  )
    issues.push({
      code: "UNIT_MISMATCH",
      message: "不支持的暴露口径",
      path: "payload.basis",
    });
  return issues;
}

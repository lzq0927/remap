import { agreeLossAllocation } from "./audit-allocation";
import {
  planningMethodNames,
  planningMethods,
  type AuditPlanningOptions,
} from "../../contracts/src/audit-planning";

type Item = {
  id: string;
  name: string;
  importance: number;
  complexity: number;
  actualHours: number;
  [key: string]: any;
};
/** Engineering responsibility in additive loss hours. These are NOT classical rate/RBD results. */
export function designAllocation(
  budget: number,
  hours: number,
  items: Item[],
  options: AuditPlanningOptions = {},
  method = options.method ?? "agree",
) {
  const classical = agreeLossAllocation(
    budget,
    hours,
    method === "agree" ? items : items.map((i) => ({ ...i, importance: 1 })),
  );
  if (
    Object.keys(options.budgetBounds ?? {}).some(
      (id) => !items.some((i) => i.id === id),
    )
  )
    throw new Error("责任预算引用未知机制");
  const bounds = items.map((i) => options.budgetBounds?.[i.id]);
  const low = bounds.map((b) => b?.locked ?? b?.min ?? 0);
  const high = bounds.map((b) => b?.locked ?? b?.max ?? Infinity);
  if (
    bounds.some(
      (b, j) =>
        low[j] > high[j] ||
        (b?.locked !== undefined &&
          (b.locked < (b.min ?? 0) || b.locked > (b.max ?? Infinity))),
    )
  )
    throw new Error("固定责任与预算边界冲突");
  const lowTotal = low.reduce((a, b) => a + b, 0);
  if (lowTotal > budget + 1e-10)
    throw new Error("固定责任及下限超过总损失预算");
  if (method === "cost" && items.some((i) => !options.costs?.[i.id]))
    throw new Error("成本分配需要每项责任的成本系数及来源");
  let weights = items.map((i, j) =>
    method === "agree"
      ? classical.items[j].weight
      : method === "arinc"
        ? i.actualHours
        : method === "feasibility"
          ? (options.feasibility?.[i.id] ?? 1)
          : 1,
  );
  if (weights.every((w) => w === 0)) weights = weights.map(() => 1);
  const totalCurrent = items.reduce((a, i) => a + i.actualHours, 0);
  const ceiling =
    method === "minimum-effort" || method === "cost"
      ? high.map((v, j) => Math.min(v, Math.max(low[j], items[j].actualHours)))
      : high;
  const assigned = Math.min(
    budget,
    ceiling.reduce((a, b) => a + b, 0),
  );
  const clamp = (v: number, j: number) =>
    Math.max(low[j], Math.min(ceiling[j], v));
  const at = (x: number) =>
    items.map((i, j) => {
      if (method === "minimum-effort") return clamp(x, j);
      if (method === "cost") {
        const c = options.costs![i.id];
        return clamp(
          Math.pow(
            c.a * c.b * Math.pow(Math.max(1e-12, i.actualHours), c.b) * x,
            1 / (c.b + 1),
          ),
          j,
        );
      }
      return clamp(x * weights[j], j);
    });
  let left = 0,
    right = Math.max(1, budget);
  for (
    let k = 0;
    k < 150 && at(right).reduce((a, b) => a + b, 0) < assigned - 1e-12;
    k++
  )
    right *= 2;
  for (let k = 0; k < 120; k++) {
    const mid = (left + right) / 2;
    if (at(mid).reduce((a, b) => a + b, 0) < assigned) left = mid;
    else right = mid;
  }
  const values = at((left + right) / 2),
    used = values.reduce((a, b) => a + b, 0);
  return {
    ...classical,
    method: "engineering-loss." + method + ".v1",
    methodName: planningMethodNames[method],
    formula:
      method === "agree"
        ? classical.formula
        : method === "cost"
          ? "min Σ aᵢ(Lᵢ⁰/bᵢ)^βᵢ，Σbᵢ≤B，给定上下限与固定责任"
          : method === "minimum-effort"
            ? "按现状责任损失压平最大项，已满足或固定项保持，Σbᵢ≤B"
            : "bᵢ=有界归一化权重×B；固定责任先扣除",
    interpretation:
      "分配对象是互斥工程责任小时，不是模块自身可用度、条件失效概率或机制独立收益。经典任务可靠度/串联可用度继续使用独立子模型。",
    items: items.map((i, j) => ({
      ...i,
      weight: budget ? values[j] / budget : 0,
      allowedHours: values[j],
      excessHours: i.actualHours - values[j],
      bound: bounds[j],
    })),
    unusedHours: Math.max(0, budget - used),
    residual: used + Math.max(0, budget - used) - budget,
    currentHours: totalCurrent,
  };
}
export function compareDesignAllocations(
  budget: number,
  hours: number,
  items: Item[],
  options: AuditPlanningOptions = {},
) {
  return planningMethods.map((method) => {
    try {
      return {
        method,
        status: "available" as const,
        result: designAllocation(budget, hours, items, options, method),
      };
    } catch (e) {
      return {
        method,
        status: "unavailable" as const,
        reason: (e as Error).message,
      };
    }
  });
}

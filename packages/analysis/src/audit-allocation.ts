import { allocate, type AllocationRequest } from "../../allocation/src/index";

export type AuditSubmodelAllocation = AllocationRequest & {
  compareMethods?: AllocationRequest["method"][];
};
export type LossBudgetMethod = "equal" | "baseline-proportional" | "custom";
export const lossKeys = [
  "downtime",
  "save",
  "rollback",
  "terminalInvalid",
  "slowdown",
  "localLoss",
] as const;
export const equalLossWeights = Object.fromEntries(
  lossKeys.map((key) => [key, 1 / lossKeys.length]),
);

/** Training progress is additive; series allocation belongs to a separate submodel. */
export function auditSubmodelPlan(input?: AuditSubmodelAllocation) {
  if (!input) return null;
  if (!input.metricId)
    throw new Error(
      "子模型分配须明确 task-reliability 或 steady-state-availability 指标",
    );
  const methods = input.compareMethods ?? [input.method];
  if (
    !Array.isArray(methods) ||
    !methods.length ||
    methods.length > 5 ||
    new Set(methods).size !== methods.length
  )
    throw new Error("分配对比须为 1 至 5 个不同方法");
  const results = [...new Set([input.method, ...methods])].map((method) =>
    allocate({ ...input, method }),
  );
  return {
    kind: "audit-submodel-allocation.v1",
    selected: results.find((r) => r.method === input.method)!,
    comparisons: results,
    requiresForwardValidation: true,
    scope: "独立子模型目标；不直接证明训练正确有效产出达标，也不修改事件 FIT",
  };
}
export function lossAllocation(
  method: LossBudgetMethod = "custom",
  custom: Record<string, number> | undefined,
  baseline: Record<string, number>,
  cards: number,
  hours: number,
  target: number,
) {
  const total = lossKeys.reduce((sum, key) => sum + (baseline[key] ?? 0), 0);
  const weights =
    method === "equal"
      ? { ...equalLossWeights }
      : method === "baseline-proportional"
        ? Object.fromEntries(
            lossKeys.map((key) => [
              key,
              total > 0 ? (baseline[key] ?? 0) / total : 1 / lossKeys.length,
            ]),
          )
        : custom
          ? { ...custom }
          : null;
  return {
    cards,
    method,
    weights,
    allowedHours: (1 - target) * hours,
    basis:
      method === "baseline-proportional"
        ? "本次基线仿真损失账，候选措施计算前冻结"
        : method === "equal"
          ? "六项损失均分"
          : "用户设计权重",
    baselineLossHours: total,
  };
}

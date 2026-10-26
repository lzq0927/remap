import { allocate, type AllocationRequest } from "../../allocation/src/index";
import {
  auditObjects,
  type AuditEventView,
} from "../../contracts/src/audit-objects";

export type AuditSubmodelAllocation = AllocationRequest & {
  compareMethods?: AllocationRequest["method"][];
  source?: "event-catalog";
  cards?: number;
  recoveryHours?: Record<string, number>;
};
export function auditHardwareItems(events: AuditEventView[], cards: number) {
  return auditObjects(events).map((object) => ({
    id: object.id,
    name: object.name,
    baselineRate: (object.fit * cards) / 1e9,
    weight: object.fit,
    complexity: 1,
    importance: 1,
  }));
}
export function hardwareFitTargets(
  input: AuditSubmodelAllocation,
  result: ReturnType<typeof allocate>,
) {
  if (input.source !== "event-catalog" || !input.cards) return [];
  return result.items.map((item) => {
    const recovery = input.recoveryHours?.[item.id];
    const rate =
      item.targetRate ??
      (recovery && recovery > 0 ? (1 / item.target - 1) / recovery : null);
    return {
      id: item.id,
      name: item.name,
      fit: rate === null ? null : (rate * 1e9) / input.cards!,
    };
  });
}
export function hardwareTargetOverrides(
  input: AuditSubmodelAllocation,
  events: AuditEventView[],
) {
  const result = auditSubmodelPlan(input)!;
  const targets = hardwareFitTargets(input, result.selected);
  if (!targets.length || targets.some((item) => item.fit === null))
    throw new Error(
      "请先填写每类对象的二态平均修复时间，才能估算 FIT 目标；也可在第四步直接填写已论证的事件目标。",
    );
  const objects = auditObjects(events);
  return targets.flatMap((target) => {
    const object = objects.find((item) => item.id === target.id);
    if (!object || object.fit === 0) return [];
    return object.events
      .filter((event) => event.fit > 0)
      .map((event) => ({
        id: event.id,
        fit:
          (Math.min(target.fit!, object.fit) * event.fit) /
          object.fit /
          (event.rateMultiplier ?? 1),
        evidence: "scenario" as const,
        source: `${input.method} 对象分配 · ${input.cards}卡 · ${input.metricId}=${input.target}`,
        rateBasis: "npu-equivalent-hour",
        note: "以分配值为 FIT 上限，不调高已满足预算的对象；沿用本对象当前故障类型比例。有数量模型时已还原到参考目录FIT，避免再次乘数量。需正向仿真和工程验证，不是实测 FIT。",
      }));
  });
}
export type LossBudgetMethod =
  | "none"
  | "equal"
  | "baseline-proportional"
  | "custom";
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

/** HAC-D classical AGREE shape, normalized to a finite-window loss budget.
 * E is an explicit engineering importance suggestion, not an inferred failure probability.
 * This planning adaptation never replaces the forward retained-progress calculation.
 */
export function agreeLossAllocation(
  allowedHours: number,
  horizonHours: number,
  items: Array<{
    id: string;
    name: string;
    importance: number;
    complexity: number;
    actualHours: number;
  }>,
) {
  if (
    !Number.isFinite(allowedHours) ||
    allowedHours < 0 ||
    !(horizonHours > 0) ||
    !Number.isFinite(horizonHours) ||
    allowedHours > horizonHours ||
    !items.length ||
    new Set(items.map((i) => i.id)).size !== items.length ||
    items.some(
      (i) =>
        !Number.isFinite(i.importance) ||
        i.importance <= 0 ||
        i.importance > 1 ||
        !Number.isFinite(i.complexity) ||
        i.complexity <= 0 ||
        !Number.isFinite(i.actualHours) ||
        i.actualHours < 0,
    )
  )
    throw new Error("AGREE 预算、重要度 (0,1]、复杂度及实际损失必须有效");
  const N = items.reduce((s, i) => s + i.complexity, 0),
    proxyReliability = Math.exp(-allowedHours / horizonHours);
  const raw = items.map((i) => {
    const failure =
      -Math.expm1(((-allowedHours / horizonHours) * i.complexity) / N) /
      i.importance;
    if (failure >= 1)
      throw new Error("AGREE 重要度过低，分配结果无效；请提高重要度或缩小预算");
    return -Math.log1p(-failure);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  const rows = items.map((item, index) => ({
    ...item,
    weight: sum ? raw[index] / sum : item.complexity / N,
    allowedHours: sum ? (allowedHours * raw[index]) / sum : 0,
    excessHours:
      item.actualHours - (sum ? (allowedHours * raw[index]) / sum : 0),
  }));
  return {
    method: "agree.classical-normalized-loss.v1",
    formula: "Rᵢ = 1 − (1 − R*^(nᵢ/Σn))/Eᵢ；bᵢ = B × (−ln Rᵢ)/Σ(−ln Rⱼ)",
    interpretation:
      "R*=exp(−B/T) 是损失预算映射，不是训练可用度；重要度越高，允许损失越少。Shapley仅生成可编辑工程建议，最终需正向仿真。",
    source:
      "HAC-D@b618d35 · user manual §7 / allocation/index.ts 的经典条件式形状；ReMAP有限窗口损失预算适配，未使用HAC-D策略权重n×E的另一种分配",
    allowedHours,
    proxyReliability,
    items: rows,
    residual: rows.reduce((s, i) => s + i.allowedHours, 0) - allowedHours,
  };
}

/** Training progress is additive; series allocation belongs to a separate submodel. */
export function auditSubmodelPlan(input?: AuditSubmodelAllocation) {
  if (!input) return null;
  if (
    input.source === "event-catalog" &&
    (!Number.isSafeInteger(input.cards) || input.cards! < 1)
  )
    throw new Error("对象 FIT 分配需要明确卡数和 NPU 等效小时基准");
  if (
    input.recoveryHours &&
    Object.entries(input.recoveryHours).some(
      ([id, value]) =>
        !input.items.some((item) => item.id === id) ||
        !Number.isFinite(value) ||
        value <= 0,
    )
  )
    throw new Error("二态平均修复时间必须为正数，且对应已选对象");
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
    rateBasis:
      input.source === "event-catalog"
        ? "npu-equivalent-hour"
        : "submodel-hour",
    cards: input.cards,
    objectFitTargets:
      input.source === "event-catalog"
        ? results.map((result) => ({
            method: result.method,
            items: hardwareFitTargets(input, result),
          }))
        : [],
    requiresForwardValidation: true,
    scope: "独立子模型目标；不直接证明训练可用度达标，也不修改事件 FIT",
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
    method === "none"
      ? null
      : method === "equal"
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
      method === "none"
        ? "第一轮固定现状，不提前分配损失指标"
        : method === "baseline-proportional"
          ? "本次基线仿真损失账，候选措施计算前冻结"
          : method === "equal"
            ? "六项损失均分"
            : "用户设计权重",
    baselineLossHours: total,
  };
}

import type { AuditRequest } from "./audit";
import { auditReferenceOnly } from "../../contracts/src/audit-presets";
export const auditLossBudgetLabels: Record<string, string> = {
  downtime: "全局停机",
  save: "检查点保存",
  rollback: "已回滚进度",
  terminalInvalid: "期末污染",
  slowdown: "亚健康降速",
  localLoss: "局部容量损失",
};
export const auditBudgetDefaults = {
  downtime: 0.25,
  save: 0.2,
  rollback: 0.35,
  terminalInvalid: 0.1,
  slowdown: 0.05,
  localLoss: 0.05,
};
export function auditTarget(request: AuditRequest, cards: number) {
  return request.targets?.[String(cards)] ?? request.target;
}
export function validateAuditDesign(request: AuditRequest, scales: number[]) {
  if (request.targets !== undefined) {
    if (
      !request.targets ||
      typeof request.targets !== "object" ||
      Array.isArray(request.targets)
    )
      throw new Error("规模目标必须为卡数到目标值的映射");
    for (const [n, v] of Object.entries(request.targets))
      if (
        !scales.includes(Number(n)) ||
        String(Number(n)) !== n ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > 1
      )
        throw new Error("规模目标必须对应本次规模，且在 0–1 之间");
    if (
      request.targets[String(request.cards)] !== undefined &&
      request.targets[String(request.cards)] !== request.target
    )
      throw new Error("所选规模目标必须与可用度目标一致");
  }
  if (request.lossBudgetWeights !== undefined) {
    const w = request.lossBudgetWeights;
    if (
      !w ||
      typeof w !== "object" ||
      Array.isArray(w) ||
      Object.keys(w).length !== 6 ||
      Object.keys(auditLossBudgetLabels).some(
        (k) => !Number.isFinite(w[k]) || w[k] < 0 || w[k] > 1,
      ) ||
      Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) > 1e-8
    )
      throw new Error("六项损失预算权重必须非负且合计为 100%");
  }
}
const actions: Record<string, string> = {
  downtime:
    "核对事件到达率、检测等待和恢复链；对可覆盖事件比较降 FIT 与恢复措施。",
  save: "比较计算周期与保存阻塞；提高保存频率可能增加该项开销，须同时核对回滚收益。",
  rollback:
    "优先核对污染发现时延和干净检查点；比较检测、step 与保存策略的联合收益。",
  terminalInvalid:
    "核对全系统静默检出覆盖与漏检兜底，不能用 Core 检出率代替全系统覆盖。",
  slowdown: "核对亚健康强度与持续时间，再比较检测和保留进度恢复。",
  localLoss: "核对 DP 域覆盖、可用容量与恢复耗时，并验证并行训练和收敛假设。",
};
/** Finite-window no-fault reference; not a proof of global infeasibility. */
export function checkpointReference(
  hours: number,
  compute: number,
  save: number,
) {
  const seconds = hours * 3600,
    cycle = compute + save;
  return (
    (Math.floor(seconds / cycle) * compute +
      Math.min(seconds % cycle, compute)) /
    seconds
  );
}
export function auditDesignReview(
  request: AuditRequest,
  rows: any[],
  model: Record<string, number>,
  policy: Record<string, any>,
  allocations?: Array<{
    cards: number;
    weights: Record<string, number> | null;
  }>,
) {
  const fast = request.mechanisms?.includes("fast");
  return {
    kind: "audit-design-review.v1",
    baselineNoFault: checkpointReference(
      request.hours,
      request.baseline?.mechanisms?.includes("fast")
        ? policy["C-FAST"].computeSeconds
        : model.checkpointComputeSeconds,
      request.baseline?.mechanisms?.includes("fast")
        ? policy["C-FAST"].saveSeconds
        : model.checkpointSaveSeconds,
    ),
    selectedNoFault: checkpointReference(
      request.hours,
      fast ? policy["C-FAST"].computeSeconds : model.checkpointComputeSeconds,
      fast ? policy["C-FAST"].saveSeconds : model.checkpointSaveSeconds,
    ),
    scales: rows
      .filter(
        (r) => r.id === "combined" && !auditReferenceOnly(request, r.cards),
      )
      .map((row) => {
        const target = auditTarget(request, row.cards),
          allowedHours = (1 - target) * request.hours,
          weights =
            allocations?.find((a) => a.cards === row.cards)?.weights ??
            request.lossBudgetWeights;
        return {
          cards: row.cards,
          target,
          allowedHours,
          actualLossHours: request.hours * (1 - row.statistics.mean),
          excessHours: request.hours * (target - row.statistics.mean),
          allocated: !!weights,
          items: Object.entries(auditLossBudgetLabels).map(([id, name]) => ({
            id,
            name,
            actualHours: row.ledger[id] ?? 0,
            allowedHours: weights ? allowedHours * weights[id] : null,
            excessHours: weights
              ? (row.ledger[id] ?? 0) - allowedHours * weights[id]
              : null,
            action: actions[id],
          })),
        };
      }),
  };
}

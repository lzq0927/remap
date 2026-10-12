/** Presentation-only interpretation shared by the workbench and standalone report. */
import { auditReferenceOnly } from "../../contracts/src/audit-presets";
export const auditLossLabels: Record<string, string> = {
  downtime: "全局停机",
  save: "检查点保存",
  rollback: "已回滚进度",
  terminalInvalid: "期末污染",
  slowdown: "亚健康降速",
  localLoss: "局部容量损失",
};
export function auditSummary(r: any, cards = r.request.cards) {
  const base = r.rows.find((x: any) => x.cards === cards && x.id === "base");
  const combined = r.rows.find(
    (x: any) => x.cards === cards && x.id === "combined",
  );
  const target = r.request.targets?.[String(cards)] ?? r.request.target;
  const referenceOnly = auditReferenceOnly(r.request, cards);
  const status = referenceOnly
    ? "reference"
    : combined.statistics.ciLow >= target
      ? "supported"
      : combined.statistics.ciHigh < target
        ? "below"
        : "uncertain";
  const statusLabel = {
    supported: "采样支持达到目标",
    below: "当前组合低于目标",
    uncertain: "目标附近，证据不足",
    reference: "曲线参考规模 · 未设需求目标",
  }[status];
  const losses = Object.entries(auditLossLabels)
    .map(([key, name]) => ({
      key,
      name,
      base: base.ledger[key] ?? 0,
      combined: combined.ledger[key] ?? 0,
    }))
    .sort((a, b) => b.base - a.base);
  const eventLoss = (x: any) =>
    Object.keys(auditLossLabels)
      .filter((k) => k !== "save")
      .reduce((sum, k) => sum + (x?.[k] ?? 0), 0);
  const drivers = r.events
    .map((e: any) => ({
      id: e.id,
      name: e.description,
      type: e.type,
      evidence: e.evidence,
      loss: eventLoss(base.perEvent[e.id]),
      remaining: eventLoss(combined.perEvent[e.id]),
    }))
    .sort((a: any, b: any) => b.loss - a.loss)
    .slice(0, 5);
  const gain = combined.delta.mean;
  const internal = r.events.filter(
    (e: any) => e.evidence === "internal-measured",
  ).length;
  return {
    base,
    combined,
    target,
    status,
    statusLabel,
    losses,
    drivers,
    gain,
    internal,
    additionalHours: gain * r.request.hours,
    gap: combined.statistics.mean - target,
    referenceOnly,
    next: referenceOnly
      ? "1000卡用于复现专家规模曲线，不计入四个规模的需求达标汇总。"
      : status === "below"
        ? "当前组合仍有产出缺口。优先检查最大损失项及覆盖条件，再比较候选措施；不能仅靠增加采样消除缺口。"
        : status === "uncertain"
          ? "先增加轨迹数并用独立种子复核，再校准关键参数；均值超过目标尚不足以确认达标。"
          : "继续用独立种子复核，并以实测数据校准中断事件和机制能力；本次采样通过不等于现场达标。",
  };
}
/** A selected scale's success must never be presented as success of every requirement. */
export function auditScaleSummary(r: any) {
  const summaries = [
    ...new Set<number>(
      r.rows
        .filter(
          (x: any) =>
            x.id === "combined" && !auditReferenceOnly(r.request, x.cards),
        )
        .map((x: any) => x.cards),
    ),
  ].map((cards) => auditSummary(r, cards));
  return {
    total: summaries.length,
    supported: summaries.filter((s) => s.status === "supported").length,
    below: summaries.filter((s) => s.status === "below").length,
    uncertain: summaries.filter((s) => s.status === "uncertain").length,
  };
}

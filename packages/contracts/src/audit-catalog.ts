export type AuditCatalogVersion = "expert-2026-10-09" | "baseline-2026-10-14";
export const currentAuditCatalogVersion: AuditCatalogVersion =
  "baseline-2026-10-14";
/** Preserve each class total and all SDC values. Slow rates follow the specified objects'
 * relative hard-rate changes; the remaining objects share the residual proportionally. */
export function calibratedAuditEvents<
  T extends {
    id: string;
    fit: number;
    type: string;
    source: string;
    evidence: string;
    note: string;
  },
>(events: T[]): T[] {
  const hard = events.filter((e) => e.type === "hard"),
    slow = events.filter((e) => e.type === "slow");
  const hardTotal = hard.reduce((s, e) => s + e.fit, 0),
    slowTotal = slow.reduce((s, e) => s + e.fit, 0);
  const hardTargets = {
    "CORE-hard": hardTotal * 0.06,
    "SRAM-hard": hardTotal * 0.1,
  };
  const slowTargets = Object.fromEntries(
    Object.entries(hardTargets).map(([id, fit]) => [
      id.replace("-hard", "-slow"),
      (events.find((e) => e.id === id.replace("-hard", "-slow"))!.fit * fit) /
        events.find((e) => e.id === id)!.fit,
    ]),
  );
  const maps: Record<string, Record<string, number>> = {
    hard: hardTargets,
    slow: slowTargets,
  };
  const totals: Record<string, number> = { hard: hardTotal, slow: slowTotal };
  return events.map((event) => {
    if (event.type === "sdc") return { ...event };
    const targets = maps[event.type],
      rest = events
        .filter((e) => e.type === event.type && !(e.id in targets))
        .reduce((s, e) => s + e.fit, 0);
    const remaining =
      totals[event.type] -
      Object.values(targets).reduce((s, fit) => s + fit, 0);
    return {
      ...event,
      fit: targets[event.id] ?? (event.fit * remaining) / rest,
      source: "故障模式基准 2026-10-14 · 用户给定类内占比与保持总量的比例折算",
      evidence: "scenario",
      note:
        event.type === "hard"
          ? "CORE 类内6%、SRAM类内10%；其余中断按原相对构成分配剩余84%，中断总FIT保持不变。"
          : "CORE按6/14、SRAM按10/5缩放原亚健康FIT；其余亚健康按原相对构成补足本类总FIT。静默FIT保持原值。",
    };
  });
}

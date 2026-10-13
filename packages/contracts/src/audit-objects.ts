export const faultTypeLabels: Record<string, string> = {
  hard: "中断",
  slow: "亚健康",
  sdc: "静默",
};
export const referenceFaultShares = { hard: 0.966, slow: 0.02, sdc: 0.014 };
export const objectCategories: Record<string, string> = {
  CORE: "计算与板卡",
  CPU: "计算与板卡",
  MODULE: "计算与板卡",
  SRAM: "内存",
  MEMT: "内存",
  MEMP: "内存",
  DDR: "内存",
  IOD: "网络与互联",
  NIC: "网络与互联",
  OPT: "网络与互联",
  BOXIO: "网络与互联",
  FABRIC: "网络与互联",
  SSD: "存储",
  STORAGE: "存储",
  POWER: "供电与管理",
  COOL: "供电与管理",
  MGMT: "供电与管理",
  UNKNOWN: "软件与未归因",
};
export type AuditEventView = {
  id: string;
  domain: string;
  type: string;
  fit: number;
  description?: string;
  evidence?: string;
  source?: string;
  note?: string;
  scope?: string;
  persistence?: string;
  [key: string]: any;
};
export function eventObjectId(id: string) {
  return id.replace(/-(hard|slow|sdc)$/, "");
}
export function mechanismEventIds(events: AuditEventView[], scope: string) {
  return events
    .filter(
      (event) =>
        scope === "all" ||
        event.type === scope ||
        (event.type === "hard" && event[scope] === true),
    )
    .map((event) => event.id);
}
export function auditObjects(events: AuditEventView[]) {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      category: string;
      fit: number;
      types: Record<string, number>;
      events: AuditEventView[];
    }
  >();
  for (const event of events) {
    const id = eventObjectId(event.id);
    if (!groups.has(id))
      groups.set(id, {
        id,
        name: event.domain,
        category: objectCategories[id] ?? "其他对象",
        fit: 0,
        types: { hard: 0, slow: 0, sdc: 0 },
        events: [],
      });
    const group = groups.get(id)!;
    group.fit += event.fit;
    group.types[event.type] = (group.types[event.type] ?? 0) + event.fit;
    group.events.push(event);
  }
  return [...groups.values()];
}
/** Presentation uses the same explicit per-event replacements as the solver. */
export function auditDraftEvents(
  events: AuditEventView[],
  overrides: string,
  resolved: string[] = [],
) {
  const patches = JSON.parse(overrides);
  if (!Array.isArray(patches)) throw new Error("事件更新必须是数组");
  return events.map((event) => ({
    ...event,
    ...patches.find((patch: any) => patch.id === event.id),
    ...(resolved.includes(event.id) ? { fit: 0, resolved: true } : {}),
  }));
}
export function eventLossHours(value: any) {
  return [
    "downtime",
    "rollback",
    "slowdown",
    "terminalInvalid",
    "localLoss",
  ].reduce((sum, key) => sum + (value?.[key] ?? 0), 0);
}

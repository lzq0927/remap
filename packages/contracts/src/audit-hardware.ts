import { z } from "zod";
import type {
  AuditArchitecture,
  AuditArchitectureNode,
} from "./audit-architecture";
import { auditObjects, type AuditEventView } from "./audit-objects";
import { supernodeCounts, topologyQuantityKeys } from "./audit-topology-config";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/);
const source = z.string().trim().min(1).max(2000);
const count = z.number().finite().int().min(0).max(1e12);
const scaleKey = z.string().regex(/^[1-9][0-9]{0,8}$/);
export const hardwareLevels = {
  component: "内部部件",
  chip: "NPU芯片",
  module: "模组",
  board: "板级",
  node: "计算节点",
  rack: "机柜",
  supernode: "超节点",
  pod: "Pod",
  network: "网络设备",
  storage: "存储",
  facility: "共享设施",
  other: "其他",
} as const;
export const hardwareNodeFields = {
  hardwareLevel: z
    .enum(
      Object.keys(hardwareLevels) as [
        keyof typeof hardwareLevels,
        ...Array<keyof typeof hardwareLevels>,
      ],
    )
    .optional(),
  inventory: z
    .object({
      totals: z.record(scaleKey, count),
      unitsPerParent: count.optional(),
      topologyQuantity: z.enum(topologyQuantityKeys).optional(),
      source,
    })
    .strict()
    .optional(),
  rateModel: z
    .object({
      referenceCards: z.number().int().min(1).max(1e8),
      referenceCount: z.number().finite().int().min(1).max(1e12),
      source,
    })
    .strict()
    .optional(),
};
export const propagationSchema = z
  .object({
    eventId: identifier,
    path: z.array(identifier).min(1).max(10),
    manifestation: z.string().trim().min(1).max(500),
    impact: z.string().trim().min(1).max(500),
    containment: z.string().trim().min(1).max(500),
    source,
  })
  .strict();

/** Counts are explicit per scale or derived through confirmed containment ratios. */
export function hardwareCount(
  a: AuditArchitecture,
  id: string,
  cards: number,
): number | null {
  const seen = new Set<string>();
  const visit = (key: string): number | null => {
    if (seen.has(key)) throw new Error("硬件数量包含关系成环");
    seen.add(key);
    const n = a.nodes.find((v) => v.id === key);
    if (!n) throw new Error("硬件数量引用未知节点");
    if (!n.parentId) return 1;
    if (n.inventory?.totals[String(cards)] !== undefined)
      return n.inventory.totals[String(cards)];
    if (n.inventory?.topologyQuantity && a.topology)
      return supernodeCounts(a.topology, cards)[n.inventory.topologyQuantity];
    if (n.inventory?.unitsPerParent === undefined) return null;
    const parent = visit(n.parentId);
    return parent === null ? null : parent * n.inventory.unitsPerParent;
  };
  const value = visit(id);
  if (value !== null && (!Number.isSafeInteger(value) || value > 1e12))
    throw new Error("硬件总数量超过上限");
  return value;
}

/** Convert a reference NPU-equivalent catalog by actual inventory exactly once. */
export function hardwareScaleEvents<T extends AuditEventView>(
  events: T[],
  a: AuditArchitecture | undefined,
  cards: number,
): T[] {
  if (!a?.nodes.some((n) => n.rateModel)) return events;
  return events.map((e) => {
    const owner = a.nodes.find((n) => n.eventIds.includes(e.id));
    const model = owner?.rateModel;
    if (!owner || !model) return e;
    const quantity = hardwareCount(a, owner.id, cards);
    if (quantity === null)
      throw new Error(`${owner.name}缺少${cards}卡规模的硬件数量`);
    const multiplier =
      (quantity * model.referenceCards) / (model.referenceCount * cards);
    const fit = e.fit * multiplier;
    if (!Number.isFinite(fit) || fit > 1e12)
      throw new Error("硬件数量折算FIT超过上限");
    return {
      ...e,
      fit,
      referenceEvidence: e.evidence,
      evidence: "scenario",
      referenceEquivalentFit: e.fit,
      inventoryCount: quantity,
      rateMultiplier: multiplier,
      source: `${e.source ?? "故障库"}；数量折算：${model.source}；${owner.inventory?.source ?? "上级组成数量"}`,
      rateInterpretation: "参考NPU等效FIT按硬件数量外推，非新增实测器件FIT",
    };
  });
}

/** Display the actual per-scale catalog without mutating the frozen reference input. */
export function hardwareEventView(
  result: any,
  cards: number,
): AuditEventView[] {
  const row = result.rows?.find(
    (r: any) => r.cards === cards && (!r.id || r.id === "combined"),
  );
  if (!row?.scaleEvents) return result.events;
  const events = (row.scaleEvents as AuditEventView[]).map((e) => ({
    ...result.events.find((v: AuditEventView) => v.id === e.id),
    ...e,
  }));
  const total = events.reduce((s, e) => s + e.fit, 0);
  return events.map((e) => ({
    ...e,
    share: total ? e.fit / total : 0,
    withinTypeShare:
      e.fit /
      (events.filter((v) => v.type === e.type).reduce((s, v) => s + v.fit, 0) ||
        1),
    rate: (cards * e.fit) / 1e9,
    mtbfHours: e.fit > 0 ? 1e9 / (cards * e.fit) : null,
  }));
}

export function validateHardwareArchitecture(
  a: AuditArchitecture,
  events: AuditEventView[],
) {
  const known = new Set(events.map((e) => e.id));
  for (const n of a.nodes) {
    if (
      n.rateModel &&
      (!n.eventIds.length || a.nodes.some((c) => c.parentId === n.id))
    )
      throw new Error("数量折算只能绑定已有故障的叶节点");
    if (n.rateModel && !n.inventory)
      throw new Error("数量折算需要硬件数量及依据");
    for (const cards of Object.keys(n.inventory?.totals ?? {}))
      hardwareCount(a, n.id, Number(cards));
    if (n.rateModel) {
      const reference = hardwareCount(a, n.id, n.rateModel.referenceCards);
      if (reference !== null && reference !== n.rateModel.referenceCount)
        throw new Error("参考规模的硬件数量与参考数量不一致");
    }
  }
  const seen = new Set<string>();
  for (const p of a.propagations ?? []) {
    if (!known.has(p.eventId) || seen.has(p.eventId))
      throw new Error("传播记录需要唯一的已知故障ID");
    seen.add(p.eventId);
    if (new Set(p.path).size !== p.path.length)
      throw new Error("故障传播路径不能重复经过同一节点");
    if (p.path.some((id) => !a.nodes.some((n) => n.id === id)))
      throw new Error("传播路径引用未知节点");
    const owner = a.nodes.find((n) => n.eventIds.includes(p.eventId));
    if (owner?.id !== p.path[0])
      throw new Error("传播路径必须从故障归属叶节点开始");
  }
}

/** Illustrative, editable containment; no invented board/rack/POD device counts. */
export function hardwareAuditArchitecture(
  events: AuditEventView[],
): AuditArchitecture {
  const basis =
    "硬件分层初始模板；Pod、机柜、超节点顺序及组成需项目确认。当前FIT沿用故障库；未填数量及未建模对象均为待补充。";
  const nodes: AuditArchitectureNode[] = [];
  const add = (
    id: string,
    name: string,
    parentId?: string,
    hardwareLevel?: AuditArchitectureNode["hardwareLevel"],
  ) => {
    nodes.push({
      id,
      name,
      parentId,
      hardwareLevel,
      kind: parentId ? "subsystem" : "system",
      eventIds: [],
      weight: 1,
      importance: 1,
      source: basis,
    });
  };
  add("system", "集群规模方案");
  add("domain-1", "计算域 / 超节点", "system", "supernode");
  add("hardware-pod", "Pod分组（可调整）", "domain-1", "pod");
  add("hardware-rack", "机柜", "hardware-pod", "rack");
  add("hardware-node", "计算节点", "hardware-rack", "node");
  add("hardware-board", "计算板", "hardware-node", "board");
  add("hardware-module", "NPU模组", "hardware-board", "module");
  add("hardware-chip", "NPU芯片", "hardware-module", "chip");
  nodes.at(-1)!.inventory = {
    totals: { 10000: 10000, 100000: 100000, 200000: 200000, 500000: 500000 },
    source: "初始样例按一张评估卡对应一个NPU；其他封装形式需修改",
  };
  add("hardware-network", "网络与跨域互联", "system", "network");
  add("hardware-storage", "存储系统", "system", "storage");
  add("hardware-facility", "供电、冷却与管理", "system", "facility");
  add("hardware-other", "软件与未归因", "system", "other");
  const parents: Record<string, string> = {
    CORE: "hardware-chip",
    SRAM: "hardware-chip",
    IOD: "hardware-chip",
    MEMT: "hardware-module",
    MEMP: "hardware-module",
    MODULE: "hardware-module",
    CPU: "hardware-node",
    DDR: "hardware-node",
    SSD: "hardware-node",
    NIC: "hardware-network",
    OPT: "hardware-network",
    BOXIO: "hardware-network",
    FABRIC: "hardware-network",
    STORAGE: "hardware-storage",
    POWER: "hardware-facility",
    COOL: "hardware-facility",
    MGMT: "hardware-facility",
  };
  for (const object of auditObjects(events)) {
    add(
      "object-" + object.id,
      object.name,
      parents[object.id] ?? "hardware-other",
      "component",
    );
    Object.assign(nodes.at(-1)!, {
      kind: "object",
      eventIds: object.events.map((e) => e.id),
    });
  }
  add(
    "hardware-board-extra",
    "板级新增故障（待补充）",
    "hardware-board",
    "component",
  );
  add(
    "hardware-spine-extra",
    "新增交换层设备（待补充）",
    "hardware-network",
    "network",
  );
  add("overhead", "保存与检测开销", "system");
  nodes.at(-1)!.kind = "overhead";
  return {
    version: "1",
    view: "hardware",
    name: "硬件分层架构",
    basis,
    budgetMethod: "equal",
    nodes,
    dependencies: [
      ["hardware-chip", "object-NIC", "节点互连"],
      ["object-NIC", "object-OPT", "光链路"],
      ["object-OPT", "object-BOXIO", "接入交换"],
      ["object-BOXIO", "object-FABRIC", "集群互连"],
      ["object-FABRIC", "hardware-storage", "存储访问"],
    ]
      .filter(
        ([from, to]) =>
          nodes.some((n) => n.id === from) && nodes.some((n) => n.id === to),
      )
      .map(([from, to, label]) => ({
        from,
        to,
        label,
        kind: "connection" as const,
        source:
          "初始连接示意，待项目确认；不代表已校准拓扑，不自动计入可靠性计算",
      })),
    propagations: [],
  };
}

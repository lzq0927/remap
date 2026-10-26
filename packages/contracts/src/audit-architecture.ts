import { z } from "zod";
import { auditObjects, type AuditEventView } from "./audit-objects";
import { supernodeTopologySchema } from "./audit-topology-config";
import { networkStudySchema } from "./audit-network-study";
import {
  hardwareNodeFields,
  propagationSchema,
  validateHardwareArchitecture,
} from "./audit-hardware";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/);
const node = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    parentId: id.optional(),
    kind: z.enum(["system", "subsystem", "object", "overhead"]),
    eventIds: z.array(id).max(2000),
    weight: z.number().finite().positive().max(1e6),
    importance: z.number().finite().gt(0).max(1),
    source: z.string().trim().min(1).max(2000),
    scaleWeights: z.record(z.number().finite().positive().max(1e6)).optional(),
    functionalDomain: z
      .enum(["compute", "network", "storage", "facility", "control", "other"])
      .optional(),
    ...hardwareNodeFields,
  })
  .strict();
export const auditArchitectureSchema = z
  .object({
    version: z.literal("1"),
    view: z.enum(["functional", "hardware"]).optional(),
    topology: supernodeTopologySchema.optional(),
    networkStudy: networkStudySchema.optional(),
    propagations: z.array(propagationSchema).max(2000).optional(),
    name: z.string().trim().min(1).max(120),
    basis: z.string().trim().min(1).max(2000),
    budgetMethod: z.enum(["none", "equal", "weighted", "agree"]),
    nodes: z.array(node).min(2).max(120),
    dependencies: z
      .array(
        z
          .object({
            from: id,
            to: id,
            label: z.string().trim().min(1).max(200),
            source: z.string().trim().min(1).max(2000),
            kind: z
              .enum(["dependency", "connection", "shared-domain"])
              .optional(),
          })
          .strict(),
      )
      .max(300),
  })
  .strict();
export type AuditArchitecture = z.infer<typeof auditArchitectureSchema>;
export type AuditArchitectureNode = AuditArchitecture["nodes"][number];

/** Functional grouping is a starting view, never an invented deployment/RBD topology. */
export function defaultAuditArchitecture(
  events: AuditEventView[],
): AuditArchitecture {
  const basis =
    "可编辑的功能分组模板；层级、均分预算与重要度为暂定设计参照，需按项目架构复核";
  const entry = (
    id: string,
    name: string,
    kind: AuditArchitectureNode["kind"],
    parentId?: string,
    eventIds: string[] = [],
  ): AuditArchitectureNode => ({
    id,
    name,
    kind,
    parentId,
    eventIds,
    weight: 1,
    importance: 1,
    source: basis,
  });
  const nodes = [entry("system", "评估系统", "system")];
  const categories = new Map<string, string>();
  for (const object of auditObjects(events)) {
    if (!categories.has(object.category)) {
      const category = "domain-" + (categories.size + 1);
      categories.set(object.category, category);
      nodes.push(entry(category, object.category, "subsystem", "system"));
    }
    nodes.push(
      entry(
        "object-" + object.id,
        object.name,
        "object",
        categories.get(object.category),
        object.events.map((e) => e.id),
      ),
    );
  }
  nodes.push(entry("overhead", "保存与检测开销", "overhead", "system"));
  return {
    version: "1",
    name: "系统分层架构",
    basis,
    budgetMethod: "equal",
    nodes,
    dependencies: [],
  };
}

export function resolveAuditArchitecture(
  input: AuditArchitecture | undefined,
  events: AuditEventView[],
): AuditArchitecture {
  const architecture = auditArchitectureSchema.parse(
    input ?? defaultAuditArchitecture(events),
  );
  const nodes = new Map(architecture.nodes.map((n) => [n.id, n]));
  if (nodes.size !== architecture.nodes.length)
    throw new Error("架构节点ID不能重复");
  const roots = architecture.nodes.filter((n) => !n.parentId);
  if (roots.length !== 1 || roots[0].kind !== "system")
    throw new Error("架构需要且仅需要一个系统根节点");
  const overhead = architecture.nodes.filter((n) => n.kind === "overhead");
  if (overhead.length !== 1)
    throw new Error("架构需要且仅需要一个保存与检测开销节点");
  const known = new Set(events.map((e) => e.id)),
    assigned = new Set<string>();
  for (const n of architecture.nodes) {
    const path = new Set([n.id]);
    let current = n;
    while (current.parentId) {
      const parent = nodes.get(current.parentId);
      if (!parent) throw new Error("架构父节点不存在：" + current.parentId);
      if (path.has(parent.id)) throw new Error("架构包含层级不能成环");
      path.add(parent.id);
      if (path.size > 10) throw new Error("架构层级最多10层");
      current = parent;
    }
    const children = architecture.nodes.filter((c) => c.parentId === n.id);
    if (children.length && (n.eventIds.length || n.kind === "overhead"))
      throw new Error("故障归属与开销节点必须为叶节点，父层只汇总子层");
    if (n.kind === "overhead" && n.eventIds.length)
      throw new Error("公共开销不能同时归属故障事件");
    for (const eventId of n.eventIds) {
      if (!known.has(eventId)) throw new Error("架构引用未知故障：" + eventId);
      if (assigned.has(eventId))
        throw new Error("故障只能归属一个叶节点：" + eventId);
      assigned.add(eventId);
    }
  }
  for (const d of architecture.dependencies)
    if (!nodes.has(d.from) || !nodes.has(d.to) || d.from === d.to)
      throw new Error("共同依赖必须引用两个不同的已有节点");
  // Missing mappings stay explicit and conserve the total loss, rather than disappearing.
  const missing = events.filter((e) => !assigned.has(e.id));
  if (missing.length) {
    if (architecture.nodes.length === 120)
      throw new Error("架构最多120个节点，请为未归属故障保留一个节点位置");
    let missingId = "unassigned";
    while (nodes.has(missingId)) missingId += "-extra";
    architecture.nodes.push({
      id: missingId,
      name: "未归属故障",
      parentId: roots[0].id,
      kind: "object",
      eventIds: missing.map((e) => e.id),
      weight: 1,
      importance: 1,
      source: "故障尚未绑定架构；保留完整损失，待确认归属",
    });
  }
  validateHardwareArchitecture(architecture, events);
  return architecture;
}

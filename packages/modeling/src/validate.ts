import {
  modelSchema,
  type EngineeringModel,
  type ModelIssue,
  type Logic,
} from "./schema";
import { hash } from "../../assets/src/hash";

export function semanticHash(model: EngineeringModel) {
  const { views: _views, decisions: _decisions, ...content } = model;
  return hash(content);
}
export function validateModel(value: unknown): ModelIssue[] {
  // Preflight before recursive Zod parsing, including cyclic in-memory callers.
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 250000 || item.depth > 110)
      return [
        {
          code: "RESOURCE_LIMIT",
          message: "模型嵌套深度或节点数量超限（含循环引用）",
          path: "model",
          severity: "error",
        },
      ];
    if (item.value && typeof item.value === "object")
      for (const v of Object.values(item.value))
        pending.push({ value: v, depth: item.depth + 1 });
  }
  const parsed = modelSchema.safeParse(value);
  if (!parsed.success)
    return parsed.error.issues.map((i) => ({
      code: "SCHEMA_INVALID",
      message: i.message,
      path: i.path.join("."),
      severity: "error",
    }));
  const m = parsed.data,
    issues: ModelIssue[] = [];
  const issue = (
    code: string,
    message: string,
    path: string,
    objectId?: string,
  ) => issues.push({ code, message, path, objectId, severity: "error" });
  const groups = [
    "sources",
    "entities",
    "relations",
    "failureModes",
    "mechanisms",
    "requirements",
    "behaviors",
    "views",
    "cases",
    "decisions",
  ] as const;
  for (const group of groups) {
    const seen = new Set<string>();
    for (const x of m[group]) {
      if (seen.has(x.id)) issue("DUPLICATE_ID", "重复 ID " + x.id, group, x.id);
      seen.add(x.id);
    }
  }
  const check = (ref: string, list: { id: string }[], path: string) => {
    if (!list.some((x) => x.id === ref))
      issue("REFERENCE_MISSING", "引用不存在：" + ref, path, ref);
  };
  for (const group of groups)
    for (const x of m[group])
      if ("sourceRefs" in x)
        for (const ref of x.sourceRefs)
          check(ref, m.sources, `${group}.${x.id}.sourceRefs`);
  for (const r of m.relations) {
    check(r.source, m.entities, "relations." + r.id);
    check(r.target, m.entities, "relations." + r.id);
  }
  for (const f of m.failureModes)
    check(f.entityId, m.entities, "failureModes." + f.id);
  for (const x of m.mechanisms) {
    x.entityRefs.forEach((r) => check(r, m.entities, "mechanisms." + x.id));
    x.failureRefs.forEach((r) =>
      check(r, m.failureModes, "mechanisms." + x.id),
    );
    x.effects.forEach((e) =>
      check(e.failureId, m.failureModes, "mechanisms." + x.id),
    );
  }
  for (const b of m.behaviors) {
    b.participants.forEach((r) => check(r, m.entities, "behaviors." + b.id));
    for (const s of b.steps) {
      if (!b.participants.includes(s.from) || !b.participants.includes(s.to))
        issue(
          "REFERENCE_MISSING",
          "消息端点必须属于参与者",
          "behaviors." + b.id,
          s.id,
        );
    }
  }
  for (const v of m.views) {
    v.entityRefs.forEach((r) => check(r, m.entities, "views." + v.id));
    for (const r of Object.keys(v.positions))
      check(r, m.entities, "views." + v.id);
  }
  const visit = (n: Logic, path: string, depth = 0) => {
    if (depth > 50) {
      issue("RESOURCE_LIMIT", "逻辑深度超过50", path);
      return;
    }
    if (n.type === "event") {
      if (!n.id) issue("SCHEMA_INVALID", "事件缺少 ID", path);
      else check(n.id, m.failureModes, path);
      if (n.children?.length) issue("SCHEMA_INVALID", "事件不能含子门", path);
    } else {
      if (!n.children?.length) issue("SCHEMA_INVALID", "逻辑组不能为空", path);
      if (n.type === "kofn" && (!n.k || n.k > (n.children?.length ?? 0)))
        issue("SCHEMA_INVALID", "k 必须在1到n之间", path);
      n.children?.forEach((c, i) =>
        visit(c, `${path}.children.${i}`, depth + 1),
      );
    }
  };
  for (const c of m.cases) {
    c.bindings?.forEach((b) =>
      check(b.entityId, m.entities, "cases." + c.id + ".bindings"),
    );
    c.entityRefs.forEach((r) => check(r, m.entities, "cases." + c.id));
    c.propertyRefs.forEach((r) => check(r, m.requirements, "cases." + c.id));
    c.mechanismRefs.forEach((r) => check(r, m.mechanisms, "cases." + c.id));
    if (c.logic) visit(c.logic, "cases." + c.id + ".logic");
    if (new Set(c.files.map((f) => f.name)).size !== c.files.length)
      issue("DUPLICATE_ID", "原生文件名重复", "cases." + c.id);
  }
  for (const d of m.decisions)
    d.caseRefs.forEach((r) => check(r, m.cases, "decisions." + d.id));
  // Only containment must be acyclic; operational networks may contain feedback loops.
  const visiting = new Set<string>(),
    done = new Set<string>();
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    for (const r of m.relations.filter(
      (r) => r.kind === "contains" && r.source === id,
    ))
      if (walk(r.target)) return true;
    visiting.delete(id);
    done.add(id);
    return false;
  };
  if (m.entities.some((e) => walk(e.id)))
    issue("CONTAINMENT_CYCLE", "包含层级不能成环", "relations");
  return issues;
}
export function parseModel(value: unknown): EngineeringModel {
  const issues = validateModel(value);
  if (issues.length)
    throw Object.assign(
      new Error(issues.map((x) => `${x.path}: ${x.message}`).join("\n")),
      { code: issues[0].code },
    );
  return modelSchema.parse(value);
}

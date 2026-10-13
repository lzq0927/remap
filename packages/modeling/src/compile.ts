import type { EngineeringModel, Logic } from "./schema";
import type { StaticNode, StaticRequest } from "../../solvers/src/static";
import { parseModel } from "./validate";

export function compileStatic(value: EngineeringModel, caseId: string) {
  const model = parseModel(value),
    c = model.cases.find((x) => x.id === caseId);
  if (!c || !["rbd", "fta"].includes(c.method) || !c.logic)
    throw new Error("需要 RBD/FTA 案例与成功/失效逻辑");
  if (c.metric === "verification")
    throw new Error("静态案例不能使用形式化验证指标");
  const included = model.mechanisms.filter((x) =>
    c.mechanismRefs.includes(x.id),
  );
  if (included.some((x) => x.status === "disabled"))
    throw new Error("案例包含禁用机制");
  if (included.some((x) => !x.effects.length && x.kind !== "redundancy"))
    throw new Error("动态机制尚无静态参数映射；请建立明确排除该机制的基线案例");
  const effects = new Map<
    string,
    (typeof included)[number]["effects"][number]
  >();
  for (const x of included)
    for (const e of x.effects) {
      if (effects.has(e.failureId))
        throw new Error("机制作用冲突：" + e.failureId);
      if (!x.conditions.trim()) throw new Error("机制参数变更必须记录适用条件");
      effects.set(e.failureId, e);
    }
  const mapping: Array<{
    eventId: string;
    entityId: string;
    probability: number;
    originalRate: unknown;
    appliedRate: unknown;
    sourceRefs: string[];
    excluded: boolean;
  }> = [];
  const probabilities = new Map<string, number>();
  const compile = (n: Logic): StaticNode => {
    if (n.type !== "event") {
      if (c.method === "rbd" && ["and", "or"].includes(n.type))
        throw new Error("RBD 请使用串联/并联/k/n");
      if (c.method === "fta" && ["series", "parallel"].includes(n.type))
        throw new Error("FTA 请使用 AND/OR/k/n");
      return { ...n, children: n.children!.map(compile) };
    }
    const f = model.failureModes.find((f) => f.id === n.id)!;
    const excluded = !!(
      (c.categories.length && !c.categories.includes(f.category)) ||
      (c.impacts.length && !f.impacts.some((i) => c.impacts.includes(i)))
    );
    const effect = effects.get(f.id),
      rate = effect?.rate ?? f.rate;
    let success = 1;
    if (!excluded) {
      if (c.metric === "probability") {
        if (f.probability === null)
          throw new Error("缺少失效概率参数：" + f.name);
        success = 1 - f.probability;
      } else {
        if (!rate) throw new Error("缺少失效率参数：" + f.name);
        const lambda = rate.value * (rate.unit === "FIT" ? 1e-9 : 1);
        if (c.metric === "availability") {
          const mttr = effect?.recoveryHours ?? f.recoveryHours;
          if (mttr === null) throw new Error("缺少恢复时间参数：" + f.name);
          success = 1 / (1 + lambda * mttr);
        } else success = Math.exp(-lambda * c.hours);
      }
    }
    const probability = c.method === "fta" ? 1 - success : success;
    if (!probabilities.has(f.id)) {
      probabilities.set(f.id, probability);
      mapping.push({
        eventId: f.id,
        entityId: f.entityId,
        probability,
        originalRate: f.rate,
        appliedRate: rate,
        sourceRefs: f.sourceRefs,
        excluded,
      });
    }
    return { type: "event", id: f.id, probability };
  };
  const tree = compile(c.logic);
  if (c.metric === "availability") {
    const counts = new Map<string, number>();
    for (const m of mapping.filter((x) => !x.excluded))
      counts.set(m.entityId, (counts.get(m.entityId) ?? 0) + 1);
    if ([...counts.values()].some((n) => n > 1))
      throw new Error(
        "同一部件多个维修状态不能按独立二态事件相乘，请提供聚合参数或 CTMC",
      );
  }
  return {
    input: { method: c.method, tree } as StaticRequest,
    mapping,
    metric: c.metric,
    assumptions: [
      ...c.assumptions,
      "不同基本事件独立；同 ID 事件共享",
      ...(c.metric === "availability"
        ? ["独立二态、恒定失效率/修复率；稳态可用度不是不中断概率"]
        : []),
      ...(c.categories.length || c.impacts.length
        ? ["条件分析：范围外事件假定不发生，不能视为综合结果"]
        : []),
    ],
  };
}

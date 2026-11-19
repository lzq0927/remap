import type { AllocationMethod, CoreModel } from "./model";
import { applyMeasures, assess, type Assessment } from "./assess";
import { domainTargetAtScale, targetAtScale } from "./requirements";

export interface MethodInfo {
  id: AllocationMethod;
  name: string;
  summary: string;
  formula: string;
  /** 逐条说明权重为什么这样取。 */
  reasoning: string[];
  /** 适用场景与使用边界。 */
  fit: string;
}

/** 各分配方法的权重公式与适用边界，界面、报告和 Agent 共用同一份说明。 */
export const allocationMethodInfo: Record<AllocationMethod, MethodInfo> = {
  agree: {
    id: "agree",
    name: "AGREE",
    summary: "AGREE工程适配：按复杂度与重要度分配固定窗口损失负荷。",
    formula: "wᵢ = (nᵢ / ωᵢ) / Σⱼ (nⱼ / ωⱼ)",
    reasoning: [
      "复杂度 nᵢ：模块越复杂，固有故障越多，达到同样可用度的代价越高，所以预算与 nᵢ 成正比。",
      "重要度 ωᵢ：模块失效导致任务受损的条件概率。ωᵢ 越大，同样的故障对任务伤害越大，所以预算与 ωᵢ 成反比。",
      "这是将AGREE复杂度/重要度思想用于可修复系统损失负荷的工程适配，不直接套用不可修复系统可靠度公式。先冻结域级约束，再在各自可分配范围内归一化。",
    ],
    fit: "适合有架构和器件清单、需要给出设计目标的阶段。它不依赖现状的恢复能力，因此会暴露“故障不多但单次损失很大”的模块。",
  },
  arinc: {
    id: "arinc",
    name: "ARINC 比例分配",
    summary: "按现状损失占比分配，所有模块按同一比例改进。",
    formula: "wᵢ = ρᵢ / Σⱼ ρⱼ",
    reasoning: [
      "ρᵢ 是模块现状的损失负荷（事件率 × 单次等效损失）。",
      "保持各模块的相对占比不变，每个模块都需要把损失降到现状的 ρ* / ρ 倍。",
    ],
    fit: "适合各模块改进难度相近、希望沿用现状结构的场景。现状最差的模块会得到最大的预算，不一定合理。",
  },
  equal: {
    id: "equal",
    name: "等分配",
    summary: "每个模块得到相同的损失预算。",
    formula: "wᵢ = 1 / k",
    reasoning: ["k 为模块数。不使用任何关于模块差异的信息。"],
    fit: "只适合早期缺少数据时的粗略起点；模块差异大时会对复杂模块提出不现实的要求。",
  },
  "min-effort": {
    id: "min-effort",
    name: "最小改进量",
    summary: "只压低损失最大的几个模块，其余保持现状。",
    formula: "ρᵢ* = min(ρᵢ, ρ₀)，ρ₀ 由 Σᵢ min(ρᵢ, ρ₀) = ρ* 解出",
    reasoning: [
      "把损失最大的模块统一压到同一水位 ρ₀，低于水位的模块不要求改进。",
      "这是统一水位的改进分配启发式。没有各模块的成本曲线时，不能据此声称总工程成本最小。",
    ],
    fit: "适合资源有限、希望把改进集中在少数主要矛盾上的场景。",
  },
  custom: {
    id: "custom",
    name: "自定义权重",
    summary: "由工程判断直接给出各模块的权重。",
    formula: "wᵢ = 自定义值ᵢ / Σⱼ 自定义值ⱼ",
    reasoning: ["权重会自动归一化；未填写的模块按 0 处理。"],
    fit: "适合已有合同指标或上级分配结果，需要直接录入的场景。",
  },
};

export interface ModuleAllocation {
  id: string;
  groupId: string;
  name: string;
  complexity: number;
  importance: number;
  weight: number;
  /** 分配到的损失负荷 ρᵢ*。 */
  load: number;
  /** 模块目标可用度 1/(1+ρᵢ*)。 */
  availability: number;
  /** 目标状态下窗口内的损失预算，小时。 */
  lossHours: number;
  /** 保持现状 MTTR 时允许的最大每卡 FIT（提升 MTBF 方向）。 */
  maxFitPerCard: number | null;
  /** 保持现状 MTTR 时要求的最小 MTBF，小时。 */
  minMtbfHours: number | null;
  /** 保持现状故障率时允许的最大等效 MTTR，小时（降低 MTTR 方向）。 */
  maxMttrHours: number | null;
}
export interface AllocationResult {
  method: AllocationMethod;
  /** 公共开销已超过允许损失时，目标不可达。 */
  feasible: boolean;
  target: number;
  /** 系统允许的总损失负荷 ρ* = (1 − 开销) / A* − 1。 */
  load: number;
  /** 窗口总损失预算 T·(1 − A*)，小时。 */
  lossHours: number;
  failureLossHours: number;
  overheadLossHours: number;
  /** 最小改进量方法的统一水位 ρ₀。 */
  waterline: number | null;
  constraints: Array<{
    id: string;
    name: string;
    target: number;
    load: number;
    moduleIds: string[];
  }>;
  conflict: string | null;
  unallocatedLossHours: number;
  modules: ModuleAllocation[];
  groups: Array<{
    id: string;
    name: string;
    weight: number;
    load: number;
    availability: number;
    lossHours: number;
  }>;
}

function minEffort(loads: number[], budget: number) {
  const total = loads.reduce((sum, v) => sum + v, 0);
  if (total <= budget || total === 0)
    return {
      waterline: null,
      loads: loads.map((v) =>
        total > 0 ? (v * budget) / total : budget / loads.length,
      ),
    };
  const sorted = [...loads].sort((a, b) => a - b);
  let used = 0;
  for (let i = 0; i < sorted.length; i++) {
    const level = (budget - used) / (sorted.length - i);
    if (level <= sorted[i])
      return { waterline: level, loads: loads.map((v) => Math.min(v, level)) };
    used += sorted[i];
  }
  return { waterline: null, loads };
}

/** 把系统可用度目标分配到各模块。分配只依据未加措施的现状。 */
export function allocate(
  model: CoreModel,
  method: AllocationMethod = model.allocation.method,
  baseline: Assessment = assess(model, applyMeasures(model, new Set())),
): AllocationResult {
  const { hours, cards } = model.scenario,
    target = targetAtScale(model, cards),
    overhead = model.requirements?.overheadBudget ?? model.scenario.overhead,
    load = Math.max(0, (1 - overhead) / target - 1),
    overheadFeasible = (1 - overhead) / target - 1 >= 0,
    uptime = hours / (1 + load);
  const current = new Map(baseline.modules.map((m) => [m.id, m]));
  const complexity = model.modules.map(
    (module) =>
      module.complexity ??
      (model.allocation.complexityBasis === "units"
        ? module.unitsPerCard
        : (current.get(module.id)?.fitPerCard ?? 0)),
  );
  const currentLoads = model.modules.map((m) => current.get(m.id)?.load ?? 0);
  let raw: number[],
    waterline: number | null = null;
  if (method === "agree")
    raw = model.modules.map((module, i) => complexity[i] / module.importance);
  else if (method === "arinc") raw = currentLoads;
  else if (method === "custom")
    raw = model.modules.map((m) => model.allocation.customWeights[m.id] ?? 0);
  else if (method === "min-effort") {
    const solved = minEffort(currentLoads, load);
    raw = solved.loads;
    waterline = solved.waterline;
  } else raw = model.modules.map(() => 1);
  const sum = raw.reduce((total, v) => total + v, 0);
  // 权重全为 0 时无法体现差异，退回等分配，避免预算凭空消失。
  const weights = raw.map((v) => (sum > 0 ? v / sum : 1 / raw.length));
  const constraints = (model.requirements?.domains ?? [])
    .filter((d) => d.targetAvailability !== null)
    .map((d) => {
      const domainTarget = domainTargetAtScale(model, d.targetAvailability!);
      return {
        id: d.id,
        name: d.name,
        target: domainTarget,
        load: 1 / domainTarget - 1,
        moduleIds: d.moduleIds,
      };
    });
  const fixedLoad = constraints.reduce((s, d) => s + d.load, 0);
  const feasible = overheadFeasible && fixedLoad <= load + 1e-12;
  const shares = weights.map((w) => w * load);
  let unallocated = 0;
  if (constraints.length) {
    shares.fill(0);
    const pinned = new Set(constraints.flatMap((d) => d.moduleIds));
    const distribute = (indices: number[], budget: number) => {
      if (!indices.length) {
        unallocated += budget;
        return;
      }
      const local =
        method === "min-effort"
          ? minEffort(
              indices.map((i) => currentLoads[i]),
              budget,
            ).loads
          : indices.map((i) => raw[i]);
      const total = local.reduce((s, v) => s + v, 0);
      indices.forEach((i, j) => {
        shares[i] =
          budget * (total > 0 ? local[j] / total : 1 / indices.length);
      });
    };
    for (const d of constraints)
      distribute(
        model.modules.flatMap((m, i) =>
          d.moduleIds.includes(m.id) ? [i] : [],
        ),
        d.load,
      );
    distribute(
      model.modules.flatMap((m, i) => (pinned.has(m.id) ? [] : [i])),
      Math.max(0, load - fixedLoad),
    );
  }
  const modules: ModuleAllocation[] = model.modules.map((module, i) => {
    const share = shares[i],
      now = current.get(module.id);
    const hasRate = !!now && now.rate > 0,
      hasLoss = !!now && now.mttrHours > 0;
    return {
      id: module.id,
      groupId: module.groupId,
      name: module.name,
      complexity: complexity[i],
      importance: module.importance,
      weight: load > 0 ? share / load : 0,
      load: share,
      availability: 1 / (1 + share),
      lossHours: share * uptime,
      maxFitPerCard: hasLoss ? ((share / now.mttrHours) * 1e9) / cards : null,
      minMtbfHours: hasLoss && share > 0 ? now.mttrHours / share : null,
      maxMttrHours: hasRate ? share / now.rate : null,
    };
  });
  return {
    method,
    feasible,
    constraints,
    conflict: !overheadFeasible
      ? "固定公共开销超过系统允许损失"
      : fixedLoad > load + 1e-12
        ? "固定域目标的预算之和超过系统预算；请检查约束，系统不会自动放宽目标。"
        : null,
    unallocatedLossHours: unallocated * uptime,
    target,
    load,
    lossHours: hours * (1 - target),
    failureLossHours: load * uptime,
    overheadLossHours: feasible ? overhead * uptime : hours * (1 - target),
    waterline,
    modules,
    groups: model.groups.map((group) => {
      const parts = modules.filter((m) => m.groupId === group.id),
        groupLoad = parts.reduce((total, m) => total + m.load, 0);
      return {
        id: group.id,
        name: group.name,
        weight: parts.reduce((total, m) => total + m.weight, 0),
        load: groupLoad,
        availability: 1 / (1 + groupLoad),
        lossHours: groupLoad * uptime,
      };
    }),
  };
}

export type GapStatus = "met" | "near" | "over";
export interface ModuleGap {
  id: string;
  groupId: string;
  name: string;
  /** 预算占用率 ρᵢ / ρᵢ*；大于 1 表示超出分配。 */
  usage: number;
  status: GapStatus;
  availability: number;
  targetAvailability: number;
  lossHours: number;
  budgetHours: number;
  /** 达到分配目标需要把损失降到现状的多少（0–1）。 */
  requiredFactor: number;
  /** 超预算时优先的方向：单次损失高于系统平均选 MTTR，否则故障次数是主因，选 MTBF。 */
  suggestion: "mtbf" | "mttr" | "none";
}

/** 模块现状（或设计后）与分配目标的差距。达标按损失负荷 ρ 判定。 */
export function gaps(
  assessment: Assessment,
  allocation: AllocationResult,
): ModuleGap[] {
  const systemMttr = assessment.system.mttrHours;
  return assessment.modules.map((module) => {
    const target = allocation.modules.find((m) => m.id === module.id)!;
    const usage =
      target.load > 0
        ? module.load / target.load
        : module.load > 0
          ? Infinity
          : 0;
    return {
      id: module.id,
      groupId: module.groupId,
      name: module.name,
      usage,
      status: usage <= 1 ? "met" : usage <= 1.2 ? "near" : "over",
      availability: module.availability,
      targetAvailability: target.availability,
      lossHours: module.lossHours,
      budgetHours: target.lossHours,
      requiredFactor: usage > 1 ? 1 / usage : 1,
      suggestion:
        usage <= 1 ? "none" : module.mttrHours > systemMttr ? "mttr" : "mtbf",
    };
  });
}

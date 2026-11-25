import type { AllocationMethod, CoreModel } from "./model";
import {
  applyMeasures,
  assess,
  eventPaths,
  unitCount,
  type Assessment,
  type ResolvedParameters,
} from "./assess";
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
    summary: "越复杂的模块给越多损失预算，越关键的模块给越少。",
    formula: "wᵢ = (nᵢ / ωᵢ) / Σⱼ (nⱼ / ωⱼ)",
    reasoning: [
      "复杂度 nᵢ：模块越复杂，固有故障越多，达到同样可用度的代价越高，所以预算与 nᵢ 成正比。",
      "重要度 ωᵢ：模块失效导致任务受损的条件概率。ωᵢ 越大，同样的故障对任务伤害越大，所以预算与 ωᵢ 成反比。",
      "权重归一化后合计为 1，保证各模块预算合成后恰好等于系统目标。这是把 AGREE 的复杂度 / 重要度思想用于可修复系统损失负荷的工程适配，不是直接套用不可修复系统的可靠度公式；有固定目标时先扣除，再在各自可分配的范围内归一化。",
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
  /** 保持现状单次损失时允许的故障频次：每连续运行一周的次数。 */
  maxRatePerWeek: number | null;
  /** 同上，折算成目标状态下每个日历周实际发生的次数。 */
  maxEventsPerWeek: number | null;
  /** 每周的损失预算，小时。 */
  lossHoursPerWeek: number;
  /** 目标是在模块上直接指定的，不参与按权重分配。 */
  pinned: boolean;
  /** 所属的固定目标责任域；预算在域内分配。 */
  domainId: string | null;
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
  /** 模块上直接指定目标合计占用的损失负荷，以及扣除全部固定目标后留给其余模块分配的部分。 */
  pinnedLoad: number;
  freeLoad: number;
  /** 域级固定目标：每个责任域按规模折算后的目标与允许的损失负荷。 */
  constraints: Array<{
    id: string;
    name: string;
    target: number;
    load: number;
    moduleIds: string[];
  }>;
  /** 固定目标与系统预算冲突时的说明；系统不会自动放宽目标。 */
  conflict: string | null;
  /** 没有模块可以承接的预算（责任域内没有模块时）。 */
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

/**
 * 把系统可用度目标分配到各模块。分配只依据未加措施的现状。
 * 直接指定了目标的模块先从总预算里扣除，剩下的再按所选方法分给其余模块。
 */
export function allocate(
  model: CoreModel,
  method: AllocationMethod = model.allocation.method,
  baseline: Assessment = assess(model, applyMeasures(model, new Set())),
): AllocationResult {
  const { hours, cards } = model.scenario,
    // 有域级要求时，系统目标按参考规模折算，公共开销取要求里的预算。
    target = targetAtScale(model, cards),
    overhead = model.requirements?.overheadBudget ?? model.scenario.overhead,
    load = Math.max(0, (1 - overhead) / target - 1),
    overheadFeasible = (1 - overhead) / target - 1 >= 0,
    uptime = hours / (1 + load),
    week = 168 / hours;
  const current = new Map(baseline.modules.map((m) => [m.id, m]));
  // 固定目标有两种来源：域级要求（一组模块合起来的目标）和模块上直接指定的目标。
  // 域级要求优先；模块落在某个固定域里时，它自己的指定目标不再单独生效。
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
  const inDomain = new Set(constraints.flatMap((d) => d.moduleIds)),
    fixedLoad = constraints.reduce((sum, d) => sum + d.load, 0);
  const pinnedLoads = model.modules.map((module) =>
      module.fixedTarget === null || inDomain.has(module.id)
        ? null
        : 1 / module.fixedTarget - 1,
    ),
    pinnedLoad = pinnedLoads.reduce<number>((sum, v) => sum + (v ?? 0), 0),
    freeLoad = Math.max(0, load - pinnedLoad - fixedLoad),
    feasible = overheadFeasible && pinnedLoad + fixedLoad <= load + 1e-12,
    free = model.modules.map(
      (module, i) => pinnedLoads[i] === null && !inDomain.has(module.id),
    );
  const complexity = model.modules.map(
    (module) =>
      module.complexity ??
      (model.allocation.complexityBasis === "units"
        ? module.unitsPerCard
        : (current.get(module.id)?.fitPerCard ?? 0)),
  );
  const currentLoads = model.modules.map((m) => current.get(m.id)?.load ?? 0);
  const raw =
    method === "agree"
      ? model.modules.map((module, i) => complexity[i] / module.importance)
      : method === "arinc"
        ? currentLoads
        : method === "custom"
          ? model.modules.map((m) => model.allocation.customWeights[m.id] ?? 0)
          : model.modules.map(() => 1);
  const shares = model.modules.map((_, i) => pinnedLoads[i] ?? 0);
  let waterline: number | null = null,
    unallocated = 0;
  /** 在一组模块内按所选方法分一份预算；返回最小改进量方法的水位。 */
  const distribute = (indices: number[], budget: number) => {
    if (!indices.length) {
      unallocated += budget;
      return null;
    }
    const solved =
        method === "min-effort"
          ? minEffort(
              indices.map((i) => currentLoads[i]),
              budget,
            )
          : null,
      local = solved ? solved.loads : indices.map((i) => raw[i]),
      total = local.reduce((sum, v) => sum + v, 0);
    // 权重全为 0 时无法体现差异，退回等分配，避免预算凭空消失。
    indices.forEach((i, at) => {
      shares[i] = budget * (total > 0 ? local[at] / total : 1 / indices.length);
    });
    return solved ? solved.waterline : null;
  };
  for (const domain of constraints)
    distribute(
      model.modules.flatMap((m, i) =>
        domain.moduleIds.includes(m.id) ? [i] : [],
      ),
      domain.load,
    );
  const freeIndices = model.modules.flatMap((_, i) => (free[i] ? [i] : []));
  if (freeIndices.length) waterline = distribute(freeIndices, freeLoad);
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
      maxRatePerWeek: hasLoss ? (share / now.mttrHours) * 168 : null,
      maxEventsPerWeek: hasLoss
        ? (share / now.mttrHours) * uptime * week
        : null,
      lossHoursPerWeek: share * uptime * week,
      pinned: pinnedLoads[i] !== null,
      domainId:
        constraints.find((d) => d.moduleIds.includes(module.id))?.id ?? null,
    };
  });
  return {
    method,
    feasible,
    constraints,
    conflict: !overheadFeasible
      ? "固定公共开销超过系统允许损失"
      : pinnedLoad + fixedLoad > load + 1e-12
        ? "固定目标的预算之和超过系统预算；请检查约束，系统不会自动放宽目标。"
        : null,
    unallocatedLossHours: unallocated * uptime,
    target,
    load,
    lossHours: hours * (1 - target),
    failureLossHours: load * uptime,
    overheadLossHours: feasible ? overhead * uptime : hours * (1 - target),
    waterline,
    pinnedLoad,
    freeLoad,
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

/** 单次事件损失达到窗口总预算的这个比例，就算高后果事件。 */
export const consequenceThreshold = 1 / 3;
/** 每个窗口发生不到这么多次才算“少见”；更频繁的事件窗口损失接近平均值，按平均分预算即可。 */
export const consequenceRareLimit = 3;
export interface ModuleConsequence {
  id: string;
  name: string;
  /** 该模块最严重的一类事件单次损失多少小时。 */
  worstLossHours: number;
  /** 最严重事件的单次损失占窗口总损失预算的比例。 */
  budgetShare: number;
  /** 每个窗口内高后果事件的期望次数。 */
  eventsPerWindow: number;
  /** 一个窗口内至少发生一次高后果事件的概率。 */
  windowRisk: number;
  /** 高后果事件平均多少年一次。 */
  yearsBetween: number;
  /** 按窗口风险预算推出的建议目标可用度。 */
  suggestedTarget: number;
}
/**
 * 找出“单次故障后果很大”的模块。
 * 多数故障每周发生很多次、每次损失很小，窗口损失接近其平均值，按平均损失分配预算即可。
 * 少数事件一次就吃掉窗口预算的一大块：平均损失很小，但只要发生，这个窗口就不达标。
 * 这类模块要约束的是“窗口内发生的概率”，所以应单独定目标。
 * 只统计少见的事件（每个窗口不到 consequenceRareLimit 次）；恢复能力按当前设计计。
 * 建议值：允许不达标的窗口比例（1 − 达标比例要求）拿出一半，平均分给这些模块。
 */
export function consequences(
  model: CoreModel,
  parameters: ResolvedParameters = applyMeasures(model),
): ModuleConsequence[] {
  const { hours, target, cards, passRatio } = model.scenario,
    budget = hours * (1 - target),
    limit = consequenceThreshold * budget,
    modules = new Map(model.modules.map((m) => [m.id, m]));
  const rows = model.modules
    .map((module) => {
      let worst = 0,
        heavyRate = 0,
        heavyLoad = 0;
      for (const mode of parameters.modes) {
        if (mode.moduleId !== module.id) continue;
        const rate =
          (mode.fit * unitCount(modules.get(module.id), cards)) / 1e9;
        for (const path of eventPaths(mode)) {
          if (path.probability <= 0 || rate <= 0) continue;
          if (path.lossHours < limit) continue;
          worst = Math.max(worst, path.lossHours);
          heavyRate += rate * path.probability;
          heavyLoad += rate * path.probability * path.lossHours;
        }
      }
      return { module, worst, heavyRate, heavyLoad };
    })
    .filter(
      (row) =>
        row.heavyRate > 0 && row.heavyRate * hours < consequenceRareLimit,
    );
  const riskEach =
    rows.length > 0 ? Math.max(0, (1 - passRatio) / 2) / rows.length : 0;
  return rows.map(({ module, worst, heavyRate, heavyLoad }) => {
    const eventsPerWindow = heavyRate * hours,
      allowedRate = -Math.log(1 - Math.min(0.999999, riskEach)) / hours,
      meanLoss = heavyLoad / heavyRate;
    return {
      id: module.id,
      name: module.name,
      worstLossHours: worst,
      budgetShare: budget > 0 ? worst / budget : Infinity,
      eventsPerWindow,
      windowRisk: 1 - Math.exp(-eventsPerWindow),
      yearsBetween: 1 / (heavyRate * 8760),
      suggestedTarget: 1 / (1 + allowedRate * meanLoss),
    };
  });
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

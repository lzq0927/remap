import type { AllocationMethod, CoreModel } from "./model";
import {
  applyMeasures,
  assess,
  eventPaths,
  unitCount,
  type Assessment,
  type ResolvedParameters,
} from "./assess";

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
      "权重归一化后合计为 1，保证各模块预算合成后恰好等于系统目标。",
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
      "在“改进量与损失降幅成正比”的假设下，这是达到目标所需改进总量最小的方案。",
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
  /** 保持现状单次损失时允许的故障频次，次 / 周。 */
  maxEventsPerWeek: number | null;
  /** 每周的损失预算，小时。 */
  lossHoursPerWeek: number;
  /** 目标是直接指定的，不参与按权重分配。 */
  pinned: boolean;
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
  /** 直接指定目标的模块合计占用的损失负荷，以及留给其余模块分配的部分。 */
  pinnedLoad: number;
  freeLoad: number;
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
  const { hours, target, overhead, cards } = model.scenario,
    load = Math.max(0, (1 - overhead) / target - 1),
    uptime = hours / (1 + load),
    week = 168 / hours;
  const current = new Map(baseline.modules.map((m) => [m.id, m]));
  const pinnedLoads = model.modules.map((module) =>
      module.fixedTarget === null ? null : 1 / module.fixedTarget - 1,
    ),
    pinnedLoad = pinnedLoads.reduce<number>((sum, v) => sum + (v ?? 0), 0),
    freeLoad = Math.max(0, load - pinnedLoad),
    feasible = (1 - overhead) / target - 1 > 0 && pinnedLoad <= load,
    free = model.modules.map((_, i) => pinnedLoads[i] === null);
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
    const index = model.modules.map((_, i) => i).filter((i) => free[i]),
      solved = minEffort(
        index.map((i) => currentLoads[i]),
        freeLoad,
      );
    raw = model.modules.map(() => 0);
    index.forEach((i, at) => (raw[i] = solved.loads[at]));
    waterline = solved.waterline;
  } else raw = model.modules.map(() => 1);
  const sum = raw.reduce((total, v, i) => total + (free[i] ? v : 0), 0),
    freeCount = free.filter(Boolean).length;
  // 权重全为 0 时无法体现差异，退回等分配，避免预算凭空消失。
  const shares = raw.map((v, i) =>
    !free[i]
      ? pinnedLoads[i]!
      : (sum > 0 ? v / sum : 1 / Math.max(1, freeCount)) * freeLoad,
  );
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
      maxEventsPerWeek: hasLoss
        ? (share / now.mttrHours) * uptime * week
        : null,
      lossHoursPerWeek: share * uptime * week,
      pinned: !free[i],
    };
  });
  return {
    method,
    feasible,
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

/** 规模–目标对照中的一个点。 */
export interface TargetPoint {
  cards: number;
  target: number;
}
/**
 * 规模与目标的关系。串联系统的故障次数与规模成正比，所以损失负荷 r = 1/A − 1 也与规模成正比：
 * A(N) = 1 / (1 + k·N)，k 是“每张卡带来的损失负荷”，代表一个可靠性水平。
 * 给定若干（规模，目标）点，先换算成各点的 k，再对规模的对数线性插值；范围之外沿用端点的 k。
 */
export function targetFromCurve(curve: TargetPoint[], cards: number) {
  const points = [...curve]
    .filter((p) => p.cards > 0 && p.target > 0 && p.target < 1)
    .sort((a, b) => a.cards - b.cards);
  if (!points.length) return null;
  const perCard = (p: TargetPoint) => (1 / p.target - 1) / p.cards;
  let k: number;
  if (cards <= points[0].cards) k = perCard(points[0]);
  else if (cards >= points[points.length - 1].cards)
    k = perCard(points[points.length - 1]);
  else {
    const hi = points.findIndex((p) => p.cards >= cards),
      a = points[hi - 1],
      b = points[hi],
      t = Math.log(cards / a.cards) / Math.log(b.cards / a.cards);
    k = perCard(a) + t * (perCard(b) - perCard(a));
  }
  return 1 / (1 + k * cards);
}
/** 每万卡的损失负荷（‰）：把不同规模的目标换算到同一把尺子上。 */
export const loadPerTenThousand = (point: TargetPoint) =>
  ((1 / point.target - 1) / point.cards) * 10000;

/** 单次事件损失达到窗口总预算的这个比例，就算高后果事件。 */
export const consequenceThreshold = 1 / 3;
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
 * 建议值：允许不达标的窗口比例（1 − 达标比例要求）拿出一半，平均分给这些模块。
 */
export function consequences(
  model: CoreModel,
  parameters: ResolvedParameters = applyMeasures(model, new Set()),
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
    .filter((row) => row.heavyRate > 0);
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

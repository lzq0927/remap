import {
  higherIsBetter,
  layerOf,
  readParam,
  type CoreModel,
  type EvidenceState,
  type Measure,
  type MeasureCategory,
  type MeasureLayer,
} from "./model";
import { applyMeasures, assess, createEvaluator } from "./assess";
import { goalEvaluator, targetAtScale } from "./requirements";

const enabledIds = (model: CoreModel) =>
  model.measures.filter((m) => m.enabled).map((m) => m.id);
/** 标了“暂不优化”且没有启用的措施：不进入推荐、组合路径和潜力估算。 */
export const isHeld = (measure: Measure) => measure.hold && !measure.enabled;

/** Shapley 精确枚举的上限：2^14 个子集，每个只需一次解析评估。 */
export const exactSubsetLimit = 14;
/** 推荐方案穷举搜索允许的评估次数。 */
const searchBudget = 8000;

function mulberry(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 已启用措施的 Shapley 分摊：对所有加入顺序求平均边际收益。
 * 各措施分摊值之和恰好等于“设计后 − 现状”的可用度提升，且与措施排列顺序无关。
 */
export function shapley(model: CoreModel, ids: string[] = enabledIds(model)) {
  const n = ids.length,
    availabilityOf = createEvaluator(model),
    result = new Map<string, number>(ids.map((id) => [id, 0]));
  if (!n) return { values: result, exact: true };
  if (n <= exactSubsetLimit) {
    const size = 1 << n,
      value = new Float64Array(size);
    for (let mask = 0; mask < size; mask++)
      value[mask] = availabilityOf(
        new Set(ids.filter((_, i) => mask & (1 << i))),
      );
    const factorial = [1];
    for (let i = 1; i <= n; i++) factorial.push(factorial[i - 1] * i);
    for (let mask = 0; mask < size; mask++) {
      let count = 0;
      for (let bits = mask; bits; bits &= bits - 1) count++;
      const weight =
        (factorial[count] * factorial[n - count - 1]) / factorial[n];
      for (let i = 0; i < n; i++)
        if (!(mask & (1 << i)))
          result.set(
            ids[i],
            result.get(ids[i])! +
              weight * (value[mask | (1 << i)] - value[mask]),
          );
    }
    return { values: result, exact: true };
  }
  // 措施过多时改用固定种子的排列抽样，结果可复现。
  const random = mulberry(20261117),
    samples = 800;
  for (let s = 0; s < samples; s++) {
    const order = [...ids];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const active = new Set<string>();
    let previous = availabilityOf(active);
    for (const id of order) {
      active.add(id);
      const next = availabilityOf(active);
      result.set(id, result.get(id)! + (next - previous) / samples);
      previous = next;
    }
  }
  return { values: result, exact: false };
}

export interface MeasureContribution {
  id: string;
  name: string;
  category: MeasureCategory;
  enabled: boolean;
  evidence: EvidenceState;
  /** 只启用这一项时相对现状的提升。 */
  standalone: number;
  /** 已启用：去掉它损失多少；未启用：加上它再提升多少。 */
  marginal: number;
  /** Shapley 分摊；未启用的措施为 0。 */
  shapley: number;
}

export function contributions(model: CoreModel) {
  const active = enabledIds(model),
    availabilityOf = createEvaluator(model),
    activeSet = new Set(active),
    base = availabilityOf(new Set()),
    designed = availabilityOf(activeSet),
    shares = shapley(model, active);
  const items: MeasureContribution[] = model.measures.map((measure) => {
    const toggled = new Set(activeSet);
    if (measure.enabled) toggled.delete(measure.id);
    else toggled.add(measure.id);
    const other = availabilityOf(toggled);
    return {
      id: measure.id,
      name: measure.name,
      category: measure.category,
      enabled: measure.enabled,
      evidence: measure.evidence,
      standalone: availabilityOf(new Set([measure.id])) - base,
      marginal: measure.enabled ? designed - other : other - designed,
      shapley: shares.values.get(measure.id) ?? 0,
    };
  });
  return { items, exact: shares.exact, base, designed };
}

const evidenceRank: Record<EvidenceState, number> = {
  verified: 0,
  planned: 1,
  assumed: 2,
};

export interface Recommendation {
  /** met：现有设计已达标；add：补充这些措施即可达标；short：措施库用尽仍不达标。 */
  kind: "met" | "add" | "short";
  /** 在已启用措施之外建议补充的措施。 */
  add: string[];
  availability: number;
  /** 措施库能达到的最高可用度（逐步加入有提升的措施得到）。 */
  ceiling: number;
  /** 仍差多少可用度（kind 为 short 时大于 0）。 */
  shortfall: number;
  /** 不达标时：全部故障率或全部单次损失还需再降低的比例。 */
  furtherReduction: number;
  /** 已启用但去掉后仍达标的措施。 */
  removable: string[];
  /** 推荐的补充措施是否经穷举确认为数量最少；否则为逐步选取的结果。 */
  minimal: boolean;
  /** 标了“暂不优化”、没有参与搜索的措施。 */
  held: string[];
  /** 在上面这组结果之上，把暂不优化的措施也都做了还能再提升多少。 */
  heldGain: number;
}

/**
 * 在已启用措施的基础上，找出达标所需补充的最少措施。
 * 数量相同时优先证据更充分的组合，其次优先可用度更高的组合。
 */
export function recommend(model: CoreModel): Recommendation {
  const target = targetAtScale(model, model.scenario.cards),
    availabilityOf = createEvaluator(model),
    // 达标与否看综合得分：系统目标和每个固定域目标都满足时不小于 1。
    score = goalEvaluator(model),
    active = new Set(enabledIds(model)),
    current = availabilityOf(active),
    held = model.measures.filter(isHeld).map((m) => m.id),
    all = new Set(model.measures.filter((m) => !isHeld(m)).map((m) => m.id)),
    ceiling = availabilityOf(all),
    candidates = model.measures.filter((m) => !m.enabled && !m.hold),
    // 暂不优化的措施如果也做，在某一组措施之上还能再提升多少
    heldGainOver = (ids: Iterable<string>) => {
      const set = new Set(ids);
      return held.length
        ? availabilityOf(new Set([...set, ...held])) - availabilityOf(set)
        : 0;
    };
  const removable =
    score(active) >= 1
      ? model.measures
          .filter((m) => {
            if (!m.enabled) return false;
            const rest = new Set(active);
            rest.delete(m.id);
            return score(rest) >= 1;
          })
          .map((m) => m.id)
      : [];
  if (score(active) >= 1)
    return {
      kind: "met",
      add: [],
      availability: current,
      ceiling,
      shortfall: 0,
      furtherReduction: 0,
      removable,
      minimal: true,
      held,
      heldGain: heldGainOver(active),
    };
  const withAdded = (picked: Measure[]) =>
    availabilityOf(new Set([...active, ...picked.map((m) => m.id)]));
  const scoreAdded = (picked: Measure[]) =>
    score(new Set([...active, ...picked.map((m) => m.id)]));
  let best: { ids: string[]; rank: number; availability: number } | null = null;
  // 先按数量从少到多穷举，找到即为“最少补充”；组合数超出预算时改用逐步加入。
  let budget = searchBudget;
  for (let size = 1; size <= candidates.length && !best; size++) {
    let combos = 1;
    for (let i = 0; i < size; i++)
      combos = (combos * (candidates.length - i)) / (i + 1);
    if (combos > budget) break;
    budget -= combos;
    const index = Array.from({ length: size }, (_, i) => i);
    for (;;) {
      const picked = index.map((i) => candidates[i]),
        value = withAdded(picked);
      if (scoreAdded(picked) >= 1) {
        const rank = picked.reduce(
          (sum, m) => sum + evidenceRank[m.evidence],
          0,
        );
        if (
          !best ||
          rank < best.rank ||
          (rank === best.rank && value > best.availability)
        )
          best = { ids: picked.map((m) => m.id), rank, availability: value };
      }
      let at = size - 1;
      while (at >= 0 && index[at] === candidates.length - size + at) at--;
      if (at < 0) break;
      index[at]++;
      for (let k = at + 1; k < size; k++) index[k] = index[k - 1] + 1;
    }
  }
  const minimal = !!best;
  let reach: Measure[] = [];
  if (!best) {
    // 逐步加入边际收益最大的措施；有些措施带代价，所以只在确有提升时加入。
    let value = score(active);
    for (;;) {
      let pick: { measure: Measure; value: number } | null = null;
      for (const measure of candidates) {
        if (reach.includes(measure)) continue;
        const next = scoreAdded([...reach, measure]);
        if (!pick || next > pick.value) pick = { measure, value: next };
      }
      if (!pick || pick.value <= value + 1e-12) break;
      reach.push(pick.measure);
      value = pick.value;
      if (value >= 1) break;
    }
    if (value >= 1) {
      // 达标后剔除去掉也不影响达标的项。
      for (const measure of [...reach].reverse()) {
        const fewer = reach.filter((m) => m !== measure);
        if (scoreAdded(fewer) >= 1) reach = fewer;
      }
      best = {
        ids: reach.map((m) => m.id),
        rank: 0,
        availability: withAdded(reach),
      };
    }
  }
  if (best)
    return {
      kind: "add",
      add: best.ids,
      availability: best.availability,
      ceiling: Math.max(ceiling, best.availability),
      shortfall: 0,
      furtherReduction: 0,
      removable: [],
      minimal,
      held,
      heldGain: heldGainOver([...active, ...best.ids]),
    };
  const reachIds = new Set([...active, ...reach.map((m) => m.id)]),
    full = assess(model, applyMeasures(model, reachIds)).system,
    allowed = (1 - full.overhead) / target - 1;
  return {
    kind: "short",
    add: reach.map((m) => m.id),
    availability: full.availability,
    ceiling: full.availability,
    shortfall: Math.max(0, target - full.availability),
    furtherReduction:
      full.load > 0 ? Math.min(1, Math.max(0, 1 - allowed / full.load)) : 0,
    removable: [],
    minimal: false,
    held,
    heldGain: heldGainOver(reachIds),
  };
}

/**
 * 参数反推：其余措施保持不变，求某项措施的某个参数取多少才能刚好达标。
 * 可用度对每个参数单调，用二分法求解；返回 null 表示把该参数做到极限也不够。
 */
export function solveEffect(
  model: CoreModel,
  measureId: string,
  effectIndex = 0,
): { value: number; reachable: boolean } | null {
  const measure = model.measures.find((m) => m.id === measureId),
    effect = measure?.effects[effectIndex];
  if (!measure || !effect) return null;
  // 综合得分不小于 1 即系统目标和各固定域目标都满足。
  const target = 1;
  const evaluate = (value: number) => {
    const trial: CoreModel = {
      ...model,
      measures: model.measures.map((m) =>
        m.id === measureId
          ? {
              ...m,
              enabled: true,
              effects: m.effects.map((e, i) =>
                i === effectIndex ? { ...e, value } : e,
              ),
            }
          : m,
      ),
    };
    return goalEvaluator(trial)(
      new Set(trial.measures.filter((m) => m.enabled).map((m) => m.id)),
    );
  };
  // 比例降低、绝对节省和越大越好的参数取大值，其余目标值越小越好。
  const best =
    effect.op === "subtract"
      ? largestBase(model, measure, effect.param)
      : effect.op === "reduce" || higherIsBetter(effect.param)
        ? 1
        : 0;
  if (evaluate(best) < target) return { value: best, reachable: false };
  if (evaluate(effect.value) >= target)
    return { value: effect.value, reachable: true };
  let good = best,
    bad = effect.value;
  for (let i = 0; i < 60; i++) {
    const middle = (good + bad) / 2;
    if (evaluate(middle) >= target) good = middle;
    else bad = middle;
  }
  return { value: good, reachable: true };
}

/** 措施作用对象里某个参数的最大现值：绝对节省最多只能省到这么多。 */
const largestBase = (
  model: CoreModel,
  measure: Measure,
  param: Measure["effects"][number]["param"],
) =>
  param === "overhead"
    ? model.scenario.overhead
    : Math.max(
        0,
        ...model.modes
          .filter((mode) => measure.modeIds.includes(mode.id))
          .map((mode) => readParam(mode, param)),
      );
/**
 * 措施主要参数的理想极限：按比例降低的做到 100%，绝对节省的省掉全部现值，
 * 越大越好的做到 1，其余做到 0。
 */
const limitOf = (model: CoreModel, measure: Measure) => {
  const effect = measure.effects[0];
  return effect.op === "subtract"
    ? largestBase(model, measure, effect.param)
    : effect.op === "reduce" || higherIsBetter(effect.param)
      ? 1
      : 0;
};
/** 措施主要参数的现值：作用对象里离极限最远的那个，作为“改进程度”的起点。 */
function startOf(model: CoreModel, measure: Measure) {
  const effect = measure.effects[0];
  if (effect.op === "reduce" || effect.op === "subtract") return 0;
  if (effect.param === "overhead") return model.scenario.overhead;
  const param = effect.param,
    values = model.modes
      .filter((mode) => measure.modeIds.includes(mode.id))
      .map((mode) => readParam(mode, param));
  if (!values.length) return effect.value;
  return higherIsBetter(param) ? Math.min(...values) : Math.max(...values);
}

export interface DoseResponse {
  id: string;
  name: string;
  /** 计划取值相当于走到了多大的改进程度（0–1）。 */
  planned: number;
  /** 计划取值下相对“不做这项措施”的可用度提升。 */
  plannedGain: number;
  points: Array<{
    /** 改进程度：0 为现状，1 为理想极限。 */
    degree: number;
    /** 这一程度下主要参数的取值。 */
    value: number;
    /** 相对“不做这项措施”的可用度提升。 */
    gain: number;
  }>;
}
/**
 * 改进程度—收益曲线：把一项措施从“不做”（0）逐步推到主要参数的理想极限（1），
 * 其余措施保持当前的启用状态，看系统可用度提升多少。
 * 计划点之前，措施的全部参数按同一比例从现状走向计划值；计划点之后，主要参数（第一项
 * 参数变化）继续走向极限，其余参数停在计划值。“增加”类的代价项不作为主要参数。
 */
export function doseResponse(
  model: CoreModel,
  measureId: string,
  steps = 10,
): DoseResponse | null {
  const measure = model.measures.find((m) => m.id === measureId);
  if (!measure || measure.effects[0].op === "add") return null;
  const start = startOf(model, measure),
    limit = limitOf(model, measure),
    span = limit - start;
  if (Math.abs(span) < 1e-15) return null;
  const others = new Set(
    model.measures
      .filter((m) => m.enabled && m.id !== measureId)
      .map((m) => m.id),
  );
  const without = createEvaluator(model)(others),
    withMeasure = new Set([...others, measureId]),
    trial = (change: Partial<Measure>): CoreModel => ({
      ...model,
      measures: model.measures.map((m) =>
        m.id === measureId ? { ...m, ...change } : m,
      ),
    });
  const planned = Math.min(
    1,
    Math.max(0, (measure.effects[0].value - start) / span),
  );
  const gainAt = (degree: number) => {
    if (degree <= 0) return 0;
    const scaled =
      degree < planned
        ? // 还没做到计划：全部参数按同一比例打折
          trial({
            applicability: measure.applicability * (degree / planned),
          })
        : trial({
            effects: measure.effects.map((e, i) =>
              i === 0 ? { ...e, value: start + degree * span } : e,
            ),
          });
    return createEvaluator(scaled)(withMeasure) - without;
  };
  return {
    id: measure.id,
    name: measure.name,
    planned,
    plannedGain: createEvaluator(model)(withMeasure) - without,
    points: Array.from({ length: steps + 1 }, (_, i) => {
      const degree = i / steps;
      return { degree, value: start + degree * span, gain: gainAt(degree) };
    }),
  };
}

export interface EffectSweep {
  param: Measure["effects"][number]["param"];
  op: Measure["effects"][number]["op"];
  /** 扫描起点（不改这个参数时的取值）与理想极限。 */
  start: number;
  limit: number;
  /** 计划取值，以及计划取值下的系统可用度。 */
  planned: number;
  plannedAvailability: number;
  /** 不做这项措施时的系统可用度。 */
  without: number;
  points: Array<{ value: number; availability: number }>;
}
/**
 * 单个参数的取值—收益曲线：措施的其余参数停在计划值、其余措施保持当前启用状态，
 * 把这一个参数从“不改”一路推到理想极限，逐点给出系统可用度。
 * “增加”类的代价项没有极限，扫到计划值的两倍。
 */
export function effectSweep(
  model: CoreModel,
  measureId: string,
  effectIndex = 0,
  steps = 20,
): EffectSweep | null {
  const measure = model.measures.find((m) => m.id === measureId),
    effect = measure?.effects[effectIndex];
  if (!measure || !effect) return null;
  const { param, op } = effect,
    values =
      param === "overhead"
        ? [model.scenario.overhead]
        : model.modes
            .filter((mode) => measure.modeIds.includes(mode.id))
            .map((mode) => readParam(mode, param)),
    start =
      op !== "set" || !values.length
        ? op === "set"
          ? effect.value
          : 0
        : higherIsBetter(param)
          ? Math.min(...values)
          : Math.max(...values),
    limit =
      op === "add"
        ? Math.max(effect.value * 2, 1e-6)
        : op === "subtract"
          ? largestBase(model, measure, param)
          : op === "reduce" || higherIsBetter(param)
            ? 1
            : 0;
  if (Math.abs(limit - start) < 1e-15) return null;
  const others = model.measures
      .filter((m) => m.enabled && m.id !== measureId)
      .map((m) => m.id),
    active = new Set([...others, measureId]),
    at = (value: number) =>
      createEvaluator({
        ...model,
        measures: model.measures.map((m) =>
          m.id === measureId
            ? {
                ...m,
                effects: m.effects.map((e, i) =>
                  i === effectIndex ? { ...e, value } : e,
                ),
              }
            : m,
        ),
      })(active);
  return {
    param,
    op,
    start,
    limit,
    planned: effect.value,
    plannedAvailability: at(effect.value),
    without: createEvaluator(model)(new Set(others)),
    points: Array.from({ length: steps + 1 }, (_, i) => {
      const value = start + (i / steps) * (limit - start);
      return { value, availability: at(value) };
    }),
  };
}

export interface PathStep {
  id: string;
  name: string;
  category: MeasureCategory;
  /** 加入这一项带来的提升。 */
  gain: number;
  /** 只做这一项（其余都不做）时的提升。 */
  standalone: number;
  /** 加入后的系统可用度。 */
  availability: number;
  /** 当前设计里是否已启用。 */
  enabled: boolean;
  /**
   * 与这一步的收益关系最大的前序措施。
   * overlap：有它在，这一步的收益变小（两者省的是同一段损失）；
   * boost：有它在，这一步的收益变大（它让更多故障走到这一步改进的环节，或削掉了别的损失）。
   * gainWithout 是把它从前序措施里拿掉后，这一步能带来的提升。
   */
  partner: {
    id: string;
    name: string;
    kind: "overlap" | "boost";
    gainWithout: number;
  } | null;
}
/**
 * 组合收益路径：从现状出发，每一步加入“在已选措施基础上提升最大”的那一项。
 * 排在前面的就是考虑了相互重叠之后最值得先做的措施；没有提升的不再加入。
 * 标了“暂不优化”的措施不参与排序。
 */
export function priorityPath(
  model: CoreModel,
  limit = 30,
  /** 只在这些措施里排序（如只看已启用的措施）；不给则用措施库里全部参与设计的措施。 */
  only?: ReadonlySet<string>,
) {
  const evaluate = createEvaluator(model),
    chosen = new Set<string>(),
    base = evaluate(chosen),
    steps: PathStep[] = [],
    pool = model.measures.filter((m) => (only ? only.has(m.id) : !isHeld(m)));
  let current = base;
  while (steps.length < limit) {
    let pick: { measure: Measure; value: number } | null = null;
    for (const measure of pool) {
      if (chosen.has(measure.id)) continue;
      chosen.add(measure.id);
      const value = evaluate(chosen);
      chosen.delete(measure.id);
      if (!pick || value > pick.value) pick = { measure, value };
    }
    if (!pick || pick.value <= current + 1e-9) break;
    const gain = pick.value - current,
      standalone = evaluate(new Set([pick.measure.id])) - base;
    // 单独做与排在这一步的收益差得明显时，找出造成差别最大的那项前序措施
    let partner: PathStep["partner"] = null;
    const shift = gain - standalone;
    if (Math.abs(shift) > Math.max(0.001, 0.1 * Math.abs(standalone))) {
      for (const earlier of steps) {
        const rest = new Set(chosen);
        rest.delete(earlier.id);
        const before = evaluate(rest);
        rest.add(pick.measure.id);
        const gainWithout = evaluate(rest) - before,
          // 拿掉它之后收益往“单独做”的方向回去多少
          explained = shift < 0 ? gainWithout - gain : gain - gainWithout;
        if (
          explained > 1e-9 &&
          (!partner ||
            explained >
              (shift < 0
                ? partner.gainWithout - gain
                : gain - partner.gainWithout))
        )
          partner = {
            id: earlier.id,
            name: earlier.name,
            kind: shift < 0 ? "overlap" : "boost",
            gainWithout,
          };
      }
    }
    chosen.add(pick.measure.id);
    steps.push({
      id: pick.measure.id,
      name: pick.measure.name,
      category: pick.measure.category,
      gain,
      standalone,
      availability: pick.value,
      enabled: pick.measure.enabled,
      partner,
    });
    current = pick.value;
  }
  // 达标看综合得分：系统目标和各固定域目标都满足。
  const score = goalEvaluator(model),
    picked = new Set<string>(),
    reached = steps.findIndex((step) => {
      picked.add(step.id);
      return score(picked) >= 1;
    });
  return {
    base,
    steps,
    reachedAt: reached < 0 ? null : reached + 1,
    held: model.measures.filter(isHeld).map((m) => m.id),
  };
}

/**
 * “至少做到什么程度”：在给定的一组措施里，其余各项按计划做足，
 * 求某一项最少要兑现计划的百分之几，系统才刚好达标。
 * 返回 0 表示这一项可以不做，1 表示必须做足；整组做足也不达标时返回 null。
 */
export function minimumDegrees(model: CoreModel, ids: string[]) {
  // 达标看综合得分：系统目标和各固定域目标都满足时不小于 1。
  const target = 1,
    set = new Set(ids),
    result = new Map<string, number | null>();
  const full = goalEvaluator(model)(set);
  for (const id of ids) {
    if (full < target) {
      result.set(id, null);
      continue;
    }
    const scaled = (share: number) =>
      goalEvaluator({
        ...model,
        measures: model.measures.map((m) =>
          m.id === id ? { ...m, applicability: m.applicability * share } : m,
        ),
      })(set);
    if (scaled(0) >= target) {
      result.set(id, 0);
      continue;
    }
    let low = 0,
      high = 1;
    for (let i = 0; i < 40; i++) {
      const middle = (low + high) / 2;
      if (scaled(middle) >= target) high = middle;
      else low = middle;
    }
    result.set(id, high);
  }
  return result;
}

/**
 * 两个方向各能补多少：只启用措施库里全部组件级措施、只启用全部系统级措施、或两边都启用时，
 * 每个模块的损失负荷相对现状能降低多少（0–1）。用来判断差距该优先从哪边补。
 * 标了“暂不优化”的措施不计入。
 */
export function layerPotential(model: CoreModel) {
  const loadsWith = (ids: string[]) =>
      new Map(
        assess(model, applyMeasures(model, new Set(ids))).modules.map((m) => [
          m.id,
          m.load,
        ]),
      ),
    idsOf = (layer: MeasureLayer) =>
      model.measures
        .filter((m) => layerOf(m.category) === layer && !isHeld(m))
        .map((m) => m.id),
    base = loadsWith([]),
    component = loadsWith(idsOf("component")),
    system = loadsWith(idsOf("system")),
    both = loadsWith([...idsOf("component"), ...idsOf("system")]),
    cut = (after: number | undefined, before: number) =>
      before > 0 ? Math.max(0, 1 - (after ?? before) / before) : 0;
  return new Map(
    [...base].map(([id, load]) => [
      id,
      {
        component: cut(component.get(id), load),
        system: cut(system.get(id), load),
        both: cut(both.get(id), load),
      },
    ]),
  );
}

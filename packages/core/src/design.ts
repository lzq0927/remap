import type { CoreModel, EvidenceState, Measure } from "./model";
import { applyMeasures, assess } from "./assess";

const availabilityOf = (model: CoreModel, enabled: ReadonlySet<string>) =>
  assess(model, applyMeasures(model, enabled)).system.availability;
const enabledIds = (model: CoreModel) =>
  model.measures.filter((m) => m.enabled).map((m) => m.id);

/** 精确枚举的上限：2^14 个子集，每个只需一次解析评估。 */
export const exactSubsetLimit = 14;

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
    result = new Map<string, number>(ids.map((id) => [id, 0]));
  if (!n) return { values: result, exact: true };
  if (n <= exactSubsetLimit) {
    const size = 1 << n,
      value = new Float64Array(size);
    for (let mask = 0; mask < size; mask++)
      value[mask] = availabilityOf(
        model,
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
    let previous = availabilityOf(model, active);
    for (const id of order) {
      active.add(id);
      const next = availabilityOf(model, active);
      result.set(id, result.get(id)! + (next - previous) / samples);
      previous = next;
    }
  }
  return { values: result, exact: false };
}

export interface MeasureContribution {
  id: string;
  name: string;
  direction: Measure["direction"];
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
    activeSet = new Set(active),
    base = availabilityOf(model, new Set()),
    designed = availabilityOf(model, activeSet),
    shares = shapley(model, active);
  const items: MeasureContribution[] = model.measures.map((measure) => {
    const toggled = new Set(activeSet);
    if (measure.enabled) toggled.delete(measure.id);
    else toggled.add(measure.id);
    const other = availabilityOf(model, toggled);
    return {
      id: measure.id,
      name: measure.name,
      direction: measure.direction,
      enabled: measure.enabled,
      evidence: measure.evidence,
      standalone: availabilityOf(model, new Set([measure.id])) - base,
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
  /** met：现有设计已达标；add：补充这些措施即可达标；short：措施库全部启用仍不达标。 */
  kind: "met" | "add" | "short";
  /** 在已启用措施之外建议补充的措施。 */
  add: string[];
  availability: number;
  /** 启用措施库全部措施时的可用度。 */
  ceiling: number;
  /** 仍差多少可用度（kind 为 short 时大于 0）。 */
  shortfall: number;
  /** 不达标时：全部故障率或全部单次损失还需再降低的比例。 */
  furtherReduction: number;
  /** 已启用但去掉后仍达标的措施。 */
  removable: string[];
}

/**
 * 在已启用措施的基础上，找出达标所需补充的最少措施。
 * 数量相同时优先证据更充分的组合，其次优先可用度更高的组合。
 */
export function recommend(model: CoreModel): Recommendation {
  const target = model.scenario.target,
    active = new Set(enabledIds(model)),
    current = availabilityOf(model, active),
    all = new Set(model.measures.map((m) => m.id)),
    ceiling = availabilityOf(model, all),
    candidates = model.measures.filter((m) => !m.enabled);
  const removable =
    current >= target
      ? model.measures
          .filter((m) => {
            if (!m.enabled) return false;
            const rest = new Set(active);
            rest.delete(m.id);
            return availabilityOf(model, rest) >= target;
          })
          .map((m) => m.id)
      : [];
  if (current >= target)
    return {
      kind: "met",
      add: [],
      availability: current,
      ceiling,
      shortfall: 0,
      furtherReduction: 0,
      removable,
    };
  let best: { ids: string[]; rank: number; availability: number } | null = null;
  if (candidates.length <= exactSubsetLimit) {
    for (let mask = 1; mask < 1 << candidates.length; mask++) {
      const picked = candidates.filter((_, i) => mask & (1 << i));
      if (best && picked.length > best.ids.length) continue;
      const value = availabilityOf(
        model,
        new Set([...active, ...picked.map((m) => m.id)]),
      );
      if (value < target) continue;
      const rank = picked.reduce((sum, m) => sum + evidenceRank[m.evidence], 0);
      if (
        !best ||
        picked.length < best.ids.length ||
        rank < best.rank ||
        (rank === best.rank && value > best.availability)
      )
        best = { ids: picked.map((m) => m.id), rank, availability: value };
    }
  } else {
    // 候选过多时逐步加入边际收益最大的措施。
    const chosen = new Set(active),
      added: string[] = [];
    let value = current;
    while (value < target) {
      let pick: { id: string; value: number } | null = null;
      for (const measure of candidates) {
        if (chosen.has(measure.id)) continue;
        const next = availabilityOf(model, new Set([...chosen, measure.id]));
        if (!pick || next > pick.value) pick = { id: measure.id, value: next };
      }
      if (!pick || pick.value <= value) break;
      chosen.add(pick.id);
      added.push(pick.id);
      value = pick.value;
    }
    if (value >= target) best = { ids: added, rank: 0, availability: value };
  }
  if (best)
    return {
      kind: "add",
      add: best.ids,
      availability: best.availability,
      ceiling,
      shortfall: 0,
      furtherReduction: 0,
      removable: [],
    };
  const full = assess(model, applyMeasures(model, all)).system,
    allowed = (1 - full.overhead) / target - 1;
  return {
    kind: "short",
    add: candidates.map((m) => m.id),
    availability: ceiling,
    ceiling,
    shortfall: target - ceiling,
    furtherReduction:
      full.load > 0 ? Math.min(1, Math.max(0, 1 - allowed / full.load)) : 0,
    removable: [],
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
  const target = model.scenario.target;
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
    return availabilityOf(
      trial,
      new Set(trial.measures.filter((m) => m.enabled).map((m) => m.id)),
    );
  };
  // “降低比例”和检出率越大越好，其余参数越小越好。
  const best = effect.op === "reduce" || effect.param === "coverage" ? 1 : 0;
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

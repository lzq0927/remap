import { resolveAudit } from "../../../packages/analysis/src/audit";
import { resolveAuditArchitecture } from "../../../packages/contracts/src/audit-architecture";
import { architectureBudgets } from "../../../packages/analysis/src/audit-architecture";
import { hash } from "../../../packages/assets/src/hash";

export function allocationPreview(input: any) {
  const resolved = resolveAudit(input);
  const architecture = resolveAuditArchitecture(
    input.architecture,
    resolved.events,
  );
  // Before measured loss/Shapley evidence exists, expose a named design prior.
  // The later evidence allocation is a new result, never silently a changed target.
  const provisional = architecture.budgetMethod === "agree-evidence";
  const prior = provisional
    ? { ...architecture, budgetMethod: "agree" as const }
    : architecture;
  return {
    method: provisional
      ? "AGREE设计先验；评估后另列证据分配建议"
      : architecture.budgetMethod,
    provisional,
    basis:
      "固定窗口损失预算工程适配；重要度与复杂度为设计输入，不能当作器件独立可靠度。",
    architecture,
    scales: resolved.scales.map((cards) => {
      const target =
        cards === input.cards
          ? input.target
          : (input.targets?.[cards] ?? input.target);
      return {
        cards,
        target,
        hours: input.hours,
        allowedHours: input.hours * (1 - target),
        budgets: Object.fromEntries(
          architectureBudgets(
            prior,
            cards,
            input.hours,
            input.hours * (1 - target),
          ),
        ),
      };
    }),
  };
}

export function mechanismEvidence(run: any, selectedInput = run.input) {
  const selected = resolveAudit(selectedInput);
  return {
    sourceRunId: run.id,
    parameterHash: parameterHash(selectedInput),
    status: "已选机制参数待独立验证；新增/优化建议另建方案",
    selection: run.result.selection,
    attribution: run.result.attribution?.map((a: any) => ({
      cards: a.cards,
      trials: a.trials,
      gain: a.gain,
      contributions: a.contributions.map((c: any) => ({
        id: c.id,
        name: c.name,
        statistics: c.statistics,
      })),
    })),
    recommendations: run.result.recommendation && {
      scope: run.result.recommendation.scope,
      chosen: run.result.recommendation.chosen,
      shortlist: run.result.recommendation.shortlist?.slice(0, 3),
    },
    model: selected.model,
    policy: selected.policy,
    recoveryOrder: selected.recoveryOrder,
    boundary:
      "单项Shapley相对本轮冻结基线；现状、延长线、突破分别建快照，不把单项收益相加。候选机制的资源条件未满足时不领取收益。",
  };
}

export function parameterHash(input: any) {
  const {
    seed: _s,
    trials: _t,
    attribution: _a,
    attributionTrials: _at,
    attributionSeed: _as,
    sensitivity: _sn,
    sensitivityTrials: _st,
    sensitivitySeed: _ss,
    verifyRecommendation: _v,
    verificationTrials: _vt,
    samplingProfile: _p,
    ...parameters
  } = input;
  return hash(parameters);
}
export function verificationInput(input: any) {
  return {
    ...structuredClone(input),
    trials: input.verificationTrials ?? input.trials,
    seed: ((input.seed >>> 0) ^ 0x9e3779b9) >>> 0,
    samplingProfile: "custom",
    attribution: false,
    sensitivity: false,
    verifyRecommendation: false,
  };
}

import { planningWork } from "./audit-planning-work";
import { auditExperimentPlan } from "./audit-experiment-plan";
import { validateOptimization } from "./audit-optimization";
import type { AuditSource } from "./audit-experiments";
import type { AuditOptimizationRequest } from "../../contracts/src/audit-optimization";
import {
  auditReferenceOnly,
  auditSummaryScales,
} from "../../contracts/src/audit-presets";
import { auditArchitectureDiagnosis } from "./audit-architecture";
export interface AuditPlanScalesInput {
  source: AuditSource;
  scales?: number[];
  options?: AuditOptimizationRequest;
}

export function validatePlanScales(input: AuditPlanScalesInput) {
  if (input.source?.result?.kind !== "expert-review-audit")
    throw new Error("分规模分配需要已完成的第一轮现状");
  const { source } = input;
  const available = source.result.rows
    .filter(
      (r: any) =>
        r.id === "combined" && !auditReferenceOnly(source.input, r.cards),
    )
    .map((r: any) => r.cards) as number[];
  const scales = input.scales ?? available;
  if (
    !Array.isArray(scales) ||
    !scales.length ||
    scales.length > 6 ||
    new Set(scales).size !== scales.length ||
    scales.some((n) => !Number.isInteger(n) || !available.includes(n))
  )
    throw new Error(
      "请选择1–6个已计算且设置需求目标的不同规模；参考点不能分配需求",
    );
  if (input.options?.planningCards !== undefined)
    throw new Error("逐规模分配请用scales指定范围，不使用单一planningCards");
  validateOptimization({
    ...source.input,
    optimization: { ...input.options, enabled: true },
  });
  if (
    scales.some(
      (cards) =>
        !source.result.attribution?.some(
          (a: any) => a.cards === cards && a.contributions?.length,
        ),
    )
  )
    throw new Error(
      "部分规模没有第一轮Shapley贡献，请先补充现状计算或选择已有贡献的规模",
    );
  const trials = input.options?.screeningTrials ?? 128;
  const work = planningWork(source, scales, trials);
  if (work.trajectories > 1000000 || work.events > 450000000)
    throw new Error("分规模规划总工作量超过上限，请减少规模或规划采样量");
  return auditSummaryScales(source.input, scales);
}
/** Each size solves its OWN requirement; no universal strict-parameter envelope. */
export function auditPlanScales(
  input: AuditPlanScalesInput,
  onProgress?: (fraction: number) => void,
) {
  const scales = validatePlanScales(input),
    { source } = input;
  const plans = scales.map((cards, i) =>
    auditExperimentPlan(
      {
        source,
        options: { ...input.options, enabled: true, planningCards: cards },
      },
      (fraction) => onProgress?.((i + fraction) / scales.length),
    ),
  );
  onProgress?.(1);
  return {
    kind: "expert-audit-plan-set",
    name: "各规模可靠性改进分配",
    modelVersion: "agree-per-scale.v1",
    metricId: "training.retained-clean-progress",
    sourceRunId: source.id,
    sourceInputHash: source.inputHash,
    request: structuredClone(source.input),
    selection: source.result.selection,
    architectureDiagnosis:
      source.result.architectureDiagnosis ??
      auditArchitectureDiagnosis({ ...source.result, request: source.input }),
    plans,
    scenarioEvaluated: false,
    assumptions: [
      "各规模从同一冻结现状出发，分别使用自己的可用度目标、薄弱点和Shapley重要度进行AGREE分配。",
      "每个规模有独立的措施与参数配置；不合并最严参数，也不把某一规模的方案宣称为所有规模通用最优。",
      "曲线中改进值是不同配置的规划试算，不是已完成的独立改进评估；采样误差、工程可行性和成本需要进一步验证。",
      "载入某规模建议后再单独点击评估；源现状、工作流确认和历史结果不被改写。有限搜索未满足目标时保留缺口。",
    ],
  };
}

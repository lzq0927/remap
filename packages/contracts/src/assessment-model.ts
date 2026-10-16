/** Stable metric labels shared by the workspace, history and exported reports. */
export const assessmentModels = {
  audit: {
    name: "专家审核口径",
    metricId: "training.retained-clean-progress",
    description: "期末仍有污染时，保留最后干净检查点的正确进度。",
  },
  workflow: {
    name: "历史模型 V4",
    metricId: "training.correct-delivery",
    description: "期末污染未消除时，整条任务的交付产出清零。",
  },
} as const;

/** Interpret the frozen run, never the user's currently selected design model. */
export function runAssessmentModel(run: { operation: string; result?: any }) {
  if (
    [
      "audit",
      "audit-plan",
      "audit-plan-scales",
      "audit-experiment",
      "audit-compare",
    ].includes(run.operation) ||
    [
      "expert-review-audit",
      "expert-audit-plan-set",
      "expert-audit-plan",
      "expert-audit-experiment",
      "expert-audit-comparison",
    ].includes(run.result?.kind)
  )
    return assessmentModels.audit;
  if (
    ["training", "compare", "search", "sensitivity", "attribute"].includes(
      run.operation,
    )
  )
    return assessmentModels.workflow;
  return undefined;
}

import { auditDraftInput } from "../../../packages/contracts/src/audit-draft";
import { resolveAudit } from "../../../packages/analysis/src/audit";
/** Server-owned interpretation of the persisted design, never a client claim. */
export function designAssessment(design: any) {
  if (design.activeAssessment !== "audit")
    return {
      operation: "training",
      metricId: "training.correct-delivery",
      valid: true,
      input: design.request,
      issues: [],
    };
  try {
    const input = auditDraftInput(design.auditDraft);
    resolveAudit(input);
    return {
      operation: "audit",
      metricId: "training.retained-clean-progress",
      valid: true,
      input,
      issues: [],
    };
  } catch (error) {
    return {
      operation: "audit",
      metricId: "training.retained-clean-progress",
      valid: false,
      issues: [(error as Error).message],
    };
  }
}

import type { Run } from "../../contracts/src/types";
import type { Store } from "../../assets/src/store";
import { topologyDecision } from "../../analysis/src/audit-topology-decision";

/** Add report provenance without changing a solver's frozen result. */
export function workflowReportRun(store: Store, run: Run): Run {
  const binding = store
    .documents("run-binding")
    .find((b) => b.runId === run.id);
  if (!binding?.reviewRequired || !run.result) return run;
  const state = store.documents("workflow-state").at(-1);
  const reviewed =
    state?.executionId === binding.executionId &&
    state?.status === "succeeded" &&
    state?.steps.at(-1)?.confirmedBy === "user";
  const source = binding.verification?.sourceRunId
    ? store.getRun(binding.verification.sourceRunId)
    : undefined;
  const frozenTargets =
    source?.result &&
    (source.result.topologyDecision ?? topologyDecision(source.result));
  return {
    ...run,
    result: {
      ...run.result,
      ...(frozenTargets
        ? { topologyDecision: topologyDecision(run.result, frozenTargets) }
        : {}),
      workflowContext: {
        executionId: binding.executionId,
        inputRevision: binding.inputRevision,
        reviewRequired: !reviewed,
        verification: binding.verification,
      },
    },
  };
}

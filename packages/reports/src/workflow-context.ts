import type { Run } from "../../contracts/src/types";
import type { Store } from "../../assets/src/store";

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
    state?.steps[5]?.confirmedBy === "user";
  return {
    ...run,
    result: {
      ...run.result,
      workflowContext: {
        executionId: binding.executionId,
        inputRevision: binding.inputRevision,
        reviewRequired: !reviewed,
      },
    },
  };
}

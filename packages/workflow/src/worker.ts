process.once("message", async (message: any) => {
  try {
    const {
      assetSnapshot: _assetSnapshot,
      sourceSnapshot: _sourceSnapshot,
      assetRefs: _assetRefs,
      inputId: _inputId,
      ...input
    } = message.input;
    let result: any;
    if (message.operation === "engineering") {
      const { executeEngineering } = await import("../../modeling/src/execute");
      result = await executeEngineering(input);
    } else if (message.operation === "audit-plan-scales") {
      const { auditPlanScales } = await import(
        "../../analysis/src/audit-plan-scales"
      );
      result = auditPlanScales(input, (fraction) =>
        process.send?.({ type: "progress", progress: fraction }),
      );
    } else if (message.operation === "audit-plan") {
      const { auditExperimentPlan } = await import(
        "../../analysis/src/audit-experiment-plan"
      );
      result = auditExperimentPlan(input, (fraction) =>
        process.send?.({ type: "progress", progress: fraction }),
      );
    } else if (message.operation === "audit-experiment") {
      const { auditExperiment } = await import(
        "../../analysis/src/audit-experiments"
      );
      result = auditExperiment(input, (fraction) =>
        process.send?.({ type: "progress", progress: fraction }),
      );
    } else if (message.operation === "audit-compare") {
      const { compareAuditExperiments } = await import(
        "../../reports/src/audit-experiments"
      );
      result = compareAuditExperiments(input.snapshots);
    } else if (message.operation === "audit") {
      const { audit } = await import("../../analysis/src/audit");
      result = audit(input, (done: number, total: number) => {
        process.send?.({
          type: "progress",
          progress: done / total,
          payload: { done, total },
        });
      });
    } else if (message.operation === "training") {
      const { runTraining } = await import("../../solvers/src/training");
      result = runTraining(input, (done: number, total: number) => {
        if (done === total || done % Math.max(1, Math.floor(total / 50)) === 0)
          process.send?.({
            type: "progress",
            progress: done / total,
            payload: { done, total },
          });
      });
    } else if (["rbd", "fta", "bdd", "static"].includes(message.operation)) {
      const { solveStatic } = await import("../../solvers/src/static");
      result = solveStatic({
        ...input,
        method:
          message.operation === "static" ? input.method : message.operation,
      });
    } else if (message.operation === "ctmc") {
      const { solveCtmc } = await import("../../solvers/src/ctmc");
      result = await solveCtmc(input);
    } else if (message.operation === "allocate") {
      const { allocate } = await import("../../allocation/src/index");
      result = allocate(input);
    } else {
      const analysis: any = await import("../../analysis/src/index");
      const fn = analysis[message.operation];
      if (!fn) throw new Error("未知分析操作 " + message.operation);
      result = await fn(input);
    }
    await new Promise<void>((resolve, reject) =>
      process.send?.({ type: "result", result }, (error: Error | null) =>
        error ? reject(error) : resolve(),
      ),
    );
  } catch (error: any) {
    await new Promise<void>((resolve) =>
      process.send?.(
        {
          type: "error",
          error: {
            code: error.code ?? "SOLVER_FAILED",
            message: error.message,
          },
        },
        () => resolve(),
      ),
    );
  } finally {
    process.disconnect();
  }
});

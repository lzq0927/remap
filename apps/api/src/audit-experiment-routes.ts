import type { FastifyInstance } from "fastify";
import type { TaskServices } from "../../../packages/tasks/src/service";
import { DomainError } from "../../../packages/contracts/src/errors";
import {
  validateExperiment,
  type AuditSource,
} from "../../../packages/analysis/src/audit-experiments";
import { compareAuditExperiments } from "../../../packages/reports/src/audit-experiments";
import { validateOptimization } from "../../../packages/analysis/src/audit-optimization";

export function registerAuditExperimentRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
) {
  const sourceFor = (req: any): AuditSource => {
    const context = tasks.authorize(req, req.params.taskId);
    if (typeof req.body?.sourceRunId !== "string" || !req.body.sourceRunId)
      throw new DomainError(
        "AUDIT_SOURCE_REQUIRED",
        "请提供已完成的第一轮运行",
      );
    const run = context.store.getRun(req.body?.sourceRunId);
    if (
      run.status !== "succeeded" ||
      run.result?.kind !== "expert-review-audit"
    )
      throw new DomainError("AUDIT_SOURCE_REQUIRED", "请先完成第一轮现状评估");
    // Server freezes the source; clients cannot supply a modified first-round snapshot.
    return {
      id: run.id,
      inputHash: run.inputHash,
      createdAt: run.createdAt,
      input: structuredClone(run.result.request),
      result: structuredClone({
        kind: run.result.kind,
        metricId: run.result.metricId,
        modelVersion: run.result.modelVersion,
        config: run.result.config,
        selection: run.result.selection,
        architectureDiagnosis: run.result.architectureDiagnosis,
        events: run.result.events,
        baseline: run.result.baseline,
        rows: run.result.rows
          .filter((row: any) => row.id === "combined")
          .map(({ values: _values, ...row }: any) => row),
        attribution: run.result.attribution.map(
          ({ coalitions: _coalitions, ...attribution }: any) => attribution,
        ),
      }),
    };
  };
  app.post("/api/tasks/:taskId/audit/plan", async (req: any) => {
    const source = sourceFor(req);
    const options = { enabled: true, ...req.body?.options };
    validateOptimization({ ...source.input, optimization: options });
    return tasks
      .authorize(req, req.params.taskId)
      .runs.start(
        "audit-plan",
        { source, options },
        req.headers["idempotency-key"],
      );
  });
  app.post("/api/tasks/:taskId/audit/evaluate", async (req: any) => {
    const source = sourceFor(req);
    const input = {
      source,
      name: req.body?.name ?? "自定义改进方案",
      configuration: {
        ...req.body?.configuration,
        enabled: true,
        autoTune: false,
      },
    };
    if (req.body?.planRunId) {
      const plan = tasks
        .authorize(req, req.params.taskId)
        .store.getRun(req.body.planRunId);
      if (
        plan.status !== "succeeded" ||
        plan.result?.kind !== "expert-audit-plan" ||
        plan.result.sourceRunId !== source.id
      )
        throw new DomainError(
          "AUDIT_PLAN_INVALID",
          "分配建议必须来自本次冻结的第一轮",
        );
      Object.assign(input, {
        plan: {
          id: plan.id,
          inputHash: plan.inputHash,
          result: structuredClone(plan.result),
        },
      });
    }
    validateExperiment(input);
    return tasks
      .authorize(req, req.params.taskId)
      .runs.start("audit-experiment", input, req.headers["idempotency-key"]);
  });
  app.post("/api/tasks/:taskId/audit/compare", async (req: any) => {
    const { store, runs } = tasks.authorize(req, req.params.taskId);
    const ids = req.body?.runIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 2 ||
      ids.length > 12 ||
      new Set(ids).size !== ids.length
    )
      throw new DomainError(
        "AUDIT_COMPARE_INVALID",
        "请选择2–12次不同的已完成评估",
      );
    const snapshots = ids.map((id: string) => store.getRun(id));
    const result = compareAuditExperiments(snapshots);
    const run = runs.start(
      "audit-compare",
      { snapshots },
      req.headers["idempotency-key"],
    );
    return runs.complete(run.id, result);
  });
}

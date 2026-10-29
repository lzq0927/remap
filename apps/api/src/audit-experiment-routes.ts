import { validatePlanScales } from "../../../packages/analysis/src/audit-plan-scales";
import { validatePlanningSource } from "../../../packages/analysis/src/audit-planning-bounds";
import { planningWork } from "../../../packages/analysis/src/audit-planning-work";
import type { FastifyInstance } from "fastify";
import type { TaskServices } from "../../../packages/tasks/src/service";
import { DomainError } from "../../../packages/contracts/src/errors";
import {
  validateExperiment,
  experimentFactors,
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
    validatePlanningSource(source, options.planning);
    const work = planningWork(
      source,
      [options.planningCards ?? source.input.cards],
      options.screeningTrials ?? 128,
    );
    if (work.trajectories > 1000000 || work.events > 450000000)
      throw new Error("规划总工作量超过上限，请减少采样或评估范围");
    return tasks
      .authorize(req, req.params.taskId)
      .runs.start(
        "audit-plan",
        { source, options },
        req.headers["idempotency-key"],
      );
  });
  app.post("/api/tasks/:taskId/audit/plan-scales", async (req: any) => {
    const input = {
      source: sourceFor(req),
      scales: req.body?.scales,
      options: { ...req.body?.options, enabled: true },
    };
    validatePlanScales(input);
    validatePlanningSource(input.source, input.options.planning);
    return tasks
      .authorize(req, req.params.taskId)
      .runs.start("audit-plan-scales", input, req.headers["idempotency-key"]);
  });
  app.post("/api/tasks/:taskId/audit/evaluate", async (req: any) => {
    const source = sourceFor(req);
    if (req.body?.planAlternativeId !== undefined && !req.body?.planRunId)
      throw new DomainError(
        "AUDIT_PLAN_INVALID",
        "选择备选方案时需要提供原规划运行",
      );
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
        !["expert-audit-plan", "expert-audit-plan-set"].includes(
          plan.result?.kind,
        ) ||
        plan.result.sourceRunId !== source.id
      )
        throw new DomainError(
          "AUDIT_PLAN_INVALID",
          "分配建议必须来自本次冻结的第一轮",
        );
      let selectedPlan =
        plan.result.kind === "expert-audit-plan-set"
          ? plan.result.plans.find(
              (p: any) => p.prediction.cards === req.body?.planCards,
            )
          : plan.result;
      if (
        !selectedPlan ||
        (plan.result.kind === "expert-audit-plan" &&
          req.body?.planCards !== undefined &&
          req.body.planCards !== selectedPlan.prediction.cards)
      )
        throw new DomainError(
          "AUDIT_PLAN_INVALID",
          "请选择分配建议中对应的规划规模",
        );
      if (req.body?.planAlternativeId !== undefined) {
        const alternative = selectedPlan.decisionStudy?.alternatives.find(
          (a: any) => a.id === req.body.planAlternativeId,
        );
        if (!alternative)
          throw new DomainError(
            "AUDIT_PLAN_INVALID",
            "备选方案不属于当前规模的规划",
          );
        selectedPlan = {
          ...selectedPlan,
          alternativeId: alternative.id,
          configuration: structuredClone(alternative.configuration),
          factors: experimentFactors(source, alternative.configuration).map(
            (f) => ({
              ...f,
              source:
                selectedPlan.factors.find((old: any) => old.id === f.id)
                  ?.source ?? f.source,
            }),
          ),
          prediction: {
            ...selectedPlan.prediction,
            mean: alternative.nominal.statistics.mean,
          },
        };
      }
      Object.assign(input, {
        plan: {
          id: plan.id,
          inputHash: plan.inputHash,
          result: structuredClone(selectedPlan),
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
    const studyIds = req.body?.mechanismStudyRunIds ?? [];
    if (
      !Array.isArray(studyIds) ||
      studyIds.length > 6 ||
      studyIds.some((id: unknown) => typeof id !== "string")
    )
      throw new DomainError("AUDIT_COMPARE_INVALID", "增量收益研究ID格式无效");
    const studies = studyIds.map((id: string) => store.getRun(id));
    const result = compareAuditExperiments(snapshots, studies);
    const run = runs.start(
      "audit-compare",
      { snapshots, mechanismStudies: studies },
      req.headers["idempotency-key"],
    );
    const completed = runs.complete(run.id, result);
    return req.query?.view === "result"
      ? {
          id: completed.id,
          status: completed.status,
          operation: completed.operation,
          result: completed.result,
        }
      : completed;
  });
}

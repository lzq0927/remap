import {
  setTimeout as pause,
  setImmediate as yieldStage,
} from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import type { TaskServices } from "../../../packages/tasks/src/service";
import type { WorkflowService } from "../../../packages/workflow/src/service";
import { DomainError } from "../../../packages/contracts/src/errors";
import { resolveAudit } from "../../../packages/analysis/src/audit";
import { report } from "../../../packages/reports/src/report";
import { workflowReportRun } from "../../../packages/reports/src/workflow-context";

/** Deterministic orchestration shared by native Agent/MCP and LUI; chat is not the state store. */
export function registerAutomaticWorkflow(
  app: FastifyInstance,
  tasks: TaskServices,
  flow: (id: string) => WorkflowService,
  stageDisplayMs = 2000,
) {
  const active = new Map<string, AbortController>();
  app.addHook("onClose", async () => {
    for (const controller of active.values()) controller.abort();
  });
  app.post("/api/tasks/:taskId/workflow/automatic", async (req: any, reply) => {
    const context = tasks.authorize(req, req.params.taskId),
      service = flow(context.task.id);
    const design = context.store.documents("design").at(-1);
    if (!design || design.revision !== req.body?.inputRevision)
      throw new DomainError(
        "INPUT_REVISION_CONFLICT",
        "请读取并保存当前设计版本",
        409,
      );
    if (
      design.scenario !== "training" ||
      design.assessment?.operation !== "audit" ||
      !design.assessment.valid
    )
      throw new DomainError(
        "INPUT_UNCONFIRMED",
        "自动流水线需要有效的训练审核设计；其他场景使用交互协助",
      );
    const previous = service.get();
    if (
      active.has(context.task.id) ||
      (previous.status === "active" && !previous.stale)
    )
      throw new DomainError(
        "EXECUTION_CONFLICT",
        "当前流程仍在执行或待审核；请继续或取消后重启",
        409,
      );
    const input = structuredClone(design.assessment.input),
      resolved = resolveAudit(input);
    if (
      !input.lossBudgetWeights &&
      !["equal", "baseline-proportional"].includes(input.lossBudgetMethod)
    )
      throw new DomainError("INPUT_UNCONFIRMED", "请先选择损失预算分配方法");
    const started = service.start(
      { inputRevision: design.revision, mode: "auto-to-review" },
      context.actor,
    );
    const controller = new AbortController();
    active.set(context.task.id, controller);
    const execute = async () => {
      const current = () => {
        const state = service.get();
        if (
          controller.signal.aborted ||
          state.executionId !== started.executionId ||
          state.status !== "active" ||
          state.stale
        )
          throw new DomainError(
            "WORKFLOW_CANCELLED",
            "执行已取消或输入已改变",
            409,
          );
        return state;
      };
      const record = (
        stepId: string,
        status: string,
        artifacts: any[],
        notes: string,
      ) => {
        const state = current();
        return service.record(
          {
            executionId: state.executionId,
            expectedRevision: state.revision,
            inputRevision: state.inputRevision,
            stepId,
            status,
            artifacts,
            notes,
          },
          "agent",
        );
      };
      try {
        await yieldStage();
        const stages = [
          {
            id: "clarify",
            type: "task-brief",
            data: {
              target: input.target,
              targets: input.targets,
              cards: input.cards,
              hours: input.hours,
              metricId: design.assessment.metricId,
            },
            note: "采用当前已保存需求；自动完成不表示人工确认，外网先验仍需审核。",
          },
          {
            id: "describe",
            type: "architecture",
            data: {
              events: resolved.events,
              baseline: {
                resolvedEvents: resolved.baseline.resolvedEvents,
                note: resolved.baseline.note,
              },
            },
            note: "冻结当前故障对象、类型、FIT 与来源；没有架构文件时使用参考场景，不能视作真实架构已校验。",
          },
          {
            id: "select",
            type: "method-plan",
            data: {
              submodel: resolved.submodelPlan,
              lossBudgetMethod: input.lossBudgetMethod ?? "custom",
              lossBudgetWeights: input.lossBudgetWeights,
            },
            note: "先分配目标；基线比例预算在基线样本完成后、候选措施计算前冻结。Shapley 使用真实组合结果。",
          },
          {
            id: "prepare",
            type: "mechanism-plan",
            data: {
              mechanisms: resolved.mechanisms,
              deployedMechanisms: resolved.baseline.mechanisms,
              candidateFitOverrides: input.candidateFitOverrides,
              recoveryOrder: resolved.recoveryOrder,
              model: input.model,
              policy: input.policy,
              costs: input.costs,
            },
            note: "冻结硬件目标、已部署与新增措施、机制参数及物理恢复顺序；源 FIT 与故障后果分开计算。",
          },
        ];
        for (const stage of stages) {
          record(
            stage.id,
            "running",
            [{ type: stage.type, data: stage.data }],
            stage.note,
          );
          // Minimum reading time, independent of solver precision or computational cost.
          await pause(stageDisplayMs, undefined, { signal: controller.signal });
          current();
          record(
            stage.id,
            "completed",
            [{ type: stage.type, data: stage.data }],
            stage.note,
          );
          await yieldStage();
        }
        current();
        const run = context.runs.start("audit", input);
        context.store.putDocument(
          "run-binding",
          {
            runId: run.id,
            inputRevision: design.revision,
            executionId: started.executionId,
            reviewRequired: true,
          },
          run.id + ".binding",
        );
        service.attachRun(run.id, started.executionId, design.revision);
        let completed = context.store.getRun(run.id);
        while (["queued", "running"].includes(completed.status)) {
          await pause(100, undefined, { signal: controller.signal });
          try {
            current();
          } catch (error) {
            context.runs.cancel(run.id);
            throw error;
          }
          completed = context.store.getRun(run.id);
        }
        current();
        if (completed.status !== "succeeded")
          throw new Error(
            "求解未成功：" + (completed.error?.message ?? completed.status),
          );
        service.runEvent(run.id, completed.status);
        record(
          "evaluate",
          "completed",
          [
            { type: "parameter-table", data: input },
            {
              type: "evaluation",
              runId: run.id,
              data: {
                runId: run.id,
                allocationPlan: completed.result.allocationPlan,
              },
            },
          ],
          "真实仿真已完成；单项、组合、Shapley、敏感性与复核记录见结果。仍需评审参数适用性。",
        );
        await pause(stageDisplayMs, undefined, { signal: controller.signal });
        current();
        const reportRun = workflowReportRun(context.store, completed);
        const html = report(reportRun, "html"),
          markdown = report(reportRun, "md");
        context.store.putDocument(
          "pipeline-report",
          {
            runId: run.id,
            executionId: started.executionId,
            inputRevision: design.revision,
            html,
            markdown,
            reviewRequired: true,
          },
          run.id + ".pipeline-report",
        );
        record(
          "validate-deliver",
          "awaiting-review",
          [
            {
              type: "report",
              runId: run.id,
              data: {
                runId: run.id,
                formats: ["html", "md", "json", "zip"],
                checks: completed.result.reviewChecks,
              },
            },
          ],
          "报告已生成，待审核。请核对目标分配、参数证据、守恒检查和机制前置条件后记录交付确认。",
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          const state = service.get();
          context.store.putDocument("pipeline-diagnostic", {
            executionId: started.executionId,
            message: (error as Error).message,
          });
          if (
            state.executionId === started.executionId &&
            state.status === "active"
          ) {
            if (state.stale) service.cancel(state.executionId, "agent");
            else {
              const step = state.steps.find(
                (s) => !["completed", "confirmed"].includes(s.status),
              );
              if (step)
                record(
                  step.id,
                  "failed",
                  step.artifacts,
                  (error as Error).message,
                );
            }
          }
        }
      } finally {
        active.delete(context.task.id);
      }
    };
    void execute();
    return reply.code(202).send(started);
  });
}

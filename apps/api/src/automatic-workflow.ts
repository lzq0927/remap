import {
  allocationPreview,
  mechanismEvidence,
  parameterHash,
  verificationInput,
} from "./reliability-artifacts";
import {
  setTimeout as pause,
  setImmediate as yieldStage,
} from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import type { TaskServices } from "../../../packages/tasks/src/service";
import type { WorkflowService } from "../../../packages/workflow/src/service";
import { DomainError } from "../../../packages/contracts/src/errors";
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
    const input = structuredClone(design.assessment.input);
    if (
      !input.lossBudgetWeights &&
      !["none", "equal", "baseline-proportional"].includes(
        input.lossBudgetMethod,
      )
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
        const allocation = allocationPreview(input);
        record(
          "target-allocation",
          "running",
          [{ type: "target-allocation", data: allocation }],
          "按已保存需求在架构上分解目标；AGREE设计先验与评估后的证据分配分别留存。",
        );
        await pause(stageDisplayMs, undefined, { signal: controller.signal });
        record(
          "target-allocation",
          "completed",
          [{ type: "target-allocation", data: allocation }],
          "目标与设计分配已保存；暂定重要度及BOM仍需工程核验。",
        );
        const evaluate = async (
          runInput: any,
          stepId: string,
          sourceRunId?: string,
        ) => {
          current();
          const run = context.runs.start("audit", runInput);
          context.store.putDocument(
            "run-binding",
            {
              runId: run.id,
              inputRevision: design.revision,
              executionId: started.executionId,
              reviewRequired: true,
              stepId,
              ...(sourceRunId
                ? {
                    verification: {
                      sourceRunId,
                      parameterHash: parameterHash(runInput),
                      trials: runInput.trials,
                      seed: runInput.seed,
                      independent: true,
                    },
                  }
                : {}),
            },
            run.id + ".binding",
          );
          service.attachRun(
            run.id,
            started.executionId,
            design.revision,
            stepId,
            stepId === "mechanism-verification",
          );
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
          return completed;
        };
        const assessed = await evaluate(input, "availability-assessment");
        record(
          "availability-assessment",
          "completed",
          [
            { type: "evaluation", runId: assessed.id },
            {
              type: "evidence-allocation",
              runId: assessed.id,
              data: {
                method: assessed.result.topologyDecision?.allocationLabel,
              },
            },
          ],
          "现状可用度、结构辅助结果及目标差距已计算；训练损失使用逐事件账本，RBD/BDD按各自指标解释。",
        );
        await pause(stageDisplayMs, undefined, { signal: controller.signal });
        const designEvidence = mechanismEvidence(assessed);
        record(
          "mechanism-design",
          "running",
          [{ type: "mechanism-plan", data: designEvidence }],
          "按本轮Shapley与损失来源形成机制建议；冻结当前所选参数用于独立复核。",
        );
        await pause(stageDisplayMs, undefined, { signal: controller.signal });
        record(
          "mechanism-design",
          "completed",
          [{ type: "mechanism-plan", data: designEvidence }],
          "所选机制参数已冻结；新增建议仍需单独选择和复评，不自动换成预测更优的参数。",
        );
        const verifiedInput = verificationInput(input);
        const completed = await evaluate(
          verifiedInput,
          "mechanism-verification",
          assessed.id,
        );
        const reportRun = workflowReportRun(context.store, completed);
        context.store.putDocument(
          "pipeline-report",
          {
            runId: completed.id,
            assessmentRunId: assessed.id,
            executionId: started.executionId,
            inputRevision: design.revision,
            html: report(reportRun, "html"),
            markdown: report(reportRun, "md"),
            reviewRequired: true,
          },
          completed.id + ".pipeline-report",
        );
        record(
          "mechanism-verification",
          "awaiting-review",
          [
            {
              type: "verification",
              runId: completed.id,
              data: {
                runId: completed.id,
                sourceRunId: assessed.id,
                parameterHash: parameterHash(input),
                trials: verifiedInput.trials,
                seed: verifiedInput.seed,
                independent: true,
                checks: completed.result.reviewChecks,
                formats: ["html", "md", "json", "zip"],
              },
            },
          ],
          "独立种子的离散事件复核已完成；输出均值、采样区间及精确参数。模型达成与产品工程能力分别审核。",
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

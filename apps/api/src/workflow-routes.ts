import type { FastifyInstance } from "fastify";
import { WorkflowService } from "../../../packages/workflow/src/service";
import type {
  TaskServices,
  TaskContext,
} from "../../../packages/tasks/src/service";
import { DomainError } from "../../../packages/contracts/src/errors";
import { hash } from "../../../packages/assets/src/hash";

export const currentWorkflow = (context: TaskContext) =>
  new WorkflowService(context.task.id, context.store).get();
export function registerWorkflowRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
) {
  const services = new Map<string, WorkflowService>();
  const flow = (id: string) => {
    const context = tasks.resolve(id);
    let service = services.get(id);
    if (!service) {
      service = new WorkflowService(id, context.store);
      services.set(id, service);
      context.runs.on("event", (event) =>
        service!.runEvent(event.runId, event.type),
      );
    }
    return service;
  };
  app.addHook("onClose", async () =>
    services.forEach((s) => s.removeAllListeners()),
  );
  const base = "/api/tasks/:taskId";
  app.get(base + "/workflow", async (req: any) =>
    flow(req.params.taskId).get(),
  );
  app.get(base + "/workflow/history", async (req: any) =>
    flow(req.params.taskId).events(),
  );
  app.post(base + "/workflow/start", async (req: any) => {
    const context = tasks.authorize(req, req.params.taskId);
    return flow(context.task.id).start(req.body, context.actor);
  });
  app.post(base + "/workflow", async (req: any) => {
    const context = tasks.authorize(req, req.params.taskId);
    const savedDesign = context.store.documents("design").at(-1);
    if (
      req.body?.status === "confirmed" &&
      savedDesign?.activeAssessment === "audit"
    ) {
      if (!savedDesign.assessment?.valid)
        throw new DomainError("INPUT_UNCONFIRMED", "请修正审核草稿后确认");
      if (
        ["select", "prepare"].includes(req.body.stepId) &&
        !savedDesign.assessment.input.lossBudgetWeights
      )
        throw new DomainError("INPUT_UNCONFIRMED", "请先分配六项损失预算");
    }
    if (
      req.body?.status === "confirmed" &&
      ["evaluate", "validate-deliver"].includes(req.body.stepId)
    ) {
      const artifact = req.body.artifacts?.find(
        (a: any) => a.data?.runId || a.runId,
      );
      const runId =
        artifact?.data?.runId ??
        artifact?.runId ??
        flow(context.task.id).get().runId;
      const run = context.store.getRun(runId ?? "");
      const design = context.store.documents("design").at(-1);
      if (
        run.status !== "succeeded" ||
        (design?.scenario === "training" &&
          run.operation !== (design?.assessment?.operation ?? "training"))
      )
        throw new DomainError(
          "INPUT_UNCONFIRMED",
          "需要完成当前方案的正式评估",
        );
      const binding = context.store
        .documents("run-binding")
        .find((r) => r.runId === run.id);
      if (
        !binding ||
        binding.inputRevision !== req.body.inputRevision ||
        binding.executionId !== req.body.executionId ||
        flow(context.task.id).get().runId !== run.id
      )
        throw new DomainError(
          "INPUT_REVISION_CONFLICT",
          "运行不属于当前流程和输入版本",
          409,
        );
    }
    return flow(context.task.id).record(req.body, context.actor);
  });
  app.post(base + "/workflow/cancel", async (req: any) => {
    const context = tasks.authorize(req, req.params.taskId),
      service = flow(context.task.id);
    const state = service.get();
    if (state.runId) context.runs.cancel(state.runId);
    return service.cancel(req.body.executionId, context.actor);
  });
  app.get(base + "/workflow/events", async (req: any, reply) => {
    const service = flow(req.params.taskId);
    const past = service.events(
      Number(req.headers["last-event-id"] ?? req.query.after ?? 0),
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const write = (event: any) =>
      reply.raw.write(
        `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    past.forEach(write);
    service.on("event", write);
    const timer = setInterval(() => reply.raw.write(": keepalive\n\n"), 15000);
    reply.raw.on("close", () => {
      clearInterval(timer);
      service.off("event", write);
    });
  });
  app.addHook("preHandler", async (req: any) => {
    if (
      req.method !== "POST" ||
      req.routeOptions.url !== base + "/runs" ||
      !req.body.executionId
    )
      return;
    const state = flow(req.params.taskId).get();
    if (
      state.executionId !== req.body.executionId ||
      state.inputRevision !== req.body.inputRevision ||
      state.stale ||
      state.status !== "active"
    )
      throw new DomainError(
        "INPUT_REVISION_CONFLICT",
        "输入或执行已改变，请读取当前任务",
        409,
      );
    if (state.steps.slice(0, 4).some((s) => s.status !== "confirmed"))
      throw new DomainError("WORKFLOW_ORDER", "请先确认参数阶段", 409);
    const design = tasks
      .resolve(req.params.taskId)
      .store.documents("design")
      .at(-1);
    if (design?.scenario !== "training")
      throw new DomainError(
        "METHOD_UNSUPPORTED",
        "当前正式流程支持训练场景；其他求解作为独立实验执行",
      );
    if (
      design?.scenario === "training" &&
      ((!design.assessment?.valid && design.activeAssessment === "audit") ||
        req.body.operation !== (design.assessment?.operation ?? "training") ||
        hash(req.body.input) !==
          hash(design.assessment?.input ?? design.request))
    )
      throw new DomainError(
        "INPUT_REVISION_CONFLICT",
        "正式评估必须使用当前已保存方案；其他输入请作为独立实验执行",
        409,
      );
  });
  app.addHook("onSend", async (req: any, reply, payload: any) => {
    if (
      req.method === "POST" &&
      req.routeOptions.url === base + "/runs" &&
      reply.statusCode < 300 &&
      typeof payload === "string"
    ) {
      const run = JSON.parse(payload),
        context = tasks.resolve(req.params.taskId);
      const design = context.store.documents("design").at(-1);
      context.store.putDocument(
        "run-binding",
        {
          runId: run.id,
          inputRevision: req.body.inputRevision ?? design?.revision ?? 0,
          executionId: req.body.executionId,
        },
        run.id + ".binding",
      );
      if (req.body.executionId) {
        flow(context.task.id).attachRun(
          run.id,
          req.body.executionId,
          req.body.inputRevision,
        );
        flow(context.task.id).runEvent(
          run.id,
          context.store.getRun(run.id).status,
        );
      }
    }
    return payload;
  });
}

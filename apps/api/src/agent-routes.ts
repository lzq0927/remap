import type { FastifyInstance } from "fastify";
import type { TaskServices } from "../../../packages/tasks/src/service";
import type { AgentIntegration } from "./agent-integration";
import { assertSessionBound } from "../../../packages/agents/src/task-binding";
import { DomainError } from "../../../packages/contracts/src/errors";
import { steps } from "../../../packages/workflow/src/service";

export function registerAgentRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
  integration: AgentIntegration,
) {
  const primaryPending = new Map<string, Promise<any>>();
  const dispatching = new Map<string, AbortController>();
  app.addHook("onClose", async () => {
    for (const controller of dispatching.values()) controller.abort();
  });
  const base = "/api/tasks/:taskId/agent";
  const agent = (id: string) =>
    integration.forTask(tasks.registry.resolveRoot(id));
  const apiUrl = () => {
    const address = app.server.address();
    return (
      "http://127.0.0.1:" +
      (address && typeof address !== "string"
        ? address.port
        : (process.env.PORT ?? 4178))
    );
  };
  app.get(base + "/web", async (req: any) => {
    const { store } = tasks.authorize(req, req.params.taskId),
      info = await agent(req.params.taskId).webInfo();
    const bindings = store.documents("agent-binding");
    return {
      ...info,
      sessions: info.sessions.filter((s: any) =>
        bindings.some((b) => b.sessionId === s.id),
      ),
    };
  });
  app.get(base + "/metadata", async (req: any) =>
    agent(req.params.taskId).metadata(),
  );
  app.get(base + "/providers", async (req: any) =>
    agent(req.params.taskId).providers(),
  );
  app.post(base + "/prepare", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    await integration.prepareTask(tasks, req.params.taskId, apiUrl());
    return { taskId: req.params.taskId, prepared: true };
  });
  const createSession = async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    const prepared = await integration.prepareTask(
      tasks,
      req.params.taskId,
      apiUrl(),
    );
    const { task } = prepared;
    const purpose = req.body?.purpose === "topic" ? "topic" : "primary";
    const { store } = tasks.resolve(task.id);
    if (purpose === "primary") {
      const info = await prepared.agent.webInfo();
      const existing = store
        .documents("agent-binding")
        .find(
          (s) =>
            s.purpose === "primary" &&
            info.sessions.some((native: any) => native.id === s.sessionId),
        );
      if (existing) return { sessionId: existing.sessionId };
    }
    const session = await prepared.agent.createSession({
      title:
        task.id.slice(0, 8) +
        " · " +
        task.name +
        " · " +
        (purpose === "primary" ? "主会话" : "专题"),
    });
    const info = await prepared.agent.webInfo();
    if (!info.sessions.some((s: any) => s.id === session.sessionId))
      throw new DomainError(
        "AGENT_DIRECTORY_UNSUPPORTED",
        "当前 Agent 未将会话创建到任务目录，请检查适配接口",
      );
    store.putDocument(
      "agent-binding",
      {
        sessionId: session.sessionId,
        taskId: task.id,
        purpose,
        createdAt: new Date().toISOString(),
      },
      session.sessionId,
    );
    return session;
  };
  app.post(base + "/session", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    if (req.body?.purpose === "topic") return createSession(req);
    const id = req.params.taskId;
    const pending = primaryPending.get(id);
    if (pending) return pending;
    const created = createSession(req);
    primaryPending.set(id, created);
    try {
      return await created;
    } finally {
      primaryPending.delete(id);
    }
  });
  app.post(base + "/:id/context", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    assertSessionBound(tasks, req.params.taskId, req.params.id);
    const { task, store } = tasks.resolve(req.params.taskId),
      design = store.documents("design").at(-1);
    if (req.body?.view === "engineering") {
      const models = store.documents("engineering-model");
      const selected = req.body.modelId
        ? models.filter((m) => m.id === req.body.modelId)
        : models;
      if (!selected.length)
        throw new DomainError("INPUT_UNCONFIRMED", "请先保存工程模型");
      const summary = {
        taskId: task.id,
        taskName: task.name,
        view: "engineering",
        models: selected.map((m) => ({
          id: m.id,
          name: m.model.name,
          revision: m.revision,
          semanticHash: m.semanticHash,
          sources: m.model.sources.map((s: any) => ({
            id: s.id,
            name: s.name,
            scope: s.scope,
          })),
          cases: m.model.cases.map((c: any) => ({
            id: c.id,
            method: c.method,
            propertyRefs: c.propertyRefs,
          })),
        })),
        instruction:
          "使用 engineering_model_get 读取完整模型、engineering_materials 读取材料；engineering_propose 提出草案，不能自行确认；保留性质和来源。只运行当前用户已保存版本。",
      };
      await agent(task.id).addContext(req.params.id, summary);
      store.putDocument("agent-context", {
        sessionId: req.params.id,
        view: "engineering",
        models: summary.models,
        syncedAt: new Date().toISOString(),
      });
      return {
        saved: true,
        sessionId: req.params.id,
        inputRevision: selected[0].revision,
      };
    }
    if (!design) throw new DomainError("INPUT_UNCONFIRMED", "请先保存当前设计");
    const assessment = design.assessment;
    const input =
      assessment?.input ??
      (design.activeAssessment === "audit" ? {} : design.request);
    const stage =
      Number.isInteger(design.stage) &&
      design.stage >= 0 &&
      design.stage < steps.length
        ? design.stage
        : 0;
    const view = [
      "workbench",
      "engineering",
      "inputs",
      "catalogs",
      "tools",
      "runs",
      "settings",
    ].includes(req.body?.view)
      ? req.body.view
      : undefined;
    const summary = {
      taskId: task.id,
      taskName: task.name,
      inputRevision: design.revision,
      stage,
      step: steps[stage],
      view,
      runId: design.runId,
      operation: assessment?.operation ?? "training",
      metricId: assessment?.metricId ?? "training.correct-delivery",
      valid: assessment?.valid ?? true,
      issues: assessment?.issues ?? [],
      cards: input.cards,
      target: input.target,
      targets: input.targets,
      hours: input.hours,
      assessments: store.runSummaries({ limit: 12 }).items,
      instruction:
        "调用 task_current、design_get、workflow_state 读取完整设计及流程；评估使用 assessment.input，valid=false 先修复。用 run_list/run_status 核对已有各轮证据；audit_plan 只生成建议，用户明确要求后 audit_evaluate 独立复评，audit_compare 比较同一第一轮结果。生成建议不自动执行改进轮，不修改第一轮或重置确认。禁止退回旧 V4 参数或使用其他任务数据",
    };
    await agent(task.id).addContext(req.params.id, summary);
    store.putDocument("agent-context", {
      sessionId: req.params.id,
      inputRevision: design.revision,
      step: steps[stage],
      view,
      syncedAt: new Date().toISOString(),
    });
    return {
      saved: true,
      sessionId: req.params.id,
      inputRevision: design.revision,
    };
  });
  for (const kind of ["messages", "pending"] as const)
    app.get(base + "/:id/" + kind, async (req: any) => {
      assertSessionBound(tasks, req.params.taskId, req.params.id);
      return agent(req.params.taskId)[kind](req.params.id);
    });
  app.post(base + "/:id/message", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    assertSessionBound(tasks, req.params.taskId, req.params.id);
    const adapter = agent(req.params.taskId);
    const send = (signal?: AbortSignal) =>
      req.body.text?.startsWith("/sd-dfr-remap")
        ? adapter.runCommand(
            req.params.id,
            req.body.text.slice(13).trim(),
            signal,
          )
        : adapter.sendMessage(req.params.id, req.body.text, signal);
    if (!req.body.dispatch) return send();
    const key = req.params.taskId + "/" + req.params.id;
    if (dispatching.has(key))
      throw new DomainError(
        "AGENT_BUSY",
        "此会话已有启动请求，请在原生对话中继续或终止",
        409,
      );
    const { store } = tasks.resolve(req.params.taskId);
    const record = (status: string, error?: string) =>
      store.putDocument(
        "agent-dispatch",
        {
          sessionId: req.params.id,
          status,
          error,
          updatedAt: new Date().toISOString(),
        },
        "dispatch." + req.params.id,
      );
    const controller = new AbortController();
    dispatching.set(key, controller);
    record("running");
    void Promise.resolve()
      .then(() => send(controller.signal))
      .then(
        () => record("finished"),
        (error) => record("failed", (error as Error).message),
      )
      .finally(() => dispatching.delete(key))
      .catch(() => {});
    return { dispatched: true, sessionId: req.params.id };
  });
  app.get(base + "/:id/dispatch", async (req: any) => {
    assertSessionBound(tasks, req.params.taskId, req.params.id);
    return (
      tasks
        .resolve(req.params.taskId)
        .store.documents("agent-dispatch")
        .find((d) => d.sessionId === req.params.id) ?? { status: "idle" }
    );
  });
  app.post(base + "/:id/abort", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    assertSessionBound(tasks, req.params.taskId, req.params.id);
    return agent(req.params.taskId).abort(req.params.id);
  });
  app.get(base + "/:id/events", async (req: any, reply) => {
    assertSessionBound(tasks, req.params.taskId, req.params.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const controller = new AbortController();
    reply.raw.on("close", () => controller.abort());
    try {
      for await (const event of agent(req.params.taskId).events(
        req.params.id,
        controller.signal,
      ))
        reply.raw.write(
          `id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`,
        );
    } catch {
      if (!controller.signal.aborted)
        reply.raw.write(
          'data: {"kind":"error","payload":{"message":"Agent 事件连接中断"}}\n\n',
        );
    } finally {
      reply.raw.end();
    }
  });
  app.post(base + "/reply/:kind/:id", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    const adapter = agent(req.params.taskId),
      info = await adapter.webInfo();
    const bindings = tasks
      .resolve(req.params.taskId)
      .store.documents("agent-binding");
    for (const session of info.sessions.filter((s: any) =>
      bindings.some((b) => b.sessionId === s.id),
    )) {
      const pending = await adapter.pending(session.id);
      const items =
        req.params.kind === "question"
          ? pending.questions
          : req.params.kind === "permission"
            ? pending.permissions
            : [];
      if (items.some((i: any) => i.id === req.params.id))
        return adapter.reply(req.params.kind, req.params.id, req.body);
    }
    throw new DomainError("SESSION_NOT_BOUND", "此交互不属于当前任务", 403);
  });
}

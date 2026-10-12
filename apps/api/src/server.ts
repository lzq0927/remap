import { designAssessment } from "./design-assessment";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { hash } from "../../../packages/assets/src/hash";
import { parseInput } from "../../../packages/ingestion/src/parser";
import {
  getTrainingDefaults,
  getFactors,
  resolveTrainingConfig,
} from "../../../packages/solvers/src/training";
import { validateScenario } from "../../../packages/domain/src/validate";
import { DomainError } from "../../../packages/contracts/src/errors";
import {
  openCodeIntegration,
  type AgentIntegration,
} from "./agent-integration";
import { report } from "../../../packages/reports/src/report";
import { workflowReportRun } from "../../../packages/reports/src/workflow-context";
import { applyBindings } from "../../../packages/domain/src/bindings";
import type { CatalogKind } from "../../../packages/contracts/src/types";
import { schemas } from "../../../packages/contracts/src/schemas";
import { mapConfirmedData } from "../../../packages/ingestion/src/map-confirmed";
import { mapWithLocalAdapter } from "../../../packages/extensions/src/index";
import { allocate } from "../../../packages/allocation/src/index";
import {
  getAuditDefaults,
  getAuditEvents,
  auditMechanisms,
  resolveAudit,
} from "../../../packages/analysis/src/audit";
import {
  readRuntimePolicy,
  assertDataDirectory,
} from "../../../packages/runtime-policy/src/index";

import {
  TaskServices,
  type TaskContext,
} from "../../../packages/tasks/src/service";
import type { FastifyInstance } from "fastify";
import { currentWorkflow, registerWorkflowRoutes } from "./workflow-routes";
import { registerAgentRoutes } from "./agent-routes";
import { registerCatalogRoutes } from "./catalog-routes";
import { registerPortableRoutes } from "./portable-routes";

export interface BuildAppOptions {
  agentIntegration?: AgentIntegration;
  dataDir?: string;
  seed?: boolean;
  autoStartRuns?: boolean;
  /** Composition/test setting; cannot be changed by task or Agent requests. */
  automaticStageDisplayMs?: number;
  registerTaskRoutes?: (
    app: FastifyInstance,
    tasks: TaskServices,
  ) => void | Promise<void>;
  currentWorkflow?: (context: TaskContext) => unknown | Promise<unknown>;
}
export async function buildApp(options: BuildAppOptions = {}) {
  const policy = readRuntimePolicy();
  const dataDir =
    options.dataDir === ":memory:"
      ? ":memory:"
      : assertDataDirectory(
          options.dataDir ?? process.env.DATA_DIR ?? "data",
          policy,
        );
  const app = Fastify({ logger: false, bodyLimit: 30 * 1024 * 1024 });
  const tasks = new TaskServices(dataDir, {
    seed: options.seed,
    autoStart: options.autoStartRuns,
  });
  const agentIntegration = options.agentIntegration ?? openCodeIntegration();
  const agent = agentIntegration.global;
  app.decorate("taskServices", tasks);
  await app.register(cors, {
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4178",
      "http://127.0.0.1:4178",
    ],
  });
  app.setErrorHandler((error: any, _req, reply) =>
    reply.status(error.status ?? error.statusCode ?? 400).send({
      error: { code: error.code ?? "REQUEST_FAILED", message: error.message },
    }),
  );
  app.addHook("onClose", async () => {
    await agentIntegration.close?.();
    await tasks.close();
  });
  app.addHook("onRequest", async (req: any) => {
    const pathname = req.url.split("?")[0];
    if (
      /^\/api\/(catalogs|inputs|design|runs|workflow|feedback|allocations)(?:\/|$)/.test(
        pathname,
      ) ||
      /^\/api\/agent\/(?!health(?:\/|$)|metadata(?:\/|$)|web(?:\/|$))/.test(
        pathname,
      )
    )
      throw new DomainError(
        "TASK_REQUIRED",
        "此操作需要显式 taskId；请使用 /api/tasks/:taskId 路由",
        400,
      );
    if (req.params?.taskId) {
      if (pathname.endsWith("/restore")) {
        tasks.requireUser(req, req.params.taskId);
        tasks.registry.resolveRoot(req.params.taskId);
      } else tasks.authorize(req, req.params.taskId);
    }
  });
  app.get("/health", async () => ({
    status: "ok",
    version: "0.1.0",
    solvers: ["training", "rbd", "fta", "bdd", "ctmc"],
    agent: await agent.health(),
  }));
  app.get("/api/tasks", async (req: any) => {
    tasks.requireUser(req);
    return tasks.registry.list(req.query.includeArchived !== "false");
  });
  app.post("/api/tasks", async (req: any, reply) => {
    tasks.requireUser(req);
    if (req.body?.workspacePath || req.body?.root || req.body?.id)
      throw new DomainError(
        "TASK_PATH_INVALID",
        "任务 ID 和工作区由注册表分配",
        400,
      );
    return reply.code(201).send(tasks.create(req.body?.name));
  });
  app.get(
    "/api/tasks/:taskId",
    async (req: any) => tasks.authorize(req, req.params.taskId).task,
  );
  app.get("/api/tasks/:taskId/input-watch", async (req: any) => {
    const { task } = tasks.authorize(req, req.params.taskId);
    return {
      directory: resolve(task.workspacePath, "inputs"),
      enabled: options.dataDir !== ":memory:",
      confirmation: "required",
    };
  });
  app.patch("/api/tasks/:taskId", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    return tasks.registry.rename(req.params.taskId, req.body?.name);
  });
  app.post("/api/tasks/:taskId/archive", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    return tasks.archive(req.params.taskId);
  });
  app.post("/api/tasks/:taskId/restore", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    return tasks.registry.archive(req.params.taskId, false);
  });
  app.post("/api/tasks/:taskId/copy", async (req: any, reply) => {
    tasks.requireUser(req, req.params.taskId);
    return reply.code(201).send(tasks.copy(req.params.taskId, req.body?.name));
  });
  app.post("/api/tasks/migrate-legacy", async (req: any) => {
    tasks.requireUser(req);
    return tasks.migrateLegacy({ dryRun: req.body?.dryRun !== false });
  });
  app.get("/api/tasks/:taskId/current", async (req: any) => {
    const context = tasks.authorize(req, req.params.taskId);
    const design =
      context.store
        .documents("design")
        .sort((a: any, b: any) =>
          String(a.savedAt).localeCompare(String(b.savedAt)),
        )
        .at(-1) ?? null;
    const workflow = options.currentWorkflow
      ? await options.currentWorkflow(context)
      : currentWorkflow(context);
    return { task: context.task, design, workflow };
  });
  app.get("/api/examples/catalogs", async (req: any) =>
    tasks.examples.list(req.query.kind, req.query.search),
  );
  app.get("/api/defaults", async () => ({
    audit: getAuditDefaults(),
    auditEvents: getAuditEvents(),
    auditMechanisms,
    training: getTrainingDefaults(),
    factors: getFactors(),
    scenarios: [
      {
        id: "training",
        name: "AI 训练集群",
        state: "implemented",
        metric: "正确交付产出比例",
      },
      {
        id: "ai-system",
        name: "AI 系统",
        state: "planned",
        metric: "Loop 执行成功率",
      },
      { id: "ntn", name: "NTN 系统", state: "planned" },
      {
        id: "traditional",
        name: "传统系统",
        state: "implemented",
        metric: "任务可靠度 / 稳态可用度",
      },
    ],
  }));
  app.get("/api/templates/:name", async (req: any, reply) => {
    const name = req.params.name;
    if (
      ![
        "training-input.json",
        "catalog-import.json",
        "fault-modes.csv",
      ].includes(name)
    )
      throw new DomainError("NOT_FOUND", "模板不存在", 404);
    reply.header("Content-Disposition", `attachment; filename="${name}"`);
    reply.type(
      name.endsWith("csv") ? "text/csv; charset=utf-8" : "application/json",
    );
    return readFile(resolve("templates", name));
  });
  app.get("/api/tasks/:taskId/catalogs", async (req: any) =>
    tasks
      .authorize(req, req.params.taskId)
      .store.list(req.query.kind, req.query.search),
  );
  app.post(
    "/api/tasks/:taskId/catalogs",
    { schema: { body: schemas.catalog } },
    async (req: any) =>
      tasks
        .authorize(req, req.params.taskId)
        .store.create(req.body.kind, req.body.name, req.body.payload),
  );
  app.get("/api/tasks/:taskId/catalogs/:id", async (req: any) => ({
    asset: tasks
      .authorize(req, req.params.taskId)
      .store.get(
        req.params.id,
        req.query.revision ? Number(req.query.revision) : undefined,
      ),
    revisions: tasks
      .authorize(req, req.params.taskId)
      .store.revisions(req.params.id),
    referencedBy: tasks
      .authorize(req, req.params.taskId)
      .store.list()
      .filter(
        (a) =>
          (a.payload.modeIds ?? []).includes(req.params.id) ||
          (a.payload.refs ?? []).some((r: any) => r.id === req.params.id),
      ),
  }));
  app.patch("/api/tasks/:taskId/catalogs/:id/:revision", async (req: any) =>
    tasks
      .authorize(req, req.params.taskId)
      .store.update(
        req.params.id,
        Number(req.params.revision),
        req.body.name,
        req.body.payload,
      ),
  );
  app.post(
    "/api/tasks/:taskId/catalogs/:id/:revision/validate",
    async (req: any) => ({
      issues: tasks
        .authorize(req, req.params.taskId)
        .store.validate(req.params.id, Number(req.params.revision)),
    }),
  );
  app.post(
    "/api/tasks/:taskId/catalogs/:id/:revision/state",
    async (req: any) => {
      const context = tasks.authorize(req, req.params.taskId);
      if (["validated", "published"].includes(req.body.state))
        tasks.requireUser(req, req.params.taskId);
      if (req.body.visibility === "public" || req.body.scope === "public")
        throw new DomainError(
          "PUBLIC_REVIEW_REQUIRED",
          "公共发布需要独立身份评审",
          403,
        );
      return context.store.transition(
        req.params.id,
        Number(req.params.revision),
        req.body.state,
      );
    },
  );
  app.post("/api/tasks/:taskId/catalogs/:id/:revision/fork", async (req: any) =>
    tasks
      .authorize(req, req.params.taskId)
      .store.fork(req.params.id, Number(req.params.revision)),
  );
  app.post("/api/tasks/:taskId/catalogs/import", async (req: any) => {
    if (!Array.isArray(req.body.items) || req.body.items.length > 500)
      throw new DomainError(
        "SCHEMA_INVALID",
        "items 必须为最多 500 条的资产列表",
      );
    return req.body.items.map((i: any) =>
      tasks
        .authorize(req, req.params.taskId)
        .store.create(i.kind as CatalogKind, i.name, i.payload),
    );
  });
  app.get("/api/tasks/:taskId/inputs", async (req: any) =>
    tasks.authorize(req, req.params.taskId).store.documents("input"),
  );
  app.get(
    "/api/tasks/:taskId/design",
    async (req: any) =>
      tasks
        .authorize(req, req.params.taskId)
        .store.documents("design")
        .sort((a: any, b: any) => a.savedAt.localeCompare(b.savedAt))
        .at(-1) ?? null,
  );
  app.post("/api/tasks/:taskId/design", async (req: any) => {
    if (
      !req.body.request ||
      typeof req.body.request !== "object" ||
      Array.isArray(req.body.request)
    )
      throw new DomainError("SCHEMA_INVALID", "设计需要包含 request 参数对象");
    const { store } = tasks.authorize(req, req.params.taskId);
    const previous = store.documents("design").at(-1);
    const currentRevision = previous?.revision ?? 0;
    if (
      tasks.actor(req, req.params.taskId) === "agent" &&
      req.body.expectedRevision === undefined
    )
      throw new DomainError(
        "REVISION_REQUIRED",
        "Agent 写入设计必须指定已读取的 expectedRevision",
        409,
      );
    if (
      req.body.expectedRevision !== undefined &&
      req.body.expectedRevision !== currentRevision
    )
      throw new DomainError(
        "REVISION_CONFLICT",
        "设计已更新，请读取当前任务后重试",
        409,
      );
    const {
      expectedRevision: _expected,
      id: _id,
      revision: _revision,
      ...content
    } = req.body;
    const assessment = designAssessment(content);
    const inputHash = hash(
      content.activeAssessment === "audit"
        ? {
            request: assessment.valid ? assessment.input : content.auditDraft,
            scenario: content.scenario,
            metricId: assessment.metricId,
          }
        : { request: content.request, scenario: content.scenario },
    );
    return store.putDocument("design", {
      ...content,
      assessment,
      revision: currentRevision + (previous?.inputHash === inputHash ? 0 : 1),
      inputHash,
      savedAt: new Date().toISOString(),
    });
  });
  app.post(
    "/api/tasks/:taskId/inputs",
    { schema: { body: schemas.input } },
    async (req: any) => {
      const { name, base64 } = req.body;
      if (typeof name !== "string" || typeof base64 !== "string")
        throw new DomainError("SCHEMA_INVALID", "需要文件名和 base64 内容");
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length > 20 * 1024 * 1024)
        throw new DomainError("INPUT_TOO_LARGE", "文件超过 20MB");
      const provider =
        process.env.MODEL_API_KEY && process.env.MODEL_ID
          ? {
              baseUrl:
                policy.profile === "internal"
                  ? process.env.MODEL_BASE_URL!
                  : (process.env.MODEL_BASE_URL ?? "https://api.openai.com/v1"),
              apiKey: process.env.MODEL_API_KEY,
              model: process.env.MODEL_ID,
            }
          : undefined;
      return tasks
        .authorize(req, req.params.taskId)
        .store.putDocument("input", {
          ...(await parseInput(basename(name), bytes, provider)),
          createdAt: new Date().toISOString(),
        });
    },
  );
  app.post("/api/tasks/:taskId/inputs/:id/confirm", async (req: any) => {
    tasks.requireUser(req, req.params.taskId);
    const input = tasks
      .authorize(req, req.params.taskId)
      .store.getDocument(req.params.id);
    const data = req.body.data ?? input.data;
    if (!data || typeof data !== "object")
      throw new DomainError("SCHEMA_INVALID", "确认结构化对象不能为空");
    if (data.ambiguities?.length)
      throw new DomainError(
        "UNRESOLVED_AMBIGUITY",
        "请先修正结构化数据中的 ambiguities；缺失参数不能直接确认。",
      );
    return tasks.authorize(req, req.params.taskId).store.putDocument("input", {
      ...input,
      data,
      status: "confirmed",
      parentInputId: input.id,
      confirmedAt: new Date().toISOString(),
      confirmedHash: hash(data),
    });
  });
  app.get("/api/tasks/:taskId/runs", async (req: any) =>
    tasks.authorize(req, req.params.taskId).store.runs(),
  );
  app.post("/api/tasks/:taskId/allocations/compare", async (req: any) => {
    const metric = req.body.metricId ?? "task-reliability";
    if (!["task-reliability", "steady-state-availability"].includes(metric))
      throw new DomainError(
        "METHOD_UNSUPPORTED",
        "分配比较必须选择明确子模型指标",
      );
    const methods =
      metric === "task-reliability"
        ? ["equal", "arinc", "agree"]
        : ["availability"];
    const inputs = methods.map((method) => ({
      ...req.body,
      method,
      metricId: metric,
    }));
    const applicable: typeof inputs = [];
    const skipped: Array<{ method: string; reason: string }> = [];
    // Check each method before starting runs; one method's prerequisites need not block the others.
    for (const input of inputs) {
      try {
        allocate(input);
        applicable.push(input);
      } catch (error) {
        skipped.push({
          method: input.method,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!applicable.length)
      throw new DomainError(
        "METHOD_INAPPLICABLE",
        skipped.map(({ method, reason }) => `${method}: ${reason}`).join("; "),
      );
    return {
      metricId: metric,
      runs: applicable.map((input) =>
        tasks.authorize(req, req.params.taskId).runs.start("allocate", input),
      ),
      skipped,
      warnings: [
        "同指标目标分配对比；各方法假设仍需评审，训练正确交付需要完整回代验证。",
      ],
    };
  });
  app.get("/api/tasks/:taskId/inputs/:id/mapping", async (req: any) => {
    const { store } = tasks.authorize(req, req.params.taskId);
    const doc = store
      .documents("input")
      .find((input) => input.id === req.params.id);
    if (!doc) throw new DomainError("REFERENCE_MISSING", "输入文档不存在", 404);
    if (doc.status !== "confirmed" || doc.confirmedHash !== hash(doc.data))
      throw new DomainError("INPUT_UNCONFIRMED", "请先确认输入");
    const source = {
      inputId: doc.id,
      filename: doc.filename,
      contentHash: doc.contentHash,
      sources: doc.sources,
    };
    if (policy.profile !== "internal" || !policy.adapter)
      return mapConfirmedData(doc.data, source);
    const { adapter, ...mapping } = await mapWithLocalAdapter(
      policy.adapter,
      doc.data,
      source,
    );
    const recordedSource = { ...source, confirmedHash: doc.confirmedHash };
    const previewId =
      "mapping-preview-" + hash({ adapter, source: recordedSource, mapping });
    const existing = store
      .documents("mapping-preview")
      .find((preview) => preview.id === previewId);
    if (!existing)
      store.putDocument(
        "mapping-preview",
        {
          status: "preview",
          adapter,
          source: recordedSource,
          mapping,
          createdAt: new Date().toISOString(),
        },
        previewId,
      );
    return { ...mapping, adapter, previewId };
  });
  app.post(
    "/api/tasks/:taskId/runs",
    { schema: { body: schemas.run } },
    async (req: any) => {
      const { operation } = req.body;
      let input = req.body.input;
      if (
        ![
          "training",
          "rbd",
          "fta",
          "bdd",
          "ctmc",
          "allocate",
          "compare",
          "search",
          "sensitivity",
          "attribute",
          "estimateRate",
          "audit",
        ].includes(operation)
      )
        throw new DomainError("METHOD_UNSUPPORTED", "未知方法");
      if (!input || typeof input !== "object")
        throw new DomainError("SCHEMA_INVALID", "input 必须是对象");
      const snapshot = tasks
        .authorize(req, req.params.taskId)
        .store.snapshot(input.assetRefs);
      if (operation === "training" && input.assetRefs)
        input = applyBindings(
          input,
          snapshot.filter((a) =>
            input.assetRefs.some(
              (r: any) => r.id === a.id && r.revision === a.revision,
            ),
          ),
        );
      if (operation === "training") {
        const issues = validateScenario(input);
        if (issues.length)
          throw new DomainError(issues[0].code, issues[0].message);
        resolveTrainingConfig(input);
      }
      if (operation === "audit") resolveAudit(input);
      let sourceSnapshot: any;
      if (input.inputId) {
        const doc = tasks
          .authorize(req, req.params.taskId)
          .store.getDocument(input.inputId);
        if (doc.status !== "confirmed")
          throw new DomainError("INPUT_UNCONFIRMED", "请先确认输入文件");
        sourceSnapshot = {
          id: doc.id,
          filename: doc.filename,
          contentHash: doc.contentHash,
          confirmedHash: doc.confirmedHash,
          confirmedAt: doc.confirmedAt,
          data: structuredClone(doc.data),
          sources: doc.sources,
        };
      }
      return tasks
        .authorize(req, req.params.taskId)
        .runs.start(
          operation,
          { ...input, assetSnapshot: snapshot, sourceSnapshot },
          req.headers["idempotency-key"],
        );
    },
  );
  app.get("/api/tasks/:taskId/runs/:id", async (req: any) =>
    tasks.authorize(req, req.params.taskId).store.getRun(req.params.id),
  );
  app.post("/api/tasks/:taskId/runs/:id/cancel", async (req: any) =>
    tasks.authorize(req, req.params.taskId).runs.cancel(req.params.id),
  );
  app.post("/api/tasks/:taskId/runs/:id/replay", async (req: any) => {
    const r = tasks
      .authorize(req, req.params.taskId)
      .store.getRun(req.params.id);
    return tasks
      .authorize(req, req.params.taskId)
      .runs.start(r.operation, r.input);
  });
  app.get("/api/tasks/:taskId/runs/:id/events", async (req: any, reply) => {
    const r = tasks
      .authorize(req, req.params.taskId)
      .store.getRun(req.params.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const after = Number(req.headers["last-event-id"] ?? req.query.after ?? 0);
    const write = (e: any) => {
      if (e.runId === r.id)
        reply.raw.write(`id: ${e.sequence}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    r.events.filter((e) => e.sequence > after).forEach(write);
    tasks.authorize(req, req.params.taskId).runs.on("event", write);
    const timer = setInterval(() => reply.raw.write(": keepalive\n\n"), 15000);
    req.raw.on("close", () => {
      clearInterval(timer);
      tasks.authorize(req, req.params.taskId).runs.off("event", write);
    });
  });
  app.get("/api/tasks/:taskId/runs/:id/report", async (req: any, reply) => {
    const format = ["md", "html", "json"].includes(req.query.format)
      ? req.query.format
      : "md";
    reply.header(
      "Content-Type",
      format === "html"
        ? "text/html; charset=utf-8"
        : format === "json"
          ? "application/json"
          : "text/markdown; charset=utf-8",
    );
    reply.header(
      "Content-Disposition",
      `attachment; filename="reliability-${req.params.id}.${format}"`,
    );
    const store = tasks.authorize(req, req.params.taskId).store;
    return report(
      workflowReportRun(store, store.getRun(req.params.id)),
      format,
    );
  });
  app.get("/api/tasks/:taskId/feedback", async (req: any) =>
    tasks.authorize(req, req.params.taskId).store.documents("feedback"),
  );
  app.post("/api/tasks/:taskId/feedback", async (req: any) =>
    tasks.authorize(req, req.params.taskId).store.putDocument("feedback", {
      ...req.body,
      createdAt: new Date().toISOString(),
    }),
  );
  app.get("/api/settings", async () => ({
    agent: await agent.health(),
    runtime: {
      profile: policy.profile,
      provider: policy.provider
        ? {
            id: policy.provider.id,
            name: policy.provider.name,
            defaultModel: policy.provider.defaultModel,
          }
        : null,
      adapter: policy.adapter
        ? { id: policy.adapter.id, version: policy.adapter.version }
        : null,
      egressVerified: false,
    },
    modelConfigured: !!(process.env.MODEL_API_KEY && process.env.MODEL_ID),
    dataDir: options.dataDir ?? process.env.DATA_DIR ?? "data",
    watchRoots: (process.env.WATCH_ROOTS ?? "").split(";").filter(Boolean),
  }));
  app.get("/api/agent/health", async () => agent.health());
  app.get("/api/agent/metadata", async () => agent.metadata());
  app.get("/api/agent/web", async () => agent.webInfo());
  registerWorkflowRoutes(app, tasks, options.automaticStageDisplayMs);
  registerAgentRoutes(app, tasks, agentIntegration);
  registerCatalogRoutes(app, tasks);
  registerPortableRoutes(app, tasks);
  await options.registerTaskRoutes?.(app, tasks);
  const dist = resolve("dist/web");
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.status(404).send({ error: { code: "NOT_FOUND" } })
        : reply.sendFile("index.html"),
    );
  }
  return app as typeof app & { taskServices: TaskServices };
}

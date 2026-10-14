import type { FastifyInstance } from "fastify";
import type { TaskServices } from "../../../packages/tasks/src/service";
import {
  ModelService,
  emptyModel,
} from "../../../packages/modeling/src/service";
import { clusterModel } from "../../../packages/modeling/src/sample";
import {
  validateModel,
  parseModel,
} from "../../../packages/modeling/src/validate";
import { compileStatic } from "../../../packages/modeling/src/compile";
import { modelSchema } from "../../../packages/modeling/src/schema";
import { readMaterial } from "../../../packages/modeling/src/materials";
import {
  toolCapabilities,
  getToolAdapter,
} from "../../../packages/modeling/src/tools";
import { toolResultSchema } from "../../../packages/modeling/src/tool-contract";
import { DomainError } from "../../../packages/contracts/src/errors";
import { hash } from "../../../packages/assets/src/hash";
import { randomUUID } from "node:crypto";

export function registerModelingRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
) {
  const agentView = (req: any, value: any) => {
    if (tasks.authorize(req, req.params.taskId).actor !== "agent") return value;
    return JSON.parse(
      JSON.stringify(value, (key, v) =>
        key === "originalBase64" ? undefined : v,
      ),
    );
  };
  const base = "/api/tasks/:taskId/engineering";
  const service = (req: any) =>
    new ModelService(tasks.authorize(req, req.params.taskId).store);
  const user = (req: any) => tasks.requireUser(req, req.params.taskId);
  app.get(base + "/schema", async () => ({
    schemaVersion: "1.0.0",
    sample: clusterModel(),
    description:
      "使用 sample 了解完整结构；保留 sourceRefs。通过 proposals 提出完整候选模型，不直接确认。",
    fields: Object.keys(modelSchema.shape),
  }));
  app.get(base + "/tools", async () => toolCapabilities());
  app.get(base + "/models", async (req: any) =>
    agentView(req, service(req).list()),
  );
  app.post(base + "/models", async (req: any) => {
    user(req);
    if (req.body?.assetId) return service(req).reuse(req.body.assetId);
    return service(req).create(
      req.body?.template === "ai-cluster"
        ? clusterModel()
        : (req.body?.model ?? emptyModel()),
    );
  });
  app.get(base + "/models/:id", async (req: any) =>
    agentView(req, service(req).get(req.params.id)),
  );
  app.post(base + "/models/:id", async (req: any) => {
    user(req);
    return service(req).save(
      req.params.id,
      req.body.expectedRevision,
      req.body.model,
    );
  });
  app.get(base + "/models/:id/revisions", async (req: any) =>
    service(req).revisions(req.params.id),
  );
  app.get(base + "/proposals", async (req: any) =>
    service(req).proposals(req.query.modelId),
  );
  app.post(base + "/models/:id/proposals", async (req: any) =>
    service(req).propose(
      req.params.id,
      req.body.expectedRevision,
      req.body.model,
      req.body.reason,
      tasks.authorize(req, req.params.taskId).actor,
    ),
  );
  app.post(base + "/proposals/:id/resolve", async (req: any) => {
    user(req);
    if (typeof req.body.accept !== "boolean")
      throw new Error("accept 必须为布尔值");
    return service(req).resolveProposal(req.params.id, req.body.accept);
  });
  app.post(base + "/models/:id/validate", async (req: any) => {
    const m = service(req).get(req.params.id);
    const issues = validateModel(m.model);
    const cases = m.model.cases.map((c) => {
      try {
        if (c.method === "rbd" || c.method === "fta")
          compileStatic(m.model, c.id);
        else
          getToolAdapter(c.toolId ?? "", c.method).validateInputs({
            files: c.files,
            scope: c.scope,
            timeoutMs: 60000,
            metadata: {},
          });
        return { id: c.id, ready: true };
      } catch (e) {
        return { id: c.id, ready: false, message: (e as Error).message };
      }
    });
    return { issues, cases };
  });
  app.get(base + "/materials", async (req: any) =>
    agentView(req, service(req).store.documents("engineering-material")),
  );
  app.get(base + "/materials/:id", async (req: any) =>
    agentView(
      req,
      service(req).document("engineering-material", req.params.id),
    ),
  );
  app.post(base + "/materials", async (req: any) => {
    user(req);
    if (typeof req.body.base64 !== "string" || req.body.base64.length > 7000000)
      throw new Error("材料内容缺失或超过5MB");
    if (
      !["synthetic", "public", "internal", "private"].includes(
        req.body.scope ?? "private",
      )
    )
      throw new Error("材料范围无效");
    const material = await readMaterial(
      req.body.name,
      Buffer.from(req.body.base64, "base64"),
      req.body.scope ?? "private",
    );
    return service(req).addMaterial(material);
  });
  app.post(base + "/models/:id/runs", async (req: any) => {
    const snapshot = service(req).get(req.params.id);
    if (snapshot.revision !== req.body.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "请使用当前保存版本运行", 409);
    parseModel(snapshot.model);
    const c = snapshot.model.cases.find((x) => x.id === req.body.caseId);
    if (!c) throw new Error("分析案例不存在");
    if (["rbd", "fta"].includes(c.method)) compileStatic(snapshot.model, c.id);
    else
      getToolAdapter(c.toolId ?? "", c.method).validateInputs({
        files: c.files,
        scope: c.scope,
        timeoutMs: 60000,
        metadata: {},
      });
    return tasks
      .resolve(req.params.taskId)
      .runs.start(
        "engineering",
        { snapshot, caseId: c.id },
        req.body.idempotencyKey,
      );
  });
  app.get(base + "/models/:id/runs", async (req: any) =>
    service(req).runs(req.params.id),
  );
  app.get(base + "/models/:id/external-results", async (req: any) => {
    service(req).get(req.params.id);
    return service(req)
      .store.documents("engineering-external-evidence")
      .filter((x) => x.snapshot.id === req.params.id);
  });
  app.get(base + "/models/:id/cases/:caseId/tool-input", async (req: any) => {
    const snapshot = service(req).get(req.params.id),
      c = snapshot.model.cases.find((x) => x.id === req.params.caseId);
    if (!c) throw new Error("分析案例不存在");
    return {
      files: c.files,
      scope: c.scope,
      timeoutMs: 60000,
      metadata: {
        modelId: snapshot.id,
        revision: snapshot.revision,
        caseId: c.id,
        inputHash: hash({
          semanticHash: snapshot.semanticHash,
          caseId: c.id,
          files: c.files,
        }),
      },
    };
  });
  app.get(base + "/models/:id/export", async (req: any, reply) => {
    reply.header(
      "Content-Disposition",
      'attachment; filename="engineering-model.json"',
    );
    return service(req).export(req.params.id);
  });
  app.post(base + "/import", async (req: any) => {
    user(req);
    return service(req).import(req.body);
  });
  app.post(base + "/models/:id/assets", async (req: any) => {
    user(req);
    return service(req).asset(req.params.id, req.body.expectedRevision);
  });
  app.post(base + "/models/:id/external-results", async (req: any) => {
    user(req);
    const snapshot = service(req).get(req.params.id);
    if (snapshot.revision !== req.body.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "结果导入基线已过期", 409);
    const c = snapshot.model.cases.find((x) => x.id === req.body.caseId);
    if (!c || !["p", "external"].includes(c.method))
      throw new Error("只有外部工具案例可手工导入结果");
    const result = toolResultSchema.parse(req.body.result);
    const inputHash = hash({
      semanticHash: snapshot.semanticHash,
      caseId: c.id,
      files: c.files,
    });
    if (req.body.inputHash !== inputHash)
      throw new DomainError(
        "HASH_MISMATCH",
        "外部结果必须回传导出输入的 metadata.inputHash，不能关联其它版本",
        409,
      );
    return service(req).store.putDocument(
      "engineering-external-evidence",
      {
        snapshot,
        caseId: c.id,
        result,
        inputHash,
        executionMode: "user-imported",
        importedAt: new Date().toISOString(),
      },
      "external-run-" + randomUUID(),
    );
  });
}

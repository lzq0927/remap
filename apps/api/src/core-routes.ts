import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TaskServices } from "../../../packages/tasks/src/service";
import type { Store } from "../../../packages/assets/src/store";
import { DomainError } from "../../../packages/contracts/src/errors";
import {
  analyze,
  coreModelSchema,
  defaultCoreModel,
  expectedSimulationEvents,
  modelHash,
  targetAtScale,
  upgradeCoreModel,
  verificationLimits,
  verify,
  type CoreModel,
  type VerificationResult,
} from "../../../packages/core/src/index";

const modelKind = "core-model",
  modelId = "core-model",
  verificationKind = "core-verification";
const verifySchema = z
  .object({
    trials: z
      .number()
      .int()
      .min(verificationLimits.minTrials)
      .max(verificationLimits.maxTrials)
      .optional(),
    seed: z.number().int().min(0).max(4294967295).optional(),
  })
  .strict();

function parseModel(input: unknown): CoreModel {
  const parsed = coreModelSchema.safeParse(upgradeCoreModel(input));
  if (!parsed.success)
    throw new DomainError(
      "SCHEMA_INVALID",
      parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("；"),
    );
  const model = parsed.data;
  if (model.requirements)
    model.scenario.target = targetAtScale(model, model.scenario.cards);
  return model;
}

/** 四步工作台：一份模型、解析结果和独立验证记录。 */
export function registerCoreRoutes(app: FastifyInstance, tasks: TaskServices) {
  const load = (store: Store) => {
    const saved = store.documents(modelKind)[0];
    // 早期保存的模型字段与现在不同，读取时整理成当前结构。
    const parsed = saved
      ? coreModelSchema.safeParse(upgradeCoreModel(saved.model))
      : null;
    return {
      model: parsed?.success ? parsed.data : defaultCoreModel(),
      revision: (saved?.revision as number | undefined) ?? 0,
      savedAt: (saved?.savedAt as string | undefined) ?? null,
    };
  };
  const history = (store: Store) =>
    (
      store.documents(verificationKind) as Array<
        VerificationResult & { id: string; sequence: number }
      >
    ).sort((a, b) => a.sequence - b.sequence);

  app.get("/api/tasks/:taskId/core", async (req: any) => {
    const { store } = tasks.authorize(req, req.params.taskId);
    const state = load(store),
      runs = history(store);
    return {
      ...state,
      hash: modelHash(state.model),
      verification: runs.at(-1) ?? null,
      verificationCount: runs.length,
    };
  });
  const save = async (req: any) => {
    const { store } = tasks.authorize(req, req.params.taskId);
    const model = parseModel(req.body?.model),
      revision = load(store).revision + 1,
      savedAt = new Date().toISOString();
    store.putDocument(modelKind, { model, revision, savedAt }, modelId);
    store.putDocument(
      "core-model-revision",
      { model, revision, savedAt },
      `${modelId}-r${revision}`,
    );
    return { revision, savedAt, hash: modelHash(model) };
  };
  app.put("/api/tasks/:taskId/core", save);
  // Agent 工具只发 GET/POST，保存另提供 POST 入口。
  app.post("/api/tasks/:taskId/core", save);
  app.post("/api/tasks/:taskId/core/reset", async (req: any) => {
    const { store } = tasks.authorize(req, req.params.taskId);
    const model = defaultCoreModel(),
      revision = load(store).revision + 1,
      savedAt = new Date().toISOString();
    store.putDocument(modelKind, { model, revision, savedAt }, modelId);
    store.audit("core.reset", modelId, { revision });
    store.putDocument(
      "core-model-revision",
      { model, revision, savedAt },
      `${modelId}-r${revision}`,
    );
    return { model, revision, savedAt, hash: modelHash(model) };
  });
  // 供 Agent 与脚本读取：与界面使用同一套解析结果。
  app.get("/api/tasks/:taskId/core/analysis", async (req: any) => {
    const { store } = tasks.authorize(req, req.params.taskId);
    return analyze(load(store).model);
  });
  app.post("/api/tasks/:taskId/core/verify", async (req: any, reply) => {
    const { store } = tasks.authorize(req, req.params.taskId);
    const options = verifySchema.safeParse(req.body ?? {});
    if (!options.success)
      throw new DomainError(
        "SCHEMA_INVALID",
        `仿真次数须为 ${verificationLimits.minTrials}–${verificationLimits.maxTrials} 的整数，种子须为 32 位无符号整数`,
      );
    const { model, revision } = load(store),
      trials = options.data.trials ?? 2000,
      events = expectedSimulationEvents(model, trials);
    if (events > verificationLimits.maxEvents)
      throw new DomainError(
        "SIMULATION_TOO_LARGE",
        `这次验证约需模拟 ${Math.round(events).toLocaleString("zh-CN")} 次故障，超过上限。请把仿真窗口数减到 ${Math.max(verificationLimits.minTrials, Math.floor((trials * verificationLimits.maxEvents) / events))} 以内，或缩短评估窗口。`,
      );
    const result = verify(model, { ...options.data, trials }),
      sequence = history(store).length + 1;
    const saved = store.putDocument(
      verificationKind,
      { ...result, sequence, modelRevision: revision, modelSnapshot: model },
      `${verificationKind}-${sequence}`,
    );
    store.audit("core.verified", saved.id, {
      sequence,
      modelRevision: revision,
      modelHash: result.modelHash,
      seed: result.seed,
      trials: result.trials,
      verdict: result.verdict,
    });
    return reply.code(201).send(saved);
  });
}

import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { existsSync, lstatSync } from "node:fs";
import { Store } from "../../../packages/assets/src/store";
import { TaskServices } from "../../../packages/tasks/src/service";
import { CatalogReviewService } from "../../../packages/catalog-review/src/service";
import { DomainError } from "../../../packages/contracts/src/errors";

/** Shared publication is a separate review boundary; ordinary routes only submit candidates. */
export function registerCatalogRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
) {
  const root = join(tasks.registry.root, "public-catalog");
  for (const p of [
    root,
    ...["", "-wal", "-shm", "-journal"].map((s) =>
      join(root, "reliability.sqlite" + s),
    ),
  ])
    if (existsSync(p) && lstatSync(p).isSymbolicLink())
      throw new DomainError(
        "TASK_PATH_INVALID",
        "公共资产存储路径被重定向",
        403,
      );
  const shared = new Store(root),
    reviews = new CatalogReviewService(shared);
  app.addHook("onClose", async () => shared.close());
  app.get("/api/public/catalogs", async (req: any) =>
    shared.list(req.query.kind, req.query.search),
  );
  app.get("/api/public/review-status", async () => ({
    enabled: false,
    message: "公共发布入口尚未启用；可提交候选，需独立审核身份批准后发布",
  }));
  app.get("/api/public/submissions", async (req: any) => {
    tasks.requireUser(req);
    return reviews.list();
  });
  app.post(
    "/api/tasks/:taskId/catalogs/:id/:revision/submit",
    async (req: any) => {
      const context = tasks.authorize(req, req.params.taskId);
      return reviews.submit(
        context.task.id,
        context.store.get(req.params.id, Number(req.params.revision)),
        process.env.RELIABILITY_LOCAL_USER ?? "local-user",
      );
    },
  );
  app.post("/api/tasks/:taskId/catalogs/copy-public", async (req: any) => {
    const context = tasks.authorize(req, req.params.taskId),
      input = req.body;
    if (
      !["example", "public"].includes(input.source) ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1 ||
      typeof input.contentHash !== "string"
    )
      throw new DomainError("SCHEMA_INVALID", "请指定来源及固定版本摘要");
    const source = input.source === "example" ? tasks.examples : shared;
    const snapshot = source.snapshot([
      {
        id: input.id,
        revision: input.revision,
        contentHash: input.contentHash,
      },
    ]);
    context.store.db.exec("BEGIN");
    try {
      for (const asset of snapshot) {
        const existing = context.store.db
          .prepare("SELECT hash FROM assets WHERE id=? AND revision=?")
          .get(asset.id, asset.revision) as any;
        if (existing && existing.hash !== asset.contentHash)
          throw new DomainError(
            "REVISION_CONFLICT",
            "任务已有不同内容的同名版本，请复制到新任务",
            409,
          );
        if (!existing)
          context.store.db
            .prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)")
            .run(
              asset.id,
              asset.revision,
              asset.kind,
              asset.name,
              "validated",
              asset.contentHash,
              JSON.stringify(asset.payload),
              asset.createdAt,
            );
        context.store.putDocument(
          "asset-lineage",
          {
            source: input.source,
            upstreamId: asset.id,
            revision: asset.revision,
            contentHash: asset.contentHash,
            copiedAt: new Date().toISOString(),
          },
          asset.id + "@" + asset.revision,
        );
      }
      context.store.db.exec("COMMIT");
    } catch (error) {
      context.store.db.exec("ROLLBACK");
      throw error;
    }
    return snapshot.map((a) => context.store.get(a.id, a.revision));
  });
  return reviews;
}

import type { FastifyInstance } from "fastify";
import type { TaskServices } from "../../../packages/tasks/src/service";
import {
  defaultWeeklyScenario,
  weeklyScenarioSchema,
} from "../../../packages/contracts/src/weekly-reliability";
import { evaluateWeeklyScenario } from "../../../packages/analysis/src/weekly-reliability";
import { weeklyCatalogEntries } from "../../../packages/analysis/src/weekly-catalog";
import { DomainError } from "../../../packages/contracts/src/errors";
import { hash } from "../../../packages/assets/src/hash";
import { z } from "zod";

const kind = "weekly-reliability-snapshot";
const saveSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    profile: weeklyScenarioSchema,
  })
  .strict();
export function registerWeeklyReliabilityRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
) {
  app.get("/api/tasks/:taskId/weekly-reliability", async (req: any) => {
    const { store } = tasks.authorize(req, req.params.taskId);
    const history = store
      .documents(kind)
      .sort((a, b) => a.revision - b.revision);
    const snapshot = history.at(-1) ?? null;
    const profile = snapshot?.profile ?? defaultWeeklyScenario();
    return {
      profile,
      result: snapshot?.result ?? evaluateWeeklyScenario(profile),
      revision: snapshot?.revision ?? 0,
      snapshot,
      history,
      catalog: weeklyCatalogEntries(profile),
    };
  });
  app.post("/api/tasks/:taskId/weekly-reliability", async (req: any, reply) => {
    const { store } = tasks.authorize(req, req.params.taskId);
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success)
      throw new DomainError(
        "SCHEMA_INVALID",
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("；"),
      );
    const { profile, baseRevision } = parsed.data;
    const previous = store
      .documents(kind)
      .sort((a, b) => a.revision - b.revision)
      .at(-1);
    if ((previous?.revision ?? 0) !== baseRevision)
      throw new DomainError(
        "REVISION_CONFLICT",
        "场景已有新版本，请重新加载后保存",
        409,
      );
    const result = evaluateWeeklyScenario(profile);
    const revision = baseRevision + 1;
    const snapshotId = `weekly-reliability-r${revision}`;
    // Atomic task-local append; no workflow confirmation or shared publication.
    store.db.exec("BEGIN");
    try {
      const modeRefs = new Map<
        string,
        { id: string; revision: number; contentHash: string }
      >();
      const refs = weeklyCatalogEntries(profile).map((entry) => {
        const coveredRefs = (
          (entry.payload.coveredModeKeys ?? []) as string[]
        ).map((key) => modeRefs.get(key)!);
        const asset = store.create(
          entry.kind,
          entry.name,
          {
            ...entry.payload,
            sourceSnapshotId: snapshotId,
            scenarioRevision: revision,
            ...(entry.kind === "mechanism"
              ? { modeIds: coveredRefs.map((r) => r.id), refs: coveredRefs }
              : {}),
          },
          `weekly-2026-11-12-${entry.key}`,
        );
        store.transition(asset.id, asset.revision, "validated");
        const ref = {
          id: asset.id,
          revision: asset.revision,
          contentHash: asset.contentHash,
        };
        if (entry.kind === "failure-mode") modeRefs.set(entry.key, ref);
        return ref;
      });
      const snapshot = store.putDocument(
        kind,
        {
          revision,
          savedAt: new Date().toISOString(),
          profile,
          result,
          catalogRefs: refs,
          contentHash: hash({ profile, result }),
          verification: "analytical-budget-only",
        },
        snapshotId,
      );
      store.audit("weekly-reliability.saved", snapshotId, {
        revision,
        catalogRefs: refs,
      });
      store.db.exec("COMMIT");
      return reply.code(201).send(snapshot);
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
  });
}

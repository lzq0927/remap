import { randomUUID } from "node:crypto";
import type { Store } from "../../assets/src/store";
import { hash } from "../../assets/src/hash";
import { DomainError } from "../../contracts/src/errors";
import { parseModel, semanticHash } from "./validate";
import type {
  EngineeringModel,
  SavedModel,
  Proposal,
  Material,
} from "./schema";
import { sourceSchema } from "./schema";
import { toolResultSchema } from "./tool-contract";

function validateEvidence(run: any) {
  if (
    !run ||
    typeof run.id !== "string" ||
    run.operation !== "engineering" ||
    !["succeeded", "failed", "cancelled"].includes(run.status) ||
    hash({ operation: run.operation, input: run.input }) !== run.inputHash
  )
    throw new Error("工程证据不是有效的冻结运行");
  validateEngineeringDocument("engineering-model", run.input.snapshot);
  if (
    !run.input.snapshot.model.cases.some((c: any) => c.id === run.input.caseId)
  )
    throw new Error("运行案例引用无效");
  if (run.status === "succeeded" && !run.result)
    throw new Error("已完成工程运行缺少结果");
  if (run.result) {
    const {
      engine,
      version,
      verdict,
      completed,
      scope,
      metrics,
      trace,
      diagnostics,
      rawOutput,
      artifacts,
    } = run.result;
    toolResultSchema.parse({
      engine,
      version,
      verdict,
      completed,
      scope,
      metrics,
      trace,
      diagnostics,
      rawOutput,
      artifacts,
    });
  }
}

export function emptyModel(): EngineeringModel {
  return {
    schemaVersion: "1.0.0",
    name: "新的系统设计",
    sources: [],
    entities: [],
    relations: [],
    failureModes: [],
    mechanisms: [],
    requirements: [],
    behaviors: [],
    views: [],
    cases: [],
    decisions: [],
  };
}
export class ModelService {
  constructor(readonly store: Store) {}
  list(): SavedModel[] {
    return this.store.documents("engineering-model");
  }
  get(id: string): SavedModel {
    return this.document("engineering-model", id);
  }
  document<T = any>(kind: string, id: string): T {
    const row = this.store.db
      .prepare("SELECT payload FROM documents WHERE id=? AND kind=?")
      .get(id, kind) as { payload: string } | undefined;
    if (!row) throw new DomainError("REFERENCE_MISSING", "工程资产不存在", 404);
    return { ...JSON.parse(row.payload), id };
  }
  private evidence(id: string): any {
    if (id.startsWith("imported-run-"))
      return this.document("engineering-imported-run", id).original;
    if (id.startsWith("external-run-"))
      return this.externalRun(
        this.document("engineering-external-evidence", id),
      );
    return this.store.getRun(id);
  }
  private externalRun(e: any) {
    const input = { snapshot: e.snapshot, caseId: e.caseId };
    return {
      id: e.id,
      operation: "engineering",
      status: "succeeded",
      input,
      inputHash: hash({ operation: "engineering", input }),
      createdAt: e.importedAt,
      completedAt: e.importedAt,
      imported: true,
      result: {
        ...e.result,
        modelId: e.snapshot.id,
        revision: e.snapshot.revision,
        semanticHash: e.snapshot.semanticHash,
        caseId: e.caseId,
        executionMode: "user-imported",
      },
    };
  }
  private checkEvidence(model: EngineeringModel) {
    for (const d of model.decisions)
      for (const id of d.runRefs) validateEvidence(this.evidence(id));
  }
  create(value: unknown): SavedModel {
    const model = parseModel(value);
    this.checkEvidence(model);
    return this.write("model-" + randomUUID(), 0, model);
  }
  save(id: string, expected: number, value: unknown): SavedModel {
    if (!Number.isSafeInteger(expected) || expected < 1)
      throw new DomainError("REVISION_CONFLICT", "保存必须携带现有修订号", 409);
    const model = parseModel(value);
    this.checkEvidence(model);
    return this.write(id, expected, model);
  }
  private write(
    id: string,
    expected: number,
    model: EngineeringModel,
  ): SavedModel {
    this.store.db.exec("SAVEPOINT engineering_write");
    try {
      const previous = expected === 0 ? undefined : this.get(id);
      if (
        !Number.isSafeInteger(expected) ||
        expected < 0 ||
        (previous && previous.revision !== expected)
      )
        throw new DomainError(
          "REVISION_CONFLICT",
          "设计版本已变化，请保留草稿并重新比较",
          409,
        );
      const now = new Date().toISOString();
      const saved: SavedModel = {
        id,
        revision: expected + 1,
        semanticHash: semanticHash(model),
        contentHash: hash(model),
        model,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      const revisionId = `${id}@${saved.revision}`;
      this.store.db
        .prepare("INSERT INTO documents VALUES(?,?,?)")
        .run(
          revisionId,
          "engineering-revision",
          JSON.stringify({ ...saved, modelId: id }),
        );
      this.store.putDocument("engineering-model", saved, id);
      this.store.audit("engineering.saved", id, {
        revision: saved.revision,
        semanticHash: saved.semanticHash,
      });
      this.store.db.exec("RELEASE engineering_write");
      return saved;
    } catch (e) {
      this.store.db.exec(
        "ROLLBACK TO engineering_write; RELEASE engineering_write",
      );
      throw e;
    }
  }
  revisions(id: string) {
    this.get(id);
    return this.store
      .documents("engineering-revision")
      .filter((x) => x.modelId === id);
  }
  proposals(modelId?: string): Proposal[] {
    return this.store
      .documents("engineering-proposal")
      .filter((p) => !modelId || p.modelId === modelId);
  }
  propose(
    id: string,
    expectedRevision: number,
    value: unknown,
    reason: string,
    actor: "user" | "agent",
  ): Proposal {
    const saved = this.get(id);
    if (saved.revision !== expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "草案基线已过期", 409);
    if (!reason?.trim() || reason.length > 20000)
      throw new Error("请提供修改原因");
    const known = [
      ...saved.model.sources,
      ...this.store.documents("engineering-material"),
    ];
    const proposed = structuredClone(value) as any;
    // Agents reference immutable materials by ID instead of retranscribing documents/base64.
    if (Array.isArray(proposed?.sources))
      proposed.sources = proposed.sources.map((s: any) => {
        if (
          s &&
          typeof s === "object" &&
          Object.keys(s).length === 1 &&
          typeof s.id === "string"
        ) {
          const original = known.find((x) => x.id === s.id);
          if (!original) throw new Error("未知材料引用：" + s.id);
          return sourceSchema.parse(original);
        }
        return s;
      });
    const candidate = parseModel(proposed);
    this.checkEvidence(candidate);
    for (const source of candidate.sources) {
      const original = known.find((x) => x.id === source.id);
      if (original && source.originalBase64 === undefined)
        source.originalBase64 = original.originalBase64;
      if (!original || hash(source) !== hash(sourceSchema.parse(original)))
        throw new Error("草案来源必须引用已导入且未被改写的材料：" + source.id);
    }
    const proposal: Proposal = {
      id: "proposal-" + randomUUID(),
      modelId: id,
      baseRevision: expectedRevision,
      candidate,
      reason,
      actor,
      status: "proposed",
      createdAt: new Date().toISOString(),
    };
    this.store.putDocument("engineering-proposal", proposal, proposal.id);
    return proposal;
  }
  resolveProposal(id: string, accept: boolean) {
    const p = this.document<Proposal>("engineering-proposal", id);
    if (p.status !== "proposed")
      throw new DomainError("REVISION_CONFLICT", "草案已经处理", 409);
    this.store.db.exec("SAVEPOINT engineering_resolve");
    try {
      const saved = accept
        ? this.save(p.modelId, p.baseRevision, p.candidate)
        : undefined;
      this.store.putDocument(
        "engineering-proposal",
        {
          ...p,
          status: accept ? "accepted" : "rejected",
          resolvedAt: new Date().toISOString(),
        },
        id,
      );
      this.store.db.exec("RELEASE engineering_resolve");
      return {
        proposal: this.document<Proposal>("engineering-proposal", id),
        saved,
      };
    } catch (e) {
      this.store.db.exec(
        "ROLLBACK TO engineering_resolve; RELEASE engineering_resolve",
      );
      throw e;
    }
  }
  addMaterial(material: Material) {
    sourceSchema.parse(material);
    this.store.putDocument("engineering-material", material, material.id);
    return material;
  }
  runs(id: string) {
    this.get(id);
    return [
      ...this.store
        .documents("engineering-external-evidence")
        .filter((e) => e.snapshot.id === id)
        .map((e) => this.externalRun(e)),
      ...this.store
        .runs()
        .filter(
          (r) => r.operation === "engineering" && r.input.snapshot?.id === id,
        ),
      ...this.store
        .documents("engineering-imported-run")
        .filter((r) => r.modelId === id)
        .map((r) => ({
          ...r.original,
          id: r.id,
          imported: true,
          result: r.original.result
            ? { ...r.original.result, executionMode: "package-imported" }
            : undefined,
        })),
    ];
  }
  export(id: string) {
    const saved = this.get(id),
      ids = new Set([
        ...this.runs(id)
          .filter((r) => !["queued", "running"].includes(r.status))
          .map((r) => r.id),
        ...saved.model.decisions.flatMap((d) => d.runRefs),
      ]);
    const body = {
      format: "remap-engineering",
      version: "1.0.0",
      model: saved.model,
      evidence: [...ids].map((id) => ({
        referenceId: id,
        run: this.evidence(id),
      })),
      origin: {
        modelId: id,
        revision: saved.revision,
        semanticHash: saved.semanticHash,
      },
    };
    return { ...body, contentHash: hash(body) };
  }
  import(value: any) {
    const { contentHash, ...body } = value ?? {};
    if (
      body.format !== "remap-engineering" ||
      body.version !== "1.0.0" ||
      hash(body) !== contentHash
    )
      throw new Error("工程包格式或摘要无效");
    const model = parseModel(body.model),
      evidence = body.evidence ?? [];
    if (!Array.isArray(evidence) || evidence.length > 500)
      throw new Error("工程证据数量超限");
    const refs = new Map<string, string>();
    for (const item of evidence) {
      validateEvidence(item.run);
      if (typeof item.referenceId !== "string" || refs.has(item.referenceId))
        throw new Error("证据引用重复或无效");
      refs.set(item.referenceId, "imported-run-" + randomUUID());
    }
    for (const d of model.decisions)
      d.runRefs = d.runRefs.map((id) => {
        const mapped = refs.get(id);
        if (!mapped) throw new Error("工程包缺少决策引用的证据：" + id);
        return mapped;
      });
    // Imported evidence is archived with explicit provenance, never inserted as a new live run.
    this.store.db.exec("SAVEPOINT engineering_import");
    try {
      const id = "model-" + randomUUID(),
        saved = this.write(id, 0, model);
      for (const item of evidence)
        this.store.putDocument(
          "engineering-imported-run",
          {
            modelId: id,
            original: item.run,
            origin: body.origin,
            executionMode: "package-imported",
          },
          refs.get(item.referenceId)!,
        );
      this.store.db.exec("RELEASE engineering_import");
      return saved;
    } catch (e) {
      this.store.db.exec(
        "ROLLBACK TO engineering_import; RELEASE engineering_import",
      );
      throw e;
    }
  }
  asset(id: string, expected: number) {
    const saved = this.get(id);
    if (saved.revision !== expected)
      throw new DomainError(
        "REVISION_CONFLICT",
        "请刷新设计版本后沉淀资产",
        409,
      );
    return this.store.create("scenario-template", saved.model.name, {
      engineeringModel: saved.model,
      engineeringPackage: this.export(id),
      modelRef: {
        id,
        revision: saved.revision,
        semanticHash: saved.semanticHash,
      },
      scope: saved.model.sources.every((s) => s.scope === "synthetic")
        ? "synthetic"
        : "private",
      assumptions: saved.model.cases.flatMap((c) => c.assumptions),
      description: "经用户接受的工程设计快照；草稿资产不代表真实系统验证",
    });
  }
  reuse(assetId: string) {
    const asset = this.store.get(assetId);
    if (asset.kind !== "scenario-template" || !asset.payload.engineeringPackage)
      throw new Error("资产没有可复用的工程包");
    return this.import(asset.payload.engineeringPackage);
  }
}

/** Called by the portable importer before creating any destination task. */
export function validateEngineeringDocument(kind: string, payload: any) {
  if (kind === "engineering-model" || kind === "engineering-revision") {
    const model = parseModel(payload.model);
    if (
      payload.contentHash !== hash(model) ||
      payload.semanticHash !== semanticHash(model) ||
      !Number.isSafeInteger(payload.revision) ||
      payload.revision < 1
    )
      throw new Error("工程模型版本摘要无效");
  }
  if (kind === "engineering-proposal") parseModel(payload.candidate);
  if (kind === "engineering-material") sourceSchema.parse(payload);
  if (kind === "engineering-imported-run") validateEvidence(payload.original);
  if (kind === "engineering-external-evidence") {
    validateEngineeringDocument("engineering-model", payload.snapshot);
    toolResultSchema.parse(payload.result);
  }
}

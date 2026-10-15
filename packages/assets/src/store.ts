import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { hash } from "./hash";
import { validateCatalog } from "../../domain/src/validate";
import { DomainError } from "../../contracts/src/errors";
import type {
  Asset,
  AssetState,
  CatalogKind,
  Run,
} from "../../contracts/src/types";

const kinds = [
  "failure-mode",
  "mechanism",
  "parameter-evidence",
  "scenario-template",
  "validation-case",
  "incident",
];
export class Store {
  db: DatabaseSync;
  constructor(public dataDir: string) {
    if (dataDir !== ":memory:") mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(
      dataDir === ":memory:" ? ":memory:" : join(dataDir, "reliability.sqlite"),
    );
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS assets(id TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, asset TEXT, created TEXT NOT NULL, payload TEXT NOT NULL);
    `);
  }
  close() {
    this.db.close();
  }
  private asset(row: any): Asset {
    return {
      id: row.id,
      revision: row.revision,
      kind: row.kind,
      name: row.name,
      state: row.state,
      contentHash: row.hash,
      payload: JSON.parse(row.payload),
      createdAt: row.created,
      schemaVersion: "1.0.0",
    };
  }
  list(kind?: string, search = ""): Asset[] {
    const rows = this.db
      .prepare(
        "SELECT a.* FROM assets a JOIN (SELECT id, MAX(revision) rev FROM assets GROUP BY id) b ON a.id=b.id AND a.revision=b.rev ORDER BY a.created DESC",
      )
      .all();
    return rows
      .map((r) => this.asset(r))
      .filter(
        (a) =>
          (!kind || kind === "all" || a.kind === kind) &&
          (!search ||
            (a.name + JSON.stringify(a.payload))
              .toLowerCase()
              .includes(search.toLowerCase())),
      );
  }
  get(id: string, revision?: number): Asset {
    const row = revision
      ? this.db
          .prepare("SELECT * FROM assets WHERE id=? AND revision=?")
          .get(id, revision)
      : this.db
          .prepare(
            "SELECT * FROM assets WHERE id=? ORDER BY revision DESC LIMIT 1",
          )
          .get(id);
    if (!row)
      throw new DomainError(
        "REFERENCE_MISSING",
        `资产 ${id}@${revision ?? "latest"} 不存在`,
        404,
      );
    return this.asset(row);
  }
  revisions(id: string): Asset[] {
    return this.db
      .prepare("SELECT * FROM assets WHERE id=? ORDER BY revision")
      .all(id)
      .map((r) => this.asset(r));
  }
  create(
    kind: CatalogKind,
    name: string,
    payload: Record<string, any>,
    id: string = randomUUID(),
  ): Asset {
    if (!kinds.includes(kind) || !name?.trim())
      throw new DomainError("SCHEMA_INVALID", "资产类型与名称必填");
    const revision =
      Number(
        (
          this.db
            .prepare("SELECT MAX(revision) r FROM assets WHERE id=?")
            .get(id) as any
        )?.r ?? 0,
      ) + 1;
    this.db
      .prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)")
      .run(
        id,
        revision,
        kind,
        name.trim(),
        "draft",
        hash(payload),
        JSON.stringify(payload),
        new Date().toISOString(),
      );
    this.audit("asset.created", id, { revision, kind });
    return this.get(id, revision);
  }
  update(
    id: string,
    revision: number,
    name: string,
    payload: Record<string, any>,
  ): Asset {
    if (this.get(id, revision).state !== "draft")
      throw new DomainError(
        "REVISION_CONFLICT",
        "只有草稿可以编辑，请创建新版本",
        409,
      );
    if (!name.trim()) throw new DomainError("SCHEMA_INVALID", "名称不能为空");
    this.db
      .prepare(
        "UPDATE assets SET name=?,payload=?,hash=? WHERE id=? AND revision=?",
      )
      .run(name, JSON.stringify(payload), hash(payload), id, revision);
    this.audit("asset.updated", id, { revision });
    return this.get(id, revision);
  }
  validate(id: string, revision: number) {
    const a = this.get(id, revision);
    const issues = validateCatalog(a.kind, a.payload);
    for (const ref of a.payload.refs ?? []) {
      try {
        const target = this.get(ref.id, ref.revision);
        if (target.contentHash !== ref.contentHash)
          issues.push({
            code: "REVISION_CONFLICT",
            message: `${ref.id} 内容摘要不匹配`,
          });
      } catch {
        issues.push({
          code: "REFERENCE_MISSING",
          message: `引用 ${ref.id} 不存在`,
        });
      }
    }
    for (const modeId of a.payload.modeIds ?? []) {
      try {
        this.get(modeId);
      } catch {
        issues.push({
          code: "REFERENCE_MISSING",
          message: `覆盖的故障模式 ${modeId} 不存在`,
        });
      }
    }
    return issues;
  }
  transition(id: string, revision: number, state: AssetState): Asset {
    const a = this.get(id, revision);
    const allowed: Record<AssetState, AssetState[]> = {
      draft: ["validated"],
      validated: ["published"],
      published: ["deprecated"],
      deprecated: [],
    };
    if (!allowed[a.state].includes(state))
      throw new DomainError(
        "REVISION_CONFLICT",
        `不能从 ${a.state} 转为 ${state}`,
        409,
      );
    const issues = this.validate(id, revision);
    if (issues.length)
      throw new DomainError(
        issues[0].code,
        issues.map((i) => i.message).join("；"),
      );
    this.db
      .prepare("UPDATE assets SET state=? WHERE id=? AND revision=?")
      .run(state, id, revision);
    this.audit("asset." + state, id, { revision });
    return this.get(id, revision);
  }
  fork(id: string, revision: number) {
    const a = this.get(id, revision);
    return this.create(a.kind, a.name, structuredClone(a.payload), id);
  }
  snapshot(refs?: { id: string; revision: number; contentHash?: string }[]) {
    const chosen = refs
      ? refs.map((r) => {
          const a = this.get(r.id, r.revision);
          if (r.contentHash && r.contentHash !== a.contentHash)
            throw new DomainError("REVISION_CONFLICT", "资产快照摘要不匹配");
          if (!["published", "deprecated"].includes(a.state))
            throw new DomainError(
              "INPUT_UNCONFIRMED",
              "评估引用必须使用已发布版本",
            );
          return a;
        })
      : this.db
          .prepare(
            "SELECT a.* FROM assets a JOIN (SELECT id,MAX(revision) rev FROM assets WHERE state='published' GROUP BY id) b ON a.id=b.id AND a.revision=b.rev",
          )
          .all()
          .map((r) => this.asset(r));
    const seen = new Set(chosen.map((a) => a.id + "@" + a.revision));
    for (let i = 0; i < chosen.length; i++)
      for (const ref of chosen[i].payload.refs ?? []) {
        const a = this.get(ref.id, ref.revision);
        if (a.contentHash !== ref.contentHash)
          throw new DomainError("REVISION_CONFLICT", "依赖摘要不匹配");
        if (!["published", "deprecated"].includes(a.state))
          throw new DomainError("INPUT_UNCONFIRMED", "依赖版本尚未发布");
        const key = a.id + "@" + a.revision;
        if (!seen.has(key)) {
          seen.add(key);
          chosen.push(a);
        }
      }
    return structuredClone(chosen);
  }
  putDocument(kind: string, payload: any, id: string = randomUUID()) {
    this.db
      .prepare(
        "INSERT INTO documents VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(id, kind, JSON.stringify(payload));
    return { ...payload, id };
  }
  getDocument(id: string): any {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(id) as any;
    if (!row) throw new DomainError("REFERENCE_MISSING", "文档不存在", 404);
    return { ...JSON.parse(row.payload), id };
  }
  documents(kind: string) {
    return this.db
      .prepare("SELECT * FROM documents WHERE kind=?")
      .all(kind)
      .map((r: any) => ({ ...JSON.parse(r.payload), id: r.id }));
  }
  saveRun(run: Run, key?: string) {
    this.db
      .prepare(
        "INSERT INTO runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(run.id, key ?? null, JSON.stringify(run));
  }
  getRun(id: string): Run {
    const r = this.db
      .prepare("SELECT payload FROM runs WHERE id=?")
      .get(id) as any;
    if (!r) throw new DomainError("REFERENCE_MISSING", "实验不存在", 404);
    return JSON.parse(r.payload);
  }
  findRun(key: string): Run | undefined {
    const r = this.db
      .prepare("SELECT payload FROM runs WHERE idempotency_key=?")
      .get(key) as any;
    return r ? JSON.parse(r.payload) : undefined;
  }
  runs(): Run[] {
    return this.db
      .prepare("SELECT payload FROM runs ORDER BY rowid DESC LIMIT 100")
      .all()
      .map((r: any) => JSON.parse(r.payload));
  }
  runSummaries(
    query: {
      operation?: string;
      sourceRunId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const conditions: string[] = [],
      bindings: string[] = [];
    if (query.operation) {
      conditions.push("json_extract(payload, '$.operation') = ?");
      bindings.push(query.operation);
    }
    if (query.sourceRunId) {
      conditions.push(
        "(id = ? OR COALESCE(json_extract(payload, '$.result.sourceRunId'), json_extract(payload, '$.input.source.id')) = ?)",
      );
      bindings.push(query.sourceRunId, query.sourceRunId);
    }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const limit = query.limit ?? 20,
      offset = query.offset ?? 0;
    const total = (
      this.db
        .prepare("SELECT COUNT(*) AS total FROM runs" + where)
        .get(...bindings) as any
    ).total;
    const items = this.db
      .prepare(
        `SELECT id,
      json_extract(payload, '$.operation') AS operation,
      json_extract(payload, '$.status') AS status,
      json_extract(payload, '$.createdAt') AS createdAt,
      json_extract(payload, '$.inputHash') AS inputHash,
      json_extract(payload, '$.result.kind') AS kind,
      COALESCE(json_extract(payload, '$.result.name'), json_extract(payload, '$.input.name')) AS name,
      COALESCE(json_extract(payload, '$.result.sourceRunId'), json_extract(payload, '$.input.source.id')) AS sourceRunId,
      COALESCE(json_extract(payload, '$.result.planningRunId'), json_extract(payload, '$.input.plan.id')) AS planningRunId,
      json_extract(payload, '$.result.scenarioEvaluated') AS scenarioEvaluated
      FROM runs${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...bindings, limit, offset)
      .map((row: any) => ({
        ...row,
        scenarioEvaluated:
          row.scenarioEvaluated === null
            ? undefined
            : Boolean(row.scenarioEvaluated),
      }));
    return { items, total, limit, offset };
  }
  activeRuns(): Run[] {
    return this.db
      .prepare(
        "SELECT payload FROM runs WHERE json_extract(payload,'$.status') IN ('queued','running') ORDER BY rowid",
      )
      .all()
      .map((r: any) => JSON.parse(r.payload));
  }
  audit(action: string, asset: string, payload: any) {
    this.db
      .prepare(
        "INSERT INTO audit(action,asset,created,payload) VALUES(?,?,?,?)",
      )
      .run(action, asset, new Date().toISOString(), JSON.stringify(payload));
  }
}

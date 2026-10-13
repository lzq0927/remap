import { Store } from "../../assets/src/store";
import { hash } from "../../assets/src/hash";
import { DomainError } from "../../contracts/src/errors";
import { TaskServices } from "./service";
import { validateEngineeringDocument } from "../../modeling/src/service";
const columns = {
  assets: [
    "id",
    "revision",
    "kind",
    "name",
    "state",
    "hash",
    "payload",
    "created",
  ],
  runs: ["id", "idempotency_key", "payload"],
  documents: ["id", "kind", "payload"],
  audit: ["id", "action", "asset", "created", "payload"],
} as const;
const excludedDocument = (kind: string) =>
  kind.startsWith("agent-") || kind === "settings";
export function exportTask(tasks: TaskServices, taskId: string) {
  const { task, store } = tasks.resolve(taskId);
  if (store.activeRuns().length)
    throw new DomainError(
      "TASK_BUSY",
      "请等待或取消运行后导出一致的任务包",
      409,
    );
  const rows: Record<string, any[]> = {};
  for (const table of Object.keys(columns)) {
    rows[table] = store.db
      .prepare(`SELECT * FROM ${table}`)
      .all()
      .filter((r: any) => table !== "documents" || !excludedDocument(r.kind))
      .map((row: any) => {
        if (table !== "documents" || row.kind !== "design") return row;
        const design = JSON.parse(row.payload);
        return { ...row, payload: JSON.stringify({ ...design, session: "" }) };
      });
  }
  const payload = {
    schemaVersion: "1.0.0",
    task: { id: task.id, name: task.name, createdAt: task.createdAt },
    rows,
  };
  return {
    ...payload,
    contentHash: hash(payload),
    notice:
      "包含用户输入和来源；不含 OpenCode 配置、凭据或会话。请按数据权限分享。",
  };
}
function validateBundle(bundle: any) {
  if (
    !bundle ||
    bundle.schemaVersion !== "1.0.0" ||
    typeof bundle.task?.name !== "string" ||
    !bundle.rows ||
    !bundle.contentHash
  )
    throw new DomainError("TASK_BUNDLE_INVALID", "任务包格式无效");
  if (
    hash({
      schemaVersion: bundle.schemaVersion,
      task: bundle.task,
      rows: bundle.rows,
    }) !== bundle.contentHash
  )
    throw new DomainError("HASH_MISMATCH", "任务包摘要不匹配");
  for (const [table, fields] of Object.entries(columns)) {
    const rows = bundle.rows[table];
    if (!Array.isArray(rows) || rows.length > 10000)
      throw new DomainError("TASK_BUNDLE_INVALID", "任务包数量超限");
    for (const row of rows) {
      if (
        !row ||
        Object.keys(row).length !== fields.length ||
        fields.some((key) => !(key in row)) ||
        Object.keys(row).some((key) => !fields.includes(key as never))
      )
        throw new DomainError("TASK_BUNDLE_INVALID", "任务包记录不符合 schema");
      if (
        Object.values(row).some(
          (v) => v !== null && typeof v !== "string" && typeof v !== "number",
        )
      )
        throw new DomainError("TASK_BUNDLE_INVALID", "数据库行值无效");
      if (table === "assets" && hash(JSON.parse(row.payload)) !== row.hash)
        throw new DomainError("HASH_MISMATCH", "资产内容摘要无效");
      if (table === "runs") {
        const run = JSON.parse(row.payload);
        if (run.operation === "engineering")
          validateEngineeringDocument("engineering-model", run.input?.snapshot);
        if (
          run.id !== row.id ||
          !["succeeded", "failed", "cancelled"].includes(run.status) ||
          hash({ operation: run.operation, input: run.input }) !== run.inputHash
        )
          throw new DomainError(
            "HASH_MISMATCH",
            "运行不是不可变完成版本或输入摘要无效",
          );
      }
      if (table === "documents" && excludedDocument(row.kind))
        throw new DomainError(
          "TASK_BUNDLE_INVALID",
          "任务包不得包含会话或凭据配置",
        );
      if (table === "documents" && row.kind.startsWith("engineering-"))
        validateEngineeringDocument(row.kind, JSON.parse(row.payload));
    }
  }
}
export function importTask(tasks: TaskServices, bundle: any, name?: string) {
  validateBundle(bundle);
  // Validate SQLite constraints before creating a destination task.
  const staging = new Store(":memory:");
  try {
    insertRows(staging, bundle.rows);
  } finally {
    staging.close();
  }
  const task = tasks.create(name ?? bundle.task.name + " 导入");
  const { store } = tasks.resolve(task.id);
  insertRows(store, bundle.rows);
  // Old process/session identities are invalid on this machine. Keep old workflow as history only.
  for (const doc of store.documents("workflow-state"))
    store.putDocument("workflow-history", {
      ...doc,
      importedFromTask: bundle.task.id,
    });
  store.db.prepare("DELETE FROM documents WHERE kind='workflow-state'").run();
  const designs = store.documents("design");
  if (designs.length) {
    const last = designs.at(-1);
    const request = structuredClone(last.request);
    if (Array.isArray(request?.assetRefs))
      request.assetRefs = request.assetRefs.map((ref: any) => ({
        ...ref,
        ...(ref.taskId ? { taskId: task.id } : {}),
      }));
    store.putDocument(
      "design",
      {
        ...last,
        request,
        inputHash: hash({ request, scenario: last.scenario }),
        session: "",
        confirmed: [],
        stage: 0,
        importedFromTask: bundle.task.id,
      },
      last.id,
    );
  }
  store.putDocument("task-copy", {
    sourceTaskId: bundle.task.id,
    copiedAt: new Date().toISOString(),
  });
  store.putDocument("task-import", {
    sourceTaskId: bundle.task.id,
    sourceHash: bundle.contentHash,
    importedAt: new Date().toISOString(),
  });
  return task;
}
function insertRows(store: Store, rows: Record<string, any[]>) {
  store.db.exec("BEGIN");
  try {
    for (const [table, fields] of Object.entries(columns)) {
      const query = store.db.prepare(
        `INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
      );
      for (const row of rows[table])
        query.run(...fields.map((key) => row[key]));
    }
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}

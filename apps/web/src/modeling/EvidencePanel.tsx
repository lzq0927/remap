import type { SavedModel } from "../../../../packages/modeling/src/schema";
import { labels, download } from "./shared";
export default function EvidencePanel({
  saved,
  runs,
  onCancel,
  onReplay,
  onSnapshot,
  onEntity,
}: {
  saved: SavedModel;
  runs: any[];
  onCancel: (id: string) => void;
  onReplay: (id: string) => void;
  onSnapshot: (run: any) => void;
  onEntity: (id: string) => void;
}) {
  return (
    <section>
      <h3>真实运行与证据</h3>
      {!runs.length && (
        <p className="empty">
          尚无运行。保存模型后，到分析与验证运行具体案例。
        </p>
      )}
      {runs.map((run) => (
        <article className="eng-run" key={run.id}>
          <div className="section-head">
            <h4>
              {run.input.snapshot?.model.cases.find(
                (c: any) => c.id === run.input.caseId,
              )?.name ?? run.operation}
            </h4>
            <span>
              {
                (
                  {
                    queued: "排队",
                    running: "运行中",
                    succeeded: "执行完成",
                    failed: "执行失败",
                    cancelled: "已取消",
                  } as Record<string, string>
                )[run.status]
              }
            </span>
          </div>
          <p className="note">
            模型 v{run.input.snapshot?.revision} ·{" "}
            {new Date(run.createdAt).toLocaleString()} · {run.id}
          </p>
          {run.input.snapshot?.semanticHash !== saved.semanticHash && (
            <p className="eng-warning">
              当前设计语义已变化：此结果属于旧快照。
            </p>
          )}
          {run.error && <p className="error">{run.error.message}</p>}
          {run.result && (
            <>
              <strong className={"eng-verdict " + run.result.verdict}>
                {labels[run.result.verdict] ?? run.result.verdict}
              </strong>
              <p>
                {run.result.engine} · {run.result.version} ·{" "}
                {run.result.executionMode === "real"
                  ? "真实工具执行"
                  : "外部导入"}
              </p>
              <p>{run.result.scope}</p>
              <div className="eng-metrics">
                {Object.entries(run.result.metrics ?? {}).map(([key, v]) => (
                  <div key={key}>
                    <small>
                      {key === "probability"
                        ? "模型概率"
                        : key === "distinctStates"
                          ? "不同状态"
                          : key === "generatedStates"
                            ? "生成状态"
                            : key}
                    </small>
                    <strong>
                      {key === "probability"
                        ? (Number(v) * 100).toFixed(6) + "%"
                        : String(v)}
                    </strong>
                  </div>
                ))}
              </div>
              {!!run.result.trace?.length && (
                <details open>
                  <summary>反例轨迹 · {run.result.trace.length} 个状态</summary>
                  <ol>
                    {run.result.trace.map((s: any) => (
                      <li key={s.step}>
                        <strong>{s.label}</strong>
                        <pre>{s.state}</pre>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {!!run.result.diagnostics?.length && (
                <p className="eng-warning">
                  {run.result.diagnostics.join("；")}
                </p>
              )}
              <details>
                <summary>假设与追溯</summary>
                {run.result.traceability?.properties?.map((p: any) => (
                  <p key={p.id}>
                    {p.id}：{p.statement}
                  </p>
                ))}
                <div className="actions">
                  {run.result.traceability?.bindings?.map((b: any) => (
                    <button key={b.symbol} onClick={() => onEntity(b.entityId)}>
                      {b.symbol} →{" "}
                      {run.result.traceability.entities.find(
                        (e: any) => e.id === b.entityId,
                      )?.name ?? b.entityId}
                    </button>
                  ))}
                </div>
                <ul>
                  {run.result.assumptions?.map((a: string, i: number) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                <pre>{JSON.stringify(run.result.mapping, null, 2)}</pre>
              </details>
              <details>
                <summary>原始工具输出</summary>
                <pre>{run.result.rawOutput}</pre>
              </details>
            </>
          )}
          <div className="actions">
            {["queued", "running"].includes(run.status) ? (
              <button onClick={() => onCancel(run.id)}>取消运行</button>
            ) : !run.imported ? (
              <button onClick={() => onReplay(run.id)}>按冻结输入重放</button>
            ) : (
              <span className="note">
                导入的历史证据；如需验证，请运行当前模型案例。
              </span>
            )}
            <button onClick={() => onSnapshot(run)}>查看运行时设计</button>
            <button
              onClick={() =>
                download(
                  `engineering-run-${run.id}.json`,
                  JSON.stringify(run, null, 2),
                )
              }
            >
              完整证据 JSON
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

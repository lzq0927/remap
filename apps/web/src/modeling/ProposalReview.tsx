import type {
  SavedModel,
  Proposal,
} from "../../../../packages/modeling/src/schema";
import { changes } from "./shared";
export default function ProposalReview({
  saved,
  proposals,
  onResolve,
}: {
  saved: SavedModel;
  proposals: Proposal[];
  onResolve: (id: string, accept: boolean) => void;
}) {
  return (
    <section>
      <h3>专家审阅 · 模型变更</h3>
      {!proposals.length && (
        <p className="empty">Agent 提交的建模草案将显示在这里。</p>
      )}
      {proposals.map((p) => (
        <article className="eng-run" key={p.id}>
          <h4>{p.reason}</h4>
          <p>
            来自 {p.actor === "agent" ? "Agent" : "用户"} · 基线 v
            {p.baseRevision} · {p.status}
          </p>
          {p.baseRevision !== saved.revision && p.status === "proposed" && (
            <p className="eng-warning">
              基线已变化，需让 Agent 读取最新模型后重新提出草案。
            </p>
          )}
          {changes(saved.model, p.candidate).map((diff) => (
            <details key={diff.field}>
              <summary>
                {diff.field} 发生变化
                {["requirements", "cases"].includes(diff.field)
                  ? " · 请核对性质、假设与范围"
                  : ""}
              </summary>
              <div className="eng-diff">
                <div>
                  <strong>当前</strong>
                  <pre>{JSON.stringify(diff.before, null, 2)}</pre>
                </div>
                <div>
                  <strong>候选</strong>
                  <pre>{JSON.stringify(diff.after, null, 2)}</pre>
                </div>
              </div>
            </details>
          ))}
          {p.status === "proposed" && (
            <div className="actions">
              <button
                className="primary"
                disabled={p.baseRevision !== saved.revision}
                onClick={() => onResolve(p.id, true)}
              >
                接受草案并生成新版本
              </button>
              <button onClick={() => onResolve(p.id, false)}>
                拒绝并保留记录
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

import type { EngineeringModel } from "../../../../packages/modeling/src/schema";
import { type ModelEdit, uid } from "./shared";
export default function DecisionPanel({
  model,
  edit,
  runs,
  onAsset,
}: {
  model: EngineeringModel;
  edit: ModelEdit;
  runs: any[];
  onAsset: () => void;
}) {
  return (
    <section>
      <div className="section-head">
        <h3>设计决策与资产沉淀</h3>
        <button
          onClick={() =>
            edit((d) =>
              d.decisions.push({
                id: uid("decision"),
                statement: "",
                alternatives: "",
                reason: "",
                status: "proposed",
                sourceRefs: [],
                caseRefs: [],
                runRefs: [],
              }),
            )
          }
        >
          记录决策
        </button>
      </div>
      <p className="note">
        记录方案取舍与适用条件。保存为任务资产便于复用，不代表公共发布或实际集群验收。
      </p>
      {model.decisions.map((x) => (
        <fieldset key={x.id}>
          <legend>设计决策</legend>
          {(["statement", "alternatives", "reason"] as const).map((key, i) => (
            <label key={key}>
              {["决定", "备选方案与代价", "依据与重审条件"][i]}
              <textarea
                value={x[key]}
                onChange={(e) =>
                  edit((d) => {
                    d.decisions.find((q) => q.id === x.id)![key] =
                      e.target.value;
                  })
                }
              />
            </label>
          ))}
          <label>
            状态
            <select
              value={x.status}
              onChange={(e) =>
                edit((d) => {
                  d.decisions.find((q) => q.id === x.id)!.status = e.target
                    .value as typeof x.status;
                })
              }
            >
              <option value="proposed">待复核</option>
              <option value="accepted">采纳</option>
              <option value="rejected">否决</option>
            </select>
          </label>
          <label>
            关联真实运行
            <select
              aria-label="关联真实运行"
              value={x.runRefs[0] ?? ""}
              onChange={(e) =>
                edit((d) => {
                  const item = d.decisions.find((q) => q.id === x.id)!;
                  item.runRefs = e.target.value ? [e.target.value] : [];
                  const r = runs.find((r) => r.id === e.target.value);
                  item.caseRefs = r ? [r.input.caseId] : [];
                })
              }
            >
              <option value="">选择证据</option>
              {runs
                .filter((r) => !["queued", "running"].includes(r.status))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.input.caseId} · {r.result?.verdict ?? r.status} ·{" "}
                    {r.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
        </fieldset>
      ))}
      <button className="primary" onClick={onAsset}>
        保存设计为任务资产
      </button>
    </section>
  );
}

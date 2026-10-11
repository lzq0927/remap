import { useEffect, useState } from "react";
import { useTaskApi } from "./api";
const labels: Record<string, string> = {
  accepted: "采纳",
  modified: "调整后采纳",
  rejected: "不采纳",
};
export default function FeedbackPanel({ run }: { run: any }) {
  const { api } = useTaskApi();
  const [reason, setReason] = useState(""),
    [saved, setSaved] = useState<any>(),
    [error, setError] = useState("");
  useEffect(() => {
    setReason("");
    setSaved(undefined);
    void api("/feedback")
      .then((items) =>
        setSaved(items.filter((i: any) => i.runId === run.id).at(-1)),
      )
      .catch(() => {});
  }, [run.id]);
  return (
    <section className="paper">
      <h3>方案反馈</h3>
      <p className="note">
        反馈关联本次评估 {run.id.slice(0, 8)}，用于记录选型依据。
      </p>
      <label>
        采纳或修改理由
        <textarea
          aria-label="方案反馈理由"
          value={reason}
          placeholder="例如：需要更高检测覆盖率，或恢复成本超过预算。"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="actions">
        {Object.entries(labels).map(([decision, label]) => (
          <button
            key={decision}
            disabled={run.status !== "succeeded"}
            onClick={async () => {
              try {
                setSaved(
                  await api("/feedback", {
                    runId: run.id,
                    decision,
                    accepted: decision !== "rejected",
                    reason,
                  }),
                );
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {saved && (
        <p className="feedback-saved" role="status">
          已保存：
          {labels[saved.decision] ??
            (saved.accepted ? "采纳" : "不采纳")} ·{" "}
          {saved.reason || "未填写理由"}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

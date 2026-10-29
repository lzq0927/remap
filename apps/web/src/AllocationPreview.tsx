import { useState } from "react";
import { analysisWorkbenchCss } from "../../../packages/reports/src/audit-analysis-styles";

export default function AllocationPreview({
  calculate,
}: {
  calculate: () => Promise<any>;
}) {
  const [value, setValue] = useState<any>(),
    [cards, setCards] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const scale =
    value?.scales.find((s: any) => s.cards === cards) ?? value?.scales[0];
  const nodes = value?.architecture.nodes ?? [];
  const branch = (node: any, depth: number): any => {
    const hours = scale.budgets[node.id],
      children = nodes.filter((n: any) => n.parentId === node.id);
    return (
      <div className="allocation-target-node" key={node.id}>
        <b>{node.name}</b>
        <strong>
          {hours == null
            ? "待证据分配"
            : `目标 ${(100 * (1 - hours / scale.hours)).toFixed(3)}%`}
        </strong>
        <span>允许损失 {hours == null ? "—" : hours.toFixed(3)} h</span>
        {children.length > 0 && (
          <details open={depth === 0}>
            <summary>查看{children.length}个子层的分配</summary>
            <div className="allocation-target-children">
              {children.map((n: any) => branch(n, depth + 1))}
            </div>
          </details>
        )}
      </div>
    );
  };
  return (
    <section
      className="paper allocation-preview"
      aria-label="架构上的目标分解分配"
    >
      <style>{analysisWorkbenchCss}</style>
      <div className="section-head">
        <h3>将可用度目标分解到架构</h3>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setValue(await calculate());
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "计算中…" : "计算并查看AGREE目标分配"}
        </button>
      </div>
      <p>
        按当前保存的架构、重要度与复杂度分配；评估后的实际损失与Shapley证据建议单独留存。
      </p>
      {error && <p role="alert">{error}</p>}
      {value && (
        <>
          <p>
            <b>{value.method}</b> · 输入版本 {value.inputRevision} ·{" "}
            {value.provisional ? "设计先验，待运行证据核验" : "当前设计分配"}
          </p>
          <label>
            分配规模{" "}
            <select
              aria-label="目标分配规模"
              value={scale.cards}
              onChange={(e) => setCards(Number(e.target.value))}
            >
              {value.scales.map((s: any) => (
                <option key={s.cards} value={s.cards}>
                  {s.cards.toLocaleString()}卡
                </option>
              ))}
            </select>
          </label>
          <p>
            {scale.hours} h窗口 · 目标 {(scale.target * 100).toFixed(2)}% ·
            总预算 {scale.allowedHours.toFixed(3)} h
          </p>
          {nodes.filter((n: any) => !n.parentId).map((n: any) => branch(n, 0))}
        </>
      )}
    </section>
  );
}

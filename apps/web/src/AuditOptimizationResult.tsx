import {
  auditOptimizationSections,
  auditOptimizationBrief,
  auditOptimizationChart,
  auditOptimizedObjectDiagram,
  optimizationCss,
} from "../../../packages/reports/src/audit-optimization";
import { auditChartCss } from "../../../packages/reports/src/audit-charts";
import { useState } from "react";
export default function AuditOptimizationResult({
  result,
  onApply,
}: {
  result: any;
  onApply?: (request: any) => void;
}) {
  const [cards, setCards] = useState(
    result.optimization?.primaryCards ?? result.request.cards,
  );
  const sections = auditOptimizationSections(result);
  if (!sections.length) return null;
  return (
    <section aria-label="两轮可用度决策" className="optimization-result">
      <style>{optimizationCss + auditChartCss}</style>
      <div
        dangerouslySetInnerHTML={{
          __html:
            auditOptimizationBrief(result) + auditOptimizationChart(result),
        }}
      />
      {result.optimization.status === "evaluated" && onApply && (
        <button
          type="button"
          onClick={() => onApply(result.optimization.recommendedRequest)}
        >
          载入已复评的第二轮参数
        </button>
      )}
      {sections.map((section) => (
        <details
          className="optimization-report-details"
          key={section.title}
          open={
            section.title.startsWith("00 /") ||
            section.title === "两轮 / 各规模措施贡献排名"
          }
        >
          <summary>{section.title}</summary>
          {section.paragraphs?.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {section.visual === "optimized-objects" && (
            <div
              dangerouslySetInnerHTML={{
                __html: auditOptimizedObjectDiagram(result),
              }}
            />
          )}
          {section.tables?.some((t) => t.scaleRows) && (
            <label className="optimization-scale">
              查看规模
              <select
                aria-label={section.title + "规模"}
                value={cards}
                onChange={(e) => setCards(Number(e.target.value))}
              >
                {result.optimization.scales.map((s: any) => (
                  <option key={s.cards} value={s.cards}>
                    {s.cards.toLocaleString()} 卡
                  </option>
                ))}
              </select>
            </label>
          )}
          {section.tables?.map((table, j) => (
            <div className="table-wrap" key={j} tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    {table.heads.map((h, k) => (
                      <th key={k}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    table.scaleRows?.find((s) => s.cards === cards)?.rows ??
                    table.rows
                  ).map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, k) => (
                        <td key={k}>{String(cell ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

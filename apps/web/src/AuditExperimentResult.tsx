import { useState } from "react";
import {
  experimentSections,
  experimentChart,
} from "../../../packages/reports/src/audit-experiments";
import { auditChartCss } from "../../../packages/reports/src/audit-charts";
export default function AuditExperimentResult({ result }: { result: any }) {
  const [cards, setCards] = useState(
    result.prediction?.cards ?? result.request.cards,
  );
  const sections = experimentSections(result);
  return (
    <section
      className="audit-experiment-result"
      aria-label={
        result.kind === "expert-audit-plan"
          ? "改进分配建议"
          : result.kind === "expert-audit-comparison"
            ? "多次评估对比结果"
            : "本次独立方案结果"
      }
    >
      <style>{auditChartCss}</style>
      {sections.map((section, index) => (
        <details key={section.title} open={index === 0 || index === 1}>
          <summary>{section.title}</summary>
          {section.paragraphs?.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {section.visual === "experiment-comparison" && (
            <div
              dangerouslySetInnerHTML={{ __html: experimentChart(result) }}
            />
          )}
          {section.tables?.map((table, j) => (
            <div key={j}>
              {table.scaleRows && (
                <label className="optimization-scale">
                  查看规模{" "}
                  <select
                    aria-label={table.scaleLabel}
                    value={cards}
                    onChange={(e) => setCards(Number(e.target.value))}
                  >
                    {table.scaleRows.map((row) => (
                      <option key={row.cards} value={row.cards}>
                        {row.cards.toLocaleString()} 卡
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="table-wrap" tabIndex={0}>
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
                    ).map((row, k) => (
                      <tr key={k}>
                        {row.map((cell, l) => (
                          <td key={l}>{String(cell ?? "—")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

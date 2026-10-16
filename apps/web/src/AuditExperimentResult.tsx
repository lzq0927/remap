import { planScaleChart } from "../../../packages/reports/src/audit-plan-scales";
import { decisionStudyCharts } from "../../../packages/reports/src/audit-decision-study";
import {
  architectureReport,
  architectureCss,
} from "../../../packages/reports/src/audit-architecture";
import { useState } from "react";
import {
  experimentSections,
  experimentChart,
} from "../../../packages/reports/src/audit-experiments";
import { auditChartCss } from "../../../packages/reports/src/audit-charts";
export default function AuditExperimentResult({
  result,
  alternativeId,
}: {
  result: any;
  alternativeId?: string;
}) {
  const [cards, setCards] = useState(
    result.prediction?.cards ?? result.request.cards,
  );
  const selectedAlternative = result.decisionStudy?.alternatives.find(
    (a: any) => a.id === alternativeId,
  );
  const sections = experimentSections(
    alternativeId && result.decisionStudy
      ? {
          ...result,
          configuration:
            selectedAlternative?.configuration ?? result.configuration,
          factors: selectedAlternative?.factors ?? result.factors,
          prediction: {
            ...result.prediction,
            mean:
              selectedAlternative?.nominal.statistics.mean ??
              result.prediction.mean,
          },
          decisionStudy: {
            ...result.decisionStudy,
            displayAlternativeId: alternativeId,
          },
        }
      : result,
  );
  return (
    <section
      className="audit-experiment-result"
      aria-label={
        result.kind === "expert-audit-plan-set"
          ? "各规模改进建议汇总"
          : result.kind === "expert-audit-plan"
            ? "改进分配建议"
            : result.kind === "expert-audit-comparison"
              ? "多次评估对比结果"
              : "本次独立方案结果"
      }
    >
      <style>{auditChartCss + architectureCss}</style>
      {sections.map((section, index) => (
        <details key={section.title} open={index === 0 || index === 1}>
          <summary>{section.title}</summary>
          {section.paragraphs?.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {section.visual === "plan-set" && (
            <div dangerouslySetInnerHTML={{ __html: planScaleChart(result) }} />
          )}
          {section.visual === "decision-study" && (
            <div
              dangerouslySetInnerHTML={{
                __html: decisionStudyCharts(result, alternativeId),
              }}
            />
          )}
          {section.visual === "architecture" && (
            <div
              dangerouslySetInnerHTML={{ __html: architectureReport(result) }}
            />
          )}
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

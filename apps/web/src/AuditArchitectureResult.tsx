import { useState } from "react";
import type { AuditArchitectureDiagnosis } from "../../../packages/analysis/src/audit-architecture";
import {
  architectureCss,
  architectureHeatmap,
  architectureRankings,
  architectureScaleDetail,
} from "../../../packages/reports/src/audit-architecture";
export default function AuditArchitectureResult({
  result,
  cards,
}: {
  result: any;
  cards: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [heatmapLevel, setHeatmapLevel] = useState<"subsystem" | "leaf">(
    "subsystem",
  );
  const d: AuditArchitectureDiagnosis | undefined =
    result.architectureDiagnosis;
  if (!d)
    return (
      <p className="note">
        本历史结果未保存分层诊断，原结果与报告口径保持不变。新运行会保存架构、分层目标和诊断快照。
      </p>
    );
  return (
    <section className="architecture-diagnosis" aria-label="系统分层诊断">
      <style>{architectureCss}</style>
      <h3>系统分层目标与现状诊断</h3>
      <p className="note">{d.architecture.basis}</p>
      <label className="arch-toggle">
        <input
          type="checkbox"
          aria-label="展开诊断对象"
          checked={expanded}
          onChange={(e) => setExpanded(e.target.checked)}
        />
        展开故障对象
      </label>
      <div
        dangerouslySetInnerHTML={{
          __html: architectureScaleDetail(d, cards, true, expanded),
        }}
      />
      <details open>
        <summary>跨规模薄弱点与措施贡献对比</summary>
        <label>
          薄弱点对比层级
          <select
            aria-label="薄弱点对比层级"
            value={heatmapLevel}
            onChange={(e) =>
              setHeatmapLevel(e.target.value as "subsystem" | "leaf")
            }
          >
            <option value="subsystem">子系统汇总</option>
            <option value="leaf">故障对象明细</option>
          </select>
        </label>
        <div
          dangerouslySetInnerHTML={{
            __html:
              architectureHeatmap(d, heatmapLevel) + architectureRankings(d),
          }}
        />
      </details>
      <details>
        <summary>计算口径与诊断边界</summary>
        {d.notes.map((note) => (
          <p className="note" key={note}>
            {note}
          </p>
        ))}
      </details>
    </section>
  );
}

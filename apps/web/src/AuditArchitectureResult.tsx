import AuditAtlasExplorer from "./AuditAtlasExplorer";
import { layerAllocationTable } from "../../../packages/reports/src/audit-layer-decision";
import { useState } from "react";
import AuditHardwareDiagnosis from "./AuditHardwareDiagnosis";
import { contributionHeatmap } from "../../../packages/reports/src/audit-decision-study";
import type { AuditArchitectureDiagnosis } from "../../../packages/analysis/src/audit-architecture";
import {
  architectureCss,
  architectureTree,
  architectureHeatmap,
  architectureScaleDetail,
} from "../../../packages/reports/src/audit-architecture";
import {
  architectureTargetBreakdown,
  architectureTrend,
  faultModeGapSummary,
  lossTimeDistribution,
  contributionRankSummary,
} from "../../../packages/reports/src/audit-scale-summary";
import { auditChartCss } from "../../../packages/reports/src/audit-charts";
import {
  architectureDecisionBrief,
  decisionBriefCss,
} from "../../../packages/reports/src/audit-decision-brief";
export default function AuditArchitectureResult({
  result,
  cards,
}: {
  result: any;
  cards: number;
}) {
  const [section, setSection] = useState("targets");
  const [expanded, setExpanded] = useState(false);
  const [heatmapLevel, setHeatmapLevel] = useState<"subsystem" | "leaf">(
    "subsystem",
  );
  const [targetParent, setTargetParent] = useState("");
  const [trendNode, setTrendNode] = useState("");
  const [lossView, setLossView] = useState<"loss" | "layer" | "type">("loss");
  const d: AuditArchitectureDiagnosis | undefined =
    result.architectureDiagnosis;
  if (!d)
    return (
      <p className="note">
        本历史结果未保存分层诊断，原结果与报告口径保持不变。新运行会保存架构、分层目标和诊断快照。
      </p>
    );
  const root = d.architecture.nodes.find((n) => !n.parentId)!;
  const parents = d.architecture.nodes.filter((n) =>
    d.architecture.nodes.some((c) => c.parentId === n.id),
  );
  return (
    <section
      className="architecture-diagnosis scale-summary"
      aria-label="系统分层诊断"
    >
      <style>{architectureCss + auditChartCss + decisionBriefCss}</style>
      <h3>系统分层目标与现状诊断</h3>
      <p className="note">
        从架构定位责任层，再比较各规模的目标差距、故障损失与机制贡献。
      </p>
      <AuditAtlasExplorer
        result={result}
        events={result.events ?? []}
        cards={cards}
      />
      <div
        dangerouslySetInnerHTML={{ __html: layerAllocationTable(d, cards) }}
      />
      <div
        className="scale-summary-flow"
        role="group"
        aria-label="诊断分析视图"
      >
        {[
          ["targets", "01 目标与趋势"],
          ["faults", "02 故障薄弱点"],
          ["loss", "03 损失分布"],
          ["contributions", "04 机制贡献"],
          ["improvements", "05 改进建议"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <details>
        <summary>补充查看完整层级与传播证据</summary>
        {d.architecture.view === "hardware" ? (
          <AuditHardwareDiagnosis diagnosis={d} cards={cards} />
        ) : (
          <>
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
                __html: architectureTree(
                  d.architecture,
                  d,
                  cards,
                  expanded ? 10 : 1,
                ),
              }}
            />
          </>
        )}
      </details>
      <div data-summary-stage="targets" hidden={section !== "targets"}>
        <h3>01 / 各层目标分解与整体差距</h3>
        <div className="scale-summary-controls">
          <label>
            目标分解层级
            <select
              aria-label="目标分解层级"
              value={targetParent || root.id}
              onChange={(e) => setTargetParent(e.target.value)}
            >
              {parents.map((n) => (
                <option value={n.id} key={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            趋势查看层级
            <select
              aria-label="趋势查看层级"
              value={trendNode || root.id}
              onChange={(e) => setTrendNode(e.target.value)}
            >
              {d.architecture.nodes.map((n) => (
                <option value={n.id} key={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          dangerouslySetInnerHTML={{
            __html:
              architectureTargetBreakdown(d, targetParent) +
              architectureTrend(d, trendNode),
          }}
        />
      </div>
      <div data-summary-stage="faults" hidden={section !== "faults"}>
        <h3>02 / 故障模式库中的细分差距</h3>
        <div dangerouslySetInnerHTML={{ __html: faultModeGapSummary(d) }} />
        <details>
          <summary>展开分层与对象差距矩阵</summary>
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
              __html: architectureHeatmap(d, heatmapLevel),
            }}
          />
        </details>
      </div>
      <div data-summary-stage="loss" hidden={section !== "loss"}>
        <h3>03 / 损失时间消耗在哪里</h3>
        <label>
          损失时间分组
          <select
            aria-label="损失时间分组"
            value={lossView}
            onChange={(e) =>
              setLossView(e.target.value as "loss" | "layer" | "type")
            }
          >
            <option value="loss">按损失环节</option>
            <option value="layer">按子系统</option>
            <option value="type">按故障类型与公共开销</option>
          </select>
        </label>
        <div
          dangerouslySetInnerHTML={{
            __html: lossTimeDistribution(d, lossView),
          }}
        />
      </div>
      <div
        data-summary-stage="contributions"
        hidden={section !== "contributions"}
      >
        <h3>04 / 跨规模贡献与排名</h3>
        <div dangerouslySetInnerHTML={{ __html: contributionHeatmap(d) }} />
        <div dangerouslySetInnerHTML={{ __html: contributionRankSummary(d) }} />
      </div>
      <div
        data-summary-stage="improvements"
        className="scale-next-step"
        hidden={section !== "improvements"}
      >
        <h3>05 / 分规模优化可靠性措施</h3>
        <div
          dangerouslySetInnerHTML={{ __html: architectureDecisionBrief(d) }}
        />
        <p>
          根据各规模的分层缺口、故障范围和Shapley重要度分别做AGREE分配，形成各自的措施及参数建议；已有贡献不直接当作追加改善收益，改进方案需要单独评估。
        </p>
        <a href="#audit-scale-plans">进入分规模改进分配与建议汇总 →</a>
      </div>
      <details>
        <summary>当前规模的MTBF、恢复与逐事件证据</summary>
        <div
          dangerouslySetInnerHTML={{
            __html: architectureScaleDetail(d, cards, false),
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

import { useState } from "react";
import { auditObjectDiagram } from "../../../packages/reports/src/audit-object-diagram";
import {
  mechanismEventIds,
  type AuditEventView,
} from "../../../packages/contracts/src/audit-objects";
import { auditReferenceOnly } from "../../../packages/contracts/src/audit-presets";
import { auditSelectedMechanisms } from "../../../packages/reports/src/audit-context";

const pct = (value: number) => (value * 100).toFixed(3) + "%";
export default function AuditReliabilityDiagram({
  events,
  result,
  cards,
  candidateEvents,
  mechanisms,
  selectedMechanisms,
}: {
  events: AuditEventView[];
  result?: any;
  cards?: number;
  candidateEvents?: AuditEventView[];
  mechanisms?: any[];
  selectedMechanisms?: string[];
}) {
  const [leftId, setLeft] = useState("base"),
    [rightId, setRight] = useState("combined");
  const rows = result?.rows.filter((r: any) => r.cards === cards) ?? [];
  const optimized = result?.optimization?.scales?.find(
    (r: any) => r.cards === cards,
  );
  if (optimized)
    rows.push(
      {
        ...optimized.current,
        id: "current-verified",
        name: "第一轮现状（独立复核）",
        target: optimized.target,
      },
      {
        ...optimized.optimized,
        id: "optimized",
        name: "第二轮优化预期",
        target: optimized.target,
      },
    );
  const left = rows.find((r: any) => r.id === leftId),
    right = rows.find((r: any) => r.id === rightId);
  const catalog = (id: string) =>
    id === "optimized"
      ? result.optimization.optimizedEvents
      : id === "hardware" && result?.candidateEvents?.length
        ? result.candidateEvents
        : events;
  const covered = (mechanisms ?? [])
    .filter((m) => selectedMechanisms?.includes(m.id))
    .flatMap((m) => m.eventIds ?? mechanismEventIds(events, m.scope));
  const name = (id: string) =>
    rows.find((r: any) => r.id === id)?.name ??
    mechanisms?.find((m) => m.id === id)?.name ??
    id;
  const recommendation = result?.recommendation;
  const referenceOnly =
    result && cards !== undefined && auditReferenceOnly(result.request, cards);
  return (
    <section
      className="reliability-block-view"
      aria-label="可靠性框图与方案对比"
    >
      <div className="section-head">
        <div>
          <h3>可靠性框图 · 故障对象与措施影响</h3>
          <p className="note">
            每个模块包含对象的中断、亚健康与静默
            FIT；细粒度数据可逐事件替换。连线表示故障影响传递，物理串并联和冗余细节需结合实际架构建模。
          </p>
        </div>
      </div>
      {result && (
        <div className="diagram-comparison fields">
          <label>
            对比基准
            <select
              aria-label="框图对比基准"
              value={leftId}
              onChange={(e) => setLeft(e.target.value)}
            >
              {rows.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            对比方案
            <select
              aria-label="框图对比方案"
              value={rightId}
              onChange={(e) => setRight(e.target.value)}
            >
              {rows.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {left && right && (
        <div className="diagram-outcome" role="status">
          <strong>
            可用度 {pct(left.statistics.mean)} → {pct(right.statistics.mean)}
          </strong>
          <span>
            {referenceOnly ? (
              "本规模仅为参考点，不判定达标"
            ) : (
              <>
                目标 {pct(right.target ?? result.request.target)} ·{" "}
                {right.statistics.ciLow >=
                (right.target ?? result.request.target)
                  ? "采样区间支持达标"
                  : right.statistics.ciHigh <
                      (right.target ?? result.request.target)
                    ? "低于目标，需继续优化"
                    : "区间跨越目标，需复核"}
              </>
            )}
          </span>
          <small>
            公共保存开销 {left.ledger.save.toFixed(3)} →{" "}
            {right.ledger.save.toFixed(3)} h，未重复计入对象模块。
            {right.ledger.mechanismOverhead
              ? ` 另有机制开销 ${right.ledger.mechanismOverhead.toFixed(3)} h。`
              : ""}
          </small>
        </div>
      )}
      {result && (
        <p className="note">
          本次组合：
          {auditSelectedMechanisms(result)
            .map((m) => m.name)
            .join(" + ") || "无新增措施"}
          。单项方案均包含已确认基线；硬件方案另计指定的 FIT 目标。
        </p>
      )}
      {recommendation && (
        <div className="diagram-recommendation">
          <strong>
            {result.request.cards.toLocaleString()} 卡候选建议：
            {recommendation.chosen.mechanisms.map(name).join(" + ") ||
              "沿用基线"}
          </strong>
          <p>
            {recommendation.verification
              ? `独立复核可用度 ${pct(recommendation.verification.statistics.mean)}，${({ supported: "采样支持达到目标", below: "仍低于目标，需要继续优化", uncertain: "区间跨越目标，需增加证据" } as any)[recommendation.verification.status]}。`
              : "尚未进行独立种子复核，需验证后再交付。"}
            建议只覆盖本次所选候选和此规模；其他规模需分别验证。
          </p>
        </div>
      )}
      <div
        className="reliability-block-scroll"
        tabIndex={0}
        aria-label="故障对象框图，可横向滚动"
        dangerouslySetInnerHTML={{
          __html: auditObjectDiagram(
            events,
            left,
            right,
            catalog(leftId),
            result ? catalog(rightId) : (candidateEvents ?? events),
            covered,
          ),
        }}
      />
      <p className="note">
        FIT 表示故障发生率，检测恢复通常改善损失而不降低源
        FIT。模块中的损失包含停机、回滚、污染、降速与局部容量影响；组合收益来自两套完整方案的仿真，不能由单项改善简单相加。
      </p>
      {!result && (
        <p className="note">
          当前展示输入与覆盖范围；运行第五步评估后，可在“可靠性框图”结果页切换无措施、单项、组合和硬件目标方案，查看真实改善。
        </p>
      )}
    </section>
  );
}

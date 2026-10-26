import { parameterLabels } from "../../../packages/reports/src/audit-labels";
import type { TopologyDecision } from "../../../packages/analysis/src/audit-topology-decision";
import {
  auditNumber as num,
  auditPercent as pct,
  auditParameter,
} from "../../../packages/contracts/src/audit-recovery-budget";
export default function AuditTopologyInspector({
  decision,
  cards,
  id,
  onSelect,
  mechanisms,
}: {
  decision: TopologyDecision;
  cards: number;
  id: string;
  onSelect: (id: string) => void;
  mechanisms: any[];
}) {
  const scale = decision.scales.find((s) => s.cards === cards)!;
  const nodes = scale.scenarios[0].nodes,
    n = nodes.find((n) => n.id === id)!;
  const descendants = new Set([id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const child of nodes)
      if (
        child.parentId &&
        descendants.has(child.parentId) &&
        !descendants.has(child.id)
      ) {
        descendants.add(child.id);
        changed = true;
      }
  }
  const sources = decision.estimates.filter(
    (e) => e.cards === cards && descendants.has(e.nodeId),
  );
  const eventIds = new Set(sources.map((e) => e.eventId));
  const applicable = mechanisms.filter(
    (m) =>
      m.eventIds.some((id: string) => eventIds.has(id)) ||
      (id === "overhead" && m.id === "fast"),
  );
  return (
    <div className="topology-node-detail">
      <h4>{n.name}</h4>
      <p>超节点主图责任单元 · {num(n.quantity, 0)}单元</p>
      <p>
        分配目标 <strong>{pct(n.target)}</strong> · 损失预算{" "}
        <strong>{num(n.allowedHours)} h</strong>
      </p>
      {n.parentId && (
        <button type="button" onClick={() => onSelect(n.parentId!)}>
          查看父层：{nodes.find((p) => p.id === n.parentId)?.name}
        </button>
      )}
      {nodes
        .filter((c) => c.parentId === id)
        .map((c) => (
          <button type="button" key={c.id} onClick={() => onSelect(c.id)}>
            {c.name}
          </button>
        ))}
      {scale.scenarios.map((s) => {
        const v = s.nodes.find((n) => n.id === id)!;
        return (
          <div key={s.name}>
            <h5>{s.name}</h5>
            <dl>
              <dt>可用度 / FIT</dt>
              <dd>
                {pct(v.availability)} / {num(v.fit)}
              </dd>
              <dt>中断事件MTBF</dt>
              <dd>{num(v.mtbfHours)} h</dd>
              <dt>实际等效MTTR / 目标预算</dt>
              <dd>
                {num(v.mttrSeconds, 1)} / {num(v.targetMttrSeconds, 1)} s
              </dd>
              <dt>损失 / 预算差距</dt>
              <dd>
                {num(v.actualHours)} / {num(v.gapHours)} h
              </dd>
            </dl>
          </div>
        );
      })}
      <details open>
        <summary>对应故障模式与估算依据</summary>
        {sources.map((e, i) => (
          <p key={i}>
            <strong>{e.eventId}</strong> · {e.scenario}
            <br />
            源FIT {num(e.sourceFit)} × {pct(e.fraction)} = {num(e.fit)}；损失{" "}
            {num(e.lossHours)}h<br />
            <small>
              {e.estimated ? "工程估算：" : "源映射："}
              {e.method}
              <br />
              {e.source}
            </small>
          </p>
        ))}
      </details>
      <details>
        <summary>对应可靠性机制</summary>
        {applicable.map((m) => (
          <p key={m.id}>
            <strong>{m.name}</strong> ·{" "}
            {m.status === "candidate"
              ? "候选"
              : m.status === "deployed"
                ? "固定部署"
                : "本轮已选"}
            <br />
            {m.effect}
            <small>
              {Object.entries(m.parameters ?? {})
                .map(
                  ([key, value]) =>
                    (parameterLabels[key] ?? key) +
                    " " +
                    auditParameter(Number(value), key),
                )
                .join("；")}
            </small>
            <small>{m.source}</small>
          </p>
        ))}
      </details>
      <p className="note">{decision.metricBasis}</p>
    </div>
  );
}

import type { AuditArchitecture } from "../../contracts/src/audit-architecture";
import {
  eventLossHours,
  type AuditEventView,
} from "../../contracts/src/audit-objects";
import { agreeLossAllocation } from "./audit-allocation";

export type LayerEvidence = {
  eventIds: string[];
  fit: number;
  modeCount: number;
  actualHours: number;
  projectedGain: number;
  complexity: number;
  importance: number;
  priorityBasis: string;
  mechanisms: string[];
};
export type LayerAllocationReference = {
  scales: {
    cards: number;
    allocationIssues?: { id: string; message: string }[];
    nodes: {
      id: string;
      allowedHours: number | null;
      allocationEvidence?: LayerEvidence | null;
    }[];
  }[];
};

/** Engineering priority projection, NOT a local causal Shapley or conditional failure probability. */
export function layerEvidenceAllocation(
  architecture: AuditArchitecture,
  events: AuditEventView[],
  row: any,
  coverage: { id: string; eventIds: string[]; overhead: boolean }[],
  contributions: any[],
  hours: number,
  budget: number | null,
  cards: number,
) {
  const children = (id: string) =>
    architecture.nodes.filter((n) => n.parentId === id);
  const root = architecture.nodes.find((n) => !n.parentId)!;
  const evidence = new Map<string, LayerEvidence>();
  const leaves = architecture.nodes.filter((n) => !children(n.id).length);
  for (const n of leaves) {
    const own = events.filter((e) => n.eventIds.includes(e.id));
    const actualHours =
      n.kind === "overhead"
        ? (row.ledger.save ?? 0) + (row.ledger.mechanismOverhead ?? 0)
        : own.reduce((s, e) => s + eventLossHours(row.perEvent?.[e.id]), 0);
    evidence.set(n.id, {
      eventIds: own.map((e) => e.id),
      fit: own.reduce((s, e) => s + e.fit, 0),
      modeCount:
        own.filter((e) => e.fit > 0).length + (n.kind === "overhead" ? 1 : 0),
      actualHours,
      projectedGain: 0,
      complexity: 0,
      importance: 0,
      priorityBasis: "",
      mechanisms: [],
    });
  }
  for (const contribution of contributions) {
    const mechanism = coverage.find((m) => m.id === contribution.id);
    const gain = Math.max(0, contribution.statistics.mean);
    if (!mechanism || !gain) continue;
    const eligible = leaves.map((n) => {
      const ids = n.eventIds.filter((id) => mechanism.eventIds.includes(id));
      return {
        n,
        loss:
          n.kind === "overhead" && mechanism.overhead
            ? evidence.get(n.id)!.actualHours
            : ids.reduce((s, id) => s + eventLossHours(row.perEvent?.[id]), 0),
        exposure: events
          .filter((e) => ids.includes(e.id))
          .reduce((s, e) => s + (e.fit * cards) / 1e9, 0),
      };
    });
    const totalLoss = eligible.reduce((s, e) => s + e.loss, 0),
      totalRate = eligible.reduce((s, e) => s + e.exposure, 0);
    for (const e of eligible) {
      const share =
        totalLoss > 0
          ? e.loss / totalLoss
          : totalRate > 0
            ? e.exposure / totalRate
            : 0;
      if (!share) continue;
      const item = evidence.get(e.n.id)!;
      item.projectedGain += gain * share;
      item.mechanisms.push(mechanism.id);
    }
  }
  const rollup = (id: string): LayerEvidence => {
    const n = architecture.nodes.find((n) => n.id === id)!;
    const parts = children(id).map((n) => rollup(n.id));
    if (parts.length)
      evidence.set(id, {
        eventIds: parts.flatMap((n) => n.eventIds),
        fit: parts.reduce((s, n) => s + n.fit, 0),
        modeCount: parts.reduce((s, n) => s + n.modeCount, 0),
        actualHours: parts.reduce((s, n) => s + n.actualHours, 0),
        projectedGain: parts.reduce((s, n) => s + n.projectedGain, 0),
        complexity: 0,
        importance: 0,
        priorityBasis: "",
        mechanisms: [...new Set(parts.flatMap((n) => n.mechanisms))],
      });
    const value = evidence.get(id)!;
    value.complexity = value.modeCount * (n.scaleWeights?.[cards] ?? n.weight);
    return value;
  };
  rollup(root.id);
  const budgets = new Map<string, number | null>([[root.id, budget]]);
  const issues: { id: string; message: string }[] = [];
  const split = (id: string) => {
    const nodes = children(id),
      known = nodes.filter((n) => evidence.get(n.id)!.modeCount > 0),
      total = budgets.get(id) ?? null;
    const maxGain = Math.max(
      0,
      ...known.map((n) => evidence.get(n.id)!.projectedGain),
    );
    const maxLoss = Math.max(
      0,
      ...known.map((n) => evidence.get(n.id)!.actualHours),
    );
    const maxFit = Math.max(0, ...known.map((n) => evidence.get(n.id)!.fit));
    const score = (id: string) => {
      const e = evidence.get(id)!;
      return maxGain || maxLoss
        ? Math.max(
            maxGain ? e.projectedGain / maxGain : 0,
            maxLoss ? e.actualHours / maxLoss : 0,
          )
        : maxFit
          ? e.fit / maxFit
          : 1;
    };
    for (const n of known) {
      const e = evidence.get(n.id)!;
      e.importance = (0.2 + 0.8 * score(n.id)) * n.importance;
      e.priorityBasis =
        maxGain || maxLoss
          ? "max(同级归一化实际损失, 同级归一化正Shapley投影)；工程优先级"
          : "事件FIT暴露（本轮未观察到损失和正贡献时）";
    }
    let allocation: ReturnType<typeof agreeLossAllocation> | null = null;
    try {
      if (total !== null && known.length)
        allocation = agreeLossAllocation(
          total,
          hours,
          known.map((n) => ({
            id: n.id,
            name: n.name,
            ...evidence.get(n.id)!,
          })),
        );
    } catch (error) {
      issues.push({ id, message: (error as Error).message });
    }
    for (const n of nodes) {
      budgets.set(
        n.id,
        allocation?.items.find((i) => i.id === n.id)?.allowedHours ?? null,
      );
      split(n.id);
    }
  };
  split(root.id);
  return {
    budgets,
    evidence,
    issues,
    method: "agree.layer-evidence.v1",
    basis:
      "复杂度=有暴露的独立故障模式数×显式设计权重。优先级=max(同级归一化实际损失, 同级归一化正Shapley投影)，二者均无时用FIT暴露；映射0.2–1并乘人工重要度。投影按机制适用事件损失分担，不是局部因果Shapley或条件故障概率。经典条件式形状归一化到损失小时；未知对象不分配伪零预算。",
  };
}

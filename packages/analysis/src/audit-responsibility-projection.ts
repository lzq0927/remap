import type { TopologyDecisionNode } from "./audit-topology-decision";
import { equivalentMttrSeconds } from "../../contracts/src/audit-recovery-budget";

/** Correct the IOD responsibility boundary in a derived view. Original runs,
 * source-event losses and leaf budgets remain immutable; this is not a new fit. */
export function networkIodProjection<
  T extends {
    hours: number;
    scales: { cards: number; scenarios: { nodes: TopologyDecisionNode[] }[] }[];
    method: string;
    basis: string;
  },
>(source: T): T {
  const legacy = source.scales.some((scale) =>
    scale.scenarios.some((stage) => {
      const iod = stage.nodes.find((n) => n.id === "object-IOD");
      return iod && iod.parentId !== "hardware-network";
    }),
  );
  if (!legacy) return source;
  const result = structuredClone(source);
  for (const scale of result.scales)
    for (const stage of scale.scenarios) {
      const nodes = new Map(stage.nodes.map((n) => [n.id, n]));
      const iod = nodes.get("object-IOD"),
        network = nodes.get("hardware-network");
      if (!iod || !network || iod.parentId === network.id) continue;
      const change = (id: string, sign: number) => {
        const n = nodes.get(id)!;
        for (const key of [
          "fit",
          "hardFit",
          "complexity",
          "gain",
          "actualHours",
        ] as const)
          n[key] += sign * iod[key];
        for (const key of Object.keys(n.loss) as (keyof typeof n.loss)[])
          n.loss[key] += sign * iod.loss[key];
        n.allowedHours =
          n.allowedHours === null || iod.allowedHours === null
            ? null
            : n.allowedHours + sign * iod.allowedHours;
        n.availability = 1 - n.actualHours / result.hours;
        n.target =
          n.allowedHours === null ? null : 1 - n.allowedHours / result.hours;
        n.mtbfHours = n.hardFit > 0 ? 1e9 / (scale.cards * n.hardFit) : null;
        n.mttrSeconds = equivalentMttrSeconds(n.mtbfHours, n.availability);
        n.targetMttrSeconds =
          n.target === null
            ? null
            : equivalentMttrSeconds(n.mtbfHours, n.target);
        n.gapHours =
          n.allowedHours === null ? null : n.actualHours - n.allowedHours;
      };
      let parent = iod.parentId;
      while (parent && parent !== "system") {
        const next = nodes.get(parent)?.parentId;
        if (!nodes.has(parent)) break;
        change(parent, -1);
        parent = next;
      }
      change(network.id, 1);
      iod.parentId = network.id;
      iod.domain = "network";
      iod.physicalParentId = "hardware-chip";
    }
  result.method = "topology-conservative-partition.iod-network.v2";
  result.basis +=
    " IOD责任归属修订：物理位置仍在芯片内，损失及冻结叶预算从计算移至网络；全系统结果、源事件FIT和损失不变。";
  return result;
}

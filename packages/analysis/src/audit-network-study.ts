import {
  networkStudySchema,
  networkStudyLimits,
  type NetworkStudy,
} from "../../contracts/src/audit-network-study";
import { solveStatic, type StaticNode } from "../../solvers/src/static";
import type { AuditArchitecture } from "../../contracts/src/audit-architecture";
import { supernodeCounts } from "../../contracts/src/audit-topology-config";

export function networkStudySnapshot(
  architecture: AuditArchitecture,
  cards: number,
) {
  if (!architecture.networkStudy) return null;
  return compareNetworkLayouts(
    architecture.networkStudy,
    architecture.topology
      ? supernodeCounts(architecture.topology, cards).supernodes
      : 1,
  );
}

export type NetworkLayout = "single" | "same-cabinet" | "split-cabinet";
export const networkLayoutNames: Record<NetworkLayout, string> = {
  single: "每平面单 L2",
  "same-cabinet": "双 L2 · 同柜",
  "split-cabinet": "双 L2 · 跨柜",
};

export function networkSuccessTree(
  config: NetworkStudy,
  layout: NetworkLayout,
) {
  const c = networkStudySchema.parse(config);
  if (!(layout in networkLayoutNames)) throw new Error("未知组网方案");
  const device = 1 / (1 + c.deviceFit * 1e-9 * c.deviceRepairHours);
  const cabinet = 1 / (1 + c.cabinetFit * 1e-9 * c.cabinetRepairHours);
  const path = (plane: number, branch: number): StaticNode => ({
    type: "and",
    children: [
      {
        type: "event",
        id: `cabinet-${(Math.floor((plane * c.cabinets) / c.planes) + (layout === "split-cabinet" ? branch : 0)) % c.cabinets}`,
        probability: cabinet,
      },
      {
        type: "event",
        id:
          c.opticsPerPath === undefined
            ? `device-${plane}-${branch}`
            : `path-${plane}-${branch}-device`,
        probability: device,
      },
      ...Array.from({ length: c.opticsPerPath ?? 0 }, (_, i) => ({
        type: "event" as const,
        id: `path-${plane}-${branch}-optic-${i}`,
        probability: 1 / (1 + c.opticFit! * 1e-9 * c.opticRepairHours!),
      })),
    ],
  });
  const capacity: StaticNode = {
    type: "kofn",
    k: c.requiredPlanes,
    children: Array.from({ length: c.planes }, (_, i) =>
      layout === "single"
        ? path(i, 0)
        : { type: "or", children: [path(i, 0), path(i, 1)] },
    ),
  } as StaticNode;
  return c.sharedFit === undefined
    ? capacity
    : ({
        type: "and",
        children: [
          capacity,
          {
            type: "event",
            id: "shared-upstream",
            probability: 1 / (1 + c.sharedFit * 1e-9 * c.sharedRepairHours!),
          },
        ],
      } as StaticNode);
}

function wilson(successes: number, n: number): [number, number] {
  const z = 1.959963984540054,
    p = successes / n,
    d = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / d;
  const radius = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

/** Independently evaluate Boolean gates on shared sampled basic events, not on the BDD. */
export function sampleNetwork(tree: StaticNode, trials: number, seed: number) {
  const probabilities = new Map<string, number>();
  const gather = (node: StaticNode) => {
    if (node.type === "event") probabilities.set(node.id!, node.probability!);
    else node.children!.forEach(gather);
  };
  gather(tree);
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const values = new Map<string, boolean>();
  const evaluate = (node: StaticNode): boolean => {
    if (node.type === "event") return values.get(node.id!)!;
    if (node.type === "and" || node.type === "series")
      return node.children!.every(evaluate);
    if (node.type === "or" || node.type === "parallel")
      return node.children!.some(evaluate);
    let n = 0;
    for (const child of node.children!)
      if (evaluate(child) && ++n >= node.k!) return true;
    return false;
  };
  let successes = 0;
  for (let i = 0; i < trials; i++) {
    for (const [id, p] of probabilities) values.set(id, random() < p);
    if (evaluate(tree)) successes++;
  }
  return {
    trials,
    seed,
    successes,
    failures: trials - successes,
    availability: successes / trials,
    interval95: wilson(successes, trials),
    precision:
      trials === successes
        ? "零失败只能给出区间，不能证明可用度为100%"
        : "95% Wilson区间；稀有失效精度由失败样本数决定",
  };
}

export function compareNetworkLayouts(input: NetworkStudy, supernodes = 1) {
  const config = networkStudySchema.parse(input);
  if (!Number.isInteger(supernodes) || supernodes < 1 || supernodes > 1e8)
    throw new Error("超节点数量无效");
  const rows = (Object.keys(networkLayoutNames) as NetworkLayout[]).map(
    (layout) => {
      const tree = networkSuccessTree(config, layout),
        exact = solveStatic({ method: "bdd", tree });
      const sample = sampleNetwork(tree, config.trials, config.seed);
      return {
        layout,
        name: networkLayoutNames[layout],
        deviceCount: config.planes * (layout === "single" ? 1 : 2),
        availability: exact.probability,
        independentFleetAvailability: Math.pow(exact.probability, supernodes),
        solver: exact.details,
        sample,
        tree,
      };
    },
  );
  return {
    method:
      config.opticsPerPath === undefined
        ? "l2-capacity-bdd-snapshot-mc.v1"
        : "l2-optics-shared-bdd-snapshot-mc.v2",
    metric: "steady-state-structural-availability",
    config,
    supernodes,
    rows,
    assumptions: networkStudyLimits,
  };
}

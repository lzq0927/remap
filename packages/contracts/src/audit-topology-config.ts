import { z } from "zod";

const size = z.number().int().min(1).max(1e8);
const optionalCount = z.number().int().min(0).max(100000).nullable();
export const supernodeTopologySchema = z
  .object({
    kind: z.literal("supernode-reference"),
    cardsPerSupernode: size,
    cardsPerRack: size,
    cardsPerNode: size,
    cardsPerBoard: size,
    supernodesPerPod: size,
    scaleUpSwitchesPerRack: optionalCount,
    interconnectRacksPerSupernode: optionalCount.optional(),
    l2DevicesPerSupernode: optionalCount.optional(),
    ioBladesPerRack: optionalCount.optional(),
    ubNicsPerIoBlade: optionalCount.optional(),
    planesPerSupernode: optionalCount.optional(),
    portsPerL1: optionalCount.optional(),
    portsPerL2: optionalCount.optional(),
    scaleOutLeavesPerSupernode: optionalCount,
    scaleOutSpinesPerPod: optionalCount,
    opticalLinksPerNode: optionalCount,
    opticalLinksPerSupernode: optionalCount,
    source: z.string().trim().min(1).max(2000),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (
      t.cardsPerBoard > t.cardsPerNode ||
      t.cardsPerNode > t.cardsPerRack ||
      t.cardsPerRack > t.cardsPerSupernode ||
      t.cardsPerNode % t.cardsPerBoard ||
      t.cardsPerRack % t.cardsPerNode ||
      t.cardsPerSupernode % t.cardsPerRack
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "板、节点、机柜、超节点容量需逐层整除且递增",
      });
  });
export type SupernodeTopology = z.infer<typeof supernodeTopologySchema>;
export const topologyQuantityKeys = [
  "cards",
  "boards",
  "nodes",
  "racks",
  "supernodes",
  "pods",
  "scaleUpSwitches",
  "l1Blades",
  "l2Devices",
  "interconnectRacks",
  "ioBlades",
  "ubNics",
  "scaleOutLeaves",
  "scaleOutSpines",
  "scaleOutSwitches",
  "opticalModules",
] as const;
export type TopologyQuantityKey = (typeof topologyQuantityKeys)[number];

/** Active footprint packs the final rack/supernode; provisioned capacity is separate. */
export function supernodeCounts(t: SupernodeTopology, cards: number) {
  if (!Number.isInteger(cards) || cards < 1 || cards > 1e8)
    throw new Error("拓扑卡数需为1至1亿的整数");
  supernodeTopologySchema.parse(t);
  const fullSupernodes = Math.floor(cards / t.cardsPerSupernode);
  const tailCards = cards % t.cardsPerSupernode;
  const supernodes = Math.ceil(cards / t.cardsPerSupernode);
  const pods = Math.ceil(supernodes / t.supernodesPerPod);
  const racks =
    fullSupernodes * (t.cardsPerSupernode / t.cardsPerRack) +
    Math.ceil(tailCards / t.cardsPerRack);
  const nodes = Math.ceil(cards / t.cardsPerNode);
  const boards = Math.ceil(cards / t.cardsPerBoard);
  const multiply = (n: number, x: number | null | undefined) =>
    x == null ? null : n * x;
  const l1Blades = multiply(racks, t.scaleUpSwitchesPerRack);
  const l2Devices = multiply(supernodes, t.l2DevicesPerSupernode);
  const ioBlades = multiply(racks, t.ioBladesPerRack);
  const opticalModules =
    t.opticalLinksPerNode === null || t.opticalLinksPerSupernode === null
      ? null
      : 2 *
        (nodes * t.opticalLinksPerNode +
          supernodes * t.opticalLinksPerSupernode);
  return {
    cards,
    boards,
    nodes,
    racks,
    supernodes,
    pods,
    l1Blades,
    l2Devices,
    l1Ports: l1Blades === null ? null : multiply(l1Blades, t.portsPerL1),
    l2Ports: l2Devices === null ? null : multiply(l2Devices, t.portsPerL2),
    interconnectRacks: multiply(supernodes, t.interconnectRacksPerSupernode),
    ioBlades,
    ubNics: ioBlades === null ? null : multiply(ioBlades, t.ubNicsPerIoBlade),
    scaleUpSwitches:
      t.l2DevicesPerSupernode === undefined
        ? l1Blades
        : l1Blades === null || l2Devices === null
          ? null
          : l1Blades + l2Devices,
    scaleOutLeaves: multiply(supernodes, t.scaleOutLeavesPerSupernode),
    scaleOutSpines: multiply(pods, t.scaleOutSpinesPerPod),
    opticalModules,
    scaleOutSwitches:
      t.scaleOutLeavesPerSupernode === null || t.scaleOutSpinesPerPod === null
        ? null
        : supernodes * t.scaleOutLeavesPerSupernode +
          pods * t.scaleOutSpinesPerPod,
    fullSupernodes,
    tailCards,
    provisionedCards: supernodes * t.cardsPerSupernode,
    activeRackCapacity: racks * t.cardsPerRack,
  };
}

export const defaultSupernodeTopology: SupernodeTopology = {
  kind: "supernode-reference",
  cardsPerSupernode: 1024,
  cardsPerRack: 64,
  cardsPerNode: 8,
  cardsPerBoard: 8,
  supernodesPerPod: 32,
  scaleUpSwitchesPerRack: 4,
  interconnectRacksPerSupernode: 2,
  l2DevicesPerSupernode: 16,
  ioBladesPerRack: 2,
  ubNicsPerIoBlade: 8,
  planesPerSupernode: 8,
  portsPerL1: 32,
  portsPerL2: 128,
  scaleOutLeavesPerSupernode: null,
  scaleOutSpinesPerPod: null,
  opticalLinksPerNode: null,
  opticalLinksPerSupernode: null,
  source:
    "华为云 Atlas 950 SuperPoD 组网拓扑，更新2026-10-21，核对2026-10-25：https://support.huaweicloud.com/resmgmt-modelarts/resmgmt-a5_0003.html。1024 NPU模组、16计算柜×64模组、2互联柜、16台L2、8平面、每计算柜4个L1刀片（按页面端口公式）、2个IO刀片，每IO选8张UB网卡（图1示例，亦可16）。板/节点8模组及每集群分组32超节点为工程假设；千卡及更大规模按完整互联单元扩展，尾柜按需部署。光模块总量与跨超节点Leaf/Spine待BOM确认。",
};

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
  const multiply = (n: number, x: number | null) => (x === null ? null : n * x);
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
    scaleUpSwitches: multiply(racks, t.scaleUpSwitchesPerRack),
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
  scaleUpSwitchesPerRack: null,
  scaleOutLeavesPerSupernode: null,
  scaleOutSpinesPerPod: null,
  opticalLinksPerNode: null,
  opticalLinksPerSupernode: null,
  source:
    "1024卡为用户指定参考容量；64卡/柜、8卡/节点及板、32超节点/Pod为可编辑工程假设，未核实为A5官方BOM。交换机与光链路数量待配置。参考https://support.huaweicloud.com/resmgmt-modelarts/resmgmt-a5_0003.html（原页待核对）；补充资料https://www.huawei.com/cn/news/2025/9/hc-superpod-innovation，产品型号规格不能混用。",
};

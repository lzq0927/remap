import { agreeLossAllocation } from "./audit-allocation";
import { equivalentMttrSeconds } from "../../contracts/src/audit-recovery-budget";
import {
  hardwareCount,
  hardwareScaleEvents,
} from "../../contracts/src/audit-hardware";
import { supernodeCounts } from "../../contracts/src/audit-topology-config";

const lossKeys = [
  "downtime",
  "rollback",
  "slowdown",
  "localLoss",
  "terminalInvalid",
  "save",
  "mechanismOverhead",
] as const;
const emptyLoss = () =>
  Object.fromEntries(lossKeys.map((k) => [k, 0])) as Record<
    (typeof lossKeys)[number],
    number
  >;
export type TopologyDecisionNode = {
  id: string;
  name: string;
  parentId?: string;
  domain: string;
  quantity: number | null;
  fit: number;
  hardFit: number;
  complexity: number;
  gain: number;
  importance: number;
  loss: ReturnType<typeof emptyLoss>;
  actualHours: number;
  allowedHours: number | null;
  availability: number;
  target: number | null;
  mtbfHours: number | null;
  mttrSeconds: number | null;
  targetMttrSeconds: number | null;
  gapHours: number | null;
};
export type TopologyEstimate = {
  cards: number;
  scenario: string;
  nodeId: string;
  nodeName: string;
  eventId: string;
  type: string;
  sourceFit: number;
  fraction: number;
  fit: number;
  lossHours: number;
  sampledEvents: number;
  downtimeHours: number;
  source: string;
  estimated: boolean;
  method: string;
};

/** A conservative diagnostic partition of frozen evidence. It does not invent new events,
 * run a second solver, or treat a bundled scenario delta as a causal mechanism gain. */
export function topologyDecision(result: any, reference?: { scales: any[] }) {
  const entries: any[] =
    result.kind === "expert-audit-comparison"
      ? result.entries
      : [
          {
            name: result.request?.trainingScenario?.name ?? "本轮评估",
            events: result.events,
            rows: result.rows?.filter((r: any) => !r.id || r.id === "combined"),
            configuration: result.configuration ?? result.config,
            trainingScenario: result.request?.trainingScenario,
            architectureDiagnosis: result.architectureDiagnosis,
          },
        ];
  const architecture = entries[0]?.architectureDiagnosis?.architecture;
  if (!architecture?.topology || !entries[0].rows?.length) return null;
  const t = architecture.topology;
  const allocationMethod = architecture.budgetMethod ?? "agree-evidence";
  const allocationLabel = (
    {
      none: "仅诊断，不分配子层预算",
      equal: "同级均分",
      weighted: "同级设计权重",
      agree: "AGREE设计权重",
      "agree-evidence": "AGREE故障/损失/正贡献证据",
    } as Record<string, string>
  )[allocationMethod];
  const hours: number = result.request.hours;
  const cards: number[] = [
    ...new Set<number>(entries[0].rows.map((r: any) => r.cards)),
  ]
    .filter(
      (c) =>
        c !== 1000 ||
        result.request.cards === 1000 ||
        result.request.targets?.[c] !== undefined,
    )
    .sort((a, b) => a - b);
  const estimates: TopologyEstimate[] = [];
  const allocationIssues: string[] = [];
  const scales = cards.map((cards) => {
    const counts = supernodeCounts(t, cards);
    const ubNics = counts.ubNics ?? Math.ceil(cards / 4);
    const leaf = counts.scaleOutLeaves ?? Math.ceil(ubNics / 32);
    const spine = counts.scaleOutSpines ?? Math.ceil((leaf * 32) / 128);
    const l1 = counts.l1Blades ?? Math.ceil(cards / 16);
    const l2 = counts.l2Devices ?? Math.ceil(cards / 64);
    const optics =
      counts.opticalModules ??
      2 *
        (Math.min(l1 * (t.portsPerL1 ?? 32), l2 * (t.portsPerL2 ?? 128)) +
          ubNics +
          leaf * 32);
    const schema: {
      id: string;
      name: string;
      parentId?: string;
      domain: string;
      quantity: number | null;
    }[] = [];
    const add = (
      id: string,
      name: string,
      parentId: string | undefined,
      domain: string,
      quantity: number | null = null,
    ) => schema.push({ id, name, parentId, domain, quantity });
    add("system", "集群总体", undefined, "system", cards);
    add("domain-1", "计算资源", "system", "compute", cards);
    add(
      "hardware-supernode",
      "超节点 / 性能域",
      "domain-1",
      "compute",
      counts.supernodes,
    );
    add(
      "hardware-rack",
      "计算机柜",
      "hardware-supernode",
      "compute",
      counts.racks,
    );
    add(
      "hardware-node",
      "计算节点 / 框",
      "hardware-rack",
      "compute",
      counts.nodes,
    );
    add("hardware-board", "计算板", "hardware-node", "compute", counts.boards);
    add("hardware-module", "NPU模组", "hardware-board", "compute", cards);
    add("hardware-chip", "NPU芯片", "hardware-module", "compute", cards);
    for (const id of ["CORE", "SRAM", "IOD"])
      add("object-" + id, id, "hardware-chip", "compute", cards);
    add("object-HBM", "HBM / 内存路径", "hardware-module", "compute", cards);
    add("object-MODULE", "模组连接", "hardware-module", "compute", cards);
    add(
      "hardware-board-extra",
      "板级连接",
      "hardware-board",
      "compute",
      counts.boards,
    );
    for (const id of ["CPU", "DDR", "SSD"])
      add(
        "object-" + id,
        id,
        "hardware-node",
        "compute",
        (architecture.nodes.some((n: any) => n.id === "object-" + id)
          ? hardwareCount(architecture, "object-" + id, cards)
          : null) ?? counts.nodes,
      );
    add("hardware-network", "网络互联", "system", "network");
    for (const [id, name, q] of [
      ["hardware-l1", "L1互联刀片", l1],
      ["hardware-l2", "L2互联设备", l2],
      ["hardware-io", "IO转换刀片", counts.ioBlades ?? counts.racks * 2],
      ["hardware-ubnic", "UB网卡", ubNics],
      ["hardware-leaf-extra", "参数面Leaf", leaf],
      ["hardware-spine-extra", "参数面Spine", spine],
      ["object-OPT", "光链路 / 模块", optics],
    ] as const)
      add(id, name, "hardware-network", "network", q);
    add("hardware-storage", "共享存储", "system", "storage", 1);
    add("object-STORAGE", "存储服务", "hardware-storage", "storage", 1);
    add("hardware-facility", "供电 / 冷却 / 管理", "system", "facility");
    for (const id of ["POWER", "COOL", "MGMT"])
      add(
        "object-" + id,
        { POWER: "供电", COOL: "冷却", MGMT: "管理控制" }[id]!,
        "hardware-facility",
        "facility",
        counts.racks,
      );
    add("hardware-other", "软件与其他", "system", "other");
    add("object-UNKNOWN", "软件 / 未归因余项", "hardware-other", "other");
    add("overhead", "保存与检测开销", "system", "overhead");
    const source =
      "工程估算v1：保持源事件总FIT与逐事件损失不变；按拓扑数量分担，非单件实测FIT。";
    const scenarios = entries
      .map((entry) => {
        const row = entry.rows.find((r: any) => r.cards === cards);
        if (!row) return null;
        const diagnosis = entry.architectureDiagnosis?.scales.find(
          (s: any) => s.cards === cards,
        );
        const events: any[] =
          diagnosis?.scaleEvents ??
          row.scaleEvents ??
          hardwareScaleEvents(entry.events, architecture, cards);
        const nodes: TopologyDecisionNode[] = schema.map((n) => ({
          ...n,
          fit: 0,
          hardFit: 0,
          complexity: 0,
          gain: 0,
          importance: 1,
          loss: emptyLoss(),
          actualHours: 0,
          allowedHours: null,
          availability: 1,
          target: null,
          mtbfHours: null,
          mttrSeconds: null,
          targetMttrSeconds: null,
          gapHours: null,
        }));
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        for (const event of events) {
          const object = event.id.split("-")[0];
          const known = architecture.nodes.find((n: any) =>
            n.eventIds?.includes(event.id),
          );
          const measuredOwner = diagnosis?.nodes.find(
            (n: any) => n.id === known?.id,
          );
          const ownerEvents = events.filter((e) =>
            known?.eventIds.includes(e.id),
          );
          const eventLoss = (id: string) =>
            lossKeys
              .filter((k) => k !== "save" && k !== "mechanismOverhead")
              .reduce((sum, k) => sum + (row.perEvent?.[id]?.[k] ?? 0), 0);
          const ownerLoss = ownerEvents.reduce(
            (sum, e) => sum + eventLoss(e.id),
            0,
          );
          const ownerFit = ownerEvents.reduce((sum, e) => sum + e.fit, 0);
          const gain =
            (measuredOwner?.allocationEvidence?.projectedGain ?? 0) *
            (ownerLoss > 0
              ? eventLoss(event.id) / ownerLoss
              : ownerFit > 0
                ? event.fit / ownerFit
                : 0);
          let destinations: [string, number, string][];
          if (object === "FABRIC") {
            const total = l1 + l2;
            destinations = [
              [
                "hardware-l1",
                total ? l1 / total : 0.5,
                "源FABRIC保护后残余事件按L1/L2设备数量拆分；不重复扣除2+2保护",
              ],
              ["hardware-l2", total ? l2 / total : 0.5, "同L1/L2数量拆分"],
            ];
          } else if (object === "MODULE") {
            const share = counts.boards / (counts.boards + cards);
            destinations = [
              [
                "hardware-board-extra",
                share,
                "源MODULE按板/模组数量分担板级连接",
              ],
              ["object-MODULE", 1 - share, "MODULE余项归模组连接"],
            ];
          } else if (object === "UNKNOWN") {
            const comparableFit = events
              .filter(
                (e) => e.id.startsWith("FABRIC-") && e.type === event.type,
              )
              .reduce((sum, e) => sum + e.fit, 0);
            const share =
              event.fit > 0
                ? Math.min(
                    0.25,
                    ((comparableFit / Math.max(1, l1 + l2)) * (leaf + spine)) /
                      event.fit,
                  )
                : 0;
            destinations = [
              [
                "hardware-leaf-extra",
                (share * leaf) / Math.max(1, leaf + spine),
                "按同类FABRIC单位设备事件率×Leaf/Spine数量估算；最多重分未归因同类FIT的25%，不新增事件率",
              ],
              [
                "hardware-spine-extra",
                (share * spine) / Math.max(1, leaf + spine),
                "同Leaf/Spine风险估算",
              ],
              ["object-UNKNOWN", 1 - share, "未归因事件扣除网络估算后的余项"],
            ];
          } else {
            const id =
              (
                {
                  MEMT: "object-HBM",
                  MEMP: "object-HBM",
                  BOXIO: "hardware-io",
                  NIC: "hardware-ubnic",
                } as Record<string, string>
              )[object] ?? "object-" + object;
            destinations = [
              [
                nodeMap.has(id) ? id : "object-UNKNOWN",
                1,
                "源故障事件直接映射；HBM为MEMP/MEMT责任汇总",
              ],
            ];
          }
          for (const [id, fraction, method] of destinations) {
            const n = nodeMap.get(id)!;
            n.fit += event.fit * fraction;
            if (event.type === "hard") n.hardFit += event.fit * fraction;
            n.complexity += event.fit > 0 ? fraction : 0;
            n.gain += gain * fraction;
            for (const k of lossKeys)
              if (k !== "save" && k !== "mechanismOverhead")
                n.loss[k] += (row.perEvent?.[event.id]?.[k] ?? 0) * fraction;
            estimates.push({
              cards,
              scenario: entry.name,
              nodeId: id,
              nodeName: n.name,
              eventId: event.id,
              type: event.type,
              sourceFit: event.fit,
              fraction,
              fit: event.fit * fraction,
              lossHours: eventLoss(event.id) * fraction,
              sampledEvents: (row.perEvent?.[event.id]?.events ?? 0) * fraction,
              downtimeHours:
                (row.perEvent?.[event.id]?.downtime ?? 0) * fraction,
              source: event.source ?? "源事件目录",
              estimated: destinations.length > 1,
              method: (destinations.length > 1 ? source : "") + method,
            });
          }
        }
        const overhead = nodeMap.get("overhead")!;
        overhead.loss.save = row.ledger.save ?? 0;
        overhead.loss.mechanismOverhead = row.ledger.mechanismOverhead ?? 0;
        overhead.complexity = 1;
        overhead.gain =
          diagnosis?.nodes.find((n: any) => n.id === "overhead")
            ?.allocationEvidence?.projectedGain ?? 0;
        const roll = (id: string): TopologyDecisionNode => {
          const n = nodeMap.get(id)!;
          for (const child of nodes.filter((c) => c.parentId === id)) {
            const c = roll(child.id);
            n.fit += c.fit;
            n.hardFit += c.hardFit;
            n.complexity += c.complexity;
            n.gain += c.gain;
            for (const k of lossKeys) n.loss[k] += c.loss[k];
          }
          n.actualHours = Object.values(n.loss).reduce((a, b) => a + b, 0);
          n.availability = 1 - n.actualHours / hours;
          n.mtbfHours = n.hardFit > 0 ? 1e9 / (cards * n.hardFit) : null;
          n.mttrSeconds = equivalentMttrSeconds(n.mtbfHours, n.availability);
          return n;
        };
        roll("system");
        return {
          name: entry.name,
          trainingScenario: entry.trainingScenario,
          configuration: entry.configuration,
          nodes,
          statistics: row.statistics,
          sourceTarget:
            diagnosis?.target ?? row.target ?? result.request.target,
          residual:
            nodeMap.get("system")!.actualHours -
            Object.values(row.ledger as Record<string, number>).reduce(
              (a, b) => a + b,
              0,
            ),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
    const base =
      scenarios.find((s) => s.trainingScenario?.id === "current") ??
      scenarios[0];
    const target = base.sourceTarget;
    const byId = new Map(base.nodes.map((n) => [n.id, n]));
    const design = (n: TopologyDecisionNode) =>
      architecture.nodes.find((a: any) => a.id === n.id);
    const weight = (n: TopologyDecisionNode) =>
      design(n)?.scaleWeights?.[cards] ?? design(n)?.weight ?? 1;
    byId.get("system")!.allowedHours = hours * (1 - target);
    const split = (id: string) => {
      const parent = byId.get(id)!;
      const children = base.nodes.filter((n) => n.parentId === id),
        active = children.filter((n) => n.complexity > 0);
      if (!children.length) return;
      const maxLoss = Math.max(0, ...active.map((n) => n.actualHours)),
        maxGain = Math.max(0, ...active.map((n) => n.gain)),
        maxFit = Math.max(0, ...active.map((n) => n.fit));
      for (const n of active) {
        n.importance =
          allocationMethod === "agree-evidence"
            ? (0.2 +
                0.8 *
                  (maxLoss || maxGain
                    ? Math.max(
                        maxLoss ? n.actualHours / maxLoss : 0,
                        maxGain ? n.gain / maxGain : 0,
                      )
                    : maxFit
                      ? n.fit / maxFit
                      : 0)) *
              (design(n)?.importance ?? 1)
            : (design(n)?.importance ?? 1);
      }
      if (
        allocationMethod !== "none" &&
        parent.allowedHours !== null &&
        active.length
      ) {
        try {
          const weights = active.map((n) =>
            allocationMethod === "equal" ? 1 : weight(n),
          );
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          const a = ["equal", "weighted"].includes(allocationMethod)
            ? {
                items: active.map((n, i) => ({
                  id: n.id,
                  allowedHours:
                    (parent.allowedHours! * weights[i]) / totalWeight,
                })),
              }
            : agreeLossAllocation(
                parent.allowedHours,
                hours,
                active.map((n) => ({
                  ...n,
                  complexity:
                    weight(n) *
                    (allocationMethod === "agree-evidence" ? n.complexity : 1),
                })),
              );
          for (const item of a.items)
            byId.get(item.id)!.allowedHours = item.allowedHours;
          for (const n of children.filter((n) => n.complexity === 0))
            n.allowedHours = 0;
        } catch (e) {
          allocationIssues.push(
            `${cards}卡/${parent.name}：${(e as Error).message}`,
          );
        }
      }
      children.forEach((n) => split(n.id));
    };
    const frozenScale = reference?.scales.find((s) => s.cards === cards);
    const frozen =
      frozenScale?.scenarios?.find(
        (s: any) => s.name === frozenScale.reference,
      ) ?? frozenScale?.scenarios?.[0];
    if (frozen) {
      for (const n of base.nodes) {
        const prior = frozen.nodes.find((p: any) => p.id === n.id);
        if (prior) {
          n.allowedHours = prior.allowedHours;
          n.importance = prior.importance;
        }
      }
    } else split("system");
    for (const s of scenarios)
      for (const n of s.nodes) {
        const ref = byId.get(n.id)!;
        n.allowedHours = ref.allowedHours;
        n.importance = ref.importance;
        n.target = n.allowedHours === null ? null : 1 - n.allowedHours / hours;
        n.targetMttrSeconds =
          n.target === null
            ? null
            : equivalentMttrSeconds(n.mtbfHours, n.target);
        n.gapHours =
          n.allowedHours === null ? null : n.actualHours - n.allowedHours;
      }
    return {
      cards,
      target,
      counts: {
        ...counts,
        l1Blades: l1,
        l2Devices: l2,
        ubNics,
        scaleOutLeaves: leaf,
        scaleOutSpines: spine,
        opticalModules: optics,
      },
      scenarios,
      reference: frozenScale?.reference ?? base.name,
    };
  });
  return {
    method: "topology-conservative-partition.v1",
    allocationMethod,
    allocationLabel,
    hours,
    scales,
    estimates,
    allocationIssues,
    basis: `主图数值包含工程估算。保留每个源事件FIT及各类损失；估算明细给出数量、比例、依据。采用${allocationLabel}重新分解拓扑责任；AGREE证据模式以现状风险/正贡献投影形成重要度，再乘人工重要度，同级分数复杂度乘对应设计权重。新增估算节点缺省权重和人工重要度均为1，改善场景沿用冻结预算。`,
    inventoryBasis:
      "缺省Leaf=ceil(UB网卡/32)，Spine=ceil(Leaf×32/128)；按64端口Leaf的32下联/32上联及128端口Spine进行容量预算估算。光模块=2×[min(L1端口,L2端口)+UB网卡+Leaf×32]；不代表已验证的Clos可布线、端口速率或实物BOM。CPU/DDR/SSD未填BOM时按每节点一个故障责任单元；供电/冷却/管理按每计算柜一个责任单元，共享存储按一个逻辑服务。数量是代理单元数，不再次乘源等效FIT。",
    metricBasis:
      "可用度=1−归属损失/总窗口；MTBF为中断事件间隔，MTTR=MTBF×(1−可用度)/可用度为包含全部损失的等效值。非物理维修时长。机制列为适用方向，阶段差为组合净变化，不能冒充单机制因果收益。",
  };
}
export type TopologyDecision = NonNullable<ReturnType<typeof topologyDecision>>;

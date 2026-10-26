import type {
  AuditArchitecture,
  AuditArchitectureNode,
} from "./audit-architecture";
import { hardwareAuditArchitecture } from "./audit-hardware";
import type { AuditEventView } from "./audit-objects";
import {
  defaultSupernodeTopology,
  type SupernodeTopology,
  type TopologyQuantityKey,
} from "./audit-topology-config";

/** Reference topology changes grouping and counts, never the expert FIT catalog. */
export function supernodeAuditArchitecture(
  events: AuditEventView[],
  topology: SupernodeTopology = defaultSupernodeTopology,
): AuditArchitecture {
  const a = hardwareAuditArchitecture(events);
  a.name = "超节点组网与分层架构";
  a.topology = structuredClone(topology);
  a.basis = topology.source;
  const find = (id: string) => a.nodes.find((n) => n.id === id)!;
  const add = (
    id: string,
    name: string,
    parentId: string,
    domain: AuditArchitectureNode["functionalDomain"],
    level: AuditArchitectureNode["hardwareLevel"],
  ) => {
    a.nodes.push({
      id,
      name,
      parentId,
      kind: "subsystem",
      hardwareLevel: level,
      eventIds: [],
      functionalDomain: domain,
      weight: 1,
      importance: 1,
      source: topology.source,
    });
  };
  find("domain-1").name = "计算资源域";
  delete find("domain-1").hardwareLevel;
  find("hardware-pod").name = "集群分组（工程配置）";
  add(
    "hardware-supernode",
    "超节点 / 性能域",
    "hardware-pod",
    "compute",
    "supernode",
  );
  find("hardware-rack").parentId = "hardware-supernode";
  for (const id of [
    "hardware-pod",
    "hardware-rack",
    "hardware-node",
    "hardware-board",
    "hardware-module",
    "hardware-chip",
  ])
    find(id).functionalDomain = "compute";
  add(
    "hardware-scaleup",
    "超节点内高速互联",
    "hardware-network",
    "network",
    "network",
  );
  add(
    "hardware-scaleout",
    "超节点间扩展网络",
    "hardware-network",
    "network",
    "network",
  );
  add(
    "hardware-optics",
    "光链路与光模块",
    "hardware-network",
    "network",
    "network",
  );
  if (topology.l2DevicesPerSupernode !== undefined) {
    add(
      "hardware-l1",
      "L1灵衢互联刀片",
      "hardware-scaleup",
      "network",
      "network",
    );
    add(
      "hardware-l2",
      "L2灵衢互联设备",
      "hardware-scaleup",
      "network",
      "network",
    );
    add(
      "hardware-io",
      "灵衢IO转换刀片",
      "hardware-scaleout",
      "network",
      "network",
    );
    add("hardware-ubnic", "UB网卡", "hardware-io", "network", "network");
  }
  for (const id of ["object-BOXIO"])
    if (find(id)) find(id).parentId = "hardware-scaleup";
  for (const id of ["object-NIC", "object-FABRIC", "hardware-spine-extra"])
    if (find(id)) find(id).parentId = "hardware-scaleout";
  if (find("object-OPT")) find("object-OPT").parentId = "hardware-optics";
  if (topology.l2DevicesPerSupernode !== undefined) {
    if (find("object-FABRIC"))
      find("object-FABRIC").parentId = "hardware-scaleup";
    if (find("object-BOXIO")) find("object-BOXIO").parentId = "hardware-io";
    if (find("object-NIC")) find("object-NIC").parentId = "hardware-ubnic";
  }
  const quantities: Record<string, TopologyQuantityKey> = {
    "domain-1": "cards",
    "hardware-scaleup": "scaleUpSwitches",
    "hardware-scaleout": "scaleOutSwitches",
    "hardware-optics": "opticalModules",
    "hardware-pod": "pods",
    "hardware-supernode": "supernodes",
    "hardware-rack": "racks",
    "hardware-node": "nodes",
    "hardware-board": "boards",
    "hardware-module": "cards",
    "hardware-chip": "cards",
    "object-BOXIO":
      topology.l2DevicesPerSupernode === undefined
        ? "scaleUpSwitches"
        : "ioBlades",
    "hardware-l1": "l1Blades",
    "hardware-l2": "l2Devices",
    "hardware-io": "ioBlades",
    "hardware-ubnic": "ubNics",
    "object-FABRIC":
      topology.l2DevicesPerSupernode === undefined
        ? "scaleOutSpines"
        : "scaleUpSwitches",
    "object-OPT": "opticalModules",
  };
  add(
    "hardware-leaf-extra",
    "跨超节点接入交换机（故障待补充）",
    "hardware-scaleout",
    "network",
    "network",
  );
  quantities["hardware-leaf-extra"] = "scaleOutLeaves";
  for (const [id, key] of Object.entries(quantities))
    if (find(id))
      find(id).inventory = {
        totals: {},
        topologyQuantity: key,
        source: topology.source,
      };
  if (topology.l2DevicesPerSupernode !== undefined && find("object-NIC")) {
    find("object-NIC").inventory = {
      totals: {},
      topologyQuantity: "ubNics",
      source: topology.source,
    };
  }
  a.dependencies = [
    ...(find("hardware-l2")
      ? [
          [
            "hardware-l1",
            "hardware-l2",
            "L1 → L2：8平面，每平面2台L2；2+2光模块保护",
          ],
          ["hardware-ubnic", "hardware-leaf-extra", "IO / UB出口 → 参数面Leaf"],
        ]
      : []),
    ["hardware-chip", "hardware-scaleup", "板内 / 板间 / 柜间高速互联"],
    ["hardware-scaleup", "hardware-scaleout", "性能域 → 跨超节点联通域"],
    ["hardware-scaleout", "hardware-storage", "存储访问"],
    [
      "hardware-leaf-extra",
      "hardware-spine-extra",
      "跨域Leaf / Spine参考连接，端口待核对",
    ],
    ["hardware-optics", "hardware-scaleup", "光链路支撑（介质与端口待确认）"],
    ["hardware-optics", "hardware-scaleout", "跨域光链路支撑"],
    ["hardware-facility", "hardware-node", "供电 / 冷却 / 管理支撑"],
  ].map(([from, to, label]) => ({
    from,
    to,
    label,
    kind: "connection",
    source: topology.source,
  }));
  if (topology.l2DevicesPerSupernode !== undefined) {
    if (find("object-FABRIC"))
      find("object-FABRIC").source +=
        "；FABRIC为保护后残余L1/L2事件，归属超节点内互联；不重复扣除2+2保护收益，逐L1/L2拆分待校准。";
    if (find("hardware-spine-extra"))
      find("hardware-spine-extra").inventory = {
        totals: {},
        topologyQuantity: "scaleOutSpines",
        source: topology.source,
      };
  }
  return a;
}

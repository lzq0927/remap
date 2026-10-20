import type {
  AuditArchitecture,
  AuditArchitectureNode,
} from "./audit-architecture";
import { eventObjectId } from "./audit-objects";
export const functionalDomains = {
  compute: "计算",
  network: "网络",
  storage: "存储",
  facility: "供电与冷却",
  control: "管理与控制",
  other: "其他 / 待分类",
} as const;
export type FunctionalDomain = keyof typeof functionalDomains;
export const atlasDomainNames = {
  ...functionalDomains,
  mixed: "跨域汇总",
  overhead: "公共开销",
};
export type AtlasDomain = keyof typeof atlasDomainNames;
const objectDomains: Record<string, FunctionalDomain> = {
  CORE: "compute",
  SRAM: "compute",
  IOD: "compute",
  MEMT: "compute",
  MEMP: "compute",
  MODULE: "compute",
  CPU: "compute",
  DDR: "compute",
  NIC: "network",
  OPT: "network",
  BOXIO: "network",
  FABRIC: "network",
  SSD: "storage",
  STORAGE: "storage",
  POWER: "facility",
  COOL: "facility",
  MGMT: "control",
};
export function atlasNodeDomain(
  a: AuditArchitecture,
  node: AuditArchitectureNode,
): AtlasDomain {
  if (node.kind === "overhead") return "overhead";
  if (node.functionalDomain) return node.functionalDomain;
  const children = a.nodes.filter((n) => n.parentId === node.id);
  const values = children.length
    ? children.map((n) => atlasNodeDomain(a, n))
    : node.eventIds.map((id) => objectDomains[eventObjectId(id)] ?? "other");
  const unique = [...new Set(values.filter((v) => v !== "overhead"))];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return "mixed";
  return (
    (
      {
        network: "network",
        storage: "storage",
        facility: "facility",
        chip: "compute",
        module: "compute",
        board: "compute",
        node: "compute",
      } as Record<string, FunctionalDomain>
    )[node.hardwareLevel ?? ""] ?? "other"
  );
}
export const mechanismCapabilities = {
  predict: "预测 / 预防",
  detect: "检测 / 定位",
  contain: "隔离 / 屏蔽",
  recover: "恢复 / 重构",
  degrade: "降级运行",
  protect: "状态保护",
};
export type MechanismCapability = keyof typeof mechanismCapabilities;
export type MechanismStage = "before" | "during" | "after" | "fallback";
/** View taxonomy only. Applicability and execution still come from the solver contracts. */
export function atlasMechanismDimensions(id: string): {
  stages: MechanismStage[];
  capabilities: MechanismCapability[];
} {
  if (id === "H-SDC-SCREEN")
    return { stages: ["before"], capabilities: ["predict"] };
  if (id === "D-RECOVERY-CLASSIFY")
    return {
      stages: ["after", "fallback"],
      capabilities: ["detect", "recover"],
    };
  if (id === "I-CONTAIN")
    return { stages: ["before", "during", "after"], capabilities: ["contain"] };
  if (id === "H-CONTROL-CONTINUITY")
    return {
      stages: ["during", "after"],
      capabilities: ["contain", "recover"],
    };
  if (
    ["hardDetect", "slowDetect", "sdcDetect"].includes(id) ||
    id.startsWith("D-")
  )
    return { stages: ["during"], capabilities: ["detect"] };
  if (id === "fast" || id.startsWith("C-"))
    return {
      stages: ["before", "after"],
      capabilities: ["protect", "recover"],
    };
  if (["elastic", "R-FABRIC-DEGRADE", "R-HCCL-ELASTIC"].includes(id))
    return {
      stages: ["during", "after"],
      capabilities: ["contain", "recover", "degrade"],
    };
  return { stages: ["after", "fallback"], capabilities: ["recover"] };
}

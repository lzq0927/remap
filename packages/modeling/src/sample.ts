import { modelSchema, type EngineeringModel } from "./schema";
import { hash } from "../../assets/src/hash";

export const expertMaterial = `# AI 集群检查点恢复设计（合成专家材料）
本案例仅用于平台验收，不是设备实测数据。
系统包含协调器A、协调器B、训练节点、检查点存储、共享网络、共享供电和机柜。
两个协调器主动冗余，任一健康即可提供协调服务；共享网络、供电和检查点存储是共同依赖。
协调器部署在同一个机柜。训练节点将检查点交给协调器，再写入检查点存储。
故障来源包括硬件、软件、网络和供电；影响包括中断、降级与静默错误。
合成失效率：协调器A=1000 FIT，协调器B=1000 FIT，网络=500 FIT，供电=100 FIT，存储=800 FIT。
相应平均恢复时间：1、1、0.5、2、1 小时。常失效率、不同基本事件独立；共享依赖使用同一个事件ID。
目标：在100小时任务窗口评估协调链路不中断概率；不同于整集群正确有效产出。
主协调器失联后备用接管。未隔离旧主时，旧主仍可能持有过期令牌并提交。
候选机制：fencing，以当前代数令牌拒绝旧主提交。
验证性质 SingleWriter：同一当前代最多一个协调器的提交被接受。
有限模型包含两个协调器、至多一次故障接管，不证明实现与模型一致，也不验证恢复时延或任意规模。
正常时序：训练节点→协调器A 请求检查点；协调器A→存储 提交；存储→训练节点 确认。
故障时序：协调器B接管并增加代数；旧主A尝试提交；启用fencing时存储拒绝过期令牌。
取舍：增加令牌校验与状态管理，需要后续评估恢复延迟和性能开销。`;

export const checkpointTla = `---- MODULE Checkpoint ----
EXTENDS Naturals, Integers, FiniteSets
CONSTANT Fencing
Nodes == {"A", "B"}
VARIABLES epoch, tokens, committed
vars == <<epoch, tokens, committed>>
Init == /\\ epoch = 0
        /\\ tokens = [n \\in Nodes |-> IF n = "A" THEN 0 ELSE -1]
        /\\ committed = {}
Takeover == /\\ epoch = 0
            /\\ epoch' = 1
            /\\ tokens' = [tokens EXCEPT !["B"] = 1]
            /\\ committed' = {}
Commit(n) == /\\ tokens[n] >= 0
             /\\ (~Fencing \\/ tokens[n] = epoch)
             /\\ n \\notin committed
             /\\ committed' = committed \\cup {n}
             /\\ UNCHANGED <<epoch, tokens>>
Next == Takeover \\/ (\\E n \\in Nodes : Commit(n))
TypeOK == /\\ epoch \\in 0..1
          /\\ tokens \\in [Nodes -> -1..1]
          /\\ committed \\subseteq Nodes
SingleWriter == Cardinality(committed) <= 1
Spec == Init /\\ [][Next]_vars
====
`;
export function nativeCheckpoint(fencing: boolean) {
  const tla = checkpointTla;
  return [
    { name: "Checkpoint.tla", content: tla },
    {
      name: "Checkpoint.cfg",
      content: `CONSTANT Fencing = ${fencing ? "TRUE" : "FALSE"}\nSPECIFICATION Spec\nINVARIANTS TypeOK SingleWriter\nCHECK_DEADLOCK FALSE\n`,
    },
  ];
}
export function clusterModel(): EngineeringModel {
  const sourceRefs = ["expert-material"];
  const entities = [
    ["coordinatorA", "协调器 A", "service"],
    ["coordinatorB", "协调器 B", "service"],
    ["workers", "训练节点", "component"],
    ["storage", "检查点存储", "component"],
    ["network", "共享网络", "fault-domain"],
    ["power", "共享供电", "fault-domain"],
    ["rack", "机柜", "location"],
  ].map(([id, name, kind]) => ({
    id,
    name,
    kind,
    description: "合成专家案例",
    sourceRefs,
  }));
  const base = {
    hours: 100,
    question: "给定合成输入下协调链路的不中断概率",
    metric: "mission-reliability",
    assumptions: [
      "常失效率；不同基本事件独立；共享事件保持同 ID",
      "不包含恢复时延、静默污染和训练损失语义",
    ],
    entityRefs: entities.map((e) => e.id),
    propertyRefs: [],
    mechanismRefs: [],
    categories: [],
    impacts: [],
    files: [],
    scope: "合成双协调器协调链路，100小时窗口",
  };
  const event = (id: string) => ({ type: "event", id });
  return modelSchema.parse({
    schemaVersion: "1.0.0",
    name: "AI 集群 · 检查点恢复设计",
    sources: [
      {
        id: "expert-material",
        name: "合成专家材料.md",
        contentHash: hash(expertMaterial),
        text: expertMaterial,
        scope: "synthetic",
        segments: expertMaterial
          .split("\n")
          .map((text, i) => ({ locator: `line:${i + 1}`, text })),
      },
    ],
    entities,
    relations: [
      ["r1", "workers", "coordinatorA", "connectsTo"],
      ["r2", "workers", "coordinatorB", "connectsTo"],
      ["r3", "coordinatorA", "storage", "dependsOn"],
      ["r4", "coordinatorB", "storage", "dependsOn"],
      ["r5", "coordinatorA", "rack", "deployedOn"],
      ["r6", "coordinatorB", "rack", "deployedOn"],
      ["r7", "coordinatorA", "network", "dependsOn"],
      ["r8", "coordinatorB", "network", "dependsOn"],
      ["r9", "network", "power", "dependsOn"],
    ].map(([id, source, target, kind]) => ({
      id,
      source,
      target,
      kind,
      label: "",
      sourceRefs,
    })),
    failureModes: [
      ["a-loss", "协调器A退出", "coordinatorA", "software", 1000, 1],
      ["b-loss", "协调器B退出", "coordinatorB", "software", 1000, 1],
      ["network-loss", "网络不可用", "network", "network", 500, 0.5],
      ["power-loss", "供电中断", "power", "power", 100, 2],
      ["storage-loss", "存储故障", "storage", "hardware", 800, 1],
    ].map(([id, name, entityId, category, value, recoveryHours]) => ({
      id,
      name,
      entityId,
      category,
      rate: { value, unit: "FIT" },
      recoveryHours,
      probability: null,
      impacts: ["interruption"],
      sourceRefs,
    })),
    mechanisms: [
      {
        id: "redundancy",
        name: "双协调器冗余",
        kind: "redundancy",
        entityRefs: ["coordinatorA", "coordinatorB"],
        failureRefs: ["a-loss", "b-loss"],
        description: "任一协调器健康即可服务",
        conditions: "共享网络与供电仍为共同依赖",
        status: "deployed",
        sourceRefs,
        effects: [],
      },
      {
        id: "fencing",
        name: "代数令牌隔离旧主",
        kind: "isolation",
        entityRefs: ["coordinatorA", "coordinatorB", "storage"],
        failureRefs: [],
        description: "提交者令牌须等于存储当前代数",
        conditions: "令牌检查在存储接受提交时原子执行",
        status: "candidate",
        sourceRefs,
        effects: [],
      },
    ],
    requirements: [
      {
        id: "single-writer",
        statement: "SingleWriter：同一当前代最多一个协调器的提交被接受",
        kind: "safety",
        sourceRefs,
      },
    ],
    behaviors: [
      {
        id: "checkpoint-flow",
        name: "检查点提交与接管",
        participants: ["workers", "coordinatorA", "coordinatorB", "storage"],
        sourceRefs,
        steps: [
          {
            id: "s1",
            from: "workers",
            to: "coordinatorA",
            message: "请求检查点",
            condition: "正常运行",
          },
          {
            id: "s2",
            from: "coordinatorA",
            to: "storage",
            message: "提交检查点",
            condition: "令牌=当前代",
          },
          {
            id: "s3",
            from: "coordinatorB",
            to: "storage",
            message: "接管并增加代数",
            condition: "A失联",
          },
          {
            id: "s4",
            from: "coordinatorA",
            to: "storage",
            message: "旧主尝试提交",
            condition: "启用fencing时拒绝过期令牌",
          },
        ],
      },
    ],
    views: ["architecture", "deployment", "functional"].map((kind, i) => ({
      id: kind,
      name: ["架构与组网", "部署与故障域", "功能关系"][i],
      kind,
      entityRefs: entities.map((e) => e.id),
      positions: Object.fromEntries(
        entities.map((e, j) => [
          e.id,
          { x: 80 + (j % 3) * 250, y: 60 + Math.floor(j / 3) * 140 },
        ]),
      ),
    })),
    cases: [
      {
        ...base,
        id: "coordination-rbd",
        name: "协调链路 RBD",
        method: "rbd",
        mechanismRefs: ["redundancy"],
        logic: {
          type: "series",
          children: [
            { type: "parallel", children: [event("a-loss"), event("b-loss")] },
            event("network-loss"),
            event("power-loss"),
            event("storage-loss"),
          ],
        },
      },
      {
        ...base,
        id: "coordination-fta",
        name: "协调链路失效 FTA",
        method: "fta",
        question: "哪些原因组合导致协调链路失败？",
        logic: {
          type: "or",
          children: [
            { type: "and", children: [event("a-loss"), event("b-loss")] },
            event("network-loss"),
            event("power-loss"),
            event("storage-loss"),
          ],
        },
      },
      ...[false, true].map((fencing) => ({
        ...base,
        id: fencing ? "fenced-tlc" : "unfenced-tlc",
        name: fencing ? "已隔离旧主 · TLC" : "未隔离旧主 · TLC",
        method: "tlc",
        metric: "verification",
        question: "是否存在同代多个有效提交者？",
        propertyRefs: ["single-writer"],
        bindings: [
          { symbol: "A", entityId: "coordinatorA" },
          { symbol: "B", entityId: "coordinatorB" },
          { symbol: "committed", entityId: "storage" },
        ],
        mechanismRefs: fencing ? ["fencing"] : [],
        files: nativeCheckpoint(fencing),
        assumptions: ["两个协调器；至多一次接管；提交校验原子执行"],
        scope: "有限状态穷尽检查；仅安全性质，不证明无限规模或实际实现",
      })),
    ],
    decisions: [],
  });
}

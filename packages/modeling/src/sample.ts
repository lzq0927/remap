import { modelSchema, type EngineeringModel, type Logic } from "./schema";
import { hash } from "../../assets/src/hash";

export const expertMaterial = `# AI 集群检查点恢复设计（合成专家材料）
本案例仅用于平台验收，不是设备实测数据。
系统包含协调器A、协调器B、训练节点、检查点存储、共享网络、共享供电和机柜。
两个协调器主动冗余，任一健康即可提供协调服务；共享网络、供电和检查点存储是共同依赖。
协调器部署在同一个机柜。训练节点将检查点交给协调器，再写入检查点存储。
故障来源包括硬件、软件、网络和供电；影响包括中断、降级与静默错误。
合成失效率：协调器A=1000 FIT，协调器B=1000 FIT，网络=500 FIT，供电=100 FIT，存储=800 FIT。
相应平均恢复时间：1、1、0.5、2、1 小时。常失效率、不同基本事件独立；共享依赖使用同一个事件ID。
目标：在100小时任务窗口评估协调链路不中断概率；不同于整集群可用度。
主协调器失联后备用接管。未隔离旧主时，旧主仍可能持有过期令牌并提交。
候选机制：fencing，以当前代数令牌拒绝旧主提交。
验证性质 SingleWriter：同一当前代最多一个协调器的提交被接受。
该协议性质仅作为待验证约束保存，不宣称已经验证，也不计入定量收益。
定量比较：单协调器与双协调器的100小时不中断概率；双协调器与增加存储快恢复的稳态运行可用度。
存储快恢复为合成候选措施：保持800 FIT不变，将平均恢复时间由1小时缩短至0.1小时；需演练数据验证。
正常时序：训练节点→协调器A 请求检查点；协调器A→存储 提交；存储→训练节点 确认。
故障时序：协调器B接管并增加代数；旧主A尝试提交；启用fencing时存储拒绝过期令牌。
取舍：增加令牌校验与状态管理，需要后续评估恢复延迟和性能开销。`;

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
  const event = (id: string): Logic => ({ type: "event", id });
  const dependencies = [
    event("network-loss"),
    event("power-loss"),
    event("storage-loss"),
  ];
  const singlePath: Logic = {
    type: "series",
    children: [event("a-loss"), ...dependencies],
  };
  const redundantPath: Logic = {
    type: "series",
    children: [
      { type: "parallel", children: [event("a-loss"), event("b-loss")] },
      ...dependencies,
    ],
  };
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
        id: "storage-fast-recovery",
        name: "存储快恢复",
        kind: "recovery",
        entityRefs: ["storage"],
        failureRefs: ["storage-loss"],
        description:
          "保持源 FIT 不变，将存储平均恢复时间由 1 小时降至 0.1 小时",
        conditions: "合成情景；故障检测与恢复链路可用，恢复时间需通过演练校准",
        status: "candidate",
        sourceRefs,
        effects: [{ failureId: "storage-loss", recoveryHours: 0.1 }],
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
        logic: redundantPath,
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
      {
        ...base,
        id: "single-coordinator-rbd",
        name: "单协调器基线 RBD",
        method: "rbd",
        logic: singlePath,
        scope: "合成单协调器协调链路，100小时窗口；与双协调器使用相同共享依赖",
      },
      {
        ...base,
        id: "coordination-availability",
        name: "双协调器 · 运行可用度",
        question:
          "在共享网络、供电与存储依赖下，双协调器的稳态运行可用度是多少？",
        method: "rbd",
        metric: "availability",
        mechanismRefs: ["redundancy"],
        logic: redundantPath,
        assumptions: [
          "独立二态失效/修复；共享事件保持同 ID",
          "不包含检查点保存、回滚及静默污染造成的训练损失",
        ],
        scope: "合成协调链路的稳态运行可用度；不等于训练集群主指标",
      },
      {
        ...base,
        id: "recovery-availability",
        name: "双协调器 + 存储快恢复 · 运行可用度",
        question: "保持源 FIT 不变，缩短存储恢复时间能改善多少运行可用度？",
        method: "rbd",
        metric: "availability",
        mechanismRefs: ["redundancy", "storage-fast-recovery"],
        logic: redundantPath,
        assumptions: [
          "独立二态失效/修复；共享事件保持同 ID",
          "不包含检查点保存、回滚及静默污染造成的训练损失",
          "存储快恢复为待演练校准的合成候选措施",
        ],
        scope:
          "相同共享依赖、相同 FIT；仅存储平均恢复时间由 1 小时降至 0.1 小时",
      },
    ],
    decisions: [],
  });
}

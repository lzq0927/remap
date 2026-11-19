import { z } from "zod";

/**
 * ReMAP 四步工作台的统一模型：架构模块 → 故障模式 → 可靠性措施。
 * 目标分配、可用度评估、机制设计与机制验证都只读写这一份模型。
 */
export const coreModelVersion = "remap-core.v1";

const probability = z.number().finite().min(0).max(1);
const hoursValue = z.number().finite().min(0).max(8760);
const id = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.-]+$/, "标识只能包含字母、数字、点、下划线和连字符");
const label = z.string().trim().min(1).max(80);
const note = z.string().max(600).default("");

export const faultKinds = ["hard", "slow", "sdc"] as const;
export type FaultKind = (typeof faultKinds)[number];
export const faultKindNames: Record<FaultKind, string> = {
  hard: "中断",
  slow: "亚健康",
  sdc: "静默",
};

export const groupSchema = z.object({ id, name: label }).strict();
/**
 * 架构图上的位置。架构图按 Atlas 950 超节点的硬件拓扑绘制，
 * 每个模块标注在对应的硬件上；不在此列表中的模块列在图下方。
 */
export const diagramSlots = [
  "aicore",
  "npu",
  "hbm",
  "node",
  "l1",
  "l2",
  "optical",
  "storage",
  "power",
  "management",
  "software",
] as const;
export type DiagramSlot = (typeof diagramSlots)[number];
export const diagramSlotNames: Record<DiagramSlot, string> = {
  aicore: "NPU 模组 · AICore",
  npu: "NPU 模组 · 其余逻辑",
  hbm: "NPU 模组 · HBM",
  node: "计算节点与板级",
  l1: "IO Die 与 L1 互联刀片",
  l2: "L2 / Leaf / Spine 与网卡",
  optical: "光模块",
  storage: "共享存储",
  power: "供电与冷却",
  management: "管理面",
  software: "软件栈",
};
export const moduleSchema = z
  .object({
    id,
    groupId: id,
    name: label,
    /** 每张卡对应的部件数量；事件率 = FIT × 数量 × 卡数。 */
    unitsPerCard: z.number().finite().positive().max(100000),
    /** AGREE 重要度 ω：该模块失效导致任务受损的条件概率。 */
    importance: z.number().finite().gt(0).max(1),
    /** AGREE 复杂度 n 的人工取值；为空时按分配设置的口径自动取值。 */
    complexity: z.number().finite().positive().max(1e9).nullable(),
    /** 架构图上的位置（diagramSlots 之一）；为空表示不画在图上。 */
    anchor: z.string().trim().max(24).default(""),
    note,
  })
  .strict();
export const faultModeSchema = z
  .object({
    id,
    moduleId: id,
    name: label,
    kind: z.enum(faultKinds),
    /** 单个部件的失效率，FIT = 次 / 10^9 器件小时。 */
    fit: z.number().finite().min(0).max(1e7),
    /** 检出率 c：故障被在线检测发现的概率。 */
    coverage: probability,
    /** 检出分支：从故障发生到被发现的时间（小时）。 */
    detectHours: hoursValue,
    /** 检出分支：隔离、替换与重启恢复时间（小时）。 */
    recoverHours: hoursValue,
    /** 检出分支：回滚到检查点后重算的时间（小时）。 */
    reworkHours: hoursValue,
    /** 漏检分支：单次事件的总损失时间（小时）。 */
    missedLossHours: hoursValue,
    /** 影响系数 κ：事件期间损失的任务产能比例。 */
    impact: probability,
    evidence: note,
  })
  .strict();

export const measureParams = [
  "fit",
  "coverage",
  "detectHours",
  "recoverHours",
  "reworkHours",
  "missedLossHours",
  "impact",
  "overhead",
] as const;
export type MeasureParam = (typeof measureParams)[number];
export const measureParamNames: Record<MeasureParam, string> = {
  fit: "故障率 FIT",
  coverage: "检出率",
  detectHours: "检测时间",
  recoverHours: "恢复时间",
  reworkHours: "回滚重算",
  missedLossHours: "漏检单次损失",
  impact: "影响系数",
  overhead: "公共开销",
};
export const effectSchema = z
  .object({
    param: z.enum(measureParams),
    /** reduce：在现值上按比例降低；set：直接设为新值；add：在现值上增加（代价类效果）。 */
    op: z.enum(["reduce", "set", "add"]),
    value: z.number().finite().min(0).max(1e7),
  })
  .strict()
  .superRefine((effect, ctx) => {
    const bounded =
      effect.op === "reduce" ||
      effect.param === "coverage" ||
      effect.param === "impact" ||
      effect.param === "overhead";
    if (bounded && effect.value > 1)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "比例类参数须在 0 到 1 之间",
      });
  });
export const measureDirections = ["mtbf", "mttr"] as const;
export type MeasureDirection = (typeof measureDirections)[number];
export const evidenceStates = ["verified", "planned", "assumed"] as const;
export type EvidenceState = (typeof evidenceStates)[number];
export const evidenceStateNames: Record<EvidenceState, string> = {
  verified: "已有实测证据",
  planned: "已立项待验证",
  assumed: "设计假设",
};
export const measureSchema = z
  .object({
    id,
    name: label,
    direction: z.enum(measureDirections),
    /** 措施作用的故障模式；仅含 overhead 效果时可为空。 */
    modeIds: z.array(id).max(64),
    effects: z.array(effectSchema).min(1).max(6),
    /**
     * 适用比例：所作用的故障中，措施实际适用并成功的比例。
     * 参数按此比例在现值与目标值之间折算。
     */
    applicability: z.number().finite().min(0).max(1).default(1),
    enabled: z.boolean(),
    evidence: z.enum(evidenceStates),
    rationale: note,
    /** 措施的出处，如现有机制库的编号。 */
    source: z.string().trim().max(120).default(""),
  })
  .strict();

export const allocationMethods = [
  "agree",
  "arinc",
  "equal",
  "min-effort",
  "custom",
] as const;
export type AllocationMethod = (typeof allocationMethods)[number];
export const allocationSchema = z
  .object({
    method: z.enum(allocationMethods),
    /** AGREE 复杂度口径：固有失效率预计值，或部件数量。 */
    complexityBasis: z.enum(["fit", "units"]),
    /** 自定义权重（按模块标识）；仅 custom 方法使用。 */
    customWeights: z.record(id, z.number().finite().min(0).max(1e6)),
  })
  .strict();

export const requirementsSchema = z
  .object({
    referenceCards: z.number().int().positive().max(10000000),
    systemTarget: z.number().finite().gt(0).lt(1),
    overheadBudget: z.number().finite().min(0).max(0.5),
    scaling: z.literal("linear-loss-load"),
    domains: z
      .array(
        z
          .object({
            id,
            name: label,
            moduleIds: z.array(id).min(1).max(64),
            baselineAvailability: z.number().finite().gt(0).lte(1).nullable(),
            targetAvailability: z.number().finite().gt(0).lte(1).nullable(),
            source: note,
          })
          .strict(),
      )
      .max(24),
    calibration: z
      .array(
        z
          .object({
            modeId: id,
            beforeRecoveryHours: hoursValue,
            afterRecoveryHours: hoursValue,
            beforeMissedHours: hoursValue,
            afterMissedHours: hoursValue,
            source: note,
          })
          .strict(),
      )
      .max(256)
      .default([]),
  })
  .strict();

export const coreModelSchema = z
  .object({
    schemaVersion: z.literal(coreModelVersion),
    name: label,
    scenario: z
      .object({
        cards: z.number().int().min(1).max(10000000),
        hours: z.number().finite().positive().max(8760),
        target: z.number().finite().gt(0).lt(1),
        /** 与故障无关的固定开销占比（检查点保存、在线检测等）。 */
        overhead: z.number().finite().min(0).max(0.5),
        /** 窗口达标比例要求：仿真窗口中达到目标的最低比例。 */
        passRatio: probability,
      })
      .strict(),
    groups: z.array(groupSchema).min(1).max(24),
    modules: z.array(moduleSchema).min(1).max(64),
    modes: z.array(faultModeSchema).min(1).max(256),
    measures: z.array(measureSchema).max(64),
    allocation: allocationSchema,
    requirements: requirementsSchema.optional(),
    source: note,
  })
  .strict()
  .superRefine((model, ctx) => {
    const unique = (items: { id: string }[], path: string) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.id))
          ctx.addIssue({
            code: "custom",
            path: [path, index, "id"],
            message: "标识重复：" + item.id,
          });
        seen.add(item.id);
      });
      return seen;
    };
    const groups = unique(model.groups, "groups"),
      modules = unique(model.modules, "modules"),
      modes = unique(model.modes, "modes");
    unique(model.measures, "measures");
    model.modules.forEach((module, index) => {
      if (!groups.has(module.groupId))
        ctx.addIssue({
          code: "custom",
          path: ["modules", index, "groupId"],
          message: "模块所属分组不存在",
        });
    });
    model.modes.forEach((mode, index) => {
      if (!modules.has(mode.moduleId))
        ctx.addIssue({
          code: "custom",
          path: ["modes", index, "moduleId"],
          message: "故障模式所属模块不存在",
        });
    });
    model.measures.forEach((measure, index) => {
      measure.modeIds.forEach((modeId) => {
        if (!modes.has(modeId))
          ctx.addIssue({
            code: "custom",
            path: ["measures", index, "modeIds"],
            message: "措施引用了不存在的故障模式：" + modeId,
          });
      });
      if (
        !measure.modeIds.length &&
        measure.effects.some((effect) => effect.param !== "overhead")
      )
        ctx.addIssue({
          code: "custom",
          path: ["measures", index, "modeIds"],
          message: "措施至少作用于一个故障模式",
        });
    });
    const constrained = new Set<string>();
    const domainIds = new Set<string>();
    for (const [i, domain] of (model.requirements?.domains ?? []).entries()) {
      if (domainIds.has(domain.id))
        ctx.addIssue({
          code: "custom",
          path: ["requirements", "domains", i, "id"],
          message: "约束标识重复：" + domain.id,
        });
      domainIds.add(domain.id);
      if (new Set(domain.moduleIds).size !== domain.moduleIds.length)
        ctx.addIssue({
          code: "custom",
          path: ["requirements", "domains", i, "moduleIds"],
          message: "域内模块不能重复",
        });
      for (const moduleId of domain.moduleIds) {
        if (!modules.has(moduleId))
          ctx.addIssue({
            code: "custom",
            path: ["requirements", "domains", i],
            message: "约束引用了不存在的模块：" + moduleId,
          });
        if (domain.targetAvailability !== null) {
          if (constrained.has(moduleId))
            ctx.addIssue({
              code: "custom",
              path: ["requirements", "domains", i],
              message: "固定目标的责任范围不能重叠：" + moduleId,
            });
          constrained.add(moduleId);
        }
      }
    }
  });

export type CoreModel = z.infer<typeof coreModelSchema>;
export type CoreGroup = z.infer<typeof groupSchema>;
export type CoreModule = z.infer<typeof moduleSchema>;
export type FaultMode = z.infer<typeof faultModeSchema>;
export type Measure = z.infer<typeof measureSchema>;
export type MeasureEffect = z.infer<typeof effectSchema>;

// 默认模块（含早期版本的标识）在架构图上的位置。
const anchorById: Record<string, DiagramSlot> = {
  aicore: "aicore",
  npu: "npu",
  hbm: "hbm",
  node: "node",
  "iod-l1": "l1",
  optical: "optical",
  "l2-fabric": "l2",
  interconnect: "l2",
  storage: "storage",
  power: "power",
  facility: "power",
  management: "management",
  software: "software",
};

/**
 * 把早期保存的模型整理成当前结构：去掉已废弃的字段，
 * 并给没有架构图位置的默认模块补上位置。不认识的内容原样保留，交给校验处理。
 */
export function upgradeCoreModel(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const model = structuredClone(input) as Record<string, unknown>;
  if (Array.isArray(model.groups))
    for (const group of model.groups)
      if (group && typeof group === "object") delete group.layout;
  if (Array.isArray(model.modules))
    for (const module of model.modules)
      if (module && typeof module === "object") {
        delete module.container;
        if (module.anchor === undefined)
          module.anchor = anchorById[module.id] ?? "";
      }
  return model;
}

export function parseCoreModel(input: unknown): CoreModel {
  return coreModelSchema.parse(upgradeCoreModel(input));
}

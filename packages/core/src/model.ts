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

/**
 * 恢复链的级别，粒度从小到大。故障被发现后从第一个可用的级别开始：
 * - 成功后或者就此恢复，或者继续走下一级（例如弹性恢复换好资源后，还要走 CKPT 回滚）；
 * - 失败后白费这一级的失败耗时，或者升到下一级，或者直接转人工。
 * 成功率为 0 的级别默认跳过；标为“必经”的级别即使成功率为 0 也留在链上，按失败处理。
 */
export const recoveryLevels = [
  "replay",
  "process",
  "elastic",
  "restart",
  "manual",
] as const;
export type RecoveryLevel = (typeof recoveryLevels)[number];
export const recoveryLevelNames: Record<RecoveryLevel, string> = {
  replay: "就地恢复",
  process: "进程重调度",
  elastic: "弹性恢复",
  restart: "CKPT 回滚",
  manual: "人工恢复",
};
export const recoveryLevelNotes: Record<RecoveryLevel, string> = {
  replay: "原地重执行、绕行或快照降载，任务不回滚",
  process: "只重新调度出错的进程",
  elastic: "隔离并替换故障资源，重建通信域",
  restart: "从最近的检查点恢复并重算",
  manual: "自动手段都失败后由人处理",
};
export const levelSchema = z
  .object({
    /** 这一级的成功率；0 表示不可用。 */
    success: probability,
    /** 成功时的耗时（小时）。 */
    hours: hoursValue,
    /** 失败时白费的时间（小时）。 */
    failHours: hoursValue,
    /** 这一级执行期间损失的任务产能比例。 */
    impact: probability,
    /** 在这一级恢复后是否还要回滚到检查点重算。 */
    rollback: z.boolean(),
    /** 成功之后：done 就此恢复；next 继续走下一级。 */
    then: z.enum(["done", "next"]).default("done"),
    /** 失败之后：next 升到下一级；manual 直接转人工。 */
    onFail: z.enum(["next", "manual"]).default("next"),
    /** 必经环节：成功率为 0 时不跳过，按失败处理。 */
    gate: z.boolean().default(false),
  })
  .strict();
export type LadderLevel = z.infer<typeof levelSchema>;
export const ladderSchema = z
  .object({
    replay: levelSchema,
    process: levelSchema,
    elastic: levelSchema,
    restart: levelSchema,
    manual: levelSchema,
  })
  .strict();
export type Ladder = z.infer<typeof ladderSchema>;
/** 各级别“是否需要回滚”的默认值。 */
const defaultRollback: Record<RecoveryLevel, boolean> = {
  replay: false,
  process: true,
  elastic: false,
  restart: true,
  manual: true,
};
/** 一条恢复阶梯：未列出的级别不使用。 */
export function makeLadder(
  levels: Partial<Record<RecoveryLevel, Partial<LadderLevel>>> = {},
): Ladder {
  return Object.fromEntries(
    recoveryLevels.map((level) => [
      level,
      {
        success: 0,
        hours: 0,
        failHours: 0,
        impact: 1,
        rollback: defaultRollback[level],
        then: "done" as const,
        onFail: "next" as const,
        gate: false,
        ...levels[level],
      },
    ]),
  ) as Ladder;
}

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
  "site-power",
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
  power: "柜级供电与冷却",
  "site-power": "机房供配电",
  management: "管理面",
  software: "软件栈",
};
export const moduleSchema = z
  .object({
    id,
    groupId: id,
    name: label,
    /**
     * 部件数量。scaling 为 per-card 时是每张卡对应的数量，事件率 = FIT × 数量 × 卡数；
     * 为 fixed 时是全系统的总数量（如一个机房一套供配电），事件率不随规模变化。
     */
    unitsPerCard: z.number().finite().positive().max(100000),
    scaling: z.enum(["per-card", "fixed"]).default("per-card"),
    /** 直接指定的目标可用度；为空时由分配方法给出。用于单次故障后果很大的模块。 */
    fixedTarget: z.number().finite().gt(0).lt(1).nullable().default(null),
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
    /** 检出率 c：故障被在线检测及时发现的概率。 */
    coverage: probability,
    /** 检出时：从故障发生到被发现的时间（小时）。 */
    detectHours: hoursValue,
    /** 漏检时：直到被兜底手段发现的时间（小时），期间的产出作废。 */
    lateDetectHours: hoursValue,
    /** 恢复后回滚到检查点重算的时间（小时）；只在需要回滚的恢复级别成功时计入。 */
    reworkHours: hoursValue,
    /** 恢复阶梯：从小到大逐级尝试，失败才升到下一级。 */
    ladder: ladderSchema,
    /** 影响系数 κ：整条恢复链的损失再乘以它（如只影响部分任务）。 */
    impact: probability,
    evidence: note,
  })
  .strict();

const levelFields = ["success", "hours", "failHours", "impact"] as const;
export type LevelField = (typeof levelFields)[number];
const levelFieldNames: Record<LevelField, string> = {
  success: "成功率",
  hours: "耗时",
  failHours: "失败耗时",
  impact: "影响范围",
};
export type LevelParam = `${RecoveryLevel}.${LevelField}`;
const baseParams = [
  "fit",
  "coverage",
  "detectHours",
  "lateDetectHours",
  "reworkHours",
  "impact",
  "overhead",
] as const;
type BaseParam = (typeof baseParams)[number];
/** 措施可以改变的参数：故障模式的基本参数、各恢复级别的参数，以及公共开销。 */
export const measureParams = [
  ...baseParams,
  ...recoveryLevels.flatMap((level) =>
    levelFields.map((field) => `${level}.${field}` as LevelParam),
  ),
] as [BaseParam | LevelParam, ...(BaseParam | LevelParam)[]];
export type MeasureParam = BaseParam | LevelParam;
const baseParamNames: Record<BaseParam, string> = {
  fit: "故障率 FIT",
  coverage: "检出率",
  detectHours: "检测时间",
  lateDetectHours: "漏检后发现时间",
  reworkHours: "回滚重算",
  impact: "影响系数",
  overhead: "公共开销",
};
export const measureParamNames = Object.fromEntries(
  measureParams.map((param) => {
    const [level, field] = param.split(".") as [RecoveryLevel, LevelField];
    return [
      param,
      field
        ? `${recoveryLevelNames[level]} · ${levelFieldNames[field]}`
        : baseParamNames[param as BaseParam],
    ];
  }),
) as Record<MeasureParam, string>;
const fieldOf = (param: MeasureParam) =>
  param.split(".")[1] as LevelField | undefined;
/** 取值越大越好的参数；其余参数越小越好。 */
export const higherIsBetter = (param: MeasureParam) =>
  param === "coverage" || fieldOf(param) === "success";
/** 以比例（0–1）表示的参数。 */
export const isRatioParam = (param: MeasureParam) =>
  param === "coverage" ||
  param === "impact" ||
  param === "overhead" ||
  fieldOf(param) === "success" ||
  fieldOf(param) === "impact";
/** 读取故障模式的某个参数（overhead 不属于故障模式）。 */
export function readParam(mode: FaultModeShape, param: MeasureParam): number {
  const [level, field] = param.split(".") as [RecoveryLevel, LevelField];
  return field
    ? mode.ladder[level][field]
    : (mode[param as Exclude<BaseParam, "overhead">] as number);
}
type FaultModeShape = {
  fit: number;
  coverage: number;
  detectHours: number;
  lateDetectHours: number;
  reworkHours: number;
  impact: number;
  ladder: Ladder;
};
export const effectSchema = z
  .object({
    param: z.enum(measureParams),
    /**
     * reduce：在现值上按比例降低；set：直接设为新值；add：在现值上增加（代价类效果）；
     * subtract：相对冻结现状减少一个绝对量（阶段节省），与 set 按替代方案取最好值，不重复叠加。
     */
    op: z.enum(["reduce", "set", "add", "subtract"]),
    value: z.number().finite().min(0).max(1e7),
  })
  .strict()
  .superRefine((effect, ctx) => {
    if (
      effect.op === "subtract" &&
      (isRatioParam(effect.param) || effect.param === "overhead")
    )
      ctx.addIssue({
        code: "custom",
        path: ["op"],
        message: "绝对减少只用于故障率或时长参数",
      });
    const bounded = effect.op === "reduce" || isRatioParam(effect.param);
    if (bounded && effect.value > 1)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "比例类参数须在 0 到 1 之间",
      });
  });
/**
 * 措施分层。按措施改变“可用度公式里的哪一项”归类，一项措施只属于一类：
 * - 组件级高可用（prevent）：让故障少发生，改故障率；
 * - 系统级可靠性机制：故障发生后让损失更小，沿恢复链分为
 *   检测（detect）、隔离与弹性（contain）、恢复（recover）、检查点（checkpoint）。
 */
export const measureCategories = [
  "prevent",
  "detect",
  "contain",
  "recover",
  "checkpoint",
] as const;
export type MeasureCategory = (typeof measureCategories)[number];
export const measureCategoryNames: Record<MeasureCategory, string> = {
  prevent: "降低失效率",
  detect: "检测",
  contain: "隔离与弹性",
  recover: "恢复",
  checkpoint: "检查点",
};
export type MeasureLayer = "component" | "system";
export const layerOf = (category: MeasureCategory): MeasureLayer =>
  category === "prevent" ? "component" : "system";
export const measureLayerNames: Record<MeasureLayer, string> = {
  component: "组件级高可用",
  system: "系统级可靠性机制",
};
/** 按措施改变的第一个参数推断它的类别。 */
export function categoryOfParam(param: MeasureParam): MeasureCategory {
  if (param === "fit") return "prevent";
  if (
    param === "coverage" ||
    param === "detectHours" ||
    param === "lateDetectHours"
  )
    return "detect";
  if (param === "impact" || param.startsWith("elastic.")) return "contain";
  if (param === "reworkHours" || param === "overhead") return "checkpoint";
  return "recover";
}
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
    category: z.enum(measureCategories),
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

/**
 * 域级要求（可选）：参考规模下的系统目标、若干责任域的独立现状与固定目标，
 * 以及按域现状反求恢复时长的校准记录。存在时，系统目标按损失负荷随规模线性折算。
 */
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
            /** 校准前后恢复链的期望耗时（各级“到达概率 × 时间”之和，不含回滚重算）。 */
            beforeRecoveryHours: hoursValue,
            afterRecoveryHours: hoursValue,
            /** 校准前后漏检分支的总损失（漏检后发现 + 恢复 + 回滚重算）。 */
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
        /** 规模–目标对照：不同规模下的可用度目标，用于推算其它规模的目标。 */
        targetCurve: z
          .array(
            z
              .object({
                cards: z.number().int().min(1).max(10000000),
                target: z.number().finite().gt(0).lt(1),
              })
              .strict(),
          )
          .max(12)
          .default([]),
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
 * 把早期保存的模型整理成当前结构，数值结果保持不变：
 * - 去掉已废弃的画法字段，给默认模块补上架构图位置；
 * - 故障模式的“漏检分支总损失”改写成“漏检后发现时间”（扣掉其后的恢复与回滚）；
 * - 措施的“方向”改写成分层类别。
 * 不认识的内容原样保留，交给校验处理。
 */
export function upgradeCoreModel(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const model = structuredClone(input) as Record<string, any>;
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
  if (Array.isArray(model.modes))
    for (const mode of model.modes)
      if (mode && typeof mode === "object" && !mode.ladder) {
        // 早期只有一个“恢复时间”：当作必定成功的检查点全局恢复。
        const recover = Number(mode.recoverHours ?? 0),
          rework = Number(mode.reworkHours ?? 0);
        if (mode.lateDetectHours === undefined)
          mode.lateDetectHours = Math.max(
            0,
            Number(mode.missedLossHours ?? 0) - recover - rework,
          );
        mode.ladder = makeLadder({ restart: { success: 1, hours: recover } });
        delete mode.missedLossHours;
        delete mode.recoverHours;
      }
  if (Array.isArray(model.measures))
    for (const measure of model.measures)
      if (measure && typeof measure === "object") {
        if (Array.isArray(measure.effects))
          for (const effect of measure.effects)
            if (effect?.param === "missedLossHours")
              effect.param = "lateDetectHours";
            else if (effect?.param === "recoverHours")
              effect.param = "restart.hours";
        if (measure.category === undefined) {
          const first = measure.effects?.[0]?.param;
          measure.category =
            measure.direction === "mtbf"
              ? "prevent"
              : (measureParams as readonly string[]).includes(first)
                ? categoryOfParam(first)
                : "recover";
          if (measure.category === "prevent" && measure.direction === "mttr")
            measure.category = "recover";
        }
        delete measure.direction;
      }
  const scenario = model.scenario;
  if (scenario && typeof scenario === "object" && !scenario.targetCurve)
    scenario.targetCurve = [{ cards: scenario.cards, target: scenario.target }];
  return model;
}

export function parseCoreModel(input: unknown): CoreModel {
  return coreModelSchema.parse(upgradeCoreModel(input));
}

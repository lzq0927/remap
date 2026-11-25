import {
  higherIsBetter,
  isRatioParam,
  measureParams,
  readParam,
  recoveryLevelNames,
  recoveryLevels,
  type CoreModel,
  type CoreModule,
  type FaultMode,
  type Ladder,
  type LadderLevel,
  type LevelField,
  type MeasureEffect,
  type MeasureParam,
  type RecoveryLevel,
} from "./model";

/** 措施生效后的参数集：故障模式与公共开销。 */
export interface ResolvedParameters {
  modes: FaultMode[];
  overhead: number;
}

const bounded = (param: MeasureParam, value: number) =>
  isRatioParam(param) ? Math.min(1, Math.max(0, value)) : Math.max(0, value);

type Change = {
  id: string;
  op: MeasureEffect["op"];
  value: number;
  share: number;
};
/** 属于故障模式的可变参数（公共开销单独处理）。 */
const modeParams = measureParams.filter(
  (param): param is Exclude<MeasureParam, "overhead"> => param !== "overhead",
);
const writeParam = (mode: FaultMode, param: MeasureParam, value: number) => {
  const [level, field] = param.split(".") as [RecoveryLevel, LevelField];
  if (field) mode.ladder[level][field] = value;
  else mode[param as "fit"] = value;
};
const cloneMode = (mode: FaultMode): FaultMode => ({
  ...mode,
  ladder: Object.fromEntries(
    recoveryLevels.map((level) => [level, { ...mode.ladder[level] }]),
  ) as FaultMode["ladder"],
});

/** 模块的部件总数：按卡计的随规模增长，固定数量的不随规模变化。 */
export const unitCount = (module: CoreModule | undefined, cards: number) =>
  !module
    ? cards
    : module.scaling === "fixed"
      ? module.unitsPerCard
      : module.unitsPerCard * cards;

/** 预先整理“哪些措施改哪个故障模式的哪个参数”，供反复求值时使用。 */
function indexChanges(model: CoreModel) {
  const position = new Map(model.modes.map((mode, i) => [mode.id, i]));
  const perMode: Change[][][] = model.modes.map(() => modeParams.map(() => [])),
    overhead: Change[] = [];
  for (const measure of model.measures)
    for (const effect of measure.effects) {
      const change: Change = {
        id: measure.id,
        op: effect.op,
        value: effect.value,
        share: measure.applicability,
      };
      if (effect.param === "overhead") overhead.push(change);
      else {
        const column = modeParams.indexOf(
          effect.param as (typeof modeParams)[number],
        );
        for (const modeId of measure.modeIds) {
          const row = position.get(modeId);
          if (row !== undefined) perMode[row][column].push(change);
        }
      }
    }
  return { perMode, overhead };
}

function resolveParam(
  list: Change[],
  enabled: ReadonlySet<string>,
  param: MeasureParam,
  base: number,
) {
  if (!list.length) return base;
  const up = higherIsBetter(param);
  let value = base,
    touched = false,
    assigned: number | null = null;
  // “设为”与“从现状减少”：按适用比例折算后，取其中最好的一项。
  // 绝对减少锚定冻结现状，不抹去校准残差，也不在另一条更快的路径上重复扣减；
  // 同一参数上的多个阶段节省保守地按替代方案取最大值。
  for (const c of list)
    if ((c.op === "set" || c.op === "subtract") && enabled.has(c.id)) {
      const target =
          c.op === "subtract" ? Math.max(0, base - c.value) : c.value,
        candidate = base + c.share * (target - base);
      assigned =
        assigned === null
          ? candidate
          : up
            ? Math.max(assigned, candidate)
            : Math.min(assigned, candidate);
    }
  if (assigned !== null) {
    value = assigned;
    touched = true;
  }
  for (const c of list)
    if (c.op === "reduce" && enabled.has(c.id)) {
      const ratio = c.share * c.value;
      value = up ? 1 - (1 - value) * (1 - ratio) : value * (1 - ratio);
      touched = true;
    }
  for (const c of list)
    if (c.op === "add" && enabled.has(c.id)) {
      value += c.share * c.value;
      touched = true;
    }
  return touched ? bounded(param, value) : base;
}

const enabledSet = (model: CoreModel) =>
  new Set(model.measures.filter((m) => m.enabled).map((m) => m.id));

/**
 * 把启用的措施作用到基线参数上。结果与措施顺序无关：
 * 每项措施先算出“完全适用时”的目标值，再按适用比例在现值与目标值之间折算；
 * 同一参数的“设为”及“从现状减少”取改善最大的一项，多项“降低”按剩余比例连乘
 * （检出率作用在漏检率上），“增加”逐项累加。
 */
export function applyMeasures(
  model: CoreModel,
  enabled: ReadonlySet<string> = enabledSet(model),
): ResolvedParameters {
  const { perMode, overhead } = indexChanges(model);
  return {
    overhead: resolveParam(
      overhead,
      enabled,
      "overhead",
      model.scenario.overhead,
    ),
    modes: model.modes.map((mode, row) => {
      const next = cloneMode(mode);
      modeParams.forEach((param, column) => {
        if (perMode[row][column].length)
          writeParam(
            next,
            param,
            resolveParam(
              perMode[row][column],
              enabled,
              param,
              readParam(mode, param),
            ),
          );
      });
      return next;
    }),
  };
}

/**
 * 只求系统可用度的快速通道，结果与 assess(applyMeasures()) 相同。
 * 贡献分摊和方案搜索要对成千上万种措施组合求值，用它避免重复构造明细。
 */
export function createEvaluator(model: CoreModel) {
  const { perMode, overhead } = indexChanges(model),
    modules = new Map(model.modules.map((m) => [m.id, m])),
    scale = model.modes.map(
      (mode) =>
        unitCount(modules.get(mode.moduleId), model.scenario.cards) / 1e9,
    ),
    // 只有被措施改动的参数才需要重算，其余直接用基线值。
    touched = perMode.map((lists) =>
      modeParams
        .map((param, column) => ({ param, list: lists[column] }))
        .filter((entry) => entry.list.length > 0),
    ),
    baseLoss = model.modes.map((mode) => lossPerEvent(mode)),
    scratch = model.modes.map(cloneMode);
  return (enabled: ReadonlySet<string>) => {
    let load = 0;
    for (let row = 0; row < model.modes.length; row++) {
      const mode = model.modes[row];
      if (!touched[row].length) {
        load += mode.fit * scale[row] * baseLoss[row];
        continue;
      }
      const resolved = scratch[row];
      for (const { param, list } of touched[row])
        writeParam(
          resolved,
          param,
          resolveParam(list, enabled, param, readParam(mode, param)),
        );
      load += resolved.fit * scale[row] * lossPerEvent(resolved);
    }
    return (
      (1 -
        resolveParam(overhead, enabled, "overhead", model.scenario.overhead)) /
      (1 + load)
    );
  };
}

type ChainParameters = Pick<
  FaultMode,
  | "coverage"
  | "detectHours"
  | "lateDetectHours"
  | "reworkHours"
  | "impact"
  | "ladder"
>;
/** 恢复链上的一步：实际成功率，以及成功、失败后各走到哪一步（−1 表示到此结束）。 */
export interface RouteStep {
  level: RecoveryLevel;
  step: LadderLevel;
  /** 实际成功率：失败后无处可去的级别视为必定成功。 */
  success: number;
  /** 成功后继续走的下一步；−1 表示在这一级恢复。 */
  successTo: number;
  /** 失败后走的下一步；−1 表示没有后续。 */
  failTo: number;
}
/**
 * 把恢复阶梯整理成一条有向的恢复链。参与的级别是成功率大于 0 或标为“必经”的级别；
 * 成功后“继续下一级”的走到下一个参与的级别，失败后“转人工”的直接走到人工恢复。
 * 所有走向都朝粒度更大的方向，所以按顺序算一遍即可。
 */
export function recoveryRoute(ladder: Ladder): RouteStep[] {
  const used = recoveryLevels.filter(
      (level) => ladder[level].success > 0 || ladder[level].gate,
    ),
    manual = used.indexOf("manual");
  return used.map((level, index) => {
    const step = ladder[level],
      next = index + 1 < used.length ? index + 1 : -1,
      failTo = step.onFail === "manual" && manual > index ? manual : next;
    return {
      level,
      step,
      success: failTo < 0 ? 1 : step.success,
      successTo: step.then === "next" ? next : -1,
      failTo,
    };
  });
}

/** 恢复链中一个级别在一次事件里的期望表现。 */
export interface LevelOutcome {
  level: RecoveryLevel;
  /** 事件走到这一级的概率。 */
  reach: number;
  /** 这一级的成功率（失败后无处可去的级别视为必定成功）。 */
  success: number;
  /** 在这一级恢复的概率。 */
  resolved: number;
  /** 这一级成功后继续走下一级的概率。 */
  passed: number;
  /** 成功后继续走到的级别；null 表示在这一级恢复。 */
  successTo: RecoveryLevel | null;
  /** 失败后走到的级别；null 表示没有后续。 */
  failTo: RecoveryLevel | null;
  /** 这一级贡献的期望损失（小时，不含回滚重算）。 */
  lossHours: number;
  /** 在这一级恢复后回滚重算贡献的期望损失（小时）。 */
  reworkHours: number;
}
/**
 * 沿恢复链逐级计算：到达概率 × [成功率 × 成功耗时 + (1 − 成功率) × 失败耗时]，
 * 耗时乘以该级的影响范围；在需要回滚的级别恢复后再加一次回滚重算。
 */
export function ladderOutcomes(mode: ChainParameters): LevelOutcome[] {
  const route = recoveryRoute(mode.ladder),
    reach = route.map((_, index) => (index === 0 ? 1 : 0));
  return route.map(({ level, step, success, successTo, failTo }, index) => {
    const arrived = reach[index],
      ok = arrived * success;
    if (failTo >= 0) reach[failTo] += arrived - ok;
    if (successTo >= 0) reach[successTo] += ok;
    return {
      level,
      reach: arrived,
      success,
      resolved: successTo >= 0 ? 0 : ok,
      passed: successTo >= 0 ? ok : 0,
      successTo: successTo >= 0 ? route[successTo].level : null,
      failTo: failTo >= 0 ? route[failTo].level : null,
      lossHours:
        arrived *
        step.impact *
        (success * step.hours + (1 - success) * step.failHours),
      reworkHours: step.rollback && successTo < 0 ? ok * mode.reworkHours : 0,
    };
  });
}
/** 恢复链各段对单次等效损失的期望贡献（小时，已乘影响系数）。 */
export interface StageLoss {
  /** 检出时的检测等待：c · t检测。 */
  detect: number;
  /** 漏检时的发现等待：(1 − c) · t发现。 */
  late: number;
  /** 各恢复级别的期望耗时。 */
  levels: Record<RecoveryLevel, number>;
  /** 回滚重算合计。 */
  rework: number;
  /** 回滚重算按“在哪一级恢复”拆开。 */
  levelRework: Record<RecoveryLevel, number>;
}
export function stageLoss(mode: ChainParameters): StageLoss {
  const k = mode.impact,
    outcomes = ladderOutcomes(mode),
    zero = () =>
      Object.fromEntries(recoveryLevels.map((level) => [level, 0])) as Record<
        RecoveryLevel,
        number
      >,
    levels = zero(),
    levelRework = zero();
  for (const outcome of outcomes) {
    levels[outcome.level] = k * outcome.lossHours;
    levelRework[outcome.level] = k * outcome.reworkHours;
  }
  return {
    detect: k * mode.coverage * mode.detectHours,
    late: k * (1 - mode.coverage) * mode.lateDetectHours,
    levels,
    rework: k * outcomes.reduce((sum, o) => sum + o.reworkHours, 0),
    levelRework,
  };
}
/** 单次事件的等效损失时间（等效 MTTR）：检测与恢复链各段期望之和。 */
export function lossPerEvent(mode: ChainParameters) {
  const route = recoveryRoute(mode.ladder),
    reach = route.map((_, index) => (index === 0 ? 1 : 0));
  let recovery = 0;
  for (let index = 0; index < route.length; index++) {
    const { step, success, successTo, failTo } = route[index],
      arrived = reach[index];
    if (arrived <= 0) continue;
    const ok = arrived * success;
    if (failTo >= 0) reach[failTo] += arrived - ok;
    if (successTo >= 0) reach[successTo] += ok;
    recovery +=
      arrived *
        step.impact *
        (success * step.hours + (1 - success) * step.failHours) +
      (step.rollback && successTo < 0 ? ok * mode.reworkHours : 0);
  }
  return (
    mode.impact *
    (mode.coverage * mode.detectHours +
      (1 - mode.coverage) * mode.lateDetectHours +
      recovery)
  );
}
/**
 * 恢复链上每一级值多少：把这一级设为不可用后，单次等效损失增加多少小时。
 * 正数表示这一级在省时间；负数表示先试它反而更慢（成功率太低或耗时太长）。
 * 不在链上的级别，以及兜底的最后一级，返回 null。
 */
export function levelBenefit(mode: ChainParameters) {
  const route = recoveryRoute(mode.ladder),
    current = lossPerEvent(mode),
    result = Object.fromEntries(
      recoveryLevels.map((level) => [level, null]),
    ) as Record<RecoveryLevel, number | null>;
  route.forEach(({ level, failTo }) => {
    if (failTo < 0) return;
    const without = {
      ...mode,
      ladder: {
        ...mode.ladder,
        [level]: { ...mode.ladder[level], success: 0 },
      },
    };
    result[level] = lossPerEvent(without) - current;
  });
  return result;
}
/** 一条恢复路径上的一段：检测、某一级的一次尝试，或回滚重算。 */
export interface PathSegment {
  stage: "detect" | "late" | "rework" | RecoveryLevel;
  /** 恢复级别的这次尝试是否成功；其余段恒为 true。 */
  ok: boolean;
  /** 等效损失时间（小时，已乘影响范围和影响系数）。 */
  hours: number;
}
export interface RecoveryPath {
  detected: boolean;
  /** 最终在哪一级恢复；null 表示没有配置恢复级别。 */
  level: RecoveryLevel | null;
  probability: number;
  segments: PathSegment[];
  lossHours: number;
}
/**
 * 一次事件可能走的全部路径：是否检出 × 恢复链上每一级的成败。
 * 各路径概率之和为 1，按概率加权的损失之和等于单次等效损失。
 */
export function eventPaths(mode: ChainParameters): RecoveryPath[] {
  const route = recoveryRoute(mode.ladder),
    k = mode.impact,
    ends: Omit<RecoveryPath, "detected">[] = [];
  const visit = (
    index: number,
    probability: number,
    segments: PathSegment[],
  ) => {
    if (probability <= 0) return;
    const { level, step, success, successTo, failTo } = route[index];
    if (success > 0) {
      const done: PathSegment[] = [
        ...segments,
        { stage: level, ok: true, hours: k * step.impact * step.hours },
      ];
      if (successTo >= 0) visit(successTo, probability * success, done);
      else {
        if (step.rollback && mode.reworkHours > 0)
          done.push({ stage: "rework", ok: true, hours: k * mode.reworkHours });
        ends.push({
          level,
          probability: probability * success,
          segments: done,
          lossHours: 0,
        });
      }
    }
    if (success < 1 && failTo >= 0)
      visit(failTo, probability * (1 - success), [
        ...segments,
        { stage: level, ok: false, hours: k * step.impact * step.failHours },
      ]);
  };
  if (route.length) visit(0, 1, []);
  else ends.push({ level: null, probability: 1, segments: [], lossHours: 0 });
  return (
    [
      { detected: true, share: mode.coverage, wait: mode.detectHours },
      {
        detected: false,
        share: 1 - mode.coverage,
        wait: mode.lateDetectHours,
      },
    ] as const
  ).flatMap((branch) =>
    ends.map((end) => {
      const segments: PathSegment[] = [
        {
          stage: branch.detected ? "detect" : "late",
          ok: true,
          hours: k * branch.wait,
        },
        ...end.segments,
      ];
      return {
        detected: branch.detected,
        level: end.level,
        probability: branch.share * end.probability,
        segments,
        lossHours: segments.reduce((sum, segment) => sum + segment.hours, 0),
      };
    }),
  );
}

export interface ModeResult {
  id: string;
  moduleId: string;
  name: string;
  kind: FaultMode["kind"];
  /** 单个部件 FIT。 */
  fit: number;
  /** 恢复链各段的期望损失。 */
  stages: StageLoss;
  /** 折算到每张卡的 FIT（单件 FIT × 每卡数量）。 */
  fitPerCard: number;
  /** 全系统事件率，次 / 运行小时。 */
  rate: number;
  mtbfHours: number;
  /** 单次事件等效损失（等效 MTTR），小时。 */
  mttrHours: number;
  /** 损失负荷 ρ = 事件率 × 等效 MTTR：每运行 1 小时带来的损失小时数。 */
  load: number;
  /** 窗口内期望事件数。 */
  events: number;
  lossHours: number;
  /** 故障频次：每连续运行一周（168 小时）发生的次数 = 168 / MTBF。 */
  ratePerWeek: number;
  /** 折算到每个日历周实际发生的故障次数（停机时不产生新故障）与损失小时。 */
  eventsPerWeek: number;
  lossHoursPerWeek: number;
  /** 占故障损失的比例。 */
  share: number;
}
export interface ModuleResult
  extends Omit<ModeResult, "moduleId" | "kind" | "fit" | "stages"> {
  groupId: string;
  /** 只有该模块失效时的系统可用度 1/(1+ρ)。 */
  availability: number;
  modes: ModeResult[];
}
export interface Assessment {
  system: {
    availability: number;
    load: number;
    overhead: number;
    overheadLossHours: number;
    failureLossHours: number;
    lossHours: number;
    fitPerCard: number;
    rate: number;
    mtbfHours: number;
    mttrHours: number;
    events: number;
    ratePerWeek: number;
    eventsPerWeek: number;
    lossHoursPerWeek: number;
    failureLossHoursPerWeek: number;
    /** 运行时间占比 1 / (1 + ρ)：窗口里真正在运行的时间比例。 */
    runShare: number;
  };
  modules: ModuleResult[];
  groups: Array<
    Pick<
      ModuleResult,
      | "id"
      | "name"
      | "fitPerCard"
      | "rate"
      | "load"
      | "events"
      | "lossHours"
      | "ratePerWeek"
      | "eventsPerWeek"
      | "lossHoursPerWeek"
      | "availability"
      | "share"
    >
  >;
}

/**
 * 串联可修系统的更新报酬模型。
 * 任务停机期间不产生新的故障，因此每运行 1 小时期望损失 ρ = Σ λᵢ·MTTRᵢ 小时，
 * 有效产出占比 A = (1 − 公共开销) / (1 + ρ)。
 */
export function assess(
  model: CoreModel,
  parameters: ResolvedParameters = applyMeasures(model),
): Assessment {
  const { cards, hours } = model.scenario,
    overhead = parameters.overhead;
  const modulesById = new Map(model.modules.map((m) => [m.id, m])),
    week = 168 / hours;
  const raw = parameters.modes.map((mode) => {
    const rate =
        (mode.fit * unitCount(modulesById.get(mode.moduleId), cards)) / 1e9,
      // 固定数量的部件也折算成“每卡等效 FIT”，便于和其它模块放在一起比较。
      fitPerCard = (rate * 1e9) / cards,
      mttrHours = lossPerEvent(mode);
    return { mode, fitPerCard, rate, mttrHours, load: rate * mttrHours };
  });
  const load = raw.reduce((sum, r) => sum + r.load, 0),
    rate = raw.reduce((sum, r) => sum + r.rate, 0),
    uptime = hours / (1 + load);
  const modes: ModeResult[] = raw.map((r) => ({
    id: r.mode.id,
    moduleId: r.mode.moduleId,
    name: r.mode.name,
    kind: r.mode.kind,
    fit: r.mode.fit,
    fitPerCard: r.fitPerCard,
    rate: r.rate,
    mtbfHours: r.rate > 0 ? 1 / r.rate : Infinity,
    mttrHours: r.mttrHours,
    load: r.load,
    events: r.rate * uptime,
    lossHours: r.load * uptime,
    ratePerWeek: r.rate * 168,
    eventsPerWeek: r.rate * uptime * week,
    lossHoursPerWeek: r.load * uptime * week,
    share: load > 0 ? r.load / load : 0,
    stages: stageLoss(r.mode),
  }));
  const combine = (parts: ModeResult[]) => {
    const partRate = parts.reduce((sum, p) => sum + p.rate, 0),
      partLoad = parts.reduce((sum, p) => sum + p.load, 0);
    return {
      fitPerCard: parts.reduce((sum, p) => sum + p.fitPerCard, 0),
      rate: partRate,
      mtbfHours: partRate > 0 ? 1 / partRate : Infinity,
      mttrHours: partRate > 0 ? partLoad / partRate : 0,
      load: partLoad,
      events: partRate * uptime,
      lossHours: partLoad * uptime,
      ratePerWeek: partRate * 168,
      eventsPerWeek: partRate * uptime * week,
      lossHoursPerWeek: partLoad * uptime * week,
      availability: 1 / (1 + partLoad),
      share: load > 0 ? partLoad / load : 0,
    };
  };
  const modules: ModuleResult[] = model.modules.map((module) => {
    const parts = modes.filter((mode) => mode.moduleId === module.id);
    return {
      id: module.id,
      groupId: module.groupId,
      name: module.name,
      ...combine(parts),
      modes: parts,
    };
  });
  const groups = model.groups.map((group) => {
    const ids = new Set(
      model.modules.filter((m) => m.groupId === group.id).map((m) => m.id),
    );
    const {
      mtbfHours: _mtbf,
      mttrHours: _mttr,
      ...summary
    } = combine(modes.filter((mode) => ids.has(mode.moduleId)));
    return { id: group.id, name: group.name, ...summary };
  });
  const availability = (1 - overhead) / (1 + load);
  return {
    system: {
      availability,
      load,
      overhead,
      overheadLossHours: overhead * uptime,
      failureLossHours: load * uptime,
      lossHours: hours * (1 - availability),
      fitPerCard: modes.reduce((sum, m) => sum + m.fitPerCard, 0),
      rate,
      mtbfHours: rate > 0 ? 1 / rate : Infinity,
      mttrHours: rate > 0 ? load / rate : 0,
      events: rate * uptime,
      ratePerWeek: rate * 168,
      eventsPerWeek: rate * uptime * week,
      lossHoursPerWeek: hours * (1 - availability) * week,
      failureLossHoursPerWeek: load * uptime * week,
      runShare: 1 / (1 + load),
    },
    modules,
    groups,
  };
}

export interface StageShare {
  id: "detect" | "late" | "rework" | RecoveryLevel;
  name: string;
  /** 这一环节的损失负荷（事件率 × 这一环节的期望损失时间），各环节合计等于系统损失负荷。 */
  load: number;
  share: number;
}
/**
 * 系统故障损失花在了哪个环节：检测、漏检后发现、恢复链各级的尝试时间、回滚重算。
 * 按损失负荷从大到小排列；用来判断剩余损失该从哪一级的参数下手。
 */
export function loadByStage(result: Assessment): StageShare[] {
  const totals = new Map<StageShare["id"], number>();
  const add = (id: StageShare["id"], value: number) =>
    totals.set(id, (totals.get(id) ?? 0) + value);
  for (const mode of result.modules.flatMap((module) => module.modes)) {
    add("detect", mode.rate * mode.stages.detect);
    add("late", mode.rate * mode.stages.late);
    for (const level of recoveryLevels)
      add(level, mode.rate * mode.stages.levels[level]);
    add("rework", mode.rate * mode.stages.rework);
  }
  const load = [...totals.values()].reduce((sum, value) => sum + value, 0),
    names = {
      detect: "检测",
      late: "漏检后发现",
      rework: "回滚重算",
      ...recoveryLevelNames,
    };
  return [...totals]
    .map(([id, value]) => ({
      id,
      name: names[id],
      load: value,
      share: load > 0 ? value / load : 0,
    }))
    .filter((stage) => stage.load > 0)
    .sort((a, b) => b.load - a.load);
}

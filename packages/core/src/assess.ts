import type {
  CoreModel,
  FaultMode,
  MeasureEffect,
  MeasureParam,
} from "./model";

/** 措施生效后的参数集：故障模式与公共开销。 */
export interface ResolvedParameters {
  modes: FaultMode[];
  overhead: number;
}

const higherIsBetter = (param: MeasureParam) => param === "coverage";

const bounded = (param: MeasureParam, value: number) =>
  param === "coverage" || param === "impact" || param === "overhead"
    ? Math.min(1, Math.max(0, value))
    : Math.max(0, value);

type Change = {
  id: string;
  op: MeasureEffect["op"];
  value: number;
  share: number;
};
const modeParams = [
  "fit",
  "coverage",
  "detectHours",
  "recoverHours",
  "reworkHours",
  "missedLossHours",
  "impact",
] as const;

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
        const column = modeParams.indexOf(effect.param);
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
  // 绝对减少锚定冻结现状，不抹去校准残差，也不再扣减另一快速路径。
  // 在完整恢复链尚未逐段建模时，多个阶段节省保守地按替代方案取最大值。
  for (const c of list)
    if ((c.op === "set" || c.op === "subtract") && enabled.has(c.id)) {
      const target =
        c.op === "subtract" ? Math.max(0, base - c.value) : c.value;
      const candidate = base + c.share * (target - base);
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
      const next = { ...mode };
      modeParams.forEach((param, column) => {
        next[param] = resolveParam(
          perMode[row][column],
          enabled,
          param,
          mode[param],
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
    units = new Map(model.modules.map((m) => [m.id, m.unitsPerCard])),
    scale = model.modes.map(
      (mode) => ((units.get(mode.moduleId) ?? 1) * model.scenario.cards) / 1e9,
    );
  return (enabled: ReadonlySet<string>) => {
    let load = 0;
    for (let row = 0; row < model.modes.length; row++) {
      const mode = model.modes[row],
        lists = perMode[row],
        value = (column: number) =>
          resolveParam(
            lists[column],
            enabled,
            modeParams[column],
            mode[modeParams[column]],
          );
      const coverage = value(1);
      load +=
        value(0) *
        scale[row] *
        value(6) *
        (coverage * (value(2) + value(3) + value(4)) +
          (1 - coverage) * value(5));
    }
    return (
      (1 -
        resolveParam(overhead, enabled, "overhead", model.scenario.overhead)) /
      (1 + load)
    );
  };
}

/** 单次事件的等效损失时间：检出与漏检两个分支按检出率加权。 */
export function lossPerEvent(mode: FaultMode) {
  const detected = mode.detectHours + mode.recoverHours + mode.reworkHours;
  return (
    mode.impact *
    (mode.coverage * detected + (1 - mode.coverage) * mode.missedLossHours)
  );
}

export interface ModeResult {
  id: string;
  moduleId: string;
  name: string;
  kind: FaultMode["kind"];
  /** 单个部件 FIT。 */
  fit: number;
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
  /** 占故障损失的比例。 */
  share: number;
}
export interface ModuleResult
  extends Omit<ModeResult, "moduleId" | "kind" | "fit"> {
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
  const units = new Map(model.modules.map((m) => [m.id, m.unitsPerCard]));
  const raw = parameters.modes.map((mode) => {
    const fitPerCard = mode.fit * (units.get(mode.moduleId) ?? 1),
      rate = (fitPerCard * cards) / 1e9,
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
    share: load > 0 ? r.load / load : 0,
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
    },
    modules,
    groups,
  };
}

import type { CoreModel, FaultMode, MeasureParam } from "./model";

/** 措施生效后的参数集：故障模式与公共开销。 */
export interface ResolvedParameters {
  modes: FaultMode[];
  overhead: number;
}

const higherIsBetter = (param: MeasureParam) => param === "coverage";

/**
 * 把启用的措施作用到基线参数上。结果与措施顺序无关：
 * 同一参数的多个“设为”取更优值，多个“降低”连乘；检出率的“降低”作用在漏检率上。
 */
export function applyMeasures(
  model: CoreModel,
  enabled: ReadonlySet<string> = new Set(
    model.measures.filter((m) => m.enabled).map((m) => m.id),
  ),
): ResolvedParameters {
  const sets = new Map<string, number[]>(),
    reductions = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, value: number) =>
    map.set(key, [...(map.get(key) ?? []), value]);
  for (const measure of model.measures) {
    if (!enabled.has(measure.id)) continue;
    for (const effect of measure.effects) {
      const targets =
        effect.param === "overhead" ? ["overhead"] : measure.modeIds;
      for (const target of targets)
        push(
          effect.op === "set" ? sets : reductions,
          target + "\u0000" + effect.param,
          effect.value,
        );
    }
  }
  const resolve = (target: string, param: MeasureParam, base: number) => {
    const key = target + "\u0000" + param,
      assigned = sets.get(key);
    let value = base;
    if (assigned)
      value = higherIsBetter(param)
        ? Math.max(...assigned)
        : Math.min(...assigned);
    for (const ratio of reductions.get(key) ?? [])
      value = higherIsBetter(param)
        ? 1 - (1 - value) * (1 - ratio)
        : value * (1 - ratio);
    return value;
  };
  return {
    overhead: resolve("overhead", "overhead", model.scenario.overhead),
    modes: model.modes.map((mode) => ({
      ...mode,
      fit: resolve(mode.id, "fit", mode.fit),
      coverage: resolve(mode.id, "coverage", mode.coverage),
      detectHours: resolve(mode.id, "detectHours", mode.detectHours),
      recoverHours: resolve(mode.id, "recoverHours", mode.recoverHours),
      reworkHours: resolve(mode.id, "reworkHours", mode.reworkHours),
      missedLossHours: resolve(
        mode.id,
        "missedLossHours",
        mode.missedLossHours,
      ),
      impact: resolve(mode.id, "impact", mode.impact),
    })),
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

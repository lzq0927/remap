import {
  weeklyScenarioSchema,
  type WeeklyScenario,
  type WeeklyStage,
  type WeeklyModeId,
} from "../../contracts/src/weekly-reliability";

export const weeklyModeNames: Record<WeeklyModeId, string> = {
  hbm: "HBM · 全部模式（细分待补）",
  "npu-other": "NPU · 除AICore静默外的模式",
  "aicore-sdc": "AICore · 静默数据污染",
  optical: "光模块 · 全部模式（细分待补）",
  other: "其余来源 · 待归属部件和模式",
};
export function evaluateWeeklyScenario(input: WeeklyScenario) {
  const p = weeklyScenarioSchema.parse(input);
  const totalFit = p.hbmNpuFitPerCard / (p.shares.hbm + p.shares.npu);
  const coreFit = totalFit * p.silentShare * p.aiCoreShareOfSilent;
  const currentFits: Record<WeeklyModeId, number> = {
    hbm: totalFit * p.shares.hbm,
    "npu-other": Math.max(0, totalFit * p.shares.npu - coreFit),
    "aicore-sdc": coreFit,
    optical: totalFit * p.shares.optical,
    other: Math.max(
      0,
      totalFit * (1 - p.shares.hbm - p.shares.npu - p.shares.optical),
    ),
  };
  const improvedFits = {
    ...currentFits,
    hbm: currentFits.hbm * (1 - p.reductions.hbm),
    "aicore-sdc": coreFit * (1 - p.reductions.aiCoreSilent),
    optical: currentFits.optical * (1 - p.reductions.optical),
  };
  const stages = (["current", "improved"] as const).map(
    (stage: WeeklyStage) => {
      const fits = stage === "current" ? currentFits : improvedFits;
      const modes = (Object.keys(fits) as WeeklyModeId[]).map((id) => {
        const events = (fits[id] * p.cards * p.hours) / 1e9;
        const silent = id === "aicore-sdc";
        const missedEvents = silent ? events * (1 - p.detection[stage]) : 0;
        const missedLossHours = missedEvents * p.missedRecoveryHours[stage];
        const duration = p.eventLossHours[stage][id];
        const timedEvents = silent ? events * p.detection[stage] : events;
        const complete = timedEvents === 0 || duration !== null;
        const knownLossHours = missedLossHours + timedEvents * (duration ?? 0);
        return {
          id,
          name: weeklyModeNames[id],
          fitPerCard: fits[id],
          events,
          missedEvents,
          missedLossHours,
          knownLossHours,
          complete,
          lossHours: complete ? knownLossHours : null,
          budgetAvailability: complete ? 1 - knownLossHours / p.hours : null,
          budgetAvailabilityCeiling: 1 - knownLossHours / p.hours,
        };
      });
      const group = (ids: WeeklyModeId[]) => {
        const parts = modes.filter((m) => ids.includes(m.id));
        const knownLossHours = parts.reduce(
          (sum, m) => sum + m.knownLossHours,
          0,
        );
        const complete = parts.every((m) => m.complete);
        return {
          knownLossHours,
          lossHours: complete ? knownLossHours : null,
          complete,
          budgetAvailability: complete ? 1 - knownLossHours / p.hours : null,
          budgetAvailabilityCeiling: 1 - knownLossHours / p.hours,
          events: parts.reduce((sum, m) => sum + m.events, 0),
        };
      };
      return {
        stage,
        modes,
        totalFitPerCard: Object.values(fits).reduce((s, n) => s + n, 0),
        total: group(["hbm", "npu-other", "aicore-sdc", "optical", "other"]),
        npu: group(["npu-other", "aicore-sdc"]),
        compute: group(["hbm", "npu-other", "aicore-sdc"]),
      };
    },
  );
  const current = stages[0],
    improved = stages[1];
  const targetLossHours = p.hours * (1 - p.improvedAvailabilityTarget);
  const core = improved.modes.find((m) => m.id === "aicore-sdc")!;
  return {
    method: "weekly-additive-loss-budget.v1" as const,
    current,
    improved,
    referenceLossHours: p.hours * (1 - p.currentAvailabilityReference),
    targetLossHours,
    knownBudgetExcessHours: Math.max(
      0,
      improved.total.knownLossHours - targetLossHours,
    ),
    coreMissedBudgetExcessHours: Math.max(
      0,
      core.missedLossHours - targetLossHours,
    ),
    minimumDetectionWithWholeBudget:
      core.events * p.missedRecoveryHours.improved === 0
        ? 0
        : Math.max(
            0,
            1 -
              targetLossHours / (core.events * p.missedRecoveryHours.improved),
          ),
    maximumMissedHoursWithWholeBudget:
      core.missedEvents === 0 ? null : targetLossHours / core.missedEvents,
    residualSilentFitPerCard:
      totalFit * p.silentShare * (1 - p.aiCoreShareOfSilent),
    assumptions: [
      "每周事件数＝每卡等效FIT×活动卡数×168/10^9；不再乘HBM颗数、光模块数量或代际倍率。",
      "NPU总量包含AICore静默分支；全系统只相加互斥模式。其余15%静默故障的部件归属待补，已包含在其他模式总量内，不另加事件。",
      "损失＝事件数×单次等效损失，按连续卡时暴露计算；未消除故障重叠、跨周恢复和共享恢复链，不能视为离散事件仿真结果。",
      "A预算＝1−损失/168；部分已知损失只给预算可用度上界。若为负，表示加总负荷已超过一周，并非物理可用度。",
      "60%为用户参考现状；95%为目标。单次等效损失须含检测、诊断、人工等待、恢复、回滚及影响范围；未提供的时长保留待补。",
    ],
  };
}
export type WeeklyEvaluation = ReturnType<typeof evaluateWeeklyScenario>;

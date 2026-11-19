import { defaultCoreModel } from "./defaults";
import type { CoreModel, Measure } from "./model";
import { applyMeasures, assess } from "./assess";
import { calibrateBaseline, domainModel } from "./requirements";

/** New version, never silently applied to an existing saved model. */
export function novemberReferenceScenario(): CoreModel {
  const model = defaultCoreModel();
  model.name = "网络63%与非网络60% · 五规模95%目标";
  model.scenario.overhead = 4 / 604;
  for (const m of model.modes)
    if (m.kind !== "slow") {
      const delta = 300 / 3600 - m.reworkHours;
      m.reworkHours = 300 / 3600;
      if (m.kind === "hard") m.missedLossHours += delta;
    }
  const optical = model.modules.find((m) => m.id === "optical")!;
  optical.unitsPerCard = ((1700 / 0.3) * 0.35) / 500;
  optical.note =
    "每卡3.9667只为按35%故障份额与500 FIT折算的等效数量，非实测BOM。";
  model.modes.find((m) => m.id === "optical-fault")!.evidence =
    "沿用现有库500 FIT与按35%故障份额折算的等效数量，未作为厂商实测。";
  const network = model.modules
    .filter((m) => m.groupId === "network")
    .map((m) => m.id);
  const remaining = model.modules
    .filter((m) => m.groupId !== "network")
    .map((m) => m.id);
  model.requirements = {
    referenceCards: 500000,
    systemTarget: 0.95,
    overheadBudget: model.scenario.overhead,
    scaling: "linear-loss-load",
    calibration: [],
    domains: [
      {
        id: "network",
        name: "网络域",
        moduleIds: network,
        baselineAvailability: 0.63,
        targetAvailability: 0.98,
        source:
          "用户2026-11-19给定：50万卡网络单独评估现状约63%，改进目标约98%。",
      },
      {
        id: "remaining",
        name: "计算等非网络域合计",
        moduleIds: remaining,
        baselineAvailability: 0.6,
        targetAvailability: null,
        source: "用户2026-11-19确认：除网络以外各域合并后的单独可用度约60%。",
      },
      {
        id: "power",
        name: "供电与冷却整项",
        moduleIds: ["power"],
        baselineAvailability: null,
        targetAvailability: 0.99999,
        source:
          "用户2026-11-19固定目标99.999%；对应架构图供电与冷却整项，管理面另列。",
      },
    ],
  };
  model.source =
    "2026-11-19约束场景；网络63%、非网络合计60%为校准参考，系统目标95%，网络98%，供电与冷却99.999%。固定FIT及AICore检出90%/漏检48h，未观测的中断恢复段按比例反求；非实测硬件参数。";
  const calibrated = calibrateBaseline(model);
  calibrated.measures.push(...proposeConstraintMeasures(calibrated));
  return calibrated;
}

/** Explicit candidates derived from allocation constraints, with engineering status still assumed. */
export function proposeConstraintMeasures(model: CoreModel): Measure[] {
  const result: Measure[] = [];
  const power = model.requirements?.domains.find(
    (d) => d.id === "power" && d.targetAvailability !== null,
  );
  if (power) {
    const sub = domainModel(model, power.moduleIds);
    const load = assess(sub, applyMeasures(sub, new Set())).system.load;
    const factor = Math.min(
      1,
      ((1 / power.targetAvailability! - 1) * 0.7) / Math.max(load, 1e-12),
    );
    result.push({
      id: "power-continuity-budget",
      name: "供电冷却保供与局部隔离",
      direction: "mttr",
      modeIds: sub.modes.map((m) => m.id),
      effects: [{ param: "impact", op: "reduce", value: 1 - factor }],
      applicability: 1,
      enabled: false,
      evidence: "assumed",
      source: "按供电与冷却99.999%目标反求的候选",
      rationale: `将供电与冷却事件的等效影响缩至现状的${(factor * 100).toFixed(5)}%，预留30%损失负荷余量。源故障率不变；要求独立供电、冷却隔离与备用容量共同成立，未验证共因失效。`,
    });
  }
  const network = model.requirements?.domains.find(
    (d) => d.id === "network" && d.targetAvailability !== null,
  );
  if (network) {
    const ids = model.modes
      .filter((m) => network.moduleIds.includes(m.moduleId))
      .map((m) => m.id);
    const candidate: Measure = {
      id: "network-recovery-budget",
      name: "网络分级检测与快速切换",
      direction: "mttr",
      modeIds: ids,
      effects: [
        { param: "coverage", op: "set", value: 0.999 },
        { param: "detectHours", op: "set", value: 1 / 3600 },
        { param: "recoverHours", op: "set", value: 0 },
        { param: "reworkHours", op: "set", value: 1 / 3600 },
        { param: "missedLossHours", op: "set", value: 60 / 3600 },
      ],
      applicability: 0.99,
      enabled: false,
      evidence: "assumed",
      source: "按网络98%目标反求的候选",
      rationale: "",
    };
    const check = (duration: number) => {
      candidate.effects[2].value = duration;
      const sub = domainModel(
        {
          ...model,
          measures: [
            ...model.measures.filter((m) => m.id !== candidate.id),
            { ...candidate, enabled: true },
          ],
        },
        network.moduleIds,
      );
      return assess(sub).system.load;
    };
    const allowed = (1 / network.targetAvailability! - 1) * 0.9;
    if (check(0) <= allowed) {
      let lo = 0,
        hi = 48;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (check(mid) <= allowed) lo = mid;
        else hi = mid;
      }
      candidate.effects[2].value = lo;
      candidate.rationale = `以已启用FIT改进为前提，反求恢复段≤${(lo * 3600).toFixed(1)}s；检出99.9%/1s、回滚1s、漏检60s、适用并成功99%。网络损失负荷留10%余量；需验证路径冗余、带宽和失败升级条件。`;
      result.push(candidate);
    }
  }
  return result.filter(
    (m) => !model.measures.some((existing) => existing.id === m.id),
  );
}

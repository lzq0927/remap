import type { CatalogKind } from "../../contracts/src/types";
import type { WeeklyScenario } from "../../contracts/src/weekly-reliability";
import { evaluateWeeklyScenario } from "./weekly-reliability";

/** These are scenario-specific user inputs, not measured vendor component FITs. */
export function weeklyCatalogEntries(profile: WeeklyScenario) {
  const result = evaluateWeeklyScenario(profile);
  const common = {
    scenarioVersion: profile.schemaVersion,
    applicability: "周度加总损失预算；不能直接绑定历史V4或600h离散事件模型",
    source: profile.evidenceNote,
    evidenceStatus: "user-provided-scenario",
    rateBasis: "device-hour",
    equivalentUnit: "per-active-NPU-card",
    cards: profile.cards,
    hours: profile.hours,
  };
  const entries: {
    key: string;
    kind: CatalogKind;
    name: string;
    payload: Record<string, unknown>;
  }[] = result.current.modes.map((mode) => {
    const after = result.improved.modes.find((m) => m.id === mode.id)!;
    return {
      key: mode.id,
      kind: "failure-mode",
      name: "周度场景 · " + mode.name,
      payload: {
        ...common,
        component: mode.id,
        modeClassification:
          mode.id === "aicore-sdc" ? "sdc" : "aggregate-unclassified",
        fit: mode.fitPerCard,
        improvedFitPerCard: after.fitPerCard,
        frequencyPerWeek: { current: mode.events, improved: after.events },
        mutuallyExclusivePartition: true,
        containment:
          mode.id === "aicore-sdc" || mode.id === "npu-other"
            ? "NPU合计，两子项互斥"
            : "系统互斥来源",
        eventLossHours: {
          current: profile.eventLossHours.current[mode.id],
          improved: profile.eventLossHours.improved[mode.id],
        },
        recoveryChain:
          mode.id === "aicore-sdc"
            ? {
                detected:
                  "在线检测→定位→可信状态恢复→重算（等效时长待提供或由场景填写）",
                detection: profile.detection,
                missed:
                  "漏检→后续发现→恢复；时长为场景给定的漏检分支总损失，不能重复加诊断/恢复",
                missedRecoveryHours: profile.missedRecoveryHours,
              }
            : {
                steps: [
                  "检测",
                  "诊断与人工等待",
                  "隔离/替换",
                  "恢复",
                  "回滚重算",
                ],
                status: "未提供逐步时长；输入为整条恢复链的单次等效损失",
              },
      },
    };
  });
  const measures = [
    {
      key: "hbm-correction",
      name: "HBM纠错",
      mode: "hbm",
      category: "增加MTBF",
      parameter: "reductions.hbm",
      before: 0,
      after: profile.reductions.hbm,
      unit: "故障消减比例",
      effect:
        "HBM全部模式的场景等效FIT乘(1−消减比例)；ECC类型和可覆盖模式待工程核验。",
    },
    {
      key: "aicore-screening",
      name: "AICore静默故障压测筛查",
      mode: "aicore-sdc",
      category: "增加MTBF",
      parameter: "reductions.aiCoreSilent",
      before: 0,
      after: profile.reductions.aiCoreSilent,
      unit: "故障消减比例",
      effect: "只降低AICore静默分支发生率，不降低其余NPU故障。",
    },
    {
      key: "optical-reliability",
      name: "光模块可靠性改进",
      mode: "optical",
      category: "增加MTBF",
      parameter: "reductions.optical",
      before: 0,
      after: profile.reductions.optical,
      unit: "故障消减比例",
      effect:
        "光模块等效FIT下降；器件筛选、链路冗余等具体工程路径及共因条件待提供。",
    },
    {
      key: "silent-detection",
      name: "静默故障在线检测",
      mode: "aicore-sdc",
      category: "降低MTTR · 检测",
      parameter: "detection",
      before: profile.detection.current,
      after: profile.detection.improved,
      unit: "检出比例",
      effect: "基线已经启用；按检出/漏检分流，不再将检出率作为FIT消减比例。",
    },
    {
      key: "system-recovery",
      name: "系统级快速恢复（参数待补）",
      mode: "all",
      category: "降低MTTR · 诊断/恢复/回滚",
      parameter: "eventLossHours / missedRecoveryHours",
      before: {
        eventLossHours: profile.eventLossHours.current,
        missedRecoveryHours: profile.missedRecoveryHours.current,
      },
      after: {
        eventLossHours: profile.eventLossHours.improved,
        missedRecoveryHours: profile.missedRecoveryHours.improved,
      },
      unit: "h/次",
      effect: `目标${profile.improvedAvailabilityTarget * 100}%；需补检测、Agent辅助诊断、人工等待、替换、加载检查点、回滚等恢复链。目标值本身不产生收益。`,
    },
  ];
  for (const m of measures)
    entries.push({
      key: m.key,
      kind: "mechanism",
      name: "周度场景 · " + m.name,
      payload: {
        ...common,
        category: m.category,
        coveredModeKeys:
          m.mode === "all" ? result.current.modes.map((v) => v.id) : [m.mode],
        parameterName: m.parameter,
        currentValue: m.before,
        improvedValue: m.after,
        unit: m.unit,
        description: m.effect,
        verificationStatus: "engineering-evidence-pending",
      },
    });
  entries.push({
    key: "basis",
    kind: "parameter-evidence",
    name: "周度场景 · FIT口径与静默故障约束",
    payload: {
      ...common,
      hbmNpuFitPerCard: profile.hbmNpuFitPerCard,
      shares: profile.shares,
      silentShare: profile.silentShare,
      aiCoreShareOfSilent: profile.aiCoreShareOfSilent,
      nonAiCoreSilentFitPerCard: result.residualSilentFitPerCard,
      residualSilentAccounting:
        "交叉约束：其部件归属未给出，已在其余模式合计内，不另加FIT",
      currentAvailabilityReference: profile.currentAvailabilityReference,
      improvedAvailabilityTarget: profile.improvedAvailabilityTarget,
      assumptions: result.assumptions,
    },
  });
  entries.push({
    key: "scenario",
    kind: "scenario-template",
    name: `${profile.cards / 10000}万卡周度现状与改进 · 用户场景`,
    payload: { ...common, profile, method: result.method },
  });
  return entries;
}

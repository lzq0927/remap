import { z } from "zod";

export const weeklyScenarioVersion = "weekly-2026-11-12.v1";
export const weeklyModeIds = [
  "hbm",
  "npu-other",
  "aicore-sdc",
  "optical",
  "other",
] as const;
export type WeeklyModeId = (typeof weeklyModeIds)[number];
export type WeeklyStage = "current" | "improved";
export type WeeklyDisplay = WeeklyStage | "both";
const probability = z.number().finite().min(0).max(1);
const hours = z.number().finite().min(0).max(8760).nullable();
const recovery = z
  .object({
    hbm: hours,
    "npu-other": hours,
    "aicore-sdc": hours,
    optical: hours,
    other: hours,
  })
  .strict();
export const weeklyScenarioSchema = z
  .object({
    schemaVersion: z.literal(weeklyScenarioVersion),
    cards: z.number().int().min(1).max(10000000),
    hours: z.literal(168),
    currentAvailabilityReference: probability,
    improvedAvailabilityTarget: probability,
    hbmNpuFitPerCard: z.number().finite().positive().max(1000000),
    shares: z
      .object({ hbm: probability, npu: probability, optical: probability })
      .strict(),
    silentShare: probability,
    aiCoreShareOfSilent: probability,
    reductions: z
      .object({
        hbm: probability,
        aiCoreSilent: probability,
        optical: probability,
      })
      .strict(),
    detection: z
      .object({ current: probability, improved: probability })
      .strict(),
    missedRecoveryHours: z
      .object({
        current: z.number().finite().min(0).max(8760),
        improved: z.number().finite().min(0).max(8760),
      })
      .strict(),
    // Equivalent loss per event, including detection, recovery, rollback and capacity impact.
    // aicore-sdc is the DETECTED branch only; the missed branch is separately weighted.
    eventLossHours: z
      .object({ current: recovery, improved: recovery })
      .strict(),
    evidenceNote: z.string().trim().min(1).max(4000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.shares.hbm + v.shares.npu <= 0 ||
      v.shares.hbm + v.shares.npu + v.shares.optical > 1 + 1e-12
    )
      ctx.addIssue({
        code: "custom",
        path: ["shares"],
        message: "HBM与NPU占比合计须大于0，三类占比总和不得超过100%",
      });
    if (v.silentShare * v.aiCoreShareOfSilent > v.shares.npu + 1e-12)
      ctx.addIssue({
        code: "custom",
        path: ["silentShare"],
        message: "AICore静默故障必须包含在NPU故障内",
      });
  });
export type WeeklyScenario = z.infer<typeof weeklyScenarioSchema>;
export function defaultWeeklyScenario(): WeeklyScenario {
  const unknown = {
    hbm: null,
    "npu-other": null,
    "aicore-sdc": null,
    optical: null,
    other: null,
  };
  return {
    schemaVersion: weeklyScenarioVersion,
    cards: 500000,
    hours: 168,
    currentAvailabilityReference: 0.6,
    improvedAvailabilityTarget: 0.95,
    hbmNpuFitPerCard: 1700,
    shares: { hbm: 0.15, npu: 0.15, optical: 0.35 },
    silentShare: 0.014,
    aiCoreShareOfSilent: 0.85,
    reductions: { hbm: 0.6, aiCoreSilent: 0.6, optical: 0.9 },
    detection: { current: 0.9, improved: 0.9 },
    missedRecoveryHours: { current: 48, improved: 48 },
    eventLossHours: { current: { ...unknown }, improved: { ...unknown } },
    evidenceNote:
      "用户提供的50万卡周度场景：每卡HBM＋NPU合计1700 FIT，两类各占全部故障15%；光模块35%。SDC占全部故障1.4%，其中AICore占85%；检出率90%，漏检恢复48h。改进：HBM降60%、AICore SDC降60%、光模块降90%。现状60%为参考；95%为配合系统快恢的目标，快恢参数待补。未提供实测暴露卡时与置信区间。",
  };
}

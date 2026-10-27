import { z } from "zod";
import type { AuditRequest } from "../../analysis/src/audit";
import type { AuditEventView } from "./audit-objects";
import { hardwareScaleEvents } from "./audit-hardware";
import { recoveryBudget } from "./audit-recovery-budget";

const time = z.number().finite().nonnegative().max(31536000);
const probability = z.number().finite().min(0).max(1);
export const trainingScenarioSchema = z
  .object({
    version: z.literal("training-600h.v1"),
    id: z.enum(["current", "extension", "breakthrough"]),
    name: z.string().trim().min(1).max(120),
    source: z.string().trim().min(1).max(2000),
    mechanismNotes: z.string().trim().max(1200).optional(),
    referenceAvailability: probability,
    referenceAvailabilityCards: z
      .number()
      .int()
      .positive()
      .max(1000000)
      .optional(),
    referenceAvailabilityByScale: z
      .record(
        z
          .string()
          .regex(/^[1-9]\d*$/)
          .refine((s) => Number(s) <= 1000000),
        probability,
      )
      .optional(),
    referenceCards: z.number().int().positive().max(1000000),
    mtbfHours: z.number().finite().positive().max(87600),
    mtbfEventIds: z.array(z.string()).max(2000),
    exposureByScale: z
      .record(
        z.string().regex(/^[1-9]\d*$/),
        z.number().finite().positive().max(100),
      )
      .optional(),
    checkpointSeconds: z.number().finite().min(0.000001).nullable(),
    saveSeconds: time,
    detectionSeconds: time,
    communicationSeconds: time,
    constructionSeconds: time,
    loadSeconds: time,
    compilationSeconds: time,
    detectionSuccess: probability,
    recoverySuccess: probability,
    manualRecoveryHours: time,
    sdcCoverage: probability.nullable(),
    slowCoverage: probability,
    investigationHours: z.number().finite().positive().max(87600),
    slowDetectionSeconds: time,
    sdcDetectionSeconds: time,
    hardTimeoutSeconds: time,
    investigationMapping: z.enum(["sdc-only", "sdc-and-slow"]).nullable(),
    assumptionsConfirmed: z.boolean(),
  })
  .strict();
export type TrainingScenario = z.infer<typeof trainingScenarioSchema>;
export function trainingScenarioPreset(
  id: TrainingScenario["id"],
): TrainingScenario {
  const current = id === "current",
    extended = id === "extension";
  return {
    version: "training-600h.v1",
    id,
    name: current ? "现状" : extended ? "延长线改进" : "突破性改进",
    source:
      "用户/专家三档参数表，2026-10-26；600小时固定总窗口；人工恢复与人工排查分开建模，参数是场景假设而非已验证产品能力",
    mechanismNotes: current
      ? "现有检查点、检测、自动恢复与人工兜底链；按表中现状参数建模。"
      : extended
        ? "极致CKPT；降lane优化、压测筛查优化；模型缩容训练、温备恢复；静默在线检测；基于算子打点的亚健康定界定位。"
        : "沿用极致CKPT；NPO/OIO优化、HBM新编码纠错、在线压测增强；静默在线检测；智能Agent故障管理。",
    referenceAvailability: current ? 0.6 : extended ? 0.82 : 0.985,
    referenceAvailabilityCards: 500000,
    referenceAvailabilityByScale: current ? { 10000: 0.985 } : {},
    referenceCards: current ? 10000 : 500000,
    mtbfHours: current ? 30 : (extended ? 18 : 45) / 60,
    mtbfEventIds: [],
    checkpointSeconds: current ? 600 : null,
    saveSeconds: current ? 4 : 0,
    detectionSeconds: current ? 60 : 20,
    communicationSeconds: current ? 60 : 20,
    constructionSeconds: 0,
    loadSeconds: current ? 10 : 5,
    compilationSeconds: current ? 60 : 15,
    detectionSuccess: current ? 0.95 : 0.99,
    recoverySuccess: 0.99,
    manualRecoveryHours: current ? 4.5 : extended ? 2 : 1,
    sdcCoverage: current ? 0.8 : extended ? 0.95 : null,
    slowCoverage: current ? 0.8 : 0.9,
    investigationHours: current ? 168 : extended ? 72 : 24,
    slowDetectionSeconds: 300,
    sdcDetectionSeconds: 1,
    hardTimeoutSeconds: 60,
    investigationMapping: null,
    assumptionsConfirmed: false,
  };
}
/** User reference points are independent observations, never fitted outputs or target caps. */
export function trainingReferenceAvailability(
  s: TrainingScenario,
  cards: number,
): number | null {
  return cards === (s.referenceAvailabilityCards ?? 500000)
    ? s.referenceAvailability
    : (s.referenceAvailabilityByScale?.[cards] ?? null);
}
/** Template MTBF extrapolation, under the same selected event scope and linear exposure.
 * Actual quantity-scaled rates and achieved availability remain in the independent simulation. */
export function trainingRecoveryBudget(
  s: TrainingScenario,
  cards: number,
  target: number,
  hours = 600,
) {
  const mtbfHours =
    ((s.mtbfHours * s.referenceCards) / cards) *
    ((s.exposureByScale?.[s.referenceCards] ?? 1) /
      (s.exposureByScale?.[cards] ?? 1));
  const referenceAvailability = trainingReferenceAvailability(s, cards);
  return {
    cards,
    target: recoveryBudget(mtbfHours, target, hours),
    reference:
      referenceAvailability !== null
        ? recoveryBudget(mtbfHours, referenceAvailability, hours)
        : null,
    basis:
      "按模板MTBF及同范围线性暴露折算；若仅选择计算中断，不代表全系统业务MTBF。",
  };
}
export function trainingScenarioIssues(
  input: TrainingScenario,
  events: AuditEventView[],
) {
  const s = trainingScenarioSchema.parse(input),
    issues: string[] = [];
  if (s.checkpointSeconds === null)
    issues.push("请填写step对应的检查点秒数，不能将step当成0秒");
  if (s.sdcCoverage === null) issues.push("请把99.x%填写为明确的静默检出率");
  if (
    !s.mtbfEventIds.length ||
    new Set(s.mtbfEventIds).size !== s.mtbfEventIds.length ||
    s.mtbfEventIds.some(
      (id) => !events.some((e) => e.id === id && e.type === "hard"),
    )
  )
    issues.push("请明确MTBF作用的中断故障范围");
  if (!s.investigationMapping)
    issues.push("请明确人工排查时长映射到哪些漏检路径");
  if (!s.assumptionsConfirmed)
    issues.push("请确认串行恢复、人工追加时间与继承参数的计算映射");
  return issues;
}
/** Compile explicit scenario inputs to existing model controls; no target fitting and no new solver. */
export function applyTrainingScenario(
  request: AuditRequest,
  input: TrainingScenario,
  events: AuditEventView[],
): AuditRequest {
  const s = trainingScenarioSchema.parse(input),
    issues = trainingScenarioIssues(s, events);
  if (issues.length) throw new Error(issues.join("；"));
  const architecture = request.architecture
    ? structuredClone(request.architecture)
    : undefined;
  if (s.exposureByScale) {
    if (!architecture) throw new Error("代际暴露需要明确事件归属架构");
    if (
      s.mtbfEventIds.some(
        (id) =>
          architecture.nodes.filter((n) => n.eventIds.includes(id)).length !==
          1,
      )
    )
      throw new Error("代际暴露要求每个所选事件有唯一硬件归属");
    for (const n of architecture.nodes) {
      const ids = n.eventIds.filter((id) => s.mtbfEventIds.includes(id));
      if (ids.length) {
        if (
          n.exposure &&
          JSON.stringify(n.exposure.eventIds?.slice().sort()) !==
            JSON.stringify(ids.slice().sort())
        )
          throw new Error("代际暴露范围冲突，请分离硬件节点或移除重复倍率");
        n.exposure = {
          multipliers: s.exposureByScale,
          eventIds: ids,
          source: s.source + "；所选事件代际暴露，硬件数量保持独立",
        };
      }
    }
  }
  const existing = new Map(
    (request.eventOverrides ?? []).map((e) => [e.id, e]),
  );
  const selected = events
    .filter((e) => s.mtbfEventIds.includes(e.id))
    .map((e) => ({ ...e, fit: existing.get(e.id)?.fit ?? e.fit }));
  const total = (
    architecture
      ? hardwareScaleEvents(selected, architecture, s.referenceCards)
      : selected
  ).reduce((v, e) => v + e.fit, 0);
  if (!(total > 0))
    throw new Error("所选故障范围没有正FIT，无法按原模式比例校准MTBF");
  const targetFit = 1e9 / s.referenceCards / s.mtbfHours;
  const eventOverrides = [
    ...(request.eventOverrides ?? []).filter(
      (e) => !s.mtbfEventIds.includes(e.id),
    ),
    ...selected.map((e) => ({
      id: e.id,
      fit: (e.fit * targetFit) / total,
      source:
        s.source +
        `；${s.referenceCards}卡/${s.mtbfHours}h，仅在所选${selected.length}类中断事件内按原FIT比例折算`,
      evidence: "scenario" as const,
      rateBasis: "npu-equivalent-hour",
      note: "场景输入的业务事件率校准，不是降低器件本征FIT；slow/sdc不自动同比例改变",
    })),
  ];
  const model = {
    ...request.model,
    checkpointComputeSeconds: s.checkpointSeconds!,
    checkpointSaveSeconds: s.saveSeconds,
    detectProbability: s.detectionSuccess,
    detectSeconds: s.detectionSeconds,
    timeoutSeconds: s.hardTimeoutSeconds,
    recoveryAttemptSeconds:
      s.communicationSeconds +
      s.constructionSeconds +
      s.loadSeconds +
      s.compilationSeconds,
    recoverySuccess: s.recoverySuccess,
    manualAdditionalSeconds: s.manualRecoveryHours * 3600,
    slowDetectProbability: s.slowCoverage,
    slowDetectHours: s.slowDetectionSeconds / 3600,
    sdcDelayHours: s.investigationHours,
    ...(s.investigationMapping === "sdc-and-slow"
      ? { slowLifetimeHours: s.investigationHours }
      : {}),
  };
  return {
    ...request,
    hours: 600,
    cards: 500000,
    scales: [
      ...new Set([
        ...(request.scales ?? [request.cards]),
        request.cards,
        500000,
      ]),
    ],
    target:
      request.cards === 500000
        ? request.target
        : (request.targets?.[500000] ?? 0.985),
    targets: {
      ...request.targets,
      [request.cards]: request.target,
      500000:
        request.cards === 500000
          ? request.target
          : (request.targets?.[500000] ?? 0.985),
    },
    trainingScenario: s,
    rateArithmetic: "catalog",
    sensitivity: false,
    architecture: architecture
      ? { ...architecture, budgetMethod: "agree-evidence" }
      : undefined,
    eventOverrides,
    candidateFitOverrides: [],
    baseline: undefined,
    optimization: { ...request.optimization, enabled: false },
    model,
    mechanisms: ["hardDetect", "slowDetect", "sdcDetect", "fast"],
    policy: {
      ...request.policy,
      "D-HARD": {
        coverage: s.detectionSuccess,
        detectSeconds: s.detectionSeconds,
      },
      "D-SLOW": {
        coverage: s.slowCoverage,
        detectSeconds: s.slowDetectionSeconds,
      },
      "D-SDC": {
        coverage: s.sdcCoverage!,
        detectSeconds: s.sdcDetectionSeconds,
      },
      "C-FAST": {
        computeSeconds: s.checkpointSeconds!,
        saveSeconds: s.saveSeconds,
      },
    },
  };
}

import { z } from "zod";
export const auditPlanningModelKeys = [
  "checkpointComputeSeconds",
  "checkpointSaveSeconds",
  "recoveryAttemptSeconds",
  "recoverySuccess",
  "manualAdditionalSeconds",
  "detectProbability",
  "detectSeconds",
  "timeoutSeconds",
  "slowDetectProbability",
  "slowDetectHours",
  "slowLifetimeHours",
  "slowLoss",
  "sdcDelayHours",
  "validationOverhead",
];

const scoreMap = z.record(z.number().finite().positive().max(10000));
export const planningMethods = [
  "agree",
  "equal",
  "arinc",
  "feasibility",
  "minimum-effort",
  "cost",
] as const;
export const planningMethodNames: Record<
  (typeof planningMethods)[number],
  string
> = {
  agree: "AGREE工程责任适配",
  equal: "均分参照",
  arinc: "现状损失比例适配",
  feasibility: "可改进性加权",
  "minimum-effort": "最小努力参照",
  cost: "成本曲线预算",
};
const budgetBound = z
  .object({
    min: z.number().finite().nonnegative().optional(),
    max: z.number().finite().nonnegative().optional(),
    locked: z.number().finite().nonnegative().optional(),
    source: z.string().trim().min(1).max(1000),
  })
  .strict()
  .refine((b) => (b.min ?? 0) <= (b.max ?? Infinity), "预算下限不能超过上限");
export const planningSchema = z
  .object({
    method: z.enum(planningMethods).optional(),
    complexity: scoreMap.optional(),
    feasibility: scoreMap.optional(),
    costs: z
      .record(
        z
          .object({
            a: z.number().finite().positive().max(10000),
            b: z.number().finite().positive().max(10),
            source: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .optional(),
    effort: scoreMap.optional(),
    budgetBounds: z.record(budgetBound).optional(),
    bounds: z
      .array(
        z
          .object({
            path: z
              .string()
              .regex(
                /^(model\.[A-Za-z]\w*|policy\.[A-Z][A-Z0-9-]*\.[A-Za-z]\w*|extension\.[A-Z][A-Z0-9-]*\.[A-Za-z]\w*)$/,
              ),
            min: z.number().finite().nonnegative().optional(),
            max: z.number().finite().nonnegative().optional(),
            locked: z.number().finite().nonnegative().optional(),
            source: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(60)
      .optional(),
    maxCandidates: z.number().int().min(8).max(64).optional(),
    objective: z.enum(["effort", "margin"]).optional(),
    conservative: z
      .object({
        enabled: z.boolean().optional(),
        probabilityDelta: z.number().finite().min(0).max(0.2).optional(),
        timeFactor: z.number().finite().min(1).max(3).optional(),
        unknownOverhead: z.number().finite().min(0).max(0.2).optional(),
        require: z.boolean().optional(),
        source: z.string().trim().min(1).max(1000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AuditPlanningOptions = z.infer<typeof planningSchema>;

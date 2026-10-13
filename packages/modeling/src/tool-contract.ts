import { z } from "zod";
export const toolResultSchema = z
  .object({
    engine: z.string().min(1),
    version: z.string().min(1),
    verdict: z.enum(["satisfied", "violated", "computed", "inconclusive"]),
    completed: z.boolean(),
    scope: z.string().min(1),
    metrics: z.record(z.number().finite()).default({}),
    trace: z
      .array(
        z.object({
          step: z.number().int(),
          label: z.string(),
          state: z.string(),
        }),
      )
      .default([]),
    diagnostics: z.array(z.string()).default([]),
    rawOutput: z.string(),
    artifacts: z
      .array(z.object({ name: z.string(), content: z.string() }))
      .default([]),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.verdict !== "inconclusive" && !result.completed)
      ctx.addIssue({
        code: "custom",
        path: ["completed"],
        message: "确定结论必须完成对应计算或反例发现",
      });
    if (result.verdict === "inconclusive" && result.completed)
      ctx.addIssue({
        code: "custom",
        path: ["completed"],
        message: "未得出结论不能标记验证完成",
      });
  });
export type ToolResult = z.infer<typeof toolResultSchema>;
export interface ToolInput {
  files: Array<{ name: string; content: string }>;
  scope: string;
  timeoutMs: number;
  metadata: Record<string, unknown>;
}
export interface ToolAdapter {
  id: string;
  version: string;
  methods: string[];
  describeCapabilities(): {
    id: string;
    version: string;
    methods: string[];
    mode: string;
    available: boolean;
    message?: string;
  };
  validateInputs(input: ToolInput): void;
  execute(input: ToolInput): Promise<ToolResult>;
}

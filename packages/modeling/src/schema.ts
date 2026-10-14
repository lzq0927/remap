import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/);
const text = z.string().max(20000);
const refs = z.array(id).max(2000).default([]);
export const logicSchema: z.ZodType<Logic> = z.lazy(() =>
  z
    .object({
      type: z.enum(["series", "parallel", "kofn", "and", "or", "event"]),
      id: id.optional(),
      k: z.number().int().positive().optional(),
      children: z.array(logicSchema).max(100).optional(),
    })
    .strict(),
);
export interface Logic {
  type: "series" | "parallel" | "kofn" | "and" | "or" | "event";
  id?: string;
  k?: number;
  children?: Logic[];
}
export const rateSchema = z
  .object({
    value: z.number().finite().nonnegative(),
    unit: z.enum(["FIT", "1/h"]),
  })
  .strict();
export const sourceSchema = z
  .object({
    id,
    name: z.string().min(1).max(200),
    contentHash: z.string().max(100),
    text: z.string().max(1000000),
    scope: z.enum(["synthetic", "public", "internal", "private"]),
    segments: z
      .array(
        z
          .object({ locator: z.string().max(200), text: z.string().max(30000) })
          .strict(),
      )
      .max(2000),
    originalBase64: z.string().max(7000000).optional(),
  })
  .strict();
const nativeFile = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z][A-Za-z0-9]{0,9}$/),
    content: z.string().max(300000),
  })
  .strict();
export const caseSchema = z
  .object({
    id,
    name: z.string().min(1).max(200),
    question: text,
    // Keep archived methods readable; execution requires an available adapter.
    method: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    metric: z.enum([
      "mission-reliability",
      "availability",
      "probability",
      "verification",
    ]),
    hours: z.number().finite().positive().max(1e9),
    logic: logicSchema.optional(),
    files: z.array(nativeFile).max(20).default([]),
    propertyRefs: refs,
    entityRefs: refs,
    bindings: z
      .array(
        z.object({ symbol: z.string().min(1).max(100), entityId: id }).strict(),
      )
      .max(100)
      .optional(),
    assumptions: z.array(text).max(100),
    categories: z.array(z.string().max(60)).max(30).default([]),
    impacts: z.array(z.string().max(60)).max(30).default([]),
    mechanismRefs: refs,
    toolId: z.string().max(100).optional(),
    scope: text,
  })
  .strict();
export const modelSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    name: z.string().min(1).max(200),
    sources: z.array(sourceSchema).max(40),
    entities: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(200),
            kind: z.enum([
              "system",
              "component",
              "service",
              "instance",
              "function",
              "location",
              "fault-domain",
            ]),
            description: text,
            sourceRefs: refs,
          })
          .strict(),
      )
      .max(2000),
    relations: z
      .array(
        z
          .object({
            id,
            source: id,
            target: id,
            kind: z.enum([
              "contains",
              "deployedOn",
              "connectsTo",
              "dependsOn",
              "implements",
              "flow",
            ]),
            label: z.string().max(200),
            sourceRefs: refs,
          })
          .strict(),
      )
      .max(5000),
    failureModes: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(200),
            entityId: id,
            category: z.string().min(1).max(60),
            impacts: z.array(z.string().max(60)).max(30),
            rate: rateSchema.nullable(),
            recoveryHours: z.number().finite().positive().nullable(),
            probability: z.number().min(0).max(1).nullable(),
            sourceRefs: refs,
          })
          .strict(),
      )
      .max(2000),
    mechanisms: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(200),
            kind: z.enum([
              "redundancy",
              "detection",
              "recovery",
              "isolation",
              "prevention",
            ]),
            entityRefs: refs,
            failureRefs: refs,
            description: text,
            conditions: text,
            status: z.enum(["candidate", "deployed", "disabled"]),
            sourceRefs: refs,
            effects: z
              .array(
                z
                  .object({
                    failureId: id,
                    rate: rateSchema.optional(),
                    recoveryHours: z.number().finite().positive().optional(),
                  })
                  .strict(),
              )
              .max(100)
              .default([]),
          })
          .strict(),
      )
      .max(500),
    requirements: z
      .array(
        z
          .object({
            id,
            statement: text,
            kind: z.enum(["safety", "liveness", "quantitative"]),
            sourceRefs: refs,
          })
          .strict(),
      )
      .max(500),
    behaviors: z
      .array(
        z
          .object({
            id,
            name: z.string().max(200),
            participants: refs,
            steps: z
              .array(
                z
                  .object({
                    id,
                    from: id,
                    to: id,
                    message: text,
                    condition: text,
                  })
                  .strict(),
              )
              .max(300),
            sourceRefs: refs,
          })
          .strict(),
      )
      .max(100),
    views: z
      .array(
        z
          .object({
            id,
            name: z.string().max(200),
            kind: z.enum(["architecture", "deployment", "functional"]),
            entityRefs: refs,
            positions: z.record(
              z
                .object({ x: z.number().finite(), y: z.number().finite() })
                .strict(),
            ),
          })
          .strict(),
      )
      .max(100),
    cases: z.array(caseSchema).max(100),
    decisions: z
      .array(
        z
          .object({
            id,
            statement: text,
            alternatives: text,
            reason: text,
            status: z.enum(["proposed", "accepted", "rejected"]),
            sourceRefs: refs,
            caseRefs: refs,
            runRefs: refs,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type EngineeringModel = z.infer<typeof modelSchema>;
export type AnalysisCase = z.infer<typeof caseSchema>;
export type Material = z.infer<typeof sourceSchema>;
export interface SavedModel {
  id: string;
  revision: number;
  semanticHash: string;
  contentHash: string;
  model: EngineeringModel;
  createdAt: string;
  updatedAt: string;
}
export interface ModelIssue {
  code: string;
  message: string;
  path: string;
  objectId?: string;
  severity: "error" | "warning";
}
export interface Proposal {
  id: string;
  modelId: string;
  baseRevision: number;
  candidate: EngineeringModel;
  reason: string;
  actor: "user" | "agent";
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
  resolvedAt?: string;
}

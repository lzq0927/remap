import type { AuditExtensionInput } from "./audit-extensions";
export interface AuditOptimizationRequest {
  enabled: boolean;
  /** Independent planning focus, without changing the frozen first-round target set. */
  planningCards?: number;
  autoTune?: boolean;
  allowFitTargets?: boolean;
  /** Search explicit, sourced expert extension scenarios. */
  exploreExtensions?: boolean;
  parameterTargets?: Record<string, number>;
  checkpointPeriods?: Record<string, number>;
  extensions?: AuditExtensionInput[];
  model?: Record<string, number>;
  policy?: Record<string, Record<string, number>>;
  fitTargets?: Array<{
    id: string;
    fit: number;
    source: string;
    evidence: "scenario" | "external-prior" | "internal-measured";
    rateBasis: string;
    note?: string;
  }>;
  /** User-adjusted engineering importance, per scale and mechanism; not a measured probability. */
  importance?: Record<string, Record<string, number>>;
  complexity?: Record<string, number>;
  screeningTrials?: number;
  attributionTrials?: number;
  permutations?: number;
}
export const auditOptimizationDefaults: AuditOptimizationRequest = {
  enabled: false,
  autoTune: true,
  allowFitTargets: false,
  exploreExtensions: true,
  extensions: [],
};
export function optimizationSampling(request: {
  trials: number;
  attributionTrials?: number;
  samplingProfile?: string;
  optimization?: AuditOptimizationRequest;
}) {
  const full = request.samplingProfile === "expert-reproduction";
  return {
    screeningTrials:
      request.optimization?.screeningTrials ??
      Math.min(request.trials, full ? 64 : 32),
    attributionTrials:
      request.optimization?.attributionTrials ??
      Math.min(request.attributionTrials ?? 64, full ? 64 : 32),
    permutations: request.optimization?.permutations ?? 8,
  };
}

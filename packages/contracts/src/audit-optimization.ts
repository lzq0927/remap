import type { AuditExtensionInput } from "./audit-extensions";
export interface AuditOptimizationRequest {
  enabled: boolean;
  autoTune?: boolean;
  allowFitTargets?: boolean;
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
  enabled: true,
  autoTune: true,
  allowFitTargets: true,
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
      Math.min(request.attributionTrials ?? 64, 128),
    permutations: request.optimization?.permutations ?? (full ? 16 : 8),
  };
}

import type { AuditRequest } from "./audit";
export type SensitivityScan = {
  parameter:
    | "sdcCoverage"
    | "sdcDelayHours"
    | "elasticSyncSeconds"
    | "stepSeconds";
  values: number[];
  scenarioId: "sdcStep" | "elastic" | "combined";
  current: number;
};
/** Legacy requests retain their original five scans; new expert tasks expose the reference's isolated comparisons. */
export function auditSensitivityPlan(
  request: AuditRequest,
  mechanisms: string[],
  model: Record<string, any>,
  policy: Record<string, any>,
): SensitivityScan[] {
  if (request.sensitivity === false) return [];
  if (request.sensitivityMode === undefined)
    return mechanisms.includes("sdcDetect")
      ? [
          {
            parameter: "sdcCoverage",
            values: [0.95, 0.99, 0.999],
            scenarioId: "combined",
            current: policy["D-SDC"].coverage,
          },
          {
            parameter: "sdcDelayHours",
            values: [24, 6],
            scenarioId: "combined",
            current: model.sdcDelayHours,
          },
        ]
      : [];
  const expert = request.sensitivityMode === "expert-reference";
  return [
    ...(expert || mechanisms.includes("sdcDetect")
      ? [
          {
            parameter: "sdcCoverage" as const,
            values: [0, 0.5, 0.8, 0.95, 0.99, 1],
            scenarioId: expert ? ("sdcStep" as const) : ("combined" as const),
            current: policy["D-SDC"].coverage,
          },
          {
            parameter: "sdcDelayHours" as const,
            values: [6, 24, 120],
            scenarioId: expert ? ("sdcStep" as const) : ("combined" as const),
            current: model.sdcDelayHours,
          },
        ]
      : []),
    ...(expert || mechanisms.includes("elastic")
      ? [
          {
            parameter: "elasticSyncSeconds" as const,
            values: [0, 1, 5, 30],
            scenarioId: expert ? ("elastic" as const) : ("combined" as const),
            current: policy["R-ELASTIC"].syncSeconds,
          },
        ]
      : []),
    ...(expert ||
    (mechanisms.includes("sdcDetect") && mechanisms.includes("step"))
      ? [
          {
            parameter: "stepSeconds" as const,
            values: [1, 5, 10],
            scenarioId: expert ? ("sdcStep" as const) : ("combined" as const),
            current: policy["R-SDC"].stepSeconds,
          },
        ]
      : []),
  ];
}

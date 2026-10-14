/** Requirement derivation only. Never used as a recovery time by the solver. */
export const auditTargetBasis = {
  anchorCards: 500000,
  anchorTarget: 0.985,
  anchorMtbfHours: 0.6,
  recoveryReferenceHours: 0.6 * (1 / 0.985 - 1),
  formula: "A = MTBF / (MTBF + 目标推导参考恢复时间)",
};
export function derivedAvailabilityTarget(mtbfHours: number) {
  return mtbfHours / (mtbfHours + auditTargetBasis.recoveryReferenceHours);
}
export const auditScalePresets = [
  { cards: 500000, target: 0.985, hardMtbfHours: 0.6 },
  { cards: 200000, target: derivedAvailabilityTarget(1.5), hardMtbfHours: 1.5 },
  { cards: 100000, target: derivedAvailabilityTarget(3), hardMtbfHours: 3 },
  { cards: 10000, target: derivedAvailabilityTarget(30), hardMtbfHours: 30 },
] as const;
export const auditDefaultTargets = Object.fromEntries(
  auditScalePresets.map((p) => [String(p.cards), p.target]),
);
export const auditReferenceScales = [500000, 200000, 100000, 10000, 1000];
export const auditScaleOrder = (a: number, b: number) => b - a;
export const auditReferenceMechanisms = [
  "sdcDetect",
  "step",
  "replay",
  "process",
  "elastic",
  "fast",
];
/** Changes sampling only: existing evidence, targets and selected measures stay explicit. */
export function auditSamplingPreset(profile: "expert-reproduction" | "quick") {
  const expert = profile === "expert-reproduction";
  return {
    samplingProfile: profile,
    rateArithmetic: "expert-reference" as const,
    trials: expert ? 4000 : 128,
    attributionTrials: expert ? 2000 : 64,
    sensitivityTrials: expert ? 2000 : 128,
    seed: 20261009,
    attributionSeed: 77334411,
    sensitivitySeed: 988133,
    sensitivityCards: 500000,
    sensitivityMode: "expert-reproduction" as const,
    confidenceMethod: expert
      ? ("normal-1.96" as const)
      : ("student-t" as const),
    attribution: true,
    sensitivity: true,
    verificationTrials: expert ? 2000 : 64,
  };
}
export function auditReferenceOnly(
  request: {
    samplingProfile?: string;
    cards: number;
    targets?: Record<string, number>;
  },
  cards: number,
) {
  return (
    request.samplingProfile !== undefined &&
    cards === 1000 &&
    request.cards !== cards &&
    request.targets?.[String(cards)] === undefined
  );
}

/** Keep each edited target when moving between scales, including custom card counts. */
export function changeAuditCards<
  T extends { cards: number; target: number; targets?: Record<string, number> },
>(request: T, cards: number): T {
  const targets = { ...request.targets };
  if (Number.isInteger(request.cards) && request.cards > 0)
    targets[String(request.cards)] = request.target;
  if (!Number.isInteger(cards) || cards < 1)
    return { ...request, cards, targets };
  const target =
    targets[String(cards)] ??
    auditDefaultTargets[String(cards)] ??
    request.target;
  return {
    ...request,
    cards,
    target,
    targets: { ...targets, [String(cards)]: target },
  };
}

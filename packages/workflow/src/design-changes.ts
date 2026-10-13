import { hash } from "../../assets/src/hash";

/** Compare server-validated snapshots, never a client-provided list of approvals. */
export function changedAuditStage(previous: any, current: any): number {
  if (
    previous?.activeAssessment !== "audit" ||
    current?.activeAssessment !== "audit" ||
    previous.scenario !== current.scenario ||
    !previous.assessment?.valid ||
    !current.assessment?.valid
  )
    return 0;
  const groups = (design: any) => {
    const {
      cards,
      hours,
      target,
      targets,
      scales,
      metricId,
      modelVersion,
      eventOverrides,
      rateArithmetic,
      baseline,
      lossBudgetMethod,
      lossBudgetWeights,
      submodelAllocation,
      hardwareAllocation,
      mechanisms,
      candidateFitOverrides,
      model,
      policy,
      recoveryOrder,
      costs,
      samplingProfile,
      trials,
      seed,
      confidenceMethod,
      attribution,
      attributionTrials,
      attributionSeed,
      sensitivity,
      sensitivityMode,
      sensitivityTrials,
      sensitivityCards,
      sensitivitySeed,
      verifyRecommendation,
      verificationTrials,
      ...unknown
    } = design.assessment.input;
    return [
      {
        cards,
        hours,
        target,
        targets,
        scales,
        metricId,
        modelVersion,
        unknown,
      },
      {
        eventOverrides,
        rateArithmetic,
        resolvedEvents: baseline?.resolvedEventIds,
        note: baseline?.note,
      },
      {
        lossBudgetMethod,
        lossBudgetWeights,
        submodelAllocation,
        hardwareAllocation,
      },
      {
        mechanisms,
        candidateFitOverrides,
        model,
        policy,
        recoveryOrder,
        costs,
        deployed: baseline?.mechanisms,
      },
      {
        samplingProfile,
        trials,
        seed,
        confidenceMethod,
        attribution,
        attributionTrials,
        attributionSeed,
        sensitivity,
        sensitivityMode,
        sensitivityTrials,
        sensitivityCards,
        sensitivitySeed,
        verifyRecommendation,
        verificationTrials,
      },
    ];
  };
  const before = groups(previous),
    after = groups(current);
  const changed = before.findIndex(
    (group, index) => hash(group) !== hash(after[index]),
  );
  // A new run still requires fresh calculation review and delivery, even for identical inputs.
  return changed < 0 ? 4 : changed;
}

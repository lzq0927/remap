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
      eventCatalogVersion,
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
      optimization,
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
        eventCatalogVersion,
        rateArithmetic,
        resolvedEvents: baseline?.resolvedEventIds,
        note: baseline?.note,
      },
      {
        lossBudgetMethod,
        lossBudgetWeights,
        submodelAllocation,
        hardwareAllocation,
        optimizationStrategy: optimization && {
          enabled: optimization.enabled,
          autoTune: optimization.autoTune,
          allowFitTargets: optimization.allowFitTargets,
          exploreExtensions: optimization.exploreExtensions,
          importance: optimization.importance,
          complexity: optimization.complexity,
        },
      },
      {
        mechanisms,
        candidateFitOverrides,
        model,
        policy,
        recoveryOrder,
        costs,
        deployed: baseline?.mechanisms,
        optimizationMeasures: optimization && {
          extensions: optimization.extensions,
          model: optimization.model,
          policy: optimization.policy,
          fitTargets: optimization.fitTargets,
          parameterTargets: optimization.parameterTargets,
          checkpointPeriods: optimization.checkpointPeriods,
        },
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
        optimizationSampling: optimization && {
          screeningTrials: optimization.screeningTrials,
          attributionTrials: optimization.attributionTrials,
          permutations: optimization.permutations,
        },
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

/** Engineering budget, not a reliability composition theorem. Must be mapped and forward verified. */
export function allocateTrainingLoss(req: {
  target: number;
  hours: number;
  items: Array<{ id: string; name?: string; weight?: number }>;
}) {
  if (
    !Number.isFinite(req.target) ||
    req.target < 0 ||
    req.target > 1 ||
    !Number.isFinite(req.hours) ||
    req.hours <= 0 ||
    !req.items.length
  )
    throw new Error("Invalid training loss budget");
  if (new Set(req.items.map((i) => i.id)).size !== req.items.length)
    throw new Error("Loss budget item IDs must be unique");
  const weights = req.items.map((i) => i.weight ?? 1);
  if (
    weights.some((w) => !Number.isFinite(w) || w < 0) ||
    weights.reduce((a, b) => a + b, 0) <= 0
  )
    throw new Error("Invalid loss budget weights");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum))
    throw new Error("Loss budget weight sum must be finite");
  return {
    method: "training.loss-budget.weighted.v1",
    metricId: "training.correct-delivery",
    requiresForwardValidation: true,
    totalLossRatio: 1 - req.target,
    totalLossHours: (1 - req.target) * req.hours,
    items: req.items.map((i, j) => ({
      ...i,
      weight: weights[j] / sum,
      lossRatioBudget: (1 - req.target) * (weights[j] / sum),
      lossHoursBudget: (1 - req.target) * req.hours * (weights[j] / sum),
      parameterMappingStatus: "pending",
    })),
    assumptions: [
      "Disjoint loss-accounting categories; overlapping physical subsystem effects require explicit attribution",
      "Budget allocation is a design constraint, not proof of achievability",
      "Unresolved terminal pollution can invalidate earlier output and exhaust the entire budget",
    ],
  };
}

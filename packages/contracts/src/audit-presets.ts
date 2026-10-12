/** Product requirements; targets are not inferred from MTBF or fitted to simulation results. */
export const auditScalePresets = [
  { cards: 10000, target: 0.99, hardMtbfHours: 30 },
  { cards: 100000, target: 0.95, hardMtbfHours: 3 },
  { cards: 200000, target: 0.9, hardMtbfHours: 1.5 },
  { cards: 500000, target: 0.8, hardMtbfHours: 0.6 },
] as const;
export const auditDefaultTargets = Object.fromEntries(
  auditScalePresets.map((p) => [String(p.cards), p.target]),
);

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

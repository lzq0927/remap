export function deliveryRatio(x: {
  correctWork: number;
  idealWork: number;
  unresolvedPollution: boolean;
}): number {
  if (
    !Number.isFinite(x.idealWork) ||
    x.idealWork <= 0 ||
    !Number.isFinite(x.correctWork) ||
    x.correctWork < 0 ||
    x.correctWork > x.idealWork
  )
    throw new Error("INVALID_WORK_DENOMINATOR_OR_PROGRESS");
  return x.unresolvedPollution ? 0 : x.correctWork / x.idealWork;
}

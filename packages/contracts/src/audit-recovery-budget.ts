/** Requirement conversion only. Never overwrites the forward simulation's loss ledger. */
export function equivalentMttrSeconds(
  mtbfHours: number | null,
  availability: number,
) {
  if (
    mtbfHours == null ||
    !Number.isFinite(mtbfHours) ||
    mtbfHours <= 0 ||
    !Number.isFinite(availability) ||
    availability <= 0 ||
    availability > 1
  )
    return null;
  return (mtbfHours * 3600 * (1 - availability)) / availability;
}

export function recoveryBudget(
  mtbfHours: number | null,
  availability: number,
  hours = 600,
) {
  const seconds = equivalentMttrSeconds(mtbfHours, availability);
  return {
    availability,
    mtbfHours,
    equivalentMttrSeconds: seconds,
    lossHours:
      Number.isFinite(availability) &&
      availability >= 0 &&
      availability <= 1 &&
      hours > 0
        ? hours * (1 - availability)
        : null,
    formula: "MTTR = MTBF × (1−A) / A；损失预算 = 总窗口 × (1−A)",
  };
}

/** Presentation precision only: keep positive tiny values and near-100% probabilities visible. */
export function auditNumber(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 10 ** -digits)
    return Number(value.toPrecision(2)).toExponential().replace("e+", "e");
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}
export function auditPercent(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const p = value * 100,
    unit = 10 ** -digits;
  if (p > 0 && p < unit) return `<${unit}%`;
  if (p < 100 && p > 100 - unit) return `>${100 - unit}%`;
  return auditNumber(p, digits) + "%";
}
export function auditParameter(
  value: number | null | undefined,
  key: string,
): string {
  return /(?:coverage|success|probability|fraction|share|reduction|overhead|purity|ratio)$/i.test(
    key,
  )
    ? auditPercent(value)
    : auditNumber(value);
}

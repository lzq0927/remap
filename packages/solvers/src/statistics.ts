/** Type-7 interpolation, fixed-sample Student-t approximation and Wilson success interval. */
export function summarize(
  values: number[],
  target = 0.99,
  method: "student-t" | "normal-1.96" = "student-t",
) {
  if (values.length < 2 || values.some((v) => !Number.isFinite(v)))
    throw new Error("At least two finite samples required");
  const n = values.length,
    mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1),
    se = Math.sqrt(variance / n),
    df = n - 1;
  const small = [
    0, 12.706204736, 4.30265273, 3.182446305, 2.776445105, 2.570581836,
    2.446911851, 2.364624252, 2.306004135, 2.262157163, 2.228138852,
  ];
  const z = 1.959963984540054,
    t =
      method === "normal-1.96"
        ? 1.96
        : df <= 10
          ? small[df]
          : z +
            (z ** 3 + z) / (4 * df) +
            (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => {
    const h = (n - 1) * p,
      lo = Math.floor(h);
    return sorted[lo] + (sorted[Math.ceil(h)] - sorted[lo]) * (h - lo);
  };
  const successes = values.filter((v) => v >= target).length,
    p = successes / n,
    den = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / den,
    radius = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return {
    n,
    mean,
    variance,
    se,
    ciLow: mean - t * se,
    ciHigh: mean + t * se,
    p05: quantile(0.05),
    p50: quantile(0.5),
    p95: quantile(0.95),
    achievementProbability: p,
    successes,
    achievementInterval: {
      low: Math.max(0, center - radius),
      high: Math.min(1, center + radius),
    },
    intervalMethod:
      method === "normal-1.96"
        ? "fixed-sample normal 95% (1.96)"
        : "fixed-sample Student-t 95% (approximate quantile)",
    quantileMethod: "type-7",
    uncertainty:
      "Monte Carlo sampling only; excludes parameter and model uncertainty",
  };
}

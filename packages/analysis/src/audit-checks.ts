/** Checks certify only arithmetic and this run's model consistency, never production evidence. */
export function auditReviewChecks(
  hours: number,
  rows: any[],
  attribution: any[],
) {
  const losses = [
    "downtime",
    "rollback",
    "slowdown",
    "terminalInvalid",
    "localLoss",
  ];
  const residual = (row: any) =>
    hours -
    hours * row.statistics.mean -
    [...losses, "save"].reduce((n, k) => n + (row.ledger[k] ?? 0), 0);
  const timeResidual = Math.max(
    0,
    ...rows.map((row) => Math.abs(residual(row))),
  );
  const eventResidual = Math.max(
    0,
    ...rows.flatMap((row) =>
      losses.map((key) =>
        Math.abs(
          (row.ledger[key] ?? 0) -
            Object.values(row.perEvent).reduce(
              (n: number, event: any) => n + (event[key] ?? 0),
              0,
            ),
        ),
      ),
    ),
  );
  const shapleyResidual = Math.max(
    0,
    ...attribution.map((a) => Math.abs(a.residual)),
  );
  return [
    {
      name: "各规模、各方案的窗口时间账守恒",
      status: timeResidual < 1e-6 ? "passed" : "failed",
      detail: `${rows.length} 个场景；最大绝对残差 ${timeResidual.toExponential(3)} 小时`,
    },
    {
      name: "逐事件损失与总体损失账一致",
      status: eventResidual < 1e-6 ? "passed" : "failed",
      detail: `公共保存独立计账；最大绝对残差 ${eventResidual.toExponential(3)} 小时`,
    },
    {
      name: "可用度位于 0–1",
      status: rows.every(
        (r) => r.statistics.mean >= 0 && r.statistics.mean <= 1,
      )
        ? "passed"
        : "failed",
      detail: "检查本次全部规模、方案的均值",
    },
    {
      name: "Shapley 分摊与本节组合收益守恒",
      status: !attribution.length
        ? "not-run"
        : shapleyResidual < 1e-10
          ? "passed"
          : "failed",
      detail: attribution.length
        ? `${attribution.length} 个规模；最大绝对残差 ${shapleyResidual.toExponential(3)}`
        : "本次未启用 Shapley，不推断收益可加",
    },
  ];
}

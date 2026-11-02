import { expect, test } from "vitest";
import { matchedBaselineReconciliation } from "../src/audit-baseline-reconciliation";
import study from "../../../references/remap-studies/2026-11-02-baseline-reconciliation-50w.json";
const entry = () => ({
  inputHash: study.baselineInputHash,
  configuration: structuredClone(study.baselineConfiguration),
  rows: [
    {
      cards: 500000,
      statistics: { mean: study.results[0].mean },
      scaleEvents: study.results[0].eventFits.map(([id, type, fit]) => ({
        id,
        type,
        fit,
      })),
    },
  ],
});
test("independent diagnostics are shown only for their frozen baseline and exposure", () => {
  const e = entry();
  expect(matchedBaselineReconciliation(e, 500000, 600)).toEqual(study);
  expect(matchedBaselineReconciliation(e, 10000, 600)).toBeNull();
  expect(matchedBaselineReconciliation(e, 500000, 720)).toBeNull();
  const changed = entry();
  changed.configuration.model.manualAdditionalSeconds = 7200;
  expect(matchedBaselineReconciliation(changed, 500000, 600)).toBeNull();
  const rates = entry();
  rates.rows[0].scaleEvents[0].fit =
    Number(rates.rows[0].scaleEvents[0].fit) * 2;
  expect(matchedBaselineReconciliation(rates, 500000, 600)).toBeNull();
});
test("each stored diagnostic conserves the 600h loss ledger; expert references remain external", () => {
  for (const r of study.results) {
    expect(Object.values(r.ledger).reduce((a, b) => a + b, 0)).toBeCloseTo(
      r.loss,
      8,
    );
    expect(r.loss).toBeCloseTo(600 * (1 - r.mean), 8);
    expect(r.ciLow).toBeLessThan(r.mean);
    expect(r.ciHigh).toBeGreaterThan(r.mean);
  }
  expect(study.referencePoints.network.metric).toBe(
    "standalone-network-availability",
  );
  expect(study.referencePoints.network.hours).toBe(600);
  const network = study.results.find((r) => r.id === "network_only")!;
  expect(
    (network.mean - study.referencePoints.network.value) * 100,
  ).toBeCloseTo(3.020740879, 6);
  expect(
    600 * (1 - study.referencePoints.network.value) - network.loss,
  ).toBeCloseTo(18.124445275, 6);
  expect(study.originalModelChanged).toBe(false);
});

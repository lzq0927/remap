import { expect, it } from "vitest";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
} from "../../packages/analysis/src/audit";
import {
  applyTrainingScenario,
  trainingScenarioPreset,
} from "../../packages/contracts/src/audit-training-scenario";
it("verifies the 45-minute / 98.5% example through the 600h event ledger, without injecting 41 seconds or reducing FIT", () => {
  const events = getAuditEvents();
  const input = applyTrainingScenario(
    {
      ...getAuditDefaults(),
      cards: 500000,
      target: 0.985,
      targets: { 500000: 0.985 },
      scales: [500000],
      hours: 600,
      trials: 256,
      attributionTrials: 4,
      seed: 20261026,
      sensitivity: false,
      verifyRecommendation: false,
      optimization: { enabled: false },
    },
    {
      ...trainingScenarioPreset("breakthrough"),
      checkpointSeconds: 1,
      sdcCoverage: 0.995,
      mtbfEventIds: events.filter((e) => e.type === "hard").map((e) => e.id),
      investigationMapping: "sdc-only",
      assumptionsConfirmed: true,
    },
    events,
  );
  const before = structuredClone(input),
    original = audit(input);
  const r = audit({
    ...input,
    model: {
      ...input.model,
      recoveryAttemptSeconds: 22,
      recoverySuccess: 0.998,
      validationOverhead: 0.0001,
    },
    policy: {
      ...input.policy,
      "D-HARD": { coverage: 0.998, detectSeconds: 3.6 },
      "D-SLOW": { coverage: 0.978, detectSeconds: 42.1 },
      "D-SDC": { coverage: 0.999, detectSeconds: 1 },
    },
  });
  const row = r.rows.find((r) => r.id === "combined")!,
    root = r.topologyDecision!.scales[0].scenarios[0].nodes.find(
      (n) => n.id === "system",
    )!;
  expect(input).toEqual(before);
  expect(r.events.map((e) => e.fit)).toEqual(original.events.map((e) => e.fit));
  expect(root.mtbfHours).toBeCloseTo(0.75, 10);
  expect(row.statistics.ciLow).toBeGreaterThanOrEqual(0.985);
  const loss = (Object.values(row.ledger) as number[]).reduce((s, v) => s + v, 0);
  expect(row.statistics.mean).toBeCloseTo(1 - loss / 600, 10);
  expect(root.mttrSeconds).toBeCloseTo((2700 * loss) / (600 - loss), 8);
  expect(root.mttrSeconds!).toBeLessThanOrEqual(41.117);
  expect(r.config.model.recoveryAttemptSeconds).toBe(22);
  expect(row.statistics.mean).toBeGreaterThan(
    original.rows.find((r) => r.id === "combined")!.statistics.mean,
  );
});

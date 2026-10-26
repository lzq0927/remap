import { expect, it } from "vitest";
import {
  auditNumber,
  auditPercent,
  auditParameter,
  equivalentMttrSeconds,
  recoveryBudget,
} from "../../packages/contracts/src/audit-recovery-budget";
import {
  trainingRecoveryBudget,
  trainingScenarioPreset,
} from "../../packages/contracts/src/audit-training-scenario";
import {
  auditDefaultTargets,
  changeAuditCards,
} from "../../packages/contracts/src/audit-presets";
import { getAuditDefaults } from "../../packages/analysis/src/audit";

it("inverts the requested availability/MTBF pairs and recomposes their availability", () => {
  for (const [hours, a, expected] of [
    [30, 0.985, 1644.67005076],
    [0.6, 0.6, 1440],
    [17 / 60, 0.985, 15.53299492],
    [45 / 60, 0.985, 41.11675127],
  ]) {
    const b = recoveryBudget(hours, a);
    expect(b.equivalentMttrSeconds).toBeCloseTo(expected, 6);
    expect(hours / (hours + b.equivalentMttrSeconds! / 3600)).toBeCloseTo(
      a,
      12,
    );
    expect(b.lossHours).toBeCloseTo(600 * (1 - a), 10);
    // For a renewal cycle, number of cycles * recovery time equals total loss.
    expect(
      ((600 / (hours + b.equivalentMttrSeconds! / 3600)) *
        b.equivalentMttrSeconds!) /
        3600,
    ).toBeCloseTo(b.lossHours!, 10);
  }
  expect(equivalentMttrSeconds(null, 0.985)).toBeNull();
  expect(equivalentMttrSeconds(30, 0)).toBeNull();
  expect(equivalentMttrSeconds(30, 1)).toBe(0);
});

it("keeps scenario reference availability separate from the shared improvement target", () => {
  const current = trainingRecoveryBudget(
    trainingScenarioPreset("current"),
    500000,
    0.985,
  );
  const extension = trainingRecoveryBudget(
    trainingScenarioPreset("extension"),
    500000,
    0.985,
  );
  const breakthrough = trainingRecoveryBudget(
    trainingScenarioPreset("breakthrough"),
    500000,
    0.985,
  );
  expect(current.reference?.equivalentMttrSeconds).toBeCloseTo(1440, 10);
  expect(current.target.equivalentMttrSeconds).toBeCloseTo(32.893401, 5);
  expect(extension.target.equivalentMttrSeconds).toBeCloseTo(15.532995, 5);
  expect(extension.reference?.equivalentMttrSeconds).toBeCloseTo(223.902439, 5);
  expect(breakthrough.target.equivalentMttrSeconds).toBeCloseTo(41.116751, 5);
  for (const s of [current, extension, breakthrough])
    expect(s.target.lossHours).toBeCloseTo(9, 10);
  expect(trainingRecoveryBudget(trainingScenarioPreset("current"), 10000, 0.985).reference?.availability).toBe(.985);
});

it("sets the explicit 10k target to 98.5% while preserving edited and historical targets", () => {
  const initial = getAuditDefaults();
  expect(initial.targets[10000]).toBe(0.985);
  expect(initial.targets[500000]).toBe(0.985);
  expect(auditDefaultTargets[100000]).toBe(.985);
  expect(auditDefaultTargets[200000]).toBe(.985);
  const legacy = { ...initial, targets: { ...initial.targets, 10000: 0.9997 } };
  expect(changeAuditCards(legacy, 10000).target).toBe(0.9997);
  expect(changeAuditCards(initial, 10000).target).toBe(0.985);
});

it("uses concise display without turning nonzero loss into zero or partial coverage into 100%", () => {
  expect(auditNumber(15.53299492, 1)).toBe("15.5");
  expect(auditNumber(0.000476)).toBe("4.8e-4");
  expect(auditPercent(0.995)).toBe("99.5%");
  expect(auditPercent(0.999999)).toBe(">99.99%");
  expect(auditPercent(1)).toBe("100%");
  expect(auditPercent(0.0000001)).toBe("<0.01%");
  expect(auditParameter(60, "successSeconds")).toBe("60");
  expect(auditParameter(0.99, "recoverySuccess")).toBe("99%");
  expect(auditParameter(0.75, "bandwidthRatio")).toBe("75%");
});

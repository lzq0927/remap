import { describe, expect, it } from "vitest";
import {
  defaultWeeklyScenario,
  weeklyScenarioSchema,
} from "../../contracts/src/weekly-reliability";
import { evaluateWeeklyScenario } from "./weekly-reliability";
import { weeklyCatalogEntries } from "./weekly-catalog";

describe("confirmed weekly scenario", () => {
  it("conserves fault shares and counts AICore within NPU exactly once", () => {
    const r = evaluateWeeklyScenario(defaultWeeklyScenario());
    expect(r.current.totalFitPerCard).toBeCloseTo(5666.6666667);
    expect(r.current.total.events).toBeCloseTo(476);
    expect(r.current.modes.map((m) => m.events)).toEqual(
      expect.arrayContaining([
        expect.closeTo(71.4),
        expect.closeTo(166.6),
        expect.closeTo(5.6644),
      ]),
    );
    expect(r.current.npu.events).toBeCloseTo(71.4);
    expect(r.improved.npu.events).toBeCloseTo(68.00136);
    expect(r.improved.modes[0].events).toBeCloseTo(28.56);
    expect(r.improved.modes[3].events).toBeCloseTo(16.66);
    expect(r.improved.modes[2].events).toBeCloseTo(2.26576);
    expect(r.improved.total.events).toBeCloseTo(279.82136);
    expect(r.residualSilentFitPerCard).toBeCloseTo(11.9);
  });
  it("retains missing durations and exposes the missed-SDC budget conflict", () => {
    const r = evaluateWeeklyScenario(defaultWeeklyScenario());
    expect(r.referenceLossHours).toBeCloseTo(67.2);
    expect(r.targetLossHours).toBeCloseTo(8.4);
    expect(r.current.modes[2].missedLossHours).toBeCloseTo(27.18912);
    expect(r.improved.modes[2].missedLossHours).toBeCloseTo(10.875648);
    expect(r.improved.total.lossHours).toBeNull();
    expect(r.improved.modes[0].budgetAvailability).toBeNull();
    expect(r.improved.total.budgetAvailabilityCeiling).toBeCloseTo(0.935264);
    expect(r.knownBudgetExcessHours).toBeCloseTo(2.475648);
    expect(r.minimumDetectionWithWholeBudget).toBeCloseTo(0.922763223);
    expect(r.maximumMissedHoursWithWholeBudget).toBeCloseTo(37.073653);
  });
  it("uses detected and missed branches independently and distinguishes explicit zero", () => {
    const p = defaultWeeklyScenario();
    p.eventLossHours.improved.hbm = 0;
    p.eventLossHours.improved["aicore-sdc"] = 0.1;
    p.missedRecoveryHours.improved = 2;
    const r = evaluateWeeklyScenario(p);
    expect(r.improved.modes[0].lossHours).toBe(0);
    expect(r.improved.modes[0].budgetAvailability).toBe(1);
    expect(r.improved.modes[2].lossHours).toBeCloseTo(
      2.26576 * (0.9 * 0.1 + 0.1 * 2),
    );
    expect(r.improved.total.lossHours).toBeNull();
    // Target changes a budget, never rates or recovery times.
    p.improvedAvailabilityTarget = 0.999;
    const otherTarget = evaluateWeeklyScenario(p);
    expect(otherTarget.improved).toEqual(r.improved);
  });
  it("omits impossible recovery branches without requiring fictitious durations", () => {
    const p = defaultWeeklyScenario();
    p.detection.improved = 0;
    p.reductions.hbm = 1;
    const r = evaluateWeeklyScenario(p);
    expect(r.improved.modes[0].lossHours).toBe(0);
    expect(r.improved.modes[2].lossHours).toBeCloseTo(2.26576 * 48);
    expect(r.improved.total.lossHours).toBeNull();
  });
  it("rejects impossible shares, negative durations and misclassified AICore subsets", () => {
    const p = defaultWeeklyScenario();
    expect(
      weeklyScenarioSchema.safeParse({
        ...p,
        shares: { hbm: 0.4, npu: 0.4, optical: 0.4 },
      }).success,
    ).toBe(false);
    expect(
      weeklyScenarioSchema.safeParse({ ...p, silentShare: 0.9 }).success,
    ).toBe(false);
    expect(
      weeklyScenarioSchema.safeParse({
        ...p,
        missedRecoveryHours: { current: -1, improved: 48 },
      }).success,
    ).toBe(false);
    expect(weeklyScenarioSchema.safeParse({ ...p, hours: 600 }).success).toBe(
      false,
    );
  });
  it("records the three FIT measures, existing detection and unresolved quick recovery", () => {
    const entries = weeklyCatalogEntries(defaultWeeklyScenario());
    expect(entries.filter((e) => e.kind === "failure-mode")).toHaveLength(5);
    expect(entries.filter((e) => e.kind === "mechanism")).toHaveLength(5);
    expect(
      entries.find((e) => e.key === "silent-detection")?.payload,
    ).toMatchObject({ currentValue: 0.9, improvedValue: 0.9 });
    expect(
      entries.find((e) => e.key === "system-recovery")?.payload.improvedValue,
    ).toMatchObject({ eventLossHours: { hbm: null }, missedRecoveryHours: 48 });
    expect(entries.every((e) => !e.payload.modelBinding)).toBe(true);
  });
});

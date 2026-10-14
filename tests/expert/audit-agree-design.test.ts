import { expect, it } from "vitest";
import { deriveAgreeDesign } from "../../packages/analysis/src/audit-agree-design";
import { mechanismLossBudget } from "../../packages/analysis/src/audit-mechanism-budget";
import {
  audit,
  getAuditDefaults,
  resolveAudit,
} from "../../packages/analysis/src/audit";
import { extensionScenario } from "../../packages/contracts/src/audit-extensions";

const request = () => ({
  ...getAuditDefaults(),
  hours: 24,
  trials: 8,
  attributionTrials: 4,
  sensitivity: false,
  verificationTrials: 8,
  optimization: {
    enabled: true,
    autoTune: true,
    screeningTrials: 4,
    attributionTrials: 4,
    permutations: 2,
  },
});
function design(
  allowed = 0.36,
  fastImportance = 0.5,
  input: any = {},
  extensions: any[] = [],
) {
  const r = resolveAudit(request());
  const priorities = [
    "fast",
    "elastic",
    "process",
    "replay",
    "step",
    "sdcDetect",
  ].map((id) => ({ id, importance: id === "fast" ? fastImportance : 0.5 }));
  const budget = mechanismLossBudget(24, allowed, {}, priorities);
  return deriveAgreeDesign({
    hours: 24,
    scales: [500000],
    events: r.events,
    model: r.model,
    policy: r.policy,
    selected: r.mechanisms,
    recoveryOrder: r.recoveryOrder,
    budgets: new Map([[500000, budget]]),
    extensions,
    input,
  });
}
it("uses AGREE importance and tighter targets to change actual derived parameters before simulation", () => {
  const ordinary = design(),
    important = design(0.36, 1),
    strict = design(0.18);
  expect(important.policy["C-FAST"].saveSeconds).toBeLessThan(
    ordinary.policy["C-FAST"].saveSeconds,
  );
  expect(strict.policy["C-FAST"].saveSeconds).toBeLessThan(
    ordinary.policy["C-FAST"].saveSeconds,
  );
  expect(strict.policy["D-SDC"].coverage).toBeGreaterThan(
    ordinary.policy["D-SDC"].coverage,
  );
  expect(strict.model.recoveryAttemptSeconds).toBeLessThan(
    ordinary.model.recoveryAttemptSeconds,
  );
  // Reference values are starts, not caps on allocation-derived requirements.
  expect(strict.policy["D-SDC"].coverage).toBeGreaterThan(0.995);
  expect(strict.policy["C-FAST"].saveSeconds).toBeLessThan(0.5);
  expect(strict.model.sdcDelayHours).toBe(120);
});
it("conserves nested budgets and supplies formula, route rate, controlling scale and lock status", () => {
  const d = design();
  for (const p of d.perScale[0].componentPlans) {
    expect(
      p.items.reduce((sum: number, i: any) => sum + i.allowedHours, 0),
    ).toBeCloseTo(p.allowedHours, 12);
    expect(p.residual).toBeCloseTo(0, 12);
  }
  for (const p of d.envelope) {
    expect(p.cards).toBe(500000);
    expect(p.source).toContain("AGREE先行分配");
    expect(Number.isFinite(p.adopted)).toBe(true);
    expect(p.formula.length).toBeGreaterThan(8);
    expect(p.exposurePerHour).toBeGreaterThanOrEqual(0);
  }
  const saved = d.envelope.find((p) => p.id === "C-FAST.saveSeconds")!;
  const period = d.schedule["500000"];
  expect((saved.adopted / (period + saved.adopted)) * 24).toBeLessThanOrEqual(
    saved.allowedHours + 1e-12,
  );
});
it("keeps explicit parameters fixed while exposing stricter allocated requirements", () => {
  const d = design(0.01, 1, {
    policy: { "C-FAST": { saveSeconds: 0.5 }, "D-SDC": { coverage: 0.95 } },
    checkpointPeriods: { "500000": 60 },
  });
  expect(d.policy["C-FAST"].saveSeconds).toBe(0.5);
  expect(d.policy["D-SDC"].coverage).toBe(0.95);
  expect(d.schedule["500000"]).toBe(60);
  const requirement = d.envelope.find((p) => p.id === "C-FAST.saveSeconds")!;
  expect(requirement.locked).toBe(true);
  expect(requirement.required).toBeLessThan(requirement.adopted);
});
it("allocates degradation duration and retains the expert's bounded screening effect", () => {
  const degrade = extensionScenario("R-FABRIC-DEGRADE"),
    screen = extensionScenario("H-SDC-SCREEN");
  const before = JSON.stringify([degrade, screen]);
  const d = design(0.01, 0.5, {}, [degrade, screen]);
  expect(
    d.extensions.find((e) => e.id === degrade.id)!.parameters.repairSeconds,
  ).toBeLessThan(1800);
  expect(
    d.extensions.find((e) => e.id === screen.id)!.parameters.reduction,
  ).toBe(0.25);
  expect(JSON.stringify([degrade, screen])).toBe(before);
});
it("reviews every expert proposal, rejects unaffordable reference overhead, and preserves frozen first evidence", () => {
  const input = request(),
    result = audit(input),
    o = result.optimization;
  expect(o.planningVersion).toBe("agree-mechanism-design-v3");
  expect(o.design.allocationFrozenBeforeCandidates).toBe(true);
  expect(o.libraryDecisions).toHaveLength(16);
  expect(o.libraryDecisions.find((d: any) => d.id === "D-ABFT").selected).toBe(
    false,
  );
  expect(
    o.libraryDecisions.find((d: any) => d.id === "D-ABFT").reason,
  ).toContain("开销预算");
  expect(o.design.perScale.map((s: any) => s.cards)).toEqual([
    500000, 200000, 100000, 10000,
  ]);
  expect(o.factors.some((f: any) => f.kind === "fit")).toBe(false);
  for (const scale of o.allocations) {
    const first = result.rows.find(
      (r: any) => r.cards === scale.cards && r.id === "combined",
    );
    for (const path of scale.lossPathPlan.items)
      expect(path.actualHours).toBe(first.ledger[path.id] ?? 0);
  }
});

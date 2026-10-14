import { expect, it } from "vitest";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
  resolveAudit,
} from "../../packages/analysis/src/audit";
import { auditSections } from "../../packages/reports/src/audit";

const input = () => ({
  ...getAuditDefaults(),
  cards: 10000,
  target: 0.99,
  optimization: undefined,
  scales: [10000],
  targets: undefined,
  hours: 96,
  trials: 32,
  attributionTrials: 32,
  sensitivity: false,
  mechanisms: ["sdcDetect", "step", "elastic", "fast"],
  verifyRecommendation: false,
});
const sdcIds = getAuditEvents()
  .filter((e) => e.type === "sdc")
  .map((e) => e.id);

it("recalculates remaining mechanism gains after arbitrary resolved events, rather than relabelling the original ranking", () => {
  const result = audit({
    ...input(),
    baseline: { resolvedEventIds: sdcIds },
  } as any);
  const manual = audit({
    ...input(),
    eventOverrides: sdcIds.map((id) => ({
      id,
      fit: 0,
      source: "synthetic eliminated scenario",
      evidence: "scenario" as const,
      rateBasis: "npu-equivalent-hour",
    })),
  });
  expect(result.rows).toEqual(manual.rows);
  expect(result.attribution).toEqual(manual.attribution);
  expect((result as any).baseline.resolvedEvents.map((e: any) => e.id)).toEqual(
    sdcIds,
  );
  expect(
    (result as any).rankings[0].single.find((r: any) => r.id === "sdcDetect")
      .statistics.mean,
  ).toBe(0);
  expect(
    (result as any).rankings[0].single.find((r: any) => r.id === "step")
      .statistics.mean,
  ).toBe(0);
  expect(result.referenceComparison.matchesReference).toBe(false);
  expect(
    auditSections(result).some((s) => s.title.includes("剩余机制排序")),
  ).toBe(true);
});

it("holds deployed mechanisms in every coalition and excludes their sunk benefit and cost", () => {
  const ordinary = audit(input());
  const result = audit({
    ...input(),
    baseline: { mechanisms: ["sdcDetect"] },
    costs: { sdcDetect: 100000, step: 2, elastic: 4, fast: 1 },
  } as any);
  const base = result.rows.find((r) => r.id === "base");
  expect(base.statistics).toEqual(
    ordinary.rows.find((r) => r.id === "sdcDetect").statistics,
  );
  expect(result.rows.find((r) => r.id === "step").statistics).toEqual(
    ordinary.rows.find((r) => r.id === "sdcStep").statistics,
  );
  const a = result.attribution[0];
  expect(a.coalitions).toHaveLength(8);
  expect(a.contributions.map((c: any) => c.id)).not.toContain("sdcDetect");
  expect(a.residual).toBeCloseTo(0, 12);
  expect(
    (result as any).rankings[0].single.map((r: any) => r.id),
  ).not.toContain("sdcDetect");
  expect(result.recommendation.chosen.mechanisms).not.toContain("sdcDetect");
  expect(result.recommendation.chosen.cost).toBeLessThanOrEqual(7);
});

it("supports an empty remaining candidate set and rejects unknown or repeated baseline choices", () => {
  const result = audit({
    ...input(),
    baseline: { mechanisms: input().mechanisms },
  } as any);
  expect((result as any).rankings[0].single).toEqual([]);
  expect(result.recommendation.candidateCount).toBe(1);
  expect(result.rows.find((r) => r.id === "combined").delta.mean).toBe(0);
  for (const baseline of [
    { mechanisms: ["unknown"] },
    { mechanisms: ["step", "step"] },
    { resolvedEventIds: ["unknown"] },
    { resolvedEventIds: [sdcIds[0], sdcIds[0]] },
    { mechanisms: "step" },
    { arbitrary: true },
  ])
    expect(() => resolveAudit({ ...input(), baseline } as any)).toThrow();
});
it("keeps negative checkpoint gains, confirms paired rankings and uses the fixed baseline for independent verification", () => {
  const baseline = {
    mechanisms: ["elastic"],
    resolvedEventIds: getAuditEvents().map((e) => e.id),
  };
  const result = audit({
    ...input(),
    baseline,
    mechanisms: ["fast", "elastic", "step"],
    verifyRecommendation: true,
    verificationTrials: 8,
  });
  const ranking = result.rankings[0].single;
  expect(ranking.find((r) => r.id === "fast")!.statistics.mean).toBeLessThan(0);
  expect(ranking[0].id).toBe("step");
  expect(result.reviewChecks.every((c) => c.status === "passed")).toBe(true);
  expect(result.recommendation.verification.delta.mean).toBe(0);
  expect(result.recommendation.verification.baseline.mean).toBeCloseTo(
    result.rows.find((r) => r.id === "base")!.statistics.mean,
    12,
  );
  expect(result.config.classFit.sdc).toBe(0);
  expect(() =>
    resolveAudit({
      ...input(),
      baseline,
      candidateFitOverrides: [
        {
          id: getAuditEvents()[0].id,
          fit: 0,
          source: "synthetic",
          evidence: "scenario",
          rateBasis: "npu-equivalent-hour",
        },
      ],
    }),
  ).toThrow(/候选FIT/);
});

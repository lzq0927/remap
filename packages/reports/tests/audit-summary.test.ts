import { expect, it } from "vitest";
import { auditSummary, auditScaleSummary } from "../src/audit-summary";
const row = (
  id: string,
  cards: number,
  mean: number,
  ciLow: number,
  ciHigh: number,
) => ({
  id,
  cards,
  statistics: { mean, ciLow, ciHigh },
  delta: { mean: id === "base" ? 0 : 0.1 },
  ledger: { downtime: 10, save: 20, rollback: 5 },
  perEvent: {
    a: { downtime: 8, rollback: 2 },
    b: { downtime: 2, rollback: 3 },
  },
});
const fixture = {
  request: { cards: 10000, hours: 100, target: 0.9 },
  rows: [
    row("base", 10000, 0.82, 0.8, 0.84),
    row("combined", 10000, 0.92, 0.9, 0.94),
    row("base", 500000, 0.7, 0.68, 0.72),
    row("combined", 500000, 0.8, 0.78, 0.82),
  ],
  events: [
    { id: "a", description: "a", evidence: "external-prior" },
    { id: "b", description: "b", evidence: "internal-measured" },
  ],
};
it("uses the selected scale confidence interval for the decision and keeps signed target gap", () => {
  expect(auditSummary(fixture).status).toBe("supported");
  const large = auditSummary(fixture, 500000);
  expect(large.status).toBe("below");
  expect(large.gap).toBeCloseTo(-0.1);
  expect(large.additionalHours).toBe(10);
  const crossing = structuredClone(fixture);
  crossing.rows[1].statistics.ciLow = 0.89;
  expect(auditSummary(crossing).status).toBe("uncertain");
});
it("ranks exclusive event losses separately from common checkpoint saving and counts evidence", () => {
  const result = auditSummary(fixture);
  expect(result.losses[0].key).toBe("save");
  expect(result.drivers.map((d: any) => [d.id, d.loss])).toEqual([
    ["a", 10],
    ["b", 5],
  ]);
  expect(result.internal).toBe(1);
});
it("does not imply that a passing selected scale meets the other scale requirements", () => {
  expect(auditSummary(fixture).status).toBe("supported");
  expect(auditScaleSummary(fixture)).toEqual({
    total: 2,
    supported: 1,
    below: 1,
    uncertain: 0,
  });
});

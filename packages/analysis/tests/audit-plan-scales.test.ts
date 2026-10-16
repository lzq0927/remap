import { expect, it } from "vitest";
import { audit, getAuditDefaults } from "../src/audit";
import { auditPlanScales, validatePlanScales } from "../src/audit-plan-scales";
import { report } from "../../reports/src/render";
const source = () => {
  const input = {
    ...getAuditDefaults(),
    hours: 24,
    trials: 8,
    attributionTrials: 4,
    verificationTrials: 4,
    sensitivity: false,
  };
  return {
    id: "first",
    inputHash: "hash",
    createdAt: "2026-10-16",
    input,
    result: audit(input),
  };
};
it("plans each requested scale independently, preserves first evidence and exports separate parameter requirements", () => {
  const first = source(),
    before = JSON.stringify(first);
  const result = auditPlanScales({
    source: first,
    scales: [500000, 10000],
    options: { enabled: true, screeningTrials: 4, exploreExtensions: false },
  });
  expect(result.plans.map((p) => p.prediction.cards)).toEqual([10000, 500000]);
  expect(result.scenarioEvaluated).toBe(false);
  for (const p of result.plans) {
    expect(p.prediction.target).toBe(
      first.input.targets[String(p.prediction.cards)],
    );
    expect(p.scenarioEvaluated).toBe(false);
    expect(p.configuration.fitTargets).toBeUndefined();
  }
  expect(result.plans[0].configuration).not.toBe(result.plans[1].configuration);
  expect(JSON.stringify(first)).toBe(before);
  const html = report(
    {
      id: "scales",
      operation: "audit-plan-scales",
      status: "succeeded",
      result,
    } as any,
    "html",
  );
  const md = report(
    {
      id: "scales",
      operation: "audit-plan-scales",
      status: "succeeded",
      result,
    } as any,
    "md",
  );
  expect(html.includes("各规模目标、现状与独立规划预期")).toBe(true);
  expect(html.includes("各规模参数要求对照")).toBe(true);
  expect(md.includes("各规模参数要求对照")).toBe(true);
  expect(md.includes("<svg")).toBe(false);
});
it("rejects uncomputed, repeated, reference-only or unattributed scales before scheduling work", () => {
  const first = source();
  for (const scales of [[], [1000], [20000], [10000, 10000]])
    expect(() => validatePlanScales({ source: first, scales })).toThrow();
  expect(() =>
    validatePlanScales({
      source: first,
      scales: [10000],
      options: { enabled: true, planningCards: 500000 },
    }),
  ).toThrow();
  first.result.attribution = first.result.attribution.filter(
    (a) => a.cards !== 10000,
  );
  expect(() => validatePlanScales({ source: first, scales: [10000] })).toThrow(
    /Shapley/,
  );
});

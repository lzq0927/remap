import { expect, it } from "vitest";
import { audit, getAuditDefaults } from "../../packages/analysis/src/audit";
import { auditSubmodelPlan } from "../../packages/analysis/src/audit-allocation";
import { auditSections } from "../../packages/reports/src/audit";

const input = () => ({
  ...getAuditDefaults(),
  scales: [10000],
  targets: undefined,
  hours: 24,
  trials: 8,
  attributionTrials: 4,
  sensitivity: false,
  mechanisms: ["sdcDetect", "step"],
  verifyRecommendation: false,
});
it("freezes loss budgets from baseline before measures and preserves the exact forward results", () => {
  const equal = audit(input()),
    proportional = audit({
      ...input(),
      lossBudgetMethod: "baseline-proportional",
    });
  expect(proportional.rows).toEqual(equal.rows);
  expect(proportional.attribution).toEqual(equal.attribution);
  const plan = proportional.allocationPlan.lossBudgets[0],
    base = proportional.rows.find((row) => row.id === "base");
  expect(Object.values(plan.weights!).reduce((s, x) => s + x, 0)).toBeCloseTo(
    1,
    12,
  );
  expect(plan.weights!.rollback).toBeCloseTo(
    base.ledger.rollback / plan.baselineLossHours,
    12,
  );
  expect(
    proportional.designReview.scales[0].items.reduce(
      (s, x) => s + x.allowedHours!,
      0,
    ),
  ).toBeCloseTo(plan.allowedHours, 12);
});
it("calculates and reports all chosen allocation methods without substituting training yield or changing FIT", () => {
  const submodelAllocation = {
    method: "agree" as const,
    compareMethods: ["equal", "arinc", "agree"] as const,
    metricId: "task-reliability",
    target: 0.99,
    hours: 24,
    items: [
      { id: "a", complexity: 2, importance: 0.5, baselineRate: 0.001 },
      { id: "b", complexity: 1, importance: 1, baselineRate: 0.002 },
    ],
  };
  const result = audit({
    ...input(),
    submodelAllocation: {
      ...submodelAllocation,
      compareMethods: [...submodelAllocation.compareMethods],
    },
  });
  expect(result.events).toEqual(audit(input()).events);
  expect(result.allocationPlan.submodel!.comparisons).toHaveLength(3);
  expect(
    result.allocationPlan.submodel!.selected.recomposition.achieved,
  ).toBeCloseTo(0.99, 12);
  expect(
    result.allocationPlan.submodel!.selected.recomposition.ordinaryProduct,
  ).not.toBeCloseTo(0.99, 5);
  expect(
    auditSections(result).find((s) => s.title.startsWith("目标分配"))!
      .tables![1].rows,
  ).toHaveLength(6);
  expect(() =>
    auditSubmodelPlan({
      ...submodelAllocation,
      compareMethods: undefined,
      metricId: "training.retained-clean-progress",
    }),
  ).toThrow();
  expect(() =>
    auditSubmodelPlan({
      ...submodelAllocation,
      compareMethods: undefined,
      metricId: "steady-state-availability",
    }),
  ).toThrow();
});

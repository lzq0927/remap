import { test, expect } from "vitest";
import { allocateTrainingLoss } from "../src/loss-budget";
test("overflowing weight sums are rejected and large finite budgets stay finite", () => {
  expect(() =>
    allocateTrainingLoss({
      target: 0.99,
      hours: 720,
      items: [
        { id: "a", weight: 1e308 },
        { id: "b", weight: 1e308 },
      ],
    }),
  ).toThrow(/finite/);
  const r = allocateTrainingLoss({
    target: 0.99,
    hours: 1e308,
    items: [{ id: "a", weight: 1e308 }],
  });
  expect(Number.isFinite(r.items[0].lossHoursBudget)).toBe(true);
  expect(r.items[0].lossHoursBudget).toBe(r.totalLossHours);
});
test("training budgets add up and remain marked for forward verification", () => {
  const r = allocateTrainingLoss({
    target: 0.99,
    hours: 720,
    items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
  });
  expect(r.totalLossHours).toBeCloseTo(7.2);
  expect(r.items[0].lossHoursBudget).toBeCloseTo(1.8);
  expect(r.requiresForwardValidation).toBe(true);
  expect(r.items.reduce((s, i) => s + i.lossRatioBudget, 0)).toBeCloseTo(0.01);
});

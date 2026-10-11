import { test, expect } from "vitest";
import { deliveryRatio } from "../src/metrics/delivery";
test("terminal silent pollution invalidates all delivery despite earlier clean progress", () => {
  expect(
    deliveryRatio({
      correctWork: 600,
      idealWork: 720,
      unresolvedPollution: true,
    }),
  ).toBe(0);
});
test("clean terminal state scores remaining net work", () => {
  expect(
    deliveryRatio({
      correctWork: 600,
      idealWork: 720,
      unresolvedPollution: false,
    }),
  ).toBeCloseTo(5 / 6, 12);
});
test("invalid ideal work and excess progress are rejected", () => {
  expect(() =>
    deliveryRatio({ correctWork: 1, idealWork: 0, unresolvedPollution: false }),
  ).toThrow();
  expect(() =>
    deliveryRatio({
      correctWork: 721,
      idealWork: 720,
      unresolvedPollution: false,
    }),
  ).toThrow();
});

import { test, expect } from "vitest";
import { validateScenario, fitToRate } from "../src/validate";
test("FIT uses device exposure and invalid probabilities and mixed rates are rejected", () => {
  expect(fitToRate(1000)).toBe(1e-6);
  expect(
    validateScenario({ probabilities: [-0.1] }).some(
      (x) => x.code === "SCHEMA_INVALID",
    ),
  ).toBe(true);
  expect(
    validateScenario({
      rates: [{ basis: "device-hour" }, { basis: "job-hour" }],
    }).some((x) => x.code === "UNIT_MISMATCH"),
  ).toBe(true);
});

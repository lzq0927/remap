import { expect, test } from "vitest";
import {
  networkStudyDemo,
  networkStudySchema,
} from "../../contracts/src/audit-network-study";
import {
  compareNetworkLayouts,
  networkSuccessTree,
  sampleNetwork,
} from "../src/audit-network-study";
import { solveStatic } from "../../solvers/src/static";

test("a redundant pair shares the cabinet event instead of falsely making it independent", () => {
  const c = {
    ...networkStudyDemo,
    planes: 1,
    requiredPlanes: 1,
    trials: 1000,
    deviceFit: 1e8,
    deviceRepairHours: 1,
    cabinetFit: 2e8,
    cabinetRepairHours: 1,
  };
  const device = 1 / 1.1,
    cabinet = 1 / 1.2;
  const same = solveStatic({
    method: "bdd",
    tree: networkSuccessTree(c, "same-cabinet"),
  });
  const split = solveStatic({
    method: "bdd",
    tree: networkSuccessTree(c, "split-cabinet"),
  });
  expect(same.probability).toBeCloseTo(cabinet * (1 - (1 - device) ** 2), 13);
  expect(split.probability).toBeCloseTo(1 - (1 - device * cabinet) ** 2, 13);
  expect(split.probability).toBeGreaterThan(same.probability);
});

test("zero device FIT does not hide shared cabinet failures across all eight planes", () => {
  const c = { ...networkStudyDemo, deviceFit: 0, trials: 1000 };
  const p = 1 / (1 + c.cabinetFit * 1e-9 * c.cabinetRepairHours);
  const result = compareNetworkLayouts(c, 489);
  expect(result.rows[1].availability).toBeCloseTo(p ** 2, 13);
  expect(result.rows[2].availability).toBeCloseTo(1 - (1 - p) ** 2, 13);
  expect(result.rows[2].independentFleetAvailability).toBeCloseTo(
    result.rows[2].availability ** 489,
    13,
  );
});

test("snapshot Monte Carlo is reproducible and independently agrees on a nonrare analytic case", () => {
  const c = {
    ...networkStudyDemo,
    planes: 2,
    requiredPlanes: 1,
    deviceFit: 1e8,
    deviceRepairHours: 1,
    cabinetFit: 2e8,
    cabinetRepairHours: 1,
  };
  const tree = networkSuccessTree(c, "split-cabinet"),
    exact = solveStatic({ method: "bdd", tree }).probability;
  const sampled = sampleNetwork(tree, 50000, 44);
  expect(sampleNetwork(tree, 50000, 44)).toEqual(sampled);
  expect(Math.abs(sampled.availability - exact)).toBeLessThan(0.005);
  expect(sampled.interval95[0]).toBeLessThan(exact);
  expect(sampled.interval95[1]).toBeGreaterThan(exact);
});

test("zero failures preserve uncertainty and invalid capacity is rejected", () => {
  const r = sampleNetwork({ type: "event", id: "up", probability: 1 }, 1000, 1);
  expect(r.interval95[0]).toBeLessThan(0.997);
  expect(r.interval95[1]).toBe(1);
  expect(
    networkStudySchema.safeParse({ ...networkStudyDemo, requiredPlanes: 9 })
      .success,
  ).toBe(false);
});

import { it, expect } from "vitest";
import { allocate } from "../src/index";
const items = [
  {
    id: "A",
    name: "A",
    baselineRate: 0.001,
    complexity: 1,
    importance: 1,
    operatingHours: 10,
  },
  {
    id: "B",
    name: "B",
    baselineRate: 0.003,
    complexity: 1,
    importance: 1,
    operatingHours: 10,
  },
];
it("recomposes AGREE as weighted mission reliability and exposes engineering FIT targets", () => {
  const result = allocate({
    method: "agree",
    target: 0.9,
    hours: 10,
    items: [
      { id: "A", complexity: 1, importance: 2 },
      { id: "B", complexity: 2, importance: 0.5 },
    ],
  });
  expect(result.recomposition.achieved).toBeCloseTo(0.9, 12);
  expect(result.recomposition.ordinaryProduct).not.toBeCloseTo(0.9, 5);
  expect(result.engineering.requiresForwardValidation).toBe(true);
  expect(result.items[0].targetFit).toBe(result.items[0].targetRate! * 1e9);
});
it("equal and ARINC allocations meet exponential task target", () => {
  const req = { target: Math.exp(-0.04), hours: 10, items };
  allocate({ ...req, method: "equal" }).items.forEach((i) =>
    expect(i.targetRate).toBeCloseTo(0.002, 12),
  );
  allocate({ ...req, method: "arinc" }).items.forEach((i, j) =>
    expect(i.targetRate).toBeCloseTo([0.001, 0.003][j], 12),
  );
});
it("allocates series availability and labels approximate AGREE", () => {
  expect(
    allocate({
      method: "availability",
      target: 0.9801,
      hours: 10,
      items,
    }).items.map((i) => i.target),
  ).toEqual([0.99, 0.99]);
  expect(
    allocate({ method: "agree", target: 0.9, hours: 10, items }).warnings.join(
      " ",
    ),
  ).toMatch(/approximate/i);
  expect(() =>
    allocate({
      method: "agree",
      target: 0.9,
      hours: 10,
      items,
      metricId: "training.correct-delivery",
    }),
  ).toThrow(/task reliability/i);
});
it("rejects ARINC zero baseline", () =>
  expect(() =>
    allocate({
      method: "arinc",
      target: 0.9,
      hours: 10,
      items: items.map((i) => ({ ...i, baselineRate: 0 })),
    }),
  ).toThrow());
it("versions NASA2016 rate formula with per-item importance and operating hours", () => {
  const r = allocate({
    method: "agree",
    target: Math.exp(-0.04),
    hours: 10,
    items: [
      { id: "A", complexity: 1, importance: 2, operatingHours: 10 },
      { id: "B", complexity: 3, importance: 0.5, operatingHours: 20 },
    ],
  });
  expect(r.version).toBe("agree.nasa2016-rate");
  expect(r.items[0].targetRate).toBeCloseTo(0.0005, 12);
  expect(r.items[1].targetRate).toBeCloseTo(0.003, 12);
  for (const field of ["importance", "operatingHours"])
    expect(() =>
      allocate({
        method: "agree",
        target: 0.9,
        hours: 10,
        items: [{ id: "A", [field]: 0 }],
      }),
    ).toThrow();
});
it("deducts locked availability and obeys free item bounds in log space", () => {
  const r = allocate({
    method: "availability",
    target: 0.9,
    hours: 10,
    items: [
      { id: "A", locked: 0.95 },
      { id: "B", weight: 1, bounds: { min: 0.98, max: 1 } },
      { id: "C", weight: 1 },
    ],
  });
  expect(r.items[0].target).toBe(0.95);
  expect(r.items[1].target).toBe(0.98);
  expect(r.items[2].target).toBeCloseTo(0.9 / (0.95 * 0.98), 12);
  expect(r.items.reduce((p, i) => p * i.target, 1)).toBeCloseTo(0.9, 12);
  expect(() =>
    allocate({
      method: "availability",
      target: 0.99,
      hours: 10,
      items: [{ id: "A", locked: 0.9 }, { id: "B" }],
    }),
  ).toThrow(/constraint/i);
  expect(() =>
    allocate({
      method: "availability",
      target: 0.9,
      hours: 10,
      items: [{ id: "A", locked: 0.9, bounds: { min: 0.95, max: 1 } }],
    }),
  ).toThrow(/constraint/i);
  expect(() =>
    allocate({
      method: "equal",
      target: 0.9,
      hours: 10,
      items: [{ id: "A", locked: 0.9 }],
    }),
  ).toThrow(/unsupported/i);
});
it("rejects mismatched time bases and method metric combinations", () => {
  for (const method of ["equal", "arinc"] as const)
    expect(() =>
      allocate({
        method,
        target: 0.9,
        hours: 10,
        items: [{ id: "A", baselineRate: 0.01, operatingHours: 20 }],
      }),
    ).toThrow(/operatingHours/i);
  expect(() =>
    allocate({
      method: "availability",
      target: 0.9,
      hours: 10,
      items: [{ id: "A" }],
      metricId: "task-reliability",
    }),
  ).toThrow(/metric/i);
  expect(() =>
    allocate({
      method: "equal",
      target: 0.9,
      hours: 10,
      items: [{ id: "A" }],
      metricId: "steady-state-availability",
    }),
  ).toThrow(/metric/i);
  expect(() =>
    allocate({
      method: "arinc",
      target: 0.9,
      hours: 10,
      items: [{ id: "A", baselineRate: 0.01 }],
      metricId: "unknown",
    }),
  ).toThrow(/metric/i);
});
it("keeps availability current and gap unknown without explicit baseline availability", () => {
  const r = allocate({
    method: "availability",
    target: 0.9801,
    hours: 720,
    items: [{ id: "A", baselineRate: 0.01 }, { id: "B" }],
  });
  expect(r.items.map((i) => i.current)).toEqual([null, null]);
  expect(r.items.map((i) => i.gap)).toEqual([null, null]);
});
it("compares availability targets only with explicit availability baselines including boundaries", () => {
  const r = allocate({
    method: "availability",
    target: 0.81,
    hours: 720,
    items: [
      { id: "A", baselineRate: 0.01, baselineAvailability: 0.95 },
      { id: "B", baselineAvailability: 0 },
      { id: "C", baselineAvailability: 1 },
    ],
  });
  expect(r.items.map((i) => i.current)).toEqual([0.95, 0, 1]);
  for (const i of r.items) expect(i.gap).toBeCloseTo(i.target - i.current!, 12);
});
it("rejects invalid explicit baseline availability", () => {
  for (const baselineAvailability of [-0.01, 1.01, NaN, Infinity, null, "0.9"])
    expect(() =>
      allocate({
        method: "availability",
        target: 0.9,
        hours: 10,
        items: [{ id: "A", baselineAvailability }],
      } as any),
    ).toThrow(/baselineAvailability/);
});
it("retains exponential task reliability current values when availability data are also supplied", () => {
  for (const method of ["equal", "arinc", "agree"] as const) {
    const r = allocate({
      method,
      target: 0.9,
      hours: 10,
      items: [{ id: "A", baselineRate: 0.01, baselineAvailability: 0.7 }],
    });
    expect(r.items[0].current).toBeCloseTo(Math.exp(-0.1), 12);
    expect(r.items[0].gap).toBeCloseTo(r.items[0].target - Math.exp(-0.1), 12);
  }
});
it("keeps availability targets invariant under extreme finite weight scaling and meets series target", () => {
  for (const scale of [1e100, 1e308]) {
    const r = allocate({
      method: "availability",
      target: 0.9,
      hours: 10,
      items: [
        { id: "A", weight: scale },
        { id: "B", weight: scale },
      ],
    });
    r.items.forEach((i) => {
      expect(i.target).toBeCloseTo(Math.sqrt(0.9), 12);
      expect(i.weight).toBe(0.5);
    });
    expect(r.items.reduce((product, i) => product * i.target, 1)).toBeCloseTo(
      0.9,
      12,
    );
  }
});
it("normalizes only free availability weights while preserving locked and bounded targets", () => {
  const request = { method: "availability" as const, target: 0.9, hours: 10 };
  const result = (scale: number) =>
    allocate({
      ...request,
      items: [
        { id: "fixed", locked: 0.95, weight: 1e308 },
        { id: "bounded", weight: scale, bounds: { min: 0.98, max: 1 } },
        { id: "free", weight: scale },
        { id: "zero", weight: 0 },
      ],
    });
  const baseline = result(1),
    scaled = result(1e308);
  scaled.items.forEach((i, j) =>
    expect(i.target).toBeCloseTo(baseline.items[j].target, 12),
  );
  expect(scaled.items[0].target).toBe(0.95);
  expect(scaled.items[1].target).toBe(0.98);
  expect(scaled.items[3].target).toBe(1);
  expect(
    scaled.items.reduce((product, i) => product * i.target, 1),
  ).toBeCloseTo(0.9, 12);
});
it("uses finite normalized rate weights for ARINC and AGREE when raw sums overflow", () => {
  for (const method of ["arinc", "agree"] as const) {
    const r = allocate({
      method,
      target: 0.9,
      hours: 10,
      items: [
        { id: "A", baselineRate: 1e308, complexity: 1e308 },
        { id: "B", baselineRate: 1e308, complexity: 1e308 },
      ],
    });
    r.items.forEach((i) => {
      expect(i.weight).toBe(0.5);
      expect(i.targetRate).toBeCloseTo(-Math.log(0.9) / 20, 12);
    });
    expect(r.items.reduce((product, i) => product * i.target, 1)).toBeCloseTo(
      0.9,
      12,
    );
  }
});

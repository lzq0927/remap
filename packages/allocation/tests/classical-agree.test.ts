import { expect, test } from "vitest";
import { allocate } from "../src/index";

test("classical conditional AGREE closes the specified design surrogate, not an unrelated series product", () => {
  const r = allocate({
    method: "agree.classical",
    target: 0.81,
    hours: 100,
    items: [
      { id: "critical", complexity: 1, importance: 1, operatingHours: 100 },
      { id: "tolerated", complexity: 1, importance: 0.5, operatingHours: 50 },
    ],
  });
  // sqrt(.81)=.9; loss .1/E gives .9 and .8. Mission times affect rates only.
  expect(r.items.map((i) => i.target)).toEqual([0.9, 0.8]);
  expect(r.items[1].targetRate).toBeCloseTo(-Math.log(0.8) / 50, 12);
  expect(r.recomposition.achieved).toBeCloseTo(0.81, 14);
  expect(r.recomposition.ordinaryProduct).toBeCloseTo(0.72, 14);
  expect(r.items[0].target).toBeGreaterThan(r.items[1].target);
  expect(r.version).toBe("agree.classical-conditional.v1");
});

test("classical AGREE rejects impossible conditional budgets and invalid probability importance", () => {
  for (const importance of [0, 0.01, 1.01])
    expect(() =>
      allocate({
        method: "agree.classical",
        target: 0.9,
        hours: 10,
        items: [{ id: "a", importance }],
      }),
    ).toThrow();
  const r = allocate({
    method: "agree.classical",
    target: 1,
    hours: 10,
    items: [{ id: "a", importance: 0.1 }],
  });
  expect(r.items[0].target).toBe(1);
  expect(r.items[0].targetRate).toBe(0);
});

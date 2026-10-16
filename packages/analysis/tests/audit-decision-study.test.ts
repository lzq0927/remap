import { afterEach, expect, it, vi } from "vitest";
import { audit, getAuditDefaults } from "../src/audit";
import {
  designAllocation,
  compareDesignAllocations,
} from "../src/audit-design-allocation";
import {
  boundPlanningConfiguration,
  conservativeConfiguration,
  validatePlanningSource,
} from "../src/audit-planning-bounds";
import { completeDecisionStudy } from "../src/audit-decision-study";
import * as experiments from "../src/audit-experiments";
import { summarize } from "../../solvers/src/statistics";
import { auditExperimentPlan } from "../src/audit-experiment-plan";
import { report } from "../../reports/src/render";
const source = () => {
  const defaults = getAuditDefaults();
  const input = {
    ...defaults,
    hours: 24,
    trials: 8,
    attributionTrials: 4,
    verificationTrials: 4,
    sensitivity: false,
    scales: [500000, 10000],
    targets: { "500000": defaults.target, "10000": defaults.targets["10000"] },
  };
  return {
    id: "decision-source",
    inputHash: "frozen",
    createdAt: "2026-10-16",
    input,
    result: audit(input),
  };
};
afterEach(() => vi.restoreAllMocks());
it("compares additive responsibility budgets with fixed limits, feasibility weights and sourced costs", () => {
  const items = [
    { id: "a", name: "a", importance: 1, complexity: 1, actualHours: 8 },
    { id: "b", name: "b", importance: 0.5, complexity: 1, actualHours: 2 },
  ];
  expect(designAllocation(1, 24, items).items[0].allowedHours).toBeLessThan(
    designAllocation(1, 24, items).items[1].allowedHours,
  );
  const equal = designAllocation(1, 24, items, {}, "equal"),
    arinc = designAllocation(1, 24, items, {}, "arinc");
  expect(equal.items[0].allowedHours).toBeCloseTo(0.5);
  expect(arinc.items[0].allowedHours).toBeCloseTo(0.8);
  const fixed = designAllocation(
    1,
    24,
    items,
    { budgetBounds: { a: { locked: 0.3, source: "fixed" } } },
    "arinc",
  );
  expect(fixed.items[0].allowedHours).toBeCloseTo(0.3);
  expect(fixed.items[1].allowedHours).toBeCloseTo(0.7);
  expect(() =>
    designAllocation(0.2, 24, items, {
      budgetBounds: { a: { min: 0.3, source: "floor" } },
    }),
  ).toThrow(/超过/);
  expect(() =>
    designAllocation(1, 24, items, {
      budgetBounds: { unknown: { min: 0.1, source: "invalid" } },
    }),
  ).toThrow(/未知/);
  const feasible = designAllocation(
    1,
    24,
    items,
    { feasibility: { a: 3, b: 1 } },
    "feasibility",
  );
  expect(feasible.items[0].allowedHours).toBeCloseTo(0.75);
  const min = designAllocation(4, 24, items, {}, "minimum-effort");
  expect(min.items.map((i) => i.allowedHours)).toEqual(
    expect.arrayContaining([expect.closeTo(2, 8)]),
  );
  const cost = designAllocation(
    4,
    24,
    items,
    {
      costs: {
        a: { a: 1, b: 1, source: "estimate" },
        b: { a: 1, b: 1, source: "estimate" },
      },
    },
    "cost",
  );
  expect(cost.items.reduce((s, i) => s + i.allowedHours, 0)).toBeCloseTo(4, 9);
  expect(cost.items[0].allowedHours).toBeGreaterThan(
    cost.items[1].allowedHours,
  );
  expect(
    compareDesignAllocations(1, 24, items).find((c) => c.method === "cost")
      ?.status,
  ).toBe("unavailable");
});
it("enforces sourced bounds and locks throughout planning and keeps fixed parameters out of stress scenarios", () => {
  const s = source(),
    before = JSON.stringify(s);
  const options = {
    bounds: [
      { path: "policy.D-SDC.coverage", max: 0.97, source: "coverage trial" },
      {
        path: "model.recoveryAttemptSeconds",
        locked: 30,
        source: "product specification",
      },
    ],
  };
  validatePlanningSource(s, options);
  const config = boundPlanningConfiguration(
    s,
    {
      enabled: true,
      policy: { "D-SDC": { coverage: 0.999 } },
      model: { recoveryAttemptSeconds: 1 },
    },
    options,
  );
  expect(config.policy!["D-SDC"].coverage).toBe(0.97);
  expect(config.model!.recoveryAttemptSeconds).toBe(30);
  expect(
    conservativeConfiguration(s, config, options).model!.recoveryAttemptSeconds,
  ).toBe(30);
  expect(() =>
    validatePlanningSource(s, {
      bounds: [{ path: "model.missing", min: 1, source: "bad" }],
    }),
  ).toThrow(/未知/);
  for (const path of [
    "model.horizonHours",
    "model.trials",
    "model.seed",
    "model.referenceMtbfHours",
  ])
    expect(() =>
      validatePlanningSource(s, {
        bounds: [
          { path, locked: 1, source: "must not change frozen conditions" },
        ],
      }),
    ).toThrow(/未知/);
  expect(() =>
    validatePlanningSource(s, {
      bounds: [
        {
          path: "policy.D-SDC.coverage",
          min: 0.99,
          max: 0.9,
          source: "conflict",
        },
      ],
    }),
  ).toThrow(/冲突/);
  expect(JSON.stringify(s)).toBe(before);
});
it("finds complementary subsets, rejects an all-on upper-bound assumption and preserves the frozen first run", () => {
  const s = source(),
    before = JSON.stringify(s),
    target = s.input.target;
  vi.spyOn(experiments, "experimentSampler").mockReturnValue(((
    cards: number,
    fs: any[],
    seeds: number[],
  ) => {
    const ids = fs.map((f) => f.id);
    const mean =
      ids.includes("policy:D-SDC") && ids.includes("policy:R-SDC") ? 0.99 : 0.8;
    const value = mean - (ids.includes("policy:R-PROCESS") ? 0.1 : 0);
    return {
      cards,
      target,
      statistics: summarize(
        seeds.map(() => value),
        target,
      ),
      ledger: { save: (1 - value) * 24 },
      values: seeds.map(() => value),
      perEvent: {},
    };
  }) as any);
  const guided = {
    prediction: { cards: s.input.cards, target },
    allocations: [{ cards: s.input.cards, allowedHours: 1, items: [] }],
    configuration: {
      enabled: true,
      policy: {
        "D-SDC": { coverage: 0.99 },
        "R-SDC": { recoverSeconds: 0.5 },
        "R-PROCESS": { successSeconds: 1 },
      },
    },
    factors: [],
    architectureDiagnosis: s.result.architectureDiagnosis,
  };
  const p = completeDecisionStudy(
    s,
    {
      enabled: true,
      planning: { maxCandidates: 16, conservative: { enabled: false } },
    },
    guided,
  );
  expect(p.decisionStudy.search.method).toBe("enumerated-discrete-pool");
  expect(p.configuration.policy?.["D-SDC"]).toBeDefined();
  expect(p.configuration.policy?.["R-SDC"]).toBeDefined();
  expect(p.configuration.policy?.["R-PROCESS"]).toBeUndefined();
  expect(p.decisionStudy.search.globalOptimal).toBe(false);
  expect(p.decisionStudy.feasibility.proofOfInfeasibility).toBe(false);
  expect(
    p.decisionStudy.alternatives[0].curves.map((r: any) => r.cards),
  ).toEqual([10000, 500000]);
  expect(JSON.stringify(s)).toBe(before);
});
it("exports a bounded real plan with stress, traceable weights, fixed curves and selectable alternatives", () => {
  const s = source(),
    before = JSON.stringify(s);
  const p = auditExperimentPlan({
    source: s,
    options: {
      enabled: true,
      screeningTrials: 4,
      exploreExtensions: false,
      planning: {
        method: "equal",
        complexity: { fast: 2 },
        bounds: [
          {
            path: "policy.D-SDC.coverage",
            max: 0.98,
            source: "measured limit",
          },
        ],
        maxCandidates: 12,
      },
    },
  });
  expect(
    p.configuration.policy?.["D-SDC"]?.coverage ?? 0.95,
  ).toBeLessThanOrEqual(0.98);
  expect(p.decisionStudy.constraints[0].source).toBe("measured limit");
  expect(
    p.allocations[0].items.find((i: any) => i.id === "fast")?.complexity,
  ).toBe(2);
  expect(p.decisionStudy.search.evaluated).toBeLessThanOrEqual(12);
  expect(p.decisionStudy.conservative.enabled).toBe(true);
  expect(p.scenarioEvaluated).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
  const run = {
    id: "planned",
    status: "succeeded",
    operation: "audit-plan",
    result: p,
  } as any;
  const html = report(run, "html"),
    md = report(run, "md");
  expect(html).toContain("固定方案在各规模的可用度与保守情景");
  expect(html).toContain("跨规模贡献热力图");
  expect(html).toContain("data-scenario-band");
  expect(html).toContain("各规模现状与方案损失成对比较");
  expect(md).toContain("工程边界、单类杠杆与待验证证据");
  expect(md).not.toContain("<svg");
});

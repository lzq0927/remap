import { expect, it } from "vitest";
import { audit, getAuditDefaults } from "../../packages/analysis/src/audit";
import {
  auditExperiment,
  experimentFactors,
  experimentSampler,
  experimentSeeds,
  validateExperiment,
} from "../../packages/analysis/src/audit-experiments";
import { auditExperimentPlan } from "../../packages/analysis/src/audit-experiment-plan";
import {
  compareAuditExperiments,
  experimentSections,
} from "../../packages/reports/src/audit-experiments";
import { report } from "../../packages/reports/src/render";
const request = () => ({
  ...getAuditDefaults(),
  hours: 24,
  trials: 16,
  attributionTrials: 8,
  sensitivity: false,
  verificationTrials: 8,
  scales: [500000, 200000, 100000, 10000],
  samplingProfile: "quick" as const,
});
function source() {
  const input = request(),
    result = audit(input);
  return {
    id: "first-frozen",
    inputHash: "first-hash",
    createdAt: "2026-10-14",
    input,
    result,
  };
}
it("defaults to a single first round with the original six mechanisms and 95% SDC coverage", () => {
  const s = source();
  expect(s.input.optimization.enabled).toBe(false);
  expect(s.input.mechanisms).toEqual([
    "sdcDetect",
    "step",
    "replay",
    "process",
    "elastic",
    "fast",
  ]);
  expect(s.result.config.policy["D-SDC"].coverage).toBe(0.95);
  expect(s.result.optimization).toBeNull();
});
it("evaluates ONLY the explicit 99.5% coverage change, conserves loss and incremental Shapley, and leaves the first round intact", () => {
  const s = source(),
    before = JSON.stringify(s),
    configuration = {
      enabled: true,
      policy: { "D-SDC": { coverage: 0.995 } },
      attributionTrials: 8,
      permutations: 4,
    };
  const r = auditExperiment({ source: s, name: "仅SDC99.5%", configuration });
  expect(JSON.stringify(s)).toBe(before);
  expect(r.factors).toHaveLength(1);
  expect(r.factors[0].value).toEqual({ coverage: 0.995 });
  expect(r.factors[0].before.coverage).toBe(0.95);
  expect(r.configuration.model).toBeUndefined();
  for (const row of r.rows) {
    expect(
      Object.values(row.ledger).reduce((sum, v) => sum + v, 0) +
        row.statistics.mean * s.input.hours,
    ).toBeCloseTo(s.input.hours, 9);
    expect(row.status === "supported").toBe(row.statistics.ciLow >= row.target);
  }
  for (const attribution of r.attribution)
    expect(Math.abs(attribution.residual)).toBeLessThan(1e-12);
  const seeds = Object.values(r.seeds).flat();
  expect(new Set(seeds).size).toBe(seeds.length);
});
it("records a worse requested design as evaluated rather than silently choosing the baseline", () => {
  const s = source();
  const r = auditExperiment({
    source: s,
    name: "保存阻塞加大",
    configuration: {
      enabled: true,
      policy: { "C-FAST": { saveSeconds: 30 } },
      attributionTrials: 4,
      permutations: 2,
    },
  });
  expect(r.factors[0].value.saveSeconds).toBe(30);
  expect(r.rows[0].statistics.mean).toBeLessThan(
    r.baseline.rows[0].statistics.mean,
  );
});
it("separates AGREE planning from formal evaluation and targets the primary scale without a strict cross-scale envelope", () => {
  const s = source(),
    before = JSON.stringify(s);
  const p = auditExperimentPlan({
    source: s,
    options: { enabled: true, screeningTrials: 8, exploreExtensions: false },
  });
  expect(p.scenarioEvaluated).toBe(false);
  expect(p.prediction.cards).toBe(500000);
  expect(p.prediction.target).toBe(0.985);
  expect(p.prediction.planningMargin).toBeLessThanOrEqual(0.0005);
  for (const a of p.allocations)
    expect(Math.abs(a.residual)).toBeLessThan(1e-12);
  expect(JSON.stringify(s)).toBe(before);
  expect(p.configuration.fitTargets).toBeUndefined();
  expect(p.configuration.checkpointPeriods).toBeUndefined();
  expect(
    p.decisions.some((d: any) => Number.isFinite(d.allocatedImprovementHours)),
  ).toBe(true);
});
it("replays an explicit configuration with exactly the same physics and rejects invalid parameters", () => {
  const s = source(),
    configuration = { enabled: true, policy: { "D-SDC": { coverage: 0.995 } } };
  const a = experimentSampler(s),
    f = experimentFactors(s, configuration),
    seeds = experimentSeeds(s, "evaluation", 16);
  expect(a(500000, f, seeds)).toEqual(a(500000, f, seeds));
  expect(() =>
    validateExperiment({
      source: s,
      name: "invalid",
      configuration: { enabled: true, policy: { "D-SDC": { coverage: 1.1 } } },
    }),
  ).toThrow();
});
it("compares immutable first and subsequent runs and exports separate conclusions, parameters and each ranking", () => {
  const s = source();
  const scenario = auditExperiment({
    source: s,
    name: "仅SDC99.5%",
    configuration: {
      enabled: true,
      policy: { "D-SDC": { coverage: 0.995 } },
      attributionTrials: 4,
      permutations: 2,
    },
  });
  const first = {
      ...s,
      status: "succeeded",
      operation: "audit",
      progress: 1,
      events: [],
    } as any,
    next = {
      id: "second",
      inputHash: "second-hash",
      createdAt: "2026-10-14",
      status: "succeeded",
      operation: "audit-experiment",
      result: scenario,
      input: {},
      progress: 1,
      events: [],
    } as any;
  const comparison = compareAuditExperiments([first, next]);
  expect(comparison.entries).toHaveLength(2);
  expect(comparison.entries[0].rows[0].statistics).toEqual(
    s.result.rows.find((r: any) => r.id === "combined" && r.cards === 500000)
      .statistics,
  );
  const html = report(
    { ...next, result: comparison, operation: "audit-compare" },
    "html",
  );
  for (const text of [
    "多次评估 / 横向结论",
    "参数横向比较",
    "第一轮现状",
    "仅SDC99.5%",
    "0.95",
    "0.995",
    "各次评估与目标的规模曲线",
  ])
    expect(html).toContain(text);
  expect(
    experimentSections(scenario).some((section) =>
      section.title.includes("增量Shapley"),
    ),
  ).toBe(true);
  expect(() =>
    compareAuditExperiments([
      first,
      { ...next, result: { ...scenario, sourceRunId: "other-first" } },
    ]),
  ).toThrow("同一次第一轮");
  expect(() =>
    compareAuditExperiments([
      first,
      { ...next, result: { kind: "expert-audit-plan" } },
    ]),
  ).toThrow("分配建议不是评估结果");
});

it("plans another scale independently from the same frozen first round", () => {
  const s = source(),
    before = JSON.stringify(s);
  const plan = auditExperimentPlan({
    source: s,
    options: {
      enabled: true,
      planningCards: 200000,
      screeningTrials: 8,
      exploreExtensions: false,
    },
  });
  expect(plan.prediction.cards).toBe(200000);
  expect(plan.prediction.target).toBe(s.input.targets["200000"]);
  expect(plan.allocations.find((row: any) => row.cards === 200000)?.target).toBe(
    s.input.targets["200000"],
  );
  expect(plan.allocations.find((row: any) => row.cards === 500000)?.target).toBe(
    s.input.target,
  );
  expect(plan.prediction.planningMargin).toBeLessThan(0.0003);
  expect(JSON.stringify(s)).toBe(before);
});

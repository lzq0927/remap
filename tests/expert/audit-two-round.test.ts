import { shapleyImportance } from "../../packages/analysis/src/audit-optimization";
import {
  mechanismLossBudget,
  mechanismGapDiagnostics,
} from "../../packages/analysis/src/audit-mechanism-budget";
import { expect, it } from "vitest";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
  resolveAudit,
} from "../../packages/analysis/src/audit";
import {
  auditScalePresets,
} from "../../packages/contracts/src/audit-presets";
import {
  auditExtensionCatalog,
  extensionScenario,
  validateExtensions,
} from "../../packages/contracts/src/audit-extensions";
import { agreeLossAllocation } from "../../packages/analysis/src/audit-allocation";
import { createEnhancedAuditEngine } from "../../packages/analysis/src/audit-enhanced-engine";
import { changedAuditStage } from "../../packages/workflow/src/design-changes";
import { report } from "../../packages/reports/src/render";
const small = () => ({
  ...getAuditDefaults(),
  hours: 24,
  trials: 8,
  attributionTrials: 4,
  sensitivity: false,
  verificationTrials: 8,
  optimization: {
    enabled: true,
    autoTune: true,
    allowFitTargets: true,
    screeningTrials: 4,
    attributionTrials: 4,
    permutations: 2,
  },
});

it("uses a common requirement floor across scales without replacing fault recovery or FIT", () => {
  const input = getAuditDefaults(),
    resolved = resolveAudit(input);
  expect(input.cards).toBe(500000);
  expect(input.scales[0]).toBe(500000);
  expect(input.target).toBe(0.985);
  expect(input.lossBudgetMethod).toBe("none");
  expect(auditScalePresets.map((p) => (p.target * 100).toFixed(2))).toEqual([
    "98.50",
    "98.50",
    "98.50",
    "98.50",
  ]);
  expect(new Set(auditScalePresets.map(p => p.target)).size).toBe(1);
  expect(resolved.model.recoveryAttemptSeconds).toBe(180);
  expect(resolved.events.map((e) => e.fit)).toEqual(
    getAuditEvents().map((e) => e.fit),
  );
});

it("keeps maximum Shapley importance inside the AGREE domain despite floating-point rounding", () => {
  const contribution = 31 / 100003;
  expect(0.2 + (0.8 * contribution) / contribution).toBeGreaterThan(1);
  expect(shapleyImportance(contribution, contribution)).toBe(1);
  expect(() =>
    agreeLossAllocation(1, 720, [
      {
        id: "a",
        name: "a",
        importance: shapleyImportance(contribution, contribution),
        complexity: 1,
        actualHours: 10,
      },
    ]),
  ).not.toThrow();
});

it("normalizes classical AGREE loss budgets and makes high-importance requirements stricter", () => {
  const items = [
    { id: "a", name: "a", complexity: 1, importance: 1, actualHours: 2 },
    { id: "b", name: "b", complexity: 1, importance: 0.2, actualHours: 2 },
  ];
  const r = agreeLossAllocation(1, 720, items);
  expect(r.items[0].allowedHours).toBeLessThan(r.items[1].allowedHours);
  expect(r.residual).toBeCloseTo(0, 14);
  expect(
    agreeLossAllocation(0, 720, items).items.every((i) => i.allowedHours === 0),
  ).toBe(true);
  expect(() =>
    agreeLossAllocation(1, 720, [{ ...items[0], importance: 0 }]),
  ).toThrow();
});

it("calibrates CORE/SRAM shares while preserving class totals, slow scaling and every SDC event", () => {
  const before = getAuditEvents("expert-2026-10-09"),
    after = getAuditEvents();
  const sum = (rows: typeof before, type: string) =>
    rows.filter((e) => e.type === type).reduce((s, e) => s + e.fit, 0);
  for (const type of ["hard", "slow", "sdc"])
    expect(sum(after, type)).toBeCloseTo(sum(before, type), 10);
  expect(
    after.find((e) => e.id === "CORE-hard")!.fit / sum(after, "hard"),
  ).toBeCloseTo(0.06, 14);
  expect(
    after.find((e) => e.id === "SRAM-hard")!.fit / sum(after, "hard"),
  ).toBeCloseTo(0.1, 14);
  expect(
    after.find((e) => e.id === "CORE-slow")!.fit /
      before.find((e) => e.id === "CORE-slow")!.fit,
  ).toBeCloseTo(6 / 14, 14);
  expect(
    after.find((e) => e.id === "SRAM-slow")!.fit /
      before.find((e) => e.id === "SRAM-slow")!.fit,
  ).toBeCloseTo(2, 14);
  expect(after.filter((e) => e.type === "sdc")).toEqual(
    before.filter((e) => e.type === "sdc"),
  );
  expect(1e9 / (10000 * sum(after, "hard"))).toBeCloseTo(30, 12);
  const historical = resolveAudit({
    ...small(),
    eventCatalogVersion: undefined,
  });
  expect(historical.events.map((e) => e.fit)).toEqual(before.map((e) => e.fit));
});

it("keeps first-round evidence immutable, independently verifies proposals and conserves incremental Shapley", () => {
  const input = small(),
    single = audit({ ...input, optimization: undefined });
  const progress: number[] = [],
    result = audit(input, (done, total) => progress.push(done / total));
  expect(result.rows).toEqual(single.rows);
  expect(result.attribution).toEqual(single.attribution);
  expect(result.config.inputHash).toBe(single.config.inputHash);
  expect(result.optimization.status).toBe("evaluated");
  expect(result.optimization.primaryCards).toBe(500000);
  for (const allocation of result.optimization.allocations) {
    expect(allocation.samplingMarginHours).toBeGreaterThanOrEqual(0);
    expect(allocation.residual).toBeCloseTo(0, 12);
    expect(
      allocation.items.every(
        (i: any) =>
          i.targetFit === undefined && i.allowedEquivalentSeconds >= 0,
      ),
    ).toBe(true);
    expect(
      allocation.lossPathPlan.items.reduce(
        (s: number, i: any) => s + i.allowedHours,
        0,
      ),
    ).toBeCloseTo(allocation.totalAllowedHours, 12);
  }
  expect(result.optimization.scales.map((s: any) => s.cards)).toEqual([
    500000, 200000, 100000, 10000,
  ]);
  const seeds = Object.values(result.optimization.seeds).flat() as number[];
  expect(new Set(seeds).size).toBe(seeds.length);
  const seedSet = new Set(seeds);
  expect(
    seeds.some((seed) =>
      seedSet.has((Math.imul(seed, 1664525) + 1013904223) >>> 0),
    ),
  ).toBe(false);
  expect(result.optimization.legacyFitSearchIgnored).toBe(true);
  expect(result.optimization.factors.some((f: any) => f.kind === "fit")).toBe(
    false,
  );
  for (const event of result.optimization.optimizedEvents) {
    const original = result.events.find((e: any) => e.id === event.id)!;
    if (event.type !== "sdc") expect(event.fit).toBe(original.fit);
    else expect(event.fit).toBeGreaterThanOrEqual(original.fit * 0.75);
  }
  const firstSeeds = [input.seed, input.attributionSeed].flatMap((base) =>
    Array.from(
      { length: input.trials },
      (_, i) => (base! + Math.imul(i + 1, 2654435761)) >>> 0,
    ),
  );
  expect(seeds.every((seed) => !firstSeeds.includes(seed))).toBe(true);
  for (const a of result.optimization.attribution)
    expect(Math.abs(a.residual)).toBeLessThan(1e-12);
  for (const s of result.optimization.scales) {
    expect(
      Object.values(s.optimized.ledger).reduce(
        (a: number, b: any) => a + b,
        0,
      ) +
        s.optimized.statistics.mean * input.hours,
    ).toBeCloseTo(input.hours, 8);
    expect(s.status === "supported").toBe(
      s.optimized.statistics.ciLow >= s.target,
    );
  }
  expect(progress.at(-1)).toBe(1);
  expect(progress.every((p, i) => p >= (progress[i - 1] ?? 0))).toBe(true);
  const html = report(
    {
      id: "two-round",
      operation: "audit",
      status: "succeeded",
      input,
      result,
      events: [],
      createdAt: "2026-10-14",
    } as any,
    "html",
  );
  for (const content of [
    "两轮评估与设计决策",
    "不同规模：现状、优化预期与目标",
    "AGREE 目标进一步分配",
    "优化增量排名",
    "工程目标，非实测",
    "第一轮现状",
    "参数依据与参考初值",
    "机制指标分解与剩余缺口",
    "来源索引",
  ])
    expect(html).toContain(content);
});

it("turns loss budgets into recovery and saving requirements without inventing FIT reductions", () => {
  const plan = mechanismLossBudget(100, 1, { save: 2, downtime: 3 }, []);
  expect(plan.items.reduce((s, i) => s + i.allowedHours, 0)).toBeCloseTo(1, 12);
  const d = mechanismGapDiagnostics(
    100,
    0.99,
    { save: 2, downtime: 3 },
    { a: { recoveries: 10 } },
    plan,
    60,
    0.5,
  );
  const s = d.checkpoint.allocatedSaveSeconds!;
  expect(s / (60 + s)).toBeCloseTo(
    plan.items.find((p) => p.id === "save")!.allowedHours / 100,
    12,
  );
  expect(d.totalExcessHours).toBeCloseTo(4, 12);
  expect(d.downtimeSecondsPerObservedRecovery).toBeCloseTo(
    (plan.items.find((p) => p.id === "downtime")!.allowedHours * 3600) / 10,
    12,
  );
});

it("charges new detector overhead, keeps instantaneous detection separate from missed-SDC discovery, and rejects invalid boundaries", () => {
  const r = resolveAudit(small());
  const zero = r.events.map((e) => ({ ...e, fit: 0 }));
  const e = createEnhancedAuditEngine(zero, r.policy, {
    ...r.model,
    checkpointSaveSeconds: 0,
    validationOverhead: 0.001,
  });
  const v = e.simulate(10000, 2, 17, e.parameters({}), {});
  expect(v.usefulThroughput).toBeCloseTo(0.999, 12);
  expect(v.ledger.mechanismOverhead).toBeCloseTo(
    r.model.horizonHours * 0.001,
    12,
  );
  for (const parameterTargets of [
    { sdcCoverage: 1.1 },
    { detectSeconds: -1 },
    { latentHours: 0 },
    { unknown: 1 },
  ] as Array<Record<string, number>>)
    expect(() =>
      resolveAudit({
        ...small(),
        optimization: { enabled: true, parameterTargets },
      }),
    ).toThrow();
  expect(() =>
    resolveAudit({
      ...small(),
      optimization: { enabled: true, checkpointPeriods: { "123": 60 } },
    }),
  ).toThrow();
  const input = {
    ...small(),
    optimization: {
      enabled: true,
      autoTune: false,
      policy: { "D-SDC": { detectSeconds: 0.5 } },
    },
  };
  expect(resolveAudit(input).model.sdcDelayHours).toBe(120);
});

it("replays a frozen per-scale mechanism recommendation with the same physics and without mutating the first round", () => {
  const input = {
    ...small(),
    optimization: {
      ...small().optimization,
      exploreExtensions: false,
      parameterTargets: { saveSeconds: 0.01 },
      checkpointPeriods: { "500000": 60, "10000": 300 },
    },
  };
  const result = audit(input),
    recommendation = result.optimization.recommendedRequest;
  expect(result.optimization.factors.some((f: any) => f.kind === "fit")).toBe(
    false,
  );
  expect(recommendation.optimization.checkpointPeriods["500000"]).toBe(60);
  expect(recommendation.optimization.checkpointPeriods["10000"]).toBe(300);
  const replay = audit(recommendation);
  expect(replay.rows).toEqual(result.rows);
  expect(replay.optimization.scales.map((s: any) => s.optimized)).toEqual(
    result.optimization.scales.map((s: any) => s.optimized),
  );
  for (const f of result.optimization.factors.filter(
    (f: any) => f.kind === "policy" || f.kind === "model",
  ))
    expect(
      Object.keys(f.value).every((key) => Boolean(f.parameterSources[key])),
    ).toBe(true);
});

it("keeps unmet goals visible when no improving levers are authorized and preserves historical single-round requests", () => {
  const input = small();
  const r = audit({
    ...input,
    optimization: {
      enabled: true,
      autoTune: false,
      allowFitTargets: false,
      screeningTrials: 4,
      attributionTrials: 4,
      permutations: 2,
    },
  });
  expect(r.optimization.allScalesSupported).toBe(false);
  expect(r.optimization.factors).toEqual([]);
  expect(r.optimization.scales.every((s: any) => s.delta.mean === 0)).toBe(
    true,
  );
  expect(audit({ ...input, optimization: undefined }).optimization).toBeNull();
  expect(audit({ ...input, attribution: false }).optimization.status).toBe(
    "needs-attribution",
  );
});

it("registers all expert proposals, rejects missing assumptions and overlapping precision risks", () => {
  expect(auditExtensionCatalog).toHaveLength(16);
  expect(auditExtensionCatalog.every((m) => m.simulationReady === false)).toBe(
    true,
  );
  expect(() =>
    validateExtensions([
      { ...extensionScenario("H-SDC-SCREEN"), parameters: {} },
    ]),
  ).toThrow();
  const fp8 = extensionScenario("D-SDC-FP8"),
    fp4 = extensionScenario("D-SDC-FP4");
  validateExtensions([fp8, fp4]);
  fp8.parameters.eligibleShare = 0.8;
  expect(() => validateExtensions([fp8, fp4])).toThrow("互斥");
  expect(() =>
    resolveAudit({
      ...small(),
      optimization: { enabled: true, policy: { "D-SDC": { coverage: 2 } } },
    }),
  ).toThrow();
});

it("reduces only eligible residual FIT and explicitly accounts for steady overhead", () => {
  const input = small(),
    r = resolveAudit(input),
    screen = extensionScenario("H-SDC-SCREEN");
  Object.assign(screen.parameters, {
    eligibleShare: 1,
    success: 1,
    overhead: 0.1,
  });
  const engine = createEnhancedAuditEngine(r.events, r.policy, r.model, [
    screen,
  ]);
  expect(engine.events.find((e: any) => e.id === "CORE-sdc").fit).toBeCloseTo(
    r.events.find((e) => e.id === "CORE-sdc")!.fit * 0.75,
    12,
  );
  expect(engine.events.find((e: any) => e.id === "CORE-hard").fit).toBe(
    r.events.find((e) => e.id === "CORE-hard")!.fit,
  );
  const noFault = createEnhancedAuditEngine(
    r.events.map((e) => ({ ...e, fit: 0 })),
    r.policy,
    { ...r.model, checkpointSaveSeconds: 0 },
    [screen],
  );
  const result = noFault.simulate(500000, 2, 7, noFault.parameters({}), {});
  expect(result.usefulThroughput).toBeCloseTo(0.9, 12);
  expect(result.ledger.mechanismOverhead).toBeCloseTo(input.hours * 0.1, 12);
});

it("does not double count graph preparation inside runtime startup and charges failed local attempts", () => {
  const r = resolveAudit(small());
  const events = r.events.map((e) => ({
    ...e,
    fit: e.id === "CORE-hard" ? 3000 : 0,
  }));
  const model = {
    ...r.model,
    detectSeconds: 0,
    timeoutSeconds: 0,
    recoverySuccess: 1,
  };
  const snapshot = extensionScenario("R-RUNTIME-SNAPSHOT"),
    graph = extensionScenario("R-CANN-GRAPH");
  for (const m of [snapshot, graph])
    Object.assign(m.parameters, { eligibleShare: 1, success: 1 });
  const a = createEnhancedAuditEngine(events, r.policy, model, [snapshot]);
  const b = createEnhancedAuditEngine(events, r.policy, model, [
    snapshot,
    graph,
  ]);
  for (const seed of [1, 17, 253])
    expect(
      b.simulate(500000, 2, seed, b.parameters({}), {}).usefulThroughput,
    ).toBeCloseTo(
      a.simulate(500000, 2, seed, a.parameters({}), {}).usefulThroughput,
      12,
    );
  const network = events.map((e) => ({
    ...e,
    fit: e.id === "NIC-hard" ? 3000 : 0,
  }));
  const link = extensionScenario("R-LINK-LOCAL");
  Object.assign(link.parameters, {
    eligibleShare: 1,
    success: 0,
    failureSeconds: 600,
  });
  const base = createEnhancedAuditEngine(network, r.policy, model),
    failed = createEnhancedAuditEngine(network, r.policy, model, [link]);
  expect(
    failed.simulate(500000, 2, 1, failed.parameters({}), {}).ledger.downtime,
  ).toBeGreaterThan(
    base.simulate(500000, 2, 1, base.parameters({}), {}).ledger.downtime,
  );
});

it("conserves time with all 16 extensions including asynchronous durability and fallback", () => {
  const r = resolveAudit(small()),
    extensions = auditExtensionCatalog.map((m) => extensionScenario(m.id));
  const engine = createEnhancedAuditEngine(
    r.events,
    r.policy,
    r.model,
    extensions,
  );
  const opts = Object.fromEntries(
    getAuditDefaults().mechanisms.map((id) => [id, true]),
  );
  for (const seed of [1, 17, 253]) {
    const v = engine.simulate(500000, 2, seed, engine.parameters(opts), opts);
    expect(
      v.correctHours +
        Object.values(v.ledger).reduce((s: number, x: any) => s + x, 0),
    ).toBeCloseTo(24, 8);
    expect(v.correctHours).toBeGreaterThanOrEqual(0);
  }
});

it("credits HCCL communication rebuild only on local elastic recovery, not global recovery", () => {
  const r = resolveAudit(small());
  const events = r.events.map((e) => ({
    ...e,
    fit: e.id === "CORE-hard" ? 3000 : 0,
  }));
  const hccl = extensionScenario("R-HCCL-ELASTIC");
  Object.assign(hccl.parameters, { eligibleShare: 1, success: 1 });
  const base = createEnhancedAuditEngine(events, r.policy, r.model);
  const improved = createEnhancedAuditEngine(events, r.policy, r.model, [hccl]);
  for (const seed of [1, 17, 253]) {
    const global = base.simulate(500000, 2, seed, base.parameters({}), {});
    const globalWith = improved.simulate(
      500000,
      2,
      seed,
      improved.parameters({}),
      {},
    );
    expect(globalWith.usefulThroughput).toBeCloseTo(
      global.usefulThroughput,
      12,
    );
  }
});

it("invalidates only the relevant confirmation when a second-round parameter changes", () => {
  const input = small(),
    design = (value: any) => ({
      scenario: "training",
      activeAssessment: "audit",
      assessment: { valid: true, input: value },
    });
  expect(
    changedAuditStage(
      design(input),
      design({
        ...input,
        optimization: {
          ...input.optimization,
          extensions: [extensionScenario("C-ASYNC")],
        },
      }),
    ),
  ).toBe(3);
  expect(
    changedAuditStage(
      design(input),
      design({
        ...input,
        optimization: { ...input.optimization, allowFitTargets: false },
      }),
    ),
  ).toBe(2);
  expect(
    changedAuditStage(
      design(input),
      design({
        ...input,
        optimization: { ...input.optimization, permutations: 4 },
      }),
    ),
  ).toBe(4);
});

import { expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  audit,
  getAuditDefaults,
  resolveAudit,
} from "../../packages/analysis/src/audit";
import { checkpointReference } from "../../packages/analysis/src/audit-design";
import { auditSummary } from "../../packages/reports/src/audit-summary";
const createEngine = createRequire(import.meta.url)(
  "../../packages/solvers/src/vendor/review-engine.cjs",
);
const small = () => ({
  ...getAuditDefaults(),
  cards: 10000,
  target: 0.99,
  optimization: undefined,
  lossBudgetMethod: "equal" as const,
  samplingProfile: undefined,
  sensitivityMode: "expert-reference" as const,
  sensitivityTrials: 4,
  sensitivityCards: undefined,
  attributionSeed: undefined,
  sensitivitySeed: undefined,
  scales: [10000],
  targets: undefined,
  hours: 24,
  trials: 8,
  attributionTrials: 8,
  verificationTrials: 8,
  sensitivity: false,
  mechanisms: ["process", "replay"],
});
it("uses scale-specific targets and conserves the loss budget against the simulated ledger", () => {
  const r = audit({
    ...small(),
    scales: [10000, 100000],
    targets: { 10000: 0.99, 100000: 0.943 },
  });
  for (const scale of r.designReview.scales) {
    expect(
      scale.items.reduce((a: number, x: any) => a + x.allowedHours, 0),
    ).toBeCloseTo(scale.allowedHours, 10);
    expect(
      scale.items.reduce((a: number, x: any) => a + x.actualHours, 0),
    ).toBeCloseTo(scale.actualLossHours, 8);
    expect(auditSummary(r, scale.cards).target).toBe(scale.target);
  }
  expect(
    r.rows.find((x) => x.cards === 100000 && x.id === "combined").target,
  ).toBe(0.943);
  expect(() =>
    resolveAudit({ ...small(), lossBudgetWeights: { downtime: 1 } }),
  ).toThrow("预算");
  expect(() => resolveAudit({ ...small(), targets: { 10000: 0.1 } })).toThrow(
    "目标",
  );
  expect(() => resolveAudit({ ...small(), targets: { 100000: 0.9 } })).toThrow(
    "规模",
  );
});
it("verifies a fixed chosen combination on a disjoint set of seeds", () => {
  const request = small(),
    r = audit(request),
    v = r.recommendation.verification;
  expect(r.recommendation.candidateCount).toBe(4);
  expect(v.trials).toBe(8);
  const resolved = resolveAudit(request),
    engine = createEngine(resolved.events, resolved.policy, resolved.model),
    opts = Object.fromEntries(
      r.recommendation.chosen.mechanisms.map((id: string) => [id, true]),
    );
  const values = Array.from(
    { length: v.trials },
    (_, i) =>
      engine.simulate(
        request.cards,
        2,
        (request.seed + Math.imul(i + 1 + 1000000, 2654435761)) >>> 0,
        engine.parameters(opts),
        { ...opts, recoveryOrder: resolved.recoveryOrder },
      ).usefulThroughput,
  );
  expect(v.statistics.mean).toBeCloseTo(
    values.reduce((a, b) => a + b, 0) / values.length,
    12,
  );
  expect(
    audit({ ...request, verifyRecommendation: false }).recommendation
      .verification,
  ).toBeNull();
});
it("matches the finite-window no-fault reference and includes prior failed attempts before replay success", () => {
  const resolved = resolveAudit({
    ...small(),
    model: {
      ...getAuditDefaults().model,
      detectProbability: 0,
      timeoutSeconds: 0,
    },
  });
  const zero = createEngine(
    resolved.events.map((e) => ({ ...e, fit: 0 })),
    resolved.policy,
    resolved.model,
  );
  const clean = zero.simulate(10000, 2, 1, zero.parameters(), {});
  expect(clean.usefulThroughput).toBeCloseTo(
    checkpointReference(
      24,
      resolved.model.checkpointComputeSeconds,
      resolved.model.checkpointSaveSeconds,
    ),
    12,
  );
  const events = [
    {
      ...resolved.events.find((e) => e.type === "hard"),
      id: "synthetic",
      fit: 200000,
      replay: true,
      process: true,
    },
  ];
  const policy = {
    ...resolved.policy,
    "R-PROCESS": {
      ...resolved.policy["R-PROCESS"],
      success: 0,
      failureSeconds: 10,
    },
    "R-REPLAY": {
      ...resolved.policy["R-REPLAY"],
      success: 1,
      successSeconds: 5,
    },
  };
  const engine = createEngine(events, policy, {
    ...resolved.model,
    horizonHours: 1,
  });
  const opts = {
    process: true,
    replay: true,
    recoveryOrder: ["process", "replay", "elastic"],
  };
  let observed = false;
  for (let seed = 1; seed <= 100; seed++) {
    const r = engine.simulate(10000, 2, seed, engine.parameters(opts), opts);
    if (r.counts.hard === 1 && r.ledger.downtime > 0.004) {
      expect(r.ledger.downtime * 3600).toBeCloseTo(15, 8);
      observed = true;
      break;
    }
  }
  expect(observed).toBe(true);
});

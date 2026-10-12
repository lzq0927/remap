import { expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
  resolveAudit,
} from "../../packages/analysis/src/audit";
import { auditReferenceComparison } from "../../packages/analysis/src/audit-reference";
import { auditSamplingPreset } from "../../packages/contracts/src/audit-presets";
import {
  auditDraftInput,
  draftFromAuditRequest,
} from "../../packages/contracts/src/audit-draft";
import {
  auditScaleSummary,
  auditSummary,
} from "../../packages/reports/src/audit-summary";
import { report } from "../../packages/reports/src/render";
const original = createRequire(import.meta.url)(
  "../../references/expert-review-2026-10-09/analyze.cjs",
);
it("rejects a custom Shapley seed that reuses the independent verification trajectories", () => {
  const request = getAuditDefaults();
  const overlap = (request.seed + Math.imul(1000000, 2654435761)) >>> 0;
  expect(() => resolveAudit({ ...request, attributionSeed: overlap })).toThrow(
    "overlap",
  );
  expect(() =>
    resolveAudit({
      ...request,
      attributionSeed: overlap,
      verifyRecommendation: false,
    }),
  ).not.toThrow();
});

it("accepts the complete expert workload and identifies modifications from frozen inputs", () => {
  const request = getAuditDefaults(),
    resolved = resolveAudit(request);
  expect(resolved.sampleRuns).toBe(766000);
  expect(resolved.expectedEvents).toBeLessThan(450000000);
  expect(auditReferenceComparison(request, resolved).matchesReference).toBe(
    true,
  );
  const modified = {
    ...request,
    policy: {
      ...request.policy,
      "D-SDC": { coverage: 0.99, detectSeconds: 1 },
    },
  };
  expect(
    auditReferenceComparison(modified, resolveAudit(modified)).differences,
  ).toContain("机制参数已修改");
  const low = { ...request, trials: 8 };
  expect(auditReferenceComparison(low, resolveAudit(low)).label).toContain(
    "低采样",
  );
  expect(() => resolveAudit({ ...request, sensitivitySeed: -1 })).toThrow(
    "sensitivitySeed",
  );
  expect(() => resolveAudit({ ...request, sensitivityTrials: 9000 })).toThrow(
    "sensitivityTrials",
  );
});

it("adds the 1000-card reference without creating a fifth requirement and preserves legacy draft scope", () => {
  const request = getAuditDefaults();
  const draft = draftFromAuditRequest(request);
  expect(auditDraftInput(draft).scales).toEqual([
    10000, 1000, 100000, 200000, 500000,
  ]);
  expect(auditDraftInput(draft).targets).toEqual(request.targets);
  const legacy = { ...request, samplingProfile: undefined };
  expect(auditDraftInput(draftFromAuditRequest(legacy)).scales).toEqual([
    10000, 100000, 200000, 500000,
  ]);
  const quick = {
    ...request,
    ...auditSamplingPreset("quick"),
    target: 0.973,
    mechanisms: ["elastic"],
    eventOverrides: [],
  };
  const input = auditDraftInput(draftFromAuditRequest(quick));
  expect(input.target).toBe(0.973);
  expect(input.mechanisms).toEqual(["elastic"]);
});

it("matches original independent Shapley and sensitivity seeds, uses scan-count controls and excludes reference-only attribution", () => {
  const request = {
    ...getAuditDefaults(),
    trials: 4,
    attributionTrials: 4,
    sensitivityTrials: 4,
    verifyRecommendation: false,
  };
  const progress: number[] = [];
  const r = audit(request, (done, total) => progress.push(done / total));
  expect(progress.at(-1)).toBe(1);
  expect(progress.every((p, i) => p >= (progress[i - 1] ?? 0))).toBe(true);
  expect(r.attribution.map((a) => a.cards)).toEqual([
    10000, 100000, 200000, 500000,
  ]);
  expect(r.sensitivity).toHaveLength(13);
  for (const a of r.attribution) {
    const expectedBase = original.sample(a.cards, {}, 4, null, 77334411);
    const expectedCombined = original.sample(
      a.cards,
      Object.fromEntries(request.mechanisms.map((id) => [id, true])),
      4,
      null,
      77334411,
    );
    expect(a.coalitions[0].statistics.mean).toBeCloseTo(expectedBase.mean, 11);
    expect(a.gain).toBeCloseTo(expectedCombined.mean - expectedBase.mean, 11);
  }
  for (const row of r.sensitivity) {
    const opts =
      row.scenarioId === "elastic"
        ? { elastic: true, elasticSyncSeconds: row.value }
        : { sdcDetect: true, step: true, [row.parameter]: row.value };
    const expected = original.sample(500000, opts, 4, null, 988133);
    expect(row.statistics.mean).toBeCloseTo(expected.mean, 11);
    expect((row.statistics.ciHigh - row.statistics.ciLow) / 2).toBeCloseTo(
      expected.ci95,
      9,
    );
    if (row.value === row.currentValue) expect(row.delta.mean).toBe(0);
  }
  expect(auditSummary(r, 1000).referenceOnly).toBe(true);
  expect(auditScaleSummary(r).total).toBe(4);
  expect(r.designReview.scales).toHaveLength(4);
}, 30000);

it("preserves granular reference evidence and separates it from current calibration in HTML and Markdown", () => {
  const reference = getAuditEvents().find((e) => e.id === "CORE-hard")!;
  expect(reference.legacyEvidence).toBe("芯片内细分假设；非白皮书器件FIT");
  const request = {
    ...getAuditDefaults(),
    ...auditSamplingPreset("quick"),
    hours: 2,
    trials: 4,
    sensitivityTrials: 4,
    attribution: false,
    verifyRecommendation: false,
    eventOverrides: [
      {
        id: "CORE-hard",
        fit: 420,
        source: "<script>unsafe</script>",
        evidence: "internal-measured" as const,
        rateBasis: "npu-equivalent-hour",
        note: "synthetic calibration",
      },
    ],
  };
  const result = audit(request);
  expect(resolveAudit(request).model.referenceRateArithmetic).toBe(false);
  const event = result.events.find((e) => e.id === "CORE-hard")!;
  expect(event.evidence).toBe("internal-measured");
  expect(event.legacyEvidence).toBe(reference.legacyEvidence);
  const run: any = {
    id: "fixture",
    status: "succeeded",
    operation: "audit",
    input: request,
    result,
    createdAt: "2026-10-12",
    events: [],
  };
  for (const format of ["html", "md"]) {
    const content = report(run, format);
    expect(content).toContain("芯片内细分假设；非白皮书器件FIT");
    expect(content).toContain("本次校准说明");
    expect(content).toContain("低采样结果");
    expect(content).toContain("D-SDC");
    expect(content).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    if (format === "html")
      expect(content).not.toContain("<script>unsafe</script>");
  }
});

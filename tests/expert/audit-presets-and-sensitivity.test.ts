import { expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
  resolveAudit,
} from "../../packages/analysis/src/audit";
import {
  auditScalePresets,
  auditDefaultTargets,
  changeAuditCards,
} from "../../packages/contracts/src/audit-presets";
import { report } from "../../packages/reports/src/render";
const original = createRequire(import.meta.url)(
  "../../references/expert-review-2026-10-09/engine.cjs",
);
const small = () => ({
  ...getAuditDefaults(),
  eventCatalogVersion: "expert-2026-10-09" as const,
  optimization: undefined,
  samplingProfile: undefined,
  scales: auditScalePresets.map((p) => p.cards),
  sensitivityMode: "expert-reference" as const,
  sensitivityTrials: 4,
  sensitivityCards: undefined,
  attributionSeed: undefined,
  sensitivitySeed: undefined,
  verificationTrials: 8,
  hours: 24,
  trials: 4,
  attribution: false,
  verifyRecommendation: false,
});

it("defaults to four explicit effective-output targets and the reference interruption MTBF without fitting event rates", () => {
  const request = small(),
    r = audit(request);
  expect(request.targets).toEqual(auditDefaultTargets);
  for (const preset of auditScalePresets) {
    const row = r.rows.find(
      (row) => row.cards === preset.cards && row.id === "combined",
    );
    expect(row.target).toBe(preset.target);
    const hardFit = r.events
      .filter((e) => e.type === "hard")
      .reduce((n, e) => n + e.fit, 0);
    expect(1e9 / (preset.cards * hardFit)).toBeCloseTo(
      preset.hardMtbfHours,
      10,
    );
    expect(
      r.designReview.scales.find((s) => s.cards === preset.cards)!.allowedHours,
    ).toBeCloseTo((1 - preset.target) * 24, 10);
  }
  expect(
    r.reviewChecks.every(
      (c) => c.status === "passed" || c.status === "not-run",
    ),
  ).toBe(true);
  const updated = audit({
    ...request,
    eventOverrides: [
      {
        id: "CORE-hard",
        fit: 1000,
        source: "synthetic calibration",
        evidence: "internal-measured",
        rateBasis: "npu-equivalent-hour",
      },
    ],
  });
  expect(updated.request.targets).toEqual(request.targets);
  expect(
    updated.events.filter((e) => e.type !== "hard").map((e) => e.fit),
  ).toEqual(
    getAuditEvents("expert-2026-10-09")
      .filter((e) => e.type !== "hard")
      .map((e) => e.fit),
  );
  const html = report(
    {
      id: "fixture",
      status: "succeeded",
      operation: "audit",
      result: r,
      input: request,
      createdAt: "2026-10-12",
      events: [],
    } as any,
    "html",
  );
  for (const text of [
    "中断 MTBF",
    "98.5%",
    "窗口时间账守恒",
    "0–100%",
    "弹性全局协调暂停",
    "step 回滚上限",
  ])
    expect(html).toContain(text);
});

it("preserves individually edited targets across scale changes", () => {
  const start = { ...getAuditDefaults(), cards: 10000, target: 0.973 };
  const large = changeAuditCards(start, 500000);
  expect(large.target).toBe(0.985);
  const edited = { ...large, target: 0.82 };
  const restored = changeAuditCards(edited, 10000);
  expect(restored.target).toBe(0.973);
  expect(changeAuditCards(restored, 500000).target).toBe(0.82);
});

it("matches the original engine for the expert's isolated coverage, elastic and step scans and conserves their time accounts", () => {
  const request = {
    ...small(),
    sensitivityTrials: 4,
    cards: 500000,
    target: 0.8,
    scales: [500000],
    targets: { 500000: 0.8 },
  };
  const resolved = resolveAudit(request),
    r = audit(request);
  expect(r.sensitivity).toHaveLength(16);
  for (const row of r.sensitivity) {
    const opts =
      row.scenarioId === "elastic"
        ? { elastic: true, elasticSyncSeconds: row.value }
        : {
            sdcDetect: true,
            step: true,
            ...(row.parameter === "sdcDelayHours"
              ? {}
              : { [row.parameter]: row.value }),
          };
    const p = {
      ...original.parameters(opts),
      horizonHours: request.hours,
      ...(row.parameter === "sdcDelayHours"
        ? { sdcDelayHours: row.value }
        : {}),
    };
    const values = Array.from(
      { length: request.trials },
      (_, i) =>
        original.simulate(
          request.cards,
          2,
          (request.seed + Math.imul(i + 1, 2654435761)) >>> 0,
          p,
          opts,
        ).usefulThroughput,
    );
    expect(row.statistics.mean).toBeCloseTo(
      values.reduce((a, b) => a + b, 0) / values.length,
      11,
    );
    expect(
      Object.values(row.ledger).reduce((n: number, v: any) => n + v, 0) +
        row.statistics.mean * request.hours,
    ).toBeCloseTo(request.hours, 8);
    expect(row.currentValue).toBe(
      row.parameter === "sdcCoverage"
        ? resolved.policy["D-SDC"].coverage
        : row.parameter === "elasticSyncSeconds"
          ? resolved.policy["R-ELASTIC"].syncSeconds
          : row.parameter === "stepSeconds"
            ? resolved.policy["R-SDC"].stepSeconds
            : resolved.model.sdcDelayHours,
    );
    if (row.parameter === "sdcCoverage" && row.value === 1)
      expect(row.ledger.terminalInvalid).toBe(0);
  }
});

it("replays legacy five-point scans and gates selected-combination scans by enabled mechanisms", () => {
  const legacy = audit({
    ...small(),
    sensitivityMode: undefined,
    cards: 10000,
    scales: [10000],
    targets: undefined,
  });
  expect(legacy.sensitivity).toHaveLength(5);
  expect(legacy.sensitivity.every((s) => s.scenarioId === "combined")).toBe(
    true,
  );
  const selected = audit({
    ...small(),
    sensitivityMode: "selected-combination",
    mechanisms: ["elastic"],
  });
  expect(selected.sensitivity.map((s) => s.parameter)).toEqual(
    Array(4).fill("elasticSyncSeconds"),
  );
  expect(selected.sensitivity.every((s) => s.scenarioId === "combined")).toBe(
    true,
  );
});

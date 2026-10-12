import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
  resolveAudit,
} from "../../packages/analysis/src/audit";
import { report } from "../../packages/reports/src/render";
import manifest from "../../references/expert-review-2026-10-09/manifest.json";
import referenceResults from "../../references/expert-review-2026-10-09/results.json";
const require = createRequire(import.meta.url);
const original = require("../../references/expert-review-2026-10-09/engine.cjs");
const createEngine = require("../../packages/solvers/src/vendor/review-engine.cjs");
const small = () => ({
  ...getAuditDefaults(),
  scales: [10000],
  targets: undefined,
  hours: 24,
  trials: 8,
  attribution: false,
  sensitivity: false,
});
it("pins the requested review sources separately from strict-clean-end V4", () => {
  for (const file of manifest.files)
    expect(
      createHash("sha256")
        .update(
          readFileSync(
            new URL(
              "../../references/expert-review-2026-10-09/" + file.path,
              import.meta.url,
            ),
          ),
        )
        .digest("hex"),
    ).toBe(file.sha256);
  const req = small(),
    resolved = resolveAudit(req),
    engine = createEngine(resolved.events, resolved.policy, resolved.model);
  for (const cards of [10000, 500000])
    for (const seed of [1, 17, 9876])
      for (const opts of [
        {},
        { step: true },
        {
          sdcDetect: true,
          step: true,
          replay: true,
          process: true,
          elastic: true,
          fast: true,
        },
      ]) {
        const p = original.parameters(opts);
        p.horizonHours = req.hours;
        const reference = original.simulate(cards, 2, seed, p, opts),
          actual = engine.simulate(
            cards,
            2,
            seed,
            engine.parameters(opts),
            opts,
          );
        expect(actual.correctHours).toBeCloseTo(reference.correctHours, 9);
        for (const key of Object.keys(reference.ledger))
          expect(actual.ledger[key]).toBeCloseTo(reference.ledger[key], 9);
      }
});
it("reproduces the expert HTML data baseline at 10000 cards over 4000 trajectories", () => {
  const result = audit({
    ...getAuditDefaults(),
    trials: 4000,
    scales: [10000],
    targets: undefined,
    mechanisms: [],
    attribution: false,
    sensitivity: false,
  });
  const expected = referenceResults.results.find(
    (r) => r.cards === 10000 && r.scenario === "base",
  )!;
  const base = result.rows.find((r) => r.id === "base");
  expect(base.statistics.mean).toBeCloseTo(expected.mean, 11);
  for (const key of Object.keys(expected.ledger))
    expect(base.ledger[key]).toBeCloseTo((expected.ledger as any)[key], 8);
}, 60000);
it("updates only supplied interruption FIT and keeps external silent/slow priors", () => {
  const old = getAuditEvents(),
    req = small();
  const updated = resolveAudit({
    ...req,
    eventOverrides: [
      {
        id: "CORE-hard",
        fit: 10,
        rateBasis: "npu-equivalent-hour",
        source: "synthetic internal fixture",
        evidence: "internal-measured",
      },
    ],
  });
  expect(updated.events.find((e) => e.id === "CORE-hard")!.fit).toBe(10);
  expect(updated.events.filter((e) => e.type !== "hard")).toEqual(
    old.filter((e) => e.type !== "hard"),
  );
  const allZero = old.map((e) => ({
    id: e.id,
    fit: 0,
    rateBasis: "npu-equivalent-hour",
    source: "synthetic zero-rate limit",
    evidence: "scenario" as const,
  }));
  const r = audit({ ...req, eventOverrides: allZero }),
    base = r.rows.find((x) => x.id === "base");
  expect(base.ledger.downtime).toBe(0);
  expect(base.ledger.rollback).toBe(0);
  expect(base.statistics.mean).toBeCloseTo(
    1 - (Math.floor((req.hours * 3600) / 304) * 4) / (req.hours * 3600),
    10,
  );
  expect(r.events.every((e) => e.mtbfHours === null)).toBe(true);
});
it("preserves step dependence, accounting and Shapley efficiency", () => {
  const r = audit({
    ...small(),
    cards: 500000,
    scales: [500000],
    hours: 720,
    trials: 16,
    attribution: true,
    attributionTrials: 16,
    mechanisms: ["sdcDetect", "step", "fast"],
  });
  const base = r.rows.find((x) => x.id === "base"),
    step = r.rows.find((x) => x.id === "step");
  expect(step.statistics.mean).toBe(base.statistics.mean);
  for (const row of r.rows) {
    expect(
      Object.values(row.ledger).reduce((s: number, v: any) => s + v, 0) +
        row.statistics.mean * 720,
    ).toBeCloseTo(720, 7);
    for (const key of [
      "downtime",
      "rollback",
      "slowdown",
      "terminalInvalid",
      "localLoss",
    ])
      expect(
        Object.values(row.perEvent).reduce(
          (s: number, v: any) => s + (v[key] ?? 0),
          0,
        ),
      ).toBeCloseTo(row.ledger[key], 7);
  }
  expect(r.attribution[0].residual).toBeCloseTo(0, 12);
  expect(r.attribution[0].coalitions).toHaveLength(8);
  expect(
    r.attribution[0].contributions.find((c: any) => c.id === "step").statistics
      .mean,
  ).toBeGreaterThan(0);
});
it("makes physical recovery order an explicit model input independent of Shapley", () => {
  const req = {
    ...small(),
    cards: 500000,
    scales: [500000],
    mechanisms: ["replay", "process", "elastic"],
  };
  const first = audit(req),
    second = audit({ ...req, recoveryOrder: ["process", "elastic", "replay"] });
  expect(first.rows.find((r) => r.id === "combined").statistics.mean).not.toBe(
    second.rows.find((r) => r.id === "combined").statistics.mean,
  );
  expect(first.config.inputHash).not.toBe(second.config.inputHash);
  expect(() =>
    resolveAudit({ ...req, recoveryOrder: ["replay", "replay", "process"] }),
  ).toThrow(/permutation/);
});
it("rejects ambiguous rate units, missing provenance and excessive work", () => {
  const req = small(),
    patch = {
      id: "CORE-hard",
      fit: 5,
      rateBasis: "device-hour",
      source: "synthetic",
      evidence: "scenario" as const,
    };
  expect(() => resolveAudit({ ...req, eventOverrides: [patch] })).toThrow(
    /equivalent/,
  );
  expect(() =>
    resolveAudit({
      ...req,
      eventOverrides: [
        { ...patch, rateBasis: "npu-equivalent-hour", source: "" },
      ],
    }),
  ).toThrow(/source/);
  expect(() => resolveAudit({ ...req, model: { unknown: 1 } })).toThrow(
    /Unsupported/,
  );
  expect(() =>
    resolveAudit({
      ...getAuditDefaults(),
      cards: 1000000,
      scales: [1000000],
      targets: undefined,
      trials: 8192,
    }),
  ).toThrow(/budget/);
});
it("exports complete event/mechanism tables with safe HTML and actual sensitivity", () => {
  const req = {
    ...small(),
    sensitivity: true,
    eventOverrides: [
      {
        id: "CORE-hard",
        fit: 10,
        rateBasis: "npu-equivalent-hour",
        source: "<img src=x onerror=alert(1)>",
        evidence: "scenario" as const,
      },
    ],
  };
  const r = audit(req),
    run: any = {
      id: "audit",
      status: "succeeded",
      operation: "audit",
      input: req,
      inputHash: "fixture",
      result: r,
      createdAt: "2026-10-11",
      events: [],
    };
  expect(r.sensitivity).toHaveLength(16);
  const html = report(run, "html");
  expect(html).toContain("可靠性设计与评估报告 · 专家审核口径");
  expect(html).toContain("training.retained-clean-progress");
  for (const text of [
    "独立故障事件库",
    "失败回退",
    "CORE-hard",
    "类内占比",
    "全系统静默即时检出率",
    "Availability",
    "ARINC",
    "AGREE",
    "Shapley",
    "最后干净检查点",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  expect(html).toContain('aria-label="报告目录"');
  expect(html).toContain('class="event-source" id="event-source-0"');
  expect(html).toContain("<dt>来源</dt><dd>&lt;img");
  expect(html).toContain('class="source-link"');
  expect(html).toContain('aria-label="静默检出率对正确产出的影响"');
  const markdown = report(run, "md");
  expect(markdown).toContain("### 数据来源与归因说明");
  expect(markdown).toContain("来源：&lt;img");
  expect(markdown).toContain("#### CORE-hard");
});

import { expect, it } from "vitest";
import { auditContributionView } from "../src/audit-contributions";
import { auditContributionChart, auditGainChart } from "../src/audit-charts";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
} from "../../analysis/src/audit";
import { report } from "../src/report";
const stats = (mean: number, width = 0.005) => ({
  mean,
  ciLow: mean - width,
  ciHigh: mean + width,
});
const fixture = () => ({
  request: {
    cards: 10000,
    hours: 24,
    trials: 32,
    seed: 11,
    attributionSeed: 22,
    mechanisms: ["a", "b"],
  },
  rows: [
    {
      id: "base",
      name: "基线",
      cards: 10000,
      statistics: stats(0.82),
      delta: stats(0),
    },
    {
      id: "combined",
      name: "组合",
      cards: 10000,
      statistics: stats(0.96),
      delta: stats(0.14),
    },
    ...["a", "b", "extra"].map((id) => ({
      id,
      name: id,
      cards: 10000,
      statistics: stats(0.85),
      delta: stats(0.03),
    })),
  ],
  attribution: [
    {
      cards: 10000,
      trials: 16,
      gain: 0.1,
      residual: 0,
      contributions: [
        { id: "b", name: "negative <script>", statistics: stats(-0.02, 0.03) },
        { id: "a", name: "a", statistics: stats(0.12) },
      ],
      coalitions: [
        { mask: 0, factors: [], statistics: stats(0.8) },
        { mask: 3, factors: ["a", "b"], statistics: stats(0.9) },
      ],
      interactions: [],
      conditionalStep: stats(0),
      nonAdditivity: -0.01,
    },
  ],
});
it("uses same-batch Shapley totals, keeps immutable descending rows and folds audit evidence separately", () => {
  const r = fixture(),
    snapshot = JSON.stringify(r),
    v = auditContributionView(r, 10000);
  expect(v.baselineMean).toBe(0.8);
  expect(v.combinedMean).toBe(0.9);
  expect(v.gain).toBe(0.1);
  expect(v.mainGain).toBe(0.14);
  expect(v.rows.map((x: any) => x.id)).toEqual(["a", "b"]);
  expect(v.rows[1].hours).toBe(-0.48);
  expect(v.residual).toBeCloseTo(0, 12);
  expect(v.scope.exploratory).toContain("extra");
  expect(v.mainTrials).toBe(32);
  expect(v.trials).toBe(16);
  expect(v.mainSeed).toBe(11);
  expect(v.seed).toBe(22);
  expect(JSON.stringify(r)).toBe(snapshot);
});
it("draws true negative contributions and intervals around a visible zero line, in table order", () => {
  const html = auditContributionChart(fixture(), 10000);
  expect(html.indexOf('data-contribution="a"')).toBeLessThan(
    html.indexOf('data-contribution="b"'),
  );
  expect(html).toContain('data-mean="-0.02"');
  expect(html).toContain("-2 pp");
  const zero = Number(
    html.match(/<line x1="([\d.]+)"[^>]+class="chart-zero"/)?.[1],
  );
  const bar = html.match(
    /data-contribution="b"[\s\S]+?<rect x="([\d.]+)"[^>]+width="([\d.]+)"/,
  );
  expect(Number(bar?.[1])).toBeLessThan(zero);
  expect(Number(bar?.[1]) + Number(bar?.[2])).toBeCloseTo(zero, 8);
  expect(html).toContain("平均边际贡献为负");
  expect(html).toContain("区间跨零");
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(auditGainChart(fixture())).toContain("单项与组合方案收益对照");
});
it("labels conditions without assuming unrecorded historical batch baselines or a monthly window", () => {
  const r: any = fixture();
  r.baseline = {
    active: true,
    mechanisms: ["fixed"],
    resolvedEvents: [{ id: "fault", originalFit: 8 }],
  };
  expect(auditContributionView(r, 10000).title).toContain("条件 Shapley");
  expect(auditContributionView(r, 10000).scope.fixed).toEqual(["fixed"]);
  delete r.attribution[0].coalitions;
  expect(auditContributionView(r, 10000).baselineMean).toBeNull();
  expect(auditContributionView(r, 10000).windowLabel).not.toContain("月");
  r.request.hours = 720;
  expect(auditContributionView(r, 10000).windowLabel).toContain("月");
  r.attribution = [];
  expect(auditContributionView(r, 10000).rows).toEqual([]);
  expect(auditContributionChart(r, 10000)).toBe("");
});
it("does not draw or invent an interval when a historical contribution has only a mean", () => {
  const r: any = fixture();
  for (const c of r.attribution[0].contributions) {
    delete c.statistics.ciLow;
    delete c.statistics.ciHigh;
  }
  const html = auditContributionChart(r);
  expect(html).not.toContain("NaN");
  expect(html).toContain("历史未记录");
  expect(html).not.toContain('stroke-width="1.4"');
});
it.each(["resolved", "fixed", "multiple", "empty", "disabled", "historical"])(
  "shares frozen %s results across HTML, Markdown and JSON",
  (scenario) => {
    const mechanisms = ["sdcDetect", "step", "elastic", "fast"];
    const resolvedEventIds = getAuditEvents()
      .filter((e) => e.type === "sdc")
      .map((e) => e.id);
    const input = {
      ...getAuditDefaults(),
      cards: 10000,
      target: 0.99,
      optimization: undefined,
      scales: [10000],
      targets: undefined,
      hours: 24,
      trials: 8,
      attributionTrials: 8,
      sensitivity: false,
      verifyRecommendation: false,
      mechanisms,
      attribution: scenario !== "disabled",
      baseline:
        scenario === "resolved"
          ? { resolvedEventIds }
          : scenario === "fixed"
            ? { mechanisms: ["sdcDetect"] }
            : scenario === "multiple"
              ? { resolvedEventIds, mechanisms: ["elastic"] }
              : scenario === "empty"
                ? { mechanisms }
                : undefined,
    };
    const result: any = audit(input);
    if (scenario === "historical") {
      delete result.rankings;
      delete result.baseline;
      delete result.referenceComparison;
      delete result.attribution[0].coalitions;
    }
    const run: any = {
      id: "presentation-public-fixture",
      operation: "audit",
      status: "succeeded",
      input,
      result,
      inputHash: "fixture",
      progress: 1,
      createdAt: "2026-10-13",
      events: [],
    };
    const before = JSON.stringify(result),
      html = report(run, "html"),
      md = report(run, "md"),
      json = JSON.parse(report(run, "json"));
    expect(JSON.stringify(result)).toBe(before);
    expect(json.result).toEqual(result);
    expect(html).toContain("06 / 组合贡献分摊");
    expect(md).toContain("06 / 组合贡献分摊");
    expect(md).toContain("<details>\n<summary>计算依据与详细审核");
    expect(html).not.toContain("单项与组合收益排名");
    const view = auditContributionView(result);
    if (["empty", "disabled"].includes(scenario)) {
      expect(view.rows).toHaveLength(0);
      expect(html).toContain(view.unavailable);
    } else {
      expect(html).toContain('data-contribution="fast"');
      expect(md).toContain("新增正确计算小时");
      expect(Math.abs(view.residual!)).toBeLessThan(1e-10);
      expect(
        view.rows.every((row: any) => !view.scope.fixed.includes(row.id)),
      ).toBe(true);
    }
    if (scenario === "historical") {
      expect(view.baselineMean).toBeNull();
      expect(html).toContain("历史未记录");
    }
    if (input.baseline)
      expect(result.referenceComparison.matchesReference).toBe(false);
  },
);

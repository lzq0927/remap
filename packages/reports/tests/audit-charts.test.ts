import { expect, it } from "vitest";
import {
  auditGainChart,
  auditScaleCurve,
  auditSensitivityCurves,
} from "../src/audit-charts";

const stats = (mean: number, width = 0.01) => ({
  mean,
  ciLow: mean - width,
  ciHigh: mean + width,
});
const fixture = () => ({
  request: { cards: 10000, target: 0.99, trials: 32 },
  config: {
    model: { sdcDelayHours: 120 },
    policy: { "D-SDC": { coverage: 0.97 } },
  },
  rows: [
    {
      id: "base",
      name: "确认基线",
      cards: 500000,
      statistics: stats(0.4),
      delta: stats(0),
    },
    {
      id: "combined",
      name: "所选组合",
      cards: 10000,
      statistics: stats(0.92),
      delta: stats(0.1),
    },
    {
      id: "base",
      name: "确认基线",
      cards: 10000,
      statistics: stats(0.82),
      delta: stats(0),
    },
    {
      id: "combined",
      name: "所选组合",
      cards: 500000,
      statistics: stats(0.72),
      delta: stats(0.32),
    },
    {
      id: "fast",
      name: "<img src=x onerror=alert(1)>",
      cards: 10000,
      statistics: stats(0.8),
      delta: stats(-0.02),
    },
  ],
  sensitivity: [
    { parameter: "sdcCoverage", value: 0.999, statistics: stats(0.94) },
    { parameter: "sdcCoverage", value: 0.95, statistics: stats(0.9) },
    { parameter: "sdcDelayHours", value: 6, statistics: stats(0.95) },
    { parameter: "sdcDelayHours", value: 24, statistics: stats(0.93) },
  ],
});

it("plots only frozen scale points in ascending log-axis order and does not alter results", () => {
  const r = fixture(),
    snapshot = JSON.stringify(r);
  const html = auditScaleCurve(r);
  expect(html).toContain('data-value="10000" data-mean="0.82"');
  expect(html).toContain('data-value="500000" data-mean="0.4"');
  expect(html).not.toContain('data-value="100000"');
  expect(html).toContain("曲线数值");
  expect(html).toContain("82%");
  expect(html).toContain("40%");
  expect(html.indexOf('data-value="10000"')).toBeLessThan(
    html.indexOf('data-value="500000"'),
  );
  r.rows = r.rows.filter((row) => row.cards === 10000);
  const single = auditScaleCurve(r);
  expect(single).toContain("本次只计算了一个规模");
  expect(single).not.toContain("<polyline");
  r.rows = fixture().rows;
  expect(JSON.stringify(r)).toBe(snapshot);
});

it("uses the current policy and model point in each sensitivity curve instead of assuming reference defaults", () => {
  const html = auditSensitivityCurves(fixture());
  expect(html).toContain('data-value="0.97" data-mean="0.92"');
  expect(html).toContain('data-value="120" data-mean="0.92"');
  expect(html).toContain('data-value="6" data-mean="0.95"');
  expect(html).toContain("空心点为当前输入 97%");
  expect(html).toContain("纵轴局部缩放");
  expect(html).toContain("目标 99%");
  expect(html).not.toContain("NaN");
  expect(auditSensitivityCurves({ ...fixture(), sensitivity: [] })).toBe("");
});

it("keeps negative gains on the left of zero with the same scale and escapes SVG labels", () => {
  const html = auditGainChart(fixture());
  const zero = Number(
    html.match(/<line x1="([\d.]+)"[^>]+class="chart-zero"/)?.[1],
  );
  const negative = html.match(
    /data-scenario="fast"[\s\S]+?<rect x="([\d.]+)"[^>]+width="([\d.]+)"/,
  );
  expect(zero).toBeGreaterThan(0);
  expect(Number(negative?.[1])).toBeLessThan(zero);
  expect(Number(negative?.[1]) + Number(negative?.[2])).toBeCloseTo(zero, 8);
  expect(html).toContain("-2 pp");
  expect(html).toContain("95% 配对区间 -3 ～ -1 pp");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
});
it("uses the isolated expert scenario as the current point and keeps the overall target out of its parameter scan", () => {
  const r: any = fixture();
  r.rows.push({
    id: "sdcStep",
    name: "静默检测＋step 恢复",
    cards: 10000,
    statistics: stats(0.89),
    delta: stats(0.07),
  });
  r.sensitivity = r.sensitivity.map((s: any) => ({
    ...s,
    scenarioId: "sdcStep",
  }));
  const html = auditSensitivityCurves(r);
  expect(html).toContain('data-value="0.97" data-mean="0.89"');
  expect(html).not.toContain("目标 99%");
  expect(html).toContain("静默检测＋step 恢复");
});

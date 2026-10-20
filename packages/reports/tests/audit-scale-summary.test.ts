import { expect, it } from "vitest";
import { audit, getAuditDefaults } from "../../analysis/src/audit";
import { auditSummaryScales } from "../../contracts/src/audit-presets";
import {
  architectureTrend,
  architectureTargetBreakdown,
  faultModeGapRows,
  faultModeGapSummary,
  lossTimeSegments,
  lossTimeDistribution,
  contributionRankSummary,
} from "../src/audit-scale-summary";
import { auditSections } from "../src/audit";
const sample = () =>
  audit({
    ...getAuditDefaults(),
    hours: 24,
    trials: 8,
    attributionTrials: 4,
    verificationTrials: 4,
    sensitivity: false,
  });
it("orders requirement summaries ascending and keeps reference points separate without changing the frozen run", () => {
  const result = sample(),
    before = JSON.stringify(result),
    d = result.architectureDiagnosis;
  expect(
    auditSummaryScales(
      result.request,
      [500000, 1000, 10000, 200000, 100000, 10000],
    ),
  ).toEqual([10000, 100000, 200000, 500000, 1000]);
  const html = architectureTargetBreakdown(d);
  const headers = [...html.matchAll(/<th>(\d+(?:\.\d+)?万卡)<\/th>/g)].map(
    (m) => m[1],
  );
  expect(headers).toEqual(["1万卡", "10万卡", "20万卡", "50万卡"]);
  expect(html).toContain("故障数据不完整；已知损失仅作参照");
  expect(architectureTargetBreakdown(d, "hardware-board")).toContain("待补充");
  const trend = architectureTrend(d);
  expect(trend.includes('data-value="1000"')).toBe(false);
  expect(trend.includes("各规模可用度目标与现状趋势")).toBe(true);
  const scope = auditSections(result).find(
    (s) => s.title === "01 / 确认口径与数据证据",
  )!;
  expect(scope.tables![0].rows.map((row) => String(row[0]))).toEqual([
    "10,000",
    "100,000",
    "200,000",
    "500,000",
    "1,000",
  ]);
  expect(JSON.stringify(result)).toBe(before);
});
it("conserves loss hours for stage, subsystem and fault-type stacked bars", () => {
  const d = sample().architectureDiagnosis;
  for (const mode of ["loss", "layer", "type"] as const) {
    const rows = lossTimeSegments(d, mode);
    expect(rows.map((r) => r.cards)).toEqual([10000, 100000, 200000, 500000]);
    for (const row of rows)
      expect(row.segments.reduce((s, v) => s + v.hours, 0)).toBeCloseTo(
        row.totalHours,
        9,
      );
    const html = lossTimeDistribution(d, mode);
    expect(html.includes('data-loss-cards="1000"')).toBe(false);
    expect(html.includes("物理修复MTTR")).toBe(true);
  }
});
it("keeps event budgets traceable to their leaf and ranks the actual scale-specific deficits", () => {
  const d = sample().architectureDiagnosis;
  for (const scale of faultModeGapRows(d)) {
    for (const leaf of d.scales
      .find((s) => s.cards === scale.cards)!
      .nodes.filter((n) => n.leaf && n.kind !== "overhead")) {
      expect(
        scale.rows
          .filter((r) => r.layerId === leaf.id)
          .reduce((s, r) => s + (r.allowedHours ?? 0), 0),
      ).toBeCloseTo(leaf.allowedHours!, 9);
    }
    const gaps = scale.rows.map((r) => r.excessHours!);
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
    expect(
      scale.rows.filter((r) => r.type !== "unknown").map((r) => r.rank),
    ).toEqual(
      scale.rows.filter((r) => r.type !== "unknown").map((_, i) => i + 1),
    );
    for (const row of scale.rows.filter((r) => r.type === "unknown")) {
      expect(row.rank).toBe(0);
      expect(row.excessHours).toBeNull();
    }
  }
  const html = faultModeGapSummary(d);
  expect(html.includes("仅作诊断参照")).toBe(true);
  expect(html.includes("data-rank=")).toBe(true);
});
it("compares ranks together, preserves negative contributions, shows ties and does not invent missing evidence", () => {
  const d = sample().architectureDiagnosis;
  d.scales = d.scales.filter((s) => [10000, 500000].includes(s.cards));
  const make = (id: string, mean: number) => ({
    id,
    name: id,
    statistics: { mean, ciLow: mean - 0.01, ciHigh: mean + 0.01 },
  });
  d.scales.find((s) => s.cards === 10000)!.ranking = [
    make("checkpoints", -0.01),
    make("detection", 0.1),
  ] as any;
  d.scales.find((s) => s.cards === 500000)!.ranking = [
    make("checkpoints", 0.2),
    make("detection", 0.2),
  ] as any;
  const html = contributionRankSummary(d);
  expect(
    html.includes(
      'data-rank-id="checkpoints" data-cards="10000" data-rank="2" data-contribution="-0.01"',
    ),
  ).toBe(true);
  expect(
    html.includes(
      'data-rank-id="checkpoints" data-cards="500000" data-rank="1"',
    ),
  ).toBe(true);
  expect(
    html.includes('data-rank-id="detection" data-cards="500000" data-rank="1"'),
  ).toBe(true);
  expect(html.includes("贡献值趋势与95%区间")).toBe(true);
});
it("uses loss budgets rather than inventing per-layer availability and handles a zero-loss historical run", () => {
  const d = sample().architectureDiagnosis;
  const legacy: any = structuredClone(d);
  delete legacy.hours;
  const node = d.architecture.nodes.find(
    (n) => n.parentId && n.kind !== "overhead",
  )!;
  for (const scale of legacy.scales) {
    scale.statistics.mean = 1;
    scale.actualHours = 0;
  }
  const html = architectureTrend(legacy, node.id);
  expect(html.includes("不是模块自身可用度")).toBe(true);
  expect(html.includes("NaN")).toBe(false);
  expect(html.includes("Infinity")).toBe(false);
  const target =
    d.scales
      .find((s) => s.cards === 10000)!
      .nodes.find((n) => n.id === node.id)!.allowedHours! / d.hours;
  expect(html.includes(`data-value="10000" data-mean="${target}"`)).toBe(true);
});

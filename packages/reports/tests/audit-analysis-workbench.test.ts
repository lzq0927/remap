import { beforeAll, expect, test } from "vitest";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
} from "../../analysis/src/audit";
import {
  applyTrainingScenario,
  trainingScenarioPreset,
} from "../../contracts/src/audit-training-scenario";
import { compareAuditExperiments } from "../src/audit-experiments";
import {
  legacyExposureNotice,
  stageLossComparison,
  analysisContext,
  analysisWorkbenchHtml,
  domainLossSources,
  sourceEvents,
  resourceAccounting,
  analysisNodeDetail,
} from "../src/audit-analysis-workbench";
let comparison: any;
beforeAll(() => {
  const events = getAuditEvents();
  const runs = (["current", "extension", "breakthrough"] as const).map(
    (id, i) => {
      const input = applyTrainingScenario(
        {
          ...getAuditDefaults(),
          cards: 500000,
          scales: [10000, 500000],
          targets: { 10000: 0.985, 500000: 0.985 },
          trials: 2,
          attributionTrials: 2,
          verificationTrials: 2,
          sensitivity: false,
          verifyRecommendation: false,
          optimization: { enabled: false },
        },
        {
          ...trainingScenarioPreset(id),
          checkpointSeconds: id === "current" ? 600 : 1,
          sdcCoverage: id === "current" ? 0.8 : 0.9991,
          mtbfEventIds: events
            .filter((e) => e.type === "hard")
            .map((e) => e.id),
          investigationMapping: "sdc-only",
          assumptionsConfirmed: true,
        },
        events,
      );
      return {
        id: "analysis-" + i,
        status: "succeeded",
        inputHash: "fixture" + i,
        createdAt: "2026-10-27",
        result: audit(input),
      } as any;
    },
  );
  comparison = compareAuditExperiments(runs);
});
test("default analysis selects the frozen baseline; views preserve all snapshots and budgets", () => {
  const before = structuredClone(comparison),
    ctx = analysisContext(comparison, 500000)!;
  expect(ctx.stage.name).toBe("现状");
  expect(analysisContext(comparison, 500000, "突破性改进")!.baseline.name).toBe(
    "现状",
  );
  for (const view of [
    "overview",
    "architecture",
    "loss",
    "verification",
    "scales",
    "research",
  ] as const)
    expect(analysisWorkbenchHtml(comparison, 500000, view)).not.toMatch(
      /NaN|Infinity/,
    );
  const html = analysisWorkbenchHtml(comparison, 500000);
  for (const text of [
    "子系统现状与分解目标",
    "全类等效FIT",
    "MTBF",
    "等效MTTR",
    "损失来源",
    "损失 → 具体可靠性措施",
    "DP副本级恢复",
    "有限备用",
    "持久化滞后",
    "模式复杂度C",
  ])
    expect(html).toContain(text);
  expect(comparison).toEqual(before);
});
test("horizontal source bars partition the original ledger without counting parent nodes twice", () => {
  for (const cards of [10000, 500000]) {
    const { d, scale } = analysisContext(comparison, cards)!;
    for (const stage of scale.scenarios) {
      const root = stage.nodes.find((n) => n.id === "system")!,
        overhead = stage.nodes.find((n) => n.id === "overhead")!;
      expect(
        domainLossSources(stage).reduce((v, r) => v + r.hours, 0),
      ).toBeCloseTo(root.actualHours, 8);
      expect(
        sourceEvents(d, cards, stage.name).reduce((v, e) => v + e.hours, 0) +
          overhead.actualHours,
      ).toBeCloseTo(root.actualHours, 8);
    }
  }
});
test("resource cost keeps reserve and active denominators distinct, including zero production", () => {
  const r = resourceAccounting(32768);
  expect(r.activeDomains).toBe(512);
  expect(r.deployedDomains).toBe(523);
  expect(r.deployedCards).toBe(37656);
  expect(r.extraCards).toBe(4888);
  expect(r.reserveShare).toBeCloseTo(4888 / 37656, 12);
  expect(r.extraRelativeToActive).toBeCloseTo(0.149169921875, 12);
  expect(r.deployedNormalizedOutput).toBeCloseTo((0.985 * 32768) / 37656, 12);
  expect(r.effectiveGpuHours).toBeCloseTo(32768 * 600 * 0.985, 8);
  expect(resourceAccounting(32768, 64, 72, 0.02, 0).costFactor).toBeNull();
  expect(() => resourceAccounting(32768, 72, 64)).toThrow();
});
test("component provenance escapes untrusted source text and lists only the selected subtree", () => {
  const r = structuredClone(comparison),
    ctx = analysisContext(r, 500000)!;
  const e = ctx.d.estimates.find(
    (e) =>
      e.cards === 500000 &&
      e.scenario === ctx.stage.name &&
      e.nodeId === "object-CORE",
  )!;
  e.source = "<script>unsafe()</script>";
  const html = analysisNodeDetail(ctx.stage, ctx.d, 500000, "object-CORE");
  expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
  expect(html).not.toContain("<script>unsafe");
  expect(html).not.toContain("OPT-hard");
});

test("three horizontal scenario groups preserve every loss cell and system conservation", () => {
  const { d, scale } = analysisContext(comparison, 500000)!;
  const html = stageLossComparison(d, 500000);
  expect(html.match(/scope="colgroup"/g)).toHaveLength(3);
  expect(html.indexOf("现状")).toBeLessThan(html.indexOf("延长线"));
  expect(html.indexOf("延长线")).toBeLessThan(html.indexOf("突破"));
  const keys = [
    ["downtime"],
    ["rollback"],
    ["slowdown", "localLoss"],
    ["terminalInvalid"],
    ["save"],
    ["mechanismOverhead"],
  ];
  for (const id of [
    "domain-1",
    "hardware-network",
    "hardware-storage",
    "hardware-facility",
    "hardware-other",
    "overhead",
    "system",
  ]) {
    const row = html.split(`data-loss-domain="${id}"`)[1].split("</tr>")[0];
    const values = [...row.matchAll(/data-loss-hours="([^"]+)"/g)].map((m) =>
      Number(m[1]),
    );
    const expected = scale.scenarios.flatMap((s) => {
      const n = s.nodes.find((n) => n.id === id)!;
      return keys.map((ks) => ks.reduce((v, k) => v + (n.loss as any)[k], 0));
    });
    expect(values).toEqual(expected);
    expect(row.match(/class="analysis-stage-gap"/g)).toHaveLength(2);
    for (let i = 0; i < 3; i++)
      expect(
        values.slice(i * 6, i * 6 + 6).reduce((a, b) => a + b, 0),
      ).toBeCloseTo(
        scale.scenarios[i].nodes.find((n) => n.id === id)!.actualHours,
        9,
      );
  }
});

test("historical exposure-only results retain their data but visibly require recomputation", () => {
  const old = {
    request: {
      architecture: { nodes: [{ exposure: { multipliers: { 500000: 2 } } }] },
    },
    rows: [{ cards: 500000 }],
  };
  expect(legacyExposureNotice(old)).toContain("旧达标结论暂不采用");
  expect(legacyExposureNotice({ ...old, rows: [{ cards: 10000 }] })).toBe("");
  expect(
    legacyExposureNotice({
      ...old,
      rows: [{ cards: 500000, scaleEvents: [{ id: "CORE-hard", fit: 200 }] }],
    }),
  ).toBe("");
});

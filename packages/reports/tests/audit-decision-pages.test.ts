import { expect, test } from "vitest";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
} from "../../analysis/src/audit";
import {
  applyTrainingScenario,
  trainingScenarioPreset,
  trainingRecoveryBudget,
} from "../../contracts/src/audit-training-scenario";
import { hardwareScaleEvents } from "../../contracts/src/audit-hardware";
import {
  decisionPageSvg,
  decisionDomains,
  lossHours,
  lossFill,
} from "../src/audit-decision-pages";

test("generation exposure changes only selected rates once, preserves inventory and reference MTBF", () => {
  const request = getAuditDefaults(),
    events = getAuditEvents(),
    scope = ["CORE-hard", "CPU-hard"];
  const s = {
    ...trainingScenarioPreset("current"),
    mtbfEventIds: scope,
    exposureByScale: { 10000: 1, 100000: 2, 200000: 2, 500000: 2 },
    checkpointSeconds: 600,
    sdcCoverage: 0.8,
    investigationMapping: "sdc-only" as const,
    assumptionsConfirmed: true,
  };
  const before = structuredClone(request),
    r = applyTrainingScenario(request, s, events);
  const updated = events.map((e) => ({
    ...e,
    fit: r.eventOverrides?.find((v) => v.id === e.id)?.fit ?? e.fit,
  }));
  const scaled = hardwareScaleEvents(updated, r.architecture, 500000);
  expect(
    1e9 /
      500000 /
      scaled.filter((e) => scope.includes(e.id)).reduce((v, e) => v + e.fit, 0),
  ).toBeCloseTo(0.3, 10);
  expect(scaled.find((e) => e.id === "OPT-hard")?.fit).toBe(
    events.find((e) => e.id === "OPT-hard")?.fit,
  );
  expect(trainingRecoveryBudget(s, 500000, 0.985).target.mtbfHours).toBe(0.3);
  expect(request).toEqual(before);
  expect(r.architecture!.nodes.map((n) => n.inventory)).toEqual(
    request.architecture.nodes.map((n) => n.inventory),
  );
});
test("compact loss views conserve the ledger, share a scale, escape labels and never mutate snapshots", () => {
  const r = audit({
    ...getAuditDefaults(),
    trials: 2,
    attributionTrials: 2,
    verificationTrials: 2,
    scales: [10000],
    cards: 10000,
    targets: {},
    hours: 8,
    sensitivity: false,
    verifyRecommendation: false,
    optimization: { enabled: false },
  });
  const before = structuredClone(r),
    d = r.topologyDecision!;
  for (const scale of d.scales)
    for (const stage of scale.scenarios) {
      const sum = decisionDomains.reduce(
        (total, [id]) =>
          total +
          Array.from({ length: 6 }, (_, i) =>
            lossHours(stage.nodes.find((n) => n.id === id)!, i),
          ).reduce((a, b) => a + b, 0),
        0,
      );
      expect(sum).toBeCloseTo(
        stage.nodes.find((n) => n.id === "system")!.actualHours,
        8,
      );
    }
  expect(lossFill(1, 600)).toBe(lossFill(1, 600));
  const colors = [0, 1 / 60, 1, 100, 600].map((v) => lossFill(v, 600));
  expect(new Set(colors).size).toBe(5);
  for (const view of ["architecture", "loss", "scales"] as const) {
    const svg = decisionPageSvg(r, 10000, view);
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain('height="1080"');
  }
  expect(decisionPageSvg(r, 10000, "loss")).toContain("M1");
  expect(r).toEqual(before);
});

import { expect, it } from "vitest";
import {
  applyTrainingScenario,
  trainingScenarioPreset,
  trainingScenarioIssues,
} from "../../contracts/src/audit-training-scenario";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
  resolveAudit,
} from "../../analysis/src/audit";
import { compareAuditExperiments } from "../src/audit-experiments";
import { layerDecisionSvg } from "../src/audit-layer-decision";
import { report } from "../src/render";
import { hardwareScaleEvents } from "../../contracts/src/audit-hardware";
const events = getAuditEvents();
const ready = (id: "current" | "extension" | "breakthrough") => ({
  ...trainingScenarioPreset(id),
  checkpointSeconds: id === "current" ? 600 : 1,
  sdcCoverage: id === "current" ? 0.8 : id === "extension" ? 0.95 : 0.995,
  mtbfEventIds: events.filter((e) => e.type === "hard").map((e) => e.id),
  investigationMapping: "sdc-only" as const,
  assumptionsConfirmed: true,
});
const initial = () => ({
  ...getAuditDefaults(),
  trials: 2,
  attributionTrials: 2,
  verificationTrials: 2,
  verifyRecommendation: false,
  scales: [500000],
  targets: { 500000: 0.985 },
  sensitivity: false,
  optimization: { enabled: false },
});
it("calibrates the selected reference-scale rate without multiplying inventory twice", () => {
  const input = initial(),
    node = input.architecture.nodes.find((n) =>
      n.eventIds.includes("CORE-hard"),
    )!;
  node.rateModel = {
    referenceCards: 10000,
    referenceCount: 10000,
    source: "数量模型测试",
  };
  node.inventory = {
    totals: { 10000: 10000, 500000: 1000000 },
    source: "500k规模双倍数量测试",
  };
  const s = { ...ready("extension"), mtbfEventIds: ["CORE-hard"] };
  const compiled = applyTrainingScenario(input, s, events);
  const original = events.find((e) => e.id === "CORE-hard")!;
  const stored = compiled.eventOverrides!.find((e) => e.id === "CORE-hard")!;
  const scaled = hardwareScaleEvents(
    [{ ...original, fit: stored.fit }],
    input.architecture,
    500000,
  )[0];
  expect(scaled.fit).toBeCloseTo(stored.fit * 2, 10);
  expect(1e9 / 500000 / scaled.fit).toBeCloseTo(17 / 60, 10);
});
it("requires explicit step, 99.x, event scope and investigation interpretation", () => {
  const s = trainingScenarioPreset("breakthrough");
  expect(trainingScenarioIssues(s, events)).toHaveLength(5);
  expect(() => applyTrainingScenario(initial(), s, events)).toThrow(/step/);
  expect(() =>
    resolveAudit({ ...initial(), trainingScenario: s, hours: 600 }),
  ).toThrow(/step/);
});
it("converts reference-scale MTBF once, preserves slow/SDC and counts detection/recovery separately", () => {
  const input = initial(),
    before = structuredClone(input);
  for (const id of ["current", "extension", "breakthrough"] as const) {
    const s = ready(id),
      r = applyTrainingScenario(input, s, events),
      resolved = resolveAudit(r);
    const hardFit = r.eventOverrides!.reduce((v, e) => v + e.fit, 0);
    expect(1e9 / hardFit / s.referenceCards).toBeCloseTo(s.mtbfHours, 10);
    expect(r.model!.detectSeconds + r.model!.recoveryAttemptSeconds).toBe(
      id === "current" ? 190 : 60,
    );
    expect(r.model!.manualAdditionalSeconds).toBe(s.manualRecoveryHours * 3600);
    expect(r.model!.sdcDelayHours).toBe(s.investigationHours);
    expect(r.hours).toBe(600);
    expect(
      resolved.events
        .filter((e) => e.type !== "hard")
        .map((e) => [e.id, e.fit]),
    ).toEqual(
      resolveAudit(input)
        .events.filter((e) => e.type !== "hard")
        .map((e) => [e.id, e.fit]),
    );
  }
  expect(input).toEqual(before);
});
it("compares independent scenarios without fitting reference percentages or moving baseline budgets", () => {
  const runs = ["current", "extension", "breakthrough"].map((id, i) => {
    const input = applyTrainingScenario(initial(), ready(id as any), events);
    return {
      id: "scenario-" + i,
      status: "succeeded",
      inputHash: "hash" + i,
      createdAt: "2026-10-26",
      result: audit(input),
    } as any;
  });
  const before = structuredClone(runs),
    comparison = compareAuditExperiments(runs);
  expect(comparison.comparisonMode).toBe("training-scenarios");
  expect(comparison.entries.map((e) => e.name)).toEqual([
    "现状",
    "延长线改进",
    "突破性改进",
  ]);
  expect(comparison.entries[2].rows[0].statistics.mean).not.toBe(0.985);
  for (const entry of comparison.entries) {
    expect(
      entry.architectureDiagnosis.scales[0].nodes.map(
        (n: any) => n.allowedHours,
      ),
    ).toEqual(
      runs[0].result.architectureDiagnosis.scales[0].nodes.map(
        (n: any) => n.allowedHours,
      ),
    );
    expect(entry.architectureDiagnosis.scales[0].actualHours).toBeCloseTo(
      (1 - entry.rows[0].statistics.mean) * 600,
      8,
    );
  }
  const svg = layerDecisionSvg(comparison, 500000);
  expect(svg).toContain("现状");
  expect(svg).toContain("延长线改进");
  expect(svg).toContain("突破性改进");
  expect(svg).toContain("正贡献投影");
  expect(svg).not.toMatch(/NaN|Infinity/);
  const html = report({ ...runs[0], result: comparison }, "html");
  expect(html).toContain("相对各自固定基线");
  expect(html).toContain("model.manualAdditionalSeconds");
  expect(html).toContain("CORE-hard FIT");
  expect(runs).toEqual(before);
  const incompatible = structuredClone(runs);
  incompatible[1].result.request.target = 0.99;
  expect(() => compareAuditExperiments(incompatible)).toThrow(/相同600小时/);
  const generic = structuredClone(runs);
  generic[1].result.request.trainingScenario = undefined;
  expect(() => compareAuditExperiments(generic)).toThrow(/同一次/);
  expect(() => compareAuditExperiments([runs[0], runs[0]])).toThrow(/不同/);
});

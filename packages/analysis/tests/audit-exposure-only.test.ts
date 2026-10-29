import { expect, test } from "vitest";
import { audit, getAuditDefaults, getAuditEvents } from "../src/audit";
import { defaultAuditArchitecture } from "../../contracts/src/audit-architecture";
import {
  hardwareAuditArchitecture,
  hardwareScaleEvents,
} from "../../contracts/src/audit-hardware";
import { experimentSampler } from "../src/audit-experiments";

test("exposure-only architecture drives the solver, its Shapley coalitions and saved rates exactly once", () => {
  const events = getAuditEvents(),
    architecture = hardwareAuditArchitecture(events);
  architecture.nodes.find((n) => n.id === "object-CORE")!.exposure = {
    multipliers: { 10000: 1, 500000: 2 },
    eventIds: ["CORE-hard"],
    source: "Regression: generation exposure without inventory rateModel",
  };
  expect(architecture.nodes.some((n) => n.rateModel)).toBe(false);
  const input = {
    ...getAuditDefaults(),
    architecture,
    scales: [10000, 500000],
    targets: { 10000: 0.985, 500000: 0.985 },
    hours: 24,
    trials: 8,
    attributionTrials: 4,
    verificationTrials: 4,
    sensitivity: false,
    verifyRecommendation: false,
    mechanisms: ["hardDetect", "fast"],
    optimization: { enabled: false },
  };
  const result = audit(input);
  for (const cards of input.scales) {
    const scaled = hardwareScaleEvents(events, architecture, cards);
    const directInput = {
      ...input,
      cards,
      scales: [cards],
      targets: { [cards]: 0.985 },
      architecture: defaultAuditArchitecture(events),
      eventOverrides: scaled
        .filter((e) => e.id === "CORE-hard")
        .map((e) => ({
          id: e.id,
          fit: e.fit,
          source: "Explicit per-scale reference",
          evidence: "scenario" as const,
          rateBasis: "npu-equivalent-hour",
        })),
    };
    const direct = audit(directInput);
    expect(
      result.rows
        .filter((r) => r.cards === cards)
        .map(({ scaleEvents: _e, ...row }) => row),
    ).toEqual(direct.rows);
    expect(result.attribution.find((r) => r.cards === cards)).toEqual(
      direct.attribution[0],
    );
    const row = result.rows.find(
      (r) => r.cards === cards && r.id === "combined",
    )!;
    expect(row.scaleEvents.find((e: any) => e.id === "CORE-hard").fit).toBe(
      scaled.find((e) => e.id === "CORE-hard")!.fit,
    );
    const source = {
      id: "exposure-source",
      inputHash: "test",
      createdAt: "2026-10-29",
      input,
      result,
    };
    const directSource = { ...source, input: directInput, result: direct };
    const seeds = [123, 456, 789, 1011];
    expect(experimentSampler(source)(cards, [], seeds).values).toEqual(
      experimentSampler(directSource)(cards, [], seeds).values,
    );
  }
  expect(events.find((e) => e.id === "CORE-hard")!.fit).toBe(
    getAuditEvents().find((e) => e.id === "CORE-hard")!.fit,
  );
});

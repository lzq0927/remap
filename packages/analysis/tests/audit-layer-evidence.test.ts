import { expect, it } from "vitest";
import { layerEvidenceAllocation } from "../src/audit-layer-allocation";
import { audit, getAuditDefaults, getAuditEvents } from "../src/audit";
import { architectureBudgets } from "../src/audit-architecture";
import { auditExperiment } from "../src/audit-experiments";
import { defaultAuditArchitecture } from "../../contracts/src/audit-architecture";

const events = getAuditEvents().filter((e) =>
  ["CORE-hard", "SRAM-hard"].includes(e.id),
);
function fixture() {
  const a = defaultAuditArchitecture(events);
  a.nodes = a.nodes
    .filter((n) => n.kind === "system" || n.kind === "object")
    .map((n) => (n.kind === "object" ? { ...n, parentId: "system" } : n));
  return a;
}
const row = {
  ledger: { save: 0 },
  perEvent: { "CORE-hard": { downtime: 40 }, "SRAM-hard": { downtime: 2 } },
};
it("allocates unequal budgets from risk, conserves each parent and is independent of order", () => {
  const a = fixture();
  const r = layerEvidenceAllocation(a, events, row, [], [], 600, 9, 500000);
  const core = r.budgets.get("object-CORE")!,
    sram = r.budgets.get("object-SRAM")!;
  expect(core).toBeLessThan(sram!);
  expect(core! + sram!).toBeCloseTo(9, 10);
  expect(r.evidence.get("object-CORE")!.importance).toBe(1);
  expect(r.evidence.get("object-SRAM")!.importance).toBeLessThan(1);
  const reversed = layerEvidenceAllocation(
    { ...a, nodes: [...a.nodes].reverse() },
    [...events].reverse(),
    row,
    [],
    [],
    600,
    9,
    500000,
  );
  for (const [id, value] of r.budgets)
    expect(reversed.budgets.get(id)).toBeCloseTo(value!, 10);
  const preview = architectureBudgets(a, 500000, 600, 9);
  expect(preview.get("system")).toBe(9);
  expect(preview.get("object-CORE")).toBeNull();
});
it("uses only applicable positive contributions and keeps high actual loss important", () => {
  const a = fixture();
  const r = layerEvidenceAllocation(
    a,
    events,
    row,
    [{ id: "sramOnly", eventIds: ["SRAM-hard"], overhead: false }],
    [
      { id: "sramOnly", statistics: { mean: 0.1 } },
      { id: "notApplicable", statistics: { mean: 100 } },
    ],
    600,
    9,
    500000,
  );
  expect(r.evidence.get("object-CORE")!.projectedGain).toBe(0);
  expect(r.evidence.get("object-SRAM")!.projectedGain).toBeCloseTo(0.1);
  expect(r.evidence.get("object-CORE")!.importance).toBe(1);
  expect(r.evidence.get("object-SRAM")!.importance).toBe(1);
  const negative = layerEvidenceAllocation(
    a,
    events,
    row,
    [{ id: "sramOnly", eventIds: ["SRAM-hard"], overhead: false }],
    [{ id: "sramOnly", statistics: { mean: -0.1 } }],
    600,
    9,
    500000,
  );
  expect(negative.evidence.get("object-SRAM")!.projectedGain).toBe(0);
});
it("keeps unknown objects pending and exposes infeasibility without fabricating equal budgets", () => {
  const a = fixture();
  a.nodes.push({
    ...a.nodes.find((n) => n.id === "object-CORE")!,
    id: "unknown",
    name: "未知",
    eventIds: [],
  });
  const r = layerEvidenceAllocation(a, events, row, [], [], 600, 9, 500000);
  expect(r.budgets.get("unknown")).toBeNull();
  a.nodes.find((n) => n.id === "object-CORE")!.importance = 0.000001;
  const impossible = layerEvidenceAllocation(
    a,
    events,
    row,
    [],
    [],
    600,
    9,
    500000,
  );
  expect(impossible.issues).toHaveLength(1);
  expect(impossible.budgets.get("object-CORE")).toBeNull();
});
it("freezes first-round budgets for independent improvement while preserving actual solver results", () => {
  const input = {
    ...getAuditDefaults(),
    hours: 24,
    scales: [10000, 500000],
    targets: { 10000: 0.9997, 500000: 0.985 },
    trials: 4,
    attributionTrials: 2,
    verifyRecommendation: false,
    sensitivity: false,
    optimization: { enabled: false },
  };
  const result = audit(input),
    frozen = structuredClone(result);
  const source = {
    id: "baseline",
    createdAt: "2026-10-26",
    inputHash: "hash",
    input,
    result,
  };
  const improved = auditExperiment({
    source,
    name: "独立覆盖率改善",
    configuration: {
      enabled: true,
      autoTune: false,
      policy: {
        "D-SDC": { ...result.config.policy["D-SDC"], coverage: 0.995 },
      },
      trials: 4,
      attributionTrials: 2,
    },
  } as any);
  for (const s of improved.architectureDiagnosis.scales) {
    expect(s.allocationFrozen).toBe(true);
    expect(s.nodes.map((n) => n.allowedHours)).toEqual(
      result.architectureDiagnosis.scales
        .find((x) => x.cards === s.cards)!
        .nodes.map((n) => n.allowedHours),
    );
  }
  expect(result).toEqual(frozen);
  const without = audit({
    ...input,
    architecture: { ...input.architecture, budgetMethod: "equal" },
  });
  expect(without.rows).toEqual(result.rows);
  expect(without.attribution).toEqual(result.attribution);
});

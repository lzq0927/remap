import { expect, it } from "vitest";
import { audit, getAuditDefaults, getAuditEvents } from "../src/audit";
import { topologyDecision } from "../src/audit-topology-decision";
import { architectureResponsibilities } from "../src/audit-architecture";
import {
  applyTrainingScenario,
  trainingScenarioPreset,
} from "../../contracts/src/audit-training-scenario";
import { compareAuditExperiments } from "../../reports/src/audit-experiments";
import {
  topologyDecisionSvg,
  topologyEstimateDetails,
} from "../../reports/src/audit-topology-decision";

const events = getAuditEvents();
const fixture = (id: "current" | "extension" | "breakthrough") => {
  const request = {
    ...getAuditDefaults(),
    scales: [10000, 100000, 200000, 500000],
    hours: 600,
    trials: 2,
    attributionTrials: 2,
    sensitivity: false,
    verifyRecommendation: false,
    optimization: { enabled: false },
  };
  return audit(
    applyTrainingScenario(
      request,
      {
        ...trainingScenarioPreset(id),
        checkpointSeconds: id === "current" ? 600 : 1,
        sdcCoverage: id === "current" ? 0.8 : id === "extension" ? 0.95 : 0.995,
        mtbfEventIds: events.filter((e) => e.type === "hard").map((e) => e.id),
        investigationMapping: "sdc-only",
        assumptionsConfirmed: true,
      },
      events,
    ),
  );
};
it("partitions every source event, ledger and nested budget conservatively, including new network estimates", () => {
  const r = fixture("current"),
    before = structuredClone(r),
    d = r.topologyDecision!;
  expect(d.scales.map((s) => s.cards)).toEqual([10000, 100000, 200000, 500000]);
  expect(d.allocationIssues).toEqual([]);
  for (const scale of d.scales) {
    expect(scale.target).toBe(0.985);
    const nodes = scale.scenarios[0].nodes,
      root = nodes.find((n) => n.id === "system")!;
    expect(root.allowedHours).toBeCloseTo(9, 10);
    expect(scale.scenarios[0].residual).toBeCloseTo(0, 8);
    for (const e of r.events) {
      const parts = d.estimates.filter(
        (p) => p.cards === scale.cards && p.eventId === e.id,
      );
      expect(parts.reduce((s, p) => s + p.fraction, 0)).toBeCloseTo(1, 12);
      expect(parts.reduce((s, p) => s + p.fit, 0)).toBeCloseTo(e.fit, 8);
    }
    for (const n of nodes) {
      const children = nodes.filter((c) => c.parentId === n.id);
      if (children.length) {
        expect(children.reduce((s, c) => s + c.actualHours, 0)).toBeCloseTo(
          n.actualHours,
          8,
        );
        expect(
          children.reduce((s, c) => s + (c.allowedHours ?? 0), 0),
        ).toBeCloseTo(n.allowedHours!, 8);
        expect(children.reduce((s, c) => s + c.fit, 0)).toBeCloseTo(n.fit, 8);
      }
      if (n.mtbfHours && n.mttrSeconds !== null)
        expect(n.mtbfHours / (n.mtbfHours + n.mttrSeconds / 3600)).toBeCloseTo(
          n.availability,
          10,
        );
    }
    for (const id of [
      "hardware-l1",
      "hardware-l2",
      "hardware-leaf-extra",
      "hardware-spine-extra",
      "hardware-board-extra",
    ]) {
      const n = nodes.find((n) => n.id === id)!;
      expect(n.fit).toBeGreaterThan(0);
      expect(n.target).not.toBeNull();
      expect(n.mtbfHours).toBeGreaterThan(0);
    }
    for (const type of ["hard", "slow", "sdc"]) {
      const parts = d.estimates.filter(
        (p) =>
          p.cards === scale.cards &&
          p.eventId === "UNKNOWN-" + type &&
          p.nodeId !== "object-UNKNOWN",
      );
      expect(parts.reduce((s, p) => s + p.fraction, 0)).toBeLessThanOrEqual(
        0.25 + 1e-12,
      );
    }
  }
  expect(topologyDecision(r)).toEqual(d);
  expect(r).toEqual(before);
});

it("passes the same module budgets and losses into mechanism planning responsibilities", () => {
  const r = fixture("current"),
    cards = 500000;
  const links = architectureResponsibilities(
    r,
    r.architectureDiagnosis,
    cards,
    r.attribution.find((a) => a.cards === cards)!.contributions,
  );
  const nodes = r.topologyDecision!.scales.find((s) => s.cards === cards)!
    .scenarios[0].nodes;
  expect(links.some((l) => l.layerId === "hardware-l1")).toBe(true);
  expect(links.reduce((sum, l) => sum + l.actualHours, 0)).toBeCloseTo(
    nodes.find((n) => n.id === "system")!.actualHours,
    8,
  );
  expect(links.reduce((sum, l) => sum + (l.allowedHours ?? 0), 0)).toBeCloseTo(
    9,
    8,
  );
  for (const n of nodes.filter(
    (n) => !nodes.some((c) => c.parentId === n.id),
  )) {
    const own = links.filter((l) => l.layerId === n.id);
    expect(own.reduce((s, l) => s + (l.allowedHours ?? 0), 0)).toBeCloseTo(
      n.allowedHours!,
      8,
    );
  }
});

it("freezes current topology allocation across three independent scenarios and keeps improvement above the common target", () => {
  const runs = (["current", "extension", "breakthrough"] as const).map(
    (id, i) =>
      ({
        id: "topology-" + i,
        status: "succeeded",
        inputHash: "hash" + i,
        createdAt: "2026-10-26",
        result: fixture(id),
      }) as any,
  );
  const original = structuredClone(runs),
    comparison = compareAuditExperiments(runs),
    d = comparison.topologyDecision!;
  for (const scale of d.scales) {
    const budgets = scale.scenarios[0].nodes.map((n) => n.allowedHours);
    for (const s of scale.scenarios) {
      expect(s.nodes.map((n) => n.allowedHours)).toEqual(budgets);
      expect(s.residual).toBeCloseTo(0, 8);
    }
  }
  expect(
    d.scales[0].scenarios[2].nodes.find((n) => n.id === "system")!.availability,
  ).toBeGreaterThan(0.985);
  const svg = topologyDecisionSvg(comparison),
    details = topologyEstimateDetails(comparison, 500000);
  for (const s of [
    "损失—可靠性机制热力图",
    "参数面Leaf",
    "参数面Spine",
    "10万卡",
    "20万卡",
    "50万卡",
    "等效MTTR",
    "净减损",
    "目标等效MTTR 15.5 s",
    "目标等效MTTR 41.1 s",
  ])
    expect(svg).toContain(s);
  expect(svg).not.toMatch(/待补充|NaN|Infinity/);
  expect(details).toContain("工程估算");
  expect(details).toContain("25%");
  expect(details).toContain("FABRIC-hard");
  expect(runs).toEqual(original);
});

it("honors the selected allocation method and manual design weights in the topology view", () => {
  const original = fixture("current");
  const calculate = (
    method: "equal" | "weighted" | "agree" | "none" | "agree-evidence",
  ) => {
    const result = structuredClone(original);
    delete (result as any).topologyDecision;
    const architecture = result.architectureDiagnosis.architecture;
    architecture.budgetMethod = method;
    architecture.nodes.find((n) => n.id === "domain-1")!.weight = 3;
    architecture.nodes.find((n) => n.id === "domain-1")!.importance = 0.5;
    return topologyDecision(result)!;
  };
  const equal = calculate("equal").scales[0].scenarios[0].nodes;
  for (const n of equal.filter((n) => n.parentId === "system"))
    expect(n.allowedHours).toBeCloseTo(1.5, 9);
  const weighted = calculate("weighted").scales[0].scenarios[0].nodes;
  const compute = weighted.find((n) => n.id === "domain-1")!;
  expect(compute.allowedHours).toBeCloseTo((9 * 3) / 8, 9);
  expect(
    calculate("none")
      .scales[0].scenarios[0].nodes.filter((n) => n.parentId)
      .every((n) => n.allowedHours === null),
  ).toBe(true);
  const agree = calculate("agree");
  expect(agree.allocationIssues).toEqual([]);
  expect(
    agree.scales[0].scenarios[0].nodes.find((n) => n.id === "domain-1")!
      .importance,
  ).toBe(0.5);
  expect(
    calculate("agree-evidence").scales[0].scenarios[0].nodes.find(
      (n) => n.id === "domain-1",
    )!.importance,
  ).toBeLessThanOrEqual(0.5);
});

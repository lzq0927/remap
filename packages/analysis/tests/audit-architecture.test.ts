import { extensionScenario } from "../../contracts/src/audit-extensions";
import { describe, expect, it } from "vitest";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
  resolveAudit,
} from "../src/audit";
import {
  defaultAuditArchitecture,
  resolveAuditArchitecture,
} from "../../contracts/src/audit-architecture";
import {
  auditArchitectureDiagnosis,
  architectureResponsibilities,
} from "../src/audit-architecture";
import { auditExperiment } from "../src/audit-experiments";

const input = () => ({
  ...getAuditDefaults(),
  hours: 24,
  trials: 8,
  attributionTrials: 4,
  scales: [500000, 200000, 100000, 10000],
  sensitivity: false,
  verifyRecommendation: false,
  optimization: { enabled: false },
});
describe("architecture accounting and scale diagnostics", () => {
  it("preserves all forward results and reconciles every layer without double counting", () => {
    const request = input(),
      result = audit(request);
    const { architecture: _architecture, ...without } = request;
    const original = audit(without);
    expect(result.rows).toEqual(original.rows);
    expect(result.attribution).toEqual(original.attribution);
    const diagnosis = result.architectureDiagnosis;
    expect(diagnosis.scales).toHaveLength(4);
    for (const scale of diagnosis.scales) {
      expect(Math.abs(scale.residualHours)).toBeLessThan(1e-8);
      const leaves = scale.nodes.filter((n) => n.leaf);
      expect(leaves.reduce((s, n) => s + n.actualHours, 0)).toBeCloseTo(
        (1 - scale.statistics.mean) * request.hours,
        10,
      );
      expect(leaves.reduce((s, n) => s + (n.allowedHours ?? 0), 0)).toBeCloseTo(
        (1 - scale.target) * request.hours,
        10,
      );
      for (const parent of scale.nodes.filter((n) => !n.leaf)) {
        const children = scale.nodes.filter((n) => n.parentId === parent.id);
        expect(children.reduce((s, n) => s + n.actualHours, 0)).toBeCloseTo(
          parent.actualHours,
          10,
        );
        expect(
          children.reduce((s, n) => s + (n.allowedHours ?? 0), 0),
        ).toBeCloseTo(parent.allowedHours!, 10);
      }
      const overhead = leaves.find((n) => n.kind === "overhead")!;
      expect(overhead.eventIds).toEqual([]);
      expect(overhead.fit).toBe(0);
      expect(overhead.recoveryPauseSeconds).toBeNull();
      const core = leaves.find((n) => n.id === "object-CORE")!;
      const fit = result.events.find((e) => e.id === "CORE-hard")!.fit;
      expect(
        core.types.find((t) => t.type === "hard")!.intervalHours,
      ).toBeCloseTo(1e9 / (scale.cards * fit), 10);
      expect(scale.ranking.map((r: any) => r.rank)).toEqual(
        scale.ranking.map((_: any, i: number) => i + 1),
      );
      const links = architectureResponsibilities(
        result,
        diagnosis,
        scale.cards,
        scale.ranking,
      );
      expect(
        links
          .filter((l) => l.mechanismId === "fast")
          .every((l) => !l.lossKeys.includes("downtime")),
      ).toBe(true);
      expect(links.reduce((s, l) => s + l.actualHours, 0)).toBeCloseTo(
        scale.actualHours,
        10,
      );
      expect(links.reduce((s, l) => s + (l.allowedHours ?? 0), 0)).toBeCloseTo(
        scale.allowedHours!,
        10,
      );
    }
  });
  it("keeps unobserved recovery times empty and reference scales without invented targets", () => {
    const request = {
      ...input(),
      scales: [500000, 1000],
      targets: { 500000: 0.985 },
      attribution: false,
      trials: 2,
      hours: 0.01,
    };
    const result = audit(request);
    const reference = result.architectureDiagnosis.scales.find(
      (s) => s.cards === 1000,
    )!;
    expect(reference.allowedHours).toBeNull();
    expect(reference.nodes.every((n) => n.allowedHours === null)).toBe(true);
    expect(
      reference.nodes
        .filter((n) => n.observedEvents === 0)
        .every(
          (n) =>
            n.equivalentLossSeconds === null && n.recoveryPauseSeconds === null,
        ),
    ).toBe(true);
  });
  it("supports per-scale weights and AGREE while retaining parent budget conservation", () => {
    const result = audit(input());
    const rootChildren = result.request.architecture!.nodes.filter(
      (n) => n.parentId === "system",
    );
    const architecture = structuredClone(result.request.architecture!);
    architecture.budgetMethod = "weighted";
    const id = rootChildren[0].id;
    architecture.nodes.find((n) => n.id === id)!.scaleWeights = {
      "500000": 4,
      "10000": 1,
    };
    const weighted = auditArchitectureDiagnosis({
      ...result,
      request: { ...result.request, architecture },
    });
    expect(
      weighted.scales[0].nodes.find((n) => n.id === id)!.allowedHours! /
        weighted.scales[0].allowedHours!,
    ).toBeGreaterThan(
      weighted.scales.at(-1)!.nodes.find((n) => n.id === id)!.allowedHours! /
        weighted.scales.at(-1)!.allowedHours!,
    );
    architecture.budgetMethod = "agree";
    architecture.nodes.find((n) => n.id === id)!.importance = 0.5;
    const agree = auditArchitectureDiagnosis({
      ...result,
      request: { ...result.request, architecture },
    });
    for (const scale of agree.scales)
      expect(
        scale.nodes
          .filter((n) => n.leaf)
          .reduce((s, n) => s + n.allowedHours!, 0),
      ).toBeCloseTo(scale.allowedHours!, 10);
  });
  it("preserves missing mappings in an explicit unassigned leaf", () => {
    const events = getAuditEvents(),
      architecture = defaultAuditArchitecture(events);
    architecture.nodes.find((n) => n.eventIds.includes("CORE-hard"))!.eventIds =
      [];
    const resolved = resolveAuditArchitecture(architecture, events);
    expect(
      resolved.nodes.find((n) => n.id === "unassigned")!.eventIds,
    ).toContain("CORE-hard");
    expect(architecture.nodes.some((n) => n.id === "unassigned")).toBe(false);
  });
  it("rejects cycles, duplicate fault ownership, invalid parents and unknown dependencies before simulation", () => {
    const request = input();
    const mutations = [
      (a: any) => {
        a.nodes[0].parentId = a.nodes[1].id;
      },
      (a: any) => {
        a.nodes.find((n: any) => n.kind === "overhead").eventIds = [
          "CORE-hard",
        ];
      },
      (a: any) => {
        a.nodes
          .find((n: any) => n.id === "object-CPU")
          .eventIds.push("CORE-hard");
      },
      (a: any) => {
        a.nodes[1].parentId = "missing";
      },
      (a: any) => {
        a.dependencies.push({
          from: "system",
          to: "missing",
          label: "依赖",
          source: "测试",
        });
      },
    ];
    for (const mutate of mutations) {
      const architecture = structuredClone(request.architecture!);
      mutate(architecture);
      expect(() => resolveAudit({ ...request, architecture })).toThrow();
    }
  });
  it("retains scoped unaddressed responsibilities instead of assigning unrelated measures", () => {
    const result = audit({ ...input(), mechanisms: ["sdcDetect"] });
    const links = architectureResponsibilities(
      result,
      result.architectureDiagnosis,
      500000,
      result.attribution[0].contributions,
    );
    expect(
      links.some((l) => l.mechanismId === "unaddressed" && l.actualHours > 0),
    ).toBe(true);
    for (const link of links.filter((l) => l.mechanismId === "sdcDetect")) {
      const node = result
        .topologyDecision!.scales.find((s) => s.cards === 500000)!
        .scenarios[0].nodes.find((n) => n.id === link.layerId)!;
      expect(node).toBeDefined();
      if (node.id !== "overhead")
        expect(link.eventIds.every((id) => id.endsWith("-sdc"))).toBe(true);
    }
  });
  it("freezes first-round rates and records sourced scenario FITs and mechanism overhead in the new diagnosis", () => {
    const first = audit({
      ...input(),
      scales: [500000],
      targets: { 500000: 0.985 },
      trials: 4,
      attributionTrials: 2,
    });
    const original = JSON.stringify(first);
    const source = {
      id: "first",
      inputHash: "hash",
      createdAt: "2026-10-16",
      input: first.request,
      result: first,
    };
    const event = first.events.find((e) => e.id === "CORE-sdc")!;
    const result = auditExperiment({
      source,
      name: "有来源参数试验",
      configuration: {
        enabled: true,
        model: { validationOverhead: 0.002 },
        fitTargets: [
          {
            id: event.id,
            fit: event.fit / 2,
            source: "测试明确假设",
            evidence: "scenario",
            rateBasis: "npu-equivalent-hour",
          },
        ],
        attributionTrials: 2,
        permutations: 2,
      },
    });
    expect(JSON.stringify(first)).toBe(original);
    expect(result.events.find((e) => e.id === event.id)!.fit).toBe(
      event.fit / 2,
    );
    expect(
      Math.abs(result.architectureDiagnosis.scales[0].residualHours),
    ).toBeLessThan(1e-8);
    expect(
      result.architectureDiagnosis.scales[0].nodes.find(
        (n) => n.kind === "overhead",
      )!.loss.mechanismOverhead,
    ).toBeGreaterThan(0);
  });
});

it("labels screening residual FIT with its scenario source instead of presenting a new measured rate", () => {
  const inputRequest = {
    ...input(),
    scales: [500000],
    targets: { 500000: 0.985 },
    trials: 4,
    attributionTrials: 2,
  };
  const first = audit(inputRequest);
  const source = {
    id: "first",
    inputHash: "hash",
    createdAt: "2026-10-16",
    input: inputRequest,
    result: first,
  };
  const screen = extensionScenario("H-SDC-SCREEN");
  const changed = auditExperiment({
    source,
    name: "有来源筛查",
    configuration: {
      enabled: true,
      extensions: [screen],
      attributionTrials: 2,
      permutations: 2,
    },
  });
  const original = first.events.find((e) => e.id === "CORE-sdc")!;
  const residual = changed.events.find((e) => e.id === "CORE-sdc")!;
  expect(residual.fit).toBeLessThan(original.fit);
  expect(residual.source).toContain("H-SDC-SCREEN");
  expect(residual.evidence).toBe("scenario");
  expect(first.events.find((e) => e.id === "CORE-sdc")!.fit).toBe(original.fit);
  expect(
    Math.abs(changed.architectureDiagnosis.scales[0].residualHours),
  ).toBeLessThan(1e-8);
});

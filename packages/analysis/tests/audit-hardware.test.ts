import { describe, expect, it } from "vitest";
import {
  audit,
  getAuditDefaults,
  getAuditEvents,
  resolveAudit,
  type AuditRequest,
} from "../src/audit";
import {
  defaultAuditArchitecture,
  resolveAuditArchitecture,
} from "../../contracts/src/audit-architecture";
import {
  hardwareCount,
  hardwareAuditArchitecture,
  hardwareEventView,
  hardwareScaleEvents,
} from "../../contracts/src/audit-hardware";
import { auditExperiment, experimentSampler } from "../src/audit-experiments";
import { auditExperimentPlan } from "../src/audit-experiment-plan";
import { report } from "../../reports/src/render";

function input(): AuditRequest {
  const r = getAuditDefaults();
  r.architecture = hardwareAuditArchitecture(getAuditEvents());
  const node = r.architecture.nodes.find((n) => n.id === "object-OPT")!;
  node.inventory = {
    totals: { 10000: 100, 100000: 250, 200000: 600, 500000: 1000 },
    source: "测试用非线性设备配置，不代表实际拓扑",
  };
  node.rateModel = {
    referenceCards: 10000,
    referenceCount: 100,
    source: "测试参考FIT对应100个光模块",
  };
  return {
    ...r,
    hours: 24,
    trials: 8,
    attributionTrials: 4,
    verificationTrials: 4,
    sensitivity: false,
    verifyRecommendation: false,
    scales: [10000, 100000, 200000, 500000],
    optimization: { enabled: false },
  };
}
describe("hardware containment, scale exposure and independent evaluations", () => {
  it("keeps four scales parallel and converts reference FIT by inventory exactly once", () => {
    const r = input(),
      events = getAuditEvents();
    const a = resolveAuditArchitecture(r.architecture, events);
    expect(a.view).toBe("hardware");
    expect(a.nodes.find((n) => n.id === "hardware-chip")?.parentId).toBe(
      "hardware-module",
    );
    expect(hardwareCount(a, "hardware-chip", 500000)).toBe(500000);
    expect(hardwareCount(a, "hardware-rack", 500000)).toBeNull();
    const original = events.find((e) => e.id === "OPT-hard")!;
    const scaled = hardwareScaleEvents(events, a, 500000);
    expect(scaled.find((e) => e.id === original.id)!.fit).toBeCloseTo(
      original.fit * 0.2,
      12,
    );
    expect(
      hardwareScaleEvents(events, a, 10000).find((e) => e.id === original.id)!
        .fit,
    ).toBe(original.fit);
    expect(scaled.find((e) => e.id === "CORE-hard")!.fit).toBe(
      events.find((e) => e.id === "CORE-hard")!.fit,
    );
    expect(events.find((e) => e.id === original.id)!.fit).toBe(original.fit);
  });
  it("matches explicit equivalent FIT calculations at each scale, including all coalitions", () => {
    const r = input(),
      result = audit(r);
    for (const cards of r.scales!) {
      const events = hardwareScaleEvents(
        getAuditEvents(),
        r.architecture,
        cards,
      );
      const direct = audit({
        ...r,
        cards,
        scales: [cards],
        target: r.targets![cards],
        targets: { [cards]: r.targets![cards] },
        architecture: defaultAuditArchitecture(getAuditEvents()),
        eventOverrides: events
          .filter((e) => e.id.startsWith("OPT-"))
          .map((e) => ({
            id: e.id,
            fit: e.fit,
            source: "显式对照",
            evidence: "scenario",
            rateBasis: "npu-equivalent-hour",
          })),
      });
      expect(
        result.rows
          .filter((s) => s.cards === cards)
          .map(({ scaleEvents: _events, ...row }) => row),
      ).toEqual(direct.rows);
      expect(result.attribution.find((v) => v.cards === cards)).toEqual(
        direct.attribution[0],
      );
      const d = result.architectureDiagnosis.scales.find(
        (s) => s.cards === cards,
      )!;
      expect(Math.abs(d.residualHours)).toBeLessThan(1e-9);
      const opt = d.nodes.find((n) => n.id === "object-OPT")!;
      expect(opt.fit).toBeCloseTo(
        events
          .filter((e) => e.id.startsWith("OPT-"))
          .reduce((s, e) => s + e.fit, 0),
        12,
      );
      expect(opt.types.reduce((s, t) => s + t.lossHours, 0)).toBeCloseTo(
        opt.actualHours,
        10,
      );
      expect(
        hardwareEventView(result, cards).find((e) => e.id === "OPT-hard")!.fit,
      ).toBe(events.find((e) => e.id === "OPT-hard")!.fit);
      const unknown = d.nodes.find((n) => n.id === "hardware-board-extra")!;
      expect(unknown.dataStatus).toBe("unknown");
      expect(unknown.businessMtbfHours).toBeNull();
      expect(d.nodes.find((n) => n.id === "hardware-board")!.dataStatus).toBe(
        "partial",
      );
    }
  });
  it("propagates explicit FIT changes through inventory in separate sampling without rewriting the first run", () => {
    const request = input(),
      first = audit(request);
    const source = {
      id: "hardware-first",
      inputHash: "first",
      createdAt: "2026-10-20",
      input: request,
      result: first,
    };
    const frozen = JSON.stringify(first);
    const event = first.events.find((e) => e.id === "OPT-hard")!;
    const configuration = {
      enabled: true,
      fitTargets: [
        {
          id: event.id,
          fit: event.fit / 2,
          source: "测试减半",
          evidence: "scenario" as const,
          rateBasis: "npu-equivalent-hour",
        },
      ],
      attributionTrials: 2,
      permutations: 2,
    };
    const second = auditExperiment({
      source,
      name: "明确的参数对照",
      configuration,
    });
    const s = second.architectureDiagnosis.scales.find(
      (s) => s.cards === 500000,
    )!;
    expect(s.scaleEvents.find((e) => e.id === event.id)!.fit).toBeCloseTo(
      event.fit * 0.1,
      12,
    );
    expect(JSON.stringify(first)).toBe(frozen);
    const plain = structuredClone(source);
    plain.input.architecture = defaultAuditArchitecture(getAuditEvents());
    plain.input.eventOverrides = hardwareScaleEvents(
      getAuditEvents(),
      request.architecture,
      500000,
    )
      .filter((e) => e.id.startsWith("OPT-"))
      .map((e) => ({
        id: e.id,
        fit: e.fit,
        source: "配对数值对照",
        evidence: "scenario",
        rateBasis: "npu-equivalent-hour",
      }));
    expect(
      experimentSampler(source)(500000, [], [301, 302, 303]).values,
    ).toEqual(experimentSampler(plain)(500000, [], [301, 302, 303]).values);
    const plan = auditExperimentPlan({
      source,
      options: {
        enabled: true,
        screeningTrials: 4,
        exploreExtensions: false,
        planning: { maxCandidates: 8 },
      },
    });
    expect(plan.scenarioEvaluated).toBe(false);
    expect(plan.architectureDiagnosis).toEqual(first.architectureDiagnosis);
    for (const allocation of plan.allocations)
      expect(Math.abs(allocation.responsibilityResidualHours)).toBeLessThan(
        1e-8,
      );
  });
  it("rejects unknown quantities, contradictory reference counts, invalid paths and duplicate roots", () => {
    const events = getAuditEvents();
    const missing = input();
    delete missing.architecture!.nodes.find((n) => n.id === "object-OPT")!
      .inventory!.totals["500000"];
    expect(() => resolveAudit(missing)).toThrow(/缺少500000/);
    const conflict = input();
    conflict.architecture!.nodes.find(
      (n) => n.id === "object-OPT",
    )!.rateModel!.referenceCount = 101;
    expect(() => resolveAudit(conflict)).toThrow(/参考数量/);
    const path = {
      eventId: "CORE-hard",
      path: ["object-CORE", "hardware-chip"],
      manifestation: "作业异常",
      impact: "同步作业",
      containment: "重执行失败后升级",
      source: "测试故障注入",
    };
    const good = input().architecture!;
    good.propagations = [path];
    expect(resolveAuditArchitecture(good, events).propagations).toEqual([path]);
    for (const bad of [
      [{ ...path, path: ["hardware-chip"] }],
      [{ ...path, path: ["object-CORE", "missing"] }],
      [{ ...path, path: ["object-CORE", "object-CORE"] }],
      [path, path],
    ]) {
      expect(() =>
        resolveAuditArchitecture({ ...good, propagations: bad }, events),
      ).toThrow();
    }
    const inherited = input().architecture!;
    const parent = inherited.nodes.find((n) => n.id === "hardware-network")!;
    parent.inventory = { totals: { 500000: 50 }, source: "测试上级数量" };
    const opt = inherited.nodes.find((n) => n.id === "object-OPT")!;
    opt.inventory = {
      totals: { 10000: 100 },
      unitsPerParent: 20,
      source: "每上级20件",
    };
    expect(hardwareCount(inherited, opt.id, 500000)).toBe(1000);
  });
  it("exports count evidence, unknown data, actual per-scale FITs and escaped propagation", () => {
    const r = input();
    r.architecture!.propagations = [
      {
        eventId: "CORE-hard",
        path: ["object-CORE", "hardware-chip", "hardware-node"],
        manifestation: "算子异常",
        impact: "作业",
        containment: "重执行后回退",
        source: "<script>bad()</script>",
      },
    ];
    const result = audit(r);
    const run = {
      id: "first",
      operation: "audit",
      status: "succeeded",
      result,
    } as any;
    const html = report(run, "html"),
      md = report(run, "md");
    expect(html).toContain("故障表现与硬件损失热力图");
    expect(html).toContain("业务中断MTBF：待独立");
    expect(html).toContain("故障数据不完整");
    expect(html).toContain("测试参考FIT对应100个光模块");
    expect(html).toContain("&lt;script&gt;bad()");
    expect(html).not.toContain("<script>bad()");
    expect(md).toContain("硬件规模配置与传播证据");
    expect(md).not.toContain("<svg");
    expect(md).toContain("参考10000卡/100件");
  });
});

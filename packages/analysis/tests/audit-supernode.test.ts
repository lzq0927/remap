import { describe, it, expect } from "vitest";
import { getAuditDefaults, getAuditEvents, audit } from "../src/audit";
import { auditAtlas } from "../src/audit-atlas";
import { architectureBudgets } from "../src/audit-architecture";
import {
  defaultSupernodeTopology,
  supernodeCounts,
  supernodeTopologySchema,
} from "../../contracts/src/audit-topology-config";
import { supernodeAuditArchitecture } from "../../contracts/src/audit-supernode";
import {
  hardwareAuditArchitecture,
  hardwareCount,
  hardwareScaleEvents,
} from "../../contracts/src/audit-hardware";
import { resolveAuditArchitecture } from "../../contracts/src/audit-architecture";
import {
  atlasSvg,
  atlasStandaloneHtml,
  atlasMarkdown,
  matrixCell,
} from "../../reports/src/audit-atlas";
import { changedAuditStage } from "../../workflow/src/design-changes";
import {
  auditDraftInput,
  draftFromAuditRequest,
} from "../../contracts/src/audit-draft";

describe("supernode topology: counts, evidence and ledger integration", () => {
  it("derives the official 1024-module inventory without mixing residual fault FIT and physical redundancy", () => {
    const t = defaultSupernodeTopology;
    expect(supernodeCounts(t, 1024)).toMatchObject({
      racks: 16,
      interconnectRacks: 2,
      l1Blades: 64,
      l2Devices: 16,
      ioBlades: 32,
      ubNics: 256,
      scaleUpSwitches: 80,
      l1Ports: 2048,
      l2Ports: 2048,
    });
    expect(supernodeCounts(t, 500000)).toMatchObject({
      racks: 7813,
      supernodes: 489,
      interconnectRacks: 978,
      l1Blades: 31252,
      l2Devices: 7824,
      ioBlades: 15626,
      ubNics: 125008,
    });
    const a = supernodeAuditArchitecture(getAuditEvents());
    expect(a.nodes.find((n) => n.id === "object-FABRIC")?.parentId).toBe(
      "hardware-scaleup",
    );
    expect(a.nodes.find((n) => n.id === "object-BOXIO")?.parentId).toBe(
      "hardware-io",
    );
    expect(hardwareScaleEvents(getAuditEvents(), a, 500000)).toEqual(
      getAuditEvents(),
    );
    const partial = getAuditEvents().filter((e) => e.id.startsWith("CORE-"));
    expect(() =>
      resolveAuditArchitecture(supernodeAuditArchitecture(partial), partial),
    ).not.toThrow();
    const legacy = { ...t };
    delete legacy.l2DevicesPerSupernode;
    expect(supernodeCounts(legacy, 1024).scaleUpSwitches).toBe(64);
  });
  it("retains a custom 1024-card evaluation without adding unrequested legacy reference targets", () => {
    const request = getAuditDefaults();
    const custom = {
      ...request,
      scales: [...request.scales, 1024],
      targets: { ...request.targets, 1024: 0.999 },
    };
    expect(auditDraftInput(draftFromAuditRequest(custom)).scales).toContain(
      1024,
    );
    expect(auditDraftInput(draftFromAuditRequest(custom)).targets![1024]).toBe(
      0.999,
    );
    expect(
      auditDraftInput(
        draftFromAuditRequest({ ...custom, samplingProfile: undefined }),
      ).scales,
    ).not.toContain(1000);
  });
  it("packs active tails for every scale and keeps reserved slots out of exposure", () => {
    const t = defaultSupernodeTopology;
    const expected = [
      [1000, 125, 16, 1, 1],
      [1024, 128, 16, 1, 1],
      [10000, 1250, 157, 10, 1],
      [100000, 12500, 1563, 98, 4],
      [200000, 25000, 3125, 196, 7],
      [500000, 62500, 7813, 489, 16],
    ];
    for (const [cards, nodes, racks, supernodes, pods] of expected) {
      const q = supernodeCounts(t, cards);
      expect([q.nodes, q.racks, q.supernodes, q.pods]).toEqual([
        nodes,
        racks,
        supernodes,
        pods,
      ]);
      expect(q.provisionedCards).toBeGreaterThanOrEqual(cards);
      expect(q.provisionedCards - cards).toBeLessThan(1024);
      expect(q.opticalModules).toBeNull();
      expect(q.scaleOutSwitches).toBeNull();
    }
    expect(supernodeCounts(t, 500000).tailCards).toBe(288);
    const alternate = {
      ...t,
      cardsPerSupernode: 512,
      cardsPerRack: 32,
      cardsPerNode: 8,
      cardsPerBoard: 4,
    };
    expect(supernodeCounts(alternate, 513)).toMatchObject({
      supernodes: 2,
      racks: 17,
      nodes: 65,
      boards: 129,
    });
    expect(
      supernodeTopologySchema.safeParse({ ...t, cardsPerRack: 60 }).success,
    ).toBe(false);
    expect(() => supernodeCounts(t, 1.5)).toThrow();
  });
  it("keeps explicit overrides, unknowns and unique fault ownership across historical models", () => {
    const events = getAuditEvents();
    const a = resolveAuditArchitecture(
      supernodeAuditArchitecture(events),
      events,
    );
    const opt = a.nodes.find((n) => n.id === "object-OPT")!;
    expect(hardwareCount(a, opt.id, 10000)).toBeNull();
    a.topology = {
      ...a.topology!,
      scaleUpSwitchesPerRack: 2,
      scaleOutLeavesPerSupernode: 2,
      scaleOutSpinesPerPod: 4,
      opticalLinksPerNode: 2,
      opticalLinksPerSupernode: 8,
    };
    expect(hardwareCount(a, opt.id, 10000)).toBe(5160);
    expect(hardwareCount(a, "hardware-scaleout", 500000)).toBe(1042);
    opt.inventory!.totals["10000"] = 100;
    opt.rateModel = {
      referenceCards: 10000,
      referenceCount: 100,
      source: "测试参考等效FIT映射，非厂商数据",
    };
    expect(hardwareCount(a, opt.id, 10000)).toBe(100);
    const original = events.find((e) => e.id === "OPT-hard")!;
    const scaled = hardwareScaleEvents(events, a, 500000).find(
      (e) => e.id === original.id,
    )!;
    expect(
      (scaled.fit * 500000) /
        ((original.fit * 10000 * hardwareCount(a, opt.id, 500000)!) / 100),
    ).toBeCloseTo(1, 12);
    for (const e of events)
      expect(a.nodes.filter((n) => n.eventIds.includes(e.id))).toHaveLength(1);
    const old = resolveAuditArchitecture(
      hardwareAuditArchitecture(events),
      events,
    );
    expect(old.topology).toBeUndefined();
    expect(hardwareCount(old, "hardware-rack", 500000)).toBeNull();
  });
  it("preserves forward sampling and Shapley, reconciles budgets, and exports true regional values", () => {
    const request = {
      ...getAuditDefaults(),
      hours: 24,
      trials: 8,
      attributionTrials: 4,
      verificationTrials: 4,
      scales: [1000, 10000, 100000, 200000, 500000],
      sensitivity: false,
      verifyRecommendation: false,
      optimization: { enabled: false },
    };
    const result = audit(request);
    const generic = audit({
      ...request,
      architecture: hardwareAuditArchitecture(getAuditEvents()),
    });
    expect(result.rows).toEqual(generic.rows);
    expect(result.attribution).toEqual(generic.attribution);
    for (const cards of request.scales) {
      const a = auditAtlas({ result, events: result.events }, cards),
        root = a.nodes.find((n) => !n.parentId)!;
      expect(
        a.nodes
          .filter((n) => n.leaf)
          .reduce((s, n) => s + (n.actualHours ?? 0), 0),
      ).toBeCloseTo(root.actualHours!, 9);
      expect(
        a.nodes
          .filter((n) => n.leaf)
          .reduce((s, n) => s + (n.allowedHours ?? 0), 0),
      ).toBeCloseTo(root.allowedHours ?? 0, 9);
      expect(root.aggregateEventFit).toBeCloseTo(
        result.events.reduce((s, e) => s + e.fit, 0) * cards,
        6,
      );
      expect(root.attributedAvailability).toBeCloseTo(
        1 - root.actualHours! / 24,
        12,
      );
      expect(
        a.nodes.find((n) => n.id === "hardware-leaf-extra")!
          .attributedAvailability,
      ).toBeNull();
      for (const metric of [
        "summary",
        "structure",
        "fit",
        "target",
        "availability",
      ] as const) {
        const svg = atlasSvg(a, { topology: true, metric });
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        if (metric === "structure") expect(svg).not.toContain("FIT");
      }
      const diag = root.measured.frequencyRecovery;
      expect(diag.physicalFitReductionAssumed).toBe(false);
      if (diag.requiredPauseSeconds !== null) {
        expect(
          diag.otherLossHours +
            (diag.requiredPauseSeconds * root.measured.recoveries) / 3600,
        ).toBeCloseTo(root.allowedHours!, 9);
      }
      if (diag.recoveryOnlyFeasible === false)
        expect(diag.otherLossHours).toBeGreaterThan(root.allowedHours!);
      const gap = matrixCell(a, root.id, "gap", String(cards), [a]);
      if (root.allowedHours !== null)
        expect(gap.value).toBeCloseTo(
          (root.targetAvailability! - root.attributedAvailability!) * 100,
          9,
        );
      else expect(gap.value).toBeNull();
      const searched = atlasSvg(a, {
        topology: true,
        metric: "structure",
        query: "CORE",
      });
      expect(searched).toContain('data-atlas-node="object-CORE"');
      expect(searched).not.toContain('data-atlas-node="object-NIC"');
      const html = atlasStandaloneHtml(a);
      expect(html).toContain("区域总事件FIT");
      expect(html).toContain("核对2026-10-25");
      expect(html).toContain("跨超节点参数面");
      if (cards === 1000) expect(root.allowedHours).toBeNull();
    }
    const preview = auditAtlas({ request, events: getAuditEvents() }, 1024);
    const undistributed = structuredClone(request);
    undistributed.architecture.budgetMethod = "none";
    const noBudget = auditAtlas(
      { request: undistributed, events: getAuditEvents() },
      500000,
    );
    expect(noBudget.nodes.find((n) => !n.parentId)!.targetAvailability).toBe(
      0.985,
    );
    expect(
      noBudget.nodes
        .filter((n) => n.parentId)
        .every((n) => n.targetAvailability === null),
    ).toBe(true);
    expect(preview.nodes.every((n) => n.attributedAvailability === null)).toBe(
      true,
    );
    expect(
      preview.nodes.find((n) => !n.parentId)!.npuEquivalentFit,
    ).toBeGreaterThan(0);
    const md = atlasMarkdown(result);
    expect(md).toContain("当前可用度（损失责任投影）");
    const budgets = architectureBudgets(request.architecture, 500000, 24, 0.36);
    expect(
      request.architecture.nodes
        .filter((n) => n.parentId === "hardware-scaleout")
        .reduce((s, n) => s + budgets.get(n.id)!, 0),
    ).toBeCloseTo(budgets.get("hardware-scaleout")!, 12);
    const frozen = JSON.stringify(result);
    atlasStandaloneHtml(auditAtlas({ result, events: result.events }, 500000));
    expect(JSON.stringify(result)).toBe(frozen);
  });
  it("invalidates from architecture confirmation when topology or propagation changes", () => {
    const input = getAuditDefaults();
    const design = (v: any) => ({
      activeAssessment: "audit",
      scenario: "training",
      assessment: { valid: true, input: v },
    });
    const change = structuredClone(input);
    change.architecture.topology!.cardsPerSupernode = 2048;
    expect(changedAuditStage(design(input), design(change))).toBe(1);
    const path = structuredClone(input);
    path.architecture.propagations = [
      {
        eventId: "CORE-hard",
        path: ["object-CORE", "hardware-chip"],
        manifestation: "测试",
        impact: "测试",
        containment: "测试",
        source: "测试",
      },
    ];
    expect(changedAuditStage(design(input), design(path))).toBe(1);
    const budget = structuredClone(input);
    budget.architecture.budgetMethod = "agree";
    expect(changedAuditStage(design(input), design(budget))).toBe(2);
  });
});

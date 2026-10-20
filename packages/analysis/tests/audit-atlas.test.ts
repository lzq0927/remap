import { describe, it, expect } from "vitest";
import { audit, getAuditDefaults, getAuditEvents } from "../src/audit";
import { auditAtlas } from "../src/audit-atlas";
import { auditExperiment } from "../src/audit-experiments";
import {
  atlasSvg,
  atlasVisible,
  atlasStandaloneHtml,
  atlasMatrixSvg,
  atlasMarkdown,
} from "../../reports/src/audit-atlas";
import { report } from "../../reports/src/render";

const request = {
  ...getAuditDefaults(),
  hours: 24,
  trials: 8,
  attributionTrials: 4,
  verificationTrials: 4,
  scales: [10000, 100000, 200000, 500000],
  sensitivity: false,
  verifyRecommendation: false,
  optimization: { enabled: false },
};
const result = audit(request);
describe("architecture atlas uses frozen ledger and explicit applicability", () => {
  it("reconciles mutually exclusive leaves and domains, without adding parent loss or unknown FIT", () => {
    const frozen = JSON.stringify(result);
    for (const cards of request.scales) {
      const a = auditAtlas({ result, events: result.events }, cards);
      const root = a.nodes.find((n) => !n.parentId)!;
      const sum = a.nodes
        .filter((n) => n.leaf)
        .reduce((s, n) => s + (n.actualHours ?? 0), 0);
      expect(sum).toBeCloseTo(root.actualHours!, 9);
      expect(
        a.domains.reduce((s, d) => s + (d.actualHours ?? 0), 0),
      ).toBeCloseTo(sum, 9);
      expect(
        a.nodes
          .filter((n) => n.leaf)
          .reduce((s, n) => s + (n.improvementHours ?? 0), 0),
      ).toBeCloseTo(root.improvementHours!, 9);
      expect(
        a.nodes.find((n) => n.id === "hardware-board-extra")!.actualHours,
      ).toBeNull();
      expect(
        a.events.every(
          (e) =>
            a.nodes.filter((n) => n.leaf && n.eventIds.includes(e.id))
              .length === 1,
        ),
      ).toBe(true);
      expect(a.ranking).toEqual(
        result.attribution.find((r) => r.cards === cards)!.contributions,
      );
    }
    expect(JSON.stringify(result)).toBe(frozen);
  });
  it("shows actual independent scenario parameters and incremental attribution without changing the first run", () => {
    const frozen = JSON.stringify(result);
    const second = auditExperiment({
      source: {
        id: "atlas-first",
        inputHash: "first",
        createdAt: "2026-10-20",
        input: request,
        result,
      },
      name: "测试方案",
      configuration: {
        enabled: true,
        policy: { "D-SDC": { coverage: 0.985 } },
        attributionTrials: 2,
        permutations: 2,
      },
    });
    const a = auditAtlas({ result: second, events: second.events }, 500000);
    expect(
      a.mechanisms.find((m) => m.id === "sdcDetect")!.parameters.coverage,
    ).toBe(0.985);
    expect(a.ranking).toEqual(
      second.attribution.find((r) => r.cards === 500000)!.contributions,
    );
    expect(a.comparisonBasis).toContain("冻结第一轮");
    const first = auditAtlas({ result, events: result.events }, 500000);
    for (const n of a.nodes.filter(
      (n) => n.measured?.dataStatus !== "unknown",
    )) {
      expect(n.baselineHours).toBeCloseTo(
        first.nodes.find((v) => v.id === n.id)!.actualHours!,
        9,
      );
    }
    expect(a.mechanisms.find((m) => m.id === "D-ABFT")!.status).toBe(
      "candidate",
    );
    expect(a.mechanisms.find((m) => m.id === "D-ABFT")!.parameters).toEqual({});
    expect(JSON.stringify(result)).toBe(frozen);
  });
  it("keeps pure topology separate and exports escaped, complete mappings regardless of view filters", () => {
    const a = auditAtlas({ result, events: result.events }, 500000);
    const pure = atlasSvg(a);
    expect(pure).not.toContain("FIT");
    expect(pure).not.toContain("CORE-hard");
    expect(pure).toContain("节点互连");
    const selected = atlasVisible(a, { query: "CORE-hard" });
    expect(selected.map((n) => n.id)).toContain("system");
    expect(selected.map((n) => n.id)).toContain("object-CORE");
    expect(selected.map((n) => n.id)).not.toContain("object-OPT");
    for (const spatial of [false, true])
      expect(atlasSvg(a, { spatial, metric: "loss" })).not.toMatch(
        /NaN|Infinity/,
      );
    a.nodes.find((n) => n.id === "object-CORE")!.name =
      '<script>alert("x")</script>';
    const html = atlasStandaloneHtml(a);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    const unsafe = structuredClone(result);
    unsafe.architectureDiagnosis.architecture.nodes[0].name =
      "<script>alert(1)</script>";
    expect(atlasMarkdown(unsafe)).toContain("&lt;script&gt;");
    expect(atlasMarkdown(unsafe)).not.toContain("<script>");
    expect(html).toContain("object-OPT");
    expect(html).toContain("对象与故障损失矩阵");
    const svg = atlasMatrixSvg(
      a,
      "fault",
      a.nodes.filter((n) => n.leaf),
      [
        ["hard", "中断"],
        ["slow", "亚健康"],
        ["sdc", "静默"],
      ],
    );
    expect(svg).toContain("待补充");
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(
      report(
        { id: "atlas", status: "succeeded", operation: "audit", result } as any,
        "html",
      ),
    ).toContain("架构—故障—机制全景");
  });
  it("previews without simulated values and preserves explicit domain overrides", () => {
    const r = structuredClone(request);
    r.architecture.nodes.find((n) => n.id === "object-CORE")!.functionalDomain =
      "control";
    const a = auditAtlas({ request: r, events: getAuditEvents() }, 500000);
    expect(a.evaluated).toBe(false);
    expect(a.nodes.every((n) => n.actualHours === null)).toBe(true);
    expect(a.nodes.find((n) => n.id === "object-CORE")!.domain).toBe("control");
    expect(a.mechanisms.some((m) => m.status === "selected")).toBe(true);
    const opt = r.architecture.nodes.find((n) => n.id === "object-OPT")!;
    opt.rateModel = {
      referenceCards: 10000,
      referenceCount: 100,
      source: "测试参考数量",
    };
    expect(() =>
      auditAtlas({ request: r, events: getAuditEvents() }, 500000),
    ).toThrow(/硬件数量/);
    opt.inventory = {
      totals: { 10000: 100 },
      source: "测试参考数量，其他规模待补充",
    };
    const missing = auditAtlas(
      { request: r, events: getAuditEvents() },
      500000,
    );
    expect(missing.error).toBeTruthy();
    expect(missing.events.every((e) => e.rate === null)).toBe(true);
  });
});

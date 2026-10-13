import { expect, it, vi } from "vitest";
import reference from "../../references/expert-review-2026-10-09/results.json";
import { getAuditDefaults } from "../../packages/analysis/src/audit";
import { buildApp } from "../../apps/api/src/server";
import { auditContributionView } from "../../packages/reports/src/audit-contributions";
import { report } from "../../packages/reports/src/report";
it.skipIf(process.env.REMAP_VERIFY_EXPERT_SHAPLEY !== "1")(
  "checks real expert 4000/2000 sampling at 10000 and 500000 cards without changing negative contributions",
  async () => {
    const input = {
      ...getAuditDefaults(),
      scales: [10000, 500000],
      targets: { "10000": 0.99, "500000": 0.8 },
      sensitivity: false,
      verifyRecommendation: false,
    };
    // A CPU-bound audit must run in the platform solver process, not block Vitest RPC.
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    let result: any, computedRun: any;
    try {
      const task = app.taskServices.create(
        "Expert contribution verification · public synthetic input",
      );
      const base = "/api/tasks/" + task.id;
      const started = (
        await app.inject({
          method: "POST",
          url: base + "/runs",
          payload: { operation: "audit", input },
        })
      ).json();
      await vi.waitFor(
        async () => {
          computedRun = (await app.inject(base + "/runs/" + started.id)).json();
          if (computedRun.status === "failed")
            throw new Error(computedRun.error.message);
          expect(computedRun.status).toBe("succeeded");
        },
        { timeout: 330000, interval: 1000 },
      );
      result = computedRun.result;
    } finally {
      await app.close();
    }
    for (const cards of [10000, 500000]) {
      const expected = reference.shapley.find((a) => a.cards === cards)!;
      const view = auditContributionView(result, cards);
      expect(view.subsetCount).toBe(64);
      expect(view.trials).toBe(2000);
      expect(view.baselineMean).toBeCloseTo(expected.baseline, 10);
      expect(view.combinedMean).toBeCloseTo(expected.combined, 10);
      expect(view.gain).toBeCloseTo(expected.delta, 10);
      expect(Math.abs(view.residual!)).toBeLessThan(1e-10);
      for (const row of view.rows) {
        const player = expected.players.find((p) => p.player === row.id)!;
        expect(row.statistics.mean).toBeCloseTo(player.contribution, 10);
        expect((row.statistics.ciHigh - row.statistics.ciLow) / 2).toBeCloseTo(
          player.ci95,
          10,
        );
        expect(row.hours).toBeCloseTo(player.contribution * 720, 8);
      }
    }
    expect(
      auditContributionView(result, 10000)
        .rows.filter((c: any) => c.statistics.mean < 0)
        .map((c: any) => c.id)
        .sort(),
    ).toEqual(["elastic", "fast"]);
    const run: any = {
      id: "expert-contribution-public-fixture",
      operation: "audit",
      status: "succeeded",
      input,
      inputHash: "fixture",
      result,
      createdAt: "2026-10-13",
      progress: 1,
      events: [],
    };
    expect(JSON.parse(report(run, "json")).result).toEqual(result);
    expect(report(run, "html")).toContain('value="10000" selected');
    expect(report(run, "md")).toContain("计算依据与详细审核");
    // Only two scales are verified here; never mislabel this as a full reference reproduction.
    expect(result.referenceComparison.matchesReference).toBe(false);
  },
  360000,
);

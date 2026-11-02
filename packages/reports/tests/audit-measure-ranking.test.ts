import { expect, test } from "vitest";
import { matchedMeasureRanking } from "../src/audit-measure-ranking";
import study from "../../../references/remap-studies/2026-11-02-measure-ranking-50w.json";
import necessity from "../../../references/remap-studies/2026-11-01-measure-necessity-50w.json";

function entries() {
  return [
    [
      study.baselineInputHash,
      study.baselineConfiguration,
      study.baselineEvents,
      study.frozenBaseline,
    ],
    [
      study.targetInputHash,
      study.targetConfiguration,
      study.targetEvents,
      study.frozenTarget,
    ],
  ].map(([inputHash, configuration, events, endpoint]: any) => ({
    inputHash,
    configuration: structuredClone(configuration),
    rows: [
      {
        cards: 500000,
        statistics: { mean: endpoint.availability },
        scaleEvents: events.map(([id, type, fit]: any) => ({ id, type, fit })),
      },
    ],
  }));
}

test("ranking is shown only for both exact frozen endpoints, event rates, horizon and scale", () => {
  const [before, after] = entries();
  expect(matchedMeasureRanking(before, after, 500000, 600)).toEqual(study);
  expect(matchedMeasureRanking(before, after, 10000, 600)).toBeNull();
  expect(matchedMeasureRanking(before, after, 500000, 720)).toBeNull();
  for (const index of [0, 1]) {
    const e = entries();
    e[index].rows[0].scaleEvents[0].fit *= 2;
    expect(matchedMeasureRanking(e[0], e[1], 500000, 600)).toBeNull();
    const p = entries();
    p[index].configuration.model.manualAdditionalSeconds = 7200;
    expect(matchedMeasureRanking(p[0], p[1], 500000, 600)).toBeNull();
  }
  after.rows[0].statistics.mean = NaN;
  expect(matchedMeasureRanking(before, after, 500000, 600)).toBeNull();
});

test("nine-group Shapley conserves the full improvement and every ledger component", () => {
  expect(study.coalitions).toBe(2 ** study.ranking.length);
  expect(study.n).toBe(1024);
  expect(study.endpoints.target.availability).toBeCloseTo(
    study.frozenTarget.availability,
    12,
  );
  const means = study.ranking.map((r) => r.shapley.loss.mean);
  expect(means).toEqual([...means].sort((a, b) => b - a));
  expect(means.reduce((s, v) => s + v, 0)).toBeCloseTo(
    study.combined.loss.mean,
    8,
  );
  expect(study.combined.loss.mean).toBeCloseTo(
    600 *
      (study.endpoints.target.availability -
        study.endpoints.baseline.availability),
    8,
  );
  for (const key of Object.keys(
    study.combined.ledger,
  ) as (keyof typeof study.combined.ledger)[]) {
    expect(
      study.ranking.reduce((s, r) => s + r.shapley.ledger[key], 0),
    ).toBeCloseTo(study.combined.ledger[key], 8);
  }
  for (const r of study.ranking) {
    expect(
      Object.values(r.shapley.ledger).reduce((s, v) => s + v, 0),
    ).toBeCloseTo(r.shapley.loss.mean, 8);
    expect(r.shapley.availabilityGainPp).toBeCloseTo(
      r.shapley.loss.mean / 6,
      10,
    );
  }
});

test("the previous three ablations replay while Agent success and manual-duration effects stay distinct", () => {
  for (const id of ["agent_manual", "checkpoint", "sdc_detection"]) {
    const r = study.ranking.find((m) => m.id === id)!;
    const old = necessity.results.find((m) => m.id === id)!;
    expect(r.necessity.loss.mean).toBeCloseTo(old.conditionalSaving!.mean, 10);
  }
  const agent = study.ranking.find((r) => r.id === "agent_manual")!;
  expect(agent.model).toEqual(["manualAdditionalSeconds"]);
  expect(agent.policy).toEqual([]);
  expect(agent.shapley.loss.mean).toBeGreaterThan(agent.necessity.loss.mean);
  expect(
    study.ranking.find((r) => r.id === "sdc_investigation")!.model,
  ).toEqual(["sdcDelayHours"]);
  const represented = study.ranking.flatMap((r) => r.model);
  expect(represented.length).toBe(new Set(represented).size);
  expect(study.originalSnapshotsChanged).toBe(false);
});

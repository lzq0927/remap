/** Full numeric acceptance against the immutable upstream report; intentionally not a routine unit test. */
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import reference from "../references/expert-review-2026-10-09/results.json";
import {
  audit,
  getAuditDefaults,
  resolveAudit,
} from "../packages/analysis/src/audit";
import { report } from "../packages/reports/src/render";
import { reportPackage } from "../packages/reports/src/report-package";
import { hash } from "../packages/assets/src/hash";
const directory = "artifacts/expert-reproduction";
mkdirSync(directory, { recursive: true });
const input = getAuditDefaults();
const work = resolveAudit(input);
console.log(
  JSON.stringify({
    trajectories: work.sampleRuns,
    expectedEvents: Math.round(work.expectedEvents),
  }),
);
let last = 0;
const result = audit(input, (done, total) => {
  const now = Date.now();
  if (now - last > 20000 || done === total) {
    console.log(
      `Progress ${done}/${total} (${((100 * done) / total).toFixed(1)}%)`,
    );
    last = now;
  }
});
// Keep the expensive result even if an acceptance assertion fails, for diagnosis and report-only regeneration.
writeFileSync(`${directory}/result.json`, JSON.stringify(result));
let checks = 0;
let maxError = 0;
const close = (actual: number, expected: number, tolerance = 1e-9) => {
  const difference = Math.abs(actual - expected);
  maxError = Math.max(maxError, difference);
  assert.ok(
    Number.isFinite(actual) && difference < tolerance,
    `${actual} != ${expected} (difference ${difference})`,
  );
  checks++;
};
for (const expected of reference.results) {
  const actual = result.rows.find(
    (r) => r.cards === expected.cards && r.id === expected.scenario,
  )!;
  close(actual.statistics.mean, expected.mean);
  close(
    (actual.statistics.ciHigh - actual.statistics.ciLow) / 2,
    expected.ci95,
  );
  close(actual.delta.mean, expected.delta);
  close((actual.delta.ciHigh - actual.delta.ciLow) / 2, expected.deltaCi95);
  close(actual.availability, expected.availability);
  for (const [k, v] of Object.entries(expected.ledger))
    close(actual.ledger[k], v);
  for (const [id, ledger] of Object.entries(expected.perEvent))
    for (const [k, v] of Object.entries(ledger))
      close(actual.perEvent[id][k], Number(v));
}
for (const expected of reference.shapley) {
  const actual = result.attribution.find((r) => r.cards === expected.cards)!;
  close(actual.gain, expected.delta);
  for (const player of expected.players) {
    const actualPlayer = actual.contributions.find(
      (c: any) => c.id === player.player,
    )!;
    close(actualPlayer.statistics.mean, player.contribution);
    close(
      (actualPlayer.statistics.ciHigh - actualPlayer.statistics.ciLow) / 2,
      player.ci95,
    );
  }
}
for (const expected of reference.sensitivity) {
  const parameter =
    expected.kind === "elasticSync"
      ? "elasticSyncSeconds"
      : expected.kind === "stepRollback"
        ? "stepSeconds"
        : expected.kind;
  const actual = result.sensitivity.find(
    (r) => r.parameter === parameter && r.value === expected.value,
  )!;
  close(actual.statistics.mean, expected.mean);
  close(
    (actual.statistics.ciHigh - actual.statistics.ciLow) / 2,
    expected.ci95,
  );
  close(actual.availability, expected.availability);
  for (const [k, v] of Object.entries(expected.ledger))
    close(actual.ledger[k], v);
}
assert.equal(result.referenceComparison.matchesReference, true);
assert.ok(result.reviewChecks.every((c: any) => c.status !== "failed"));
const run: any = {
  id: "expert-reproduction",
  operation: "audit",
  status: "succeeded",
  input,
  inputHash: hash(input),
  progress: 1,
  result,
  createdAt: new Date().toISOString(),
  events: [],
};
writeFileSync(`${directory}/result.json`, JSON.stringify(result));
writeFileSync(`${directory}/expert-report.html`, report(run, "html"));
writeFileSync(`${directory}/expert-report.md`, report(run, "markdown"));
const bundle = reportPackage(run);
for (const file of bundle.files)
  writeFileSync(`${directory}/${file.name}`, file.content);
writeFileSync(`${directory}/${bundle.filename}`, bundle.buffer);
writeFileSync(
  `${directory}/verification.json`,
  JSON.stringify(
    {
      checks,
      maxError,
      scenarios: reference.results.length,
      shapleyScales: reference.shapley.length,
      sensitivityPoints: reference.sensitivity.length,
      sourceCommit: result.config.sourceCommit,
    },
    null,
    2,
  ),
);
console.log(`PASS ${checks} comparisons; maximum absolute error ${maxError}`);

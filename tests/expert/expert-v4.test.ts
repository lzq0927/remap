import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import {
  expertEngine,
  getTrainingDefaults,
  getFactors,
  resolveTrainingConfig,
  runTraining,
  trialSeed,
} from "../../packages/solvers/src/training";
import manifest from "../../references/expert-v4/manifest.json";
const originalSource = readFileSync(
  new URL("../../references/expert-v4/月度训练仿真引擎.js", import.meta.url),
  "utf8",
);
const sandbox: any = { module: { exports: null } };
vm.runInNewContext(originalSource, sandbox);
const original = sandbox.module.exports();
it("verifies all fixed commit provenance hashes and exact HTML baseline", () => {
  for (const file of manifest.files) {
    const bytes = readFileSync(
      new URL("../../references/expert-v4/" + file.path, import.meta.url),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
  }
  const html = readFileSync(
    new URL(
      "../../references/expert-v4/正确有效产出改进分析.html",
      import.meta.url,
    ),
    "utf8",
  );
  const precomputed = JSON.parse(
    html.match(
      /<script id="precomputed" type="application\/json">(.*?)<\/script>/s,
    )![1],
  );
  expect(getTrainingDefaults().model).toEqual(precomputed.baseline);
  expect(getTrainingDefaults().config).toEqual(precomputed.config);
  expect(getFactors().map((f: any) => f.id)).toEqual(
    precomputed.factors.map((f: any) => f.id),
  );
});
it("adapter reproduces original pathwise values with shared seeds and factor patches", () => {
  for (const cards of [1000, 10000, 500000])
    for (const factors of [
      [],
      ["silent"],
      ["mode"],
      getFactors().map((f: any) => f.id),
    ]) {
      const req = {
        cards,
        hours: 720,
        trials: 8,
        seed: 9137,
        target: 0.99,
        factors,
      };
      const adapted = runTraining(req),
        { params } = resolveTrainingConfig(req);
      const expected = Array.from(
        { length: req.trials },
        (_, i) =>
          original.simulate(cards, params, trialSeed(req.seed, i, cards), {
            hours: req.hours,
          }).delivery,
      );
      expect(adapted.diagnostics.samples).toEqual(expected);
      expect(Math.abs(adapted.ledger.residual)).toBeLessThan(1e-7);
    }
});
it("matches original precomputed 2048-trial baseline at 1000 cards", () => {
  const req = {
    cards: 1000,
    hours: 720,
    trials: 2048,
    seed: 9137,
    target: 0.99,
  };
  const html = readFileSync(
    new URL(
      "../../references/expert-v4/正确有效产出改进分析.html",
      import.meta.url,
    ),
    "utf8",
  );
  const snapshot = JSON.parse(
    html.match(
      /<script id="precomputed" type="application\/json">(.*?)<\/script>/s,
    )![1],
  );
  const actual = runTraining(req),
    reference = snapshot.scale.find((r: any) => r.n === 1000);
  expect(actual.statistics.mean).toBeCloseTo(reference.base.mean, 12);
  expect(actual.ledger.delivered).toBeCloseTo(
    reference.diagnostics.base.ledger.delivered,
    9,
  );
});
it("terminal unresolved pollution invalidates all delivery including clean prefix", () => {
  const params = {
    ...getTrainingDefaults().model,
    fits: [0, 0, 0, 0],
    saveSeconds: 0,
  };
  const r = expertEngine.simulate(1000, params, 1, {
    hours: 2,
    events: [{ at: 1, kind: "silent", detectAfter: 100, channel: "fallback" }],
    trace: true,
  });
  expect(r.correct).toBe(1);
  expect(r.effective).toBe(0.5);
  expect(r.delivery).toBe(0);
  expect(r.ledger.terminalDiscard).toBe(1);
  expect(r.ledger.unrecoveredCorruptWork).toBe(1);
  expect(r.ledger.residual).toBe(0);
});
it("reproduces 100000-card target scenarios over three independent base seeds", () => {
  for (const seed of [9137, 19137, 29137]) {
    const req = {
      cards: 100000,
      hours: 720,
      trials: 4,
      seed,
      target: 0.943,
      factors: getFactors().map((f: any) => f.id),
    };
    const r = runTraining(req),
      { params } = resolveTrainingConfig(req);
    expect(r.diagnostics.samples).toEqual(
      Array.from(
        { length: 4 },
        (_, i) =>
          original.simulate(req.cards, params, trialSeed(seed, i, req.cards), {
            hours: 720,
          }).delivery,
      ),
    );
  }
});

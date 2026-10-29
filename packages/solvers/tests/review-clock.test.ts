import { createRequire } from "node:module";
import { expect, test } from "vitest";
import config from "../../../references/expert-review-2026-10-09/config.json";
import policy from "../../../references/expert-review-2026-10-09/mechanism-policy.json";
const createEngine = createRequire(import.meta.url)(
  "../src/vendor/review-engine.cjs",
);

test.each([0, 1])(
  "one-second checkpoint cycles conserve time at exact boundaries, with %s seconds blocking",
  (save) => {
    for (const cycles of [3, 9, 31, 1000]) {
      const hours = (cycles * (1 + save)) / 3600;
      const engine = createEngine([], policy, {
        ...config,
        horizonHours: hours,
        checkpointComputeSeconds: 1,
        checkpointSaveSeconds: save,
      });
      const result = engine.simulate(1000, 2, 7419231, engine.parameters());
      expect(result.correctHours).toBeCloseTo(cycles / 3600, 12);
      expect(result.ledger.save).toBeCloseTo((cycles * save) / 3600, 12);
      expect(result.usefulThroughput).toBeCloseTo(1 / (1 + save), 12);
    }
  },
);

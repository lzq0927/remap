/** Recompute the frozen training scenarios after the exposure-only solver correction. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { audit, type AuditRequest } from "../packages/analysis/src/audit";
import { hash } from "../packages/assets/src/hash";
const out = resolve(
  process.argv[2] ?? "/workspace/artifacts/remap-loss-matrix-20261029",
);
const from = resolve(
  process.argv[3] ?? "/workspace/artifacts/remap-refinement-20261027",
);
mkdirSync(out + "/source", { recursive: true });
for (const id of [
  "current",
  "extension",
  "breakthrough",
  "attachment-parameters",
]) {
  const original = JSON.parse(
    readFileSync(
      `${from}/${id === "attachment-parameters" ? "breakthrough" : id}-snapshot.json`,
      "utf8",
    ),
  );
  const input: AuditRequest = structuredClone(original.result.request);
  input.samplingProfile = undefined;
  input.trials = id === "current" || id === "extension" ? 256 : 1024;
  input.seed = id === "current" || id === "extension" ? 7419231 : 2655407334;
  input.attributionTrials = 64;
  input.verificationTrials = 1024;
  input.sensitivity = false;
  input.verifyRecommendation = false;
  input.optimization = { enabled: false };
  if (id === "attachment-parameters") {
    // Attached 98.60146% slide used a different hard-event scope. Evaluate its
    // engineering parameter proposal against today's frozen scope, not as a replay.
    input.model = {
      ...input.model,
      recoveryAttemptSeconds: 22,
      recoverySuccess: 0.998,
      validationOverhead: 0.0001,
    };
    input.policy = {
      ...input.policy,
      "D-HARD": {
        ...input.policy?.["D-HARD"],
        coverage: 0.998,
        detectSeconds: 3.6,
      },
      "D-SDC": { ...input.policy?.["D-SDC"], coverage: 0.999 },
      "D-SLOW": {
        ...input.policy?.["D-SLOW"],
        coverage: 0.978,
        detectSeconds: 42.1,
      },
    };
  }
  const file = `${out}/source/${id}-snapshot.json`;
  if (
    existsSync(file) &&
    JSON.parse(readFileSync(file, "utf8")).inputHash === hash(input)
  )
    continue;
  const t = Date.now();
  const result = audit(input);
  const snapshot = {
    id: `corrected-${id}`,
    inputHash: hash(input),
    createdAt: new Date().toISOString(),
    input,
    result,
    provenance: {
      originalId: original.id,
      originalInputHash: hash(original.result.request),
      note: "Exposure-only architecture now reaches every solver path. Original FIT, hardware quantities, scale targets and engineering scope preserved. Independent validation seed for breakthrough.",
      attachmentParameterStudy: id === "attachment-parameters",
    },
  };
  writeFileSync(
    `${out}/source/${id}-snapshot.json`,
    JSON.stringify(snapshot, null, 2),
  );
  console.log(
    JSON.stringify({
      id,
      elapsedSeconds: (Date.now() - t) / 1000,
      rows: result.rows
        .filter((r: any) => r.id === "combined")
        .map((r: any) => ({
          cards: r.cards,
          statistics: r.statistics,
          loss: r.ledger,
        })),
    }),
  );
}

import { expect, test } from "vitest";
import { mapConfirmedData } from "../src/map-confirmed";

test("native training preserves explicit fields and rejects unknown model knobs", () => {
  const data = {
    cards: 10000,
    target: 0.99,
    model: { fits: [1000, 20, 30, 40], saveSeconds: 4, inventedRecovery: 0 },
  };
  const r = mapConfirmedData(data);
  expect(r.trainingPatch).toEqual({
    cards: 10000,
    target: 0.99,
    model: { fits: [1000, 20, 30, 40], saveSeconds: 4 },
  });
  expect(r.unmapped[0].path).toBe("$.model.inventedRecovery");
  expect(data.model).toHaveProperty("inventedRecovery", 0);
});
test("catalog rows use strict numeric columns, explicit exposure and input provenance", () => {
  const r = mapConfirmedData(
    [
      {
        kind: "failure-mode",
        name: "GPU",
        fit: "1000",
        rateBasis: "device-hour",
      },
      { name: "unknown kind", fit: "2" },
      {
        kind: "failure-mode",
        name: "text",
        fit: "1000 FIT",
        rateBasis: "device-hour",
      },
      {
        kind: "failure-mode",
        name: "wrong basis",
        fit: "1000",
        rateBasis: "job-hour",
      },
    ],
    {
      inputId: "source-1",
      contentHash: "hash",
      sources: [{ sheet: "modes", row: 2, cell: "C2" }],
    },
  );
  expect(r.assets).toHaveLength(1);
  expect(r.assets[0].payload).toMatchObject({
    fit: 1000,
    rateBasis: "device-hour",
    evidenceStatus: "unverified",
    source: { cell: "C2" },
    inputSource: { inputId: "source-1", contentHash: "hash" },
  });
  expect(r.unmapped).toHaveLength(3);
});
test("model extraction maps named collections and retains architecture without guessing a training topology", () => {
  const r = mapConfirmedData({
    architecture: {
      nodes: [{ id: "A" }, { id: "B" }],
      edges: [{ from: "A", to: "B" }],
    },
    failureModes: [{ name: "unknown rate", source: { page: 2 } }],
    mechanisms: [
      {
        name: "detector",
        patch: { hardDetect: 95 },
        evidenceStatus: "illustrative",
      },
    ],
    parameters: [
      {
        name: "save",
        modelField: "model.saveSeconds",
        value: "4",
        unit: "seconds",
        source: { cell: "B4" },
      },
    ],
    ambiguities: [],
  });
  expect(r.assets.map((a) => a.kind)).toEqual([
    "scenario-template",
    "failure-mode",
    "mechanism",
    "parameter-evidence",
  ]);
  expect(r.trainingPatch).toEqual({ model: { saveSeconds: 4 } });
  expect(r.assets[1].payload.fit).toBeUndefined();
  expect(r.assets[1].payload.source).toEqual({ page: 2 });
  expect(r.warnings.join(" ")).toContain("不能补零");
});
test("ambiguous extractions cannot produce partial previews", () => {
  expect(() =>
    mapConfirmedData({ cards: 10000, ambiguities: ["unknown FIT"] }),
  ).toThrow(/UNRESOLVED_AMBIGUITY/);
  expect(() =>
    mapConfirmedData({
      assets: [
        {
          kind: "mechanism",
          name: "x",
          payload: { ambiguities: ["coverage"] },
        },
      ],
    }),
  ).toThrow(/UNRESOLVED_AMBIGUITY/);
});
test("parameter mapping rejects mismatched time units, unknown fields and ambiguous FIT exposure", () => {
  const r = mapConfirmedData({
    parameters: [
      { modelField: "saveSeconds", value: 4, unit: "hours" },
      {
        modelField: "fits",
        value: [1000, 0, 0, 0],
        unit: "FIT",
        basis: "job-hour",
      },
      { modelField: "hardSeconds", value: "fast", unit: "s" },
      { modelField: "unknown", value: 1, unit: "s" },
    ],
  });
  expect(r.trainingPatch).toBeUndefined();
  expect(r.unmapped).toHaveLength(4);
});
test("conflicting evidence removes the effective parameter instead of selecting a value", () => {
  const r = mapConfirmedData({
    parameters: [
      { modelField: "saveSeconds", value: 4, unit: "s" },
      { modelField: "saveSeconds", value: 8, unit: "s" },
      { modelField: "saveSeconds", value: 16, unit: "s" },
    ],
  });
  expect(r.trainingPatch?.model).not.toHaveProperty("saveSeconds");
  expect(r.unmapped).toHaveLength(2);
});
test("native explicit solver configuration survives mapping without supplying defaults", () => {
  const r = mapConfirmedData({
    cards: 10000,
    config: {
      trials: 64,
      stepSeconds: 2,
      model: { saveSeconds: 5 },
      invented: 3,
    },
  });
  expect(r.trainingPatch).toEqual({
    cards: 10000,
    config: { trials: 64, stepSeconds: 2, model: { saveSeconds: 5 } },
  });
  expect(r.unmapped[0].path).toBe("$.config.invented");
});
test("ambiguities in JSON payload cells remain blocking", () => {
  expect(() =>
    mapConfirmedData([
      {
        kind: "mechanism",
        name: "unresolved",
        payload: '{"ambiguities":["recovery"]}',
      },
    ]),
  ).toThrow(/UNRESOLVED_AMBIGUITY/);
});
test("assets envelope supports explicit JSON payload cells without converting free text", () => {
  const r = mapConfirmedData({
    assets: [
      {
        kind: "mechanism",
        name: "recovery",
        payload: '{"patch":{"hardSeconds":10},"source":{"page":1}}',
      },
    ],
  });
  expect(r.assets[0].payload).toMatchObject({
    patch: { hardSeconds: 10 },
    source: { page: 1 },
  });
  expect(r.unmapped).toEqual([]);
});

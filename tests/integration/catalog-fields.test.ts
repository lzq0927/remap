import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import CatalogFields, {
  editCatalogField,
  editFailureBasis,
  editFitsBinding,
  editCatalogPatch,
} from "../../apps/web/src/CatalogFields";

test("editing one field preserves unknown nested evidence references and conditions", () => {
  const original = JSON.stringify({
    fit: 1000,
    source: { document: "report", page: 2, cell: "B4" },
    conditions: { temperature: 40 },
    refs: [{ id: "x", revision: 1 }],
    extra: { custom: true },
  });
  const edited = JSON.parse(
    editCatalogField(original, ["source", "document"], "new report"),
  );
  expect(edited).toMatchObject({
    fit: 1000,
    source: { document: "new report", page: 2, cell: "B4" },
    conditions: { temperature: 40 },
    refs: [{ id: "x", revision: 1 }],
    extra: { custom: true },
  });
});
test("software rate basis clears FIT and obsolete fits binding without inventing a rate", () => {
  const value = JSON.stringify({
    fit: 1000,
    rateBasis: "device-hour",
    modelBinding: { array: "fits", index: 1 },
    recoverySeconds: 180,
    extra: "keep",
  });
  const next = JSON.parse(editFailureBasis(value, "job-hour"));
  expect(next).toEqual({
    rateBasis: "job-hour",
    recoverySeconds: 180,
    extra: "keep",
  });
  expect(next).not.toHaveProperty("rate");
  expect(() => editFitsBinding(JSON.stringify(next), 1)).toThrow(/设备小时/);
});
test("only an explicit device-hour binding selects a FIT index and unbinding preserves other parameters", () => {
  const value = JSON.stringify({
    fit: 1000,
    rateBasis: "device-hour",
    unknown: [1, 2],
  });
  const bound = editFitsBinding(value, 0);
  expect(JSON.parse(bound).modelBinding).toEqual({ array: "fits", index: 0 });
  expect(JSON.parse(editFitsBinding(bound))).toEqual(JSON.parse(value));
  expect(() => editFitsBinding(value, 4)).toThrow();
});
test("patch edit retains unknown patch entries and rejects unsupported fields", () => {
  const value = JSON.stringify({
    patch: { hardSeconds: 10, customPolicy: { id: "unknown" } },
    conditions: { requires: "deployment" },
  });
  const next = JSON.parse(editCatalogPatch(value, "hardSeconds", 20));
  expect(next).toMatchObject({
    patch: { hardSeconds: 20, customPolicy: { id: "unknown" } },
    conditions: { requires: "deployment" },
  });
  expect(
    JSON.parse(editCatalogPatch(JSON.stringify(next), "hardSeconds")).patch,
  ).toEqual({ customPolicy: { id: "unknown" } });
  expect(() => editCatalogPatch(value, "inventedRecovery", 0)).toThrow();
  expect(() => editCatalogPatch(value, "hardDetect", 101)).toThrow(/0–100/);
  expect(() => editCatalogPatch(value, "recoveryDomains", 1.5)).toThrow(/整数/);
});

test("changing a binding preserves metadata while removing incompatible scalar mapping", () => {
  const next = JSON.parse(
    editFitsBinding(
      JSON.stringify({
        rateBasis: "device-hour",
        modelBinding: {
          field: "serverFIT",
          value: 20,
          reason: "reviewed",
          evidenceId: "e1",
        },
      }),
      1,
    ),
  );
  expect(next.modelBinding).toEqual({
    array: "fits",
    index: 1,
    reason: "reviewed",
    evidenceId: "e1",
  });
});
test("invalid JSON and conflicting primitive metadata are not silently replaced", () => {
  expect(() => editCatalogField("{", ["fit"], 1)).toThrow();
  expect(() =>
    editCatalogField('{"source":"legacy source"}', ["source", "document"], "x"),
  ).toThrow(/完整 JSON/);
  expect(() =>
    editCatalogField("{}", ["__proto__", "polluted"], true),
  ).toThrow();
});
test("published editor is disabled and explains that descriptive recovery is not a calculation parameter", () => {
  const html = renderToStaticMarkup(
    createElement(CatalogFields, {
      kind: "failure-mode",
      value: '{"fit":1000,"rateBasis":"device-hour"}',
      readOnly: true,
      onChange: () => {
        throw new Error("must not edit");
      },
    }),
  );
  expect(html).toContain('<fieldset disabled=""');
  expect(html).toContain("恢复耗时说明不会自动改变求解参数");
  expect(html).toContain("HBM");
  expect(html).toContain("GPU");
});

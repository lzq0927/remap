import { test, expect } from "vitest";
import { buildApp } from "./task-fixture";
test("published asset bindings enter the model and confirmations append immutable versions", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  try {
    const a = (
      await app.inject({
        method: "POST",
        url: "/api/catalogs",
        payload: {
          kind: "failure-mode",
          name: "Real GPU FIT",
          payload: { fit: 1000, modelBinding: { array: "fits", index: 0 } },
        },
      })
    ).json();
    for (const state of ["validated", "published"])
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/catalogs/${a.id}/${a.revision}/state`,
            payload: { state },
          })
        ).statusCode,
      ).toBe(200);
    const d = (await app.inject("/api/defaults")).json().training;
    const queued = (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          operation: "training",
          input: {
            ...d,
            hours: 24,
            trials: 2,
            assetRefs: [
              { id: a.id, revision: a.revision, contentHash: a.contentHash },
            ],
          },
        },
      })
    ).json();
    expect(queued.input.model.fits[0]).toBe(1000);
    expect(queued.input.assetSnapshot[0].contentHash).toBe(a.contentHash);
    const i = (
      await app.inject({
        method: "POST",
        url: "/api/inputs",
        payload: {
          name: "input.json",
          base64: Buffer.from('{"cards":10000}').toString("base64"),
        },
      })
    ).json();
    const c1 = (
      await app.inject({
        method: "POST",
        url: `/api/inputs/${i.id}/confirm`,
        payload: { data: { cards: 10000 } },
      })
    ).json();
    const c2 = (
      await app.inject({
        method: "POST",
        url: `/api/inputs/${c1.id}/confirm`,
        payload: { data: { cards: 20000 } },
      })
    ).json();
    expect(c2.id).not.toBe(c1.id);
    const inputs = (await app.inject("/api/inputs")).json();
    expect(inputs.find((x: any) => x.id === c1.id).data.cards).toBe(10000);
    const ambiguous = await app.inject({
      method: "POST",
      url: `/api/inputs/${i.id}/confirm`,
      payload: { data: { ambiguities: [{ field: "rate" }] } },
    });
    expect(ambiguous.json().error.code).toBe("UNRESOLVED_AMBIGUITY");
  } finally {
    await app.close();
  }
});
test("non-numeric FIT cannot be published", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  try {
    const a = (
      await app.inject({
        method: "POST",
        url: "/api/catalogs",
        payload: {
          kind: "failure-mode",
          name: "bad rate",
          payload: { fit: "unknown", rateBasis: "job-hour" },
        },
      })
    ).json();
    const v = (
      await app.inject({
        method: "POST",
        url: `/api/catalogs/${a.id}/${a.revision}/validate`,
        payload: {},
      })
    ).json();
    expect(v.issues.some((i: any) => i.code === "SCHEMA_INVALID")).toBe(true);
  } finally {
    await app.close();
  }
});

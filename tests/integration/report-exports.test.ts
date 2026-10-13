import { expect, it } from "vitest";
import { buildApp } from "./task-fixture";
import { exportTask } from "../../packages/tasks/src/portable";

it("exports concise documents, task-isolated attachments and optional offline packages without pruning stored assets", async () => {
  const app = await buildApp({ dataDir: ":memory:", autoStartRuns: false });
  try {
    const store = app.taskServices.resolve(app.testTaskId).store;
    const run: any = {
      id: "export-run",
      operation: "static",
      status: "succeeded",
      progress: 1,
      inputHash: "frozen",
      createdAt: "2026-10-13",
      input: {
        assetSnapshot: [
          {
            id: "a",
            revision: 1,
            contentHash: "asset-hash",
            payload: { evidence: "FULL_ASSET_SENTINEL" },
          },
        ],
      },
      result: { probability: 0.9, rawSamples: ["FULL_SAMPLE_SENTINEL"] },
      events: [],
    };
    store.saveRun(run);
    const html = await app.inject("/api/runs/export-run/report?format=html");
    expect(html.statusCode).toBe(200);
    expect(html.body).toContain("验证与诊断摘要");
    expect(html.body).not.toContain("FULL_ASSET_SENTINEL");
    const json = await app.inject("/api/runs/export-run/report?format=json");
    expect(json.json()).toEqual(run);
    expect(json.headers["content-disposition"]).toContain(".results.json");
    const zip = await app.inject(
      "/api/runs/export-run/report?format=md&includeTechnical=true",
    );
    expect(zip.headers["content-type"]).toBe("application/zip");
    expect(zip.rawPayload.readUInt32LE(0)).toBe(0x04034b50);
    const descriptor = (
      await app.inject("/api/runs/export-run/report?format=manifest")
    ).json();
    expect(descriptor.offlinePackage.href).toContain(
      `/api/tasks/${app.testTaskId}/runs/export-run/report?format=zip`,
    );
    expect(descriptor.attachment.filename).toBe(
      "reliability-export-run.results.json",
    );
    const other = app.taskServices.create("Other");
    expect(
      (
        await app.inject(
          `/api/tasks/${other.id}/runs/export-run/report?format=json`,
        )
      ).statusCode,
    ).toBe(404);
    expect(store.getRun(run.id)).toEqual(run);
    expect(
      JSON.parse(
        exportTask(app.taskServices, app.testTaskId).rows.runs[0].payload,
      ),
    ).toEqual(run);
    run.status = "failed";
    run.error = { code: "ERROR", message: "求解异常" };
    store.saveRun(run);
    const diagnostic = await app.inject(
      "/api/runs/export-run/report?format=html",
    );
    expect(diagnostic.body).toContain("失败诊断");
    expect(diagnostic.body).not.toContain("系统成功概率");
    expect(
      (await app.inject("/api/runs/export-run/report?format=json")).headers[
        "content-disposition"
      ],
    ).toContain(".diagnostics.json");
  } finally {
    await app.close();
  }
});

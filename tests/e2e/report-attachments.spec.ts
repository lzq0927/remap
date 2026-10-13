import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
import { inflateRawSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function prepare(request: any, taskId: string) {
  const defaults = await (await request.get("/api/defaults")).json();
  const input = {
    ...defaults.audit,
    hours: 24,
    trials: 4,
    scales: [10000],
    targets: undefined,
    attribution: false,
    sensitivity: false,
    verifyRecommendation: false,
  };
  const response = await request.post(`/api/tasks/${taskId}/runs`, {
    data: { operation: "audit", input },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const started = await response.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/tasks/${taskId}/runs/${started.id}`)
          ).json()
        ).status,
    )
    .toBe("succeeded");
  const run = await (
    await request.get(`/api/tasks/${taskId}/runs/${started.id}`)
  ).json();
  await request.post(`/api/tasks/${taskId}/design`, {
    data: {
      request: defaults.training,
      scenario: "training",
      activeAssessment: "audit",
      auditDraft: draftFromAuditRequest(input),
      runId: run.id,
      stage: 5,
    },
  });
  return run;
}

for (const width of [1440, 390])
  test(`concise report and complete offline attachments at ${width}px`, async ({
    page,
    request,
    taskId,
  }, testInfo) => {
    const run = await prepare(request, taskId);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?task=${taskId}`);
    const result = page.getByRole("region", { name: "评估结果", exact: true });
    await expect(
      result.getByRole("heading", { name: "验证与诊断摘要", exact: true }),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      result.getByRole("link", { name: "下载结果 JSON", exact: true }),
    ).toHaveAttribute("href", /format=json/);
    await expect(
      result.getByText("输入快照、模型版本、来源与详细计算", { exact: true }),
    ).toHaveCount(0);
    await result.getByLabel("报告格式", { exact: true }).selectOption("md");
    await expect(
      result.getByRole("link", { name: "下载报告", exact: true }),
    ).toHaveAttribute("href", /format=md$/);
    await result.getByLabel("包含完整技术附件", { exact: true }).check();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      result.getByRole("link", { name: "下载离线报告包", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`reliability-${run.id}.zip`);
    await download.saveAs(testInfo.outputPath(download.suggestedFilename()));
    const buffer = await readFile((await download.path())!),
      directory = testInfo.outputPath("offline");
    await mkdir(directory, { recursive: true });
    let pos = 0;
    while (buffer.readUInt32LE(pos) === 0x04034b50) {
      const size = buffer.readUInt32LE(pos + 18),
        n = buffer.readUInt16LE(pos + 26),
        extra = buffer.readUInt16LE(pos + 28),
        name = buffer.subarray(pos + 30, pos + 30 + n).toString("utf8"),
        start = pos + 30 + n + extra;
      await writeFile(
        join(directory, name),
        inflateRawSync(buffer.subarray(start, start + size)),
      );
      pos = start + size;
    }
    const jsonFile = `reliability-${run.id}.results.json`;
    expect(
      JSON.parse(await readFile(join(directory, jsonFile), "utf8")),
    ).toEqual(run);
    // This file URL has no platform origin; JSON must resolve to a local sibling file.
    await page.goto(
      pathToFileURL(join(directory, `reliability-${run.id}.html`)).href,
    );
    const link = page.getByRole("link", {
      name: "完整结构化结果 JSON",
      exact: true,
    });
    await expect(link).toHaveAttribute("href", jsonFile);
    await expect(
      page.getByRole("heading", { name: "验证与诊断摘要", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`report-summary-${width}.png`),
    });
    // Chromium opens an already-local JSON file rather than emitting a download.
    await link.click();
    await expect(page).toHaveURL(pathToFileURL(join(directory, jsonFile)).href);
    expect(JSON.parse(await page.locator("body").innerText())).toEqual(run);
  });

test("failed run has a separate diagnostics area and download", async ({
  page,
  request,
  taskId,
}) => {
  const run = await prepare(request, taskId);
  run.status = "failed";
  run.error = { code: "TEST_FAILURE", message: "求解失败示例" };
  await page.route(`**/api/tasks/${taskId}/runs/${run.id}`, (route) =>
    route.fulfill({ json: run }),
  );
  await page.goto(`/?task=${taskId}`);
  const panel = page.getByRole("region", { name: "评估结果", exact: true });
  await expect(
    panel.getByRole("heading", { name: "失败诊断", exact: true }),
  ).toBeVisible({ timeout: 5000 });
  await expect(
    panel.getByRole("link", { name: "下载诊断 JSON", exact: true }),
  ).toHaveAttribute("href", /format=json/);
  await expect(
    panel.getByRole("region", { name: "组合贡献分摊", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: "下载诊断报告", exact: true }),
  ).toHaveAttribute("href", /format=html$/);
});

import { test, expect } from "./task-fixture";

test("users choose arbitrary resolved events and deployed mechanisms, then pipeline and report rank remaining candidates", async ({
  page,
  request,
  taskId,
}) => {
  const base = "/api/tasks/" + taskId;
  const defaults = (await (await request.get("/api/defaults")).json()).audit;
  const events = (await (await request.get("/api/defaults")).json())
    .auditEvents;
  const { draftFromAuditRequest } = await import(
    "../../packages/contracts/src/audit-draft"
  );
  await request.post(base + "/design", {
    data: {
      scenario: "training",
      request: {},
      activeAssessment: "audit",
      auditDraft: draftFromAuditRequest({
        ...defaults,
        cards: 10000,
        target: 0.99,
        optimization: undefined,
        scales: [10000],
        targets: undefined,
        hours: 24,
        trials: 8,
        attributionTrials: 8,
        sensitivity: false,
        mechanisms: ["sdcDetect", "step", "elastic", "fast"],
        verifyRecommendation: true,
        verificationTrials: 8,
      }),
    },
  });
  await page.goto("/?task=" + taskId);
  await page
    .getByText("已解决条件 · 重算剩余机制排序", { exact: true })
    .click();
  await page.getByLabel("已部署：静默即时检测", { exact: true }).check();
  await page.getByText(/^静默故障 ·/).click();
  await page
    .getByRole("button", { name: "假设静默故障全部消除", exact: true })
    .click();
  await page.getByText(/^中断故障 ·/).click();
  const hard = events.find((e: any) => e.type === "hard").id;
  await page.getByLabel("假设已消除：" + hard, { exact: true }).check();
  await page
    .getByLabel("已解决条件说明", { exact: true })
    .fill("公开合成条件：静默及单项中断消除，检测已部署");
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/design")).json()).assessment.input
          .baseline?.resolvedEventIds,
    )
    .toContain(hard);
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/design")).json()).assessment.input
          .baseline?.note,
    )
    .toContain("公开合成条件");
  await page.reload();
  await expect(
    page.getByLabel("已部署：静默即时检测", { exact: true }),
  ).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const design = await (await request.get(base + "/design")).json();
  const start = await request.post(base + "/workflow/automatic", {
    data: { inputRevision: design.revision },
  });
  expect(start.status()).toBe(202);
  await expect(
    page.getByText("查看冻结条件与剩余机制排序", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByText("查看冻结条件与剩余机制排序", { exact: true }).click();
  const ranking = page.getByRole("region", {
    name: "剩余机制排序",
    exact: true,
  });
  await expect(ranking).toBeVisible({ timeout: 30000 });
  await ranking.getByLabel("剩余机制排序依据").selectOption("single");
  const table = ranking.getByRole("table", { name: "剩余机制增量排序表" });
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table.locator("tbody")).not.toContainText("静默即时检测");
  await expect(table.locator("tbody")).toContainText("干净 step 恢复");
  const reportUrl = await page
    .getByRole("link", { name: "下载报告", exact: true })
    .getAttribute("href");
  const report = await (await request.get(reportUrl!)).text();
  expect(report).toContain("条件基线 / 剩余机制排序");
  expect(report).toContain("公开合成条件");
  expect(report).toContain(hard);
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/workflow")).json()).steps[5].status,
    )
    .toBe("awaiting-review");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await ranking.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/conditional-ranking-mobile.png" });
  const state = await (await request.get(base + "/workflow")).json();
  const run = await (await request.get(base + "/runs/" + state.runId)).json();
  expect(run.result.attribution[0].coalitions).toHaveLength(8);
  expect(
    run.result.rankings[0].single.find((r: any) => r.id === "step").statistics
      .mean,
  ).toBe(0);
  const describe = state.steps.find((s: any) => s.id === "describe");
  expect(
    describe.artifacts[0].data.baseline.resolvedEvents.map((e: any) => e.id),
  ).toContain(hard);
});

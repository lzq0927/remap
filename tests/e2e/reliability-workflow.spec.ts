import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
test("four desktop stages show allocation, assessment, mechanism evidence and a separate validation", async ({
  page,
  request,
  taskId,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const base = `/api/tasks/${taskId}`,
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const defaults = (await (await request.get("/api/defaults")).json()).audit;
  await request.post(base + "/design", {
    data: {
      request: {},
      scenario: "training",
      activeAssessment: "audit",
      stage: 0,
      auditDraft: draftFromAuditRequest({
        ...defaults,
        cards: 10000,
        scales: [10000],
        targets: { 10000: 0.985 },
        target: 0.985,
        hours: 600,
        trials: 4,
        attributionTrials: 2,
        verificationTrials: 8,
        sensitivity: false,
        verifyRecommendation: false,
      }),
    },
  });
  await page.goto("/?task=" + taskId);
  const nav = page.getByRole("navigation", { name: "四部分可靠性工作流" });
  await expect(nav.getByRole("button")).toHaveCount(4);
  await page
    .getByRole("button", { name: "计算并查看AGREE目标分配", exact: true })
    .click();
  const allocation = page.getByRole("region", { name: "架构上的目标分解分配" });
  await expect(allocation).toContainText("总预算 9.000 h");
  const next = page.getByRole("button", {
    name: "确认并进入下一步",
    exact: true,
  });
  await next.click();
  await expect(nav.locator('[aria-current="step"]')).toContainText(
    "可用度评估",
  );
  await page
    .getByRole("button", { name: "运行可靠性评估", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "下载报告", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  const assessed = (await (await request.get(base + "/workflow")).json())
    .assessmentRunId;
  expect(assessed).toBeTruthy();
  await next.click();
  await expect(nav.locator('[aria-current="step"]')).toContainText(
    "可靠性机制设计",
  );
  const analysis = page.getByRole("region", {
    name: "现状与目标分析工作台",
    exact: true,
  });
  await analysis
    .getByRole("button", { name: "03 可靠性机制设计", exact: true })
    .click();
  await expect(analysis).toContainText("措施收益热力图 · Shapley 分摊 / pp");
  await next.click();
  await expect(nav.locator('[aria-current="step"]')).toContainText(
    "可靠性机制验证",
  );
  await page
    .getByRole("button", { name: "独立验证机制参数", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/workflow")).json()).steps[3].status,
      { timeout: 60000 },
    )
    .toBe("awaiting-review");
  const state = await (await request.get(base + "/workflow")).json();
  expect(state.runId).not.toBe(assessed);
  await analysis
    .getByRole("button", { name: "04 可靠性机制验证", exact: true })
    .click();
  await expect(analysis).toContainText("验证采用的精确生效参数");
  await page.getByRole("button", { name: "记录交付确认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "本流程已交付", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "查看评估与Shapley快照", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
test("desktop analysis opens with baseline, allocation, horizontal sources and concrete measures, then drills into evidence", async ({
  page,
  request,
  taskId,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = `/api/tasks/${taskId}`;
  const defaults = (await (await request.get("/api/defaults")).json()).audit;
  const saved = await (
    await request.post(base + "/design", {
      data: {
        request: {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest({
          ...defaults,
          trials: 4,
          attributionTrials: 2,
          verificationTrials: 2,
          sensitivity: false,
          verifyRecommendation: false,
          scales: [10000, 500000],
          targets: { 10000: 0.985, 500000: 0.985 },
          optimization: { enabled: false },
        }),
        stage: 0,
      },
    })
  ).json();
  const started = await request.post(base + "/workflow/automatic", {
    data: { inputRevision: saved.revision },
  });
  expect(started.status()).toBe(202);
  await page.goto("/?task=" + taskId);
  const w = page.getByRole("region", {
    name: "现状与目标分析工作台",
    exact: true,
  });
  await expect(w).toBeVisible({ timeout: 60000 });
  await expect(
    w.getByRole("button", { name: "02 可用度评估", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    w.getByRole("heading", { name: "损失 → 具体可靠性措施", exact: true }),
  ).toBeVisible();
  await expect(
    w.getByRole("figure", {
      name: "责任域损失构成",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    w.getByRole("heading", { name: "子系统现状与分解目标", exact: true }),
  ).toBeVisible();
  await expect(w).toContainText("全类等效FIT");
  await w
    .getByRole("button", { name: "01 可用度目标分解分配", exact: true })
    .click();
  await expect(
    w.locator(
      '[data-contains="hardware-rack"] [data-contains="hardware-node"] [data-contains="hardware-board"] [data-contains="hardware-module"] [data-contains="hardware-chip"]',
    ),
  ).toBeVisible();
  await expect(
    w.getByRole("img", { name: "设备通信连接关系", exact: true }),
  ).toBeVisible();
  await w
    .getByLabel("分析分解层级", { exact: true })
    .selectOption("hardware-chip");
  await w.getByRole("button", { name: "CORE", exact: true }).first().click();
  const dialog = page.getByRole("dialog", {
    name: "子系统分解详情",
    exact: true,
  });
  await expect(dialog).toContainText("CORE-hard");
  await expect(dialog).toContainText("等效FIT");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await w.getByLabel("更多分析视图", { exact: true }).selectOption("research");
  await expect(w).toContainText("2026-10-19");
  await expect(w).toContainText("FTAR");
  await expect(w).toContainText("37,656");
  await expect(w).toContainText("14.92%");
  await w.getByLabel("分析规模", { exact: true }).selectOption("10000");
  await w.getByLabel("更多分析视图", { exact: true }).selectOption("scales");
  await expect(w).toContainText("10,000卡");
  await expect(w).toContainText("500,000卡");
  await w.getByRole("button", { name: "全屏分析", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "可靠性分析全屏", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await w
    .getByRole("button", { name: "导出当前分析 HTML", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("ReMAP-10000-scales.html");
  const legacy = page
    .locator("details")
    .filter({
      has: page.getByText("补充查看原有方案收益、贡献与敏感性", {
        exact: true,
      }),
    })
    .first();
  await page
    .getByText("补充查看原有方案收益、贡献与敏感性", { exact: true })
    .click();
  await page.getByRole("tab", { name: "方案收益", exact: true }).click();
  await expect(legacy).toHaveJSProperty("open", true);
  await expect(
    page.getByRole("heading", { name: "单项与组合方案收益对照", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

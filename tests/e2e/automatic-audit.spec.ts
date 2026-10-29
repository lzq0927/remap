import { test, expect } from "./task-fixture";

test("allocation choices and the automatic Agent pipeline share visible stages and a real downloadable report", async ({
  page,
  request,
  taskId,
}) => {
  const base = "/api/tasks/" + taskId;
  await page.goto("/?task=" + taskId);
  const panel = page.getByRole("region", { name: "故障事件与机制收益审核" });
  await expect(panel).toBeVisible();
  await panel
    .getByText("高级：独立子模型与第一轮损失预算", { exact: true })
    .click();
  await panel
    .getByLabel("训练损失预算分配方法", { exact: true })
    .selectOption("baseline-proportional");
  await panel.getByLabel("启用对象目标分配", { exact: true }).check();
  await panel
    .getByLabel("子模型分配方法", { exact: true })
    .selectOption("agree");
  await panel
    .getByLabel("同步对比 Equal、ARINC、AGREE", { exact: true })
    .check();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    panel
      .getByRole("table", { name: "分配方法对比" })
      .getByText("AGREE · 复杂度与重要度加权", { exact: true }),
  ).toBeAttached();
  await panel.getByLabel("子模型目标", { exact: true }).fill("97");
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/design")).json())?.assessment?.input
          ?.submodelAllocation?.target,
    )
    .toBe(0.97);
  const saved = await (await request.get(base + "/design")).json();
  // Keep a real solver and a small explicit browser fixture, rather than mocking results.
  saved.auditDraft.request = {
    ...saved.auditDraft.request,
    hours: 24,
    trials: 8,
    attributionTrials: 4,
    sensitivityTrials: 4,
    sensitivity: false,
    mechanisms: ["sdcDetect", "step"],
    verificationTrials: 4,
  };
  saved.auditDraft.allScales = false;
  const design = await (
    await request.post(base + "/design", {
      data: { ...saved, expectedRevision: saved.revision },
    })
  ).json();
  await page.reload();
  await expect(page.locator("#audit-scope")).toBeAttached();
  await page.locator("#audit-run").scrollIntoViewIfNeeded();
  const started = await request.post(base + "/workflow/automatic", {
    data: { inputRevision: design.revision },
  });
  expect(started.status()).toBe(202);
  const navigation = page.getByRole("navigation", {
    name: "四部分可靠性工作流",
  });
  await expect(navigation.getByRole("button")).toHaveCount(4);
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/workflow")).json()).steps[3].status,
      { timeout: 60000 },
    )
    .toBe("awaiting-review");
  await expect(navigation.locator('[aria-current="step"]')).toContainText(
    "可靠性机制验证",
  );
  await expect(page.locator(".workflow-current")).toContainText("独立DES验证");
  await expect(
    page.getByRole("heading", {
      name: "可靠性设计与评估 · 结果",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "记录交付确认", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("自动完成 · 待总审", { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByLabel("本次目标分配产物", { exact: true }),
  ).toBeVisible();
  const url = await page
    .getByRole("link", { name: "下载报告", exact: true })
    .getAttribute("href");
  const report = await (await request.get(url!)).text();
  expect(report).toContain("自动流水线报告 · 待人工审核");
  expect(report).toContain("baseline-proportional");
  expect(report).toContain("agree");
  expect(report).toContain("Shapley");
  await page.getByRole("button", { name: "记录交付确认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "本流程已交付", exact: true }),
  ).toBeDisabled();
});

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
    .getByLabel("训练损失预算分配方法", { exact: true })
    .selectOption("baseline-proportional");
  await panel
    .getByText("子模型目标分配 · Equal / ARINC / AGREE / Availability", {
      exact: true,
    })
    .click();
  await panel.getByLabel("启用独立子模型分配", { exact: true }).check();
  await panel
    .getByLabel("子模型分配方法", { exact: true })
    .selectOption("agree");
  await panel
    .getByLabel("同步对比 Equal、ARINC、AGREE", { exact: true })
    .check();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    panel.getByText("AGREE · 加权任务可靠度", { exact: true }),
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
  for (const [index, anchor] of [
    "audit-scope",
    "audit-evidence",
    "audit-budget",
    "audit-parameters",
  ].entries()) {
    const current = page
      .getByRole("navigation", { name: "六阶段评估流程" })
      .locator('[aria-current="step"]');
    await expect(current).toContainText(
      ["目标与口径", "故障与证据", "预算与措施", "参数核对"][index],
    );
    await expect(page.locator(".workflow-current")).toContainText("过程产物：");
    await expect
      .poll(async () =>
        page.locator("#" + anchor).evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const dock = document
            .querySelector(".workflow-dock")!
            .getBoundingClientRect();
          return (
            rect.top >= dock.bottom - 2 && rect.top < window.innerHeight - 40
          );
        }),
      )
      .toBe(true);
  }
  await expect(
    page.getByRole("heading", {
      name: "事件与机制收益审核 · 保留干净检查点",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "记录交付确认", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("自动完成 · 待总审", { exact: true }),
  ).toHaveCount(5);
  await expect(
    page.getByText("本次目标分配 · 冻结于措施评估前", { exact: true }),
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

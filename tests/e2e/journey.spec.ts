import { test, expect } from "./task-fixture";

test("all professional tools run from the UI, results replay and decisions persist", async ({
  page,
  request,
  taskId,
}) => {
  test.setTimeout(120000);
  const defaults = await (await request.get("/api/defaults")).json();
  await request.post(`/api/tasks/${taskId}/design`, {
    data: {
      request: { ...defaults.training, cards: 10000, hours: 24, trials: 4 },
      scenario: "training",
    },
  });
  await page.goto(`/?task=${taskId}`);
  await page.getByRole("button", { name: "方法与工具", exact: true }).click();
  let lastRun: any;
  for (const [operation, label] of [
    ["allocate", "指标分配"],
    ["rbd", "可靠性框图"],
    ["fta", "故障树"],
    ["bdd", "共享事件 BDD"],
    ["ctmc", "马尔科夫"],
    ["compare", "方案比较"],
    ["search", "目标达成搜索"],
    ["sensitivity", "敏感性"],
    ["attribute", "Shapley 收益"],
    ["estimateRate", "事件频率估计"],
  ]) {
    await page
      .locator(".tool-grid")
      .getByRole("button", { name: label, exact: true })
      .click();
    for (const method of operation === "allocate"
      ? ["EQUAL", "ARINC", "AGREE · NASA 2016", "AVAILABILITY"]
      : [null]) {
      if (method)
        await page.getByRole("button", { name: method, exact: true }).click();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/api/tasks/${taskId}/runs`) &&
          r.request().method() === "POST",
      );
      await page.getByRole("button", { name: /^执行/ }).click();
      lastRun = await (await response).json();
      expect(lastRun.operation).toBe(operation);
      await expect
        .poll(
          async () =>
            (
              await (
                await request.get(`/api/tasks/${taskId}/runs/${lastRun.id}`)
              ).json()
            ).status,
          { timeout: 30000 },
        )
        .toBe("succeeded");
      await expect(
        page
          .getByRole("region", { name: "评估结果", exact: true })
          .getByRole("link", { name: "下载报告" }),
      ).toHaveAttribute("href", new RegExp(lastRun.id));
    }
  }
  await page.getByRole("button", { name: "实验与报告", exact: true }).click();
  await page
    .getByLabel("方案反馈理由")
    .fill("浏览器走查：已核对输入口径与结果，保留校准项。");
  await page.getByRole("button", { name: "调整后采纳", exact: true }).click();
  await expect(page.getByText(/^已保存：调整后采纳/)).toBeVisible();
  await page.getByRole("button", { name: "方法与工具", exact: true }).click();
  await page.getByRole("button", { name: "实验与报告", exact: true }).click();
  await expect(page.getByText(/^已保存：调整后采纳/)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: lastRun.id.slice(0, 8) });
  const replay = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/runs/${lastRun.id}/replay`) &&
      r.request().method() === "POST",
  );
  await row.getByRole("button", { name: "重放", exact: true }).click();
  const rerun = await (await replay).json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/tasks/${taskId}/runs/${rerun.id}`)
          ).json()
        ).status,
    )
    .toBe("succeeded");
  await expect(
    page.getByRole("link", { name: "下载报告", exact: true }),
  ).toHaveAttribute("href", new RegExp(rerun.id));
});

test("page changes start at the top, missing delivery guides back and traditional tools stay usable", async ({
  page,
  taskId,
}) => {
  await page.goto(`/?task=${taskId}`);
  await page
    .getByRole("navigation", { name: "六阶段评估流程" })
    .getByRole("button")
    .nth(5)
    .click();
  await expect(
    page.getByRole("heading", { name: "尚无可交付的评估结果" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "前往计算", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "运行事件与机制审核" }),
  ).toBeInViewport();
  for (const label of [
    "输入与来源",
    "资产库",
    "方法与工具",
    "实验与报告",
    "连接与配置",
    "可靠性设计工作台",
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: label, exact: true }),
    ).toBeInViewport();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 1600));
  }
  await page.getByRole("button", { name: /传统系统/ }).click();
  await expect(
    page.getByRole("navigation", { name: "六阶段评估流程" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "进入专业方法工具" }).click();
  await expect(
    page.getByRole("button", { name: "执行可靠性框图", exact: true }),
  ).toBeVisible();
});

test("a task bundle exports and imports through the task homepage", async ({
  page,
  taskId,
  request,
}) => {
  const task = await (await request.get(`/api/tasks/${taskId}`)).json();
  await page.goto("/");
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: task.name, exact: true }),
  });
  const link = card.getByRole("link", { name: /导出/ });
  const bundleResponse = await request.get((await link.getAttribute("href"))!);
  expect(bundleResponse.ok()).toBe(true);
  const bundle = await bundleResponse.body();
  await page.getByLabel("导入任务包").setInputFiles({
    name: "walkthrough-task.json",
    mimeType: "application/json",
    buffer: bundle,
  });
  await expect(page.getByLabel("当前任务")).toContainText(task.name);
  await expect(page).not.toHaveURL(new RegExp(`task=${taskId}`));
});

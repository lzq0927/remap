import { selectAssessment } from "./model-selection";
import { test, expect } from "./task-fixture";
test("review workflow runs the chosen expert metric and downloads a complete audit", async ({
  page,
  request,
  taskId,
}) => {
  test.setTimeout(90000);
  await page.goto("/?task=" + taskId);
  const panel = page.getByRole("region", { name: "故障事件与机制收益审核" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("审核窗口（小时）", { exact: true }).fill("24");
  await panel.getByText("基线参数、机制目标与成本", { exact: true }).click();
  await panel.getByLabel("每场景轨迹数", { exact: true }).fill("8");
  await panel.getByLabel("每组合轨迹数", { exact: true }).fill("8");
  await panel
    .getByText("内网中断数据替换与硬件降 FIT", { exact: true })
    .click();
  await panel
    .getByLabel("基线事件更新事件", { exact: true })
    .selectOption("CORE-hard");
  await panel.getByLabel("基线事件更新FIT", { exact: true }).fill("420");
  await panel
    .getByLabel("基线事件更新来源", { exact: true })
    .fill("synthetic browser fixture");
  await panel
    .getByRole("group", { name: "基线事件更新", exact: true })
    .getByRole("button", { name: "加入更新" })
    .click();
  await panel.getByLabel("同时对比万卡、十万卡、二十万卡、五十万卡").check();
  await panel.getByLabel("100,000 卡目标（0–1）").fill("0.943");
  for (let step = 0; step < 4; step++)
    await page
      .getByRole("button", { name: "确认并进入下一步", exact: true })
      .click();
  await expect(
    page.getByRole("heading", { name: "计算与权衡", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "运行可靠性评估" }).click();
  await expect(
    page.getByText("事件与机制收益审核 · 保留干净检查点", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("region", { name: "预算与实际损失" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "候选决策与独立复核" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "确认并进入下一步", exact: true })
    .click();
  await page.getByRole("button", { name: "记录交付确认", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${taskId}/workflow`)).json())
          .status,
    )
    .toBe("succeeded");
  await expect(
    page.getByRole("button", { name: "本流程已交付", exact: true }),
  ).toBeDisabled();
  const link = page.getByRole("link", { name: "下载报告", exact: true });
  await expect(link).toBeVisible();
  const url = await link.getAttribute("href");
  const response = await request.get(url!);
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain("synthetic browser fixture");
  expect(html).toContain("CORE-hard");
  expect(html).toContain("独立故障事件库");
  expect(html).toContain("关键参数敏感性");
  expect(html).toContain("候选选择与独立验证");
  expect(html).toContain("94.3%");
  const preview = await page.context().newPage();
  await preview.setContent(html);
  await expect(preview.getByText("从产出缺口，定位设计重点")).toBeVisible();
  await preview.getByLabel("摘要规模").selectOption("500000");
  await expect(preview.locator('[data-summary-scale="500000"]')).toBeVisible();
  await expect(preview.locator('[data-summary-scale="10000"]')).toBeHidden();
  const library = preview.locator("section").filter({
    has: preview.getByRole("heading", {
      name: "04 / 独立故障事件库",
      exact: true,
    }),
  });
  await library.getByLabel("事件类型", { exact: true }).selectOption("中断");
  await library.getByLabel("筛选表格").fill("CORE-hard");
  await expect(library.locator("tbody tr:visible")).toHaveCount(1);
  await expect(library.getByRole("status")).toHaveText("1 / 54 条");
  await preview.getByRole("button", { name: "展开机制明细" }).click();
  await expect(preview.locator("section>details:not([open])")).toHaveCount(0);
  await preview.emulateMedia({ media: "print" });
  await expect(library.locator("tbody tr:visible")).toHaveCount(54);
  await preview.close();
  await page.getByLabel("结果规模").selectOption("100000");
  await expect(
    page.getByText(/100,000 卡 · 24 小时 · 目标 94.300%/),
  ).toBeVisible();
  await page.getByLabel("结果规模").selectOption("500000");
  await expect(
    page.getByText("产出损失去了哪里", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "审核输入已改变；下方结果与下载报告保留上次运行快照，请重新运行后比较。",
      { exact: true },
    ),
  ).toHaveCount(0);
  await panel.getByLabel("审核产出目标（0–1）", { exact: true }).fill("0.98");
  await expect(
    page.getByText(
      "审核输入已改变；下方结果与下载报告保留上次运行快照，请重新运行后比较。",
      { exact: true },
    ),
  ).toBeVisible();
  const run = (
    await (await request.get(`/api/tasks/${taskId}/runs`)).json()
  ).find((r: any) => r.operation === "audit");
  const detail = await (
    await request.get(`/api/tasks/${taskId}/runs/${run.id}`)
  ).json();
  expect(detail.result.metricId).toBe("training.retained-clean-progress");
  expect(detail.result.events.find((e: any) => e.id === "CORE-hard").fit).toBe(
    420,
  );
  await page
    .getByRole("button", { name: "载入建议组合，重新确认", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${taskId}/design`)).json())
          .assessment.input.mechanisms,
    )
    .toEqual(detail.result.recommendation.chosen.mechanisms);
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${taskId}/workflow`)).json())
          .stale,
    )
    .toBe(true);
});

test("audit layout is readable on mobile and metric switching preserves current edits", async ({
  page,
  taskId,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?task=" + taskId);
  await page.getByLabel("审核卡数", { exact: true }).fill("20000");
  await selectAssessment(page, "workflow");
  await expect(page.getByLabel("集群卡数", { exact: true })).toBeVisible();
  await selectAssessment(page, "audit");
  await expect(page.getByLabel("审核卡数", { exact: true })).toHaveValue(
    "20000",
  );
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${taskId}/design`)).json())
          ?.auditDraft?.request?.cards,
    )
    .toBe(20000);
  await page.reload();
  await expect(page.getByLabel("审核卡数", { exact: true })).toHaveValue(
    "20000",
  );
  await page.getByRole("button", { name: "资产库", exact: true }).click();
  await page
    .getByRole("button", { name: "可靠性设计与评估", exact: true })
    .click();
  await expect(page.getByLabel("审核卡数", { exact: true })).toHaveValue(
    "20000",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

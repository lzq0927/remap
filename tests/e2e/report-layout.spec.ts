import { test, expect } from "./task-fixture";

for (const width of [1440, 390]) {
  test(`expert report charts and long provenance remain readable at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const defaults = await (await request.get("/api/defaults")).json();
    const source =
      "排版验收：中断事件数据来源，待内网校准。" +
      "统计对象为单作业 NPU 等效业务影响事件，原始中断记录需复核事件归并、运行暴露与类内分配；静默与亚健康保留外网先验。".repeat(
        5,
      );
    const run = await (
      await request.post(`/api/tasks/${taskId}/runs`, {
        data: {
          operation: "audit",
          input: {
            ...defaults.audit,
            hours: 24,
            trials: 16,
            scales: [10000, 100000, 200000, 500000],
            attribution: false,
            verifyRecommendation: false,
            eventOverrides: [
              {
                id: "CORE-hard",
                fit: 420,
                rateBasis: "npu-equivalent-hour",
                source,
                evidence: "scenario",
              },
            ],
          },
        },
      })
    ).json();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/tasks/${taskId}/runs/${run.id}`)
            ).json()
          ).status,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    const detail = await (
      await request.get(`/api/tasks/${taskId}/runs/${run.id}`)
    ).json();
    const response = await request.get(
      `/api/tasks/${taskId}/runs/${run.id}/report?format=html`,
    );
    expect(response.ok()).toBe(true);
    await page.setContent(await response.text());
    await expect(
      page.getByRole("img", {
        name: "规模增大后，正确产出如何变化",
        exact: true,
      }),
    ).toBeVisible();
    const curve = page.getByRole("img", {
      name: "规模增大后，正确产出如何变化",
      exact: true,
    });
    await expect(curve.locator('g[data-value="500000"]')).toHaveCount(4);
    const frozenBase = detail.result.rows.find(
      (row: any) => row.cards === 500000 && row.id === "base",
    );
    expect(
      await curve
        .locator('g[data-value="500000"]')
        .first()
        .getAttribute("data-mean"),
    ).toBe(String(frozenBase.statistics.mean));
    await page
      .getByLabel("方案收益对照规模", { exact: true })
      .selectOption("500000");
    await expect(page.locator('[data-gain-scale="500000"]')).toBeVisible();
    await expect(page.locator('[data-gain-scale="10000"]')).toBeHidden();
    await curve.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/report-review/curves-${width}.png`,
    });

    const library = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "04 / 独立故障事件库",
        exact: true,
      }),
    });
    await library.getByLabel("筛选表格").fill("排版验收");
    await expect(library.locator("tbody tr:visible")).toHaveCount(1);
    const row = library.locator("tbody tr:visible").first();
    await expect(row.locator("td").last()).toHaveText("方案假设查看来源 ↗");
    expect(await row.boundingBox().then((box) => box!.height)).toBeLessThan(
      130,
    );
    await library.locator(".event-library-table").evaluate((wrap) => {
      wrap.scrollLeft = wrap.scrollWidth;
    });
    await library
      .getByRole("heading", { name: "04 / 独立故障事件库", exact: true })
      .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: `artifacts/report-review/event-library-${width}.png`,
    });
    await row.getByRole("link", { name: "查看来源 ↗", exact: true }).click();
    const sourceDetail = library.locator(".event-source[open]");
    await expect(sourceDetail).toHaveCount(1);
    await expect(sourceDetail.locator("dd").nth(1)).toHaveText(source);
    const sourceWidth = await sourceDetail.locator("dd").nth(1).boundingBox();
    expect(sourceWidth!.width).toBeGreaterThan(width === 390 ? 240 : 900);
    await sourceDetail.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/report-review/event-source-${width}.png`,
    });

    const sensitivity = page.getByRole("img", {
      name: "静默检出率对正确产出的影响",
      exact: true,
    });
    await expect(sensitivity).toBeVisible();
    await sensitivity.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/report-review/sensitivity-${width}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.emulateMedia({ media: "print" });
    await expect(library.locator("tbody tr:visible")).toHaveCount(54);
    await expect(
      library.locator(".event-source").last().locator("dl"),
    ).toBeVisible();
    expect(
      await library
        .locator(".event-source dl")
        .first()
        .evaluate((node) => getComputedStyle(node).display),
    ).toBe("grid");
    expect(
      await library
        .locator("table")
        .evaluate(
          (table) =>
            table.getBoundingClientRect().width <=
            table.closest("section")!.getBoundingClientRect().width,
        ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await library
      .getByRole("heading", { name: "04 / 独立故障事件库", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/report-review/print-${width}.png`,
    });
    if (width === 1440)
      await page.pdf({
        path: "artifacts/report-review/report-print.pdf",
        preferCSSPageSize: true,
        printBackground: true,
      });
    await page.emulateMedia({ media: "screen" });
    await page.goto(`/?task=${taskId}`);
    await page.getByRole("button", { name: "实验与报告", exact: true }).click();
    await page
      .getByRole("button", { name: run.id.slice(0, 8), exact: true })
      .click();
    await expect(
      page.getByRole("img", {
        name: "规模增大后，正确产出如何变化",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "静默检出率对正确产出的影响",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("结果规模", { exact: true }).selectOption("500000");
    await expect(
      page.getByRole("heading", {
        name: "500,000 卡 · 单项与组合方案收益对照",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

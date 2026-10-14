import { test, expect } from "./task-fixture";
import {
  auditDefaultTargets,
  auditScalePresets,
} from "../../packages/contracts/src/audit-presets";

for (const width of [1440, 390]) {
  test(`expert report and four default output targets work end to end at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`/?task=${taskId}`);
    const panel = page.getByRole("region", { name: "故障事件与机制收益审核" });
    const target = panel.getByLabel("可用度目标（0–1）", { exact: true });
    const cards = panel.getByLabel("评估卡数", { exact: true });
    await expect(target).toHaveValue("0.985");
    await expect(
      panel.getByLabel("同时对比五十万卡、二十万卡、十万卡、万卡"),
    ).toBeChecked();
    for (const { cards: n, target: t } of auditScalePresets.filter(
      (p) => p.cards !== 500000,
    ))
      await expect(
        panel.getByLabel(`${n.toLocaleString()} 卡目标（0–1）`, {
          exact: true,
        }),
      ).toHaveValue(String(t));
    await expect(panel.getByLabel("采样配置", { exact: true })).toHaveValue(
      "expert-reproduction",
    );
    await expect(
      panel.getByText("载入专家六项及参数", { exact: true }),
    ).toBeVisible();
    await panel.getByLabel("采样配置", { exact: true }).selectOption("quick");
    await cards.fill("500000");
    await expect(target).toHaveValue("0.985");
    await target.fill("0.82");
    await cards.fill("10000");
    await expect(
      panel.getByLabel("500,000 卡目标（0–1）", { exact: true }),
    ).toHaveValue("0.82");
    await panel
      .getByLabel("500,000 卡目标（0–1）", { exact: true })
      .fill("0.985");
    await panel.getByLabel("评估窗口（小时）", { exact: true }).fill("24");
    await panel.getByText("参数核对", { exact: true }).click();
    await expect(
      panel.getByLabel("敏感性比较口径", { exact: true }),
    ).toHaveValue("expert-reproduction");
    await panel.getByLabel("每场景轨迹数", { exact: true }).fill("8");
    await panel.getByLabel("每组合轨迹数", { exact: true }).fill("4");
    await panel.getByLabel("每扫描点轨迹数", { exact: true }).fill("4");
    await panel.getByLabel("独立复核轨迹数", { exact: true }).fill("4");
    await panel.getByText("参数核对", { exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/expert-alignment/default-targets-${width}.png`,
    });
    for (let i = 0; i < 4; i++)
      await page
        .getByRole("button", { name: "确认并进入下一步", exact: true })
        .click();
    await panel
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "下载报告", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    for (const name of [
      "弹性全局协调暂停对可用度的影响",
      "step 回滚上限对可用度的影响",
    ])
      await expect(page.getByRole("img", { name, exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "确认并进入下一步", exact: true })
      .click();
    await page
      .getByRole("button", { name: "记录交付确认", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "本流程已交付", exact: true }),
    ).toBeDisabled();
    const run = (
      await (await request.get(`/api/tasks/${taskId}/runs`)).json()
    ).find((r: any) => r.operation === "audit");
    const frozen = (
      await (await request.get(`/api/tasks/${taskId}/runs/${run.id}`)).json()
    ).result;
    expect(frozen.request.targets).toEqual(auditDefaultTargets);
    expect(frozen.sensitivity).toHaveLength(13);
    expect(frozen.request.scales).toContain(1000);
    expect(frozen.request.targets["1000"]).toBeUndefined();
    expect(frozen.referenceComparison.matchesReference).toBe(false);
    expect(frozen.sensitivity.every((s: any) => s.cards === 500000)).toBe(true);
    await page.getByLabel("结果规模", { exact: true }).selectOption("1000");
    await expect(
      page.locator(".workspace-result-panel .reliability-block-view"),
    ).toContainText("本规模仅为参考点，不判定达标");
    await page.getByLabel("结果规模", { exact: true }).selectOption("10000");
    await expect(
      page.getByRole("note").filter({ hasText: /快速试算 \/ 低采样结果/ }),
    ).toBeVisible();
    const html = await (
      await request.get(
        `/api/tasks/${taskId}/runs/${run.id}/report?format=html`,
      )
    ).text();
    const preview = await page.context().newPage();
    await preview.setContent(html);
    if (width === 390) {
      expect(
        await preview
          .locator(".actual-combination .table-wrap")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await preview.locator(".actual-combination").screenshot({
        path: "artifacts/expert-alignment/combination-mobile.png",
      });
    }
    await expect(
      preview.getByText("机制匹配与失败回退", { exact: true }),
    ).toBeVisible();
    const scope = preview.locator("section").filter({
      has: preview.getByRole("heading", {
        name: "01 / 确认口径与数据证据",
        exact: true,
      }),
    });
    await expect(
      scope.getByRole("row").filter({ hasText: "500,000" }),
    ).toContainText("98.5%");
    await expect(
      scope.getByRole("row").filter({ hasText: "500,000" }),
    ).toContainText("0.6");
    const library = preview.locator("section").filter({
      has: preview.getByRole("heading", {
        name: "04 / 独立故障事件库",
        exact: true,
      }),
    });
    await library.getByLabel("隐藏零FIT事件", { exact: true }).check();
    await expect(library.locator("tbody tr:visible")).toHaveCount(
      frozen.events.filter((e: any) => e.fit > 0).length,
    );
    await library.getByLabel("隐藏零FIT事件", { exact: true }).uncheck();
    await library
      .getByLabel("筛选表格", { exact: true })
      .fill("芯片内细分假设");
    await expect(library.locator("tbody tr:visible")).not.toHaveCount(0);
    await library.getByLabel("筛选表格", { exact: true }).fill("CORE-hard");
    await library
      .getByLabel("事件库规模", { exact: true })
      .selectOption("500000");
    await expect(library.locator("tbody tr:visible")).toHaveCount(1);
    const source = frozen.events.find((e: any) => e.id === "CORE-hard");
    const format = (v: number) =>
      v.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
    await expect(
      library.locator("tbody tr:visible").locator("td").nth(4),
    ).toHaveText(format(1e9 / (500000 * source.fit)));
    await library
      .getByRole("link", { name: "查看来源 ↗", exact: true })
      .click();
    await expect(library.locator(".event-source[open]")).toContainText(
      "芯片内细分假设；非白皮书器件FIT",
    );
    const mechanism = preview.locator("section>details").filter({
      has: preview.locator("summary").filter({ hasText: /^R-ELASTIC\s*\// }),
    });
    await mechanism.locator("summary").click();
    await mechanism
      .getByLabel("逐事件对照规模", { exact: true })
      .selectOption("500000");
    await mechanism.getByLabel("筛选表格", { exact: true }).fill("CORE-hard");
    await expect(
      mechanism.locator("tbody tr:visible").last().locator("td").nth(2),
    ).toHaveText(
      format(
        frozen.rows.find((r: any) => r.id === "base" && r.cards === 500000)
          .perEvent["CORE-hard"]?.downtime ?? 0,
      ),
    );
    await mechanism.getByLabel("筛选表格", { exact: true }).fill("");
    await expect(mechanism.locator("tbody tr:visible").last()).toContainText(
      "公共保存开销",
    );
    for (const [name, file] of [
      ["弹性全局协调暂停对可用度的影响", "elastic"],
      ["step 回滚上限对可用度的影响", "step"],
    ])
      await preview
        .getByRole("img", { name, exact: true })
        .locator("xpath=ancestor::figure")
        .screenshot({
          path: `artifacts/expert-alignment/${file}-sensitivity-${width}.png`,
        });
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview.emulateMedia({ media: "print" });
    await expect(library.locator("tbody tr:visible")).toHaveCount(54);
    await expect(
      library.locator(".event-source").last().locator("dl"),
    ).toBeVisible();
    if (width === 1440)
      await preview.pdf({
        path: "artifacts/expert-alignment/acceptance-report.pdf",
        preferCSSPageSize: true,
        printBackground: true,
      });
    await preview.close();
  });
}

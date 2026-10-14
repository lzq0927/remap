import { test, expect } from "./task-fixture";
import {
  auditDefaultTargets,
  auditReferenceMechanisms,
} from "../../packages/contracts/src/audit-presets";
test.use({ fullWorkspace: false });

for (const width of [1440, 390]) {
  test(`new AI cluster task completes the default example at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`/?task=${taskId}`);
    await expect(page.getByLabel("采样配置", { exact: true })).toHaveValue(
      "expert-reproduction",
    );
    await page.getByLabel("采样配置", { exact: true }).selectOption("quick");
    await expect(
      page.getByLabel("可用度目标（0–1）", { exact: true }),
    ).toHaveValue("0.99");
    const stages = page
      .getByRole("navigation", { name: "六阶段评估流程" })
      .getByRole("button");
    const next = async (stage: number) => {
      await page
        .getByRole("button", { name: "确认并进入下一步", exact: true })
        .click();
      await expect(stages.nth(stage)).toHaveAttribute("aria-current", "step");
    };
    await next(1);
    await expect(
      page.getByRole("region", { name: "分类故障模式库" }),
    ).toContainText("18 类 · 54 个模式");
    await next(2);
    await next(3);
    await expect(page.locator(".mechanism-option input:checked")).toHaveCount(
      6,
    );
    await next(4);
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    const base = `/api/tasks/${taskId}`;
    const flow = async () => (await request.get(base + "/workflow")).json();
    await expect
      .poll(async () => (await flow()).steps[4].status, { timeout: 60000 })
      .toBe("awaiting-review");
    const result = (
      await (await request.get(base + "/runs/" + (await flow()).runId)).json()
    ).result;
    expect(result.request.targets).toEqual(auditDefaultTargets);
    expect(result.request.mechanisms).toEqual(auditReferenceMechanisms);
    expect(result.attribution).toHaveLength(4);
    expect(result.attribution.some((a: any) => a.cards === 1000)).toBe(false);
    expect(result.recommendation.verification).toBeTruthy();
    await expect(
      page.getByLabel("结果规模", { exact: true }).locator("option"),
    ).toHaveCount(5);
    await page.getByRole("tab", { name: "可靠性框图", exact: true }).click();
    const diagram = page.locator(
      ".workspace-result-panel:not([hidden]) .reliability-block-view",
    );
    await expect(diagram.locator("svg [data-object]")).toHaveCount(18);
    await diagram.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/ai-cluster/diagram-${width}.png`,
    });
    await page.getByRole("tab", { name: "结论概览", exact: true }).click();
    await page.locator(".audit-verdict").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/ai-cluster/overview-${width}.png`,
    });
    await next(5);
    await page
      .getByRole("button", { name: "记录交付确认", exact: true })
      .click();
    await expect.poll(async () => (await flow()).status).toBe("succeeded");
    const reportLink = page.getByRole("link", {
      name: "下载报告",
      exact: true,
    });
    const report = await request.get((await reportLink.getAttribute("href"))!);
    expect(report.ok()).toBe(true);
    expect(await report.text()).toContain("可靠性框图与对象改善");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

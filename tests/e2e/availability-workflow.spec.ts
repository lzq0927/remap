import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });

for (const width of [1440, 390]) {
  test(`six availability stages, catalogue, allocation and selective review at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const defaults = await (await request.get("/api/defaults")).json(),
      base = `/api/tasks/${taskId}`;
    const input = {
      ...defaults.audit,
      samplingProfile: "custom",
      cards: 10000,
      target: 0.99,
      scales: [10000],
      targets: { "10000": 0.99 },
      hours: 24,
      trials: 16,
      attributionTrials: 8,
      sensitivity: false,
      verifyRecommendation: true,
      verificationTrials: 8,
      mechanisms: ["sdcDetect", "step", "fast"],
    };
    const saved = await request.post(base + "/design", {
      data: {
        scenario: "training",
        activeAssessment: "audit",
        request: defaults.training,
        auditDraft: draftFromAuditRequest(input),
      },
    });
    expect(saved.ok()).toBe(true);
    await page.goto(`/?task=${taskId}`);
    const navigation = page.getByRole("navigation", { name: "六阶段评估流程" }),
      stages = navigation.getByRole("button");
    for (const [i, label] of [
      "可用度目标",
      "故障模式",
      "可用度分配",
      "可靠性措施",
      "计算与权衡",
      "验证与交付",
    ].entries())
      await expect(stages.nth(i)).toContainText(label);
    const confirm = () =>
      page
        .getByRole("button", { name: "确认并进入下一步", exact: true })
        .click();
    const current = async () => (await request.get(base + "/workflow")).json();
    const screenshot = async (name: string) => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/availability-workflow/${name}-${width}.png`,
      });
    };
    await expect(
      page.locator(".audit-workbench").getByLabel("可用度目标（0–1）", { exact: true }),
    ).toHaveValue("0.99");
    await confirm();
    const catalogue = page.getByRole("region", { name: "分类故障模式库" });
    await expect(catalogue).toContainText("18 类 · 54 个模式");
    await catalogue.getByLabel("筛选对象类型").selectOption("计算与板卡");
    await catalogue.getByLabel("筛选故障类型").selectOption("hard");
    await catalogue.getByLabel("查找故障模式").fill("CORE-hard");
    await expect(catalogue.locator(".fault-mode")).toHaveCount(1);
    await expect(catalogue.locator(".fault-mode")).toContainText("FIT");
    await expect(catalogue.locator(".fault-mode")).toContainText("类内");
    await catalogue.getByLabel("查找故障模式").fill("");
    await catalogue.getByLabel("筛选故障类型").selectOption("");
    await catalogue.getByLabel("筛选对象类型").selectOption("");
    expect(
      (await catalogue.locator("thead").boundingBox())!.height,
    ).toBeLessThan(50);
    await screenshot("fault-modes");
    await confirm();
    await page
      .getByText("高级：独立子模型与第一轮损失预算", { exact: true })
      .click();
    await page.getByLabel("启用对象目标分配", { exact: true }).check();
    await page
      .getByLabel("子模型分配方法", { exact: true })
      .selectOption("arinc");
    await expect(
      page.locator(".hardware-allocation-table tbody tr"),
    ).toHaveCount(18);
    await page
      .getByRole("button", { name: "将分配 FIT 载入硬件改进目标", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "已载入第四步" }),
    ).toBeVisible();
    await screenshot("allocation");
    await confirm();
    await expect(
      page.getByRole("heading", { name: "04 / 可靠性措施", exact: true }),
    ).toBeVisible();
    await screenshot("measures");
    await confirm();
    const oldFlow = await current();
    await expect(page.locator("#audit-parameters")).not.toHaveAttribute(
      "open",
      "",
    );
    await expect(
      page.getByRole("button", { name: "运行可靠性评估", exact: true }),
    ).toBeVisible();
    await page.getByText("参数核对", { exact: true }).click();
    await page.getByLabel("每场景轨迹数", { exact: true }).fill("24");
    await expect.poll(async () => (await current()).changedFrom).toBe(4);
    await expect(
      navigation.locator(".step-label small").filter({ hasText: "已确认" }),
    ).toHaveCount(4);
    const options = page.locator(".analysis-options");
    await options.scrollIntoViewIfNeeded();
    for (const option of await options.locator("label").all()) {
      const checkbox = await option.locator("input").boundingBox(),
        text = await option.locator("span").boundingBox();
      expect(checkbox!.x + checkbox!.width).toBeLessThanOrEqual(text!.x);
      expect(Math.abs(checkbox!.y - text!.y)).toBeLessThan(12);
    }
    await screenshot("sampling");
    await page.getByText("参数核对", { exact: true }).click();
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    await expect
      .poll(async () => (await current()).steps[4].status, { timeout: 30000 })
      .toBe("awaiting-review");
    const resumed = await current();
    expect(resumed.executionId).not.toBe(oldFlow.executionId);
    expect(resumed.resumedFrom.confirmedSteps).toBe(4);
    expect(
      resumed.steps
        .slice(0, 4)
        .every((step: any) => step.status === "confirmed"),
    ).toBe(true);
    await page.getByRole("tab", { name: "可靠性框图", exact: true }).click();
    const diagram = page.locator(
      ".workspace-result-panel:not([hidden]) .reliability-block-view",
    );
    await expect(diagram.locator("svg [data-object]")).toHaveCount(18);
    await expect(diagram).toContainText("可用度");
    await diagram.getByLabel("框图对比方案").selectOption("hardware");
    await expect(diagram.locator("svg")).toContainText("源 FIT：");
    await diagram.scrollIntoViewIfNeeded();
    await screenshot("diagram");
    await page.locator(".audit-run-context > summary").click();
    await expect(page.locator(".run-context-card")).toHaveCount(5);
    await page.locator(".audit-run-context").scrollIntoViewIfNeeded();
    await screenshot("frozen-inputs");
    await confirm();
    await page
      .getByRole("button", { name: "记录交付确认", exact: true })
      .click();
    await expect.poll(async () => (await current()).status).toBe("succeeded");
    const link = page.getByRole("link", { name: "下载报告", exact: true });
    const html = await (
      await request.get((await link.getAttribute("href"))!)
    ).text();
    expect(html).toContain("可靠性框图与对象改善");
    expect(html).toContain("源 FIT");
    expect(html).not.toMatch(/正确有效产出|正确产出/);
    // A later measure edit retains the first three confirmations even after delivery.
    await stages.nth(3).click();
    await page
      .locator(".mechanism-option")
      .filter({ hasText: "更频繁检查点" })
      .getByRole("checkbox")
      .uncheck();
    await expect.poll(async () => (await current()).changedFrom).toBe(3);
    await confirm();
    await expect(stages.nth(4)).toHaveAttribute("aria-current", "step");
    await expect
      .poll(async () => (await current()).resumedFrom.confirmedSteps)
      .toBe(3);
    const measureFlow = await current();
    expect(measureFlow.resumedFrom.confirmedSteps).toBe(3);
    expect(measureFlow.steps[3].status).toBe("confirmed");
    expect(measureFlow.runId).toBeUndefined();
    await expect(stages.nth(4)).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

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
      page
        .locator(".audit-workbench")
        .getByLabel("可用度目标（0–1）", { exact: true }),
    ).toHaveValue("0.985");
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
    await expect(
      page.getByRole("region", { name: "两轮评估策略" }),
    ).toBeVisible();
    await page.screenshot({
      path: `artifacts/ai-cluster/strategy-${width}.png`,
    });
    await next(3);
    const library = page.getByRole("region", { name: "第二轮专家机制库" });
    await expect(
      library.getByLabel("第二轮目标 全系统 SDC 检出覆盖率", { exact: true }),
    ).toHaveAttribute("placeholder", "0.995");
    const saveTarget = library.getByLabel("第二轮目标 检查点保存阻塞 / 秒", {
      exact: true,
    });
    await expect(saveTarget).toHaveAttribute("placeholder", "0.5");
    await saveTarget.fill("0.4");
    await saveTarget.blur();
    await expect(stages.nth(3)).toHaveAttribute("aria-current", "step");
    await saveTarget.fill("0.5");
    await saveTarget.blur();
    await library.locator(".mechanism-targets").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/ai-cluster/mechanism-targets-${width}.png`,
    });
    await library.getByLabel("查找专家机制").fill("C-ASYNC");
    await expect(library.locator(".extension-card")).toHaveCount(1);
    await library.getByRole("button", { name: /^加入/ }).click();
    await expect(library.locator(".extension-parameters")).toBeVisible();
    await library.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/ai-cluster/mechanism-library-${width}.png`,
    });
    await library.getByRole("button", { name: /^移除/ }).click();
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
    expect(result.optimization.scales).toHaveLength(4);
    expect(result.optimization.attribution).toHaveLength(4);
    expect(result.optimization.factors.some((f: any) => f.kind === "fit")).toBe(
      false,
    );
    expect(
      result.events.find((e: any) => e.id === "CORE-hard").withinTypeShare,
    ).toBeCloseTo(0.06, 12);
    expect(
      result.events.find((e: any) => e.id === "SRAM-hard").withinTypeShare,
    ).toBeCloseTo(0.1, 12);
    await page.getByRole("tab", { name: "两轮决策", exact: true }).click();
    const decisions = page.getByRole("region", { name: "两轮可用度决策" });
    await expect(decisions).toContainText("不同规模：现状、优化预期与目标");
    await decisions.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/ai-cluster/two-round-${width}.png`,
    });
    await decisions
      .getByLabel("两轮 / 各规模措施贡献排名规模", { exact: true })
      .selectOption("10000");
    await expect(
      decisions.getByLabel("两轮 / 各规模措施贡献排名规模", { exact: true }),
    ).toHaveValue("10000");
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
    await page.getByRole("tab", { name: "第一轮现状", exact: true }).click();
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
    const html = await report.text();
    expect(html).toContain("可靠性框图与对象改善");
    expect(html).toContain("AGREE 目标进一步分配");
    expect(html).toContain("参数依据与参考初值");
    expect(html).toContain("分配依据 → 机制选择 → 参数要求");
    expect(html).toContain("专家机制采用依据");
    expect(html).toContain("机制指标分解与剩余缺口");
    expect(html).toContain("源 FIT 保持不变");
    expect(html).not.toMatch(/内网|外网/);
    await page.getByRole("tab", { name: "两轮决策", exact: true }).click();
    await page
      .getByRole("button", { name: "载入已复评的第二轮参数", exact: true })
      .click();
    await expect(stages.nth(2)).toHaveAttribute("aria-current", "step");
    await expect.poll(async () => (await flow()).changedFrom).toBe(2);
    await next(3);
    await page.getByText("手动修改第二轮现有措施参数", { exact: true }).click();
    await page.getByText("修改第二轮硬件 FIT 目标", { exact: true }).click();
    const fitEditor = page.getByRole("group", {
      name: "第二轮 FIT 目标",
      exact: true,
    });
    await fitEditor.getByLabel("第二轮 FIT 目标事件").selectOption("CORE-hard");
    await fitEditor.getByLabel("第二轮 FIT 目标FIT").fill("1.25");
    await fitEditor
      .getByLabel("第二轮 FIT 目标来源")
      .fill("产品讨论中的第二轮工程目标");
    await fitEditor
      .getByRole("button", { name: "加入更新", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (await request.get(base + "/design")).json()
          ).assessment.input.optimization.fitTargets.find(
            (e: any) => e.id === "CORE-hard",
          )?.fit,
      )
      .toBe(1.25);
    const updated = (await (await request.get(base + "/design")).json())
      .assessment.input;
    expect(updated.eventOverrides).toEqual(result.request.eventOverrides);
    expect(updated.mechanisms).toEqual(auditReferenceMechanisms);
    await next(4);
    expect(
      (await flow()).steps
        .slice(0, 4)
        .every((step: any) => step.status === "confirmed"),
    ).toBe(true);
    await page.goto("about:blank");
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `artifacts/ai-cluster/report-${width}.png` });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

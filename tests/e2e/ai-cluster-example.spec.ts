import { test, expect } from "./task-fixture";
import {
  auditDefaultTargets,
  auditReferenceMechanisms,
} from "../../packages/contracts/src/audit-presets";
test.use({ fullWorkspace: false });
for (const width of [1440, 390]) {
  test(`AI cluster separates current, allocated and custom assessments at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`/?task=${taskId}`);
    await page.getByLabel("采样配置", { exact: true }).selectOption("quick");
    const stages = page
      .getByRole("navigation", { name: "六阶段评估流程" })
      .getByRole("button");
    const next = async (index: number) => {
      await page
        .getByRole("button", { name: "确认并进入下一步", exact: true })
        .click();
      await expect(stages.nth(index)).toHaveAttribute("aria-current", "step");
    };
    await next(1);
    await expect(
      page.getByRole("region", { name: "分类故障模式库" }),
    ).toContainText("18 类 · 54 个模式");
    await next(2);
    await expect(
      page.getByText("现状评估按当前配置计算", { exact: false }),
    ).toBeVisible();
    await next(3);
    await page.getByText("第一轮现状机制参数", { exact: true }).click();
    await expect(
      page.getByLabel("现状静默检出覆盖率（%）", { exact: true }),
    ).toHaveValue("95");
    await next(4);
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    const base = `/api/tasks/${taskId}`,
      flow = async () => (await request.get(base + "/workflow")).json(),
      runs = async () => (await request.get(base + "/runs")).json();
    await expect
      .poll(async () => (await flow()).steps[4].status, { timeout: 60000 })
      .toBe("awaiting-review");
    const first = await (
      await request.get(base + "/runs/" + (await flow()).runId)
    ).json();
    expect(first.result.optimization).toBeNull();
    expect(first.result.config.policy["D-SDC"].coverage).toBe(0.95);
    expect(first.result.request.mechanisms).toEqual(auditReferenceMechanisms);
    expect(first.result.request.targets).toEqual(auditDefaultTargets);
    expect(
      (await runs()).filter((r: any) =>
        ["audit-plan", "audit-experiment"].includes(r.operation),
      ),
    ).toHaveLength(0);
    const experiments = page.getByRole("region", {
      name: "分轮评估与横向比较",
    });
    await expect(experiments).toBeVisible();
    await experiments.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/separate-rounds/first-${width}.png`,
    });
    await experiments
      .getByRole("button", { name: "新建参数方案", exact: true })
      .click();
    await experiments
      .getByLabel("改进方案名称", { exact: true })
      .fill("覆盖率参数对照");
    await experiments
      .getByLabel("调整对象", { exact: true })
      .selectOption("policy:D-SDC");
    await experiments
      .getByLabel("调整参数", { exact: true })
      .selectOption("coverage");
    await experiments
      .getByRole("button", { name: "加入参数调整", exact: true })
      .click();
    const coverage = experiments.getByLabel(
      "改进值 静默检测 · 检出覆盖率（%）",
      { exact: true },
    );
    await expect(coverage).toHaveValue("95");
    await coverage.fill("99.5");
    await experiments
      .getByRole("button", { name: "评估本次改进方案", exact: true })
      .click();
    const completed = async () =>
      (await runs()).filter(
        (r: any) =>
          r.operation === "audit-experiment" && r.status === "succeeded",
      );
    await expect
      .poll(async () => (await completed()).length, { timeout: 60000 })
      .toBe(1);
    const custom = (await completed())[0];
    expect(custom.result.configuration.policy).toEqual({
      "D-SDC": { coverage: 0.995 },
    });
    expect(custom.result.factors).toHaveLength(1);
    expect(
      (await (await request.get(base + "/runs/" + first.id)).json()).result,
    ).toEqual(first.result);
    await expect(
      experiments.getByText("刚完成：覆盖率参数对照", { exact: true }),
    ).toBeVisible();
    const customReport = await request.get(
      base + `/runs/${custom.id}/report?format=html`,
    );
    expect(await customReport.text()).toContain("改进评估 / 覆盖率参数对照");
    await experiments
      .getByRole("button", { name: "生成AGREE改进分配", exact: true })
      .click();
    const planRun = async () =>
      (await runs()).find(
        (r: any) => r.operation === "audit-plan" && r.status === "succeeded",
      );
    await expect
      .poll(async () => !!(await planRun()), { timeout: 60000 })
      .toBe(true);
    const plan = await planRun();
    expect(plan.result.scenarioEvaluated).toBe(false);
    expect(plan.result.prediction.target).toBe(0.985);
    expect((await completed()).length).toBe(1);
    await expect(
      experiments.getByText("尚未评估此建议方案。载入后仍可修改参数", {
        exact: false,
      }),
    ).toBeVisible();
    await experiments
      .getByRole("button", { name: "载入AGREE分配建议", exact: true })
      .click();
    await expect(stages.nth(4)).toHaveAttribute("aria-current", "step");
    await experiments
      .getByRole("button", { name: "评估本次改进方案", exact: true })
      .click();
    await expect
      .poll(async () => (await completed()).length, { timeout: 60000 })
      .toBe(2);
    const optimized = (await completed()).find((r: any) => r.id !== custom.id);
    expect(optimized.result.configuration).toEqual({
      ...plan.result.configuration,
      enabled: true,
      autoTune: false,
    });
    expect(optimized.result.attribution).toHaveLength(4);
    expect(optimized.result.planningRunId).toBe(plan.id);
    for (const row of optimized.result.rows)
      expect(
        Object.values(row.ledger).reduce((s: number, v: any) => s + v, 0) +
          row.statistics.mean * 720,
      ).toBeCloseTo(720, 7);
    await expect(
      experiments.getByText("刚完成：AGREE分配后的改进方案", { exact: true }),
    ).toBeVisible();
    await experiments
      .getByRole("button", { name: "新建参数方案", exact: true })
      .click();
    await expect(
      experiments.getByRole("region", { name: "参数调整编辑器" }),
    ).toBeVisible();
    await expect(
      experiments.getByRole("region", { name: "参数调整编辑器" }),
    ).toContainText("尚未添加参数调整");
    await experiments
      .getByRole("button", { name: "横向比较", exact: true })
      .click();
    await experiments
      .getByRole("button", { name: "生成所选评估的对比报告", exact: true })
      .click();
    const comparison = async () =>
      (await runs()).find(
        (r: any) => r.operation === "audit-compare" && r.status === "succeeded",
      );
    await expect.poll(async () => !!(await comparison())).toBe(true);
    const comparisonRun = await comparison();
    expect(comparisonRun.result.entries).toHaveLength(3);
    const reportLink = experiments.getByRole("link", {
      name: "下载多次评估对比报告",
      exact: true,
    });
    await expect(reportLink).toBeVisible();
    const html = await (
      await request.get((await reportLink.getAttribute("href"))!)
    ).text();
    for (const text of [
      "第一轮现状",
      "覆盖率参数对照",
      "AGREE分配后的改进方案",
      "参数横向比较",
      "独立结论",
      "各次评估与目标的规模曲线",
    ])
      expect(html).toContain(text);
    await experiments
      .getByLabel("多轮比较规模", { exact: true })
      .selectOption("10000");
    await experiments
      .getByRole("heading", { name: "各轮结果横向比较", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/separate-rounds/comparison-${width}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await next(5);
    await page
      .getByRole("button", { name: "记录交付确认", exact: true })
      .click();
    await expect.poll(async () => (await flow()).status).toBe("succeeded");
    const original = await (
      await request.get(base + "/runs/" + first.id)
    ).json();
    expect(original.result.config.policy["D-SDC"].coverage).toBe(0.95);
  });
}

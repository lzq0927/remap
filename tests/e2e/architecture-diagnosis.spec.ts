import { mkdir, writeFile } from "node:fs/promises";
import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
for (const width of [1440, 390])
  test(`layered diagnosis, planning and independent comparison at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 950 });
    const prefix = `/api/tasks/${taskId}`;
    const defaults = (await (await request.get("/api/defaults")).json()).audit;
    const input = {
      ...defaults,
      hours: 24,
      trials: 16,
      attributionTrials: 4,
      verificationTrials: 4,
      sensitivity: false,
      scales: [500000, 200000, 100000, 10000],
      samplingProfile: "quick",
      optimization: {
        enabled: false,
        screeningTrials: 8,
        exploreExtensions: false,
      },
    };
    await request.post(prefix + "/design", {
      data: {
        request: {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(input),
        stage: 0,
      },
    });
    await page.goto(`/?task=${taskId}`);
    const next = page.getByRole("button", {
      name: "确认并进入下一步",
      exact: true,
    });
    await next.click();
    const structure = page.getByRole("region", {
      name: "系统架构与故障归属",
      exact: true,
    });
    await expect(
      structure.getByRole("group", { name: "系统分层架构图" }),
    ).toBeVisible();
    await structure.getByText("编辑层级、名称与依据", { exact: true }).click();
    await structure
      .getByLabel("架构名称 domain-1", { exact: true })
      .fill("计算子系统");
    await structure.getByText("编辑层级、名称与依据", { exact: true }).click();
    await structure
      .getByText("共同依赖与故障传播关系", { exact: true })
      .click();
    await structure.getByLabel("架构依赖方").selectOption("object-CORE");
    await structure.getByLabel("架构被依赖方").selectOption("object-NIC");
    await structure.getByLabel("架构关系说明").fill("共享网络依赖");
    await structure.getByLabel("架构关系依据").fill("浏览器验证的显式架构关系");
    await structure
      .getByRole("button", { name: "加入依赖关系", exact: true })
      .click();
    await expect(structure).toContainText("共享网络依赖");
    await structure
      .getByText("共同依赖与故障传播关系", { exact: true })
      .click();
    await structure.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: `artifacts/architecture-diagnosis/architecture-${width}.png`,
    });
    await next.click();
    const budget = page.getByRole("region", {
      name: "分层目标预算",
      exact: true,
    });
    await budget.getByLabel("分层目标分配方法").selectOption("weighted");
    await budget.getByText("编辑分层设计权重与重要度", { exact: true }).click();
    await budget.getByLabel("分层预算权重 domain-1", { exact: true }).fill("2");
    await budget.getByText("编辑分层设计权重与重要度", { exact: true }).click();
    await expect(
      budget.getByRole("table").first().getByRole("row"),
    ).toHaveCount(9);
    await budget.getByLabel("展开对象预算").check();
    expect(
      await budget.getByRole("table").first().getByRole("row").count(),
    ).toBeGreaterThan(20);
    await budget.getByLabel("展开对象预算").uncheck();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await next.click();
    await next.click();
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "下载报告", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("button", { name: "查看分层目标与跨规模薄弱点", exact: true })
      .click();
    const diagnosis = page.getByRole("region", {
      name: "系统分层诊断",
      exact: true,
    });
    await expect(diagnosis).toContainText("计算子系统");
    await expect(diagnosis).toContainText("恢复停机 / 次（秒）");
    await expect(diagnosis).toContainText("不同规模的措施贡献排序");
    await diagnosis.getByLabel("薄弱点对比层级").selectOption("leaf");
    await expect(diagnosis.locator(".arch-heatmap")).toContainText(
      "AI Core计算单元",
    );
    await diagnosis.getByLabel("薄弱点对比层级").selectOption("subsystem");
    await diagnosis.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({
      path: `artifacts/architecture-diagnosis/diagnosis-${width}.png`,
    });
    await diagnosis.locator(".arch-tree").screenshot({
      path: `artifacts/architecture-diagnosis/diagram-${width}.png`,
    });
    await diagnosis
      .locator(".arch-chart")
      .first()
      .screenshot({
        path: `artifacts/architecture-diagnosis/heatmap-${width}.png`,
      });
    await diagnosis
      .locator(".arch-chart")
      .nth(1)
      .screenshot({
        path: `artifacts/architecture-diagnosis/ranking-${width}.png`,
      });
    await page.getByLabel("结果规模", { exact: true }).selectOption("10000");
    await expect(diagnosis.locator(".arch-conclusion")).toContainText("1万卡");
    await page.getByLabel("结果规模", { exact: true }).selectOption("500000");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const first = (await (await request.get(prefix + "/runs")).json()).find(
      (r: any) => r.operation === "audit",
    );
    expect(first.result.request.architecture.nodes[1].name).toBe("计算子系统");
    for (const s of first.result.architectureDiagnosis.scales)
      expect(Math.abs(s.residualHours)).toBeLessThan(1e-8);
    const original = JSON.stringify(first.result);
    const experiments = page.getByRole("region", {
      name: "分轮评估与横向比较",
      exact: true,
    });
    await experiments
      .getByRole("button", { name: "生成AGREE改进分配", exact: true })
      .click();
    const planned = experiments.getByRole("region", {
      name: "改进分配建议",
      exact: true,
    });
    await expect(planned).toBeVisible({ timeout: 30000 });
    await expect(planned).toContainText("分层薄弱点到机制的责任追溯");
    const plans = (await (await request.get(prefix + "/runs")).json()).filter(
      (r: any) => r.operation === "audit-plan",
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].result.scenarioEvaluated).toBe(false);
    expect(
      (await (await request.get(prefix + "/runs")).json()).some(
        (r: any) => r.operation === "audit-experiment",
      ),
    ).toBe(false);
    await experiments
      .getByRole("button", { name: "载入AGREE分配建议", exact: true })
      .click();
    await experiments
      .getByRole("button", { name: "评估本次改进方案", exact: true })
      .click();
    await expect(
      experiments.getByRole("region", {
        name: "本次独立方案结果",
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    const runs = await (await request.get(prefix + "/runs")).json();
    const scenario = runs.find((r: any) => r.operation === "audit-experiment");
    expect(scenario.result.architectureDiagnosis.version).toContain(
      "incremental",
    );
    expect(
      JSON.stringify(
        (await (await request.get(prefix + `/runs/${first.id}`)).json()).result,
      ),
    ).toBe(original);
    const response = await request.post(prefix + "/audit/compare", {
      data: { runIds: [first.id, scenario.id] },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const comparison = await response.json();
    const html = await (
      await request.get(prefix + `/runs/${first.id}/report?format=html`)
    ).text();
    const compareHtml = await (
      await request.get(prefix + `/runs/${comparison.id}/report?format=html`)
    ).text();
    expect(compareHtml).toContain("各轮分层薄弱点比较");
    const preview = await page.context().newPage();
    await preview.setViewportSize({ width, height: 950 });
    await preview.setContent(html);
    const section = preview.locator("section").filter({
      has: preview.getByRole("heading", {
        name: "系统分层目标与现状诊断",
        exact: true,
      }),
    });
    await expect(
      section.getByText("各规模的分层损失与目标差距", { exact: true }),
    ).toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await section
      .getByRole("heading", { name: "系统分层目标与现状诊断", exact: true })
      .scrollIntoViewIfNeeded();
    await preview.screenshot({
      path: `artifacts/architecture-diagnosis/report-${width}.png`,
    });
    await preview.emulateMedia({ media: "print" });
    await expect(section.locator(".arch-scale-detail")).toHaveCount(
      first.result.architectureDiagnosis.scales.length,
    );
    await preview.close();
    await next.click();
    await page
      .getByRole("button", { name: "记录交付确认", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "本流程已交付", exact: true }),
    ).toBeDisabled();
    await mkdir("artifacts/architecture-diagnosis", { recursive: true });
    await writeFile(
      `artifacts/architecture-diagnosis/verification-${width}.json`,
      JSON.stringify(
        {
          taskId,
          firstRunId: first.id,
          planRunId: plans[0].id,
          scenarioRunId: scenario.id,
          comparisonRunId: comparison.id,
          width,
          layerResiduals: first.result.architectureDiagnosis.scales.map(
            (s: any) => ({ cards: s.cards, residualHours: s.residualHours }),
          ),
          roundsIndependent: true,
          delivered: true,
        },
        null,
        2,
      ),
    );
  });

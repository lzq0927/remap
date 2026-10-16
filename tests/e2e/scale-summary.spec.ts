import { mkdir, writeFile } from "node:fs/promises";
import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
for (const width of [1440, 390])
  test(`ascending summaries and separate scale improvement plans at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width, height: 1000 });
    const prefix = `/api/tasks/${taskId}`,
      defaults = (await (await request.get("/api/defaults")).json()).audit;
    const input = {
      ...defaults,
      hours: 24,
      trials: 16,
      attributionTrials: 4,
      verificationTrials: 4,
      sensitivity: false,
      samplingProfile: "quick",
      optimization: {
        enabled: false,
        screeningTrials: 4,
        exploreExtensions: false,
      },
    };
    const created = await request.post(prefix + "/runs", {
      data: { operation: "audit", input },
    });
    expect(created.ok()).toBe(true);
    const start = await created.json();
    let first: any;
    await expect
      .poll(
        async () => {
          first = await (
            await request.get(prefix + `/runs/${start.id}`)
          ).json();
          return first.status;
        },
        { timeout: 30000 },
      )
      .toBe("succeeded");
    const frozen = JSON.stringify(first.result);
    await request.post(prefix + "/design", {
      data: {
        request: {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(input),
        runId: first.id,
        stage: 4,
      },
    });
    await page.goto(`/?task=${taskId}`);
    await page
      .getByRole("button", { name: "查看分层目标与跨规模薄弱点", exact: true })
      .click();
    const summary = page.getByRole("region", {
      name: "系统分层诊断",
      exact: true,
    });
    const heads = await summary
      .locator(".scale-target-breakdown")
      .first()
      .locator("thead th")
      .allTextContents();
    expect(heads).toEqual(["下级对象", "1万卡", "10万卡", "20万卡", "50万卡"]);
    await expect(
      summary.getByRole("img", {
        name: "各规模可用度目标与现状趋势",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await summary
        .locator(
          '[data-summary-chart="availability-trend"] [data-value="1000"]',
        )
        .count(),
    ).toBe(0);
    await summary.getByLabel("目标分解层级").selectOption("domain-1");
    await expect(summary.locator(".scale-target-breakdown")).toContainText(
      "AI Core计算单元",
    );
    await summary.getByLabel("趋势查看层级").selectOption("object-CORE");
    await expect(
      summary.locator('[data-summary-chart="availability-trend"]'),
    ).toContainText("目标损失与实际损失趋势");
    await summary.getByLabel("目标分解层级").selectOption("system");
    await summary.getByLabel("趋势查看层级").selectOption("system");
    await summary
      .locator('[data-summary-chart="availability-trend"]')
      .screenshot({ path: `artifacts/scale-summary/trend-${width}.png` });
    await summary
      .locator('[data-summary-chart="fault-gaps"]')
      .screenshot({ path: `artifacts/scale-summary/faults-${width}.png` });
    for (const grouping of ["loss", "layer", "type"]) {
      await summary.getByLabel("损失时间分组").selectOption(grouping);
      const rows = await summary
        .locator('[data-summary-chart="loss-time"] [data-loss-cards]')
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            cards: Number(n.getAttribute("data-loss-cards")),
            total: Number(n.getAttribute("data-total-hours")),
            sum: [...n.querySelectorAll("[data-hours]")].reduce(
              (s, v) => s + Number(v.getAttribute("data-hours")),
              0,
            ),
          })),
        );
      expect(rows.map((r) => r.cards)).toEqual([10000, 100000, 200000, 500000]);
      for (const row of rows) expect(row.sum).toBeCloseTo(row.total, 8);
    }
    await summary.getByLabel("损失时间分组").selectOption("loss");
    await summary
      .locator('[data-summary-chart="loss-time"]')
      .screenshot({ path: `artifacts/scale-summary/losses-${width}.png` });
    await expect(
      summary.getByRole("img", { name: "各规模措施贡献排名变化", exact: true }),
    ).toBeVisible();
    await summary
      .locator('[data-summary-chart="contribution-ranks"]')
      .screenshot({ path: `artifacts/scale-summary/ranks-${width}.png` });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const experiments = page.getByRole("region", {
      name: "分轮评估与横向比较",
      exact: true,
    });
    await experiments
      .getByRole("button", { name: "按各规模分别生成改进建议", exact: true })
      .click();
    const plansView = experiments.getByRole("region", {
      name: "各规模改进建议汇总",
      exact: true,
    });
    await expect(plansView).toBeVisible({ timeout: 45000 });
    await expect(plansView).toContainText("各规模参数要求对照");
    const runs = await (await request.get(prefix + "/runs")).json(),
      set = runs.find((r: any) => r.operation === "audit-plan-scales");
    expect(set.result.plans.map((p: any) => p.prediction.cards)).toEqual([
      10000, 100000, 200000, 500000,
    ]);
    expect(set.result.scenarioEvaluated).toBe(false);
    expect(runs.some((r: any) => r.operation === "audit-experiment")).toBe(
      false,
    );
    for (const p of set.result.plans)
      expect(p.prediction.target).toBe(
        input.targets[String(p.prediction.cards)],
      );
    await plansView
      .locator("details")
      .first()
      .screenshot({ path: `artifacts/scale-summary/plans-${width}.png` });
    await experiments
      .getByRole("button", { name: "查看1万卡改进建议", exact: true })
      .click();
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
    const after = await (await request.get(prefix + "/runs")).json(),
      scenario = after.find((r: any) => r.operation === "audit-experiment");
    expect(scenario.result.planningRunId).toBe(set.id);
    expect(scenario.result.planningCards).toBe(10000);
    expect(scenario.result.decision.cards).toBe(10000);
    expect(
      JSON.stringify(
        (await (await request.get(prefix + `/runs/${first.id}`)).json()).result,
      ),
    ).toBe(frozen);
    const html = await (
      await request.get(prefix + `/runs/${first.id}/report?format=html`)
    ).text();
    const planHtml = await (
      await request.get(prefix + `/runs/${set.id}/report?format=html`)
    ).text();
    const preview = await page.context().newPage();
    await preview.setViewportSize({ width, height: 1000 });
    await preview.setContent(html);
    await expect(
      preview.getByRole("img", { name: "各规模措施贡献排名变化", exact: true }),
    ).toBeVisible();
    await expect(
      preview
        .getByRole("img", { name: "不同规模的损失时间分布", exact: true })
        .first(),
    ).toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview
      .locator('[data-summary-chart="availability-trend"]')
      .first()
      .screenshot({
        path: `artifacts/scale-summary/report-trend-${width}.png`,
      });
    await preview.setContent(planHtml);
    await expect(
      preview.getByRole("img", {
        name: "各规模目标、现状与独立规划预期",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview.close();
    await mkdir("artifacts/scale-summary", { recursive: true });
    await writeFile(
      `artifacts/scale-summary/verification-${width}.json`,
      JSON.stringify(
        {
          width,
          taskId,
          firstRunId: first.id,
          planSetRunId: set.id,
          scenarioRunId: scenario.id,
          summaryOrder: [10000, 100000, 200000, 500000],
          firstUnchanged: true,
          selectedPlanCards: 10000,
          independentEvaluation: true,
        },
        null,
        2,
      ),
    );
  });

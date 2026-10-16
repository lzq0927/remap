import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
import { mkdir, writeFile } from "node:fs/promises";
test.use({ fullWorkspace: false });
for (const width of [1440, 390])
  test(
    "bounded planning and alternative selection at " + width + "px",
    async ({ page, request, taskId }) => {
      test.setTimeout(150000);
      await page.setViewportSize({ width, height: 1000 });
      const prefix = "/api/tasks/" + taskId,
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
      const created = await (
        await request.post(prefix + "/runs", {
          data: { operation: "audit", input },
        })
      ).json();
      let first: any;
      await expect
        .poll(
          async () => {
            first = await (
              await request.get(prefix + "/runs/" + created.id)
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
      await page.goto("/?task=" + taskId);
      const experiments = page.getByRole("region", {
        name: "分轮评估与横向比较",
        exact: true,
      });
      const editor = experiments.getByLabel("规划方法与工程边界", {
        exact: true,
      });
      await editor
        .getByText("规划方法、工程边界与保守情景", { exact: true })
        .click();
      await editor.getByLabel("规划组合上限").fill("12");
      await editor.getByText("能力边界与参数锁定", { exact: true }).click();
      await editor
        .getByLabel("工程边界参数")
        .selectOption("policy.D-SDC.coverage");
      await editor.getByLabel("工程锁定值").fill("0.975");
      await editor
        .getByLabel("工程边界依据")
        .fill("浏览器测试：用户锁定的能力要求");
      await editor
        .getByRole("button", { name: "加入工程边界", exact: true })
        .click();
      await expect(editor).toContainText("浏览器测试：用户锁定的能力要求");
      await editor
        .getByText("规划方法、工程边界与保守情景", { exact: true })
        .click();
      await experiments
        .getByRole("button", { name: "生成AGREE改进分配", exact: true })
        .click();
      const planned = experiments.getByRole("region", {
        name: "改进分配建议",
        exact: true,
      });
      await expect(planned).toBeVisible({ timeout: 45000 });
      await expect(planned).toContainText("冻结第一轮");
      const runs = await (await request.get(prefix + "/runs")).json(),
        plan = runs.find((r: any) => r.operation === "audit-plan");
      expect(plan.result.configuration.policy["D-SDC"].coverage).toBe(0.975);
      expect(plan.result.decisionStudy.search.evaluated).toBeLessThanOrEqual(
        12,
      );
      expect(runs.some((r: any) => r.operation === "audit-experiment")).toBe(
        false,
      );
      const selected = plan.result.decisionStudy.alternatives.at(-1);
      await experiments
        .getByLabel("查看规划备选方案", { exact: true })
        .selectOption(selected.id);
      const charts = planned.locator(".decision-study-charts");
      await expect(charts).toHaveAttribute(
        "data-decision-alternative",
        selected.id,
      );
      await expect(
        charts.getByRole("img", { name: "跨规模贡献热力图", exact: true }),
      ).toBeVisible();
      await charts
        .getByRole("img", { name: "各规模现状与方案损失成对比较", exact: true })
        .screenshot({
          path: "artifacts/decision-study/paired-" + width + ".png",
        });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
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
      expect(scenario.result.planningAlternativeId).toBe(selected.id);
      expect(scenario.result.configuration.policy["D-SDC"].coverage).toBe(
        0.975,
      );
      expect(
        JSON.stringify(
          (await (await request.get(prefix + "/runs/" + first.id)).json())
            .result,
        ),
      ).toBe(frozen);
      const html = await (
        await request.get(prefix + "/runs/" + plan.id + "/report?format=html")
      ).text();
      const preview = await page.context().newPage();
      await preview.setViewportSize({ width, height: 1000 });
      await preview.setContent(html);
      const plot = preview.locator(".decision-study-charts");
      await expect(
        plot.getByRole("img", {
          name: "固定方案在各规模的可用度与保守情景",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await plot.locator("[data-scenario-band]").count(),
      ).toBeGreaterThan(0);
      expect(
        await preview.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await plot
        .getByRole("img", {
          name: "固定方案在各规模的可用度与保守情景",
          exact: true,
        })
        .locator("..")
        .locator("..")
        .screenshot({
          path: "artifacts/decision-study/curves-" + width + ".png",
        });
      await plot
        .locator('[data-summary-chart="contribution-heatmap"]')
        .screenshot({
          path: "artifacts/decision-study/heatmap-" + width + ".png",
        });
      await preview.close();
      await mkdir("artifacts/decision-study", { recursive: true });
      await writeFile(
        "artifacts/decision-study/browser-" + width + ".json",
        JSON.stringify(
          {
            width,
            taskId,
            firstRunId: first.id,
            planRunId: plan.id,
            scenarioRunId: scenario.id,
            selectedAlternative: selected.id,
            lockedCoverage: 0.975,
            firstUnchanged: true,
            noAutoEvaluation: true,
          },
          null,
          2,
        ),
      );
    },
  );

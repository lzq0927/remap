import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
import { auditContributionView } from "../../packages/reports/src/audit-contributions";

for (const mode of ["disabled", "empty", "historical"])
  test(`contribution display keeps ${mode} results explicit without inventing samples`, async ({
    page,
    request,
    taskId,
  }) => {
    const defaults = await (await request.get("/api/defaults")).json();
    const mechanisms = ["sdcDetect", "step", "elastic", "fast"];
    const input = {
      ...defaults.audit,
      cards: 10000,
      target: 0.99,
      optimization: undefined,
      scales: [10000],
      targets: undefined,
      hours: 24,
      trials: 4,
      attributionTrials: 4,
      mechanisms,
      sensitivity: false,
      verifyRecommendation: false,
      attribution: mode !== "disabled",
      ...(mode === "empty" ? { baseline: { mechanisms } } : {}),
    };
    const base = "/api/tasks/" + taskId;
    const started = await (
      await request.post(base + "/runs", {
        data: { operation: "audit", input },
      })
    ).json();
    await expect
      .poll(
        async () =>
          (await (await request.get(base + "/runs/" + started.id)).json())
            .status,
      )
      .toBe("succeeded");
    const run = await (await request.get(base + "/runs/" + started.id)).json();
    if (mode === "historical") {
      delete run.result.rankings;
      delete run.result.baseline;
      delete run.result.referenceComparison;
      delete run.result.attribution[0].coalitions;
      run.result.modelVersion = "review-retained-progress.v3";
      await page.route(
        "**/api/tasks/" + taskId + "/runs/" + started.id,
        (route) => route.fulfill({ json: run }),
      );
    }
    await request.post(base + "/design", {
      data: {
        request: defaults.training,
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(input),
        runId: run.id,
        stage: 5,
      },
    });
    await page.goto("/?task=" + taskId);
    const panel = page.getByRole("region", {
      name: "组合贡献分摊",
      exact: true,
    });
    await expect(panel).toBeVisible();
    if (mode === "historical") {
      await expect(panel).toContainText("历史未记录");
      await expect(
        panel.getByRole("img", { name: "组合贡献分摊图" }),
      ).toBeVisible();
    } else {
      await expect(panel).toContainText(
        mode === "empty" ? "没有剩余候选机制" : "本次未启用Shapley",
      );
      await expect(
        panel.getByRole("img", { name: "组合贡献分摊图" }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("table", { name: "组合贡献分摊表" }),
      ).toHaveCount(0);
    }
  });

for (const width of [1440, 390])
  test(`same-batch contribution charts, tables, scale controls and exports at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const defaults = await (await request.get("/api/defaults")).json();
    const input = {
      ...defaults.audit,
      cards: 10000,
      target: 0.99,
      optimization: undefined,
      scales: [10000, 500000],
      targets: { "10000": 0.99, "500000": 0.8 },
      hours: 24,
      trials: 16,
      attributionTrials: 16,
      mechanisms: ["sdcDetect", "step", "elastic", "fast"],
      sensitivity: false,
      verifyRecommendation: false,
    };
    const started = await (
      await request.post(`/api/tasks/${taskId}/runs`, {
        data: { operation: "audit", input },
      })
    ).json();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/tasks/${taskId}/runs/${started.id}`)
            ).json()
          ).status,
        { timeout: 30000 },
      )
      .toBe("succeeded");
    const run = await (
      await request.get(`/api/tasks/${taskId}/runs/${started.id}`)
    ).json();
    await request.post(`/api/tasks/${taskId}/design`, {
      data: {
        scenario: "training",
        request: defaults.training,
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(input),
        stage: 5,
        runId: run.id,
      },
    });
    await page.goto("/?task=" + taskId);
    const panel = page.getByRole("region", {
      name: "组合贡献分摊",
      exact: true,
    });
    await expect(panel.getByLabel("贡献分摊规模")).toHaveValue("10000");
    for (const cards of [10000, 500000]) {
      await panel.getByLabel("贡献分摊规模").selectOption(String(cards));
      const expected = auditContributionView(run.result, cards);
      await expect(panel.getByText(/本节基线可用度/)).toContainText(
        (expected.baselineMean! * 100).toFixed(3) + "%",
      );
      const ids = await panel
        .locator("[data-contribution-row]")
        .evaluateAll((rows) =>
          rows.map((r) => r.getAttribute("data-contribution-row")),
        );
      expect(ids).toEqual(expected.rows.map((r: any) => r.id));
      expect(
        await panel
          .locator("svg [data-contribution]")
          .evaluateAll((rows) =>
            rows.map((r) => r.getAttribute("data-contribution")),
          ),
      ).toEqual(ids);
      await expect(panel.locator("details")).not.toHaveAttribute("open", "");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await panel.getByText("计算依据与详细审核", { exact: true }).click();
    await expect(panel).toContainText("同一批Shapley样本");
    await expect(panel).toContainText("不等于联合方案比基线差");
    await panel.getByText("计算依据与详细审核", { exact: true }).click();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/contribution-${width}.png` });
    const exportUrl = `/api/tasks/${taskId}/runs/${run.id}/report`;
    const html = await (await request.get(exportUrl + "?format=html")).text();
    const md = await (await request.get(exportUrl + "?format=md")).text();
    const json = await (await request.get(exportUrl + "?format=json")).json();
    expect(json.result).toEqual(run.result);
    expect(md).toContain("计算依据与详细审核");
    expect(md).not.toContain("小时/月");
    await page.goto("about:blank");
    await page.setContent(html);
    await expect(page.getByLabel("贡献分摊规模")).toHaveValue("10000");
    for (const section of await page
      .locator('[data-contribution-scale="500000"]')
      .all())
      await expect(section).toBeHidden();
    await page.getByLabel("贡献分摊规模").selectOption("500000");
    const content = page
      .locator('[data-contribution-scale="500000"]')
      .filter({ has: page.getByRole("img", { name: "组合贡献分摊图" }) });
    await expect(content).toBeVisible();
    expect(
      await content
        .locator("svg [data-contribution]")
        .evaluateAll((rows) =>
          rows.map((r) => r.getAttribute("data-contribution")),
        ),
    ).toEqual(
      auditContributionView(run.result, 500000).rows.map((r: any) => r.id),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });

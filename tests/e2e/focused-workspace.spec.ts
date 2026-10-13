import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });

for (const width of [1440, 390])
  test(`focused stages preserve edits and keep actions readable at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?task=${taskId}`);
    const views = page.getByRole("tablist", { name: "配置视图", exact: true });
    await expect(
      views.getByRole("tab", { name: "按步骤", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("评估卡数", { exact: true }).fill("12000");
    const steps = page.getByRole("navigation", {
      name: "六阶段评估流程",
      exact: true,
    });
    await steps.getByRole("button").nth(4).click();
    await expect(page.locator("#audit-parameters")).not.toHaveAttribute(
      "open",
      "",
    );
    await page.getByText("参数核对", { exact: true }).click();
    await expect(page.getByLabel("评估卡数", { exact: true })).toBeHidden();
    await expect(
      page.getByLabel("每场景轨迹数", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "03 / 可用度分配", exact: true }),
    ).toBeHidden();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/tasks/${taskId}/design`)).json())
            ?.auditDraft?.request?.cards,
      )
      .toBe(12000);
    const before = (
      await (await request.get(`/api/tasks/${taskId}/design`)).json()
    ).revision;
    await views.getByRole("tab", { name: "全部配置", exact: true }).click();
    await expect(page.getByLabel("评估卡数", { exact: true })).toHaveValue(
      "12000",
    );
    await views.getByRole("tab", { name: "按步骤", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/tasks/${taskId}/design`)).json())
            .revision,
      )
      .toBe(before);
    await steps.getByRole("button").nth(0).click();
    await expect(page.getByLabel("评估卡数", { exact: true })).toHaveValue(
      "12000",
    );
    await expect(page.getByLabel("每场景轨迹数", { exact: true })).toBeHidden();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/focused-workspace/step-${width}.png`,
    });
  });

test("result views keep frozen numbers and scale while showing the requested analysis", async ({
  page,
  request,
  taskId,
}) => {
  const defaults = await (await request.get("/api/defaults")).json();
  const input = {
    ...defaults.audit,
    scales: [10000, 500000],
    targets: { "10000": 0.99, "500000": 0.8 },
    hours: 24,
    trials: 8,
    attributionTrials: 8,
    sensitivity: false,
    verifyRecommendation: false,
    mechanisms: ["sdcDetect", "step", "elastic", "fast"],
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
    )
    .toBe("succeeded");
  const run = await (
    await request.get(`/api/tasks/${taskId}/runs/${started.id}`)
  ).json();
  await request.post(`/api/tasks/${taskId}/design`, {
    data: {
      request: defaults.training,
      scenario: "training",
      activeAssessment: "audit",
      auditDraft: draftFromAuditRequest(input),
      runId: run.id,
      stage: 5,
    },
  });
  await page.goto(`/?task=${taskId}`);
  const views = page.getByRole("tablist", {
    name: "评估结果视图",
    exact: true,
  });
  await expect(
    views.getByRole("tab", { name: "结论概览", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    views.getByRole("tab", { name: "结论概览", exact: true }),
  ).toHaveAttribute("aria-controls", /.+/);
  const overviewPanel = page.getByRole("tabpanel", {
    name: "结论概览",
    exact: true,
  });
  await expect(overviewPanel).toHaveAttribute(
    "id",
    (await views
      .getByRole("tab", { name: "结论概览", exact: true })
      .getAttribute("aria-controls"))!,
  );
  await expect(overviewPanel).toHaveAttribute(
    "aria-labelledby",
    (await views
      .getByRole("tab", { name: "结论概览", exact: true })
      .getAttribute("id"))!,
  );
  await expect(
    page.getByRole("table", { name: "组合贡献分摊表", exact: true }),
  ).toBeHidden();
  await page.getByLabel("结果规模", { exact: true }).selectOption("500000");
  await views.getByRole("tab", { name: "贡献分摊", exact: true }).click();
  await expect(
    page.getByRole("table", { name: "组合贡献分摊表", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("贡献分摊规模", { exact: true })).toHaveValue(
    "500000",
  );
  await views
    .getByRole("tab", { name: "贡献分摊", exact: true })
    .press("ArrowLeft");
  await expect(
    views.getByRole("tab", { name: "可靠性框图", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await views
    .getByRole("tab", { name: "可靠性框图", exact: true })
    .press("ArrowLeft");
  await expect(
    views.getByRole("tab", { name: "方案收益", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("结果规模", { exact: true })).toHaveValue(
    "500000",
  );
  expect(
    await (await request.get(`/api/tasks/${taskId}/runs/${started.id}`)).json(),
  ).toEqual(run);
  const secondResponse = await request.post(`/api/tasks/${taskId}/runs`, {
    data: {
      operation: "audit",
      input: { ...input, cards: 500000, target: 0.8 },
    },
  });
  expect(secondResponse.ok(), await secondResponse.text()).toBe(true);
  const second = await secondResponse.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/tasks/${taskId}/runs/${second.id}`)
          ).json()
        ).status,
    )
    .toBe("succeeded");
  await page.getByRole("button", { name: "实验与报告", exact: true }).click();
  await page
    .getByRole("button", { name: run.id.slice(0, 8), exact: true })
    .click();
  await expect(page.getByLabel("结果规模", { exact: true })).toHaveValue(
    "10000",
  );
  await page
    .getByRole("button", { name: second.id.slice(0, 8), exact: true })
    .click();
  await expect(page.getByLabel("结果规模", { exact: true })).toHaveValue(
    "500000",
  );
});

test("task search finds a named task without altering or hiding its management capabilities", async ({
  page,
  request,
  taskId,
}) => {
  const name = "聚焦验收任务 " + taskId;
  await request.patch(`/api/tasks/${taskId}`, {
    data: { name },
  });
  await page.goto("/");
  await page.getByLabel("搜索任务", { exact: true }).fill(name);
  const rows = page
    .getByRole("region", { name: "任务列表", exact: true })
    .locator("article");
  await expect(rows).toHaveCount(1);
  await expect(
    rows.getByRole("button", { name: "打开任务", exact: true }),
  ).toBeVisible();
  await expect(
    rows.getByRole("button", { name: "重命名", exact: true }),
  ).toBeVisible();
  await page.getByLabel("搜索任务", { exact: true }).fill("不存在的任务名称");
  await expect(page.getByText("没有匹配的任务", { exact: true })).toBeVisible();
});

test("native Agent panel has the actual task step and keeps secondary management collapsed", async ({
  page,
  taskId,
}) => {
  test.skip(
    !process.env.TEST_OPENCODE_URL,
    "requires the installed local OpenCode service",
  );
  await page.goto(`/?task=${taskId}`);
  await page
    .getByRole("navigation", { name: "六阶段评估流程" })
    .getByRole("button")
    .nth(3)
    .click();
  await page
    .getByRole("button", { name: "显示或收起 Agent", exact: true })
    .click();
  const panel = page.getByRole("complementary", {
    name: "本地官方 OpenCode",
    exact: true,
  });
  await expect(
    panel.getByLabel("Agent 当前上下文", { exact: true }),
  ).toContainText("可靠性措施");
  await expect(panel.locator(".agent-management")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(
    panel.getByRole("button", {
      name: "加载 Skill 并选择执行方式",
      exact: true,
    }),
  ).toBeVisible();
  const frame = panel.locator('iframe[title="本地官方 OpenCode Web"]');
  await expect(frame).toBeVisible({ timeout: 30000 });
  const url = await frame.getAttribute("src");
  await panel.getByText("会话与连接管理", { exact: true }).click();
  await expect(frame).toHaveAttribute("src", url!);
  await panel
    .getByRole("button", { name: "同步当前设计", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "当前设计已写入关联会话",
  );
});

for (const width of [1440, 390])
  test(`all resource pages keep one readable workspace at ${width}px`, async ({
    page,
    taskId,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?task=${taskId}`);
    for (const name of [
      "可靠性设计与评估",
      "输入与来源",
      "资产库",
      "方法与工具",
      "实验与报告",
      "连接与配置",
    ]) {
      await page
        .getByRole("navigation", { name: "任务模块", exact: true })
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator("main>header h1")).toHaveText(name);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/focused-workspace/page-${width}-${name}.png`,
      });
    }
  });

for (const status of ["cancelled", "failed"])
  test(`retained success does not bypass focused configuration after ${status}`, async ({
    page,
    request,
    taskId,
  }) => {
    const defaults = await (await request.get("/api/defaults")).json();
    const input = {
      ...defaults.audit,
      scales: [10000],
      targets: undefined,
      hours: 24,
      trials: 4,
      attribution: false,
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
      )
      .toBe("succeeded");
    const run = await (
      await request.get(`/api/tasks/${taskId}/runs/${started.id}`)
    ).json();
    await request.post(`/api/tasks/${taskId}/design`, {
      data: {
        request: defaults.training,
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(input),
        runId: run.id,
        stage: 5,
      },
    });
    await page.goto(`/?task=${taskId}`);
    await expect(page.getByLabel("结果规模", { exact: true })).toBeVisible();
    // Presentation-only terminal fixture; real cancellation/solver behavior is covered separately.
    await page.route(`**/api/tasks/${taskId}/runs`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const terminal = {
        ...run,
        id: `${status}-presentation`,
        status,
        result: undefined,
        ...(status === "failed"
          ? { error: { code: "FIXTURE", message: "失败显示验收" } }
          : {}),
      };
      await route.fulfill({ json: terminal });
    });
    await page.getByRole("tab", { name: "全部配置", exact: true }).click();
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "上次完整结果", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "按步骤", exact: true }).click();
    await page
      .getByRole("navigation", { name: "六阶段评估流程" })
      .getByRole("button")
      .nth(0)
      .click();
    await expect(
      page.getByRole("heading", { name: "上次完整结果", exact: true }),
    ).toBeHidden();
    await expect(page.getByLabel("评估卡数", { exact: true })).toBeVisible();
    expect(
      await (await request.get(`/api/tasks/${taskId}/runs/${run.id}`)).json(),
    ).toEqual(run);
  });

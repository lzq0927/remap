import { test, expect } from "./task-fixture";
import { selectAssessment } from "./model-selection";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`unified expert flow and historical model remain distinct at ${viewport.width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    // Even a stale entry URL must not select a second workflow for a new task.
    await page.goto(`/?view=workflow&task=${taskId}`);
    await expect(page).toHaveTitle("ReMAP — 可靠性设计与评估");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "可靠性设计与评估",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^(事件与机制审核|设计确认流程)$/ }),
    ).toHaveCount(0);
    const settings = page.getByRole("region", {
      name: "模型设置",
      exact: true,
    });
    await expect(settings).toContainText("专家审核口径 · 默认");
    await expect(settings.getByLabel("评估模型", { exact: true })).toBeHidden();
    const navigation = page.getByRole("navigation", { name: "六阶段评估流程" });
    await expect(navigation.getByRole("button")).toHaveCount(6);
    const panel = page.getByRole("region", { name: "故障事件与机制收益审核" });
    await panel.getByLabel("采样配置", { exact: true }).selectOption("quick");
    await panel.getByLabel("审核窗口（小时）", { exact: true }).fill("24");
    await panel.getByText("基线参数、机制目标与成本", { exact: true }).click();
    await panel.getByLabel("每场景轨迹数", { exact: true }).fill("8");
    await panel.getByLabel("每组合轨迹数", { exact: true }).fill("8");
    await panel.getByText("基线参数、机制目标与成本", { exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/unified-entry/overview-${viewport.width}.png`,
    });
    for (let i = 0; i < 4; i++) {
      await page
        .getByRole("button", { name: "确认并进入下一步", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "当前流程阶段" }),
      ).toContainText(`第 ${i + 2} / 6 步`);
    }
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    await expect(page.getByLabel("结果口径", { exact: true })).toContainText(
      "专家审核口径",
      { timeout: 30000 },
    );
    await expect(
      page.getByRole("link", { name: "下载报告", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "确认并进入下一步", exact: true })
      .click();
    await page
      .getByRole("button", { name: "记录交付确认", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "本流程已交付", exact: true }),
    ).toBeDisabled();
    const completed = await (
      await request.get(`/api/tasks/${taskId}/workflow`)
    ).json();
    expect(completed.status).toBe("succeeded");
    expect(completed.steps.every((s: any) => s.status === "confirmed")).toBe(
      true,
    );
    const expertHtml = await (
      await request.get(
        (await page
          .getByRole("link", { name: "下载报告", exact: true })
          .getAttribute("href"))!,
      )
    ).text();
    expect(expertHtml).toContain("可靠性设计与评估报告 · 专家审核口径");
    expect(expertHtml).toContain("training.retained-clean-progress");
    await page.screenshot({
      path: `artifacts/unified-entry/delivery-${viewport.width}.png`,
    });

    const before = await (
      await request.get(`/api/tasks/${taskId}/design`)
    ).json();
    const defaults = await (await request.get("/api/defaults")).json();
    const legacy = await (
      await request.post(`/api/tasks/${taskId}/runs`, {
        data: {
          operation: "training",
          input: { ...defaults.training, hours: 1, trials: 2 },
        },
      })
    ).json();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/tasks/${taskId}/runs/${legacy.id}`)
            ).json()
          ).status,
      )
      .toBe("succeeded");
    const frozen = await (
      await request.get(`/api/tasks/${taskId}/runs/${legacy.id}`)
    ).json();
    await page.getByRole("button", { name: "实验与报告", exact: true }).click();
    const row = page.getByRole("row").filter({
      has: page.getByRole("button", {
        name: legacy.id.slice(0, 8),
        exact: true,
      }),
    });
    await expect(row).toContainText("历史模型 V4");
    await row
      .getByRole("button", { name: legacy.id.slice(0, 8), exact: true })
      .click();
    await expect(page.getByLabel("结果口径", { exact: true })).toContainText(
      "training.correct-delivery",
    );
    const historicalHtml = await (
      await request.get(
        (await page
          .getByRole("link", { name: "下载报告", exact: true })
          .getAttribute("href"))!,
      )
    ).text();
    expect(historicalHtml).toContain("可靠性设计与评估报告 · 历史模型 V4");
    expect(historicalHtml).toContain("整条任务的交付产出清零");
    const replay = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/runs/${legacy.id}/replay`) &&
        r.request().method() === "POST",
    );
    await row.getByRole("button", { name: "重放", exact: true }).click();
    const replayed = await (await replay).json();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/tasks/${taskId}/runs/${replayed.id}`)
            ).json()
          ).status,
      )
      .toBe("succeeded");
    await expect(
      page.getByRole("heading", { level: 1, name: "实验与报告", exact: true }),
    ).toBeVisible();
    const after = await (
      await request.get(`/api/tasks/${taskId}/design`)
    ).json();
    expect(after.activeAssessment).toBe("audit");
    expect(after.revision).toBe(before.revision);
    expect(
      (await (await request.get(`/api/tasks/${taskId}/workflow`)).json())
        .executionId,
    ).toBe(completed.executionId);
    await page
      .getByRole("button", { name: "可靠性设计与评估", exact: true })
      .click();
    await expect(page.getByText(/下方为历史模型 V4的历史结果/)).toBeVisible();
    await selectAssessment(page, "workflow");
    await expect(settings).toContainText("历史模型 V4 · 兼容复核");
    await expect(page.getByLabel("集群卡数", { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/tasks/${taskId}/design`)).json())
            .activeAssessment,
      )
      .toBe("workflow");
    await page.reload();
    await expect(settings).toContainText("历史模型 V4 · 兼容复核");
    await settings.getByText("高级设置", { exact: true }).click();
    await page.screenshot({
      path: `artifacts/unified-entry/history-${viewport.width}.png`,
    });
    await selectAssessment(page, "audit");
    await expect(
      panel.getByLabel("审核窗口（小时）", { exact: true }),
    ).toHaveValue("24");
    expect(
      (
        await (
          await request.get(`/api/tasks/${taskId}/runs/${legacy.id}`)
        ).json()
      ).result,
    ).toEqual(frozen.result);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("an existing V4 design opens with its saved model, revision and result intact", async ({
  page,
  request,
  taskId,
}) => {
  const defaults = await (await request.get("/api/defaults")).json();
  const input = { ...defaults.training, hours: 2, trials: 2, cards: 12345 };
  const legacy = await (
    await request.post(`/api/tasks/${taskId}/runs`, {
      data: { operation: "training", input },
    })
  ).json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/tasks/${taskId}/runs/${legacy.id}`)
          ).json()
        ).status,
    )
    .toBe("succeeded");
  const saved = await (
    await request.post(`/api/tasks/${taskId}/design`, {
      data: {
        request: input,
        scenario: "training",
        runId: legacy.id,
        stage: 4,
      },
    })
  ).json();
  await page.goto(`/?task=${taskId}`);
  await expect(page.getByRole("region", { name: "模型设置" })).toContainText(
    "历史模型 V4",
  );
  await expect(page.getByLabel("集群卡数", { exact: true })).toHaveValue(
    "12345",
  );
  await expect(page.getByLabel("结果口径", { exact: true })).toContainText(
    "历史模型 V4",
  );
  await page.getByRole("button", { name: "返回任务主页" }).click();
  const after = await (await request.get(`/api/tasks/${taskId}/design`)).json();
  expect(after.revision).toBe(saved.revision);
  expect(after.request).toEqual(saved.request);
  expect(after.runId).toBe(legacy.id);
});

test("legacy input mapping cannot silently replace the default expert design", async ({
  page,
  request,
  taskId,
}) => {
  await page.goto(`/?task=${taskId}`);
  await page.getByLabel("审核卡数", { exact: true }).fill("24680");
  await page.getByRole("button", { name: "输入与来源", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "legacy-training.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"cards":100000,"target":0.943,"model":{"fits":[0,0,0,0]}}',
    ),
  });
  await expect(
    page.getByRole("heading", { name: "legacy-training.json" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认输入", exact: true }).click();
  await page
    .getByRole("button", { name: "应用到场景 / 资产库", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("尚未改动当前专家设计");
  await page
    .getByRole("button", { name: "可靠性设计与评估", exact: true })
    .click();
  await expect(page.getByLabel("审核卡数", { exact: true })).toHaveValue(
    "24680",
  );
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${taskId}/design`)).json())
          ?.auditDraft?.request.cards,
    )
    .toBe(24680);
  const saved = await (await request.get(`/api/tasks/${taskId}/design`)).json();
  expect(saved.activeAssessment).toBe("audit");
  expect(saved.auditDraft.request.cards).toBe(24680);
});

test("expert assessment loads while optional connection discovery is still pending", async ({
  page,
  taskId,
}) => {
  let agentRequests = 0;
  page.on("request", (request) => {
    if (/\/agent\/(web|session)(?:$|\?)/.test(request.url())) agentRequests++;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/settings", async (route) => {
    await pending;
    await route.fulfill({ json: {} });
  });
  try {
    await page.goto(`/?task=${taskId}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "可靠性设计与评估",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("审核卡数", { exact: true }).fill("20000");
    await expect(page.getByLabel("审核卡数", { exact: true })).toHaveValue(
      "20000",
    );
    expect(agentRequests).toBe(0);
  } finally {
    release();
  }
});

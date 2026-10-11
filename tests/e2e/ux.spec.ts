import { test, expect } from "./task-fixture";
test.beforeEach(async ({ request, taskId }) => {
  const defaults = await (await request.get("/api/defaults")).json();
  await request.post("/api/tasks/" + taskId + "/design", {
    data: {
      request: defaults.training,
      scenario: "training",
      stage: 0,
      confirmed: [],
      session: "",
    },
  });
});
test("target, budget, workflow and allocation stay consistent after refresh", async ({
  page,
  taskId,
}) => {
  await page.goto("/?view=workflow&task=" + taskId);
  await page.getByLabel("正确交付目标（0–1）").fill(".995");
  await page.getByLabel("集群卡数").fill("10000");
  await expect(page.getByLabel("正确交付目标（0–1）")).toHaveValue(".995");
  await page
    .getByRole("button", { name: "十万卡 · 94.3%", exact: true })
    .click();
  await page.getByLabel("观察窗口（小时）").fill("24");
  await page.getByRole("button", { name: "保存预算并加入评估输入" }).click();
  await expect(
    page.getByText("已保存设计预算；结果将对照预测损失。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认并进入下一步" }).click();
  await expect(
    page.getByRole("region", { name: "当前流程阶段" }),
  ).toContainText("第 2 / 6 步");
  await expect(page.getByText(/草稿已保存/)).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get("/api/tasks/" + taskId + "/design")
          ).json()
        ).stage,
    )
    .toBe(1);
  await page.reload();
  await expect(page.getByLabel("集群卡数")).toHaveValue("100000");
  await expect(page.getByLabel("观察窗口（小时）")).toHaveValue("24");
  await expect(
    page.getByRole("region", { name: "当前流程阶段" }),
  ).toContainText("第 2 / 6 步");
  await page.getByRole("button", { name: "选择子模型分配方法" }).click();
  await expect(page.getByLabel("子模型整体目标（0–1）")).toHaveValue("0.943");
  await expect(page.getByLabel("子模型任务窗口（小时）")).toHaveValue("24");
  await page.getByRole("button", { name: "比较适用分配方法" }).click();
  await expect(
    page.getByRole("heading", { name: "同指标分配结果对照" }),
  ).toBeVisible();
  await expect(page.locator(".allocation-comparison")).toContainText("ARINC");
  await expect
    .poll(async () =>
      (await page.locator(".allocation-comparison").innerText()).includes(
        "等待结果",
      ),
    )
    .toBe(false);
  await page
    .getByRole("button", { name: "可靠性设计工作台", exact: true })
    .click();
  await page.getByLabel("正确交付目标（0–1）").fill(".95");
  await expect(
    page.getByText("目标或窗口已改变，旧预算已失效，请重新确认。"),
  ).toBeVisible();
});
test("published bindings can be reviewed, manual GPU FIT edits are not overwritten", async ({
  page,
  taskId,
  request,
}) => {
  await page.goto("/?view=workflow&task=" + taskId);
  await page.getByRole("button", { name: "资产库", exact: true }).click();
  await page
    .locator(".asset-list")
    .getByRole("button")
    .filter({ hasText: "GPU示例模式" })
    .first()
    .click();
  await page.getByLabel("查看资产版本").selectOption("1");
  await page
    .getByLabel("我已核对资产的发生率口径、适用条件及模型字段映射")
    .check();
  await page.getByRole("button", { name: "将已校验版本应用到训练" }).click();
  await page
    .getByRole("button", { name: "可靠性设计工作台", exact: true })
    .click();
  await expect(page.getByText(/已绑定 1 个冻结资产版本/)).toBeVisible();
  await page.getByLabel("GPU FIT", { exact: true }).fill("1200");
  await expect(page.getByRole("status")).toContainText("已解除资产绑定");
  await page.getByLabel("仿真轨迹数").fill("4");
  await page.getByLabel("观察窗口（小时）").fill("24");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/tasks/" + taskId + "/runs") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "开始评估", exact: true }).click();
  const run = await (await response).json();
  const persisted = await (
    await request.get("/api/tasks/" + taskId + "/runs/" + run.id)
  ).json();
  expect(persisted.input.model.fits[1]).toBe(1200);
  expect(persisted.input.assetRefs).toEqual([]);
  await expect(
    page.getByText("训练有效可用度（正确交付产出率）", { exact: true }),
  ).toBeVisible();
});
test("CSV template imports as reviewable library drafts and version history remains selectable", async ({
  page,
  taskId,
  request,
}) => {
  const csv = await (
    await request.get("/api/templates/fault-modes.csv")
  ).body();
  await page.goto("/?view=workflow&task=" + taskId);
  await page.getByRole("button", { name: "输入与来源", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "fault-modes.csv",
    mimeType: "text/csv",
    buffer: csv,
  });
  await page.getByRole("button", { name: "确认输入" }).click();
  await expect(
    page.getByRole("heading", { name: "映射预览 · 不补缺失参数" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "应用到场景 / 资产库" }).click();
  await expect(page.getByRole("status")).toContainText("草稿");
  await page.getByRole("button", { name: "资产库", exact: true }).click();
  await page
    .locator(".asset-list")
    .getByRole("button")
    .filter({ hasText: "GPU示例模式" })
    .first()
    .click();
  await page.getByRole("button", { name: "复制为新版本" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toBeEnabled();
  await page.getByLabel("查看资产版本").selectOption("1");
  await expect(page.getByLabel("名称", { exact: true })).toBeDisabled();
});
test("locally installed OpenCode is the embedded UI with native model and API configuration", async ({
  page,
  taskId,
}) => {
  test.skip(
    !process.env.TEST_OPENCODE_URL,
    "Requires installed local OpenCode",
  );
  test.setTimeout(90000);
  await page.goto("/?view=workflow&task=" + taskId);
  await page.getByRole("button", { name: "新建关联会话" }).click();
  const frame = page.frameLocator('iframe[title="本地官方 OpenCode Web"]');
  await expect(
    frame.getByRole("button", { name: /^(Big Pickle|GLM-5\.3(?: Highspeed)?)$/ }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "同步当前设计" }).click();
  await expect(page.getByRole("status")).toContainText("尚未调用模型");
  await expect(frame.getByText(/ReMAP 任务摘要/).first()).toBeVisible({
    timeout: 15000,
  });
  await frame.getByRole("button", { name: /^(Big Pickle|GLM-5\.3(?: Highspeed)?)$/ }).click();
  await page.screenshot({ path: "artifacts/native-opencode-models.png" });
  await expect(frame.getByText(/^(管理模型|Manage models)$/)).toBeVisible();
  await page.getByRole("button", { name: "官方设置", exact: true }).click();
  await frame.getByRole("button", { name: /^(设置|Settings)$/ }).click();
  await frame
    .getByRole("dialog")
    .getByText(/^(提供商|Providers)$/)
    .click();
  await frame
    .getByRole("button", { name: /^(连接|Connect)$/ })
    .last()
    .click();
  await expect(frame.getByText(/^(基础 URL|Base URL)$/)).toBeVisible();
  await expect(frame.getByText(/^(API 密钥|API key|API Key)$/)).toBeVisible();
  await page.screenshot({ path: "artifacts/native-opencode-provider.png" });
});
test("analysis candidates without factors remain editable and cannot replace formal training delivery", async ({
  page,
  taskId,
  request,
}) => {
  const defaults = await (await request.get("/api/defaults")).json();
  const base = { ...defaults.training, hours: 1, trials: 4 };
  delete base.factors;
  const run = await (
    await request.post("/api/tasks/" + taskId + "/runs", {
      data: {
        operation: "compare",
        input: {
          base,
          variants: [{ id: "candidate", model: { hardSeconds: 5 } }],
        },
      },
    })
  ).json();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get("/api/tasks/" + taskId + "/runs/" + run.id)
          ).json()
        ).status,
    )
    .toBe("succeeded");
  await request.post("/api/tasks/" + taskId + "/design", {
    data: {
      request: base,
      scenario: "training",
      stage: 5,
      confirmed: [],
      session: "",
      runId: run.id,
    },
  });
  await page.goto("/?view=workflow&task=" + taskId);
  await page.getByRole("button", { name: "记录交付确认" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "训练设计交付需要当前设计的训练仿真结果",
  );
  await page.getByRole("button", { name: "应用到当前设计" }).click();
  await expect(page.getByLabel("GPU FIT", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("候选已回代当前设计");
  await expect(
    page.getByRole("button", { name: "开始评估", exact: true }),
  ).toBeEnabled();
});
test("late mapping from another input cannot change parameters or provenance", async ({
  page,
  taskId,
  request,
}) => {
  const stamp = Date.now();
  const create = async (name: string, cards: number) => {
    const source = await (
      await request.post("/api/tasks/" + taskId + "/inputs", {
        data: {
          name,
          base64: Buffer.from(JSON.stringify({ cards })).toString("base64"),
        },
      })
    ).json();
    return (
      await request.post(`/api/tasks/${taskId}/inputs/${source.id}/confirm`, {
        data: {},
      })
    ).json();
  };
  const a = await create(`race-a-${stamp}.json`, 10000);
  const b = await create(`race-b-${stamp}.json`, 100000);
  let started = false;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/tasks/*/inputs/${a.id}/mapping`, async (route) => {
    started = true;
    await blocked;
    await route.continue();
  });
  await page.goto("/?view=workflow&task=" + taskId);
  await page.getByRole("button", { name: "输入与来源", exact: true }).click();
  await page
    .locator(".asset-list")
    .getByRole("button")
    .filter({ hasText: a.filename })
    .filter({ hasText: "已确认" })
    .first()
    .click();
  await expect.poll(() => started).toBe(true);
  await page
    .locator(".asset-list")
    .getByRole("button")
    .filter({ hasText: b.filename })
    .filter({ hasText: "已确认" })
    .first()
    .click();
  await expect(page.locator(".mapping-preview")).toContainText("100000");
  const late = page.waitForResponse((r) =>
    r.url().includes(`/inputs/${a.id}/mapping`),
  );
  release();
  await late;
  await expect(page.locator(".mapping-preview")).toContainText("100000");
  await page.getByRole("button", { name: "应用到场景 / 资产库" }).click();
  await expect(page.getByLabel("集群卡数")).toHaveValue("100000");
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/tasks/" + taskId + "/design")).json())
          .request.inputId,
    )
    .toBe(b.id);
});

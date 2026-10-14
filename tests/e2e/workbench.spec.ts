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
test("training evaluation, evidence snapshot, report, changed input and cancellation", async ({
  page,
  taskId,
}) => {
  await page.goto("/?view=workflow&task=" + taskId);
  await expect(
    page.getByRole("heading", { name: "从整体目标，走向可验证的设计。" }),
  ).toBeVisible();
  await page.getByLabel("仿真轨迹数").fill("8");
  await page.getByLabel("观察窗口（小时）").fill("24");
  await page.getByRole("button", { name: "开始评估", exact: true }).click();
  await expect(
    page.getByText("可用度（历史模型 V4）", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "可用度目标（0–1）", exact: true })
    .fill(".95");
  await expect(page.getByText("输入已改变；已有结果需重算")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "验证与诊断摘要", exact: true }),
  ).toBeVisible();
  await page.getByText("输入与资产追溯", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "下载结果 JSON", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "下载报告" })).toHaveAttribute(
    "href",
    /report/,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/workbench.png", fullPage: false });
  await page.screenshot({
    path: "artifacts/workbench-full.png",
    fullPage: true,
  });
});
test("catalog publishing preserves immutable versions and import confirms structured inputs", async ({
  page,
  taskId,
}) => {
  await page.goto("/?view=workflow&task=" + taskId);
  await page.getByRole("button", { name: "资产库", exact: true }).click();
  await page.getByRole("button", { name: "新建资产" }).click();
  await page
    .getByLabel("名称", { exact: true })
    .fill("浏览器验证模式 " + Date.now());
  await page.getByText("完整参数 JSON · 高级编辑").click();
  await page
    .getByLabel("参数、适用条件、证据与引用")
    .fill('{"fit":1000,"rateBasis":"device-hour"}');
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByRole("button", { name: "校验并冻结版本" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "复制为新版本" }).click();
  await expect(page.getByLabel("名称", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "输入与来源", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "training.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"cards":100000,"target":0.943}'),
  });
  await expect(
    page.getByRole("heading", { name: "training.json" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认输入" }).click();
  await page.getByRole("button", { name: "应用到场景 / 资产库" }).click();
  await expect(page.getByLabel("集群卡数")).toHaveValue("100000");
});

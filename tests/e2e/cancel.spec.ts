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
test("cancelling a new run retains the previous completed evaluation", async ({
  page,
  taskId,
}) => {
  await page.goto("/?view=workflow&task=" + taskId);
  await page.getByLabel("仿真轨迹数").fill("4");
  await page.getByLabel("观察窗口（小时）").fill("24");
  await page.getByRole("button", { name: "开始评估", exact: true }).click();
  await expect(
    page.getByText("训练有效可用度（正确交付产出率）", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("仿真轨迹数").fill("8192");
  await page.getByLabel("观察窗口（小时）").fill("8760");
  await page.getByRole("button", { name: "开始评估", exact: true }).click();
  await page.getByRole("button", { name: "取消计算", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "上次完整结果" }),
  ).toBeVisible();
  await expect(
    page.getByText("训练有效可用度（正确交付产出率）", { exact: true }),
  ).toBeVisible();
});

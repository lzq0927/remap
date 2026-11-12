import { mkdir } from "node:fs/promises";
import { test, expect } from "./task-fixture";
test.use({ fullWorkspace: false });
test("weekly architecture, actual catalogs, recovery editing and version replay", async ({
  page,
  taskId,
  request,
}) => {
  await page.goto(`/?task=${taskId}`);
  const panel = page.getByRole("region", {
    name: "周度现状与改进",
    exact: true,
  });
  await expect(panel).toContainText("27.19 → 10.88 h");
  const core = panel.locator('[data-weekly-module="aicore-sdc"]');
  await expect(core.locator('[data-stage="current"]')).toContainText("83.82%");
  await expect(core.locator('[data-stage="improved"]')).toContainText("93.53%");
  await panel.getByLabel("周度架构图显示").selectOption("current");
  await expect(core.locator('[data-stage="improved"]')).toHaveCount(0);
  await panel.getByLabel("周度架构图显示").selectOption("improved");
  await expect(core.locator('[data-stage="current"]')).toHaveCount(0);
  await panel.getByLabel("周度架构图显示").selectOption("both");
  await expect(panel.locator('[data-weekly-module="hbm"]')).toContainText(
    "损失待补",
  );
  await panel.getByRole("button", { name: "保存场景并更新两库" }).click();
  await expect(panel.getByRole("status")).toContainText("已保存r1");
  const assets = await (
    await request.get(`/api/tasks/${taskId}/catalogs?kind=mechanism`)
  ).json();
  expect(
    assets.filter(
      (a: any) => a.payload.scenarioVersion === "weekly-2026-11-12.v1",
    ),
  ).toHaveLength(5);
  await panel
    .getByText("参数与恢复链 · 编辑并重新计算", { exact: true })
    .click();
  await panel.getByLabel("改进后静默检出率", { exact: true }).fill("99");
  await panel.getByRole("button", { name: "保存场景并更新两库" }).click();
  await expect(panel.getByRole("status")).toContainText("已保存r2");
  await expect(core).toContainText("1.09h");
  await page.reload();
  await expect(panel).toContainText("27.19 → 1.09 h");
  await panel.getByLabel("周度场景版本").selectOption("1");
  await expect(core).toContainText("10.88h");
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出计算记录" }).click();
  expect((await download).suggestedFilename()).toBe(
    "ReMAP-周度现状与改进.json",
  );
  await mkdir("artifacts/weekly-reliability", { recursive: true });
  await panel.screenshot({
    path: "artifacts/weekly-reliability/weekly-overview.png",
  });
});

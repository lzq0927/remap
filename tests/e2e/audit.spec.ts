import { test, expect } from "./task-fixture";
test("review workflow runs the chosen expert metric and downloads a complete audit", async ({
  page,
  request,
  taskId,
}) => {
  await page.goto("/?task=" + taskId);
  const panel = page.getByRole("region", { name: "故障事件与机制收益审核" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("审核窗口（小时）", { exact: true }).fill("24");
  await panel.getByLabel("每场景轨迹数", { exact: true }).fill("8");
  await panel.getByLabel("每组合轨迹数", { exact: true }).fill("8");
  await panel
    .getByText("内网中断数据替换与硬件降 FIT", { exact: true })
    .click();
  await panel
    .getByLabel("基线事件更新", { exact: true })
    .fill(
      JSON.stringify([
        {
          id: "CORE-hard",
          fit: 420,
          source: "synthetic browser fixture",
          evidence: "scenario",
          rateBasis: "npu-equivalent-hour",
        },
      ]),
    );
  await panel.getByRole("button", { name: "运行事件与机制审核" }).click();
  await expect(
    page.getByText("事件与机制收益审核 · 保留干净检查点", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const link = page.getByRole("link", { name: "下载报告", exact: true });
  await expect(link).toBeVisible();
  const url = await link.getAttribute("href");
  const response = await request.get(url!);
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain("synthetic browser fixture");
  expect(html).toContain("CORE-hard");
  expect(html).toContain("独立故障事件库");
  expect(html).toContain("关键参数敏感性");
  const run = (
    await (await request.get(`/api/tasks/${taskId}/runs`)).json()
  ).find((r: any) => r.operation === "audit");
  const detail = await (
    await request.get(`/api/tasks/${taskId}/runs/${run.id}`)
  ).json();
  expect(detail.result.metricId).toBe("training.retained-clean-progress");
  expect(detail.result.events.find((e: any) => e.id === "CORE-hard").fit).toBe(
    420,
  );
});

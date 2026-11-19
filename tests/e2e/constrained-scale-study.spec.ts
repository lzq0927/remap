import { test, expect } from "@playwright/test";
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1600, height: 1050 },
});

test("固定域工作流：载入、分配、部件周损失、三线收益、参数调整与导出", async ({
  page,
  request,
}) => {
  const task = await (
    await request.post("/api/tasks", {
      data: { name: "固定约束五规模 " + Date.now() },
    })
  ).json();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?task=" + task.id);
  await page.getByRole("button", { name: "载入本轮约束场景" }).click();
  const requirements = page.getByRole("region", { name: "已知现状与固定目标" });
  await expect(requirements).toContainText("63.00000%");
  await expect(requirements).toContainText("60.00000%");
  await expect(
    requirements.getByLabel("供电与冷却整项固定目标（%）"),
  ).toHaveValue("99.999");
  const steps = page.getByRole("navigation", { name: "四步工作流" });
  await steps.getByRole("button", { name: /可用度评估/ }).click();
  const gaps = page.getByRole("region", { name: "硬件损失差距排序" });
  const rows = gaps.locator("tbody tr");
  await expect(rows.nth(0)).toHaveAttribute("data-gap-module", "optical");
  await expect(rows.nth(1)).toHaveAttribute("data-gap-module", "aicore");
  await expect(rows.nth(2)).toHaveAttribute("data-gap-module", "hbm");
  const topology = page.getByRole("region", { name: "系统架构图" });
  const optical = topology.getByRole("button", { name: /^光模块，/ });
  await expect(optical).toContainText("周损失 36.4 h");
  await expect(optical).toContainText("166.6次/周");
  await topology.getByRole("tab", { name: "设计后" }).click();
  await expect(optical).toContainText("16.7次/周");
  await steps.getByRole("button", { name: /机制设计/ }).click();
  const curves = page.getByRole("region", { name: "逐措施跨规模收益" });
  await expect(curves).toContainText("99.3287%");
  await curves.getByLabel("收益曲线措施分类").selectOption("mtbf");
  await expect(curves.locator("[data-scale-measure]").first()).toHaveAttribute(
    "data-scale-measure",
    "optical-reliability",
  );
  await expect(curves.getByRole("img")).toHaveCount(6);
  await expect(curves.getByRole("img").first()).toContainText("目标");
  await expect(curves.getByRole("img").first()).toContainText("周损失（h）");
  await expect(
    curves.getByRole("img").first().locator(".rw-benefit-band"),
  ).toHaveCount(4);
  await expect(curves.getByRole("img").first()).toContainText("仅优化该项");
  const hbmCurve = curves.locator('[data-scale-measure="hbm-ecc"]');
  const before = await hbmCurve.locator("p").innerText();
  const ratio = page.getByLabel("HBM 纠错增强 · 故障率 FIT");
  await ratio.fill("70");
  await ratio.press("Enter");
  await expect(hbmCurve.locator("p")).not.toHaveText(before);
  await page
    .getByText("部件与故障模式：恢复链参数、频次和周损失前后对照", {
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "检测→恢复→回滚" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出报告", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("可用度设计报告.html");
  await expect
    .poll(
      async () =>
        (
          await (await request.get(`/api/tasks/${task.id}/core`)).json()
        ).model.measures.find((m: { id: string }) => m.id === "hbm-ecc")
          .effects[0].value,
    )
    .toBe(0.7);
  expect(errors).toEqual([]);
});

import { mkdir } from "node:fs/promises";
import { test, expect } from "./task-fixture";
test.use({ fullWorkspace: false });
for (const width of [1440, 390])
  test(`layered graph retains readable navigation and real minimap geometry at ${width}px`, async ({
    page,
    taskId,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/?task=${taskId}`);
    await page
      .getByRole("button", { name: "确认并进入下一步", exact: true })
      .click();
    const atlas = page.getByRole("region", {
      name: "架构故障机制全景",
      exact: true,
    });
    await atlas
      .getByRole("button", { name: "交互分层拓扑", exact: true })
      .click();
    await expect(
      atlas.locator(".react-flow__minimap-node").first(),
    ).toBeVisible();
    await atlas
      .getByText("定位与筛选 · 对象、功能域、层级", { exact: true })
      .click();
    await atlas
      .getByLabel("全景查看层级", { exact: true })
      .selectOption("hardware-chip");
    const shapes = await atlas
      .locator(".react-flow__minimap-node")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          tag: n.tagName,
          width: n.getAttribute("width"),
          height: n.getAttribute("height"),
          fill: getComputedStyle(n).fill,
        })),
      );

    expect(
      shapes.some((n) => Number(n.width) > 0 && Number(n.height) > 0),
    ).toBe(true);
    await mkdir("artifacts/architecture-atlas", { recursive: true });
    await atlas.screenshot({
      path: `artifacts/architecture-atlas/navigation-${width}.png`,
    });
    await atlas
      .getByText("定位与筛选 · 对象、功能域、层级", { exact: true })
      .click();
    await atlas
      .getByRole("button", { name: "全屏大图", exact: true })
      .click();
    const canvas = atlas.getByLabel("交互分层拓扑画布", { exact: true });
    expect((await canvas.boundingBox())!.y).toBeLessThan(500);
    await atlas.getByRole("button", { name: "筛选与依据", exact: true }).click();
    await expect(atlas.locator(".atlas-locate")).toBeVisible();
    await atlas.getByRole("button", { name: "筛选与依据", exact: true }).click();
    await expect(atlas.locator(".atlas-locate")).toBeHidden();
    await atlas.screenshot({
      path: `artifacts/architecture-atlas/navigation-fullscreen-${width}.png`,
    });
    await page.keyboard.press("Escape");
  });

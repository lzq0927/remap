import { test, expect } from "./task-fixture";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`ReMAP workflow navigation stays visible after scrolling at ${viewport.width}px`, async ({
    page,
    taskId,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page).toHaveTitle("ReMAP — 可靠性设计工作台");
    await expect(
      page.getByText("ReMAP / Reliability Modeling and Analysis Platform"),
    ).toBeVisible();
    await page.goto("/?view=workflow&task=" + taskId);
    await expect(
      page.getByRole("button", { name: "可靠性设计工作台", exact: true }),
    ).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "六阶段评估流程" });
    await expect(navigation).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1600));
    await expect.poll(async () => (await navigation.boundingBox())?.y).toBe(0);
    await expect(navigation.getByRole("button")).toHaveCount(6);
    await navigation.getByRole("button").nth(1).click();
    const target = page.locator("#design-system");
    await expect
      .poll(async () => {
        const bar = await navigation.boundingBox();
        const section = await target.boundingBox();
        return (
          !!bar &&
          !!section &&
          section.y >= bar.y + bar.height &&
          section.y < viewport.height
        );
      })
      .toBe(true);
    await expect(navigation.getByRole("button").nth(1)).toHaveAttribute(
      "aria-current",
      "step",
    );
    await page.screenshot({
      path: `artifacts/remap-navigation-${viewport.width}.png`,
    });
  });
}

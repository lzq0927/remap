import { selectAssessment } from "./model-selection";
import { test, expect } from "./task-fixture";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  for (const mode of ["audit", "workflow"]) {
    test(`${mode} workflow stays compact and reachable at ${viewport.width}px`, async ({
      page,
      taskId,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/?task=${taskId}`);
      if (mode === "workflow") await selectAssessment(page, "workflow");
      const navigation = page.getByRole("navigation", {
        name: "六阶段评估流程",
      });
      const dock = page.locator(".workflow-dock");
      await expect(navigation).toBeVisible();
      await expect(navigation.getByRole("button")).toHaveCount(6);
      await expect(navigation.locator(".step-connector")).toHaveCount(5);
      await page.evaluate(() => window.scrollTo(0, 1600));
      await expect.poll(async () => (await dock.boundingBox())?.y).toBe(0);
      expect((await dock.boundingBox())!.height).toBeLessThan(180);
      await expect(
        page.getByRole("button", { name: "上一步", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "确认并进入下一步", exact: true }),
      ).toBeInViewport();
      await navigation.getByRole("button").nth(1).click();
      const target = page.locator(
        mode === "audit" ? "#audit-evidence" : "#design-system",
      );
      await expect(target).toBeVisible();
      await expect
        .poll(async () => {
          const bar = await dock.boundingBox(),
            section = await target.boundingBox();
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
      await page
        .getByRole("button", { name: "步骤说明与记录", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("浏览或返回已确认步骤不会重复签认");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "步骤说明与记录", exact: true }),
      ).toBeFocused();
      await page.getByRole("button", { name: "上一步", exact: true }).click();
      await expect(navigation.getByRole("button").nth(0)).toHaveAttribute(
        "aria-current",
        "step",
      );
      await expect(
        page.getByRole("button", { name: "上一步", exact: true }),
      ).toBeDisabled();
      await navigation.getByRole("button").nth(3).click();
      if (mode === "audit")
        await expect(page.locator("#audit-parameters")).not.toHaveAttribute(
          "open",
          "",
        );
      const active = navigation.locator('[aria-current="step"]');
      await expect
        .poll(async () => {
          const button = await active.boundingBox(),
            rail = await navigation.boundingBox();
          return (
            !!button &&
            !!rail &&
            button.x >= rail.x &&
            button.x + button.width <= rail.x + rail.width
          );
        })
        .toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/frontend-review/${mode}-${viewport.width}.png`,
      });
    });
  }
}

test("returning to a confirmed step advances without another confirmation", async ({
  page,
  request,
  taskId,
}) => {
  await page.goto(`/?task=${taskId}`);
  await page
    .getByRole("button", { name: "确认并进入下一步", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "当前流程阶段" }),
  ).toContainText("第 2 / 6 步");
  const before = await (
    await request.get(`/api/tasks/${taskId}/workflow`)
  ).json();
  await page.getByRole("button", { name: "上一步", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "当前流程阶段" }),
  ).toContainText("第 2 / 6 步");
  const after = await (
    await request.get(`/api/tasks/${taskId}/workflow`)
  ).json();
  expect(after.revision).toBe(before.revision);
  expect(after.steps[1].status).not.toBe("confirmed");
});

test("opening Agent keeps the selected workflow step visible in the narrower canvas", async ({
  page,
  taskId,
}) => {
  await page.goto(`/?task=${taskId}`);
  const navigation = page.getByRole("navigation", { name: "六阶段评估流程" });
  await navigation.getByRole("button").nth(5).click();
  await page
    .getByRole("button", { name: "显示或收起 Agent", exact: true })
    .click();
  const active = navigation.locator('[aria-current="step"]');
  await expect
    .poll(async () => {
      const button = await active.boundingBox(),
        bar = await navigation.boundingBox();
      return (
        !!button &&
        !!bar &&
        button.x >= bar.x &&
        button.x + button.width <= bar.x + bar.width
      );
    })
    .toBe(true);
});

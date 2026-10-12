import type { Page } from "@playwright/test";

/** Use the same advanced setting a user uses; there is no second top-level entry. */
export async function selectAssessment(
  page: Page,
  model: "audit" | "workflow",
) {
  const settings = page.getByRole("region", { name: "模型设置", exact: true });
  const advanced = settings.locator("details");
  if ((await advanced.getAttribute("open")) === null)
    await advanced.getByText("高级设置", { exact: true }).click();
  await settings.getByLabel("评估模型", { exact: true }).selectOption(model);
  await advanced.getByText("高级设置", { exact: true }).click();
}

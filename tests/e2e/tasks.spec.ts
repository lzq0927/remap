import { test, expect } from "@playwright/test";

test("homepage requires explicit task choice and task inputs and sessions remain isolated", async ({
  page,
  request,
}) => {
  const suffix = Date.now();
  const a = await (
    await request.post("/api/tasks", { data: { name: `任务 A ${suffix}` } })
  ).json();
  const b = await (
    await request.post("/api/tasks", { data: { name: `任务 B ${suffix}` } })
  ).json();
  const globalDataRequests: string[] = [];
  page.on("request", (r) => {
    if (
      /\/api\/(design|inputs|runs|feedback|workflow|agent\/web)(?:[/?]|$)/.test(
        r.url(),
      )
    )
      globalDataRequests.push(r.url());
  });
  await page.route("**/api/tasks/*/agent/web", async (route) => {
    const id = route.request().url().split("/tasks/")[1].split("/")[0];
    await route.fulfill({
      json: {
        url: "about:blank",
        projectUrl: "about:blank#",
        version: "test",
        sessions: [
          { id: `session-${id}`, title: `${id === a.id ? "A" : "B"} 主会话` },
        ],
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "可靠性设计任务" }),
  ).toBeVisible();
  await expect(page.getByLabel("集群卡数")).toHaveCount(0);
  const card = (name: string) =>
    page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card(a.name)
    .getByRole("button", { name: "打开任务", exact: true })
    .click();
  await page.getByLabel("集群卡数").fill("12345");
  await page.getByLabel("关联 OpenCode 会话").selectOption(`session-${a.id}`);
  await expect(
    page.getByLabel("关联 OpenCode 会话").locator("option"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "返回任务主页" }).click();
  await expect(
    page.getByRole("heading", { name: "可靠性设计任务" }),
  ).toBeVisible();
  await card(b.name)
    .getByRole("button", { name: "打开任务", exact: true })
    .click();
  await expect(page.getByLabel("集群卡数")).not.toHaveValue("12345");
  await expect(page.getByLabel("关联 OpenCode 会话")).toHaveValue("");
  await expect(
    page
      .getByLabel("关联 OpenCode 会话")
      .locator(`option[value="session-${a.id}"]`),
  ).toHaveCount(0);
  await page.getByLabel("集群卡数").fill("54321");
  await page.getByLabel("关联 OpenCode 会话").selectOption(`session-${b.id}`);
  await page.getByRole("button", { name: "返回任务主页" }).click();
  await card(a.name)
    .getByRole("button", { name: "打开任务", exact: true })
    .click();
  await expect(page.getByLabel("集群卡数")).toHaveValue("12345");
  await expect(page.getByLabel("关联 OpenCode 会话")).toHaveValue(
    `session-${a.id}`,
  );
  const designA = await (await request.get(`/api/tasks/${a.id}/design`)).json();
  const designB = await (await request.get(`/api/tasks/${b.id}/design`)).json();
  expect(designA.request.cards).toBe(12345);
  expect(designB.request.cards).toBe(54321);
  expect(globalDataRequests).toEqual([]);
});

test("create, rename, copy and archive tasks through homepage", async ({
  page,
}) => {
  const name = "新任务 " + Date.now();
  await page.goto("/");
  await page.getByLabel("新任务名称").fill(name);
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await expect(page.getByLabel("当前任务")).toContainText(name);
  await page.getByRole("button", { name: "返回任务主页" }).click();
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card.getByRole("button", { name: "重命名", exact: true }).click();
  await page.getByLabel("重命名任务").fill(name + " 更名");
  await page.getByRole("button", { name: "保存名称" }).click();
  const renamed = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: name + " 更名", exact: true }),
  });
  await renamed.getByRole("button", { name: "复制任务" }).click();
  await expect(page.getByLabel("当前任务")).toContainText(name + " 更名 副本");
  await page.getByRole("button", { name: "返回任务主页" }).click();
  await renamed.getByRole("button", { name: "归档", exact: true }).click();
  await expect(renamed.getByText("已归档")).toBeVisible();
  await renamed.getByRole("button", { name: "重新打开" }).click();
  await expect(page.getByLabel("当前任务")).toContainText(name + " 更名");
});

test("saving budget requires manual review and stage navigation keeps input revision stable", async ({
  page,
  request,
}) => {
  const task = await (
    await request.post("/api/tasks", {
      data: { name: "流程版本 " + Date.now() },
    })
  ).json();
  await page.goto("/");
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", { name: task.name, exact: true }),
    })
    .getByRole("button", { name: "打开任务", exact: true })
    .click();
  await page.getByRole("button", { name: "保存预算并加入评估输入" }).click();
  await page
    .getByRole("button", { name: "确认并进入下一步", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "描述系统", exact: true }),
  ).toBeVisible();
  const design = await (
    await request.get("/api/tasks/" + task.id + "/design")
  ).json();
  let state = await (
    await request.get("/api/tasks/" + task.id + "/workflow")
  ).json();
  expect(state.steps[0].status).toBe("confirmed");
  expect(state.steps[2].status).toBe("waiting-input");
  for (let i = 1; i < 4; i++) {
    await page
      .getByRole("button", { name: "确认并进入下一步", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get("/api/tasks/" + task.id + "/workflow")
            ).json()
          ).steps[i].status,
      )
      .toBe("confirmed");
  }
  const after = await (
    await request.get("/api/tasks/" + task.id + "/design")
  ).json();
  expect(after.revision).toBe(design.revision);
  state = await (
    await request.get("/api/tasks/" + task.id + "/workflow")
  ).json();
  expect(
    state.steps.slice(0, 4).every((s: any) => s.confirmedBy === "user"),
  ).toBe(true);
  await page.getByLabel("集群卡数").fill("11223");
  await page
    .getByRole("button", { name: "确认并进入下一步", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("请先完成一次评估");
  await page.getByRole("button", { name: "返回任务主页" }).click();
  const changed = await (
    await request.get("/api/tasks/" + task.id + "/design")
  ).json();
  expect(changed.revision).toBe(design.revision + 1);
  state = await (
    await request.get("/api/tasks/" + task.id + "/workflow")
  ).json();
  expect(state.stale).toBe(true);
});

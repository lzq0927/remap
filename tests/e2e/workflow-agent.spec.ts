import { test, expect } from "./task-fixture";
import { readFile } from "node:fs/promises";

test("Agent stage assets appear centrally and human review gates the same real solver flow", async ({
  page,
  request,
  taskId,
}) => {
  const prefix = "/api/tasks/" + taskId;
  const defaults = (await (await request.get("/api/defaults")).json()).training;
  const input = { ...defaults, hours: 1, trials: 2 };
  const design = await (
    await request.post(prefix + "/design", {
      data: { request: input, scenario: "training" },
    })
  ).json();
  await request.post(prefix + "/agent/prepare", { data: {} });
  const credentials = JSON.parse(
    await readFile("data/e2e/agent-credentials.json", "utf8"),
  );
  const headers = { authorization: "Bearer " + credentials[taskId] };
  let flow = await (
    await request.post(prefix + "/workflow/start", {
      headers,
      data: { inputRevision: design.revision, mode: "auto-to-review" },
    })
  ).json();
  await page.goto("/?view=workflow&task=" + taskId);
  for (const stepId of ["clarify", "describe", "select", "prepare"]) {
    flow = await (
      await request.post(prefix + "/workflow", {
        headers,
        data: {
          executionId: flow.executionId,
          expectedRevision: flow.revision,
          inputRevision: design.revision,
          stepId,
          status: "awaiting-review",
          notes: "Agent产物 " + stepId,
          artifacts: [
            {
              type: "brief",
              title: "核对产物 " + stepId,
              data: { target: 0.99 },
            },
          ],
        },
      })
    ).json();
    await expect(
      page.getByText("Agent产物 " + stepId, { exact: true }),
    ).toBeVisible();
    const impersonation = await request.post(prefix + "/workflow", {
      headers,
      data: {
        executionId: flow.executionId,
        expectedRevision: flow.revision,
        inputRevision: design.revision,
        stepId,
        status: "confirmed",
      },
    });
    expect(impersonation.status()).toBe(403);
    // Confirm through the shared user API; API-stage binding is also covered in integration tests.
    flow = await (
      await request.post(prefix + "/workflow", {
        data: {
          executionId: flow.executionId,
          expectedRevision: flow.revision,
          inputRevision: design.revision,
          stepId,
          status: "confirmed",
        },
      })
    ).json();
  }
  const run = await (
    await request.post(prefix + "/runs", {
      headers,
      data: {
        operation: "training",
        input,
        executionId: flow.executionId,
        inputRevision: design.revision,
      },
    })
  ).json();
  await expect(
    page.getByText("可用度（历史模型 V4）", { exact: true }),
  ).toBeVisible();
  flow = await (await request.get(prefix + "/workflow")).json();
  expect(flow.runId).toBe(run.id);
  expect(flow.steps[4].status).toBe("awaiting-review");
  await expect(page.getByRole("link", { name: "下载报告" })).toHaveAttribute(
    "href",
    new RegExp(taskId + "/runs/" + run.id),
  );
});

test("archived direct task URL returns to task management for restoration", async ({
  page,
  request,
  taskId,
}) => {
  await request.post("/api/tasks/" + taskId + "/archive", { data: {} });
  await page.goto("/?view=workflow&task=" + taskId);
  await expect(
    page.getByRole("heading", { name: "可靠性设计任务" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp("task=" + taskId));
});

import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
for (const width of [1440, 390])
  test(`custom mechanism sets support generic parameter trials at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 950 });
    const prefix = `/api/tasks/${taskId}`;
    const defaults = (await (await request.get("/api/defaults")).json()).audit;
    const input = {
      ...defaults,
      cards: 20000,
      scales: [20000],
      target: 0.97,
      targets: { "20000": 0.97 },
      hours: 24,
      trials: 16,
      attributionTrials: 8,
      verificationTrials: 8,
      sensitivity: false,
      samplingProfile: "quick",
      mechanisms: ["process", "fast"],
    };
    const startResponse = await request.post(prefix + "/runs", {
      data: { operation: "audit", input },
    });
    expect(startResponse.ok(), await startResponse.text()).toBe(true);
    const started = await startResponse.json();
    let first: any;
    await expect
      .poll(
        async () => {
          first = await (
            await request.get(prefix + `/runs/${started.id}`)
          ).json();
          return first.status;
        },
        { timeout: 30000 },
      )
      .toBe("succeeded");
    await request.post(prefix + "/design", {
      data: {
        request: {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(input),
        stage: 4,
        runId: first.id,
      },
    });
    await page.goto(`/?task=${taskId}`);
    const experiments = page.getByRole("region", {
      name: "分轮评估与横向比较",
    });
    await expect(experiments).toContainText("已选2项措施");
    await expect(experiments).toContainText("恢复、检查点");
    await expect(
      experiments.getByRole("button", { name: /99\.5%/ }),
    ).toHaveCount(0);
    await experiments
      .getByRole("button", { name: "新建参数方案", exact: true })
      .click();
    await expect(
      experiments
        .getByLabel("调整对象")
        .locator('option[value="policy:D-SDC"]'),
    ).toHaveCount(0);
    await experiments.getByLabel("改进方案名称").fill("进程恢复时间对照");
    await experiments.getByLabel("调整对象").selectOption("policy:R-PROCESS");
    await experiments.getByLabel("调整参数").selectOption("successSeconds");
    await experiments
      .getByRole("button", { name: "加入参数调整", exact: true })
      .click();
    await experiments
      .getByLabel("改进值 进程恢复 · 成功耗时（秒）", { exact: true })
      .fill("12.5");
    await experiments.getByLabel("调整对象").selectOption("policy:C-FAST");
    await experiments.getByLabel("调整参数").selectOption("saveSeconds");
    await experiments
      .getByRole("button", { name: "加入参数调整", exact: true })
      .click();
    await experiments
      .getByLabel("改进值 检查点策略 · 保存阻塞（秒）", { exact: true })
      .fill("1.2");
    await experiments
      .getByRole("button", {
        name: "撤销调整 检查点策略 · 保存阻塞（秒）",
        exact: true,
      })
      .click();
    await page.screenshot({
      path: `artifacts/generic-parameter-study/editor-${width}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await experiments
      .getByRole("button", { name: "评估本次改进方案", exact: true })
      .click();
    await expect(
      experiments.getByText("刚完成：进程恢复时间对照", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const runs = await (await request.get(prefix + "/runs")).json();
    const changed = runs.find(
      (run: any) => run.result?.name === "进程恢复时间对照",
    );
    expect(changed.result.factors).toHaveLength(1);
    expect(changed.result.factors[0].value).toEqual({ successSeconds: 12.5 });
    const html = await (
      await request.get(prefix + `/runs/${changed.id}/report?format=html`)
    ).text();
    expect(html).toContain("12.5");
    expect(html).not.toMatch(/原六项|第一轮六项|现有六项/);
    expect(
      (await (await request.get(prefix + `/runs/${first.id}`)).json()).result
        .request.mechanisms,
    ).toEqual(["process", "fast"]);
  });

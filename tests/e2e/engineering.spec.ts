import { test, expect } from "./task-fixture";
test.use({ fullWorkspace: false });
test("engineering journey: sources, human review, views, real analysis, decisions and reuse", async ({
  page,
  request,
  taskId,
}) => {
  test.setTimeout(90000);
  const base = `/api/tasks/${taskId}/engineering`;
  await page.goto(`/?task=${taskId}`);
  await page.getByRole("button", { name: "系统建模", exact: true }).click();
  await page.getByRole("button", { name: "创建 AI 集群示例" }).click();
  await expect(page.getByTestId("engineering-save-status")).toContainText("v1");
  await page.getByLabel("导入专家材料", { exact: true }).setInputFiles({
    name: "expert-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "合成专家补充：协调器 A 与 B 共享机柜，fencing 拒绝过期代数令牌。",
    ),
  });
  await expect(page.getByTestId("engineering-save-status")).toContainText(
    "未保存",
  );
  await page.getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(page.getByTestId("engineering-save-status")).toContainText("v2");
  const saved = (await (await request.get(base + "/models")).json())[0];
  const candidate = structuredClone(saved.model);
  candidate.entities[0].description =
    "合成专家补充：共享机柜下部署；评估需保留共同供电事件";
  candidate.entities[0].sourceRefs.push(candidate.sources.at(-1).id);
  // Transport contract test only. Real model inference is exercised by verify-engineering-loop.ts --agent.
  await request.post(base + "/models/" + saved.id + "/proposals", {
    data: {
      expectedRevision: 2,
      model: candidate,
      reason: "补充共享部署与材料定位",
    },
  });
  await page.getByRole("tab", { name: /草案审阅/ }).click();
  await page.getByRole("button", { name: "接受草案并生成新版本" }).click();
  await expect(page.getByTestId("engineering-save-status")).toContainText("v3");
  await page.getByRole("tab", { name: "系统设计", exact: true }).click();
  await expect(page.getByLabel("系统设计画布")).toBeVisible();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect(
    await page
      .locator(".react-flow__node")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).not.toBe("0");
  await page
    .getByLabel("显示故障来源", { exact: true })
    .selectOption("network");
  await expect(page.getByTestId("engineering-save-status")).toContainText(
    "已保存",
  );
  await page.getByLabel("显示故障来源", { exact: true }).selectOption("");
  await page
    .getByLabel("设计视图", { exact: true })
    .selectOption({ label: "部署与故障域" });
  await page.getByRole("button", { name: "自动排版" }).click();
  await page.getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(page.getByTestId("engineering-save-status")).toContainText("v4");
  const layout = await (await request.get(base + "/models/" + saved.id)).json();
  const revision3 = (
    await (
      await request.get(base + "/models/" + saved.id + "/revisions")
    ).json()
  ).find((x: any) => x.revision === 3);
  expect(layout.semanticHash).toBe(revision3.semanticHash);
  await page.getByRole("button", { name: "行为时序", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "检查点提交与接管" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "分析与验证", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "可靠性成功路径框图" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "运行真实 BDD", exact: true }).click();
  await expect(page.getByText("计算完成", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  for (const caseId of [
    "coordination-fta",
    "single-coordinator-rbd",
    "coordination-availability",
    "recovery-availability",
  ]) {
    await page.getByRole("tab", { name: "分析与验证", exact: true }).click();
    await page
      .getByLabel("分析与验证案例", { exact: true })
      .selectOption(caseId);
    if (caseId === "recovery-availability") {
      const diagram = page.getByRole("img", { name: "可靠性成功路径框图" });
      await expect(diagram).toContainText("800 FIT");
      await expect(diagram).toContainText("MTTR 1 → 0.1 h");
      await diagram.screenshot({
        path: "artifacts/engineering-loop/rbd-recovery-1440.png",
      });
    }
    await page
      .getByRole("button", { name: "运行真实 BDD", exact: true })
      .click();
    await expect(
      page.getByText("计算完成", { exact: true }).first(),
    ).toBeVisible({ timeout: 20000 });
    await expect
      .poll(async () => {
        const runs = await (
          await request.get(base + "/models/" + saved.id + "/runs")
        ).json();
        return runs.find((r: any) => r.input.caseId === caseId)?.status;
      })
      .toBe("succeeded");
  }
  await page.getByRole("tab", { name: "决策与复用", exact: true }).click();
  await page.getByRole("button", { name: "记录决策", exact: true }).click();
  await page
    .getByLabel("决定", { exact: true })
    .fill("采用双协调器，演练存储快恢复");
  await page
    .getByLabel("依据与重审条件", { exact: true })
    .fill(
      "共享事件保持唯一；冗余提高任务可靠度，快恢复提高运行可用度；合成参数待校准。",
    );
  const runList = await (
    await request.get(base + "/models/" + saved.id + "/runs")
  ).json();
  const probability = (id: string) =>
    runList.find((r: any) => r.input.caseId === id).result.metrics.probability;
  expect(
    probability("coordination-rbd") + probability("coordination-fta"),
  ).toBeCloseTo(1, 12);
  expect(probability("coordination-rbd")).toBeGreaterThan(
    probability("single-coordinator-rbd"),
  );
  expect(probability("recovery-availability")).toBeGreaterThan(
    probability("coordination-availability"),
  );
  await page
    .getByLabel("关联真实运行", { exact: true })
    .selectOption(
      runList.find((r: any) => r.input.caseId === "recovery-availability").id,
    );
  await page
    .getByRole("button", { name: "保存设计为任务资产", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已沉淀任务资产" }),
  ).toBeVisible();
  const assets = await (
    await request.get(`/api/tasks/${taskId}/catalogs?kind=scenario-template`)
  ).json();
  const asset = assets.find((a: any) => a.payload.engineeringModel);
  await page.getByLabel("复用任务资产", { exact: true }).selectOption(asset.id);
  await expect(page.getByTestId("engineering-save-status")).toContainText("v1");
  const current = (await (await request.get(base + "/models")).json()).find(
    (m: any) => m.id !== saved.id,
  );
  expect(current.model.decisions[0].runRefs[0]).toMatch(/^imported-run-/);
  const importedRuns = await (
    await request.get(base + "/models/" + current.id + "/runs")
  ).json();
  expect(importedRuns).toHaveLength(5);
  expect(importedRuns.every((r: any) => r.imported)).toBe(true);
  await page.screenshot({
    path: "artifacts/engineering-loop/browser-desktop.png",
    fullPage: true,
  });
});
test("mobile engineering layout, edit persistence and undo", async ({
  page,
  taskId,
}) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto(`/?task=${taskId}`);
  await page.getByRole("button", { name: "系统建模", exact: true }).click();
  await page.getByRole("button", { name: "创建 AI 集群示例" }).click();
  await expect(page.getByTestId("engineering-save-status")).toContainText("v1");
  await page.getByLabel("设计名称", { exact: true }).fill("手机编辑");
  await page.getByRole("button", { name: "资产库", exact: true }).click();
  await page.getByRole("button", { name: "系统建模", exact: true }).click();
  await expect(page.getByLabel("设计名称", { exact: true })).toHaveValue(
    "手机编辑",
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByLabel("设计名称", { exact: true })).not.toHaveValue(
    "手机编辑",
  );
  await page.getByRole("tab", { name: "系统设计", exact: true }).click();
  await expect(page.getByLabel("当前对象", { exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect(
    await page
      .locator(".react-flow__node")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).not.toBe("0");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/engineering-loop/browser-mobile.png",
    fullPage: true,
  });
});

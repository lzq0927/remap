import type { AuditEventView } from "../../packages/contracts/src/audit-objects";
import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
test("desktop analysis opens with baseline, allocation, horizontal sources and concrete measures, then drills into evidence", async ({
  page,
  request,
  taskId,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = `/api/tasks/${taskId}`;
  const defaults = (await (await request.get("/api/defaults")).json()).audit;
  const saved = await (
    await request.post(base + "/design", {
      data: {
        request: {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest({
          ...defaults,
          trials: 4,
          attributionTrials: 2,
          verificationTrials: 2,
          sensitivity: false,
          verifyRecommendation: false,
          scales: [10000, 500000],
          targets: { 10000: 0.985, 500000: 0.985 },
          optimization: { enabled: false },
        }),
        stage: 0,
      },
    })
  ).json();
  const started = await request.post(base + "/workflow/automatic", {
    data: { inputRevision: saved.revision },
  });
  expect(started.status()).toBe(202);
  await page.goto("/?task=" + taskId);
  const w = page.getByRole("region", {
    name: "现状与目标分析工作台",
    exact: true,
  });
  await expect(w).toBeVisible({ timeout: 60000 });
  await expect(
    w.getByRole("button", { name: "02 可用度评估", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    w.getByRole("heading", { name: "损失 → 具体可靠性措施", exact: true }),
  ).toBeVisible();
  await expect(
    w.getByRole("figure", {
      name: "责任域损失构成",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    w.getByRole("heading", { name: "子系统现状与分解目标", exact: true }),
  ).toBeVisible();
  await expect(w).toContainText("全类等效FIT");
  await w
    .getByRole("button", { name: "01 可用度目标分解分配", exact: true })
    .click();
  const topology = w.getByRole("img", {
    name: "Atlas 950参考架构与六层目标分配",
    exact: true,
  });
  await expect(topology).toBeVisible();
  await expect(topology.locator("[data-allocation-domain]")).toHaveCount(6);
  await expect(topology).toContainText("2+2 光模块保护组");
  await expect(topology).toContainText("缺口定位");
  await expect(
    w.getByRole("table", { name: "四规模六层分配缺口" }),
  ).toBeVisible();
  await w
    .getByLabel("分析分解层级", { exact: true })
    .selectOption("hardware-chip");
  await w.getByRole("button", { name: "CORE", exact: true }).first().click();
  const dialog = page.getByRole("dialog", {
    name: "子系统分解详情",
    exact: true,
  });
  await expect(dialog).toContainText("CORE-hard");
  await expect(dialog).toContainText("等效FIT");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await w.getByLabel("更多分析视图", { exact: true }).selectOption("research");
  await expect(w).toContainText("2026-10-19");
  await expect(w).toContainText("FTAR");
  await expect(w).toContainText("37,656");
  await expect(w).toContainText("14.92%");
  await w.getByLabel("分析规模", { exact: true }).selectOption("10000");
  await w.getByLabel("更多分析视图", { exact: true }).selectOption("scales");
  await expect(w).toContainText("10,000卡");
  await expect(w).toContainText("500,000卡");
  await w.getByRole("button", { name: "全屏分析", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "可靠性分析全屏", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await w
    .getByRole("button", { name: "导出当前分析 HTML", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("ReMAP-10000-scales.html");
  const legacy = page
    .locator("details")
    .filter({
      has: page.getByText("补充查看原有方案收益、贡献与敏感性", {
        exact: true,
      }),
    })
    .first();
  await page
    .getByText("补充查看原有方案收益、贡献与敏感性", { exact: true })
    .click();
  await page.getByRole("tab", { name: "方案收益", exact: true }).click();
  await expect(legacy).toHaveJSProperty("open", true);
  await expect(
    page.getByRole("heading", { name: "单项与组合方案收益对照", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("saved three-stage comparison survives workflow replay and exposes 126 loss cells", async ({
  page,
  request,
  taskId,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1920, height: 1100 });
  const defaultsResponse = await (await request.get("/api/defaults")).json();
  const getAuditDefaults = () => defaultsResponse.audit;
  const getAuditEvents = () => defaultsResponse.auditEvents as AuditEventView[];
  const { applyTrainingScenario, trainingScenarioPreset } = await import(
    "../../packages/contracts/src/audit-training-scenario"
  );
  const base = `/api/tasks/${taskId}`;
  const ids: string[] = [];
  const defaults = {
    ...getAuditDefaults(),
    trials: 2,
    attributionTrials: 2,
    verificationTrials: 2,
    sensitivity: false,
    verifyRecommendation: false,
    scales: [10000, 500000],
    targets: { 10000: 0.985, 500000: 0.985 },
    optimization: { enabled: false },
  };
  const inputs = (["current", "extension", "breakthrough"] as const).map((id) =>
    applyTrainingScenario(
      defaults,
      {
        ...trainingScenarioPreset(id),
        checkpointSeconds: id === "current" ? 600 : 1,
        sdcCoverage: id === "current" ? 0.8 : 0.9991,
        mtbfEventIds: getAuditEvents()
          .filter((e) => e.type === "hard")
          .map((e) => e.id),
        investigationMapping: "sdc-only",
        assumptionsConfirmed: true,
      },
      getAuditEvents(),
    ),
  );
  for (const input of inputs) {
    const r = await request.post(base + "/runs", {
      data: { operation: "audit", input },
    });
    expect(r.ok()).toBeTruthy();
    const id = (await r.json()).id;
    await expect
      .poll(
        async () =>
          (await (await request.get(base + "/runs/" + id)).json()).status,
        { timeout: 45000 },
      )
      .toBe("succeeded");
    ids.push(id);
  }
  const saved = await (
    await request.post(base + "/design", {
      data: {
        request: {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(inputs[2]),
        stage: 0,
      },
    })
  ).json();
  await request.post(base + "/workflow/automatic", {
    data: { inputRevision: saved.revision },
  });
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/workflow")).json()).steps[3].status,
      { timeout: 60000 },
    )
    .toBe("awaiting-review");
  const compared = await (
    await request.post(base + "/audit/compare", { data: { runIds: ids } })
  ).json();
  const design = await (await request.get(base + "/design")).json();
  expect(
    (
      await request.post(base + "/design", {
        data: {
          ...design,
          expectedRevision: design.revision,
          runId: compared.id,
          stage: 3,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/?task=" + taskId);
  const w = page.getByRole("region", {
    name: "现状与目标分析工作台",
    exact: true,
  });
  await expect(w).toBeVisible({ timeout: 60000 });
  const matrix = w.getByRole("table", {
    name: "三阶段分组损失热力图",
    exact: true,
  });
  await expect(matrix.locator("[scope=colgroup]")).toHaveCount(3);
  await expect(matrix.locator("[data-loss-hours]")).toHaveCount(126);
  await expect
    .poll(
      async () => (await (await request.get(base + "/design")).json()).runId,
    )
    .toBe(compared.id);
  await page.reload();
  await expect(matrix.locator("[scope=colgroup]")).toHaveCount(3);
  await w
    .getByRole("button", { name: "03 可靠性机制设计", exact: true })
    .click();
  const bounds = await matrix.locator("[scope=colgroup]").evaluateAll((els) =>
    els.map((el) => ({
      x: el.getBoundingClientRect().x,
      right: el.getBoundingClientRect().right,
      y: el.getBoundingClientRect().y,
    })),
  );
  expect(bounds[0].y).toBe(bounds[1].y);
  expect(bounds[1].y).toBe(bounds[2].y);
  expect(bounds[1].x - bounds[0].right).toBeGreaterThan(10);
  expect(bounds[2].x - bounds[1].right).toBeGreaterThan(10);
  const benefits = w.getByRole("table", {
    name: "三阶段四规模措施收益热力图",
    exact: true,
  });
  await expect(benefits.locator("[scope=colgroup]")).toHaveCount(3);
  await expect(benefits.locator("[data-benefit-pp]")).toHaveCount(96);
  await expect(
    benefits.locator(
      '[data-benefit-measure="redundancy"] [data-benefit-status="missing"]',
    ),
  ).toHaveCount(12);
  await expect(
    w.getByRole("figure", { name: "单次中断期望恢复链" }),
  ).toBeVisible();
  await expect(
    w.getByRole("table", { name: "三阶段机制参数演进" }),
  ).toContainText("失败时");
  await expect(w).toContainText("归因基线不同");
});

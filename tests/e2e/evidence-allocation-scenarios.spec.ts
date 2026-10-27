import { mkdir, writeFile } from "node:fs/promises";
import { test, expect as baseExpect } from "./task-fixture";
const expect = baseExpect.configure({ timeout: 30000 });
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false, trace: "off" });
for (const width of [1440, 390])
  test(`evidence allocation and three independent 600h scenarios at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(300000);
    await page.setViewportSize({ width, height: 950 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = `/api/tasks/${taskId}`,
      defaults = (await (await request.get("/api/defaults")).json()).audit;
    const input = {
      ...defaults,
      trials: 4,
      attributionTrials: 2,
      verificationTrials: 2,
      samplingProfile: "custom",
      verifyRecommendation: false,
      sensitivity: false,
      optimization: { enabled: false },
    };
    const ids: string[] = [];
    await mkdir("artifacts/evidence-allocation", { recursive: true });
    for (const id of ["current", "extension", "breakthrough"]) {
      await page.goto("about:blank");
      const saved = await request.post(base + "/design", {
        data: {
          request: {},
          scenario: "training",
          activeAssessment: "audit",
          auditDraft: draftFromAuditRequest(input),
          stage: 0,
        },
      });
      expect(saved.ok()).toBe(true);
      await page.goto(`/?task=${taskId}`);
      // Revisit goal stage explicitly; previous completed workflow stays in history.
      await page
        .getByRole("navigation", { name: "六阶段评估流程" })
        .getByRole("button")
        .nth(0)
        .click();
      await page
        .getByText("600小时三档训练场景 · 现状 / 延长线 / 突破", {
          exact: true,
        })
        .click();
      const editor = page.locator(".training-scenario-editor");
      await editor.getByLabel("训练场景模板", { exact: true }).selectOption(id);
      const budget = editor.getByRole("region", {
        name: "目标与等效MTTR核算",
        exact: true,
      });
      await expect(budget).toContainText("98.5%");
      if (id === "current") {
        await expect(budget).toContainText("1,644.7");
        await expect(budget).toContainText("1,440");
      } else {
        await expect(budget).toContainText(
          id === "extension" ? "16.4" : "41.1",
        );
        await expect(
          editor.getByLabel("参考MTBF（分钟）", { exact: true }),
        ).toHaveValue(id === "extension" ? "18" : "45");
      }
      await editor.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `artifacts/evidence-allocation/budget-${id}-${width}.png`,
      });
      if (id !== "current")
        await editor
          .getByLabel("检查点 / step周期（秒）", { exact: true })
          .fill("1");
      if (id === "breakthrough")
        await editor
          .getByLabel("静默检出率（%，可调整）", { exact: true })
          .fill("99.5");
      await editor
        .getByLabel("MTBF故障范围", { exact: true })
        .selectOption("compute");
      await editor.getByLabel("按规模设置MTBF暴露", { exact: true }).check();
      await expect(
        editor.getByLabel("MTBF暴露倍率 10000", { exact: true }),
      ).toHaveValue("1");
      await expect(
        editor.getByLabel("MTBF暴露倍率 500000", { exact: true }),
      ).toHaveValue("2");
      await editor
        .getByLabel("人工排查映射", { exact: true })
        .selectOption("sdc-only");
      await editor
        .getByLabel("训练场景依据", { exact: true })
        .fill(
          "浏览器验收情景：用户表值；补充step=1秒、突破静默覆盖0.995仅用于功能验证，不是专家确认值",
        );
      await editor.getByLabel("确认训练场景映射", { exact: true }).check();
      await editor
        .getByRole("button", { name: "载入本档输入", exact: true })
        .click();
      await expect(editor.getByRole("status")).toContainText("场景已载入");
      const next = page.getByRole("button", {
        name: "确认并进入下一步",
        exact: true,
      });
      await next.click();
      await next.click();
      await expect(
        page.getByLabel("分层目标分配方法", { exact: true }),
      ).toHaveValue("agree-evidence");
      await expect(
        page.getByRole("region", { name: "分层目标预算", exact: true }),
      ).toContainText("子层待评估");
      await next.click();
      await next.click();
      await page
        .getByRole("button", { name: "运行可靠性评估", exact: true })
        .click();
      await expect(
        page.getByRole("link", { name: "下载报告", exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect
        .poll(
          async () =>
            (
              await (
                await request.get(
                  base + "/runs?view=summary&operation=audit&limit=100",
                )
              ).json()
            ).items.filter(
              (r: any) =>
                r.operation === "audit" &&
                r.status === "succeeded" &&
                r.trainingScenarioName ===
                  (
                    {
                      current: "现状",
                      extension: "延长线改进",
                      breakthrough: "突破性改进",
                    } as Record<string, string>
                  )[id],
            ).length,
          { timeout: 60000 },
        )
        .toBe(1);
      await expect(
        page.getByRole("button", { name: "运行可靠性评估", exact: true }),
      ).toBeEnabled({ timeout: 30000 });
      const history = (await (await request.get(base + "/runs")).json()).filter(
        (r: any) =>
          r.operation === "audit" &&
          r.status === "succeeded" &&
          r.result?.request.trainingScenario?.id === id,
      );
      expect(history).toHaveLength(1);
      const run = history[0];
      ids.push(run.id);
      expect(run.result.request.hours).toBe(600);
      expect(run.result.request.trainingScenario.mtbfEventIds).toContain(
        "IOD-hard",
      );
      expect(run.result.request.trainingScenario.mtbfEventIds).toContain(
        "SSD-hard",
      );
      expect(run.result.request.trainingScenario.exposureByScale[500000]).toBe(
        2,
      );
      for (const cards of [10000, 100000, 200000, 500000])
        expect(run.result.request.targets[cards]).toBe(0.985);
      expect(run.result.config.policy["D-SDC"].coverage).toBe(
        id === "current" ? 0.8 : id === "extension" ? 0.95 : 0.995,
      );
      const d = run.result.architectureDiagnosis.scales.find(
        (s: any) => s.cards === 500000,
      );
      expect(d.allowedHours).toBeCloseTo(9, 8);
      expect(d.allocationMethod).toBe("agree.layer-evidence.v1");
      const known = d.nodes.filter(
        (n: any) => n.leaf && n.allowedHours !== null,
      );
      expect(
        new Set(known.map((n: any) => n.allowedHours)).size,
      ).toBeGreaterThan(3);
      if (id === "current") {
        await page
          .getByRole("button", {
            name: "查看分层目标与跨规模薄弱点",
            exact: true,
          })
          .click();
        const diagnosis = page.getByRole("region", {
          name: "系统分层诊断",
          exact: true,
        });
        await diagnosis
          .getByRole("button", { name: "分层分配与机制", exact: true })
          .click();
        await expect(
          diagnosis.getByRole("img", {
            name: "架构与指标差距",
            exact: true,
          }),
        ).toBeVisible();
        await diagnosis
          .getByRole("button", { name: "全屏大图", exact: true })
          .click();
        const full = page.getByRole("dialog", {
          name: "架构图全屏",
          exact: true,
        });
        await expect(full).toBeVisible();
        expect(
          await full.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return (
              box.x === 0 &&
              box.y === 0 &&
              Math.abs(box.width - innerWidth) < 1 &&
              Math.abs(box.height - innerHeight) < 1 &&
              el.contains(
                document.elementFromPoint(innerWidth / 2, innerHeight - 30),
              )
            );
          }),
        ).toBe(true);
        await full
          .getByRole("button", { name: "放大全景", exact: true })
          .click();
        await page.screenshot({
          path: `artifacts/evidence-allocation/fullscreen-${width}.png`,
        });
        await page.keyboard.press("Escape");
        await expect(full).toHaveCount(0);
        expect(
          await page.evaluate(() => document.body.style.overflow),
        ).not.toBe("hidden");
        await diagnosis
          .getByText("分层分配依据 · 故障 / 损失 / Shapley / AGREE", {
            exact: true,
          })
          .click();
        await expect(diagnosis).toContainText("E工程重要度");
        await diagnosis.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `artifacts/evidence-allocation/decision-${width}.png`,
        });
      }
      await next.click();
      await page
        .getByRole("button", { name: "记录交付确认", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "本流程已交付", exact: true }),
      ).toBeDisabled();
    }
    await page
      .getByRole("navigation", { name: "六阶段评估流程" })
      .getByRole("button")
      .nth(4)
      .click();
    await page.getByText("600小时场景历史与横向比较", { exact: true }).click();
    const history = page.locator(".training-scenario-history");
    await history
      .getByRole("button", { name: "刷新训练场景历史", exact: true })
      .click();
    for (const id of ids)
      await history.getByLabel(`比较场景 ${id}`, { exact: true }).check();
    await history
      .getByRole("button", { name: "比较所选训练场景", exact: true })
      .click();
    await expect(
      history.getByRole("link", { name: "下载训练场景比较报告", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await history
      .getByRole("button", { name: "全屏查看三档总图", exact: true })
      .click();
    const fullComparison = page.getByRole("dialog", {
      name: "三档决策总图全屏",
      exact: true,
    });
    await expect(fullComparison).toContainText("光模块 / 光链路");
    await expect(fullComparison).toContainText("Leaf / Spine");
    await fullComparison
      .getByRole("button", { name: "损失—措施—参数", exact: true })
      .click();
    await expect(fullComparison).toContainText("三阶段逐层对照");
    await expect(fullComparison).toContainText("M8");
    await fullComparison
      .getByLabel("决策图规模", { exact: true })
      .selectOption("100000");
    await expect(fullComparison.getByRole("img")).toContainText("100,000卡");
    await fullComparison
      .getByRole("button", { name: "跨规模薄弱点", exact: true })
      .click();
    await expect(fullComparison).toContainText("超预算");
    await fullComparison
      .getByRole("button", { name: "业界依据与建议", exact: true })
      .click();
    await expect(fullComparison).toContainText("ByteCheckpoint");
    await fullComparison
      .getByRole("button", { name: "架构与指标", exact: true })
      .click();
    await fullComparison
      .getByRole("button", { name: "01 计算资源", exact: true })
      .click();
    await expect(fullComparison.getByRole("status")).toContainText("计算资源");
    expect(
      await fullComparison.evaluate((el) =>
        el.contains(
          document.elementFromPoint(innerWidth / 2, innerHeight - 30),
        ),
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/evidence-allocation/three-fullscreen-${width}.png`,
    });
    await fullComparison
      .getByRole("button", { name: "退出总图全屏（Esc）", exact: true })
      .click();
    await expect(fullComparison).toHaveCount(0);
    const download = page.waitForEvent("download");
    await history
      .getByRole("button", { name: "导出三档分层总图 SVG", exact: true })
      .click();
    await (
      await download
    ).saveAs(`artifacts/evidence-allocation/three-scenarios-${width}.svg`);
    const png = page.waitForEvent("download");
    await history
      .getByRole("button", { name: "导出三档分层总图 PNG", exact: true })
      .click();
    await (
      await png
    ).saveAs(`artifacts/evidence-allocation/three-scenarios-${width}.png`);
    const comparison = (await (await request.get(base + "/runs")).json()).find(
      (r: any) => r.operation === "audit-compare",
    );
    expect(comparison.result.entries).toHaveLength(3);
    const reportResponse = await request.get(
      (await history
        .getByRole("link", { name: "下载训练场景比较报告", exact: true })
        .getAttribute("href"))!,
    );
    expect(reportResponse.ok()).toBe(true);
    const html = await reportResponse.text();
    expect(html).toContain("CORE-hard FIT");
    expect(html).toContain("600小时");
    await writeFile(
      `artifacts/evidence-allocation/comparison-${width}.html`,
      html,
    );
    await writeFile(
      `artifacts/evidence-allocation/comparison-${width}.json`,
      JSON.stringify(comparison, null, 2),
    );
    await history.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/evidence-allocation/comparison-${width}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

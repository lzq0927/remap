import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
for (const width of [1440, 390])
  test(`architecture atlas linkage and exports at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(120000);
    const dir = "artifacts/architecture-atlas";
    await mkdir(dir, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    const prefix = `/api/tasks/${taskId}`;
    const defaults = (await (await request.get("/api/defaults")).json()).audit;
    const input = {
      ...defaults,
      hours: 24,
      trials: 16,
      attributionTrials: 4,
      verificationTrials: 4,
      sensitivity: false,
      scales: [10000, 100000, 200000, 500000],
      samplingProfile: "quick",
      optimization: { enabled: false },
    };
    await request.post(prefix + "/design", {
      data: {
        request: {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(input),
        stage: 0,
      },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/?task=${taskId}`);
    const next = page.getByRole("button", {
      name: "确认并进入下一步",
      exact: true,
    });
    await next.click();
    const atlas = page.getByRole("region", {
      name: "架构故障机制全景",
      exact: true,
    });
    await expect(atlas).toContainText("配置预览，尚未计算");
    await expect(atlas.locator(".atlas-svg")).not.toContainText("FIT");
    await atlas
      .getByText("定位与筛选 · 对象、功能域、层级", { exact: true })
      .click();
    await atlas
      .getByLabel("全景查看层级", { exact: true })
      .selectOption("hardware-chip");
    await atlas.locator('[data-atlas-node="object-CORE"] > rect').click();
    await expect(atlas.locator(".atlas-inspector h4")).toContainText("AI Core");
    await atlas.getByLabel("配置对象主功能域").selectOption("compute");
    await atlas.getByRole("button", { name: "故障", exact: true }).click();
    await expect(atlas.locator(".atlas-inspector")).toContainText("CORE-hard");
    await atlas.getByRole("button", { name: "全系统", exact: true }).click();
    await atlas.screenshot({ path: `${dir}/architecture-${width}.png` });
    await next.click();
    await next.click();
    await next.click();
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "下载报告", exact: true }),
    ).toBeVisible({ timeout: 40000 });
    const run = (await (await request.get(prefix + "/runs")).json()).find(
      (r: any) => r.operation === "audit",
    );
    const frozen = JSON.stringify(run.result);
    await page
      .getByRole("button", { name: "查看分层目标与跨规模薄弱点", exact: true })
      .click();
    await expect(atlas).toContainText("已保存计算结果");
    await atlas.getByRole("button", { name: "全屏大图", exact: true }).click();
    await atlas.getByLabel("全景叠加指标").selectOption("loss");
    await atlas
      .getByText("定位与筛选 · 对象、功能域、层级", { exact: true })
      .click();
    await atlas
      .getByLabel("全景查看层级", { exact: true })
      .selectOption("hardware-chip");
    await atlas.locator('[data-atlas-node="object-CORE"] > rect').click();
    await expect(atlas.locator(".atlas-inspector h4")).toContainText("AI Core");
    await atlas.getByRole("button", { name: "机制", exact: true }).click();
    await expect(atlas.locator(".atlas-inspector")).toContainText("未选候选");
    await atlas
      .getByRole("button", { name: "交互分层拓扑", exact: true })
      .click();
    await expect(atlas.getByLabel("交互分层拓扑画布")).toBeVisible();
    await expect(atlas.locator(".react-flow__minimap")).toBeVisible();
    await atlas
      .getByRole("button", { name: "关闭对象详情", exact: true })
      .click();
    await atlas.locator('.react-flow__node[data-id="object-CORE"]').click();
    await expect(atlas.locator(".atlas-inspector h4")).toContainText("AI Core");
    await atlas.getByRole("button", { name: "放大拓扑", exact: true }).click();
    const controlIcon = await atlas
      .getByRole("button", { name: "放大拓扑", exact: true })
      .locator("svg")
      .boundingBox();
    expect(controlIcon!.width).toBeGreaterThanOrEqual(12);
    await atlas.getByRole("button", { name: "适配拓扑", exact: true }).click();
    await atlas.screenshot({ path: `${dir}/flow-${width}.png` });
    await atlas.getByRole("button", { name: "全系统", exact: true }).click();
    await atlas
      .getByRole("button", { name: "多维热力矩阵", exact: true })
      .click();
    await atlas.getByLabel("矩阵展开叶层对象").check();
    await atlas.getByLabel("全景矩阵维度").selectOption("scale");
    await expect(atlas.locator(".atlas-matrix")).toContainText("10,000卡");
    await expect(atlas.locator(".atlas-matrix")).toContainText("500,000卡");
    await expect(atlas.locator(".atlas-matrix")).toContainText("待补充");
    await atlas.getByLabel("全景矩阵维度").selectOption("gap");
    await expect(atlas.locator(".atlas-matrix")).toContainText("差距 = 目标");
    await atlas.screenshot({ path: `${dir}/gap-${width}.png` });
    await atlas.getByLabel("全景矩阵维度").selectOption("scale");
    await atlas.screenshot({ path: `${dir}/matrix-${width}.png` });
    for (const [name, ext] of [
      ["导出当前视图SVG", "svg"],
      ["导出当前视图PNG", "png"],
      ["导出完整关联数据", "json"],
      ["导出全景报告HTML", "html"],
    ]) {
      const waiting = page.waitForEvent("download");
      await atlas.getByRole("button", { name, exact: true }).click();
      const download = await waiting;
      await download.saveAs(`${dir}/export-${width}.${ext}`);
    }
    const data = JSON.parse(
      await readFile(`${dir}/export-${width}.json`, "utf8"),
    );
    expect(data.evaluated).toBe(true);
    expect(data.nodes.some((n: any) => n.id === "object-OPT")).toBe(true);
    expect(await readFile(`${dir}/export-${width}.svg`, "utf8")).toContain(
      "多维热力矩阵",
    );
    expect(
      (await readFile(`${dir}/export-${width}.png`)).byteLength,
    ).toBeGreaterThan(10000);
    await atlas
      .getByRole("button", { name: "退出大屏（Esc）", exact: true })
      .click();
    await atlas
      .getByText("按故障与机制定位对象（筛选不改变计算）", { exact: true })
      .click();
    await atlas.getByLabel("全景生命周期").selectOption("during");
    await atlas.getByLabel("全景矩阵维度").selectOption("mechanism");
    await atlas.getByLabel("全景部署状态").selectOption("selected");
    await expect(atlas.locator(".atlas-matrix td.candidate")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      JSON.stringify(
        (await (await request.get(prefix + `/runs/${run.id}`)).json()).result,
      ),
    ).toBe(frozen);
    const html = await (
      await request.get(prefix + `/runs/${run.id}/report?format=html`)
    ).text();
    expect(html).toContain("架构—故障—机制全景");
    await writeFile(`${dir}/report-${width}.html`, html);
    expect(errors).toEqual([]);
  });

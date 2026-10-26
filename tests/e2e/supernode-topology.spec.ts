import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
for (const width of [1440, 390])
  test(`supernode topology counts, allocation, linkage and delivery at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(120000);
    const dir = "artifacts/supernode-topology";
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
      scales: [1000, 1024, 10000, 100000, 200000, 500000],
      samplingProfile: "quick",
      optimization: { enabled: false },
    };
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    expect(
      (
        await request.post(prefix + "/design", {
          data: {
            request: {},
            scenario: "training",
            activeAssessment: "audit",
            auditDraft: draftFromAuditRequest(input),
            stage: 0,
          },
        })
      ).ok(),
    ).toBe(true);
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
    await expect(
      atlas.getByRole("img", { name: "超节点组网拓扑", exact: true }),
    ).toBeVisible();
    await atlas.getByLabel("全景查看规模").selectOption("1000");
    await expect(atlas.locator(".atlas-svg")).toContainText("尾部1000卡");
    await atlas.getByLabel("全景查看规模").selectOption("1024");
    await expect(atlas.locator(".atlas-svg")).toContainText("1个满超节点");
    await atlas.getByLabel("全景叠加指标").selectOption("summary");
    await expect(atlas.locator(".atlas-svg")).toContainText("可用度 待评估");
    await atlas.getByLabel("全景查看规模").selectOption("500000");
    await expect(atlas.locator(".atlas-svg")).toContainText("489个超节点");
    const editor = page.getByRole("region", {
      name: "系统架构与故障归属",
      exact: true,
    });
    await editor
      .getByText("超节点密度、网络数量与跨规模推导", { exact: true })
      .click();
    await editor.getByLabel("每超节点跨域Leaf数", { exact: true }).fill("2");
    await editor.getByLabel("每Pod跨域Spine数", { exact: true }).fill("4");
    await editor
      .getByLabel("拓扑配置依据", { exact: true })
      .fill(
        input.architecture.topology.source +
          "；流程验证演示配置：每超节点2个Leaf、每Pod4个Spine，并非厂家BOM或实测设备清单。",
      );
    await editor
      .getByRole("button", { name: "保存超节点拓扑配置", exact: true })
      .click();
    await editor
      .getByText("超节点密度、网络数量与跨规模推导", { exact: true })
      .click();
    await atlas.locator('[data-atlas-node="hardware-scaleout"]').click();
    await expect(atlas.locator(".atlas-inspector")).toContainText("1,042");
    await atlas.getByRole("button", { name: "故障", exact: true }).click();
    await expect(atlas.locator(".atlas-inspector")).toContainText("NIC-hard");
    await atlas.getByRole("button", { name: "机制", exact: true }).click();
    await expect(atlas.locator(".atlas-inspector")).toContainText("本轮已选");
    await atlas
      .getByRole("button", { name: "关闭对象详情", exact: true })
      .click();
    await atlas.screenshot({ path: `${dir}/preview-${width}.png` });
    await atlas
      .getByRole("button", { name: "组网辅助验证", exact: true })
      .click();
    const network = atlas.getByRole("region", {
      name: "组网辅助验证",
      exact: true,
    });
    await network
      .getByRole("button", { name: "运行组网比较", exact: true })
      .click();
    await expect(network.getByRole("alert")).toContainText("请填写所有输入");
    await network
      .getByRole("button", { name: "载入方法演示参数", exact: true })
      .click();
    await network
      .getByRole("button", { name: "运行组网比较", exact: true })
      .click();
    await expect(
      network.getByRole("region", { name: "组网比较结果", exact: true }),
    ).toContainText("双 L2 · 跨柜");
    await network
      .getByRole("button", { name: "保存本轮组网验证", exact: true })
      .click();
    await network
      .getByRole("button", { name: "运行组网比较", exact: true })
      .click();
    await network.screenshot({ path: `${dir}/network-${width}.png` });
    await atlas
      .getByRole("button", { name: "超节点组网", exact: true })
      .click();
    await next.click();
    const budget = page.getByRole("region", {
      name: "分层目标预算",
      exact: true,
    });
    await budget.getByLabel("分层目标分配方法").selectOption("agree");
    await expect(budget).toContainText("AGREE使用设计复杂度与重要度分配");
    await next.click();
    await next.click();
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "下载报告", exact: true }),
    ).toBeVisible({ timeout: 40000 });
    await page
      .getByRole("button", { name: "查看分层目标与跨规模薄弱点", exact: true })
      .click();
    await atlas
      .getByRole("button", { name: "超节点组网", exact: true })
      .click();
    await atlas.getByLabel("全景叠加指标").selectOption("summary");
    await atlas.getByLabel("全景查看规模").selectOption("500000");
    await atlas.locator('[data-atlas-node="hardware-scaleout"]').click();
    await expect(atlas.locator(".atlas-svg")).toContainText("总体可用度");
    const markerIds = await page
      .locator("svg marker[id]")
      .evaluateAll((markers) => markers.map((m) => m.id));
    expect(new Set(markerIds).size).toBe(markerIds.length);
    const clipped = await atlas.locator(".atlas-svg").evaluate((el) =>
      [...el.querySelectorAll<SVGTextElement>("g[data-atlas-node] > text")]
        .filter((t) => {
          const r = t.parentElement!.querySelector<SVGRectElement>("rect")!;
          const b = t.getBBox(),
            box = r.getBBox();
          return (
            b.x < box.x ||
            b.x + b.width > box.x + box.width ||
            b.y < box.y ||
            b.y + b.height > box.y + box.height
          );
        })
        .map((t) => t.textContent),
    );
    expect(clipped).toEqual([]);
    await atlas.getByRole("button", { name: "对象", exact: true }).click();
    await expect(atlas.locator(".atlas-inspector")).toContainText(
      "分层目标 / 当前可用度",
    );
    await atlas.screenshot({ path: `${dir}/evaluated-${width}.png` });
    await atlas
      .getByRole("button", { name: "关闭对象详情", exact: true })
      .click();
    for (const format of ["SVG", "PNG"]) {
      const pending = page.waitForEvent("download");
      await atlas
        .getByRole("button", { name: `导出当前视图${format}`, exact: true })
        .click();
      const file = await pending;
      const path = `${dir}/topology-${width}.${format.toLowerCase()}`;
      await file.saveAs(path);
      expect((await readFile(path)).length).toBeGreaterThan(1000);
    }
    const first = (await (await request.get(prefix + "/runs")).json()).find(
      (r: any) => r.operation === "audit",
    );
    expect(
      first.result.request.architecture.topology.scaleOutLeavesPerSupernode,
    ).toBe(2);
    expect(first.result.request.scales).toContain(1024);
    expect(first.result.networkStudyResult.rows).toHaveLength(3);
    expect(first.result.networkStudyResult.config.evidence).toBe(
      "demonstration",
    );
    for (const s of first.result.architectureDiagnosis.scales)
      expect(Math.abs(s.residualHours)).toBeLessThan(1e-8);
    const html = await (
      await request.get(prefix + `/runs/${first.id}/report?format=html`)
    ).text();
    expect(html).toContain("超节点组网与量化诊断");
    expect(html).toContain("区域数量、FIT与可用度对应");
    expect(html).toContain("L2平面结构可用度");
    expect(html).toContain("方法演示 · 不能用于项目达标判断");
    expect(first.result.request.architecture.networkStudy.evidence).toBe(
      "demonstration",
    );
    await writeFile(`${dir}/report-${width}.html`, html);
    await writeFile(
      `${dir}/verification-${width}.json`,
      JSON.stringify(
        {
          taskId,
          firstRunId: first.id,
          scales: first.result.request.scales,
          topology: first.result.request.architecture.topology,
          residuals: first.result.architectureDiagnosis.scales.map(
            (s: any) => ({ cards: s.cards, residual: s.residualHours }),
          ),
          errors,
        },
        null,
        2,
      ),
    );
    if (width === 1440) {
      await page.setViewportSize({ width, height: 1500 });
      await atlas
        .getByRole("button", { name: "全屏大图", exact: true })
        .click();
      await atlas.screenshot({ path: `${dir}/workbench-desktop.png` });
      await page.keyboard.press("Escape");
    }
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

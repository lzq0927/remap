import { mkdir, writeFile } from "node:fs/promises";
import { test, expect } from "./task-fixture";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
test.use({ fullWorkspace: false });
for (const width of [1440, 390])
  test(`hardware inventory, propagation, drilldown and export at ${width}px`, async ({
    page,
    request,
    taskId,
  }) => {
    test.setTimeout(120000);
    await mkdir("artifacts/hardware-architecture", { recursive: true });
    await page.setViewportSize({ width, height: 950 });
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
    await page.goto(`/?task=${taskId}`);
    const next = page.getByRole("button", {
      name: "确认并进入下一步",
      exact: true,
    });
    await next.click();
    const editor = page.getByRole("region", {
      name: "系统架构与故障归属",
      exact: true,
    });
    await editor.getByText("硬件组成与各规模数量", { exact: true }).click();
    await editor.getByLabel("规模配置硬件对象").selectOption("object-OPT");
    for (const [cards, count] of [
      [1000, 10],
      [10000, 100],
      [100000, 250],
      [200000, 600],
      [500000, 1000],
    ])
      await editor
        .getByLabel(`硬件总数量 ${cards}`, { exact: true })
        .fill(String(count));
    await editor
      .getByLabel("硬件数量依据", { exact: true })
      .fill("浏览器测试用光模块数量；不是产品实测");
    await editor.getByLabel("按硬件数量折算事件率", { exact: true }).check();
    await editor.getByLabel("数量折算参考数量", { exact: true }).fill("100");
    await editor
      .getByLabel("数量折算依据", { exact: true })
      .fill("测试参考1万卡100件，扩大规模按实际数量外推");
    await editor
      .getByRole("button", { name: "保存硬件规模配置", exact: true })
      .click();
    await editor.getByText("硬件组成与各规模数量", { exact: true }).click();
    await editor.getByText("逐故障传播与业务影响", { exact: true }).click();
    await editor.getByLabel("传播故障模式").selectOption("CORE-hard");
    await editor
      .getByRole("button", { name: "添加传播步骤", exact: true })
      .click();
    await editor.getByLabel("传播路径第2步").selectOption("hardware-chip");
    await editor
      .getByRole("button", { name: "添加传播步骤", exact: true })
      .click();
    await editor.getByLabel("传播路径第3步").selectOption("hardware-node");
    await editor.getByLabel("传播上层表现").fill("算子异常导致作业恢复");
    await editor.getByLabel("传播影响范围").fill("单进程及关联同步作业");
    await editor
      .getByLabel("传播恢复条件")
      .fill("局部重执行失败后升级全局恢复");
    await editor
      .getByLabel("传播证据", { exact: true })
      .fill("流程验证假设，待故障注入验证");
    await editor
      .getByRole("button", { name: "保存故障传播记录", exact: true })
      .click();
    await expect(editor).toContainText("已记录 1 条");
    await editor.getByText("逐故障传播与业务影响", { exact: true }).click();
    await next.click();
    await next.click();
    await next.click();
    await page
      .getByRole("button", { name: "运行可靠性评估", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "下载报告", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("button", { name: "查看分层目标与跨规模薄弱点", exact: true })
      .click();
    const hardware = page.getByRole("region", {
      name: "硬件架构下钻",
      exact: true,
    });
    await expect(hardware).toContainText("含未建模对象");
    await hardware.getByLabel("硬件诊断层级").selectOption("hardware-chip");
    await expect(
      hardware.locator('[data-hardware="fault-heatmap"]'),
    ).toContainText("AI Core计算单元");
    await hardware.locator('.arch-node[data-node-id="object-CORE"]').click();
    await expect(hardware.getByLabel("硬件诊断层级")).toHaveValue(
      "object-CORE",
    );
    await hardware.getByText("当前对象的故障传播证据", { exact: true }).click();
    await expect(
      hardware.locator('[data-hardware="propagation"]'),
    ).toContainText("局部重执行失败后升级");
    await hardware
      .getByRole("button", { name: "返回上级", exact: true })
      .click();
    await expect(hardware.getByLabel("硬件诊断层级")).toHaveValue(
      "hardware-chip",
    );
    await hardware.locator(".arch-tree").screenshot({
      path: `artifacts/hardware-architecture/chip-${width}.png`,
    });
    await hardware.locator('[data-hardware="fault-heatmap"]').screenshot({
      path: `artifacts/hardware-architecture/heatmap-${width}.png`,
    });
    await hardware.getByLabel("硬件诊断层级").selectOption("object-OPT");
    await expect(
      hardware.locator('[data-hardware="diagnostic"]'),
    ).toContainText("1,000");
    await page.getByLabel("结果规模", { exact: true }).selectOption("10000");
    await expect(
      hardware.locator('[data-hardware="diagnostic"]'),
    ).toContainText("100");
    await page.getByLabel("结果规模", { exact: true }).selectOption("500000");
    await hardware.getByLabel("硬件诊断层级").selectOption("hardware-network");
    await hardware
      .getByText("按损失环节与恢复频率分析", { exact: true })
      .click();
    await hardware.locator('[data-hardware="frequency-recovery"]').screenshot({
      path: `artifacts/hardware-architecture/frequency-${width}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const first = (await (await request.get(prefix + "/runs")).json()).find(
      (r: any) => r.operation === "audit",
    );
    const firstFrozen = JSON.stringify(first.result);
    expect(first.result.request.architecture.propagations).toHaveLength(1);
    const reference = first.result.events.find(
      (e: any) => e.id === "OPT-hard",
    ).fit;
    const big = first.result.architectureDiagnosis.scales.find(
      (s: any) => s.cards === 500000,
    );
    expect(
      big.scaleEvents.find((e: any) => e.id === "OPT-hard").fit,
    ).toBeCloseTo(reference * 0.2, 10);
    for (const s of first.result.architectureDiagnosis.scales)
      expect(Math.abs(s.residualHours)).toBeLessThan(1e-8);
    const html = await (
      await request.get(prefix + `/runs/${first.id}/report?format=html`)
    ).text();
    const preview = await page.context().newPage();
    await preview.setViewportSize({ width, height: 950 });
    await preview.setContent(html);
    await preview
      .getByText("硬件规模配置、传播与恢复诊断", { exact: true })
      .click();
    await expect(preview.locator('[data-hardware="inventory"]')).toContainText(
      "数量折算",
    );
    await expect(
      preview.locator('[data-hardware="propagation"]'),
    ).toContainText("流程验证假设");
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await preview.locator('[data-hardware="propagation"]').screenshot({
      path: `artifacts/hardware-architecture/propagation-${width}.png`,
    });
    await preview.close();
    await next.click();
    await page
      .getByRole("button", { name: "记录交付确认", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "本流程已交付", exact: true }),
    ).toBeDisabled();
    expect(
      JSON.stringify(
        (await (await request.get(prefix + `/runs/${first.id}`)).json()).result,
      ),
    ).toBe(firstFrozen);
    await writeFile(
      `artifacts/hardware-architecture/report-${width}.html`,
      html,
    );
    await writeFile(
      `artifacts/hardware-architecture/verification-${width}.json`,
      JSON.stringify(
        {
          width,
          taskId,
          firstRunId: first.id,
          firstUnchanged: true,
          scaleMultiplier: 0.2,
          propagationRecorded: true,
          delivered: true,
        },
        null,
        2,
      ),
    );
  });

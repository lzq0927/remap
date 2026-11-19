import { test, expect } from "@playwright/test";

// 默认界面：不设置 remap.ui，进入四步工作台。
test.use({ storageState: { cookies: [], origins: [] } });

test("四步工作台：分配、评估、设计、验证共用一份模型并保存", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "四步回归 " + Date.now();

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "系统可用度设计与评估" }),
  ).toBeVisible();
  await page.getByLabel("新任务名称").fill(name);
  await page.getByRole("button", { name: "新建任务" }).click();

  const steps = page.getByRole("navigation", { name: "四步工作流" });
  await expect(steps.getByRole("button")).toHaveCount(4);
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    "目标分配",
  );
  const summary = page.getByRole("region", { name: "场景与结论" });
  await expect(summary).toContainText("65.05%");
  await expect(summary).toContainText("79.69%");

  // 第 1 步：预算闭合，切换方法后各模块目标随之变化
  const allocation = page.getByRole("region", { name: "分配结果" });
  await expect(page.getByRole("region", { name: "分配方法" })).toContainText(
    "8.40 h",
  );
  await expect(allocation).toContainText("= 8.40 h，与总预算一致");
  const optical = allocation.getByRole("row", { name: /光模块/ });
  await expect(optical).toContainText("2.21 h");
  await page.getByRole("radio", { name: /ARINC/ }).check();
  await expect(optical).toContainText("1.40 h");
  await expect(allocation).toContainText("= 8.40 h，与总预算一致");
  await expect(
    page
      .getByRole("region", { name: "架构上的目标" })
      .getByRole("group", { name: /^光模块，目标可用度/ }),
  ).toContainText("1.40 h");
  await expect(page.getByRole("region", { name: "分配依据" })).toContainText(
    "wᵢ = ρᵢ / Σⱼ ρⱼ",
  );

  // 第 2 步：模块现状与差距；修改故障率后现状立即更新
  await page.getByRole("button", { name: "下一步：可用度评估" }).click();
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    "可用度评估",
  );
  const architecture = page.getByRole("region", { name: "系统架构图" });
  // 架构图按硬件拓扑绘制：现状与目标可用度、周损失、连续暴露故障频次
  await expect(
    architecture.getByRole("img", { name: "系统架构图（现状）" }),
  ).toBeVisible();
  await expect(architecture).toContainText("代表性超节点 · 1024 NPU 模组");
  await expect(architecture).toContainText("互联柜 1");
  await expect(
    architecture.getByRole("button", { name: /可用度/ }),
  ).toHaveCount(13);
  const hbm = architecture.getByRole("button", { name: /^HBM，/ });
  await expect(hbm).toContainText("95.33%");
  await expect(hbm).toContainText("99.63%");
  await expect(hbm).toContainText("周损失 5.42 h");
  await expect(hbm).toContainText("71.4次/周");
  await architecture.getByRole("tab", { name: "设计后" }).click();
  await expect(hbm).toContainText("98.08%");
  await architecture.getByRole("tab", { name: "现状" }).click();
  await expect(page.getByRole("region", { name: "差距明细" })).toContainText(
    "降低 MTTR",
  );
  await hbm.click();
  const drawer = page.getByRole("dialog", { name: "HBM" });
  const fit = drawer.getByLabel("不可纠正错误 的单件故障率");
  await fit.fill("425");
  await fit.press("Enter");
  await expect(drawer).toContainText("可用度 97.61%");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(summary).not.toContainText("65.05%");
  await hbm.click();
  await fit.fill("850");
  await fit.press("Enter");
  await page.keyboard.press("Escape");
  await expect(summary).toContainText("65.05%");

  // 第 3 步：两个方向的措施、Shapley 贡献与推荐方案
  await page.getByRole("button", { name: "下一步：机制设计" }).click();
  const advice = page.getByRole("region", { name: "推荐方案" });
  await expect(advice).toContainText("距目标还差 15.31 pp");
  await expect(
    page.getByRole("region", { name: "提升 MTBF的措施" }),
  ).toContainText("光模块可靠性提升");
  await expect(
    page.getByRole("region", { name: "降低 MTTR的措施" }),
  ).toContainText("静默故障在线检测增强");
  await expect(
    page.getByRole("region", { name: "各措施的贡献" }),
  ).toContainText("+14.64 pp");
  // 参数可调：把静默检出率提到 99%，设计后可用度随之提高
  const coverage = page.getByLabel("静默故障在线检测增强 · 检出率");
  await coverage.fill("99");
  await coverage.press("Enter");
  await expect(summary).not.toContainText("79.69%");
  await coverage.fill("95");
  await coverage.press("Enter");
  await expect(summary).toContainText("79.69%");
  // 措施库：用户四项默认启用，其余为候选，可展开查看全部
  const mttr = page.getByRole("region", { name: "降低 MTTR的措施" });
  await expect(mttr).toContainText("已启用 1 / 23");
  await expect(mttr.getByRole("switch")).toHaveCount(6);
  await mttr.getByRole("button", { name: /显示全部 22 项候选/ }).click();
  await expect(mttr.getByRole("switch")).toHaveCount(23);
  await expect(mttr).toContainText("链路透明恢复");
  await advice.getByRole("button", { name: "采用建议" }).click();
  await expect(advice).toContainText("当前设计已达标");
  await expect(summary).toContainText("95.24%");
  await expect(
    page.getByRole("switch", { name: "停用 域级弹性恢复" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page
      .getByRole("region", { name: "架构上的设计结果" })
      .getByRole("group", { name: /^光模块，设计后可用度/ }),
  ).toContainText("16.8次/周");

  // 第 4 步：独立仿真，结果按任务保存
  await page.getByRole("button", { name: "下一步：机制验证" }).click();
  await page.getByLabel("指定随机种子（用于复现）").check();
  await page.getByRole("button", { name: "运行独立验证" }).click();
  const verdict = page.getByRole("region", { name: "验证结论" });
  await expect(verdict).toContainText("随机种子 20261117", { timeout: 30000 });
  await expect(page.getByRole("region", { name: "逐项判定" })).toContainText(
    "仿真与解析评估一致",
  );
  await expect(
    page.getByRole("img", { name: "窗口可用度直方图" }),
  ).toBeVisible();

  const taskId = new URL(page.url()).searchParams.get("task")!;
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${taskId}/core`)).json())
          .revision,
    )
    .toBeGreaterThan(0);
  const saved = await (await request.get(`/api/tasks/${taskId}/core`)).json();
  expect(saved.model.allocation.method).toBe("arinc");
  expect(saved.verification.seed).toBe(20261117);
  expect(saved.verification.modelHash).toBe(saved.hash);

  // 重新打开后恢复到同一步和同一结果；修改参数后提示验证已过期
  await page.reload();
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    "机制验证",
  );
  await expect(verdict).toContainText("随机种子 20261117");
  const target = page.getByLabel("可用度目标（%）");
  await target.fill("96");
  await target.press("Enter");
  await expect(verdict).toContainText("结果已过期");
  expect(errors).toEqual([]);
});

test("基础库配置：故障模式库、措施库和架构模块可以增删改并立即生效", async ({
  page,
  request,
}) => {
  const task = await (
    await request.post("/api/tasks", { data: { name: "基础库 " + Date.now() } })
  ).json();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/?task=" + task.id);
  const summary = page.getByRole("region", { name: "场景与结论" });
  await page.getByRole("button", { name: "基础库配置" }).click();
  await expect(page.getByRole("heading", { name: "基础库配置" })).toBeVisible();

  // 故障模式库：改故障率立即反映到现状；可新增和删除
  const modes = page.getByRole("region", { name: "故障模式库" });
  await expect(modes.getByRole("row")).toHaveCount(15);
  const fit = modes.getByLabel("光模块失效 的单件故障率（FIT）");
  await fit.fill("250");
  await fit.press("Enter");
  await expect(summary).not.toContainText("65.05%");
  await fit.fill("500");
  await fit.press("Enter");
  await expect(summary).toContainText("65.05%");
  await modes.getByRole("button", { name: "添加故障模式" }).click();
  await expect(modes.getByRole("row")).toHaveCount(16);
  await modes.getByRole("button", { name: "删除故障模式 新故障模式" }).click();
  await expect(modes.getByRole("row")).toHaveCount(15);

  // 措施库：29 项默认措施；删除后可从默认库补回；可新增
  await page.getByRole("tab", { name: /可靠性措施库/ }).click();
  const measures = page.getByRole("region", { name: "可靠性措施库" });
  await expect(measures.getByRole("row")).toHaveCount(30);
  await expect(measures).toContainText("扩展机制库 R-LINK-LOCAL");
  await measures.getByRole("button", { name: "删除措施 链路透明恢复" }).click();
  await expect(measures.getByRole("row")).toHaveCount(29);
  await measures
    .getByRole("button", { name: "补回默认库中缺少的 1 项" })
    .click();
  await expect(measures.getByRole("row")).toHaveCount(30);
  await measures.getByRole("button", { name: "添加提升 MTBF 的措施" }).click();
  const dialog = page.getByRole("dialog", { name: "添加措施" });
  await dialog.getByLabel("措施名称").fill("光模块链路冗余");
  await dialog.getByLabel("光模块失效").check();
  await dialog.getByRole("button", { name: "添加并启用" }).click();
  await expect(measures.getByRole("row")).toHaveCount(31);
  await expect(summary).not.toContainText("79.69%");
  // 适用比例直接在表中调整
  const share = measures.getByLabel("光模块链路冗余 的适用比例（%）");
  await share.fill("0");
  await share.press("Enter");
  await expect(summary).toContainText("79.69%");

  // 架构模块：可以指定每个模块标注在架构图的哪个硬件上
  await page.getByRole("tab", { name: /架构模块/ }).click();
  const modules = page.getByRole("region", { name: "架构模块" });
  await expect(modules.getByRole("row")).toHaveCount(12);
  await modules
    .getByLabel("节点与板级 在架构图上的位置")
    .selectOption({ label: "不画在图上" });
  await page.getByRole("button", { name: "返回四步流程" }).click();
  await page
    .getByRole("navigation", { name: "四步工作流" })
    .getByRole("button", { name: /可用度评估/ })
    .click();
  const diagram = page.getByRole("region", { name: "系统架构图" });
  await expect(diagram).toContainText("没有画在图上的模块");
  await expect(
    diagram.getByRole("button", { name: /^节点与板级，现状可用度/ }),
  ).toContainText("673 FIT");

  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${task.id}/core`)).json()).model
          .measures.length,
    )
    .toBe(30);
  expect(errors).toEqual([]);
});

test("专家模式保留经典工作台，并可返回四步工作台", async ({
  page,
  request,
}) => {
  const task = await (
    await request.post("/api/tasks", {
      data: { name: "专家模式 " + Date.now() },
    })
  ).json();
  await page.goto("/?task=" + task.id);
  await page.getByRole("button", { name: "更多操作" }).click();
  await page
    .getByRole("menuitem", { name: "打开专家模式（经典工作台）" })
    .click();
  await expect(page).toHaveURL(/ui=classic/);
  await expect(
    page.getByRole("heading", { name: "可靠性设计与评估", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← 返回四步工作台" }).click();
  await expect(
    page.getByRole("navigation", { name: "四步工作流" }),
  ).toBeVisible();
});

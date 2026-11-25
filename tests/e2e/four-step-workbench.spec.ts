import { readFileSync } from "node:fs";
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
  await expect(summary).toContainText("10.42%");
  await expect(summary).toContainText("76.66%");

  // 第 1 步：预算闭合，切换方法后各模块目标随之变化
  const allocation = page.getByRole("region", { name: "分配结果" });
  await expect(page.getByRole("region", { name: "分配方法" })).toContainText(
    "8.40 h",
  );
  await expect(allocation).toContainText("= 8.40 h，与总预算一致");
  // 规模—目标：10 万卡 99% 与 50 万卡 95% 是同一个单卡可靠性水平
  const scaleTarget = page.getByRole("region", { name: "规模与目标" });
  await expect(scaleTarget).toContainText("1.010 ‰");
  await expect(scaleTarget).toContainText("1.053 ‰");
  await expect(
    scaleTarget.getByRole("img", { name: /规模与可用度/ }),
  ).toBeVisible();
  // 单次故障后果大的模块单独指定目标，不参与按权重分配
  await expect(page.getByRole("region", { name: "高后果模块" })).toContainText(
    "已指定 99.999%",
  );
  const sitePower = allocation.getByRole("row", { name: /机房供配电/ });
  await expect(sitePower).toContainText("单独指定");
  await expect(sitePower).toContainText("年 1 次");
  const optical = allocation.getByRole("row", { name: /光模块/ });
  await expect(optical).toContainText("2.58 h");
  // 允许的故障频次按“每连续运行一周”计
  await expect(optical).toContainText("≤ 48.1 次/年");
  await page.getByRole("radio", { name: /ARINC/ }).check();
  await expect(optical).toContainText("2.52 h");
  await expect(allocation).toContainText("= 8.40 h，与总预算一致");
  await expect(
    page
      .getByRole("region", { name: "架构上的目标" })
      .getByRole("group", { name: /^光模块，目标可用度/ }),
  ).toContainText("2.52 h");
  await expect(page.getByRole("region", { name: "分配依据" })).toContainText(
    "wᵢ = ρᵢ / Σⱼ ρⱼ",
  );

  // 第 2 步：模块现状与差距；修改故障率后现状立即更新
  await page.getByRole("button", { name: "下一步：可用度评估" }).click();
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    "可用度评估",
  );
  const architecture = page.getByRole("region", { name: "系统架构图" });
  // 架构图按硬件拓扑绘制，指标标在对应硬件上：现状与目标可用度、FIT、损失与预算
  await expect(
    architecture.getByRole("img", { name: "系统架构图（现状）" }),
  ).toBeVisible();
  await expect(architecture).toContainText("代表性超节点 · 1024 NPU 模组");
  await expect(architecture).toContainText("互联柜 1");
  await expect(
    architecture.getByRole("button", { name: /可用度/ }),
  ).toHaveCount(14);
  await expect(architecture).toContainText("机房供配电 · 全系统共用");
  const hbm = architecture.getByRole("button", { name: /^HBM，/ });
  await expect(hbm).toContainText("44.55%");
  await expect(hbm).toContainText("99.34%");
  // 架构图上标每周损失和连续运行一周的故障频次
  await expect(hbm).toContainText("周损失 21.9 h");
  await expect(hbm).toContainText("71.4次/周");
  await architecture.getByRole("tab", { name: "设计后" }).click();
  await expect(hbm).toContainText("97.54%");
  await architecture.getByRole("tab", { name: "现状" }).click();
  // 差距从频次（MTBF）和单次损失（MTTR）两个角度给出，以周为粒度
  const gapTable = page.getByRole("region", { name: "硬件损失差距排序" });
  await expect(gapTable).toContainText("缩短单次损失");
  await expect(gapTable.getByRole("row", { name: /^光模块/ })).toContainText(
    "168 次/周",
  );
  // 差距从哪边补：每个模块三根横条，给出降频次、缩短单次损失、两边都做各能压到预算的多少倍
  const lever = page.getByRole("region", { name: "差距从哪边补" });
  await expect(lever).toContainText("现状超预算的 12 个模块里");
  await expect(lever.getByRole("row", { name: /^光模块/ })).toContainText(
    "两边都做才达标",
  );
  await expect(lever.getByRole("row", { name: /^AICore/ })).toContainText(
    "187×",
  );
  // 恢复链：进程重调度 → 弹性恢复 → CKPT 回滚 → 人工，每一环的概率和时间
  const chain = page.getByRole("region", { name: "恢复链与计算过程" });
  await expect(
    chain.getByRole("img", { name: /光模块失效的恢复链（现状）/ }),
  ).toBeVisible();
  await expect(
    chain.getByRole("img", { name: /光模块失效的恢复链（设计后/ }),
  ).toBeVisible();
  // 现状没有弹性恢复：进程重调度失败的 70% 只能转人工
  await expect(
    chain.getByRole("row", { name: /^恢复 2 · 弹性恢复/ }),
  ).toContainText("现在不具备，转人工恢复");
  await expect(chain.getByRole("row", { name: /^单次等效损失/ })).toContainText(
    "2.9 小时",
  );
  await expect(chain.getByRole("row", { name: /^单次等效损失/ })).toContainText(
    "9.9 分钟",
  );
  // 横向条：一条线看出各环节耗时；再按路径拆开
  await expect(
    chain.getByRole("img", { name: /^设计后单次等效损失 9.9 分钟 的构成/ }),
  ).toBeVisible();
  await expect(
    chain.getByRole("img", {
      name: /进程重调度失败 → 弹性恢复 → CKPT 回滚，概率 68.6%，耗时 11.2 分钟/,
    }),
  ).toBeVisible();
  // 进程重调度成功率只有 30%、每次都要花 4 分钟：先试它反而更慢
  await expect(
    chain.getByRole("row", { name: /^恢复 1 · 进程重调度/ }),
  ).toContainText("每次反而多花 1.6 分钟");
  await expect(
    page.getByRole("region", { name: "可用度计算过程" }),
  ).toContainText("= 10.42%");
  await hbm.click();
  const drawer = page.getByRole("dialog", { name: "HBM" });
  const fit = drawer.getByLabel("不可纠正错误 的单件故障率");
  await fit.fill("425");
  await fit.press("Enter");
  await expect(drawer).toContainText("可用度 61.64%");
  await expect(drawer).toContainText("CKPT 回滚");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(summary).not.toContainText("10.42%");
  await hbm.click();
  await fit.fill("850");
  await fit.press("Enter");
  await page.keyboard.press("Escape");
  await expect(summary).toContainText("10.42%");

  // 第 3 步：措施分两层，Shapley 贡献、改进程度收益、组合路径与结论
  await page.getByRole("button", { name: "下一步：机制设计" }).click();
  const advice = page.getByRole("region", { name: "推荐方案" });
  // 进程重调度默认暂不优化：其余措施全做也到不了目标，并指出剩余损失卡在哪一级
  await expect(advice).toContainText("当前搜索到的组合为 87.54%");
  await expect(advice).toContainText("距目标还差 7.46 pp");
  await expect(advice).toContainText("进程重调度（39%）");
  await expect(advice).toContainText("标为“暂不优化”的 进程重调度 没有计入");
  const component = page.getByRole("region", { name: "组件级高可用" });
  await expect(component).toContainText("Hi-One 下一代光模块");
  await expect(component).toContainText("已启用 4 / 7");
  const system = page.getByRole("region", { name: "系统级可靠性机制" });
  await expect(system).toContainText("静默故障在线检测");
  const contribution = page.getByRole("region", { name: "各措施的贡献" });
  await expect(contribution).toContainText("+66.23 pp");
  // 分摊值与“单独做”“最后加”并列给出，并解释先后顺序造成的差别
  await expect(contribution).toContainText(
    "单独做 +17.55 pp · 最后加 +3.68 pp",
  );
  // 参数可调：把静默检出率提到 99%，设计后可用度随之提高
  const coverage = page.getByLabel("静默故障在线检测 · 检出率", {
    exact: true,
  });
  await coverage.fill("99");
  await coverage.press("Enter");
  await expect(summary).toContainText("78.75%");
  await coverage.fill("95");
  await coverage.press("Enter");
  await expect(summary).toContainText("76.66%");
  // 改进前的参数也能在措施上直接改，并同步到现状评估
  const agentBefore = page.getByLabel(
    "智能故障管理 Agent · 人工恢复 · 耗时（改进前）",
    { exact: true },
  );
  await agentBefore.fill("5");
  await agentBefore.press("Enter");
  await expect(summary).toContainText("8.62%");
  await agentBefore.fill("4");
  await agentBefore.press("Enter");
  await expect(summary).toContainText("10.42%");
  // 系统级按恢复链分为检测、恢复、隔离与弹性、检查点四类，候选可展开
  await expect(system).toContainText("已启用 6 / 23");
  for (const group of ["检测", "恢复", "隔离与弹性", "检查点"])
    await expect(
      system.getByRole("heading", { name: new RegExp("^" + group) }),
    ).toBeVisible();
  await expect(system).toContainText("智能故障管理 Agent");
  await expect(system).toContainText("CKPT 回滚优化");
  await expect(system).toContainText("暂不优化 1 项");
  await system.getByRole("button", { name: /显示全部 9 项候选/ }).click();
  await expect(system).toContainText("链路透明恢复");
  // 各措施值多少、组合收益瀑布
  const benefit = page.getByRole("region", { name: "各措施值多少" });
  await expect(benefit.getByRole("row", { name: /^弹性恢复/ })).toContainText(
    "+32.70 pp",
  );
  await expect(benefit.getByRole("row", { name: /^进程重调度/ })).toContainText(
    "暂不优化",
  );
  const path = page.getByRole("region", { name: "组合收益路径" });
  await expect(path).toContainText("还差 7.46 pp");
  await expect(path.getByRole("row", { name: /^1 弹性恢复/ })).toContainText(
    "47.79%",
  );
  await expect(
    path.getByRole("row", { name: /^5 智能故障管理 Agent/ }),
  ).toContainText("排在“弹性恢复”之后只剩 +3.25 pp");
  await expect(path).toContainText("为什么和右上“各措施的贡献”对不上");
  // 展开机制：参数—收益曲线、拖动试算；把进程重调度做到设计目标并纳入设计
  await page.getByRole("button", { name: "展开 进程重调度" }).click();
  await expect(
    page.getByRole("img", {
      name: "进程重调度：进程重调度 · 成功率取不同值时的系统可用度",
    }),
  ).toBeVisible();
  const trial = page.getByLabel("进程重调度 · 进程重调度 · 成功率试算取值");
  await trial.fill("200");
  await expect(system).toContainText("系统可用度 86.40%");
  await system.getByRole("button", { name: "回到计划" }).click();
  const success = page.getByLabel("进程重调度 · 进程重调度 · 成功率", {
    exact: true,
  });
  await success.fill("95");
  await success.press("Enter");
  for (const name of ["耗时", "失败耗时"]) {
    const field = page.getByLabel(`进程重调度 · 进程重调度 · ${name}`, {
      exact: true,
    });
    await field.fill("60");
    await field.press("Enter");
  }
  await page.getByRole("switch", { name: "启用 进程重调度" }).click();
  await expect(summary).toContainText("91.70%");
  // 结论：重点做哪几项、做到什么程度
  const focus = page.getByRole("region", { name: "重点措施结论" });
  await expect(focus).toContainText("这组措施可达 95.60%");
  await expect(
    focus.getByRole("row", { name: /通信与算子重执行/ }),
  ).toContainText("建议启用");
  await advice.getByRole("button", { name: "采用建议" }).click();
  await expect(advice).toContainText("当前设计已达标");
  await expect(summary).toContainText("95.60%");
  await expect(focus.getByRole("row", { name: /进程重调度/ })).toContainText(
    "兑现 ≥ 95%",
  );
  await expect(path).toContainText("项达标");
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

  // 一键导出：汇报 PPT（.pptx）与带图文汇报页的网页报告
  const [deck] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出 PPT" }).click(),
  ]);
  expect(
    readFileSync((await deck.path())!)
      .subarray(0, 2)
      .toString(),
  ).toBe("PK");
  const [report] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出报告", exact: true }).click(),
  ]);
  const html = readFileSync((await report.path())!, "utf8");
  expect(html).toContain('class="b-slide"');
  expect(html).toContain("立项汇报 · 可用度提升方案");
  expect(html).toContain("1　目标分配");
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
  await expect(modes.getByRole("row")).toHaveCount(16);
  const fit = modes.getByLabel("光模块失效 的单件故障率（FIT）");
  await fit.fill("250");
  await fit.press("Enter");
  await expect(summary).not.toContainText("10.42%");
  await fit.fill("500");
  await fit.press("Enter");
  await expect(summary).toContainText("10.42%");
  await modes.getByRole("button", { name: "添加故障模式" }).click();
  await expect(modes.getByRole("row")).toHaveCount(17);
  await modes.getByRole("button", { name: "删除故障模式 新故障模式" }).click();
  await expect(modes.getByRole("row")).toHaveCount(16);

  // 恢复阶梯：每一级的成功率和时间可改
  await modes
    .getByRole("button", { name: "编辑 光模块失效 的恢复阶梯" })
    .click();
  const ladder = page.getByRole("dialog", { name: "光模块失效 的恢复阶梯" });
  await expect(ladder).toContainText("进程重调度");
  await expect(ladder).toContainText("弹性恢复");
  await expect(ladder.getByLabel("光模块失效 · 弹性恢复成功后")).toHaveValue(
    "next",
  );
  await expect(ladder.getByLabel("光模块失效 · 弹性恢复失败后")).toHaveValue(
    "manual",
  );
  await expect(ladder).toContainText("单次等效损失 2.9 小时");
  await ladder.getByRole("button", { name: "完成" }).click();

  // 措施库：30 项默认措施；删除后可从默认库补回；可新增
  await page.getByRole("tab", { name: /可靠性措施库/ }).click();
  const measures = page.getByRole("region", { name: "可靠性措施库" });
  await expect(measures.getByRole("row")).toHaveCount(31);
  await expect(measures).toContainText("扩展机制库 R-LINK-LOCAL");
  await measures.getByRole("button", { name: "删除措施 链路透明恢复" }).click();
  await expect(measures.getByRole("row")).toHaveCount(30);
  await measures
    .getByRole("button", { name: "补回默认库中缺少的 1 项" })
    .click();
  await expect(measures.getByRole("row")).toHaveCount(31);
  await measures.getByRole("tab", { name: /组件级高可用/ }).click();
  await expect(measures.getByRole("row")).toHaveCount(8);
  await measures.getByRole("tab", { name: /全部/ }).click();
  await measures.getByRole("button", { name: "添加组件级措施" }).click();
  const dialog = page.getByRole("dialog", { name: "添加措施" });
  await dialog.getByLabel("措施名称").fill("光模块链路冗余");
  await dialog.getByLabel("光模块失效").check();
  await dialog.getByRole("button", { name: "添加并启用" }).click();
  await expect(measures.getByRole("row")).toHaveCount(32);
  await expect(summary).not.toContainText("76.66%");
  // 适用比例直接在表中调整
  const share = measures.getByLabel("光模块链路冗余 的适用比例（%）");
  await share.fill("0");
  await share.press("Enter");
  await expect(summary).toContainText("76.66%");

  // 架构模块：可以指定每个模块标注在架构图的哪个硬件上
  await page.getByRole("tab", { name: /架构模块/ }).click();
  const modules = page.getByRole("region", { name: "架构模块" });
  await expect(modules.getByRole("row")).toHaveCount(13);
  await expect(modules.getByLabel("机房供配电 的数量口径")).toHaveValue(
    "fixed",
  );
  await expect(modules.getByLabel("机房供配电 的指定目标（%）")).toHaveValue(
    "99.999",
  );
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
    .toBe(31);
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

import { it, expect } from "vitest";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { createElement } from "react";
import ResultView, {
  lossRows,
  candidateRequest,
  lossBudgetComparison,
} from "../../../apps/web/src/ResultView";
import { runTraining } from "../../solvers/src/training";
import { search, attribute, compare, sensitivity } from "../src/index";
import { allocate } from "../../allocation/src/index";
import { solveStatic } from "../../solvers/src/static";
import { solveCtmc } from "../../solvers/src/ctmc";
import type { Run } from "../../contracts/src/types";
import { TaskApiContext, createTaskApi } from "../../../apps/web/src/api";
const renderToStaticMarkup = (node: Parameters<typeof renderMarkup>[0]) =>
  renderMarkup(
    createElement(
      TaskApiContext.Provider,
      { value: createTaskApi("result-view-task") },
      node,
    ),
  );
const base = {
  cards: 1000,
  hours: 3,
  trials: 4,
  seed: 1,
  target: 0.99,
  model: { fits: [0, 0, 0, 0] },
};
const run = (
  result: any,
  operation = "training",
  status: Run["status"] = "succeeded",
): Run => ({
  id: "result-view-test",
  status,
  operation,
  input: base,
  inputHash: "hash",
  result,
  createdAt: "2026-10-10T00:00:00Z",
  progress: 1,
  events: [],
});
it("uses actual training ledger losses without double counting gross work or delivery", () => {
  const result = runTraining(base),
    rows = lossRows(result);
  expect(rows.map((row) => row.key)).not.toContain("grossWork");
  expect(rows.map((row) => row.key)).not.toContain("delivered");
  expect(rows.map((row) => row.key)).not.toContain("residual");
  expect(
    rows.reduce((s, row) => s + row.hours, 0) + result.ledger.delivered,
  ).toBeCloseTo(base.hours, 10);
  const html = renderToStaticMarkup(
    createElement(ResultView, { run: run(result) }),
  );
  expect(html).toContain("正确交付");
  expect(html).toContain("保存阻塞");
  expect(html).toContain("采样误差");
});
it("search candidate callback payload uses design seed rather than independent verification seed", () => {
  const result = search({
    base,
    designSpace: { saveSeconds: [0] },
    verificationTrials: 4,
  });
  const request = candidateRequest(result.items[0]);
  expect(request.seed).toBe(base.seed);
  expect(request.model?.saveSeconds).toBe(0);
  expect(request.seed).not.toBe(result.verification!.request.seed);
  const html = renderToStaticMarkup(
    createElement(ResultView, {
      run: run(result, "search"),
      onApplyCandidate: () => {},
    }),
  );
  expect(html).toContain("应用到历史模型 V4");
  expect(html).toContain("独立验证");
  expect(html).toContain("候选");
});
it("renders negative actual Shapley values as percentage-point contributions", () => {
  const result = attribute({ base, factors: ["checkpoint", "save"] });
  expect(result.contributions[0].shapley).toBeLessThan(0);
  const html = renderToStaticMarkup(
    createElement(ResultView, { run: run(result, "attribute") }),
  );
  expect(html).toContain("百分点");
  expect(html).toContain("负贡献");
  expect(html).toContain("检查点周期");
});
it("keeps unfinished runs non-exportable and separates terminal diagnostics from stale results", () => {
  for (const status of ["queued", "running", "failed", "cancelled"] as const) {
    const html = renderToStaticMarkup(
      createElement(ResultView, {
        run: run(runTraining(base), "training", status),
      }),
    );
    if (status === "queued" || status === "running")
      expect(html).not.toContain("/report?");
    else {
      expect(html).toContain("/report?format=json");
      expect(html).toContain("下载诊断 JSON");
      expect(html).not.toContain(">下载报告</a>");
    }
    expect(html).not.toContain("正确交付比例");
  }
});
it("renders real allocation, comparison and sensitivity structures as readable tables", () => {
  const allocation = allocate({
    method: "availability",
    target: 0.98,
    hours: 10,
    items: [
      { id: "A", name: "计算模块", baselineAvailability: 0.97 },
      { id: "B", name: "存储模块", baselineAvailability: 0.96 },
    ],
  });
  const allocationHtml = renderToStaticMarkup(
    createElement(ResultView, { run: run(allocation, "allocate") }),
  );
  expect(allocationHtml).toContain("计算模块");
  expect(allocationHtml).toContain("97.000%");
  expect(allocationHtml).toContain("分配目标");
  const comparison = compare({
    base,
    variants: [{ id: "save", name: "加速保存", model: { saveSeconds: 0 } }],
  });
  const comparisonHtml = renderToStaticMarkup(
    createElement(ResultView, {
      run: run(comparison, "compare"),
      onApplyCandidate: () => {},
    }),
  );
  expect(comparisonHtml).toContain("加速保存");
  expect(comparisonHtml).toContain("相对基线变化");
  expect(comparisonHtml).toContain("应用到历史模型 V4");
  const sweep = sensitivity({
    base,
    parameter: "saveSeconds",
    values: [0, 60],
  });
  expect(
    renderToStaticMarkup(
      createElement(ResultView, { run: run(sweep, "sensitivity") }),
    ),
  ).toContain("保存阻塞（秒）");
});
it("compares mutually exclusive loss groups only against a matching saved budget", () => {
  const result = runTraining(base);
  const budget = {
    target: base.target,
    hours: base.hours,
    items: Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      name: String(i),
      lossHoursBudget: 0.0075,
    })),
  };
  result.request = { ...result.request, lossBudget: budget } as any;
  const comparison = lossBudgetComparison(result)!;
  expect(comparison.valid).toBe(true);
  expect(comparison.items.reduce((s, i) => s + i.actualHours, 0)).toBeCloseTo(
    base.hours - result.ledger.delivered,
    10,
  );
  budget.target = 0.98;
  const stale = lossBudgetComparison(result)!;
  expect(stale.valid).toBe(false);
  expect(stale.items.every((i) => i.withinBudget === null)).toBe(true);
  budget.target = base.target;
  budget.hours = base.hours + 1;
  expect(lossBudgetComparison(result)!.valid).toBe(false);
  const html = renderToStaticMarkup(
    createElement(ResultView, { run: run(result) }),
  );
  expect(html).toContain("预算已失效");
  expect(html).toContain("工程参数映射待确认");
});
it("keeps fault-tree probability and general CTMC rewards distinct from training delivery", async () => {
  const fault = solveStatic({
    method: "fta",
    tree: { type: "event", id: "A", probability: 0.1 },
  });
  const faultHtml = renderToStaticMarkup(
    createElement(ResultView, { run: run(fault, "static") }),
  );
  expect(faultHtml).toContain("顶事件发生概率");
  expect(faultHtml).toContain("10.000%");
  const ctmc = await solveCtmc({
    Q: [
      [-0.01, 0.01],
      [1, -1],
    ],
    p0: [1, 0],
    times: [0, 1],
    rewards: [2, 0],
  });
  const ctmcHtml = renderToStaticMarkup(
    createElement(ResultView, { run: run(ctmc, "ctmc") }),
  );
  expect(ctmcHtml).toContain("稳态期望奖励");
  expect(ctmcHtml).toContain("状态 1 概率");
  expect(ctmcHtml).not.toContain("训练有效可用度");
});

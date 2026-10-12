import { it, expect } from "vitest";
import { report } from "../src/render";
import { runTraining } from "../../solvers/src/training";
import {
  compare,
  search,
  attribute,
  sensitivity,
} from "../../analysis/src/index";
import { allocate } from "../../allocation/src/index";
import { summarize } from "../../solvers/src/statistics";
import type { Run } from "../../contracts/src/types";
const base = {
  cards: 1000,
  hours: 3,
  trials: 8,
  seed: 1,
  target: 0.99,
  model: { fits: [0, 0, 0, 0] },
};
const wrap = (result: any, operation = "training"): Run => ({
  id: "report-test",
  status: "succeeded",
  operation,
  input: structuredClone(base),
  inputHash: "hash",
  result,
  createdAt: "2026-10-11T00:00:00Z",
  progress: 1,
  events: [],
});
it("distinguishes a mean above target from unstable sampling evidence and exposes sampling limits", () => {
  const result = runTraining(base);
  result.statistics = summarize([0.985, 1], 0.99);
  const md = report(wrap(result));
  expect(md).toContain("点估计达到");
  expect(md).toContain("采样区间跨越目标");
  expect(md).not.toContain("均值达标");
  expect(md).toContain("Student-t");
  expect(md).toContain("稀有");
  expect(md).toContain("Wilson");
  expect(md).toContain("检查点保存阻塞");
});
it("keeps arbitrary CTMC rewards numeric rather than calling them availability percentages", () => {
  const result = {
    solver: "SciPy expm",
    stationary: [1],
    stationaryReward: 2,
    integratedReward: 4,
    transient: [{ time: 2, probabilities: [1], reward: 2 }],
  };
  for (const format of ["md", "html"]) {
    const output = report(wrap(result, "ctmc"), format);
    expect(output).toContain("稳态期望奖励");
    expect(output).not.toContain("200.000%");
    expect(output).toContain("累计期望奖励");
  }
});
it("renders real comparison and sensitivity core tables in Markdown and HTML", () => {
  const result = compare({
    base,
    variants: [{ id: "save", name: "加速保存", model: { saveSeconds: 0 } }],
  });
  const md = report(wrap(result, "compare")),
    html = report(wrap(result, "compare"), "html");
  expect(md).toContain("| 方案");
  expect(md).toContain("加速保存");
  expect(md).toContain("相对基线变化");
  expect(html).toContain("<table>");
  expect(html).toContain("<td>加速保存</td>");
  expect(html).toContain("百分点");
  const sweep = sensitivity({
    base,
    parameter: "saveSeconds",
    values: [0, 60],
  });
  expect(report(wrap(sweep, "sensitivity"))).toContain("参数敏感性");
});
it("renders allocation, exact attribution and search verification without relying on JSON", () => {
  const allocation = allocate({
    method: "availability",
    target: 0.98,
    hours: 10,
    items: [
      { id: "A", name: "计算模块", baselineAvailability: 0.97 },
      { id: "B", name: "存储模块", baselineAvailability: 0.96 },
    ],
  });
  expect(report(wrap(allocation, "allocate"))).toContain("| 计算模块");
  const attribution = attribute({ base, factors: ["checkpoint", "save"] });
  expect(report(wrap(attribution, "attribute"))).toContain("负贡献");
  const result = search({
    base,
    designSpace: { saveSeconds: [0] },
    verificationTrials: 8,
  });
  const md = report(wrap(result, "search"));
  expect(md).toContain("独立验证");
  expect(md).toContain("筛选均值");
  expect(md).toContain("候选通过本次独立采样验证");
});
it("escapes all dynamic HTML content including table names and full snapshots", () => {
  const attack = "<img src=x onerror=alert(1)>",
    result = compare({
      base,
      variants: [{ id: "attack", name: attack, model: { saveSeconds: 0 } }],
    });
  const run = wrap(result, "compare");
  run.id = "<script>alert(2)</script>";
  run.input.extra = attack;
  const html = report(run, "html");
  expect(html).not.toContain("<img");
  expect(html.match(/<script>/g)).toHaveLength(1);
  expect(html).not.toContain("<script>alert(2)</script>");
  expect(html).toContain("&lt;img");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("<td>&lt;img src=x onerror=alert(1)&gt;</td>");
});

it("labels frozen V4 reports and their derived analyses without changing JSON snapshots", () => {
  for (const operation of [
    "training",
    "compare",
    "search",
    "sensitivity",
    "attribute",
  ]) {
    const run = wrap(runTraining(base), operation);
    const snapshot = JSON.stringify(run, null, 2);
    for (const format of ["md", "html"]) {
      const output = report(run, format);
      expect(output).toContain("可靠性设计与评估报告 · 历史模型 V4");
      expect(output).toContain("training.correct-delivery");
      expect(output).toContain("整条任务的交付产出清零");
    }
    expect(report(run, "json")).toBe(snapshot);
  }
  expect(report(wrap({ probability: 0.99 }, "rbd"))).not.toContain(
    "历史模型 V4",
  );
});

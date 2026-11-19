import { expect, it } from "vitest";
import {
  measureScaleStudy,
  novemberReferenceScenario,
} from "../../core/src/index";
import {
  measureCurveGeometry,
  measureCurveSvg,
} from "../../../apps/web/src/workbench/measure-curve";
import { buildReport } from "../../../apps/web/src/workbench/report";
import { analyze } from "../../core/src/index";

it("双纵轴严格按168小时换算，跨零收益阴影拆分且不将负收益涂蓝", () => {
  const data = measureScaleStudy(novemberReferenceScenario()).measures[0];
  const geometry = measureCurveGeometry(data.points);
  for (const tick of geometry.ticks)
    expect(tick.weeklyLoss).toBeCloseTo(168 * (1 - tick.availability), 12);
  const crossing = structuredClone(data.points.slice(0, 2));
  crossing[0].availability = crossing[0].baseline - 0.01;
  crossing[1].availability = crossing[1].baseline + 0.01;
  const result = measureCurveGeometry(crossing);
  expect(result.bands).toHaveLength(2);
  expect(result.bands.map((b) => b.positive)).toEqual([false, true]);
  expect(result.bands[0].points.split(" ")[1]).toBe(
    result.bands[1].points.split(" ")[0],
  );
});

it("工作台与离线报告共用一个双轴图，不执行用户输入的SVG或HTML", () => {
  const model = novemberReferenceScenario(),
    study = measureScaleStudy(model);
  const measure = {
    ...study.measures[0],
    name: '</title><script>alert("x")</script>',
  };
  const svg = measureCurveSvg(measure);
  expect(svg.match(/<svg /g)).toHaveLength(1);
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).toContain("周损失＝168×(1−可用度)");
  const html = buildReport("测试导出", model, analyze(model), null);
  expect(html.match(/<svg /g)).toHaveLength(study.measures.length);
  expect(html).toContain(measureCurveSvg(study.measures[0]));
});

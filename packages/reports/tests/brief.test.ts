import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { analyze, defaultCoreModel } from "../../core/src/index";
import { buildBrief, briefSize } from "../../../apps/web/src/workbench/brief";
import { briefHtml } from "../../../apps/web/src/workbench/brief-html";
import { briefPptx } from "../../../apps/web/src/workbench/brief-pptx";
import { buildReport } from "../../../apps/web/src/workbench/report";

const seconds = (value: number) => value / 3600;
/** 达标方案：进程重调度做到设计目标并纳入设计，再启用推荐补充的措施。 */
function reachingModel() {
  const model = defaultCoreModel(),
    process = model.measures.find((m) => m.id === "fast-recover")!;
  process.effects[0].value = 0.95;
  process.effects[1].value = seconds(60);
  process.effects[2].value = seconds(60);
  process.hold = false;
  const add = analyze(model).recommendation.add;
  for (const m of model.measures) if (add.includes(m.id)) m.enabled = true;
  return model;
}

describe("汇报导出：同一份页面内容输出 PPT 和网页", () => {
  it("默认场景未达标时如实给出差距，图元都落在画布内", () => {
    const model = defaultCoreModel(),
      brief = buildBrief("默认场景", model, analyze(model), null);
    expect(brief.slides.length).toBeGreaterThanOrEqual(10);
    expect(brief.slides[1].title).toContain("距目标还差 20.42 pp");
    const texts = brief.slides
      .flatMap((s) => s.prims)
      .flatMap((p) => (p.t === "text" ? p.runs.map((r) => r.text) : []))
      .join("");
    expect(texts).toContain("45.13%");
    expect(texts).toContain("74.58%");
    expect(texts).toContain("待运行独立验证");
    expect(texts).toContain("暂不优化的机制：");
    // 路线页：措施库全做也到不了目标；关键措施页选中暂不优化的进程重调度，给出两个参数的可用度表
    expect(brief.slides[2].title).toBe(
      "路线：当前方案到 74.6%，措施库全做也只到 91.6%",
    );
    expect(brief.slides[3].title).toContain("只把“进程重调度”做到头也只到");
    expect(texts).toContain("进程重调度：成功率 × 耗时 → 系统可用度");
    expect(texts).toContain("43% 在进程重调度");
    for (const slide of brief.slides)
      for (const prim of slide.prims) {
        const [x, y, w, h] =
          prim.t === "line"
            ? [
                Math.min(prim.x1, prim.x2),
                Math.min(prim.y1, prim.y2),
                Math.abs(prim.x2 - prim.x1),
                Math.abs(prim.y2 - prim.y1),
              ]
            : [prim.x, prim.y, prim.w, prim.t === "table" ? 0 : prim.h];
        for (const value of [x, y, w, h])
          expect(Number.isFinite(value)).toBe(true);
        expect(x, slide.title).toBeGreaterThanOrEqual(-0.01);
        expect(y, slide.title).toBeGreaterThanOrEqual(-0.01);
        expect(x + w, slide.title).toBeLessThanOrEqual(briefSize.width + 0.01);
        expect(y + h, slide.title).toBeLessThanOrEqual(briefSize.height + 0.01);
      }
  });
  it("达标方案：结论页写明达到目标，PPT 每页一张幻灯片，网页与 PPT 页数一致", async () => {
    const model = reachingModel(),
      analysis = analyze(model),
      brief = buildBrief("达标方案", model, analysis, null);
    expect(analysis.design.system.availability).toBeCloseTo(0.9512, 3);
    expect(brief.slides[1].title).toContain("达到目标");
    // 路线页按证据状态分步：已立项的 7 项不够，补上设计假设的措施后达标
    expect(brief.slides[2].title).toMatch(
      /^路线：已有证据或已立项的 7 项只到 74\.6%，补上 \d+ 项后达到 95\.1%$/,
    );
    const route = brief.slides[2].prims
      .flatMap((p) => (p.t === "text" ? p.runs.map((r) => r.text) : []))
      .join("");
    expect(route).toContain("“进程重调度”不能不做：");
    // 关键措施页：耗时按计划 60 秒时，给出成功率的达标线
    expect(brief.slides[3].title).toMatch(
      /^关键立项点：“进程重调度”耗时 60 秒时，成功率不低于 9\d(\.\d)?%$/,
    );
    const html = briefHtml(brief);
    expect(html.match(/class="b-slide"/g)).toHaveLength(brief.slides.length);
    expect(html).toContain("95.12%");
    const pptx = await briefPptx(brief),
      zip = await JSZip.loadAsync(
        (await pptx.write({ outputType: "nodebuffer" })) as Buffer,
      ),
      slides = Object.keys(zip.files).filter((name) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name),
      );
    expect(slides).toHaveLength(brief.slides.length);
    const first = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(first).toContain("95.12%");
    // 详细报告开头带同一套汇报页，后面保留全部明细表
    const report = buildReport("达标方案", model, analysis, null);
    expect(report.match(/class="b-slide"/g)).toHaveLength(brief.slides.length);
    expect(report).toContain("1　目标分配");
  }, 30000);
});

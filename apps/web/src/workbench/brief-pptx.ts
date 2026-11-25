import type PptxGenJS from "pptxgenjs";
import { briefColors, type Brief, type Cell, type Prim } from "./brief";

const FONT = "Microsoft YaHei";

function draw(pptx: PptxGenJS, slide: PptxGenJS.Slide, prim: Prim) {
  if (prim.t === "rect") {
    slide.addShape(
      prim.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect,
      {
        x: prim.x,
        y: prim.y,
        w: prim.w,
        h: prim.h,
        fill: prim.fill ? { color: prim.fill } : { type: "none" },
        line: prim.line ? { color: prim.line, width: 0.75 } : { type: "none" },
        ...(prim.radius ? { rectRadius: prim.radius } : {}),
      },
    );
    return;
  }
  if (prim.t === "line") {
    slide.addShape(pptx.ShapeType.line, {
      x: Math.min(prim.x1, prim.x2),
      y: Math.min(prim.y1, prim.y2),
      w: Math.abs(prim.x2 - prim.x1),
      h: Math.abs(prim.y2 - prim.y1),
      line: {
        color: prim.color,
        width: prim.width ?? 1,
        dashType: prim.dash ? "dash" : "solid",
      },
    });
    return;
  }
  if (prim.t === "text") {
    slide.addText(
      prim.runs.map((run) => ({
        text: run.text,
        options: {
          bold: run.bold ?? prim.bold ?? false,
          color: run.color ?? prim.color ?? briefColors.ink,
        },
      })),
      {
        x: prim.x,
        y: prim.y,
        w: prim.w,
        h: prim.h,
        fontSize: prim.size,
        fontFace: FONT,
        align: prim.align ?? "left",
        valign: prim.valign ?? "top",
        margin: 0,
        lineSpacingMultiple: 1.15,
        wrap: true,
      },
    );
    return;
  }
  const border = (color: string) =>
      [
        { type: "none" },
        { type: "none" },
        { type: "solid", pt: 0.75, color },
        { type: "none" },
      ] as [
        PptxGenJS.BorderProps,
        PptxGenJS.BorderProps,
        PptxGenJS.BorderProps,
        PptxGenJS.BorderProps,
      ],
    cell = (value: Cell, index: number): PptxGenJS.TableCell => {
      const item = typeof value === "string" ? { text: value } : value;
      return {
        text: item.text,
        options: {
          bold: "bold" in item ? !!item.bold : false,
          color: ("color" in item && item.color) || briefColors.ink,
          align: prim.align?.[index] ?? "left",
          valign: "middle",
          border: border(briefColors.line),
        },
      };
    };
  slide.addTable(
    [
      prim.head.map((head, index) => ({
        text: head,
        options: {
          bold: true,
          color: briefColors.ink2,
          fill: { color: briefColors.soft },
          align: prim.align?.[index] ?? "left",
          valign: "middle" as const,
          border: border("CDD3DC"),
        },
      })),
      ...prim.rows.map((row) => row.map(cell)),
    ],
    {
      x: prim.x,
      y: prim.y,
      w: prim.w,
      colW: prim.colW,
      fontSize: prim.size,
      fontFace: FONT,
      margin: [3, 6, 3, 6],
    },
  );
}

/** 把汇报内容写成 .pptx：白底 16:9，图表都是可编辑的原生形状和表格。 */
export async function briefPptx(brief: Brief) {
  const module = await import("pptxgenjs"),
    Pptx = (module.default ?? module) as unknown as new () => PptxGenJS,
    pptx = new Pptx();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = brief.title;
  pptx.subject = "可用度提升方案汇报";
  pptx.company = "ReMAP";
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  for (const page of brief.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: briefColors.white };
    for (const prim of page.prims) draw(pptx, slide, prim);
  }
  return pptx;
}

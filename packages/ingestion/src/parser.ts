import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { extname } from "node:path";
import { hash } from "../../assets/src/hash";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
} from "../../runtime-policy/src/index";

export interface ExtractionProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
}
export async function parseInput(
  name: string,
  bytes: Buffer,
  provider?: ExtractionProvider,
) {
  const ext = extname(name).toLowerCase();
  const common = {
    filename: name,
    contentHash: hash(bytes.toString("base64")),
    size: bytes.length,
  };
  const sources: any[] = [];
  let data: any;
  let text = "";
  try {
    if (ext === ".json") {
      data = JSON.parse(bytes.toString("utf8"));
      sources.push({ file: name, pointer: "/" });
    } else if (ext === ".csv") {
      data = parse(bytes, { columns: true, skip_empty_lines: true, bom: true });
      data.forEach((_: any, i: number) =>
        sources.push({ file: name, row: i + 2 }),
      );
    } else if (ext === ".xlsx") {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes as any);
      data = [];
      book.eachSheet((sheet) => {
        const headers = (sheet.getRow(1).values as any[]).slice(1).map(String);
        sheet.eachRow((row, index) => {
          if (index === 1) return;
          const record: any = {};
          headers.forEach((h, i) => (record[h] = row.getCell(i + 1).text));
          data.push(record);
          sources.push({ file: name, sheet: sheet.name, row: index });
        });
      });
    } else if (ext === ".pdf") {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
      }).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((x: any) => x.str ?? "").join(" ");
        text += pageText + "\n";
        sources.push({ file: name, page: i, text: pageText });
      }
      await doc.destroy();
    } else if ([".md", ".txt", ".html"].includes(ext)) {
      text = bytes.toString("utf8");
      text
        .split("\n")
        .forEach((line, i) =>
          sources.push({ file: name, line: i + 1, text: line }),
        );
    } else if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext))
      return {
        ...common,
        status: "needs-input",
        data: null,
        sources,
        issues: [
          {
            code: "FORMAT_UNSUPPORTED",
            message: "支持 JSON、CSV、XLSX、Markdown、文本、PDF 和图片",
          },
        ],
      };
    if (data !== undefined)
      return { ...common, status: "extracted", data, sources, issues: [] };
    if (!provider)
      return {
        ...common,
        status: "needs-input",
        data: text ? { rawText: text } : null,
        sources,
        issues: [
          {
            code: "AGENT_UNAVAILABLE",
            message:
              "已保留原文；需要配置模型以提取架构、故障模式和机制，或使用结构化模板导入。",
          },
        ],
      };
    const content: any[] = [
      {
        type: "text",
        text:
          "将输入转为可靠性建模 JSON 草稿，包含 architecture(nodes,edges)、failureModes、mechanisms、parameters、ambiguities。保留 source(file,line/page/cell)，不猜测缺失的 FIT、概率、时长、单位或拓扑。无法确认处写入 ambiguities。只返回 JSON。文件：" +
          name +
          "\n" +
          text,
      },
    ];
    if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext))
      content.push({
        type: "image_url",
        image_url: {
          url: `data:image/${ext === ".jpg" ? "jpeg" : ext.slice(1)};base64,${bytes.toString("base64")}`,
        },
      });
    if (ext === ".pdf" && !text.trim())
      return {
        ...common,
        status: "needs-input",
        data: null,
        sources,
        issues: [
          {
            code: "OCR_REQUIRED",
            message: "扫描 PDF 需要先导出页面图片或提供文本版本。",
          },
        ],
      };
    const policy = readRuntimePolicy();
    const requestUrl = assertEndpointAllowed(
      provider.baseUrl.replace(/\/$/, "") + "/chat/completions",
      "extraction",
      policy,
    );
    const response = await fetch(requestUrl, {
      ...(policy.profile === "internal" ? { redirect: "error" as const } : {}),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + provider.apiKey,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error("模型提取服务 HTTP " + response.status);
    const result: any = await response.json();
    data = JSON.parse(result.choices[0].message.content);
    return {
      ...common,
      status: "needs-confirmation",
      data,
      sources,
      issues: data.ambiguities ?? [],
      provider: { model: provider.model },
    };
  } catch (error) {
    return {
      ...common,
      status: "needs-input",
      data: null,
      sources,
      issues: [
        { code: "INPUT_PARSE_FAILED", message: (error as Error).message },
      ],
    };
  }
}

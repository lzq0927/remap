import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { createHash, randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import type { Material } from "./schema";

export async function readMaterial(
  name: string,
  bytes: Buffer,
  scope: Material["scope"] = "private",
): Promise<Material> {
  if (!name || name.length > 200 || bytes.length > 5_000_000)
    throw new Error("材料需有名称且小于5MB");
  const segments: Material["segments"] = [];
  const ext = extname(name).toLowerCase();
  if (ext === ".pptx") {
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    if (
      entries.length > 4000 ||
      entries.reduce(
        (n, e) => n + ((e as any)._data?.uncompressedSize ?? 0),
        0,
      ) > 20_000_000
    )
      throw new Error("PPTX 解压资源超限");
    const xml = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      parseTagValue: false,
      trimValues: false,
    });
    const slides = entries
      .filter((e) =>
        /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(
          e.name,
        ),
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    if (slides.length > 200) throw new Error("最多200个幻灯片/备注文档");
    for (const entry of slides) {
      const raw = await entry.async("string");
      if (raw.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(raw))
        throw new Error("PPTX XML 不安全或超限");
      const document = xml.parse(raw);
      const walk = (node: any, path: string) => {
        if (!node || typeof node !== "object") return;
        if (node["p:cNvPr"]) {
          const shape = node["p:cNvPr"];
          segments.push({
            locator: `${entry.name}#shape:${shape["@_id"] ?? path}`,
            text: `图元 ${shape["@_name"] ?? ""}`,
          });
        }
        for (const [k, v] of Object.entries(node)) {
          if (k === "a:t") {
            const t = typeof v === "object" ? (v as any)["#text"] : v;
            if (typeof t === "string")
              segments.push({ locator: `${entry.name}#${path}`, text: t });
          } else if (k === "a:stCxn" || k === "a:endCxn") {
            segments.push({
              locator: `${entry.name}#${path}`,
              text: `${k === "a:stCxn" ? "连接起点" : "连接终点"} shape:${(v as any)["@_id"]}`,
            });
          } else if (Array.isArray(v))
            v.forEach((x, i) => walk(x, `${path}/${k}/${i}`));
          else walk(v, `${path}/${k}`);
        }
      };
      walk(document, "");
    }
  } else if ([".md", ".txt", ".json"].includes(ext)) {
    const text = bytes.toString("utf8");
    if (text.length > 1_000_000) throw new Error("文本材料超限");
    text
      .split(/\r?\n/)
      .forEach((text, i) => segments.push({ locator: `line:${i + 1}`, text }));
  } else
    throw new Error(
      "工程材料入口支持 PPTX、Markdown、TXT 和 JSON；PDF/图片可先用输入与来源提取后整理",
    );
  if (segments.length > 2000 || segments.some((s) => s.text.length > 30000))
    throw new Error("材料段落超限，请拆分");
  return {
    id: "material-" + randomUUID(),
    name: basename(name),
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    text: segments.map((s) => `[${s.locator}] ${s.text}`).join("\n"),
    segments,
    scope,
    originalBase64: bytes.toString("base64"),
  };
}

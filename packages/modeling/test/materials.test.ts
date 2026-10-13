import { it, expect } from "vitest";
import JSZip from "jszip";
import { readMaterial } from "../src/materials";
it("extracts PPT shape text, connector references and notes with locations", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<p:sld><p:sp><p:nvSpPr><p:cNvPr id="2" name="Coordinator"/></p:nvSpPr><a:t>协调器A</a:t></p:sp><p:cxnSp><a:stCxn id="2"/><a:endCxn id="3"/></p:cxnSp></p:sld>',
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    "<p:notes><a:t>共享供电需要复核</a:t></p:notes>",
  );
  const material = await readMaterial(
    "expert.pptx",
    await zip.generateAsync({ type: "nodebuffer" }),
    "synthetic",
  );
  expect(material.text).toContain("协调器A");
  expect(material.text).toContain("连接起点 shape:2");
  expect(material.text).toContain("共享供电");
  expect(material.segments.some((s) => s.locator.includes("shape:2"))).toBe(
    true,
  );
  expect(material.originalBase64).toBeTruthy();
});
it("rejects XML entities, unsupported input and large files", async () => {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><p:sld/>',
  );
  await expect(
    readMaterial("x.pptx", await zip.generateAsync({ type: "nodebuffer" })),
  ).rejects.toThrow(/XML/);
  await expect(readMaterial("x.exe", Buffer.from("x"))).rejects.toThrow(/支持/);
  await expect(readMaterial("x.txt", Buffer.alloc(5000001))).rejects.toThrow(
    /5MB/,
  );
});

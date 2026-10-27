import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2] ?? "/workspace/artifacts/remap-refinement-20261027";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1800, height: 1080 },
  deviceScaleFactor: 1,
});
for (const id of ["architecture", "loss", "scales", "research"]) {
  await page.setContent(
    `<html><style>body{margin:0}</style>${readFileSync(`${dir}/${id}.svg`, "utf8")}</html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${dir}/${id}.png` });
  const overflow = await page.locator("svg text").evaluateAll((nodes) =>
    nodes
      .filter((n) => {
        const b = n.getBBox();
        return b.x < 0 || b.x + b.width > 1800 || b.y + b.height > 1080;
      })
      .map((n) => n.textContent),
  );
  writeFileSync(`${dir}/${id}-overflow.json`, JSON.stringify(overflow));
}
await page.setContent(readFileSync(`${dir}/ReMAP-review.html`, "utf8"));
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() =>
  document
    .querySelectorAll("details")
    .forEach((el) => el.setAttribute("open", "")),
);
await page.pdf({
  path: `${dir}/ReMAP-架构与措施评审.pdf`,
  preferCSSPageSize: true,
  printBackground: true,
});
await browser.close();

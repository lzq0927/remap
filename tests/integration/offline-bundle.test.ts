import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyBundle } from "../../scripts/offline-bundle.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rem-offline-test-"));
  roots.push(root);
  const bundle = join(root, "bundle"),
    source = join(root, "source");
  await mkdir(join(bundle, "store"), { recursive: true });
  await mkdir(source);
  const sourceHashes: Record<string, string> = {};
  for (const [file, content] of Object.entries({
    "package.json": '{"packageManager":"pnpm@11.25.0"}',
    "pnpm-lock.yaml": "synthetic-lock",
    "pnpm-workspace.yaml": "packages: []",
  })) {
    await writeFile(join(source, file), content);
    sourceHashes[file] = createHash("sha256").update(content).digest("hex");
  }
  const bytes = Buffer.from("synthetic-package-content");
  await writeFile(join(bundle, "store", "content"), bytes);
  const manifest = {
    schemaVersion: "1.0.0",
    kind: "pnpm-offline-store",
    platform: process.platform,
    arch: process.arch,
    packageManager: "pnpm@11.25.0",
    sourceHashes,
    files: [
      {
        path: "store/content",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  await writeFile(join(bundle, "manifest.json"), JSON.stringify(manifest));
  return { bundle, source, manifest };
}
test("offline manifest accepts exact source and store bytes, rejects tampering and extra files", async () => {
  const { bundle, source } = await fixture();
  expect((await verifyBundle(bundle, source)).kind).toBe("pnpm-offline-store");
  await writeFile(join(bundle, "store", "extra"), "unlisted");
  await expect(verifyBundle(bundle, source)).rejects.toThrow("摘要不一致");
  await rm(join(bundle, "store", "extra"));
  await writeFile(join(bundle, "store", "content"), "changed");
  await expect(verifyBundle(bundle, source)).rejects.toThrow("摘要不一致");
});
test("offline manifest rejects lock mismatch and other target platforms", async () => {
  const { bundle, source, manifest } = await fixture();
  await writeFile(join(source, "pnpm-lock.yaml"), "new-lock");
  await expect(verifyBundle(bundle, source)).rejects.toThrow("配置不匹配");
  await writeFile(join(source, "pnpm-lock.yaml"), "synthetic-lock");
  await writeFile(
    join(bundle, "manifest.json"),
    JSON.stringify({ ...manifest, platform: "another-os" }),
  );
  await expect(verifyBundle(bundle, source)).rejects.toThrow("平台/架构");
});
test("offline manifest does not trust traversal entries", async () => {
  const { bundle, source, manifest } = await fixture();
  const bytes = await readFile(join(source, "package.json"));
  await writeFile(
    join(bundle, "manifest.json"),
    JSON.stringify({
      ...manifest,
      files: [
        {
          path: "../source/package.json",
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    }),
  );
  await expect(verifyBundle(bundle, source)).rejects.toThrow("摘要不一致");
});

import { expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { reportPackage } from "../src/report-package";
import type { Run } from "../../contracts/src/types";

const run: Run = {
  id: "offline",
  operation: "static",
  status: "succeeded",
  progress: 1,
  inputHash: "hash",
  createdAt: "2026-10-13",
  input: { evidence: "FULL_INPUT" },
  result: {
    probability: 0.9,
    details: { privateSamples: Array.from({ length: 1000 }, (_, i) => i) },
  },
  events: [],
};

// Read local ZIP records independently of the writer, including compressed data.
export function unzip(buffer: Buffer) {
  const files = new Map<string, string>();
  let pos = 0;
  while (buffer.readUInt32LE(pos) === 0x04034b50) {
    const size = buffer.readUInt32LE(pos + 18),
      nameSize = buffer.readUInt16LE(pos + 26),
      extra = buffer.readUInt16LE(pos + 28),
      method = buffer.readUInt16LE(pos + 8);
    const name = buffer
        .subarray(pos + 30, pos + 30 + nameSize)
        .toString("utf8"),
      start = pos + 30 + nameSize + extra,
      data = buffer.subarray(start, start + size);
    files.set(
      name,
      (method === 8 ? inflateRawSync(data) : data).toString("utf8"),
    );
    pos = start + size;
  }
  expect(buffer.readUInt32LE(pos)).toBe(0x02014b50);
  expect(buffer.readUInt32LE(buffer.length - 22)).toBe(0x06054b50);
  return files;
}

it.each(["succeeded", "failed"] as const)(
  "exports an offline %s bundle with relative links, complete record and verified hashes",
  (status) => {
    const source = structuredClone(run);
    source.status = status;
    if (status === "failed")
      source.error = { code: "FAILED", message: "未完成求解" };
    const before = JSON.stringify(source),
      bundle = reportPackage(source, { taskId: "task" }),
      files = unzip(bundle.buffer);
    const filename = `reliability-offline.${status === "succeeded" ? "results" : "diagnostics"}.json`;
    expect(JSON.parse(files.get(filename)!)).toEqual(source);
    for (const format of ["html", "md"]) {
      const document = files.get(`reliability-offline.${format}`)!;
      expect(document).toContain(filename);
      expect(document).toContain("无需平台服务或网络");
      expect(document).not.toContain("/api/");
      expect(document).not.toContain("FULL_INPUT");
      expect(document).not.toContain("privateSamples");
    }
    const manifest = JSON.parse(files.get("manifest.json")!);
    expect(manifest.inputHash).toBe(source.inputHash);
    expect(manifest.status).toBe(status);
    for (const entry of manifest.files) {
      expect(entry.bytes).toBe(Buffer.byteLength(files.get(entry.name)!));
      expect(entry.sha256).toBe(
        createHash("sha256").update(files.get(entry.name)!).digest("hex"),
      );
    }
    expect(JSON.stringify(source)).toBe(before);
  },
);

it("never embeds run IDs as ZIP paths", () => {
  const source = { ...run, id: "../../恶意<script>.json" };
  for (const name of unzip(reportPackage(source).buffer).keys())
    expect(name).not.toMatch(/[\\/]/);
});

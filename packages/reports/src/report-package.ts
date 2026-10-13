import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type { Run } from "../../contracts/src/types";
import { report, type ReportOptions } from "./render";
import { reportAttachment, validationSummary } from "./validation-summary";

export interface ReportFile {
  name: string;
  content: string;
}

// Standard ZIP32/DEFLATE, UTF-8 names. No runtime dependency or external archiver.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: ReportFile[]) {
  const local: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name),
      raw = Buffer.from(file.content),
      data = deflateRawSync(raw),
      crc = crc32(raw);
    if (
      raw.length > 0xffffffff ||
      data.length > 0xffffffff ||
      offset > 0xffffffff
    )
      throw new Error("报告包超出 ZIP32 大小限制");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}

/** All documents and the attachment use the same immutable Run. Manifest hashes exact exported bytes. */
export function reportPackage(
  run: Run,
  options: Pick<ReportOptions, "taskId"> = {},
) {
  const attachment = reportAttachment(run);
  const files: ReportFile[] = [
    ...(["html", "md"] as const).map((format) => ({
      name: `${attachment.stem}.${format}`,
      content: report(run, format, {
        ...options,
        attachmentHref: attachment.filename,
        offlinePackage: true,
      }),
    })),
    { name: attachment.filename, content: report(run, "json") },
    {
      name: "README.txt",
      content:
        "ReMAP 离线报告包\n请完整解压到同一目录，再打开 HTML 或 Markdown。JSON 附件是完整运行记录，包含输入/资产快照、原始计算结果、诊断和运行事件；失败运行不会被当作成功结果展示。无需运行平台或联网。\nmanifest.json 的 SHA-256 校验覆盖 HTML、Markdown、JSON 和本说明，不含清单自身。校验用于完整性核对，不是数字签名或产品认证。\n附件可能包含本地输入与数据资产，请按任务数据权限保存和分享。\n",
    },
  ];
  const manifest = {
    schemaVersion: "remap.report-package.v1",
    taskId: options.taskId,
    runId: run.id,
    status: run.status,
    inputHash: run.inputHash,
    validation: validationSummary(run, options.taskId),
    attachment: attachment.filename,
    files: files.map((f) => ({
      name: f.name,
      bytes: Buffer.byteLength(f.content),
      sha256: createHash("sha256").update(f.content).digest("hex"),
    })),
  };
  files.push({
    name: "manifest.json",
    content: JSON.stringify(manifest, null, 2),
  });
  return {
    filename: `${attachment.stem}.zip`,
    files,
    manifest,
    buffer: zip(files),
  };
}

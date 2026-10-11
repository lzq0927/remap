import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// Inspect the complete index (the proposed commit), never print matched credential values.
function git(...args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("Git inspection failed: " + args[0]);
  return result.stdout;
}
const blockedRoot =
  /^(?:data|artifacts|release|dist|node_modules|enterprise-adapters|\.local-runtime|\.venv|\.python-deps|test-results|playwright-report)\//;
function blockedPath(file) {
  const name = basename(file);
  return (
    blockedRoot.test(file) ||
    file === "系统可靠性工作计划.md" ||
    (/(?:^|\/)\.env(?:\.|$)/.test(file) && name !== ".env.example") ||
    /(?:^|\/)(?:auth|credentials|agent-credentials)\.json$/.test(file) ||
    /(?:\.sqlite|\.db)(?:-|$)|\.log$|\.local\./.test(file) ||
    file.startsWith(".opencode/skills/") ||
    /\.(?:pem|p12|pfx|key)$/.test(file)
  );
}
const secretPatterns = [
  /\b[0-9a-f]{32}\.[A-Za-z0-9]{16,}\b/i,
  /\b(?:ghp_|github_pat_|sk-proj-|sk-ant-)[A-Za-z0-9_-]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const findings = [];
function inspect(file, content, scope) {
  if (blockedPath(file))
    findings.push({ scope, file, reason: "excluded path" });
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (secretPatterns.some((pattern) => pattern.test(lines[i])))
      findings.push({ scope, file, line: i + 1, reason: "credential pattern" });
    const literals = lines[i].matchAll(
      /(?:api[_-]?key|password|secret|access[_-]?token)["']?\s*[:=]\s*["']([^"']{12,})["']/gi,
    );
    for (const match of literals) {
      if (
        !/\{env:|\$\{|example|synthetic|placeholder|test|redact|API_KEY|<|^\s*$/i.test(
          match[1],
        )
      )
        findings.push({
          scope,
          file,
          line: i + 1,
          reason: "literal credential candidate",
        });
      for (const match of lines[i].matchAll(
        /https?:\/\/[^\s/:"'<>]+:([^\s/"'<>]+)@([^\s/"'<>]+)/g,
      )) {
        // Interpolation is not a literal credential; this exact nonresolving test fixture is public.
        if (
          match[1].includes("${") ||
          (match[1] === "synthetic-secret" &&
            match[2].endsWith(".synthetic.invalid"))
        )
          continue;
        findings.push({ scope, file, line: i + 1, reason: "credential URL" });
      }
    }
  }
}
const files = git("ls-files", "--cached", "-z").split("\0").filter(Boolean);
for (const file of files) inspect(file, git("show", ":" + file), "index");

// Optionally check only this checkout's committed ancestry before publishing it.
if (process.argv.includes("--history")) {
  for (const entry of git("rev-list", "--objects", "HEAD").trim().split("\n")) {
    const split = entry.indexOf(" ");
    if (split < 0) continue;
    const oid = entry.slice(0, split),
      file = entry.slice(split + 1);
    if (git("cat-file", "-t", oid).trim() !== "blob") continue;
    inspect(file, git("cat-file", "blob", oid), "history");
  }
}
// Compare local known secrets without printing or transmitting them. The env file is not committed.
const localSecrets = new Set();
for (const filename of [".env", process.env.RELIABILITY_ENV_FILE].filter(
  Boolean,
)) {
  let content;
  try {
    content = readFileSync(filename, "utf8");
  } catch {
    continue;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(
      /^\s*([A-Z_]*(?:KEY|PASSWORD|TOKEN|SECRET))\s*=\s*(.*)\s*$/,
    );
    const value = match?.[2]?.replace(/^['"]|['"]$/g, "").trim();
    if (value && value.length >= 8) localSecrets.add(value);
  }
}
for (const file of files) {
  const content = git("show", ":" + file);
  if ([...localSecrets].some((secret) => content.includes(secret)))
    findings.push({ scope: "index", file, reason: "matches a local secret" });
}
console.log(
  JSON.stringify(
    {
      status: findings.length ? "failed" : "passed",
      indexFiles: files.length,
      historyChecked: process.argv.includes("--history"),
      findings,
    },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;

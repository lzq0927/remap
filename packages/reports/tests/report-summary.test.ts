import { expect, it } from "vitest";
import { report } from "../src/render";
import type { Run } from "../../contracts/src/types";
import { validationSummary } from "../src/validation-summary";

export const fixture = (): Run => ({
  id: "summary-test",
  operation: "ctmc",
  status: "succeeded",
  progress: 1,
  inputHash: "frozen-input-hash",
  createdAt: "2026-10-13T00:00:00Z",
  input: {
    cards: 10000,
    hours: 24,
    trials: 16,
    seed: 9,
    assetSnapshot: [
      {
        id: "mechanism",
        revision: 3,
        contentHash: "asset-hash",
        payload: { privateEvidence: "RAW_INPUT_SENTINEL" },
      },
    ],
    sourceSnapshot: {
      id: "source-file",
      contentHash: "source-hash",
      confirmedHash: "confirmed-hash",
      data: { rawEvidence: "RAW_SOURCE_SENTINEL" },
    },
  },
  result: {
    solver: "test-solver",
    modelVersion: "test-model.v1",
    stationary: [1],
    stationaryReward: 1,
    integratedReward: 24,
    transient: [],
    reviewChecks: [
      { name: "守恒", status: "passed", detail: "残差为零" },
      { name: "覆盖", status: "not-run", detail: "未执行" },
    ],
    diagnostics: { samples: ["RAW_RESULT_SENTINEL"] },
    config: { sourceCommit: "source-commit" },
  },
  events: [
    {
      runId: "summary-test",
      sequence: 1,
      stepId: "solve",
      type: "done",
      createdAt: "2026-10-13T00:00:01Z",
      payload: { raw: "RAW_EVENT_SENTINEL" },
    },
  ],
});

it.each(["html", "md"])(
  "keeps %s concise while preserving the complete JSON record",
  (format) => {
    const run = fixture(),
      before = JSON.stringify(run);
    const output = report(run, format);
    expect(output).toContain("验证与诊断摘要");
    for (const text of [
      "frozen-input-hash",
      "test-model.v1",
      "source-commit",
      "asset-hash",
      "confirmed-hash",
      "覆盖",
    ])
      expect(output).toContain(text);
    for (const text of [
      "RAW_INPUT_SENTINEL",
      "RAW_SOURCE_SENTINEL",
      "RAW_RESULT_SENTINEL",
      "RAW_EVENT_SENTINEL",
      "完整结果和诊断",
    ])
      expect(output).not.toContain(text);
    expect(output).toContain("reliability-summary-test.results.json");
    expect(JSON.parse(report(run, "json"))).toEqual(run);
    expect(JSON.stringify(run)).toBe(before);
  },
);

it("does not certify missing historical checks and distinguishes failed arithmetic from successful solving", () => {
  const run = fixture();
  delete run.result.reviewChecks;
  expect(validationSummary(run).outcome).toContain("未提供专门检查记录");
  run.result.reviewChecks = [
    { name: "守恒", status: "failed", detail: "残差过大" },
  ];
  const view = validationSummary(run);
  expect(view.outcome).toBe("检查未通过");
  expect(view.counts.failed).toBe(1);
  expect(report(run, "html")).toContain("稳态期望奖励");
  expect(report(run, "html")).not.toContain("失败诊断</h2>");
});

it("bounds summaries without truncating attachment diagnostics", () => {
  const run = fixture();
  run.result.warnings = Array.from(
    { length: 100 },
    (_, i) => `提醒${i}:` + "细节".repeat(1000),
  );
  const view = validationSummary(run);
  expect(view.anomalies).toHaveLength(6);
  expect(view.omittedAnomalies).toBe(95);
  expect(view.anomalies[1].detail.length).toBeLessThan(270);
  expect(JSON.parse(report(run, "json")).result.warnings).toEqual(
    run.result.warnings,
  );
});

it("keeps long failure payloads in JSON rather than the diagnostic body", () => {
  const run = fixture();
  run.status = "failed";
  run.error = {
    code: "FAILED",
    message: "错误说明".repeat(500) + "RAW_FAILURE_TAIL",
  };
  for (const format of ["html", "md"])
    expect(report(run, format)).not.toContain("RAW_FAILURE_TAIL");
  expect(JSON.parse(report(run, "json")).error).toEqual(run.error);
});

it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"])(
  "rejects executable attachment links %s",
  (href) => {
    const html = report(fixture(), "html", {
      attachmentHref: href,
      onlineAttachmentHref: href,
    });
    expect(html).not.toContain(`href="${href}`);
    expect(html).toContain('href="reliability-summary-test.results.json"');
  },
);

it.each(["html", "md"])(
  "separates failure diagnostics from successful results in %s",
  (format) => {
    const run = fixture();
    run.status = "failed";
    run.error = { code: "SOLVER_ERROR", message: "求解器异常" };
    const output = report(run, format);
    expect(output).toContain("失败诊断");
    expect(output).toContain("SOLVER_ERROR");
    expect(output).not.toContain("稳态期望奖励");
    expect(output).not.toContain("设计建议与可信度限制");
    expect(output).toContain("reliability-summary-test.diagnostics.json");
    expect(JSON.parse(report(run, "json"))).toEqual(run);
  },
);

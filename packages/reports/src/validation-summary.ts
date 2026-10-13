import type { Run } from "../../contracts/src/types";
import { runAssessmentModel } from "../../contracts/src/assessment-model";

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const brief = (value: unknown, limit = 240): string => {
  const text =
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : "未记录";
  return text.length > limit
    ? text.slice(0, limit) + "…（完整内容见 JSON）"
    : text;
};
const stateNames: Record<string, string> = {
  passed: "通过",
  failed: "未通过",
  "not-run": "未执行",
  warning: "提醒",
};
export { brief as diagnosticText };

/** A bounded view of frozen evidence; never infers validation from solver success. */
export function validationSummary(run: Run, taskId?: string) {
  const succeeded = run.status === "succeeded" && !!run.result;
  const result = succeeded ? run.result : undefined;
  const checks = list(result?.reviewChecks);
  const warnings = list(result?.warnings);
  const counts = {
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) => c.status === "failed").length,
    notRun: checks.filter((c) => c.status === "not-run").length,
    other: checks.filter(
      (c) => !["passed", "failed", "not-run"].includes(c.status),
    ).length,
    warnings: warnings.length,
  };
  const anomalies = [
    ...(run.error
      ? [
          {
            status: "运行异常",
            name: brief(run.error.code),
            detail: brief(run.error.message),
          },
        ]
      : []),
    ...checks
      .filter((c) => c.status !== "passed")
      .map((c) => ({
        status: stateNames[c.status] ?? "状态未识别",
        name: brief(c.name),
        detail: brief(c.detail),
      })),
    ...warnings.map((w) => ({
      status: "提醒",
      name: "模型限制",
      detail: brief(typeof w === "string" ? w : w?.message),
    })),
  ];
  const outcome = !succeeded
    ? run.status === "failed"
      ? "运行失败；无成功评估结果"
      : run.status === "cancelled"
        ? "已取消；无成功评估结果"
        : "尚未形成成功结果"
    : !checks.length
      ? "未提供专门检查记录；计算完成不等于验证通过"
      : counts.failed
        ? "检查未通过"
        : counts.other
          ? "存在未确认检查状态"
          : counts.notRun
            ? "已执行检查通过，部分检查未执行"
            : "已记录检查全部通过";
  const input = run.input ?? {},
    request = result?.request ?? input.base ?? input;
  const inputFields = [
    ["规模/卡", request.cards],
    ["窗口/h", request.hours],
    ["主采样", request.trials],
    ["种子", request.seed],
    ["目标", request.target],
    ["分配方法", request.method ?? request.allocation?.method],
    ["Shapley 采样", request.attributionTrials],
  ]
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `${name} ${brief(value, 80)}`);
  if (Array.isArray(request.mechanisms))
    inputFields.push(`机制 ${request.mechanisms.length} 项`);
  if (request.baseline)
    inputFields.push(
      `固定部署 ${list(request.baseline.mechanisms).length} 项；消除事件 ${list(request.baseline.resolvedEventIds).length} 项`,
    );
  const assets = list(input.assetSnapshot),
    source = input.sourceSnapshot;
  const trace = [
    taskId ? `任务 ${brief(taskId)}` : "",
    `运行 ${brief(run.id)}`,
    `输入哈希 ${brief(run.inputHash)}`,
    source
      ? `输入文件 ${brief(source.id)}；内容哈希 ${brief(source.contentHash)}；确认哈希 ${brief(source.confirmedHash)}`
      : "",
    assets.length
      ? `冻结资产 ${assets.length} 项：` +
        assets
          .slice(0, 4)
          .map(
            (a) =>
              `${brief(a.id, 80)}@${brief(a.revision, 20)} / ${brief(a.contentHash, 80)}`,
          )
          .join("；") +
        (assets.length > 4 ? "；其余见 JSON" : "")
      : "冻结资产：未记录",
    result?.workflowContext
      ? `流水线 ${brief(result.workflowContext.executionId)}；输入修订 ${brief(result.workflowContext.inputRevision)}；${result.workflowContext.reviewRequired ? "待人工审核" : "已记录交付确认"}`
      : "",
    `运行事件 ${list(run.events).length} 条；创建 ${brief(run.createdAt)}；完成 ${brief(run.completedAt)}`,
  ].filter(Boolean);
  return {
    outcome,
    counts,
    anomalies: anomalies.slice(0, 6),
    omittedAnomalies: Math.max(0, anomalies.length - 6),
    rows: [
      ["检查结论", outcome],
      [
        "检查数量",
        `通过 ${counts.passed}；未通过 ${counts.failed}；未执行 ${counts.notRun}；其他 ${counts.other}；提醒 ${counts.warnings}`,
      ],
      [
        "模型版本",
        brief(
          result?.modelVersion ??
            result?.version ??
            result?.solver ??
            input.modelVersion,
        ),
      ],
      ["来源版本", brief(result?.config?.sourceCommit)],
      ["指标", brief(result?.metricId ?? runAssessmentModel(run)?.metricId)],
      [
        "输入摘要",
        inputFields.join("；") ||
          `操作 ${brief(run.operation)}；顶层输入 ${Object.keys(input).length} 个字段，完整参数见 JSON`,
      ],
    ] as string[][],
    trace,
    note: "检查仅反映本次模型内数值与记账一致性，不代表产品实测认证或目标已达成。完整输入、样本、诊断与事件保留在运行记录及 JSON 附件中。",
  };
}

export function reportAttachment(run: Run) {
  const id = run.id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "run";
  const stem = `reliability-${id}`;
  const diagnostic = run.status !== "succeeded";
  return {
    stem,
    filename: `${stem}.${diagnostic ? "diagnostics" : "results"}.json`,
    label: diagnostic ? "完整失败/状态诊断 JSON" : "完整结构化结果 JSON",
  };
}

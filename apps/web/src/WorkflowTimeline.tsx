import { useEffect, useRef } from "react";
import { workflowSteps } from "./design-state";
export type WorkflowState = {
  taskId: string;
  executionId?: string;
  revision: number;
  inputRevision: number;
  status: string;
  stale: boolean;
  runId?: string;
  steps: {
    id: string;
    status: string;
    artifacts: any[];
    notes?: string;
    confirmedBy?: string;
  }[];
};
const labels: Record<string, string> = {
  pending: "未开始",
  "waiting-input": "等待前序确认",
  ready: "可核对",
  running: "计算中",
  "awaiting-review": "待人工确认",
  confirmed: "已确认",
  failed: "失败",
  cancelled: "已取消",
};
export default function WorkflowTimeline({
  state,
  stage,
  onSelect,
  onCancel,
}: {
  state?: WorkflowState;
  stage: number;
  onSelect: (stage: number) => void;
  onCancel: () => void;
}) {
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = navigation.current;
    const main = element?.closest("main");
    if (!element || !main) return;
    const update = () =>
      main.style.setProperty(
        "--workflow-navigation-height",
        `${element.getBoundingClientRect().height + 16}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      main.style.removeProperty("--workflow-navigation-height");
    };
  }, []);
  return (
    <>
      <nav
        className="workflow-navigation"
        aria-label="六阶段评估流程"
        ref={navigation}
      >
        <div className="steps">
          {workflowSteps.map((step, i) => {
            const current = state?.steps.find((s) => s.id === step.id);
            return (
              <button
                key={step.id}
                className={
                  stage === i
                    ? "active"
                    : current?.status === "confirmed" && !state?.stale
                      ? "complete"
                      : ""
                }
                aria-current={stage === i ? "step" : undefined}
                onClick={() => onSelect(i)}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                {step.name}
                <small>
                  {state?.stale
                    ? "输入已变更"
                    : (labels[current?.status ?? "pending"] ?? current?.status)}
                </small>
                {!!current?.artifacts?.length && (
                  <small>{current.artifacts.length} 项资产 · 查看</small>
                )}
              </button>
            );
          })}
        </div>
      </nav>
      {state?.executionId && (
        <div className="workflow-status">
          执行 {state.executionId.slice(0, 8)} · 输入版本 {state.inputRevision}{" "}
          ·{" "}
          {state.stale
            ? "需重新确认"
            : state.status === "active"
              ? "进行中"
              : state.status === "succeeded"
                ? "已交付"
                : state.status}
          <button disabled={state.status !== "active"} onClick={onCancel}>
            取消当前流程
          </button>
        </div>
      )}
      {!!state?.steps[stage]?.artifacts?.length && (
        <div className="workflow-artifacts" aria-label="本阶段过程产物">
          <h3>本阶段过程产物</h3>
          {state.steps[stage].notes && <p>{state.steps[stage].notes}</p>}
          {state.steps[stage].artifacts.map((artifact, index) => (
            <details key={index}>
              <summary>
                {artifact.title ??
                  artifact.name ??
                  (
                    {
                      design: "设计快照",
                      evaluation: "评估结果",
                      brief: "目标说明",
                      architecture: "系统结构",
                      "task-brief": "评估任务书",
                      "method-plan": "方法选择依据",
                      "parameter-table": "参数与证据",
                    } as Record<string, string>
                  )[artifact.type] ??
                  artifact.type ??
                  "过程产物"}
              </summary>
              {(artifact.runId ?? artifact.data?.runId) && (
                <p>运行编号：{artifact.runId ?? artifact.data.runId}</p>
              )}
              <pre>{JSON.stringify(artifact.data ?? artifact, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

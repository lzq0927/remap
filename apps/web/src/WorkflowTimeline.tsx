import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Info, X } from "lucide-react";
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
  "waiting-input": "待前序确认",
  ready: "可核对",
  running: "计算中",
  "awaiting-review": "待人工确认",
  confirmed: "已确认",
  failed: "失败",
  cancelled: "已取消",
};
const artifactNames: Record<string, string> = {
  design: "设计快照",
  evaluation: "评估结果",
  brief: "目标说明",
  architecture: "系统结构",
  "task-brief": "评估任务书",
  "method-plan": "方法选择依据",
  "parameter-table": "参数与证据",
};
function revealCurrentStep(row: HTMLDivElement | null) {
  const button = row?.querySelector<HTMLElement>('[aria-current="step"]');
  if (!row || !button) return;
  const box = button.getBoundingClientRect(),
    frame = row.getBoundingClientRect();
  if (box.left < frame.left || box.right > frame.right)
    row.scrollLeft += box.left - frame.left - (frame.width - box.width) / 2;
}
export default function WorkflowTimeline({
  state,
  steps = workflowSteps,
  stage,
  onSelect,
  onCancel,
  onConfirm,
  pending = false,
  error,
}: {
  state?: WorkflowState;
  steps?: typeof workflowSteps;
  stage: number;
  onSelect: (stage: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  error?: string;
}) {
  const dock = useRef<HTMLDivElement>(null),
    rail = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const [showDetails, setShowDetails] = useState(false);
  const current = state?.steps[stage];
  const confirmed = !state?.stale && current?.status === "confirmed";
  const complete = state?.status === "succeeded" && !state.stale;
  useEffect(() => {
    const element = dock.current,
      main = element?.closest("main");
    if (!element || !main) return;
    const update = () => {
      main.style.setProperty(
        "--workflow-navigation-height",
        `${element.getBoundingClientRect().height + 16}px`,
      );
      revealCurrentStep(rail.current);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      main.style.removeProperty("--workflow-navigation-height");
    };
  }, []);
  useEffect(() => {
    revealCurrentStep(rail.current);
  }, [stage]);
  useEffect(() => {
    if (showDetails) dialog.current?.showModal();
    else dialog.current?.close();
  }, [showDetails]);
  return (
    <>
      <div className="workflow-dock" ref={dock}>
        <nav className="workflow-navigation" aria-label="六阶段评估流程">
          <div className="workflow-steps" ref={rail}>
            {steps.map((step, i) => {
              const status = state?.steps[i]?.status ?? "pending",
                done = status === "confirmed" && !state?.stale;
              const label = state?.stale
                ? "需重新确认"
                : (labels[status] ?? status);
              return (
                <div className="workflow-step" key={step.id}>
                  <button
                    className={stage === i ? "active" : done ? "complete" : ""}
                    aria-current={stage === i ? "step" : undefined}
                    onClick={() => onSelect(i)}
                    disabled={pending}
                    title={`${i + 1}. ${step.name} · ${label}`}
                  >
                    <span className="step-number" aria-hidden="true">
                      {done ? <Check size={13} /> : i + 1}
                    </span>
                    <span className="step-label">
                      <strong>{step.name}</strong>
                      <small>{label}</small>
                    </span>
                  </button>
                  {i < steps.length - 1 && (
                    <ChevronRight
                      className="step-connector"
                      size={15}
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </nav>
        <section className="workflow-controls" aria-label="当前流程阶段">
          <div className="workflow-current">
            <span>
              第 {stage + 1} / {steps.length} 步
            </span>
            <h2>{steps[stage].name}</h2>
            <p
              className={
                current?.status === "awaiting-review"
                  ? "workflow-review-note"
                  : undefined
              }
              title={
                current?.status === "awaiting-review"
                  ? current.notes
                  : steps[stage].hint
              }
            >
              {current?.status === "awaiting-review" && current.notes
                ? current.notes
                : steps[stage].hint}
            </p>
          </div>
          <div className="workflow-buttons">
            <button
              className="workflow-info"
              aria-label="步骤说明与记录"
              onClick={() => setShowDetails(true)}
              title="步骤说明、输入版本与过程产物"
            >
              <Info size={16} />
            </button>
            <button
              disabled={stage === 0 || pending}
              onClick={() => onSelect(stage - 1)}
            >
              <ChevronLeft size={14} />
              上一步
            </button>
            <button
              className="primary"
              disabled={pending || (complete && stage === steps.length - 1)}
              onClick={
                confirmed && stage < steps.length - 1
                  ? () => onSelect(stage + 1)
                  : onConfirm
              }
            >
              {pending
                ? "正在保存…"
                : complete && stage === steps.length - 1
                  ? "本流程已交付"
                  : confirmed && stage < steps.length - 1
                    ? "下一步"
                    : stage === steps.length - 1
                      ? "记录交付确认"
                      : "确认并进入下一步"}
              {stage < steps.length - 1 && <ChevronRight size={14} />}
            </button>
          </div>
        </section>
        {error && <p className="workflow-inline-error">{error}</p>}
      </div>
      <dialog
        className="workflow-dialog"
        ref={dialog}
        onClose={() => setShowDetails(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowDetails(false);
        }}
        aria-labelledby="workflow-details-title"
      >
        <div className="workflow-dialog-head">
          <h2 id="workflow-details-title">{steps[stage].name} · 说明与记录</h2>
          <button
            aria-label="关闭步骤说明"
            autoFocus
            onClick={() => setShowDetails(false)}
          >
            <X size={18} />
          </button>
        </div>
        <p>{steps[stage].hint}</p>
        <p className="note">
          点击步骤可浏览内容；浏览或返回已确认步骤不会重复签认。修改输入后需从目标重新确认。
        </p>
        {state?.executionId ? (
          <div className="workflow-status">
            输入版本 {state.inputRevision} ·{" "}
            {state.stale
              ? "需重新确认"
              : complete
                ? "已交付"
                : state.status === "active"
                  ? "进行中"
                  : state.status}
            <small>执行 {state.executionId}</small>
            <button
              disabled={state.status !== "active" || pending}
              onClick={() => {
                onCancel();
                setShowDetails(false);
              }}
            >
              取消当前流程
            </button>
          </div>
        ) : (
          <p className="note">尚未开始正式确认；可以先填写参数并试算。</p>
        )}
        <section className="workflow-artifacts" aria-label="本阶段过程产物">
          <h3>本阶段过程产物 · {current?.artifacts.length ?? 0} 项</h3>
          {showDetails && current?.notes && <p>{current.notes}</p>}
          {current?.artifacts.map((artifact, index) => (
            <details key={index}>
              <summary>
                {artifact.title ??
                  artifact.name ??
                  artifactNames[artifact.type] ??
                  artifact.type ??
                  "过程产物"}
              </summary>
              {(artifact.runId ?? artifact.data?.runId) && (
                <p>运行编号：{artifact.runId ?? artifact.data.runId}</p>
              )}
              <pre>{JSON.stringify(artifact.data ?? artifact, null, 2)}</pre>
            </details>
          ))}
          {!current?.artifacts.length && (
            <p className="note">
              确认本阶段后会保存输入快照；Agent 提交的产物也在这里核对。
            </p>
          )}
        </section>
      </dialog>
    </>
  );
}

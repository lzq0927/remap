import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Store } from "../../assets/src/store";
import { DomainError } from "../../contracts/src/errors";
import { changedAuditStage } from "./design-changes";

export const steps = [
  "clarify",
  "describe",
  "select",
  "prepare",
  "evaluate",
  "validate-deliver",
] as const;
type StepStatus =
  | "waiting-input"
  | "ready"
  | "running"
  | "awaiting-review"
  | "confirmed"
  | "completed"
  | "failed"
  | "cancelled";
export interface WorkflowState {
  taskId: string;
  workflowId: string;
  executionId: string;
  revision: number;
  inputRevision: number;
  mode: string;
  status: "idle" | "active" | "succeeded" | "cancelled";
  stale?: boolean;
  changedFrom?: number;
  resumedFrom?: {
    executionId: string;
    inputRevision: number;
    confirmedSteps: number;
  };
  steps: {
    id: string;
    status: StepStatus;
    artifacts: any[];
    notes: string;
    confirmedBy?: string;
    updatedAt?: string;
  }[];
  runId?: string;
}
export interface WorkflowEvent {
  eventId: string;
  sequence: number;
  taskId: string;
  workflowId: string;
  executionId: string;
  stepId?: string;
  actor: string;
  inputRevision: number;
  type: string;
  createdAt: string;
  state: WorkflowState;
}
export function stageFinished(state: WorkflowState, step: { status: string }) {
  return (
    step.status === "confirmed" ||
    (state.mode === "auto-to-review" && step.status === "completed")
  );
}

/** Domain state is persisted independently of a vendor's chat/event format. */
export class WorkflowService extends EventEmitter {
  constructor(
    public taskId: string,
    public store: Store,
  ) {
    super();
  }
  private inputRevision() {
    return (
      this.store
        .documents("design")
        .sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0))
        .at(-1)?.revision ?? 0
    );
  }
  get(): WorkflowState {
    const current = this.store.documents("workflow-state").at(-1);
    const state: WorkflowState = current ?? {
      taskId: this.taskId,
      workflowId: this.taskId,
      executionId: "",
      revision: 0,
      inputRevision: this.inputRevision(),
      mode: "manual",
      status: "idle",
      steps: steps.map((id, index) => ({
        id,
        status: index === 0 ? "ready" : "waiting-input",
        artifacts: [],
        notes: "",
      })),
    };
    const stale = state.inputRevision !== this.inputRevision();
    return {
      ...state,
      stale,
      changedFrom: stale ? this.changedFrom(state) : undefined,
    };
  }
  private changedFrom(state: WorkflowState) {
    const designs = this.store.documents("design");
    return changedAuditStage(
      designs.find((d) => d.revision === state.inputRevision),
      designs.at(-1),
    );
  }
  events(after = 0): WorkflowEvent[] {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new DomainError("SCHEMA_INVALID", "事件序号必须为非负整数");
    return this.store
      .documents("workflow-event")
      .filter((e) => e.sequence > after)
      .sort((a, b) => a.sequence - b.sequence);
  }
  start(
    input: { inputRevision: number; mode?: string; resume?: boolean },
    actor = "user",
  ) {
    if (input.inputRevision !== this.inputRevision())
      throw new DomainError(
        "INPUT_REVISION_CONFLICT",
        "设计已改变，请重新读取任务",
        409,
      );
    const mode = input.mode ?? "assisted";
    if (!["manual", "assisted", "auto-to-review"].includes(mode))
      throw new DomainError("SCHEMA_INVALID", "未知执行模式");
    const previous = this.get();
    let retained = 0;
    if (input.resume && actor === "user" && mode === "manual") {
      const changed = this.changedFrom(previous);
      while (
        retained < Math.min(changed, 4) &&
        previous.steps[retained]?.status === "confirmed" &&
        previous.steps[retained]?.confirmedBy === "user"
      )
        retained++;
    }
    const state: WorkflowState = {
      taskId: this.taskId,
      workflowId: this.taskId,
      executionId: randomUUID(),
      revision: previous.revision + 1,
      inputRevision: input.inputRevision,
      mode,
      status: "active",
      resumedFrom: retained
        ? {
            executionId: previous.executionId,
            inputRevision: previous.inputRevision,
            confirmedSteps: retained,
          }
        : undefined,
      steps: steps.map((id, index) =>
        index < retained
          ? structuredClone(previous.steps[index])
          : {
              id,
              status: index === retained ? "ready" : "waiting-input",
              artifacts: [],
              notes: "",
            },
      ),
    };
    return this.persist(state, "workflow.started", actor);
  }
  record(
    input: {
      executionId: string;
      expectedRevision: number;
      inputRevision: number;
      stepId: string;
      status: string;
      artifacts?: any[];
      notes?: string;
    },
    actor: "user" | "agent",
  ) {
    const state = this.get();
    if (!state.executionId || input.executionId !== state.executionId)
      throw new DomainError(
        "EXECUTION_CONFLICT",
        "执行已改变，请读取当前流程",
        409,
      );
    if (state.status === "cancelled")
      throw new DomainError(
        "WORKFLOW_CANCELLED",
        "流程已取消，请启动新的执行",
        409,
      );
    if (state.status === "succeeded")
      throw new DomainError(
        "WORKFLOW_FINISHED",
        "流程已交付，请启动新的执行",
        409,
      );
    if (input.expectedRevision !== state.revision)
      throw new DomainError(
        "REVISION_CONFLICT",
        "阶段状态已改变，请重新读取",
        409,
      );
    if (input.inputRevision !== state.inputRevision || state.stale)
      throw new DomainError(
        "INPUT_REVISION_CONFLICT",
        "设计已改变，请继续当前版本并复核受影响的阶段",
        409,
      );
    const index = steps.findIndex((id) => id === input.stepId);
    if (
      index < 0 ||
      ![
        "running",
        "awaiting-review",
        "confirmed",
        "completed",
        "failed",
      ].includes(input.status)
    )
      throw new DomainError("SCHEMA_INVALID", "未知阶段或状态");
    if (
      input.status === "completed" &&
      (state.mode !== "auto-to-review" || index === 5)
    )
      throw new DomainError(
        "WORKFLOW_ORDER",
        "自动完成只适用于自动模式的前五个阶段；交付需要审核",
        409,
      );
    if (input.status === "confirmed" && actor !== "user")
      throw new DomainError(
        "USER_CONFIRMATION_REQUIRED",
        "关键事实需要用户确认",
        403,
      );
    if (state.steps.slice(0, index).some((step) => !stageFinished(state, step)))
      throw new DomainError("WORKFLOW_ORDER", "请先确认前序阶段", 409);
    const item = state.steps[index];
    if (
      item.status === "confirmed" ||
      (item.status === "completed" && input.status !== "confirmed")
    )
      throw new DomainError(
        "WORKFLOW_ORDER",
        "已确认阶段不可覆盖，请开始新的执行",
        409,
      );
    if (
      input.artifacts !== undefined &&
      (!Array.isArray(input.artifacts) ||
        JSON.stringify(input.artifacts).length > 500000)
    )
      throw new DomainError("SCHEMA_INVALID", "阶段产物须为有限大小的数组");
    if (
      input.notes !== undefined &&
      (typeof input.notes !== "string" || input.notes.length > 10000)
    )
      throw new DomainError("SCHEMA_INVALID", "阶段说明过长或格式错误");
    item.status = input.status as StepStatus;
    item.artifacts = input.artifacts ?? item.artifacts;
    item.notes = input.notes ?? item.notes;
    item.updatedAt = new Date().toISOString();
    if (stageFinished(state, item)) {
      if (item.status === "confirmed") item.confirmedBy = actor;
      if (index + 1 < state.steps.length)
        state.steps[index + 1].status = "ready";
      else state.status = "succeeded";
    }
    state.revision++;
    return this.persist(state, "step." + item.status, actor, item.id);
  }
  cancel(executionId: string, actor: string) {
    const state = this.get();
    if (state.executionId !== executionId)
      throw new DomainError("EXECUTION_CONFLICT", "不是当前执行", 409);
    if (state.status !== "active") return state;
    state.status = "cancelled";
    for (const item of state.steps)
      if (!stageFinished(state, item)) item.status = "cancelled";
    state.revision++;
    return this.persist(state, "workflow.cancelled", actor);
  }
  /** Solver events update progress, never assert a human-approved conclusion. */
  attachRun(runId: string, executionId: string, inputRevision: number) {
    const state = this.get();
    if (
      state.executionId !== executionId ||
      state.inputRevision !== inputRevision ||
      state.stale ||
      state.status !== "active"
    )
      throw new DomainError("INPUT_REVISION_CONFLICT", "运行对应过期流程", 409);
    if (state.steps.slice(0, 4).some((s) => !stageFinished(state, s)))
      throw new DomainError("WORKFLOW_ORDER", "请先确认参数阶段", 409);
    this.store.getRun(runId);
    state.runId = runId;
    state.steps[4].status = "running";
    state.revision++;
    return this.persist(state, "run.attached", "solver", "evaluate");
  }
  runEvent(runId: string, status: string) {
    const state = this.get();
    if (
      state.runId !== runId ||
      state.stale ||
      state.status !== "active" ||
      state.steps[4].status !== "running"
    )
      return;
    if (!["succeeded", "failed", "cancelled"].includes(status)) return;
    state.steps[4].status =
      status === "succeeded"
        ? "awaiting-review"
        : status === "failed"
          ? "failed"
          : "cancelled";
    state.steps[4].artifacts = [{ type: "evaluation", runId }];
    state.revision++;
    return this.persist(state, "run." + status, "solver", "evaluate");
  }
  private persist(
    state: WorkflowState,
    type: string,
    actor: string,
    stepId?: string,
  ) {
    const stored = { ...state, stale: false };
    this.store.putDocument("workflow-state", stored, "workflow.current");
    const sequence = (this.events().at(-1)?.sequence ?? 0) + 1;
    const event: WorkflowEvent = {
      eventId: randomUUID(),
      sequence,
      taskId: this.taskId,
      workflowId: state.workflowId,
      executionId: state.executionId,
      stepId,
      actor,
      inputRevision: state.inputRevision,
      type,
      createdAt: new Date().toISOString(),
      state: structuredClone(stored),
    };
    this.store.putDocument("workflow-event", event, event.eventId);
    this.emit("event", event);
    return structuredClone(stored);
  }
}

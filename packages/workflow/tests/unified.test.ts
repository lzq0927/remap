import { afterEach, expect, test } from "vitest";
import { Store } from "../../assets/src/store";
import { WorkflowService } from "../src/service";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  store.putDocument("design", { request: { cards: 10000 }, revision: 1 });
  return { store, flow: new WorkflowService("task-a", store) };
}
test("Agent output awaits human confirmation and cannot impersonate it", () => {
  const { flow } = fixture();
  const started = flow.start({ inputRevision: 1, mode: "assisted" });
  const saved = flow.record({ executionId: started.executionId, expectedRevision: started.revision,
    inputRevision: 1, stepId: "clarify", status: "awaiting-review", artifacts: [{ type: "task-brief", data: { target: .99 } }] }, "agent");
  expect(saved.steps[0].status).toBe("awaiting-review");
  expect(() => flow.record({ executionId: saved.executionId, expectedRevision: saved.revision, inputRevision: 1, stepId: "clarify", status: "confirmed" }, "agent")).toThrow(/USER_CONFIRMATION_REQUIRED/);
  const confirmed = flow.record({ executionId: saved.executionId, expectedRevision: saved.revision, inputRevision: 1, stepId: "clarify", status: "confirmed" }, "user");
  expect(confirmed.steps[0].confirmedBy).toBe("user");
  expect(confirmed.steps[1].status).toBe("ready");
});
test("stale revisions, stale inputs and out of order stages are rejected", () => {
  const { flow, store } = fixture();
  const started = flow.start({ inputRevision: 1 });
  const args = { executionId: started.executionId, expectedRevision: started.revision, inputRevision: 1, stepId: "clarify", status: "running" };
  flow.record(args, "agent");
  expect(() => flow.record(args, "agent")).toThrow(/REVISION_CONFLICT/);
  const state = flow.get();
  expect(() => flow.record({ ...args, expectedRevision: state.revision, stepId: "evaluate" }, "agent")).toThrow(/WORKFLOW_ORDER/);
  store.putDocument("design", { request: { cards: 20000 }, revision: 2 });
  expect(() => flow.record({ ...args, expectedRevision: state.revision }, "agent")).toThrow(/INPUT_REVISION_CONFLICT/);
  expect(flow.get().stale).toBe(true);
});
test("events survive service recreation and only current execution can mutate state", () => {
  const { flow, store } = fixture();
  const first = flow.start({ inputRevision: 1 });
  flow.record({ executionId: first.executionId, expectedRevision: first.revision, inputRevision: 1, stepId: "clarify", status: "awaiting-review" }, "agent");
  const recreated = new WorkflowService("task-a", store);
  expect(recreated.events(0)).toHaveLength(2);
  expect(recreated.events(1)).toHaveLength(1);
  const next = recreated.start({ inputRevision: 1 });
  expect(() => recreated.record({ executionId: first.executionId, expectedRevision: next.revision, inputRevision: 1, stepId: "clarify", status: "running" }, "agent")).toThrow(/EXECUTION_CONFLICT/);
  expect(recreated.events(0).map((e) => e.sequence)).toEqual([1,2,3]);
});
test("cancelled flows preserve artifacts and reject further execution", () => {
  const { flow } = fixture();
  const state = flow.start({ inputRevision: 1 });
  flow.cancel(state.executionId, "user");
  expect(flow.get().status).toBe("cancelled");
  expect(() => flow.record({ executionId: state.executionId, expectedRevision: flow.get().revision, inputRevision: 1, stepId: "clarify", status: "running" }, "agent")).toThrow(/WORKFLOW_CANCELLED/);
});

import { test, expect } from "vitest";
import { Store } from "../../assets/src/store";
import { RunService } from "../src/runs";
test("duplicate keys reuse a run and cancellation cannot become success", async () => {
  const db = new Store(":memory:");
  const jobs = new RunService(db, { autoStart: false });
  const first = jobs.start("training", { cards: 10000 }, "same");
  const next = jobs.start("training", { cards: 10000 }, "same");
  expect(next.id).toBe(first.id);
  jobs.cancel(first.id);
  expect(jobs.get(first.id).status).toBe("cancelled");
  jobs.complete(first.id, { value: 1 });
  expect(jobs.get(first.id).status).toBe("cancelled");
  jobs.close();
  db.close();
});
test("restart marks interrupted running experiments explicitly failed", () => {
  const db = new Store(":memory:");
  db.saveRun({
    id: "interrupted",
    status: "running",
    operation: "training",
    input: {},
    inputHash: "h",
    createdAt: "today",
    events: [],
    progress: 0,
  });
  const jobs = new RunService(db, { autoStart: false });
  expect(jobs.get("interrupted").error?.code).toBe("SERVICE_INTERRUPTED");
  jobs.close();
  db.close();
});

import { test, expect } from "vitest";
import { Store } from "../../assets/src/store";
import { RunService } from "../src/runs";
test("restart covers interrupted runs older than the history listing limit", () => {
  const db = new Store(":memory:");
  for (let i = 0; i < 105; i++)
    db.saveRun({
      id: String(i),
      status: i === 0 ? "running" : "succeeded",
      operation: "training",
      input: {},
      inputHash: "x",
      createdAt: "now",
      progress: 0,
      events: [],
    });
  const jobs = new RunService(db, { autoStart: false });
  expect(db.getRun("0").error?.code).toBe("SERVICE_INTERRUPTED");
  jobs.close();
  db.close();
});

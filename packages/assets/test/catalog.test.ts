import { test, expect } from "vitest";
import { Store } from "../src/store";
test("published assets are immutable and a revision preserves old experiment inputs", () => {
  const db = new Store(":memory:");
  const first = db.create("mechanism", "自动恢复", { recoverySeconds: 180 });
  db.transition(first.id, 1, "validated");
  db.transition(first.id, 1, "published");
  expect(() => db.update(first.id, 1, "changed", {})).toThrow(
    "REVISION_CONFLICT",
  );
  const next = db.fork(first.id, 1);
  db.update(next.id, next.revision, next.name, { recoverySeconds: 120 });
  expect(db.get(first.id, 1).payload.recoverySeconds).toBe(180);
  expect(db.get(first.id, 2).payload.recoverySeconds).toBe(120);
  db.transition(first.id, 1, "deprecated");
  expect(db.get(first.id, 1).payload.recoverySeconds).toBe(180);
  db.close();
});
test("content hashing is canonical and dangling asset references block publication", () => {
  const db = new Store(":memory:");
  const a = db.create("parameter-evidence", "a", { b: 1, a: 2 });
  const b = db.create("parameter-evidence", "b", { a: 2, b: 1 });
  expect(a.contentHash).toBe(b.contentHash);
  const dangling = db.create("mechanism", "dangling", {
    refs: [{ id: "absent", revision: 1, contentHash: "x" }],
  });
  expect(() => db.transition(dangling.id, 1, "validated")).toThrow(
    "REFERENCE_MISSING",
  );
  db.close();
});

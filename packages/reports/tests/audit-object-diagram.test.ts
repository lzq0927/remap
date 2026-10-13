import { expect, it } from "vitest";
import {
  auditObjectComparison,
  auditObjectDiagram,
} from "../src/audit-object-diagram";
const events = [
  {
    id: "CORE-hard",
    domain: "<script>alert(1)</script>",
    type: "hard",
    fit: 90,
  },
  { id: "CORE-sdc", domain: "Core", type: "sdc", fit: 10 },
  { id: "SSD-hard", domain: "SSD", type: "hard", fit: 20 },
];
const left = {
  perEvent: {
    "CORE-hard": { downtime: 5, rollback: 2 },
    "CORE-sdc": { terminalInvalid: 4 },
    "SSD-hard": { localLoss: 1 },
  },
  ledger: { save: 20 },
};
const right = {
  perEvent: {
    "CORE-hard": { downtime: 1, rollback: 1 },
    "CORE-sdc": { terminalInvalid: 2 },
    "SSD-hard": { localLoss: 0.5 },
  },
  ledger: { save: 22 },
};
it("uses frozen exclusive event losses while keeping source FIT unchanged by mechanisms", () => {
  const before = JSON.stringify({ events, left, right });
  const compared = auditObjectComparison(events, left, right);
  expect(
    compared.map((o) => [o.leftFit, o.rightFit, o.leftLoss, o.rightLoss]),
  ).toEqual([
    [100, 100, 11, 4],
    [20, 20, 1, 0.5],
  ]);
  const svg = auditObjectDiagram(events, left, right);
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).toContain("损失 11 → 4 h");
  expect(svg).toContain("源 FIT：100");
  expect(
    auditObjectDiagram([
      { ...events[0], fit: "<script>alert(1)</script>" as any },
    ]),
  ).not.toContain("<script>");
  expect(JSON.stringify({ events, left, right })).toBe(before);
});
it("shows only explicit hardware FIT changes and never invents an uncalculated benefit", () => {
  const candidate = events.map((e) => ({ ...e, fit: e.fit / 2 }));
  expect(
    auditObjectComparison(events, left, right, events, candidate)[0].rightFit,
  ).toBe(50);
  const preview = auditObjectDiagram(
    events,
    undefined,
    undefined,
    events,
    candidate,
    ["CORE-hard"],
  );
  expect(preview).toContain("源 FIT：100 → 50");
  expect(preview).toContain("所选措施有覆盖 · 收益待计算");
  expect(preview).not.toContain("损失 0");
});

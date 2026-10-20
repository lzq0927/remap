import { expect, it } from "vitest";
import {
  auditHardwareItems,
  auditSubmodelPlan,
  hardwareTargetOverrides,
  type AuditSubmodelAllocation,
} from "../src/audit-allocation";
import { getAuditDefaults, getAuditEvents, resolveAudit } from "../src/audit";
import { auditObjects } from "../../contracts/src/audit-objects";

const events = [
  { id: "A-hard", domain: "A", type: "hard", fit: 90 },
  { id: "A-slow", domain: "A", type: "slow", fit: 10 },
  { id: "B-hard", domain: "B", type: "hard", fit: 270 },
  { id: "B-sdc", domain: "B", type: "sdc", fit: 30 },
];
const input = (): AuditSubmodelAllocation => ({
  method: "arinc",
  metricId: "task-reliability",
  target: Math.exp(-0.02),
  hours: 10,
  source: "event-catalog",
  cards: 10000,
  items: auditHardwareItems(events, 10000),
});
it("converts fleet task-rate targets back to per-NPU FIT and keeps each object's fault proportions", () => {
  const plan = auditSubmodelPlan(input())!;
  expect(plan.rateBasis).toBe("npu-equivalent-hour");
  expect(plan.objectFitTargets[0].items.map((i) => i.fit)).toEqual([
    expect.closeTo(50, 9),
    expect.closeTo(150, 9),
  ]);
  expect(hardwareTargetOverrides(input(), events).map((e) => e.fit)).toEqual([
    expect.closeTo(45, 9),
    expect.closeTo(5, 9),
    expect.closeTo(135, 9),
    expect.closeTo(15, 9),
  ]);
  expect(events.map((e) => e.fit)).toEqual([90, 10, 270, 30]);
  expect(
    hardwareTargetOverrides({ ...input(), target: 0.5 }, events).map(
      (e) => e.fit,
    ),
  ).toEqual([90, 10, 270, 30]);
});
it("requires explicit repair times for availability-to-FIT, and recomposes AGREE with importance", () => {
  const config: AuditSubmodelAllocation = {
    ...input(),
    method: "availability",
    metricId: "steady-state-availability",
    target: 0.99,
  };
  expect(hardwareTargetOverrides.bind(null, config, events)).toThrow(
    "平均修复时间",
  );
  config.recoveryHours = { A: 0.5, B: 2 };
  const plan = auditSubmodelPlan(config)!;
  const targets = plan.objectFitTargets[0].items;
  for (const target of targets) {
    const Ai =
      1 / (1 + ((target.fit! * 10000) / 1e9) * config.recoveryHours[target.id]);
    expect(Ai).toBeCloseTo(
      plan.selected.items.find((i) => i.id === target.id)!.target,
      12,
    );
  }
  const agree = auditSubmodelPlan({
    ...input(),
    method: "agree",
    items: input().items.map((item, index) => ({
      ...item,
      complexity: index ? 3 : 1,
      importance: index ? 1 : 2,
    })),
  })!.selected;
  expect(agree.items[0].target ** 2 * agree.items[1].target).toBeCloseTo(
    input().target,
    12,
  );
  expect(agree.items[0].target * agree.items[1].target).not.toBeCloseTo(
    input().target,
    6,
  );
});
it("returns reference FIT targets so inventory scaling is applied only once", () => {
  const effectiveEvents = events.map((event) => ({
    ...event,
    fit: event.fit * 0.2,
    rateMultiplier: 0.2,
  }));
  const allocation = {
    ...input(),
    target: Math.exp(-0.004),
    items: auditHardwareItems(effectiveEvents, 10000),
  };
  const overrides = hardwareTargetOverrides(allocation, effectiveEvents);
  expect(overrides.map((event) => event.fit)).toEqual([
    expect.closeTo(45, 9),
    expect.closeTo(5, 9),
    expect.closeTo(135, 9),
    expect.closeTo(15, 9),
  ]);
  const actualRate =
    (overrides.reduce((sum, event) => sum + event.fit * 0.2, 0) * 10000) / 1e9;
  expect(Math.exp(-actualRate * allocation.hours)).toBeCloseTo(
    allocation.target,
    12,
  );
});
it("uses the current catalogue, including explicit updates, instead of redistributing internal hard FIT by external ratios", () => {
  const catalog = getAuditEvents(),
    objects = auditObjects(catalog);
  expect(objects).toHaveLength(18);
  const total = catalog.reduce((sum, event) => sum + event.fit, 0);
  for (const [type, fraction] of Object.entries({
    hard: 0.966,
    slow: 0.02,
    sdc: 0.014,
  }))
    expect(
      catalog.filter((e) => e.type === type).reduce((s, e) => s + e.fit, 0) /
        total,
    ).toBeCloseTo(fraction, 12);
  const defaults = {
    ...getAuditDefaults(),
    cards: 10000,
    target: getAuditDefaults().targets[10000],
  };
  const submodelAllocation = {
    ...input(),
    items: auditHardwareItems(catalog, 10000),
  };
  expect(() => resolveAudit({ ...defaults, submodelAllocation })).not.toThrow();
  expect(() =>
    resolveAudit({
      ...defaults,
      submodelAllocation,
      eventOverrides: [
        {
          id: "CORE-hard",
          fit: 123,
          source: "synthetic evidence",
          evidence: "scenario",
          rateBasis: "npu-equivalent-hour",
        },
      ],
    }),
  ).toThrow("刷新对象");
  const updated = resolveAudit({
    ...defaults,
    eventOverrides: [
      {
        id: "CORE-hard",
        fit: 123,
        source: "synthetic evidence",
        evidence: "scenario",
        rateBasis: "npu-equivalent-hour",
      },
    ],
  });
  expect(
    updated.events.filter((e) => e.type !== "hard").map((e) => e.fit),
  ).toEqual(catalog.filter((e) => e.type !== "hard").map((e) => e.fit));
});

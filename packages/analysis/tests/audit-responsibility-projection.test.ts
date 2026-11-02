import { expect, test } from "vitest";
import { networkIodProjection } from "../src/audit-responsibility-projection";
import type { TopologyDecisionNode } from "../src/audit-topology-decision";
import { hardwareAuditArchitecture } from "../../contracts/src/audit-hardware";
import { getAuditEvents } from "../src/audit";

const node = (
  id: string,
  parentId: string | undefined,
  loss: number,
  budget: number | null,
): TopologyDecisionNode => ({
  id,
  parentId,
  name: id,
  domain:
    id === "hardware-network" || id === "object-NIC" ? "network" : "compute",
  quantity: null,
  fit: loss * 10,
  hardFit: loss * 8,
  complexity: loss,
  gain: loss / 2,
  importance: 1,
  loss: {
    downtime: loss,
    rollback: 0,
    slowdown: 0,
    localLoss: 0,
    terminalInvalid: 0,
    save: 0,
    mechanismOverhead: 0,
  },
  actualHours: loss,
  allowedHours: budget,
  availability: 1 - loss / 600,
  target: budget === null ? null : 1 - budget / 600,
  mtbfHours: null,
  mttrSeconds: null,
  targetMttrSeconds: null,
  gapHours: budget === null ? null : loss - budget,
});
const fixture = () => ({
  hours: 600,
  method: "legacy",
  basis: "frozen",
  scales: [
    {
      cards: 500000,
      scenarios: [
        {
          nodes: [
            node("system", undefined, 150, 9),
            node("domain-1", "system", 120, 3),
            node("hardware-chip", "domain-1", 120, 3),
            node("object-CORE", "hardware-chip", 100, 2.5),
            node("object-IOD", "hardware-chip", 20, 0.5),
            node("hardware-network", "system", 30, 6),
            node("object-NIC", "hardware-network", 30, 6),
          ],
        },
      ],
    },
  ],
});
test("IOD moves its exact loss, FIT and frozen leaf budget from compute to network without changing the run", () => {
  const original = fixture(),
    before = structuredClone(original),
    d = networkIodProjection(original);
  const nodes = d.scales[0].scenarios[0].nodes,
    get = (id: string) => nodes.find((n) => n.id === id)!;
  expect(original).toEqual(before);
  expect(get("system")).toEqual(before.scales[0].scenarios[0].nodes[0]);
  expect(get("object-IOD")).toMatchObject({
    parentId: "hardware-network",
    physicalParentId: "hardware-chip",
    domain: "network",
    actualHours: 20,
    allowedHours: 0.5,
  });
  expect(get("domain-1")).toMatchObject({
    actualHours: 100,
    allowedHours: 2.5,
  });
  expect(get("hardware-network")).toMatchObject({
    actualHours: 50,
    allowedHours: 6.5,
  });
  for (const n of nodes) {
    const children = nodes.filter((c) => c.parentId === n.id);
    if (children.length)
      for (const key of [
        "actualHours",
        "allowedHours",
        "fit",
        "hardFit",
        "gain",
      ] as const)
        expect(children.reduce((s, c) => s + (c[key] ?? 0), 0)).toBeCloseTo(
          n[key]!,
          10,
        );
  }
  expect(get("hardware-network").mtbfHours).toBeCloseTo(1e9 / (500000 * 400));
  expect(networkIodProjection(d)).toBe(d);
});
test("unknown budgets stay unallocated instead of becoming apparent spare capacity", () => {
  const d = fixture();
  d.scales[0].scenarios[0].nodes.forEach((n) => {
    n.allowedHours = null;
  });
  const updated = networkIodProjection(d);
  for (const n of updated.scales[0].scenarios[0].nodes.filter((n) =>
    ["domain-1", "hardware-network"].includes(n.id),
  )) {
    expect(n.allowedHours).toBeNull();
    expect(n.target).toBeNull();
    expect(n.gapHours).toBeNull();
  }
});
test("new hardware inputs separate IOD network responsibility from physical chip placement", () => {
  const a = hardwareAuditArchitecture(getAuditEvents());
  expect(a.nodes.find((n) => n.id === "object-IOD")).toMatchObject({
    parentId: "hardware-network",
    physicalParentId: "hardware-chip",
    functionalDomain: "network",
  });
});

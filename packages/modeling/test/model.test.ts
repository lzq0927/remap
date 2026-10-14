import { describe, expect, it } from "vitest";
import { clusterModel } from "../src/sample";
import { validateModel, semanticHash } from "../src/validate";
import { compileStatic } from "../src/compile";
import { solveStatic } from "../../solvers/src/static";

describe("engineering model semantics", () => {
  it("compares the AI cluster sample against analytical reliability and repair formulas", () => {
    const model = clusterModel();
    const probability = (id: string) =>
      solveStatic(compileStatic(model, id).input).probability;
    const coordinator = Math.exp(-1000e-9 * 100),
      shared = Math.exp(-(500 + 100 + 800) * 1e-9 * 100);
    expect(probability("single-coordinator-rbd")).toBeCloseTo(
      coordinator * shared,
      14,
    );
    const redundant = (1 - (1 - coordinator) ** 2) * shared;
    expect(probability("coordination-rbd")).toBeCloseTo(redundant, 14);
    expect(probability("coordination-fta")).toBeCloseTo(1 - redundant, 14);
    const common =
      (1 - (1 - 1 / (1 + 1000e-9)) ** 2) /
      (1 + 500e-9 * 0.5) /
      (1 + 100e-9 * 2);
    expect(probability("coordination-availability")).toBeCloseTo(
      common / (1 + 800e-9),
      14,
    );
    expect(probability("recovery-availability")).toBeCloseTo(
      common / (1 + 800e-9 * 0.1),
      14,
    );
    expect(
      compileStatic(model, "recovery-availability").mapping.every(
        (e) => JSON.stringify(e.originalRate) === JSON.stringify(e.appliedRate),
      ),
    ).toBe(true);
    expect(
      compileStatic(model, "recovery-availability").mapping.find(
        (e) => e.eventId === "storage-loss",
      ),
    ).toMatchObject({
      originalRecoveryHours: 1,
      appliedRecoveryHours: 0.1,
    });
  });
  it("keeps presentation outside the semantic identity", () => {
    const model = clusterModel();
    const moved = structuredClone(model);
    moved.views[0].positions.coordinatorA = { x: 800, y: 200 };
    expect(semanticHash(moved)).toBe(semanticHash(model));
    moved.failureModes[0].rate!.value *= 2;
    expect(semanticHash(moved)).not.toBe(semanticHash(model));
  });
  it("rejects broken references and duplicate identities", () => {
    const model = clusterModel();
    model.relations[0].target = "missing";
    expect(
      validateModel(model).some((x) => x.code === "REFERENCE_MISSING"),
    ).toBe(true);
    model.entities.push(model.entities[0]);
    expect(validateModel(model).some((x) => x.code === "DUPLICATE_ID")).toBe(
      true,
    );
  });
  it("compiles units and distinguishes mission reliability from availability", () => {
    const model = clusterModel();
    const c = model.cases[0];
    c.logic = { type: "event", id: "power-loss" };
    c.hours = 100;
    model.failureModes.find((x) => x.id === "power-loss")!.rate = {
      value: 0.001,
      unit: "1/h",
    };
    model.failureModes.find((x) => x.id === "power-loss")!.recoveryHours = 2;
    expect(
      solveStatic(compileStatic(model, c.id).input).probability,
    ).toBeCloseTo(Math.exp(-0.1), 12);
    c.metric = "availability";
    expect(
      solveStatic(compileStatic(model, c.id).input).probability,
    ).toBeCloseTo(1 / 1.002, 12);
  });
  it("shares common events across branches and rejects missing data", () => {
    const model = clusterModel(),
      c = model.cases[0];
    c.logic = {
      type: "series",
      children: [
        { type: "event", id: "power-loss" },
        { type: "event", id: "power-loss" },
      ],
    };
    const input = compileStatic(model, c.id).input;
    expect(solveStatic(input).details.eventCount).toBe(1);
    model.failureModes.find((x) => x.id === "power-loss")!.rate = null;
    expect(() => compileStatic(model, c.id)).toThrow(/参数/);
  });
  it("keeps dimension cases conditional without changing the source model", () => {
    const m = clusterModel(),
      original = JSON.stringify(m);
    m.cases[0].categories = ["network"];
    const compiled = compileStatic(m, m.cases[0].id);
    expect(
      compiled.mapping.filter((e) => !e.excluded).map((e) => e.eventId),
    ).toEqual(["network-loss"]);
    expect(solveStatic(compiled.input).probability).toBeCloseTo(
      Math.exp(-500e-9 * 100),
      12,
    );
    m.cases[0].categories = [];
    expect(JSON.stringify(m)).toBe(original);
  });
  it("blocks cyclic or deeply nested JSON before recursive parsing", () => {
    const m = clusterModel();
    const node: any = { type: "series", children: [] };
    node.children.push(node);
    m.cases[0].logic = node;
    expect(validateModel(m)[0].code).toBe("RESOURCE_LIMIT");
  });
  it("does not make numerical evidence stale when recording a decision", () => {
    const m = clusterModel(),
      before = semanticHash(m);
    m.decisions.push({
      id: "decision",
      statement: "reviewed",
      alternatives: "",
      reason: "",
      status: "accepted",
      sourceRefs: [],
      caseRefs: [],
      runRefs: [],
    });
    expect(semanticHash(m)).toBe(before);
  });
});

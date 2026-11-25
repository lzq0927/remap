import { describe, expect, it } from "vitest";
import {
  applyMeasures,
  assess,
  auditLibraryMeasures,
  correctLibraryMeasures,
  coreModelSchema,
  createEvaluator,
  layerOf,
  measureScaleStudy,
  novemberReferenceScenario,
  verify,
} from "../src/index";

describe("阶段节省与MTBF单项收益审计", () => {
  it("阶段节省只减少64.8秒，保留校准残差；不与更快路径再次相减", () => {
    const model = novemberReferenceScenario();
    for (const m of model.measures) m.enabled = m.id === "recovery-classify";
    const resolved = applyMeasures(model);
    for (const id of ["hbm-uce", "optical-fault", "software-fault"]) {
      const base = model.modes.find((m) => m.id === id)!;
      expect(
        (base.ladder.restart.hours -
          resolved.modes.find((m) => m.id === id)!.ladder.restart.hours) *
          3600,
      ).toBeCloseTo(64.8, 10);
    }
    const fixed = model.measures.find((m) => m.id === "runtime-snapshot")!;
    fixed.enabled = true;
    fixed.modeIds = ["hbm-uce"];
    fixed.effects = [{ param: "restart.hours", op: "set", value: 60 / 3600 }];
    const ids = new Set([fixed.id, "recovery-classify"]);
    expect(
      applyMeasures(model, ids).modes.find((m) => m.id === "hbm-uce")!.ladder
        .restart.hours * 3600,
    ).toBeCloseTo(60, 10);
    expect(createEvaluator(model)(ids)).toBeCloseTo(
      assess(model, applyMeasures(model, ids)).system.availability,
      12,
    );
    const reversed = structuredClone(model);
    reversed.measures.reverse();
    expect(applyMeasures(reversed)).toEqual(applyMeasures(model));
    // Applicability retains the failed half even when the saving exceeds baseline.
    fixed.effects = [{ param: "restart.hours", op: "subtract", value: 100 }];
    fixed.applicability = 0.5;
    const base = model.modes.find((m) => m.id === "hbm-uce")!;
    expect(
      applyMeasures(model, new Set([fixed.id])).modes.find(
        (m) => m.id === base.id,
      )!.ladder.restart.hours,
    ).toBeCloseTo(base.ladder.restart.hours / 2, 12);
  });

  it("显式修正旧库，保留历史输入及人工改过的参数", () => {
    const model = novemberReferenceScenario();
    const legacy = model.measures.find((m) => m.id === "recovery-classify")!;
    legacy.enabled = true;
    legacy.effects = [
      { param: "restart.hours", op: "set", value: 187.2 / 3600 },
    ];
    const edited = model.measures.find((m) => m.id === "runtime-snapshot")!;
    edited.effects = [{ param: "restart.hours", op: "set", value: 0.1 }];
    expect(auditLibraryMeasures(model)).toHaveLength(1);
    const snapshot = structuredClone(model),
      next = correctLibraryMeasures(model);
    expect(coreModelSchema.safeParse(next).success).toBe(true);
    expect(auditLibraryMeasures(next)).toHaveLength(0);
    expect(next.measures.find((m) => m.id === edited.id)).toEqual(edited);
    expect(model).toEqual(snapshot);
    expect(
      verify(model, { trials: 100, seed: 19 }).checks.find(
        (c) => c.id === "recovery-semantics",
      )?.state,
    ).toBe("fail");
    expect(
      verify(next, { trials: 100, seed: 19 }).checks.find(
        (c) => c.id === "recovery-semantics",
      ),
    ).toBeUndefined();
  });

  it("三项MTBF固定全部现状恢复参数；净减损与固定暴露减损分开且不受MTTR候选改值影响", () => {
    const model = novemberReferenceScenario();
    const ids = ["hbm-ecc", "aicore-screening", "optical-reliability"];
    for (const m of model.measures) m.enabled = ids.includes(m.id);
    const study = measureScaleStudy(model);
    expect(study.mtbfOnly.ids).toEqual(ids);
    expect(
      study.measures.reduce((s, m) => s + (m.mtbfOnlyShapleyPp ?? 0), 0),
    ).toBeCloseTo(study.mtbfOnly.gainPp, 10);
    const baseline = assess(model, applyMeasures(model, new Set()));
    for (const id of ids) {
      const params = applyMeasures(model, new Set([id]));
      expect(params.overhead).toBe(model.scenario.overhead);
      for (const mode of params.modes) {
        const base = model.modes.find((m) => m.id === mode.id)!;
        expect({ ...mode, fit: base.fit }).toEqual(base);
      }
      const p = study.measures.find((m) => m.id === id)!.points.at(-1)!;
      const single = assess(model, params);
      expect(p.savedHours).toBeCloseTo(
        baseline.system.lossHours - single.system.lossHours,
        12,
      );
      expect(p.fixedExposureSavedHours).toBeGreaterThan(p.savedHours);
    }
    const hbm = study.measures.find((m) => m.id === "hbm-ecc")!.points.at(-1)!;
    expect(hbm.fixedExposureSavedHours).toBeCloseTo(
      baseline.modules.find((m) => m.id === "hbm")!.lossHours * 0.6,
      10,
    );
    for (const m of model.measures.filter(
      (m) => layerOf(m.category) === "system",
    )) {
      m.enabled = true;
      m.effects = [{ param: "restart.hours", op: "set", value: 0 }];
    }
    const changed = measureScaleStudy(model);
    expect(changed.mtbfOnly).toEqual(study.mtbfOnly);
    for (const id of ids) {
      const a = study.measures.find((m) => m.id === id)!,
        b = changed.measures.find((m) => m.id === id)!;
      expect(a.mtbfOnlyShapleyPp).toBe(b.mtbfOnlyShapleyPp);
      for (let i = 0; i < a.points.length; i++) {
        expect(a.points[i].savedHours).toBe(b.points[i].savedHours);
        expect(a.points[i].fixedExposureSavedHours).toBe(
          b.points[i].fixedExposureSavedHours,
        );
      }
    }
  });
});

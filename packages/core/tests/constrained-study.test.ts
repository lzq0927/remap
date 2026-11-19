import { describe, expect, it } from "vitest";
import {
  allocate,
  analyze,
  applyMeasures,
  assess,
  calibrateBaseline,
  coreModelSchema,
  defaultCoreModel,
  domainModel,
  domainTargetAtScale,
  measureScaleStudy,
  modelAtScale,
  modelHash,
  novemberReferenceScenario,
  recommend,
  simulate,
  solveEffect,
  studyScales,
  targetAtScale,
  verify,
} from "../src/index";

describe("已知域级约束的五规模评估", () => {
  it("按独立现状校准未知恢复段，保留频率、静默分支和历史默认模型", () => {
    const original = defaultCoreModel(),
      model = novemberReferenceScenario(),
      a = analyze(model);
    expect(coreModelSchema.safeParse(model).success).toBe(true);
    expect(defaultCoreModel()).toEqual(original);
    expect(
      a.requirements.find((d) => d.id === "network")!.baseline.availability,
    ).toBeCloseTo(0.63, 12);
    expect(
      a.requirements.find((d) => d.id === "remaining")!.baseline.availability,
    ).toBeCloseTo(0.6, 12);
    expect(a.baseline.system.availability).toBeCloseTo(
      (1 - 4 / 604) / (1 + (1 / 0.63 - 1) + (1 / 0.6 - 1)),
      12,
    );
    expect(a.baseline.system.fitPerCard).toBeCloseTo(1700 / 0.3, 8);
    for (const [id, frequency] of [
      ["hbm", 71.4],
      ["aicore", 5.6644],
      ["optical", 166.6],
    ] as const)
      expect(
        a.baseline.modules.find((m) => m.id === id)!.rate * 168,
      ).toBeCloseTo(frequency, 8);
    const sdc = model.modes.find((m) => m.id === "aicore-sdc")!;
    expect(sdc.coverage).toBe(0.9);
    expect(sdc.missedLossHours).toBe(48);
    expect(sdc.reworkHours).toBe(300 / 3600);
    expect(
      [...a.baselineGaps]
        .sort(
          (x, y) => y.lossHours - y.budgetHours - (x.lossHours - x.budgetHours),
        )
        .slice(0, 3)
        .map((g) => g.id),
    ).toEqual(["optical", "aicore", "hbm"]);
    const impossible = structuredClone(model);
    impossible.requirements!.domains.find(
      (d) => d.id === "remaining",
    )!.baselineAvailability = 0.999999;
    expect(() => calibrateBaseline(impossible)).toThrow(
      /无法只靠未知恢复段校准/,
    );
    expect(
      model.modes.find((m) => m.id === "aicore-sdc")!.missedLossHours,
    ).toBe(48);
  });

  it("不同分配方法均冻结域目标，五个规模预算闭合；冲突不靠放宽供电目标解决", () => {
    const model = novemberReferenceScenario();
    for (const method of ["agree", "arinc", "equal", "min-effort"] as const)
      for (const cards of studyScales) {
        const scaled = modelAtScale(model, cards),
          result = allocate(scaled, method);
        expect(result.feasible).toBe(true);
        expect(
          result.modules.reduce((s, m) => s + m.lossHours, 0) +
            result.overheadLossHours +
            result.unallocatedLossHours,
        ).toBeCloseTo(168 * (1 - targetAtScale(model, cards)), 10);
        expect(
          result.modules.find((m) => m.id === "power")!.availability,
        ).toBeCloseTo(domainTargetAtScale(model, 0.99999, cards), 12);
        const network = model.requirements!.domains.find(
          (d) => d.id === "network",
        )!;
        const load = result.modules
          .filter((m) => network.moduleIds.includes(m.id))
          .reduce((s, m) => s + m.load, 0);
        expect(1 / (1 + load)).toBeCloseTo(
          domainTargetAtScale(model, 0.98, cards),
          12,
        );
      }
    model.requirements!.domains[0].targetAvailability = 0.5;
    const result = allocate(model);
    expect(result.feasible).toBe(false);
    expect(result.conflict).toBeTruthy();
    expect(
      result.modules.find((m) => m.id === "power")!.availability,
    ).toBeCloseTo(0.99999, 12);
  });

  it("五规模单项曲线有一致基准，允许负收益，不把未启用候选混入组合", () => {
    const model = novemberReferenceScenario();
    model.measures.push({
      id: "cost",
      name: "仅有检测开销",
      direction: "mttr",
      modeIds: [],
      effects: [{ param: "overhead", op: "add", value: 0.01 }],
      applicability: 1,
      enabled: false,
      evidence: "assumed",
      rationale: "边界测试",
      source: "",
    });
    const study = measureScaleStudy(model);
    expect(study.rows.map((r) => r.cards)).toEqual(studyScales);
    expect(study.rows.at(-1)!.target).toBe(0.95);
    expect(study.rows[0].target).toBeLessThan(1 - 4 / 604);
    for (const measure of study.measures)
      for (const p of measure.points) {
        const scaled = modelAtScale(model, p.cards),
          single = assess(
            scaled,
            applyMeasures(scaled, new Set([measure.id])),
          ).system;
        expect(p.availability).toBeCloseTo(single.availability, 12);
        expect(p.savedHours).toBeCloseTo(p.baselineLossHours - p.lossHours, 12);
      }
    expect(study.measures.at(-1)!.id).toBe("cost");
    expect(study.measures.at(-1)!.points.at(-1)!.gainPp).toBeLessThan(0);
    expect(study.rows.at(-1)!.combination).toBeCloseTo(
      assess(model).system.availability,
      12,
    );
  });

  it("整体达标不能覆盖独立域失败，参数反推与验证同时检查域约束", () => {
    const model = novemberReferenceScenario();
    model.measures.forEach((m) => (m.enabled = true));
    model.requirements!.domains.find(
      (d) => d.id === "network",
    )!.targetAvailability = 0.99999999;
    expect(assess(model).system.availability).toBeGreaterThan(0.95);
    expect(recommend(model).kind).not.toBe("met");
    expect(solveEffect(model, "hbm-ecc")?.reachable).toBe(false);
    const result = verify(model, { trials: 400, seed: 1818 });
    expect(result.scales).toHaveLength(5);
    expect(result.domains).toHaveLength(10);
    expect(result.checks.find((c) => c.id === "domains")!.state).toBe("fail");
    const row = result.domains!.find(
      (d) => d.cards === 500000 && d.id === "network",
    )!;
    const ids = model.requirements!.domains.find(
      (d) => d.id === "network",
    )!.moduleIds;
    const independent = domainModel(model, ids, row.target);
    expect(row.mean).toBe(
      simulate(independent, applyMeasures(independent), 400, row.seed).mean,
    );
    const before = modelHash(model);
    model.requirements!.domains[0].targetAvailability = 0.98;
    expect(modelHash(model)).not.toBe(before);
  });

  it("拒绝重复域、重复部件和重叠固定目标，允许非网络现状包含供电", () => {
    const model = novemberReferenceScenario();
    expect(coreModelSchema.safeParse(model).success).toBe(true);
    const bad = structuredClone(model);
    bad.requirements!.domains.push({ ...bad.requirements!.domains[0] });
    expect(coreModelSchema.safeParse(bad).success).toBe(false);
    const duplicate = structuredClone(model);
    duplicate.requirements!.domains[1].moduleIds.push("power");
    expect(coreModelSchema.safeParse(duplicate).success).toBe(false);
  });
});

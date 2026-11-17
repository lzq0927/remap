import { describe, expect, it } from "vitest";
import {
  allocate,
  analyze,
  applyMeasures,
  assess,
  coreModelSchema,
  coreModelVersion,
  createEvaluator,
  defaultCoreModel,
  diagramSlots,
  gaps,
  lossPerEvent,
  modelHash,
  parseCoreModel,
  recommend,
  shapley,
  simulate,
  solveEffect,
  verify,
  type CoreModel,
} from "../src/index";

/** 两个模块、数值可手算的小模型。 */
function tiny(): CoreModel {
  return coreModelSchema.parse({
    schemaVersion: coreModelVersion,
    name: "手算样例",
    scenario: {
      cards: 1000,
      hours: 100,
      target: 0.9,
      overhead: 0,
      passRatio: 0.9,
    },
    groups: [{ id: "g", name: "组" }],
    modules: [
      {
        id: "a",
        groupId: "g",
        name: "A",
        unitsPerCard: 2,
        importance: 1,
        complexity: null,
        note: "",
      },
      {
        id: "b",
        groupId: "g",
        name: "B",
        unitsPerCard: 1,
        importance: 0.5,
        complexity: null,
        note: "",
      },
    ],
    modes: [
      // 率 = 50000 FIT × 2 × 1000 / 1e9 = 0.1 次/h；单次损失 1 h → ρ = 0.1
      {
        id: "a1",
        moduleId: "a",
        name: "A1",
        kind: "hard",
        fit: 50000,
        coverage: 1,
        detectHours: 0.2,
        recoverHours: 0.5,
        reworkHours: 0.3,
        missedLossHours: 9,
        impact: 1,
        evidence: "",
      },
      // 率 = 0.05 次/h；单次损失 0.8×1 + 0.2×11 = 3 h → ρ = 0.15
      {
        id: "b1",
        moduleId: "b",
        name: "B1",
        kind: "sdc",
        fit: 50000,
        coverage: 0.8,
        detectHours: 0,
        recoverHours: 1,
        reworkHours: 0,
        missedLossHours: 11,
        impact: 1,
        evidence: "",
      },
    ],
    measures: [
      {
        id: "m-fit",
        name: "A 降故障率",
        direction: "mtbf",
        modeIds: ["a1"],
        effects: [{ param: "fit", op: "reduce", value: 0.5 }],
        enabled: true,
        evidence: "planned",
        rationale: "",
      },
      {
        id: "m-cov",
        name: "B 提检出率",
        direction: "mttr",
        modeIds: ["b1"],
        effects: [{ param: "coverage", op: "set", value: 0.95 }],
        enabled: false,
        evidence: "assumed",
        rationale: "",
      },
    ],
    allocation: { method: "agree", complexityBasis: "fit", customWeights: {} },
    source: "",
  });
}

describe("评估：串联可修系统的更新报酬模型", () => {
  it("按 A = (1−开销)/(1+ρ) 计算，损失小时合计等于窗口损失", () => {
    const model = tiny(),
      result = assess(model, applyMeasures(model, new Set()));
    expect(result.modules[0].load).toBeCloseTo(0.1, 12);
    expect(result.modules[1].load).toBeCloseTo(0.15, 12);
    expect(result.system.availability).toBeCloseTo(1 / 1.25, 12);
    expect(result.modules[0].availability).toBeCloseTo(1 / 1.1, 12);
    expect(result.modules[0].mtbfHours).toBeCloseTo(10, 12);
    expect(result.modules[1].mttrHours).toBeCloseTo(3, 12);
    expect(result.modules[0].lossHours).toBeCloseTo(8, 12);
    expect(result.modules[1].lossHours).toBeCloseTo(12, 12);
    expect(result.modules[0].events).toBeCloseTo(8, 12);
    expect(
      result.modules.reduce((sum, m) => sum + m.lossHours, 0) +
        result.system.overheadLossHours,
    ).toBeCloseTo(result.system.lossHours, 12);
  });
  it("公共开销只在运行时间内计入，仍与总损失闭合", () => {
    const model = tiny();
    model.scenario.overhead = 0.1;
    const result = assess(model, applyMeasures(model, new Set()));
    expect(result.system.availability).toBeCloseTo(0.9 / 1.25, 12);
    expect(result.system.overheadLossHours).toBeCloseTo(8, 12);
    expect(
      result.system.failureLossHours + result.system.overheadLossHours,
    ).toBeCloseTo(100 * (1 - 0.72), 12);
  });
  it("措施按参数生效且与顺序无关；检出率的降低作用在漏检率上", () => {
    const model = tiny();
    model.measures.push(
      {
        id: "x",
        name: "x",
        direction: "mttr",
        modeIds: ["b1"],
        effects: [{ param: "coverage", op: "reduce", value: 0.5 }],
        applicability: 1,
        enabled: true,
        evidence: "assumed",
        rationale: "",
        source: "",
      },
      {
        id: "y",
        name: "y",
        direction: "mtbf",
        modeIds: ["a1"],
        effects: [{ param: "fit", op: "set", value: 20000 }],
        enabled: true,
        evidence: "assumed",
        rationale: "",
        source: "",
        applicability: 1,
      },
    );
    const forward = applyMeasures(model),
      reversed = applyMeasures({
        ...model,
        measures: [...model.measures].reverse(),
      });
    // fit：设为 20000 后再降低 50%；检出率：漏检率 0.2 减半
    expect(forward.modes[0].fit).toBeCloseTo(10000, 9);
    expect(forward.modes[1].coverage).toBeCloseTo(0.9, 12);
    expect(reversed.modes[0].fit).toBeCloseTo(forward.modes[0].fit, 9);
    expect(lossPerEvent(forward.modes[1])).toBeCloseTo(0.9 * 1 + 0.1 * 11, 12);
  });
});

describe("措施生效规则", () => {
  it("适用比例在现值与目标值之间折算", () => {
    const model = tiny();
    model.measures = [
      {
        id: "half",
        name: "半数适用",
        direction: "mttr",
        modeIds: ["a1"],
        effects: [
          { param: "recoverHours", op: "set", value: 0.1 },
          { param: "fit", op: "reduce", value: 0.4 },
          { param: "coverage", op: "set", value: 0.5 },
        ],
        applicability: 0.5,
        enabled: true,
        evidence: "assumed",
        rationale: "",
        source: "",
      },
    ];
    const mode = applyMeasures(model).modes[0];
    expect(mode.recoverHours).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.1, 12);
    expect(mode.fit).toBeCloseTo(50000 * (1 - 0.5 * 0.4), 9);
    // 目标值比现值差时也照常折算，不会被忽略
    expect(mode.coverage).toBeCloseTo(0.75, 12);
    model.measures[0].applicability = 0;
    expect(applyMeasures(model).modes[0]).toEqual(model.modes[0]);
  });
  it("多项“设为”取最好的一项，“增加”逐项累加并受上下限约束", () => {
    const model = tiny();
    const make = (
      id: string,
      effects: CoreModel["measures"][number]["effects"],
    ) => ({
      id,
      name: id,
      direction: "mttr" as const,
      modeIds: ["b1"],
      effects,
      applicability: 1,
      enabled: true,
      evidence: "assumed" as const,
      rationale: "",
      source: "",
    });
    model.measures = [
      make("s1", [{ param: "recoverHours", op: "set", value: 0.6 }]),
      make("s2", [{ param: "recoverHours", op: "set", value: 0.4 }]),
      make("a1", [
        { param: "recoverHours", op: "add", value: 0.05 },
        { param: "overhead", op: "add", value: 0.01 },
      ]),
      make("a2", [
        { param: "overhead", op: "add", value: 0.02 },
        { param: "coverage", op: "add", value: 0.9 },
      ]),
    ];
    const resolved = applyMeasures(model);
    expect(resolved.modes[1].recoverHours).toBeCloseTo(0.45, 12);
    expect(resolved.overhead).toBeCloseTo(0.03, 12);
    expect(resolved.modes[1].coverage).toBe(1);
  });
  it("快速求值与完整评估给出相同的系统可用度", () => {
    const model = defaultCoreModel(),
      evaluate = createEvaluator(model),
      ids = model.measures.map((m) => m.id);
    for (const pick of [
      [],
      ids,
      ids.filter((_, i) => i % 2),
      ids.slice(5, 20),
    ]) {
      const enabled = new Set(pick);
      expect(evaluate(enabled)).toBeCloseTo(
        assess(model, applyMeasures(model, enabled)).system.availability,
        14,
      );
    }
  });
});

describe("分配：各方法都与系统目标闭合", () => {
  it("AGREE 权重与复杂度成正比、与重要度成反比", () => {
    const model = tiny(),
      result = allocate(model, "agree");
    // n_A = 100000 FIT/卡，ω=1；n_B = 50000，ω=0.5 → 权重各 0.5
    expect(result.modules.map((m) => m.weight)).toEqual([0.5, 0.5]);
    expect(result.load).toBeCloseTo(1 / 0.9 - 1, 12);
    model.allocation.complexityBasis = "units";
    const byUnits = allocate(model, "agree");
    // n_A = 2，ω=1；n_B = 1，ω=0.5 → 仍各 0.5
    expect(byUnits.modules[0].weight).toBeCloseTo(0.5, 12);
    model.modules[1].importance = 1;
    expect(allocate(model, "agree").modules[0].weight).toBeCloseTo(2 / 3, 12);
  });
  it("所有方法的模块预算与开销预算合计等于 T·(1−A*)", () => {
    const model = defaultCoreModel();
    for (const method of [
      "agree",
      "arinc",
      "equal",
      "min-effort",
      "custom",
    ] as const) {
      model.allocation.customWeights = { hbm: 3, optical: 1 };
      const result = allocate(model, method);
      const sum =
        result.modules.reduce((total, m) => total + m.lossHours, 0) +
        result.overheadLossHours;
      expect(sum, method).toBeCloseTo(result.lossHours, 9);
      expect(
        result.modules.reduce((total, m) => total + m.weight, 0),
        method,
      ).toBeCloseTo(1, 12);
      // 各模块目标可用度合成后回到系统目标
      const load = result.modules.reduce(
        (total, m) => total + (1 / m.availability - 1),
        0,
      );
      expect((1 - model.scenario.overhead) / (1 + load), method).toBeCloseTo(
        model.scenario.target,
        12,
      );
    }
  });
  it("ARINC 保持现状占比，最小改进量只压低高于水位的模块", () => {
    const model = tiny(),
      budget = 1 / 0.9 - 1;
    const arinc = allocate(model, "arinc");
    expect(arinc.modules[0].weight).toBeCloseTo(0.4, 12);
    const effort = allocate(model, "min-effort");
    // ρ = 0.1、0.15，预算 0.111：水位 0.0556，两模块都被压到水位
    expect(effort.waterline).toBeCloseTo(budget / 2, 12);
    model.modes[0].fit = 5000; // ρ_A = 0.01，低于水位，保持现状
    const focused = allocate(model, "min-effort");
    expect(focused.modules[0].load).toBeCloseTo(0.01, 12);
    expect(focused.modules[1].load).toBeCloseTo(budget - 0.01, 12);
  });
  it("给出两个改进方向的等价要求，并按损失负荷判定差距", () => {
    const model = tiny(),
      baseline = assess(model, applyMeasures(model, new Set())),
      result = allocate(model, "agree", baseline),
      a = result.modules[0],
      rows = gaps(baseline, result);
    // 模块 A：ρ* = 0.0556；MTTR 不变（1 h）时 MTBF ≥ 18 h；故障率不变时 MTTR ≤ 0.556 h
    expect(a.minMtbfHours).toBeCloseTo(1 / a.load, 9);
    expect(a.maxMttrHours).toBeCloseTo(a.load / 0.1, 9);
    expect(a.maxFitPerCard).toBeCloseTo(((a.load / 1) * 1e9) / 1000, 6);
    expect(rows[0].usage).toBeCloseTo(0.1 / a.load, 9);
    expect(rows[0].status).toBe("over");
    expect(rows[1].suggestion).toBe("mttr");
    expect(rows[0].suggestion).toBe("mtbf");
  });
  it("公共开销已吃完全部预算时标记为不可达", () => {
    const model = tiny();
    model.scenario.overhead = 0.2;
    expect(allocate(model).feasible).toBe(false);
  });
});

describe("设计：贡献分摊、推荐与参数反推", () => {
  it("Shapley 分摊之和等于设计后与现状之差", () => {
    const model = defaultCoreModel();
    model.measures.forEach((measure, index) => (measure.enabled = index < 12));
    const result = analyze(model),
      sum = result.contributions.items.reduce(
        (total, c) => total + c.shapley,
        0,
      );
    expect(result.contributions.exact).toBe(true);
    expect(sum).toBeCloseTo(
      result.design.system.availability - result.baseline.system.availability,
      10,
    );
    // 换一个排列顺序，分摊结果不变
    const shuffled = shapley({
      ...model,
      measures: [...model.measures].reverse(),
    });
    for (const item of result.contributions.items.filter((c) => c.enabled))
      expect(shuffled.values.get(item.id)).toBeCloseTo(item.shapley, 10);
  });
  it("措施很多时改用抽样，分摊之和仍然闭合且可复现", () => {
    const model = defaultCoreModel();
    for (const measure of model.measures) measure.enabled = true;
    const first = analyze(model),
      again = analyze(model),
      sum = first.contributions.items.reduce(
        (total, c) => total + c.shapley,
        0,
      );
    expect(first.contributions.exact).toBe(false);
    expect(sum).toBeCloseTo(
      first.design.system.availability - first.baseline.system.availability,
      10,
    );
    expect(again.contributions.items).toEqual(first.contributions.items);
  });
  it("默认场景：用户四项措施不足，采用推荐的补充措施后达标", () => {
    const model = defaultCoreModel(),
      result = analyze(model);
    expect(model.measures.length).toBeGreaterThanOrEqual(28);
    expect(model.measures.filter((m) => m.enabled).map((m) => m.id)).toEqual([
      "hbm-ecc",
      "aicore-screening",
      "optical-reliability",
      "sdc-detection",
    ]);
    expect(result.baseline.system.availability).toBeCloseTo(0.6505, 3);
    expect(result.design.system.availability).toBeCloseTo(0.7969, 3);
    expect(result.recommendation.kind).toBe("add");
    expect(result.recommendation.add.length).toBeGreaterThan(0);
    const adopted = structuredClone(model);
    for (const measure of adopted.measures)
      if (result.recommendation.add.includes(measure.id))
        measure.enabled = true;
    const after = analyze(adopted);
    expect(after.recommendation.kind).toBe("met");
    expect(after.design.system.availability).toBeCloseTo(
      result.recommendation.availability,
      12,
    );
    // 推荐的每一项都不可少：去掉任何一项都会低于目标
    for (const id of result.recommendation.add) {
      const without = structuredClone(adopted);
      without.measures.find((m) => m.id === id)!.enabled = false;
      expect(analyze(without).design.system.availability, id).toBeLessThan(
        model.scenario.target,
      );
    }
  });
  it("候选不多时穷举得到数量最少的补充方案", () => {
    const model = tiny();
    model.scenario.target = 0.85; // 允许 ρ = 0.1765；现状启用 m-fit 后 ρ = 0.2
    const result = recommend(model);
    // 加上 m-cov：ρ = 0.05 + 0.05×(0.95 + 0.05×11) = 0.125，达标
    expect(result).toMatchObject({
      kind: "add",
      add: ["m-cov"],
      minimal: true,
    });
    expect(result.availability).toBeCloseTo(1 / 1.125, 12);
  });
  it("措施库全部启用仍不够时给出还需降低的比例", () => {
    const model = tiny();
    model.scenario.target = 0.99;
    const result = recommend(model);
    expect(result.kind).toBe("short");
    expect(result.add).toEqual(["m-cov"]);
    // 全部启用：ρ = 0.05 + 0.05×(0.95+0.05×11) = 0.125；允许 0.0101
    expect(result.furtherReduction).toBeCloseTo(1 - (1 / 0.99 - 1) / 0.125, 9);
    expect(result.shortfall).toBeCloseTo(0.99 - 1 / 1.125, 9);
  });
  it("参数反推得到刚好达标的取值，做到极限也不够时如实返回", () => {
    const model = tiny();
    model.scenario.target = 0.85; // 允许 ρ = 0.17647
    // 其余：B 不变 ρ=0.15 → A 需 ρ ≤ 0.02647 → 降低比例 ≥ 0.7353
    const solved = solveEffect(model, "m-fit")!;
    expect(solved.reachable).toBe(true);
    expect(solved.value).toBeCloseTo(1 - (1 / 0.85 - 1 - 0.15) / 0.1, 6);
    model.scenario.target = 0.9;
    expect(solveEffect(model, "m-fit")).toEqual({ value: 1, reachable: false });
  });
});

describe("验证：独立仿真", () => {
  it("同一种子可复现，不同种子给出不同样本", () => {
    const model = tiny(),
      parameters = applyMeasures(model);
    const first = simulate(model, parameters, 300, 7),
      again = simulate(model, parameters, 300, 7),
      other = simulate(model, parameters, 300, 8);
    expect(again).toEqual(first);
    expect(other.mean).not.toBe(first.mean);
  });
  it("仿真均值在采样误差内收敛到解析值", () => {
    const model = tiny();
    model.scenario.hours = 2000; // 窗口远长于单次损失，截断效应可忽略
    const parameters = applyMeasures(model, new Set()),
      analytic = assess(model, parameters).system.availability,
      simulated = simulate(model, parameters, 3000, 20261117);
    expect(Math.abs(simulated.mean - analytic)).toBeLessThan(
      4 * simulated.standardError + 0.002,
    );
    expect(simulated.mtbfHours).toBeCloseTo(1 / 0.15, 0);
    const lossSum = Object.values(simulated.moduleLossHours).reduce(
      (s, v) => s + v,
      0,
    );
    expect(1 - lossSum / 2000).toBeCloseTo(simulated.mean, 9);
  });
  it("影响系数小于 1 的事件按等效停机计入，仿真与解析仍一致", () => {
    const model = tiny();
    model.scenario.hours = 2000;
    model.modes[0].impact = 0.1;
    const parameters = applyMeasures(model, new Set()),
      analytic = assess(model, parameters),
      simulated = simulate(model, parameters, 3000, 5);
    expect(
      Math.abs(simulated.mean - analytic.system.availability),
    ).toBeLessThan(4 * simulated.standardError + 0.002);
    expect(
      simulated.moduleLossHours.a / analytic.modules[0].lossHours,
    ).toBeCloseTo(1, 1);
    expect(simulated.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(
      3000,
    );
  });
  it("达标设计通过均值与一致性判定，未实测的措施只给出提醒", () => {
    const model = defaultCoreModel(),
      add = recommend(model).add;
    for (const measure of model.measures)
      measure.enabled = measure.enabled || add.includes(measure.id);
    model.allocation.method = "arinc";
    const result = verify(model, { trials: 1500, seed: 99 });
    expect(result.modelHash).toBe(modelHash(model));
    expect(result.design.mean).toBeGreaterThan(0.95);
    expect(result.checks.find((c) => c.id === "mean")!.state).toBe("pass");
    expect(result.checks.find((c) => c.id === "consistency")!.state).toBe(
      "pass",
    );
    expect(result.checks.find((c) => c.id === "evidence")!.state).toBe("warn");
    expect(result.baseline.mean).toBeLessThan(0.75);
    expect(result.seed).toBe(99);
  });
  it("指纹只随数值参数变化", () => {
    const model = defaultCoreModel(),
      before = modelHash(model);
    model.modules[0].note = "只改说明";
    model.measures[0].rationale = "只改说明";
    expect(modelHash(model)).toBe(before);
    model.modes[0].fit += 1;
    expect(modelHash(model)).not.toBe(before);
  });
});

describe("模型校验", () => {
  it("默认模型合法，引用缺失和越界参数被拒绝", () => {
    expect(coreModelSchema.safeParse(defaultCoreModel()).success).toBe(true);
    const broken = defaultCoreModel();
    broken.modes[0].moduleId = "missing";
    expect(coreModelSchema.safeParse(broken).success).toBe(false);
    const ratio = defaultCoreModel();
    ratio.measures[0].effects[0].value = 1.5;
    expect(coreModelSchema.safeParse(ratio).success).toBe(false);
    // 早期保存的模型：没有适用比例与架构图位置，带有已废弃的画法字段
    const legacy = JSON.parse(JSON.stringify(defaultCoreModel()));
    for (const group of legacy.groups) group.layout = "grid";
    for (const module of legacy.modules) {
      delete module.anchor;
      module.container = "NPU 模组";
    }
    for (const measure of legacy.measures) {
      delete measure.applicability;
      delete measure.source;
    }
    expect(coreModelSchema.safeParse(legacy).success).toBe(false);
    const upgraded = parseCoreModel(legacy);
    expect(upgraded.modules.map((m) => m.anchor)).toEqual(
      defaultCoreModel().modules.map((m) => m.anchor),
    );
    expect(upgraded.modules.find((m) => m.id === "iod-l1")!.anchor).toBe("l1");
    expect(upgraded.measures[0]).toMatchObject({
      applicability: 1,
      source: "",
    });
    expect(legacy.groups[0].layout).toBe("grid"); // 不改动传入的对象
    for (const module of defaultCoreModel().modules)
      expect(diagramSlots, module.id).toContain(module.anchor);
    const extra = { ...defaultCoreModel(), unknown: 1 };
    expect(coreModelSchema.safeParse(extra).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  allocate,
  analyze,
  applyMeasures,
  assess,
  consequences,
  coreModelSchema,
  coreModelVersion,
  createEvaluator,
  defaultCoreModel,
  diagramSlots,
  doseResponse,
  effectSweep,
  eventPaths,
  gaps,
  ladderOutcomes,
  layerPotential,
  loadByStage,
  loadPerTenThousand,
  lossPerEvent,
  makeLadder,
  minimumDegrees,
  modelHash,
  parseCoreModel,
  priorityPath,
  recommend,
  recoveryRoute,
  shapley,
  simulate,
  solveEffect,
  stageLoss,
  targetFromCurve,
  verify,
  type CoreModel,
  type Measure,
} from "../src/index";

const seconds = (value: number) => value / 3600;
const measure = (
  id: string,
  category: Measure["category"],
  modeIds: string[],
  effects: Measure["effects"],
  rest: Partial<Measure> = {},
): Measure => ({
  id,
  name: id,
  category,
  modeIds,
  effects,
  applicability: 1,
  enabled: true,
  hold: false,
  evidence: "assumed",
  rationale: "",
  source: "",
  ...rest,
});

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
      // 率 = 50000 FIT × 2 × 1000 / 1e9 = 0.1 次/h；单次损失 0.2 + 0.5 + 0.3 = 1 h → ρ = 0.1
      {
        id: "a1",
        moduleId: "a",
        name: "A1",
        kind: "hard",
        fit: 50000,
        coverage: 1,
        detectHours: 0.2,
        lateDetectHours: 9,
        reworkHours: 0.3,
        ladder: makeLadder({ restart: { success: 1, hours: 0.5 } }),
        impact: 1,
        evidence: "",
      },
      // 率 = 0.05 次/h；单次损失 0.8×0 + 0.2×10 + 1 = 3 h → ρ = 0.15
      {
        id: "b1",
        moduleId: "b",
        name: "B1",
        kind: "sdc",
        fit: 50000,
        coverage: 0.8,
        detectHours: 0,
        lateDetectHours: 10,
        reworkHours: 0,
        ladder: makeLadder({ restart: { success: 1, hours: 1 } }),
        impact: 1,
        evidence: "",
      },
    ],
    measures: [
      measure(
        "m-fit",
        "prevent",
        ["a1"],
        [{ param: "fit", op: "reduce", value: 0.5 }],
      ),
      measure(
        "m-cov",
        "detect",
        ["b1"],
        [{ param: "coverage", op: "set", value: 0.95 }],
        { enabled: false },
      ),
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
    // 按周（168 小时）折算的频次和损失
    expect(result.modules[0].eventsPerWeek).toBeCloseTo(8 * 1.68, 12);
    // 故障频次按连续运行一周计，不随停机多少变化
    expect(result.modules[0].ratePerWeek).toBeCloseTo(
      result.modules[0].rate * 168,
      12,
    );
    expect(result.system.runShare).toBeCloseTo(
      1 / (1 + result.system.load),
      12,
    );
    expect(result.modules[1].lossHoursPerWeek).toBeCloseTo(12 * 1.68, 12);
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
  it("固定数量的部件事件率不随规模变化", () => {
    const model = tiny();
    model.modules[0].scaling = "fixed";
    model.modules[0].unitsPerCard = 2000; // 与 2 件/卡 × 1000 卡相同
    const base = assess(model, applyMeasures(model, new Set()));
    expect(base.modules[0].rate).toBeCloseTo(0.1, 12);
    expect(base.modules[0].fitPerCard).toBeCloseTo(100000, 6);
    model.scenario.cards = 5000;
    const larger = assess(model, applyMeasures(model, new Set()));
    expect(larger.modules[0].rate).toBeCloseTo(0.1, 12);
    expect(larger.modules[1].rate).toBeCloseTo(0.25, 12);
  });
});

describe("恢复阶梯：从小到大逐级尝试", () => {
  const mode = () => ({
    coverage: 0.95,
    detectHours: seconds(10),
    lateDetectHours: seconds(60),
    reworkHours: seconds(150),
    impact: 1,
    ladder: makeLadder({
      replay: { success: 0.8, hours: seconds(5), failHours: seconds(10) },
      process: { success: 0.95, hours: seconds(60), failHours: seconds(120) },
      restart: { success: 0.99, hours: seconds(180), failHours: seconds(180) },
      manual: { success: 1, hours: 2 },
    }),
  });
  it("到达概率逐级衰减，各级期望相加得到单次等效损失", () => {
    const stages = stageLoss(mode()),
      s = (hours: number) => hours * 3600;
    // 检测：0.95×10 + 0.05×60
    expect(s(stages.detect + stages.late)).toBeCloseTo(12.5, 9);
    // 重执行：0.8×5 + 0.2×10；不回滚
    expect(s(stages.levels.replay)).toBeCloseTo(6, 9);
    // 进程重调度：到达 0.2 × (0.95×60 + 0.05×120)
    expect(s(stages.levels.process)).toBeCloseTo(12.6, 9);
    // 检查点全局恢复：到达 0.01 × (0.99×180 + 0.01×180)
    expect(s(stages.levels.restart)).toBeCloseTo(1.8, 9);
    // 人工：到达 0.0001 × 7200
    expect(s(stages.levels.manual)).toBeCloseTo(0.72, 9);
    // 回滚只在需要回滚的级别成功后计：0.2×0.95 + 0.01×0.99 + 0.0001
    expect(s(stages.rework)).toBeCloseTo(150 * (0.19 + 0.0099 + 0.0001), 9);
    expect(s(lossPerEvent(mode()))).toBeCloseTo(63.62, 9);
    expect(ladderOutcomes(mode()).map((o) => o.reach)).toEqual([
      1,
      expect.closeTo(0.2, 12),
      expect.closeTo(0.01, 12),
      expect.closeTo(0.0001, 12),
    ]);
  });
  it("不使用的级别被跳过，最后一级视为必定成功", () => {
    const only = {
      ...mode(),
      ladder: makeLadder({ restart: { success: 0.9, hours: 1, failHours: 5 } }),
    };
    // 只有一级时它就是最后一级：成功率按 1 计，不产生失败耗时
    expect(lossPerEvent(only)).toBeCloseTo(
      seconds(12.5) + 1 + seconds(150),
      12,
    );
    const none = { ...mode(), ladder: makeLadder() };
    expect(lossPerEvent(none)).toBeCloseTo(seconds(12.5), 12);
  });
  it("影响范围只作用在对应级别的耗时上", () => {
    const elastic = {
      ...mode(),
      ladder: makeLadder({
        elastic: {
          success: 0.98,
          hours: seconds(180),
          failHours: seconds(120),
          impact: 0.02,
        },
        restart: { success: 1, hours: seconds(180) },
      }),
    };
    const stages = stageLoss(elastic);
    expect(stages.levels.elastic * 3600).toBeCloseTo(
      0.02 * (0.98 * 180 + 0.02 * 120),
      9,
    );
    expect(stages.levels.restart * 3600).toBeCloseTo(0.02 * 180, 9);
    // 弹性恢复不回滚，只有退回全局恢复的 2% 才回滚
    expect(stages.rework * 3600).toBeCloseTo(0.02 * 150, 9);
  });
  it("恢复链的走向：成功后可以继续下一级，失败后可以直接转人工", () => {
    // 进程重调度成功即恢复，失败走弹性恢复；弹性恢复成功再走 CKPT 回滚，失败转人工；
    // CKPT 回滚失败也转人工。
    const chain = (elastic: number) => ({
      coverage: 0.99,
      detectHours: seconds(10),
      lateDetectHours: seconds(60),
      reworkHours: seconds(60),
      impact: 1,
      ladder: makeLadder({
        process: {
          success: 0.3,
          hours: seconds(240),
          failHours: seconds(240),
          rollback: false,
        },
        elastic: {
          success: elastic,
          hours: seconds(60),
          failHours: seconds(60),
          gate: true,
          then: "next",
          onFail: "manual",
        },
        restart: {
          success: 0.99,
          hours: seconds(300),
          failHours: seconds(300),
        },
        manual: { success: 1, hours: 1 },
      }),
    });
    const outcomes = ladderOutcomes(chain(0.99));
    expect(outcomes.map((o) => [o.level, o.successTo, o.failTo])).toEqual([
      ["process", null, "elastic"],
      ["elastic", "restart", "manual"],
      ["restart", null, "manual"],
      ["manual", null, null],
    ]);
    expect(outcomes.map((o) => o.reach)).toEqual([
      1,
      expect.closeTo(0.7, 12),
      expect.closeTo(0.693, 12),
      // 人工：弹性恢复失败 0.7×0.01，加上 CKPT 回滚失败 0.693×0.01
      expect.closeTo(0.01393, 12),
    ]);
    // 弹性恢复成功后还没恢复完，不在这一级结束
    expect(outcomes[1].resolved).toBe(0);
    expect(outcomes[1].passed).toBeCloseTo(0.693, 12);
    // 10.5 + 240 + 0.7×60 + 0.693×300 + 0.68607×60 + 0.01393×(3600 + 60)
    expect(lossPerEvent(chain(0.99)) * 3600).toBeCloseTo(592.548, 9);
    const stages = stageLoss(chain(0.99));
    expect(stages.levelRework.restart * 3600).toBeCloseTo(0.68607 * 60, 9);
    expect(stages.levelRework.elastic).toBe(0);
    // 弹性恢复不可用但又是必经环节：进程重调度失败后只能转人工，CKPT 回滚走不到
    const without = ladderOutcomes(chain(0));
    expect(without.map((o) => o.reach)).toEqual([
      1,
      expect.closeTo(0.7, 12),
      0,
      expect.closeTo(0.7, 12),
    ]);
    expect(lossPerEvent(chain(0)) * 3600).toBeCloseTo(
      10.5 + 240 + 0.7 * (60 + 3600 + 60),
      9,
    );
    // 不标为必经时，不可用的级别被跳过：进程重调度失败后直接走 CKPT 回滚
    const skipped = chain(0);
    skipped.ladder.elastic.gate = false;
    expect(ladderOutcomes(skipped).map((o) => o.level)).toEqual([
      "process",
      "restart",
      "manual",
    ]);
    expect(lossPerEvent(skipped) * 3600).toBeCloseTo(
      10.5 + 240 + 0.7 * (300 + 0.99 * 60 + 0.01 * 3660),
      9,
    );
    // 路径：各段时间相加是这条路径的损失，概率合计为 1
    const paths = eventPaths(chain(0.99)),
      main = paths.find(
        (p) =>
          p.detected &&
          p.level === "restart" &&
          p.segments.some((x) => x.stage === "process" && !x.ok),
      )!;
    expect(main.probability).toBeCloseTo(0.99 * 0.7 * 0.99 * 0.99, 12);
    expect(main.segments.map((x) => [x.stage, x.ok])).toEqual([
      ["detect", true],
      ["process", false],
      ["elastic", true],
      ["restart", true],
      ["rework", true],
    ]);
    expect(main.lossHours * 3600).toBeCloseTo(10 + 240 + 60 + 300 + 60, 9);
  });
  it("事件路径的概率合计为 1，按概率加权的损失等于单次等效损失", () => {
    for (const m of [mode(), ...defaultCoreModel().modes]) {
      const paths = eventPaths(m);
      expect(paths.reduce((sum, p) => sum + p.probability, 0)).toBeCloseTo(
        1,
        12,
      );
      expect(
        paths.reduce((sum, p) => sum + p.probability * p.lossHours, 0),
      ).toBeCloseTo(lossPerEvent(m), 12);
    }
  });
});

describe("措施生效规则", () => {
  it("措施按参数生效且与顺序无关；检出率的降低作用在漏检率上", () => {
    const model = tiny();
    model.measures.push(
      measure(
        "x",
        "detect",
        ["b1"],
        [{ param: "coverage", op: "reduce", value: 0.5 }],
      ),
      measure(
        "y",
        "prevent",
        ["a1"],
        [{ param: "fit", op: "set", value: 20000 }],
      ),
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
    expect(lossPerEvent(forward.modes[1])).toBeCloseTo(0.1 * 10 + 1, 12);
  });
  it("措施可以启用恢复阶梯里的一级，并不改动原模型", () => {
    const model = tiny();
    model.measures = [
      measure(
        "replay",
        "recover",
        ["a1"],
        [
          { param: "replay.success", op: "set", value: 0.8 },
          { param: "replay.hours", op: "set", value: 0.1 },
          { param: "replay.failHours", op: "set", value: 0.2 },
        ],
      ),
    ];
    const mode = applyMeasures(model).modes[0];
    expect(mode.ladder.replay).toMatchObject({
      success: 0.8,
      hours: 0.1,
      failHours: 0.2,
      rollback: false,
    });
    // 检测 0.2 + 重执行 (0.8×0.1 + 0.2×0.2) + 余下 20% 走全局恢复 0.5 并回滚 0.3
    expect(lossPerEvent(mode)).toBeCloseTo(0.2 + 0.12 + 0.2 * 0.8, 12);
    expect(model.modes[0].ladder.replay.success).toBe(0);
  });
  it("适用比例在现值与目标值之间折算", () => {
    const model = tiny();
    model.measures = [
      measure(
        "half",
        "recover",
        ["a1"],
        [
          { param: "restart.hours", op: "set", value: 0.1 },
          { param: "fit", op: "reduce", value: 0.4 },
          { param: "coverage", op: "set", value: 0.5 },
        ],
        { applicability: 0.5 },
      ),
    ];
    const mode = applyMeasures(model).modes[0];
    expect(mode.ladder.restart.hours).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.1, 12);
    expect(mode.fit).toBeCloseTo(50000 * (1 - 0.5 * 0.4), 9);
    // 目标值比现值差时也照常折算，不会被忽略
    expect(mode.coverage).toBeCloseTo(0.75, 12);
    model.measures[0].applicability = 0;
    expect(applyMeasures(model).modes[0]).toEqual(model.modes[0]);
  });
  it("多项“设为”取最好的一项，“增加”逐项累加并受上下限约束", () => {
    const model = tiny();
    model.measures = [
      measure(
        "s1",
        "recover",
        ["b1"],
        [{ param: "restart.hours", op: "set", value: 0.6 }],
      ),
      measure(
        "s2",
        "recover",
        ["b1"],
        [{ param: "restart.hours", op: "set", value: 0.4 }],
      ),
      measure(
        "a1",
        "checkpoint",
        ["b1"],
        [
          { param: "restart.hours", op: "add", value: 0.05 },
          { param: "overhead", op: "add", value: 0.01 },
        ],
      ),
      measure(
        "a2",
        "detect",
        ["b1"],
        [
          { param: "overhead", op: "add", value: 0.02 },
          { param: "coverage", op: "add", value: 0.9 },
        ],
      ),
    ];
    const resolved = applyMeasures(model);
    expect(resolved.modes[1].ladder.restart.hours).toBeCloseTo(0.45, 12);
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
      ids.slice(0, 7),
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
      // 直接指定目标的模块不受分配方法影响
      const site = result.modules.find((m) => m.id === "site-power")!;
      expect(site.pinned, method).toBe(true);
      expect(site.availability, method).toBeCloseTo(0.99999, 12);
    }
  });
  it("指定目标的模块先扣除预算，其余模块分剩下的部分", () => {
    const model = tiny(),
      budget = 1 / 0.9 - 1;
    model.modules[1].fixedTarget = 0.95;
    const result = allocate(model, "agree");
    expect(result.pinnedLoad).toBeCloseTo(1 / 0.95 - 1, 12);
    expect(result.freeLoad).toBeCloseTo(budget - (1 / 0.95 - 1), 12);
    expect(result.modules[1]).toMatchObject({ pinned: true });
    expect(result.modules[1].availability).toBeCloseTo(0.95, 12);
    expect(result.modules[0].load).toBeCloseTo(result.freeLoad, 12);
    expect(result.feasible).toBe(true);
    // 指定的目标比系统总预算还宽松时，其余模块无预算可分，目标不可达
    model.modules[1].fixedTarget = 0.85;
    const over = allocate(model, "agree");
    expect(over.feasible).toBe(false);
    expect(over.modules[0].load).toBe(0);
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
  it("给出频次与单次损失两个方向的等价要求，并按损失负荷判定差距", () => {
    const model = tiny(),
      baseline = assess(model, applyMeasures(model, new Set())),
      result = allocate(model, "agree", baseline),
      a = result.modules[0],
      rows = gaps(baseline, result);
    // 模块 A：ρ* = 0.0556；MTTR 不变（1 h）时 MTBF ≥ 18 h；故障率不变时 MTTR ≤ 0.556 h
    expect(a.minMtbfHours).toBeCloseTo(1 / a.load, 9);
    expect(a.maxMttrHours).toBeCloseTo(a.load / 0.1, 9);
    expect(a.maxFitPerCard).toBeCloseTo(((a.load / 1) * 1e9) / 1000, 6);
    // 允许频次（次/周）= 允许事件率 × 目标状态下每周的运行小时
    expect(a.maxEventsPerWeek).toBeCloseTo(
      (a.load / 1) * (168 / (1 + result.load)),
      9,
    );
    expect(a.lossHoursPerWeek).toBeCloseTo(a.lossHours * 1.68, 12);
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

describe("规模与目标、高后果事件", () => {
  const curve = [
    { cards: 100000, target: 0.99 },
    { cards: 500000, target: 0.95 },
  ];
  it("目标按“损失负荷正比于规模”换算，不是线性插值", () => {
    expect(targetFromCurve(curve, 100000)).toBeCloseTo(0.99, 12);
    expect(targetFromCurve(curve, 500000)).toBeCloseTo(0.95, 12);
    // 两个目标对应的每万卡损失负荷几乎相同：1.010‰ 与 1.053‰
    expect(loadPerTenThousand(curve[0]) * 1000).toBeCloseTo(1.0101, 3);
    expect(loadPerTenThousand(curve[1]) * 1000).toBeCloseTo(1.0526, 3);
    // 范围之外沿用端点的每卡损失负荷：A = 1/(1 + k·N)
    expect(targetFromCurve(curve, 1000000)).toBeCloseTo(
      1 / (1 + 2 * (1 / 0.95 - 1)),
      12,
    );
    expect(targetFromCurve(curve, 10000)).toBeCloseTo(
      1 / (1 + 0.1 * (1 / 0.99 - 1)),
      12,
    );
    // 中间规模：高于两点连线的线性插值（97%）
    const middle = targetFromCurve(curve, 300000)!;
    expect(middle).toBeLessThan(0.97);
    expect(middle).toBeGreaterThan(0.9695);
    expect(targetFromCurve([], 1000)).toBeNull();
  });
  it("单次损失占窗口预算三分之一以上的事件单独列出，并给出窗口风险", () => {
    const model = tiny(),
      rows = consequences(model, applyMeasures(model, new Set()));
    // B 的漏检路径：单次 10 + 1 = 11 h，窗口预算 10 h；每窗口 0.05×0.2×100 = 1 次
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "b" });
    expect(rows[0].worstLossHours).toBeCloseTo(11, 12);
    expect(rows[0].budgetShare).toBeCloseTo(1.1, 12);
    expect(rows[0].eventsPerWindow).toBeCloseTo(1, 12);
    expect(rows[0].windowRisk).toBeCloseTo(1 - Math.exp(-1), 12);
    // 建议目标：允许 (1 − 0.9)/2 = 5% 的窗口被这类事件打断
    const rate = -Math.log(0.95) / 100;
    expect(rows[0].suggestedTarget).toBeCloseTo(1 / (1 + rate * 11), 12);
    // 每个窗口发生很多次的事件不算：窗口损失接近平均值，按平均分预算即可
    const frequent = tiny();
    frequent.modes[1].fit *= 5;
    expect(consequences(frequent, applyMeasures(frequent, new Set()))).toEqual(
      [],
    );
    // 默认场景（恢复能力按当前设计计）：静默故障的漏检分支和机房供电
    expect(
      consequences(defaultCoreModel())
        .map((row) => row.id)
        .sort(),
    ).toEqual(["aicore", "site-power", "software"]);
  });
});

describe("设计：贡献分摊、推荐与参数反推", () => {
  it("Shapley 分摊之和等于设计后与现状之差", () => {
    const model = defaultCoreModel();
    model.measures.forEach((m, index) => (m.enabled = index < 12));
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
    for (const m of model.measures) m.enabled = true;
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
  it("默认场景：用户给出的措施不足，采用推荐的补充措施后达标", () => {
    const model = defaultCoreModel(),
      result = analyze(model);
    expect(model.measures.length).toBeGreaterThanOrEqual(29);
    expect(model.measures.filter((m) => m.enabled).map((m) => m.id)).toEqual([
      "hbm-ecc",
      "optical-reliability",
      "sdc-detection",
      "slow-detect",
      "elastic-recover",
      "fault-agent",
      "fast-checkpoint",
    ]);
    // 用户 2026-11-26 给定：现状 MTBF 17 分钟（50 万卡，每卡 7059 FIT），HBM、NPU 其他模块各占 15%；
    // 只改进光模块（做到每卡 50 FIT）后 MTBF 为 36 分钟，由此反推光模块现状 3775 FIT，占 53.5%
    const fitAt = (minutes: number) => 1e9 / ((minutes / 60) * 500000),
      total = fitAt(17),
      fitOf = (id: string, state = result.baseline) =>
        state.modules.find((m) => m.id === id)!.fitPerCard;
    expect(result.baseline.system.mtbfHours * 60).toBeCloseTo(17, 2);
    expect(result.baseline.system.fitPerCard).toBeCloseTo(total, 0);
    expect(fitOf("hbm")).toBeCloseTo(total * 0.15, 9);
    expect(fitOf("npu")).toBeCloseTo(total * 0.15, 9);
    expect(fitOf("optical")).toBeCloseTo(total - fitAt(36) + 50, 9);
    expect(fitOf("optical") / result.baseline.system.fitPerCard).toBeCloseTo(
      0.535,
      3,
    );
    const opticalOnly = structuredClone(model);
    for (const m of opticalOnly.measures)
      m.enabled = m.id === "optical-reliability";
    expect(analyze(opticalOnly).design.system.mtbfHours * 60).toBeCloseTo(
      36,
      2,
    );
    // 再做 HBM 纠错（降低 60%，1059 → 424 FIT）：每卡 2698 FIT，MTBF 44.48 分钟
    expect(fitOf("hbm", result.design)).toBeCloseTo(total * 0.15 * 0.4, 9);
    expect(fitOf("optical", result.design)).toBeCloseTo(50, 9);
    expect(result.design.system.fitPerCard).toBeCloseTo(2698.1, 0);
    expect(result.design.system.mtbfHours * 60).toBeCloseTo(44.48, 2);
    // 中断类故障的检出率按 100% 计，不再有“故障检测”措施
    for (const mode of model.modes.filter((m) => m.kind === "hard"))
      expect(mode.coverage, mode.id).toBe(1);
    expect(model.measures.map((m) => m.id)).not.toContain("fast-detect");
    // 现状没有弹性恢复：进程重调度失败后直接走 CKPT 回滚，不是全部转人工
    expect(
      recoveryRoute(model.modes.find((m) => m.id === "hbm-uce")!.ladder).map(
        (step) => step.level,
      ),
    ).toEqual(["process", "restart", "manual"]);
    expect(result.baseline.system.availability).toBeCloseTo(0.4513, 3);
    expect(result.baseline.system.mttrHours * 60).toBeCloseTo(20.42, 1);
    expect(result.design.system.availability).toBeCloseTo(0.7458, 3);
    expect(result.design.system.mttrHours * 60).toBeCloseTo(15.11, 1);
    // 到 95% 允许的单次等效损失：(（1 − 开销）/ 0.95 − 1) × MTBF ≈ 2.30 分钟
    expect(
      ((1 - result.design.system.overhead) / 0.95 - 1) *
        result.design.system.mtbfHours *
        60,
    ).toBeCloseTo(2.3, 2);
    // 进程重调度默认“暂不优化”，改进前后保持 0.3 / 240 秒；其余措施全做也到不了目标
    const process = model.measures.find((m) => m.id === "fast-recover")!;
    expect(model.measures.filter((m) => m.hold)).toEqual([process]);
    expect(process.effects.map((e) => e.value)).toEqual([
      0.3,
      seconds(240),
      seconds(240),
    ]);
    expect(result.recommendation.kind).toBe("short");
    expect(result.recommendation.held).toEqual(["fast-recover"]);
    expect(result.recommendation.add).not.toContain("fast-recover");
    expect(result.recommendation.ceiling).toBeCloseTo(0.9161, 3);
    expect(result.recommendation.heldGain).toBeCloseTo(0, 12);
    expect(priorityPath(model).steps.map((s) => s.id)).not.toContain(
      "fast-recover",
    );
    // 剩余损失最大的一级正是进程重调度：这一级不动，到不了目标
    const all = new Set(priorityPath(model).steps.map((s) => s.id)),
      stages = loadByStage(assess(model, applyMeasures(model, all)));
    expect(stages[0].id).toBe("process");
    expect(stages.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 12);
    expect(stages.reduce((sum, s) => sum + s.load, 0)).toBeCloseTo(
      assess(model, applyMeasures(model, all)).system.load,
      12,
    );
    // 把进程重调度做到设计目标（成功率 0.95、60 秒）并纳入设计后，推荐的补充措施可以达标
    process.effects[0].value = 0.95;
    process.effects[1].value = seconds(60);
    process.effects[2].value = seconds(60);
    process.hold = false;
    const released = analyze(model).recommendation;
    expect(released.kind).toBe("add");
    expect(released.add).toContain("fast-recover");
    expect(released.held).toEqual([]);
    expect(released.availability).toBeCloseTo(0.9512, 3);
    const adopted = structuredClone(model);
    for (const m of adopted.measures)
      if (released.add.includes(m.id)) m.enabled = true;
    const after = analyze(adopted);
    expect(after.recommendation.kind).toBe("met");
    expect(after.design.system.availability).toBeCloseTo(
      released.availability,
      12,
    );
    // 推荐的每一项都不可少：去掉任何一项都会低于目标
    for (const id of released.add) {
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
    // 加上 m-cov：ρ = 0.05 + 0.05×(0.05×10 + 1) = 0.125，达标
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
    // 全部启用：ρ = 0.125；允许 0.0101
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
  it("改进程度—收益曲线从现状走到理想极限", () => {
    const model = tiny(),
      curve = doseResponse(model, "m-cov")!;
    // 检出率 0.8 → 1；计划值 0.95 相当于走了 75%
    expect(curve.planned).toBeCloseTo(0.75, 12);
    expect(curve.points).toHaveLength(11);
    expect(curve.points[0]).toMatchObject({ degree: 0, value: 0.8, gain: 0 });
    // 做到极限：B 的单次损失降到 1 h，ρ = 0.05 + 0.05 = 0.1；不做时 ρ = 0.2
    expect(curve.points[10].value).toBeCloseTo(1, 12);
    expect(curve.points[10].gain).toBeCloseTo(1 / 1.1 - 1 / 1.2, 12);
    expect(curve.plannedGain).toBeCloseTo(1 / 1.125 - 1 / 1.2, 12);
    for (let i = 1; i < curve.points.length; i++)
      expect(curve.points[i].gain).toBeGreaterThan(curve.points[i - 1].gain);
    // “按比例降低”的措施：起点 0，极限 100%
    const fit = doseResponse(model, "m-fit")!;
    expect(fit.planned).toBeCloseTo(0.5, 12);
    expect(fit.points[10].value).toBe(1);
  });
  it("组合收益路径每一步加入提升最大的措施", () => {
    const model = tiny(),
      path = priorityPath(model);
    expect(path.base).toBeCloseTo(1 / 1.25, 12);
    // 先做 m-cov（ρ=0.175）比先做 m-fit（ρ=0.2）提升更大
    expect(path.steps.map((s) => s.id)).toEqual(["m-cov", "m-fit"]);
    expect(path.steps[0].availability).toBeCloseTo(1 / 1.175, 12);
    expect(path.steps[1].availability).toBeCloseTo(1 / 1.125, 12);
    expect(path.steps[1].gain).toBeCloseTo(1 / 1.125 - 1 / 1.175, 12);
    expect(path.reachedAt).toBeNull();
    // 第二步的收益比单独做大：前一步削掉了别的损失，同一段损失折算成的可用度更多
    expect(path.steps[0].standalone).toBeCloseTo(path.steps[0].gain, 12);
    expect(path.steps[0].partner).toBeNull();
    expect(path.steps[1].standalone).toBeCloseTo(1 / 1.2 - 1 / 1.25, 12);
    expect(path.steps[1].partner).toMatchObject({ id: "m-cov", kind: "boost" });
    expect(path.steps[1].partner!.gainWithout).toBeCloseTo(
      path.steps[1].standalone,
      12,
    );
    model.scenario.target = 0.85;
    expect(priorityPath(model).reachedAt).toBe(1);
  });
  it("两项措施省同一段损失时，后做的一项收益变小并指出与谁重叠", () => {
    const model = tiny();
    // 两项都缩短 A1 的 CKPT 回滚时间：0.5 h → 0.1 h 与 0.5 h → 0.2 h，只有更好的一项起作用
    model.measures = [
      measure(
        "big",
        "recover",
        ["a1"],
        [{ param: "restart.hours", op: "set", value: 0.1 }],
      ),
      measure(
        "small",
        "recover",
        ["a1"],
        [{ param: "restart.hours", op: "set", value: 0.2 }],
      ),
      measure(
        "other",
        "detect",
        ["b1"],
        [{ param: "coverage", op: "set", value: 0.81 }],
      ),
    ];
    const path = priorityPath(model);
    expect(path.steps[0].id).toBe("big");
    // small 排在 big 之后没有任何提升，不进入路径
    expect(path.steps.map((s) => s.id)).toEqual(["big", "other"]);
    model.measures[1].effects.push({
      param: "detectHours",
      op: "set",
      value: 0.1,
    });
    const again = priorityPath(model),
      small = again.steps.find((s) => s.id === "small")!;
    expect(small.gain).toBeLessThan(small.standalone);
    expect(small.partner).toMatchObject({ id: "big", kind: "overlap" });
    expect(small.partner!.gainWithout).toBeGreaterThan(small.gain);
  });
  it("暂不优化的措施不进入推荐、组合路径和潜力估算，启用后恢复参与", () => {
    const model = tiny();
    model.scenario.target = 0.85;
    expect(recommend(model).kind).toBe("add");
    expect(layerPotential(model).get("b")!.system).toBeCloseTo(0.5, 12);
    model.measures[1].hold = true;
    const held = recommend(model);
    expect(held.kind).toBe("short");
    expect(held.add).toEqual([]);
    expect(held.held).toEqual(["m-cov"]);
    expect(held.ceiling).toBeCloseTo(1 / 1.2, 12);
    expect(held.heldGain).toBeCloseTo(1 / 1.125 - 1 / 1.2, 12);
    const path = priorityPath(model);
    expect(path.steps.map((s) => s.id)).toEqual(["m-fit"]);
    expect(path.held).toEqual(["m-cov"]);
    expect(layerPotential(model).get("b")!.system).toBe(0);
    // 已经启用的措施不再算“暂不优化”
    model.measures[1].enabled = true;
    expect(recommend(model).kind).toBe("met");
    expect(priorityPath(model).steps).toHaveLength(2);
  });
  it("单个参数的取值—收益曲线：其余不变，从不改扫到理想极限", () => {
    const model = tiny(),
      coverage = effectSweep(model, "m-cov", 0, 2)!;
    // m-fit 已启用（ρ_A = 0.05）；检出率 0.8 / 0.9 / 1 → ρ_B = 0.15 / 0.1 / 0.05
    expect(coverage).toMatchObject({ start: 0.8, limit: 1, planned: 0.95 });
    expect(coverage.points.map((p) => p.value)).toEqual([0.8, 0.9, 1]);
    expect(coverage.points[0].availability).toBeCloseTo(1 / 1.2, 12);
    expect(coverage.points[1].availability).toBeCloseTo(1 / 1.15, 12);
    expect(coverage.points[2].availability).toBeCloseTo(1 / 1.1, 12);
    expect(coverage.plannedAvailability).toBeCloseTo(1 / 1.125, 12);
    expect(coverage.without).toBeCloseTo(1 / 1.2, 12);
    // 按比例降低：0 即不降，1 即降到 0；这里 m-cov 没有启用（ρ_B = 0.15）
    const rate = effectSweep(model, "m-fit", 0, 2)!;
    expect(rate).toMatchObject({ start: 0, limit: 1, planned: 0.5 });
    expect(rate.points[0].availability).toBeCloseTo(1 / 1.25, 12);
    expect(rate.points[2].availability).toBeCloseTo(1 / 1.15, 12);
    expect(rate.without).toBeCloseTo(1 / 1.25, 12);
    expect(effectSweep(model, "m-fit", 3)).toBeNull();
    expect(effectSweep(model, "missing")).toBeNull();
  });
  it("给出每项措施至少要做到计划的几成", () => {
    const model = tiny();
    model.scenario.target = 0.85; // 允许 ρ = 0.17647
    const degrees = minimumDegrees(model, ["m-fit", "m-cov"]);
    // m-cov 做足时 ρ_B = 0.075；m-fit 不做 ρ = 0.175 仍达标
    expect(degrees.get("m-fit")).toBe(0);
    // m-fit 做足 ρ_A = 0.05；m-cov 兑现 s 成：ρ = 0.2 − 0.075 s ≤ 0.17647
    expect(degrees.get("m-cov")).toBeCloseTo((0.2 - (1 / 0.85 - 1)) / 0.075, 6);
    model.scenario.target = 0.95;
    expect(minimumDegrees(model, ["m-fit", "m-cov"]).get("m-cov")).toBeNull();
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
  it("多级恢复阶梯与部分影响范围下，仿真与解析仍一致", () => {
    const model = tiny();
    model.scenario.hours = 2000;
    model.modes[0].impact = 0.5;
    model.modes[0].ladder = makeLadder({
      replay: { success: 0.6, hours: 0.05, failHours: 0.1 },
      elastic: { success: 0.7, hours: 1, failHours: 0.4, impact: 0.2 },
      restart: { success: 0.9, hours: 0.5, failHours: 0.5 },
      manual: { success: 1, hours: 3 },
    });
    const parameters = applyMeasures(model, new Set()),
      analytic = assess(model, parameters),
      simulated = simulate(model, parameters, 4000, 5);
    expect(
      Math.abs(simulated.mean - analytic.system.availability),
    ).toBeLessThan(4 * simulated.standardError + 0.002);
    expect(
      simulated.moduleLossHours.a / analytic.modules[0].lossHours,
    ).toBeCloseTo(1, 1);
    expect(simulated.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(
      4000,
    );
  });
  it("达标设计通过均值与一致性判定，未实测的措施只给出提醒", () => {
    const model = defaultCoreModel(),
      process = model.measures.find((m) => m.id === "fast-recover")!;
    process.effects[0].value = 0.95;
    process.effects[1].value = seconds(60);
    process.effects[2].value = seconds(60);
    process.hold = false;
    // 把有提升的措施都用上，留出约 1 个百分点的余量，均值判定才稳定
    const add = priorityPath(model).steps.map((step) => step.id);
    for (const m of model.measures) m.enabled = m.enabled || add.includes(m.id);
    model.allocation.method = "arinc";
    const result = verify(model, { trials: 1500, seed: 99 });
    expect(result.modelHash).toBe(modelHash(model));
    expect(result.design.mean).toBeGreaterThan(0.95);
    expect(result.checks.find((c) => c.id === "mean")!.state).toBe("pass");
    expect(result.checks.find((c) => c.id === "consistency")!.state).toBe(
      "pass",
    );
    expect(result.checks.find((c) => c.id === "evidence")!.state).toBe("warn");
    expect(result.baseline.mean).toBeLessThan(0.55);
    expect(result.baseline.mean).toBeGreaterThan(0.35);
    expect(result.seed).toBe(99);
  });
  it("指纹只随数值参数变化", () => {
    const model = defaultCoreModel(),
      before = modelHash(model);
    model.modules[0].note = "只改说明";
    model.modules[0].anchor = "";
    model.measures[0].rationale = "只改说明";
    model.measures[0].category = "recover";
    model.measures[0].hold = !model.measures[0].hold;
    expect(modelHash(model)).toBe(before);
    model.modes[0].ladder.restart.hours += 0.001;
    expect(modelHash(model)).not.toBe(before);
  });
});

describe("模型校验与早期模型", () => {
  it("默认模型合法，引用缺失和越界参数被拒绝", () => {
    expect(coreModelSchema.safeParse(defaultCoreModel()).success).toBe(true);
    const broken = defaultCoreModel();
    broken.modes[0].moduleId = "missing";
    expect(coreModelSchema.safeParse(broken).success).toBe(false);
    const ratio = defaultCoreModel();
    ratio.measures[0].effects[0].value = 1.5;
    expect(coreModelSchema.safeParse(ratio).success).toBe(false);
    const extra = { ...defaultCoreModel(), unknown: 1 };
    expect(coreModelSchema.safeParse(extra).success).toBe(false);
    for (const module of defaultCoreModel().modules)
      expect(diagramSlots, module.id).toContain(module.anchor);
  });
  it("早期保存的模型整理成当前结构后数值不变", () => {
    // 第一版：单一恢复时间、漏检分支总损失、措施按方向分类、没有适用比例
    const legacy = {
      schemaVersion: coreModelVersion,
      name: "早期模型",
      scenario: {
        cards: 1000,
        hours: 100,
        target: 0.9,
        overhead: 0,
        passRatio: 0.9,
      },
      groups: [{ id: "g", name: "组", layout: "chain" }],
      modules: [
        {
          id: "hbm",
          groupId: "g",
          name: "HBM",
          unitsPerCard: 1,
          importance: 1,
          complexity: null,
          container: "NPU 模组",
          note: "",
        },
      ],
      modes: [
        {
          id: "m",
          moduleId: "hbm",
          name: "M",
          kind: "hard",
          fit: 100000,
          coverage: 0.9,
          detectHours: 0.2,
          recoverHours: 0.5,
          reworkHours: 0.3,
          missedLossHours: 9,
          impact: 1,
          evidence: "",
        },
      ],
      measures: [
        {
          id: "fast",
          name: "更快恢复",
          direction: "mttr",
          modeIds: ["m"],
          effects: [{ param: "recoverHours", op: "set", value: 0.1 }],
          enabled: true,
          evidence: "assumed",
          rationale: "",
        },
        {
          id: "late",
          name: "更早发现漏检",
          direction: "mttr",
          modeIds: ["m"],
          effects: [{ param: "missedLossHours", op: "set", value: 4 }],
          enabled: false,
          evidence: "assumed",
          rationale: "",
        },
        {
          id: "ecc",
          name: "纠错",
          direction: "mtbf",
          modeIds: ["m"],
          effects: [{ param: "fit", op: "reduce", value: 0.5 }],
          enabled: false,
          evidence: "assumed",
          rationale: "",
        },
      ],
      allocation: {
        method: "agree",
        complexityBasis: "fit",
        customWeights: {},
      },
      source: "",
    };
    expect(coreModelSchema.safeParse(legacy).success).toBe(false);
    const upgraded = parseCoreModel(legacy);
    expect(legacy.modes[0].missedLossHours).toBe(9); // 不改动传入的对象
    const mode = upgraded.modes[0];
    // 原来的单次损失：0.9×(0.2+0.5+0.3) + 0.1×9 = 1.8 小时
    expect(lossPerEvent(mode)).toBeCloseTo(1.8, 12);
    expect(mode.lateDetectHours).toBeCloseTo(8.2, 12);
    expect(mode.ladder.restart).toMatchObject({ success: 1, hours: 0.5 });
    expect(upgraded.modules[0]).toMatchObject({
      anchor: "hbm",
      scaling: "per-card",
      fixedTarget: null,
    });
    expect(upgraded.groups[0]).toEqual({ id: "g", name: "组" });
    expect(upgraded.measures.map((m) => m.category)).toEqual([
      "recover",
      "detect",
      "prevent",
    ]);
    expect(upgraded.measures[0]).toMatchObject({
      applicability: 1,
      source: "",
    });
    expect(upgraded.measures[0].effects[0].param).toBe("restart.hours");
    expect(upgraded.measures[1].effects[0].param).toBe("lateDetectHours");
    expect(upgraded.scenario.targetCurve).toEqual([
      { cards: 1000, target: 0.9 },
    ]);
    // 启用“更快恢复”后：0.9×(0.2+0.1+0.3) + 0.1×(8.2+0.1+0.3) = 1.4 小时
    expect(lossPerEvent(applyMeasures(upgraded).modes[0])).toBeCloseTo(1.4, 12);
  });
});

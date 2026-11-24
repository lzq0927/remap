import { expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { defaultCoreModel, modelHash } from "../../packages/core/src/index";

it("四步工作台：按任务保存模型、返回解析结果并留存独立验证记录", async () => {
  const app = await buildApp({
    dataDir: ":memory:",
    seed: false,
    autoStartRuns: false,
  });
  try {
    const task = app.taskServices.create("四步工作台"),
      other = app.taskServices.create("另一个任务"),
      path = `/api/tasks/${task.id}/core`;
    const initial = (await app.inject(path)).json();
    expect(initial.revision).toBe(0);
    expect(initial.model).toEqual(defaultCoreModel());
    expect(initial.verification).toBeNull();

    const model = defaultCoreModel();
    model.scenario.target = 0.85;
    model.measures.find((m) => m.id === "elastic-recover")!.enabled = true;
    const saved = await app.inject({
      method: "PUT",
      url: path,
      payload: { model },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ revision: 1, hash: modelHash(model) });
    expect((await app.inject(path)).json().model.scenario.target).toBe(0.85);
    // 任务之间互不影响
    expect(
      (await app.inject(`/api/tasks/${other.id}/core`)).json().revision,
    ).toBe(0);

    // 早期保存的模型字段与现在不同，读取时整理成当前结构，不丢数据
    const store = app.taskServices.resolve(task.id).store,
      legacy = JSON.parse(JSON.stringify(model));
    for (const group of legacy.groups) group.layout = "chain";
    for (const module of legacy.modules) {
      delete module.anchor;
      delete module.scaling;
      delete module.fixedTarget;
      module.container = "";
    }
    for (const mode of legacy.modes) {
      const restart = mode.ladder.restart.hours;
      mode.recoverHours = restart;
      mode.missedLossHours = mode.lateDetectHours + restart + mode.reworkHours;
      delete mode.lateDetectHours;
      delete mode.ladder;
    }
    legacy.measures = legacy.measures
      .filter((m: any) => m.effects.every((e: any) => !e.param.includes(".")))
      .map(({ category, applicability: _a, source: _s, ...rest }: any) => ({
        ...rest,
        direction: category === "prevent" ? "mtbf" : "mttr",
      }));
    delete legacy.scenario.targetCurve;
    store.putDocument(
      "core-model",
      { model: legacy, revision: 1, savedAt: "2026-11-17T00:00:00.000Z" },
      "core-model",
    );
    const upgraded = (await app.inject(path)).json();
    expect(upgraded.model.scenario.target).toBe(0.85);
    expect(upgraded.model.scenario.targetCurve).toEqual([
      { cards: 500000, target: 0.85 },
    ]);
    expect(upgraded.model.groups[1]).toEqual({ id: "network", name: "网络" });
    expect(upgraded.model.modules[0]).toMatchObject({
      anchor: "aicore",
      scaling: "per-card",
      fixedTarget: null,
    });
    expect(upgraded.model.modes[0].ladder.restart).toMatchObject({
      success: 1,
    });
    expect(upgraded.model.measures[0]).toMatchObject({
      category: "prevent",
      applicability: 1,
    });
    expect(upgraded.hash).toBe(modelHash(upgraded.model));
    await app.inject({ method: "PUT", url: path, payload: { model } });

    const analysis = (await app.inject(path + "/analysis")).json();
    expect(analysis.hash).toBe(modelHash(model));
    expect(analysis.design.system.availability).toBeGreaterThan(0.85);
    expect(analysis.recommendation.kind).toBe("met");

    const verified = await app.inject({
      method: "POST",
      url: path + "/verify",
      payload: { trials: 400, seed: 11 },
    });
    expect(verified.statusCode, verified.body).toBe(201);
    const result = verified.json();
    expect(result).toMatchObject({
      sequence: 1,
      modelRevision: 2,
      seed: 11,
      trials: 400,
    });
    expect(result.modelHash).toBe(modelHash(model));
    expect(result.checks.map((c: any) => c.id)).toEqual([
      "mean",
      "windows",
      "consistency",
      "modules",
      "evidence",
    ]);
    // 同一种子可复现；记录按顺序累加
    const again = (
      await app.inject({
        method: "POST",
        url: path + "/verify",
        payload: { trials: 400, seed: 11 },
      })
    ).json();
    expect(again.design.mean).toBe(result.design.mean);
    expect(again.sequence).toBe(2);
    const latest = (await app.inject(path)).json();
    expect(latest.verificationCount).toBe(2);
    expect(latest.verification.id).toBe(again.id);

    const invalid = defaultCoreModel();
    invalid.modes[0].moduleId = "missing";
    const rejected = await app.inject({
      method: "PUT",
      url: path,
      payload: { model: invalid },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("SCHEMA_INVALID");
    expect(
      (
        await app.inject({
          method: "POST",
          url: path + "/verify",
          payload: { trials: 5 },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject(path)).json().revision).toBe(2);

    // 规模过大的仿真在运行前被拒绝，并提示可行的窗口数
    const huge = defaultCoreModel();
    huge.scenario.cards = 10000000;
    huge.scenario.hours = 8760;
    await app.inject({ method: "POST", url: path, payload: { model: huge } });
    const tooLarge = await app.inject({
      method: "POST",
      url: path + "/verify",
      payload: { trials: 20000 },
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().error.code).toBe("SIMULATION_TOO_LARGE");
    expect((await app.inject(path)).json().verificationCount).toBe(2);

    const reset = (
      await app.inject({ method: "POST", url: path + "/reset", payload: {} })
    ).json();
    expect(reset.revision).toBe(4);
    expect(reset.model).toEqual(defaultCoreModel());
  } finally {
    await app.close();
  }
});

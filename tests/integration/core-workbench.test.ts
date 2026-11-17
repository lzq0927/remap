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
    model.scenario.target = 0.9;
    model.measures.find((m) => m.id === "elastic-recover")!.enabled = true;
    const saved = await app.inject({
      method: "PUT",
      url: path,
      payload: { model },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ revision: 1, hash: modelHash(model) });
    expect((await app.inject(path)).json().model.scenario.target).toBe(0.9);
    // 任务之间互不影响
    expect(
      (await app.inject(`/api/tasks/${other.id}/core`)).json().revision,
    ).toBe(0);

    const analysis = (await app.inject(path + "/analysis")).json();
    expect(analysis.hash).toBe(modelHash(model));
    expect(analysis.design.system.availability).toBeGreaterThan(0.9);
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
      modelRevision: 1,
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
    expect((await app.inject(path)).json().revision).toBe(1);

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
    expect(reset.revision).toBe(3);
    expect(reset.model).toEqual(defaultCoreModel());
  } finally {
    await app.close();
  }
});

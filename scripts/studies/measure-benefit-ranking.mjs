// Exact Shapley over the nine changed parameter groups, with paired DES trials.
// Usage: node scripts/studies/measure-benefit-ranking.mjs INPUT_DIR OUTPUT_JSON [WORKERS]
// This is a diagnostic study. It never modifies task inputs or saved runs.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import createEngine from "../../packages/solvers/src/vendor/review-engine.cjs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fields = [
  "downtime",
  "rollback",
  "slowdown",
  "localLoss",
  "terminalInvalid",
  "save",
  "mechanismOverhead",
];
const groups = [
  {
    id: "checkpoint",
    name: "极致CKPT",
    category: "回滚与保存开销",
    model: ["checkpointComputeSeconds", "checkpointSaveSeconds"],
    policy: ["C-FAST"],
    parameter: "周期600→1s；保存阻塞4→0s",
    action:
      "异步/分层检查点、内存暂存与恢复读取协同；零阻塞与1s周期是情景假设，需验收持久化滞后和可恢复性。",
  },
  {
    id: "sdc_detection",
    name: "静默故障在线检测",
    category: "正确性检测",
    model: [],
    policy: ["D-SDC"],
    parameter: "检出率80%→99.91%；检测均1s",
    action:
      "算子/端到端正确性校验、污染追溯与可信状态回退；新增检测开销仍需实测。",
  },
  {
    id: "fit_reduction",
    name: "器件与链路故障率治理",
    category: "增加MTBF",
    model: [],
    policy: [],
    rates: true,
    parameter: "选定9类中断事件FIT×0.4；集合MTBF18→45min",
    action:
      "器件筛查、纠错、链路治理及冗余设计候选。当前只量化这9类事件的合计残余故障率目标，无法再按具体工程技术拆分。集合包含IOD，不等于计算域或全系统MTBF。",
  },
  {
    id: "recovery_time",
    name: "自动恢复链提速",
    category: "降低MTTR·恢复",
    model: ["recoveryAttemptSeconds"],
    policy: [],
    parameter: "恢复链合计130→15s",
    action:
      "通信/建组60→8s、加载10→2s、编译60→5s，构建均0s；工程拆分共用同一恢复总时长，不重复计算收益。",
  },
  {
    id: "recovery_success",
    name: "自动恢复成功率提升",
    category: "降低MTTR·失败分支",
    model: ["recoverySuccess"],
    policy: [],
    parameter: "自动成功率99%→99.9%",
    action:
      "恢复编排、失败分类与自愈验证，减少升级人工的概率；99.9%仍是待验收参数。",
  },
  {
    id: "agent_manual",
    name: "Agent辅助人工诊断处置",
    category: "降低MTTR·人工分支",
    model: ["manualAdditionalSeconds"],
    policy: [],
    parameter: "人工追加4.5→1h；每次缩短3.5h",
    action:
      "遥测汇聚、根因候选、故障定界与恢复预案，仅缩短自动恢复失败后的人工追加耗时；不自动领取检测、自动成功率或静默追溯收益。",
  },
  {
    id: "hard_detection",
    name: "中断快速检测",
    category: "降低MTTR·检测",
    model: ["detectProbability", "detectSeconds"],
    policy: ["D-HARD"],
    parameter: "检出率95%→99.8%；60→1s；漏检超时仍60s",
    action: "硬件/软件遥测和故障检测联动；未检出的故障仍走60s超时。",
  },
  {
    id: "slow_detection",
    name: "亚健康检测与处置",
    category: "降速与检测",
    model: ["slowDetectProbability", "slowDetectHours"],
    policy: ["D-SLOW"],
    parameter: "检出率80%→97.5%；300→52.6s",
    action:
      "性能探针、定位与隔离，减少持续降速；检测触发的恢复停机也计入总损失。",
  },
  {
    id: "sdc_investigation",
    name: "静默漏检调查与追溯",
    category: "污染发现与回滚",
    model: ["sdcDelayHours"],
    policy: [],
    parameter: "漏检后发现168→24h",
    action:
      "离线校验、污染追溯和调查闭环。Agent可以参与，但此处单独列项，不能与人工分支收益混为一项。",
  },
];
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const summary = (values) => {
  const n = values.length,
    mean = values.reduce((a, b) => a + b, 0) / n;
  const se = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) / n,
  );
  return { mean, se, ciLow: mean - 1.96 * se, ciHigh: mean + 1.96 * se };
};
function inputs(dir) {
  return {
    current: read(path.join(dir, "current-audit-input.json")),
    target: read(path.join(dir, "breakthrough-audit-input.json")),
  };
}
function configuration(current, target, mask) {
  const model = structuredClone(current.config.model),
    policy = structuredClone(current.config.policy);
  let events = current.events;
  groups.forEach((g, i) => {
    if (!(mask & (1 << i))) return;
    for (const k of g.model) model[k] = structuredClone(target.config.model[k]);
    for (const k of g.policy)
      policy[k] = structuredClone(target.config.policy[k]);
    if (g.rates) events = target.events;
  });
  return { model, policy, events };
}
function simulate(current, target, mask, n, seed) {
  const c = configuration(current, target, mask),
    engine = createEngine(c.events, c.policy, c.model);
  const opts = Object.fromEntries(
    current.input.mechanisms.map((id) => [id, true]),
  );
  const p = engine.parameters(opts),
    losses = new Float64Array(n),
    ledger = Object.fromEntries(fields.map((k) => [k, 0])),
    counts = {};
  for (let i = 0; i < n; i++) {
    const r = engine.simulate(
      500000,
      2,
      (seed + Math.imul(i + 1, 2654435761)) >>> 0,
      p,
      opts,
    );
    losses[i] = (1 - r.usefulThroughput) * 600;
    const total = fields.reduce((sum, k) => sum + (r.ledger[k] ?? 0), 0);
    assert(
      Math.abs(total - losses[i]) < 1e-8,
      "Trial ledger must conserve the horizon",
    );
    for (const k of fields) ledger[k] += (r.ledger[k] ?? 0) / n;
    for (const [k, v] of Object.entries(r.counts))
      counts[k] = (counts[k] ?? 0) + v / n;
  }
  const loss = summary(losses);
  return {
    mask,
    loss,
    availability: 1 - loss.mean / 600,
    ledger,
    counts,
    losses,
  };
}
if (!isMainThread) {
  const { current, target } = inputs(workerData.dir);
  for (
    let mask = workerData.index;
    mask < 2 ** groups.length;
    mask += workerData.workers
  ) {
    const r = simulate(current, target, mask, workerData.n, workerData.seed);
    parentPort.postMessage(r, [r.losses.buffer]);
  }
} else {
  (async () => {
    const dir = path.resolve(process.argv[2]),
      out = path.resolve(process.argv[3]),
      workers = Number(process.argv[4] ?? 4);
    const { current, target } = inputs(dir),
      n = target.row.statistics.n,
      seed = target.input.seed,
      full = 2 ** groups.length - 1;
    assert.deepEqual(current.input.mechanisms, target.input.mechanisms);
    assert.equal(current.input.hours, 600);
    assert.equal(target.input.hours, 600);
    const reconstructed = configuration(current, target, full);
    assert.deepEqual(
      reconstructed.model,
      target.config.model,
      "All changed model parameters must be represented once",
    );
    assert.deepEqual(
      reconstructed.policy,
      target.config.policy,
      "All changed policies must be represented once",
    );
    assert.deepEqual(reconstructed.events, target.events);
    const keys = groups.flatMap((g) => g.model);
    assert.equal(keys.length, new Set(keys).size);
    const policyKeys = groups.flatMap((g) => g.policy);
    assert.equal(policyKeys.length, new Set(policyKeys).size);
    const results = new Array(full + 1);
    let done = 0;
    await Promise.all(
      Array.from(
        { length: workers },
        (_, index) =>
          new Promise((resolve, reject) => {
            const w = new Worker(__filename, {
              workerData: { dir, index, workers, n, seed },
            });
            w.on("message", (r) => {
              results[r.mask] = r;
              if (++done % 32 === 0)
                console.log(`Coalitions ${done}/${full + 1}`);
            });
            w.on("error", reject);
            w.on("exit", (code) =>
              code ? reject(new Error(`Worker exit ${code}`)) : resolve(),
            );
          }),
      ),
    );
    assert.equal(done, full + 1);
    const before = results[0],
      after = results[full];
    assert(
      Math.abs(after.availability - target.row.statistics.mean) < 1e-12,
      "Saved breakthrough endpoint must replay exactly",
    );
    const factorial = (k) => (k < 2 ? 1 : k * factorial(k - 1)),
      bitcount = (m) => m.toString(2).replaceAll("0", "").length;
    const delta = (a, b) => {
      const loss = summary(a.losses.map((v, i) => v - b.losses[i]));
      return {
        loss,
        availabilityGainPp: loss.mean / 6,
        ledger: Object.fromEntries(
          fields.map((k) => [k, a.ledger[k] - b.ledger[k]]),
        ),
      };
    };
    const contributions = groups.map((g, index) => {
      const bit = 1 << index,
        samples = new Float64Array(n),
        ledger = Object.fromEntries(fields.map((k) => [k, 0]));
      for (let mask = 0; mask <= full; mask++) {
        if (mask & bit) continue;
        const k = bitcount(mask),
          weight =
            (factorial(k) * factorial(groups.length - k - 1)) /
            factorial(groups.length);
        const a = results[mask],
          b = results[mask | bit];
        for (let j = 0; j < n; j++)
          samples[j] += weight * (a.losses[j] - b.losses[j]);
        for (const field of fields)
          ledger[field] += weight * (a.ledger[field] - b.ledger[field]);
      }
      const namedParameters = [
        ...g.model.map((k) => ({
          path: `model.${k}`,
          before: current.config.model[k],
          after: target.config.model[k],
        })),
        ...g.policy.flatMap((k) =>
          Object.keys(current.config.policy[k])
            .filter(
              (p) => current.config.policy[k][p] !== target.config.policy[k][p],
            )
            .map((p) => ({
              path: `policy.${k}.${p}`,
              before: current.config.policy[k][p],
              after: target.config.policy[k][p],
            })),
        ),
      ];
      if (g.rates)
        for (const a of current.events) {
          const b = target.events.find((e) => e.id === a.id);
          if (a.fit !== b.fit)
            namedParameters.push({
              path: `events.${a.id}.fit`,
              before: a.fit,
              after: b.fit,
            });
        }
      return {
        ...g,
        index,
        namedParameters,
        shapley: {
          loss: summary(samples),
          availabilityGainPp: summary(samples).mean / 6,
          ledger,
        },
        baselineOnly: {
          ...delta(before, results[bit]),
          availability: results[bit].availability,
          totalLoss: results[bit].loss.mean,
          counts: results[bit].counts,
        },
        necessity: {
          ...delta(results[full ^ bit], after),
          availabilityWithout: results[full ^ bit].availability,
          totalLossWithout: results[full ^ bit].loss.mean,
          countsWithout: results[full ^ bit].counts,
        },
        samples,
      };
    });
    for (let j = 0; j < n; j++)
      assert(
        Math.abs(
          contributions.reduce((s, r) => s + r.samples[j], 0) -
            (before.losses[j] - after.losses[j]),
        ) < 1e-8,
        "Shapley must conserve every paired trial",
      );
    const saved = read(path.join(dir, "presentation-data.json"));
    const beforeEntry = saved.comparison.entries.find((e) =>
      e.rows.some(
        (r) =>
          r.cards === 500000 &&
          Math.abs(r.statistics?.mean - current.row.statistics.mean) < 1e-12,
      ),
    );
    const afterEntry = saved.comparison.entries.find((e) =>
      e.rows.some(
        (r) =>
          r.cards === 500000 &&
          Math.abs(r.statistics?.mean - target.row.statistics.mean) < 1e-12,
      ),
    );
    assert(beforeEntry && afterEntry);
    const catalogue = read(path.join(dir, "expert-mechanism-catalog.json"));
    const manualBit = 1 << groups.findIndex((g) => g.id === "agent_manual"),
      investigationBit =
        1 << groups.findIndex((g) => g.id === "sdc_investigation");
    const report = {
      version: "measure-improvement-shapley-2026-11-02",
      cards: 500000,
      hours: 600,
      n,
      seed,
      coalitions: full + 1,
      method:
        "Exact nine-group Shapley; every coalition evaluated by DES with the same 1024 per-trial seeds. Conditional additions/removals are not additive.",
      uncertainty:
        "Normal 95% intervals over paired trajectories; coalition ordering is exact. Sampling uncertainty only, excludes model and parameter uncertainty. Seeds are shared, not identical physical fault traces after paths/exposure change.",
      sourceSha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(dir, "presentation-data.json")))
        .digest("hex"),
      engineSha256: crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(
            path.join(
              __dirname,
              "../../packages/solvers/src/vendor/review-engine.cjs",
            ),
          ),
        )
        .digest("hex"),
      baselineInputHash: beforeEntry.inputHash,
      targetInputHash: afterEntry.inputHash,
      baselineConfiguration: beforeEntry.configuration,
      targetConfiguration: afterEntry.configuration,
      baselineEvents: current.events.map(({ id, type, fit }) => [
        id,
        type,
        fit,
      ]),
      targetEvents: target.events.map(({ id, type, fit }) => [id, type, fit]),
      frozenBaseline: {
        n: current.row.statistics.n,
        seed: current.input.seed,
        availability: current.row.statistics.mean,
      },
      frozenTarget: {
        n: target.row.statistics.n,
        seed: target.input.seed,
        availability: target.row.statistics.mean,
      },
      originalSnapshotsChanged: false,
      ranking: contributions
        .map(({ samples: _samples, ...r }) => r)
        .sort((a, b) => b.shapley.loss.mean - a.shapley.loss.mean),
      combined: delta(before, after),
      endpoints: {
        baseline: (({ losses: _losses, ...r }) => r)(before),
        target: (({ losses: _losses, ...r }) => r)(after),
      },
      agentExpandedScope: {
        basis:
          "Conditional scenario only: manual handling plus missed-SDC investigation; neither is measured Agent capability. Do not add this bundle to the individual rows.",
        baselineOnly: delta(before, results[manualBit | investigationBit]),
        necessity: delta(results[full ^ manualBit ^ investigationBit], after),
      },
      notSeparatelyQuantified: [
        ...["R-REPLAY", "R-PROCESS", "R-ELASTIC"].map((id) => ({
          id,
          status: "现状部署待核实；两档均未开启；不计入本轮改进排序",
        })),
        ...catalogue.mechanisms.map((m) => ({
          id: m.id,
          name: m.name,
          status:
            "单点工程参考；适用比例、成功率、失败耗时与开销不完整，未作为独立工程措施计算收益。",
          simulationReady: m.simulationReady,
        })),
      ],
      coalitionResults: results.map(({ losses: _losses, ...r }) => r),
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({
        n,
        seed,
        before: before.availability,
        after: after.availability,
        combined: report.combined,
        agentExpandedScope: report.agentExpandedScope,
        ranking: report.ranking.map((r) => ({
          id: r.id,
          name: r.name,
          shapley: r.shapley.loss,
          pp: r.shapley.availabilityGainPp,
          baselineOnly: r.baselineOnly.loss,
          necessity: r.necessity.loss,
        })),
      }),
    );
  })().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

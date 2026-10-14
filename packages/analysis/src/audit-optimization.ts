import { optimizationSampling } from "../../contracts/src/audit-optimization";
import { createHash } from "node:crypto";
import type { AuditRequest } from "./audit";
import {
  auditExtensionCatalog,
  validateExtensions,
  existingMechanismClasses,
} from "../../contracts/src/audit-extensions";
import {
  auditReferenceOnly,
  auditScaleOrder,
} from "../../contracts/src/audit-presets";
import {
  auditObjects,
  eventLossHours,
  mechanismEventIds,
} from "../../contracts/src/audit-objects";
import { summarize } from "../../solvers/src/statistics";
import { agreeLossAllocation } from "./audit-allocation";
import { auditTarget } from "./audit-design";
import { createEnhancedAuditEngine } from "./audit-enhanced-engine";

const codes: Record<string, string> = {
  hardDetect: "D-HARD",
  slowDetect: "D-SLOW",
  sdcDetect: "D-SDC",
  step: "R-SDC",
  replay: "R-REPLAY",
  process: "R-PROCESS",
  elastic: "R-ELASTIC",
  fast: "C-FAST",
};
const names: Record<string, string> = {
  hardDetect: "中断检测",
  slowDetect: "亚健康检测",
  sdcDetect: "静默即时检测",
  step: "干净 step 恢复",
  replay: "通信/算子重执行",
  process: "进程重调度",
  elastic: "DP 域弹性恢复",
  fast: "检查点策略",
};
type Factor = {
  id: string;
  name: string;
  kind: string;
  mechanism?: string;
  code?: string;
  value?: any;
  source: string;
};

export function shapleyImportance(contribution: number, maximum: number) {
  return Math.min(
    1,
    Math.max(
      0.2,
      0.2 + 0.8 * (Math.max(0, contribution) / Math.max(1e-12, maximum)),
    ),
  );
}

export function validateOptimization(request: AuditRequest) {
  const input = request.optimization;
  if (!input) return;
  if (
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.enabled !== "boolean"
  )
    throw new Error("第二轮配置必须明确是否启用");
  for (const key of ["autoTune", "allowFitTargets"] as const)
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      throw new Error("第二轮 " + key + " 必须是布尔值");
  validateExtensions(input.extensions);
  if (
    input.extensions?.some((e) => e.id === "I-CONTAIN") &&
    ![
      ...(request.mechanisms ?? []),
      ...(request.baseline?.mechanisms ?? []),
    ].includes("elastic")
  )
    throw new Error(
      "故障隔离是弹性训练的前提；需同时启用 DP 域弹性，不能单独计为局部续跑收益",
    );
  for (const [key, min, max] of [
    ["screeningTrials", 2, 256],
    ["attributionTrials", 2, 128],
    ["permutations", 2, 32],
  ] as const) {
    const value = input[key];
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < min || value > max)
    )
      throw new Error(`第二轮 ${key} 必须为 ${min}–${max} 整数`);
  }
  for (const [scale, items] of Object.entries(input.importance ?? {})) {
    if (
      !(request.scales ?? [request.cards]).includes(Number(scale)) ||
      !items ||
      typeof items !== "object" ||
      Array.isArray(items)
    )
      throw new Error("第二轮重要度必须对应本次规模");
    for (const [id, value] of Object.entries(items))
      if (!(id in codes) || !Number.isFinite(value) || value <= 0 || value > 1)
        throw new Error("第二轮机制重要度应在 (0,1]，且使用已知机制ID");
  }
  for (const [id, value] of Object.entries(input.complexity ?? {}))
    if (
      !/^[A-Z]+$/.test(id) ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 10000
    )
      throw new Error("对象复杂度必须为 (0,10000] 的数值");
}

export function optimizationWork(request: AuditRequest, scales: number[]) {
  if (!request.optimization?.enabled) return { trajectories: 0, events: 0 };
  const o = request.optimization;
  const n = 10 + (o.extensions?.length ?? 0);
  const {
    screeningTrials: screening,
    attributionTrials: attribution,
    permutations,
  } = optimizationSampling(request);
  const perScale =
    (screening + 2) * 12 +
    (request.verificationTrials ?? 64) * 2 +
    attribution * (permutations * (n + 1) + 2);
  return {
    trajectories: perScale * scales.length,
    events:
      perScale * scales.reduce((s, cards) => s + cards, 0) * request.hours,
  };
}

export function auditOptimization(
  request: AuditRequest,
  current: any,
  resolved: any,
  onProgress?: (fraction: number) => void,
) {
  const input = request.optimization!;
  const scales = resolved.scales
    .filter((n: number) => !auditReferenceOnly(request, n))
    .sort(auditScaleOrder);
  const primaryCards = scales.includes(500000) ? 500000 : request.cards;
  const currentRow = (n: number) =>
    current.rows.find((r: any) => r.cards === n && r.id === "combined");
  const unmet = scales.filter(
    (n: number) => currentRow(n).statistics.ciLow < auditTarget(request, n),
  );
  const basis = {
    kind: "two-round-availability.v1",
    planningVersion: "confidence-budget-v1",
    primaryCards,
    firstRound:
      "固定本次事件 FIT 和现状措施参数；不因第二轮分配而改写第一轮结果",
    strategy:
      "目标与规模 → 固定现状评估 → 各规模 Shapley → AGREE 目标进一步分配 → 参数/FIT/新机制候选 → 独立复评与增量贡献",
    method: "agree.classical-normalized-loss.v1",
    source:
      "HAC-D@5ddfd65f67ff75e181abdec471e494d6cf8072b2 / user manual §7；专家机制库 mechanism-detail-review-2",
  };
  if (!unmet.length)
    return {
      ...basis,
      status: "not-needed",
      reason:
        "本次所有需求规模的现状采样区间下限均达到目标，保留现有方案，无需强制分配改进指标。",
      scales: [],
      allocations: [],
      candidates: [],
      attribution: [],
      factors: [],
    };
  if (!(request.attribution ?? true) || !current.attribution.length)
    return {
      ...basis,
      status: "needs-attribution",
      reason:
        "请开启第一轮组合 Shapley，才能据各规模贡献生成第二轮重要度建议。",
      scales: [],
      allocations: [],
      candidates: [],
      attribution: [],
      factors: [],
    };

  const selected = [
    ...new Set([
      ...(resolved.baseline.mechanisms ?? []),
      ...resolved.mechanisms,
    ]),
  ];
  const { screeningTrials, attributionTrials, permutations } =
    optimizationSampling(request);
  const verificationTrials = request.verificationTrials ?? 64;
  const used = new Set<number>();
  for (const [seed, trials, offset] of [
    [request.seed, request.trials, 0],
    [
      request.attributionSeed ?? request.seed,
      request.attributionTrials ?? 64,
      0,
    ],
    [request.seed, verificationTrials, 1000000],
    [
      request.sensitivitySeed ?? request.seed,
      request.sensitivityTrials ?? request.trials,
      0,
    ],
  ])
    for (let i = 0; i < trials; i++)
      used.add((seed + Math.imul(i + offset + 1, 2654435761)) >>> 0);
  const seedSet = (label: string, n: number) => {
    let base = createHash("sha256")
      .update(`${request.seed}:two-round:confidence-budget-v1:${label}`)
      .digest()
      .readUInt32LE();
    const values: number[] = [];
    while (values.length < n) {
      base = (Math.imul(base, 1664525) + 1013904223) >>> 0;
      if (!used.has(base)) {
        values.push(base);
        used.add(base);
      }
    }
    return values;
  };
  const seeds = {
    screening: seedSet("screening", screeningTrials),
    verification: seedSet("verification", verificationTrials),
    attribution: seedSet("attribution", attributionTrials),
  };
  const stats = (values: number[], target = 0) =>
    summarize(values, target, request.confidenceMethod ?? "student-t");
  const simulate = (
    cards: number,
    factors: Factor[],
    randomSeeds: number[],
    collect = true,
  ) => {
    const model = { ...resolved.model },
      policy = structuredClone(resolved.policy),
      extensions: any[] = [];
    let events = resolved.events;
    for (const f of factors) {
      if (f.kind === "policy")
        policy[f.code!] = { ...policy[f.code!], ...f.value };
      if (f.kind === "model") Object.assign(model, f.value);
      if (f.kind === "extension") extensions.push(f.value);
      if (f.kind === "fit")
        events = events.map((event: any) => ({
          ...event,
          fit: f.value.find((e: any) => e.id === event.id)?.fit ?? event.fit,
        }));
    }
    const engine = createEnhancedAuditEngine(events, policy, model, extensions),
      opts = {
        ...Object.fromEntries(selected.map((id) => [id, true])),
        recoveryOrder: resolved.recoveryOrder,
      },
      p = engine.parameters(opts);
    const values: number[] = [],
      ledger: Record<string, number> = {},
      perEvent: Record<string, any> = {};
    for (const seed of randomSeeds) {
      const r = engine.simulate(cards, 2, seed, p, opts);
      values.push(r.usefulThroughput);
      if (collect) {
        for (const [key, value] of Object.entries(r.ledger))
          ledger[key] = (ledger[key] ?? 0) + Number(value) / randomSeeds.length;
        for (const [id, detail] of Object.entries(r.perEvent)) {
          perEvent[id] ??= {};
          for (const [key, value] of Object.entries(detail as any))
            perEvent[id][key] =
              (perEvent[id][key] ?? 0) + Number(value) / randomSeeds.length;
        }
      }
    }
    return {
      cards,
      statistics: stats(values, auditTarget(request, cards)),
      ledger,
      perEvent,
      values,
    };
  };
  const describe = (rows: any[]) =>
    rows.map(({ values: _values, perEvent: _perEvent, ...r }) => r);
  const factorsFor = (model: any, policy: any): Factor[] => {
    const out: Factor[] = [];
    for (const id of selected) {
      const code = codes[id];
      const patch = Object.fromEntries(
        Object.entries(policy[code] ?? {}).filter(
          ([key, value]) => value !== resolved.policy[code]?.[key],
        ),
      );
      if (Object.keys(patch).length)
        out.push({
          id: "tune:" + id,
          mechanism: id,
          code,
          name: names[id] + "参数改进",
          kind: "policy",
          value: patch,
          source: "第二轮待产品专家确认的参数目标",
        });
    }
    const patch = Object.fromEntries(
      Object.entries(model).filter(
        ([key, value]) => value !== resolved.model[key],
      ),
    );
    if (Object.keys(patch).length)
      out.push({
        id: "tune:recovery",
        name: "基础恢复参数改进",
        kind: "model",
        value: patch,
        source: "第二轮用户输入的工程目标",
      });
    return out;
  };
  const mainContributions =
    current.attribution.find((a: any) => a.cards === primaryCards)
      ?.contributions ?? [];
  const mainMaximum = Math.max(
    1e-12,
    ...mainContributions.map((c: any) => Math.max(0, c.statistics.mean)),
  );
  const improvementStrength = (id: string) => {
    const importance =
      input.importance?.[String(primaryCards)]?.[id] ??
      shapleyImportance(
        mainContributions.find((c: any) => c.id === id)?.statistics.mean ?? 0,
        mainMaximum,
      );
    return 0.5 + 0.5 * importance;
  };
  const tune = (computeSeconds: number) => {
    const policy = structuredClone(resolved.policy);
    if (input.autoTune ?? true) {
      policy["D-SDC"].coverage +=
        Math.max(0, 0.9995 - policy["D-SDC"].coverage) *
        improvementStrength("sdcDetect");
      for (const [code, success, time, failed] of [
        ["R-REPLAY", 0.99, 2, 2],
        ["R-PROCESS", 0.99, 30, 30],
        ["R-ELASTIC", 0.999, 120, 30],
      ] as const) {
        const id = Object.keys(codes).find((key) => codes[key] === code)!;
        const strength = improvementStrength(id);
        policy[code].success +=
          Math.max(0, success - policy[code].success) * strength;
        const key = code === "R-ELASTIC" ? "recoverSeconds" : "successSeconds";
        policy[code][key] -= Math.max(0, policy[code][key] - time) * strength;
        policy[code].failureSeconds -=
          Math.max(0, policy[code].failureSeconds - failed) * strength;
      }
      policy["C-FAST"].computeSeconds = computeSeconds;
    }
    for (const [code, patch] of Object.entries(input.policy ?? {}))
      policy[code] = { ...policy[code], ...patch };
    return factorsFor({ ...resolved.model, ...input.model }, policy);
  };
  const extensionFactors: Factor[] = (input.extensions ?? []).map((value) => ({
    id: value.id,
    name: auditExtensionCatalog.find((m) => m.id === value.id)!.name,
    kind: "extension",
    value,
    source: value.source,
  }));
  const candidates: Array<{
    id: string;
    name: string;
    factors: Factor[];
    rows: any[];
    noFaultReference: number;
  }> = [];
  const evaluate = (name: string, factors: Factor[]) => {
    const noFault = simulate(
      primaryCards,
      [
        ...factors,
        {
          id: "reference:no-fault",
          name: "无故障参考",
          kind: "fit",
          value: resolved.events.map((e: any) => ({ id: e.id, fit: 0 })),
          source: "参考计算",
        },
      ],
      seeds.screening.slice(0, 2),
      false,
    );
    const candidate = {
      id: `candidate-${candidates.length + 1}`,
      name,
      factors,
      noFaultReference: noFault.statistics.mean,
      rows: scales.map((n: number) => simulate(n, factors, seeds.screening)),
    };
    candidates.push(candidate);
    onProgress?.(Math.min(0.48, 0.04 + candidates.length * 0.04));
    return candidate;
  };
  evaluate("保持第一轮现状", []);
  const periods =
    (input.autoTune ?? true)
      ? [300, 900, 3600]
      : [resolved.policy["C-FAST"].computeSeconds];
  for (const period of periods) {
    const changes = tune(period);
    evaluate(
      `现有措施参数改进 · 检查点周期 ${input.policy?.["C-FAST"]?.computeSeconds ?? period}s`,
      changes,
    );
    if (extensionFactors.length)
      evaluate(
        `参数改进＋专家扩展机制 · 周期 ${input.policy?.["C-FAST"]?.computeSeconds ?? period}s`,
        [...changes, ...extensionFactors],
      );
  }
  const score = (candidate: (typeof candidates)[number]) => {
    const main = candidate.rows.find((r) => r.cards === primaryCards)!;
    const deficits = candidate.rows.reduce(
      (s, r) =>
        s + Math.max(0, auditTarget(request, r.cards) - r.statistics.mean),
      0,
    );
    return (
      (main.statistics.ciLow >= auditTarget(request, primaryCards) ? 10 : 0) -
      deficits +
      main.statistics.mean * 0.01
    );
  };
  const best = () =>
    [...candidates].sort(
      (a, b) => score(b) - score(a) || a.factors.length - b.factors.length,
    )[0];
  // Prefer a checkpoint/overhead budget compatible with all requirements before FIT allocation.
  // This is a no-fault reference, not a proof of a global bound for arbitrary fault timelines.
  const adequateReferences = candidates.filter((c) =>
    scales.every((n: number) => c.noFaultReference >= auditTarget(request, n)),
  );
  let chosen =
    [...adequateReferences].sort((a, b) => score(b) - score(a))[0] ?? best();
  const objects = auditObjects(resolved.events);
  const allocations = scales.map((cards: number) => {
    const a = current.attribution.find((row: any) => row.cards === cards),
      positives = (a?.contributions ?? []).map((c: any) =>
        Math.max(0, c.statistics.mean),
      ),
      maximum = Math.max(1e-12, ...positives),
      sum = positives.reduce((s: number, v: number) => s + v, 0),
      gapHours = Math.max(
        0,
        (auditTarget(request, cards) - currentRow(cards).statistics.mean) *
          request.hours,
      );
    const priorities = (a?.contributions ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      contribution: c.statistics.mean,
      suggestedImportance: shapleyImportance(c.statistics.mean, maximum),
      importance:
        input.importance?.[String(cards)]?.[c.id] ??
        shapleyImportance(c.statistics.mean, maximum),
      improvementPriorityHours: sum
        ? (gapHours * Math.max(0, c.statistics.mean)) / sum
        : 0,
      evidence:
        "Shapley-derived engineering suggestion; not conditional system failure probability",
      effect: existingMechanismClasses[c.id]?.effect,
    }));
    const row = chosen.rows.find((r) => r.cards === cards)!,
      allowedHours = (1 - auditTarget(request, cards)) * request.hours,
      fixedHours = (row.ledger.save ?? 0) + (row.ledger.mechanismOverhead ?? 0),
      eventBudget = Math.max(0, allowedHours - fixedHours);
    const plan = agreeLossAllocation(
      eventBudget,
      request.hours,
      objects
        .filter((o) => o.fit > 0)
        .map((object) => {
          const related = priorities.filter((p: any) => {
            const scope = current.mechanisms.find(
              (m: any) => m.id === codes[p.id],
            )?.scope;
            return (
              scope &&
              mechanismEventIds(object.events, scope).some(
                (id) => object.events.find((e) => e.id === id)!.fit > 0,
              )
            );
          });
          return {
            id: object.id,
            name: object.name,
            complexity:
              input.complexity?.[object.id] ??
              object.events.filter((e) => e.fit > 0).length,
            importance: related.length
              ? related.reduce((s: number, p: any) => s + p.importance, 0) /
                related.length
              : 0.2,
            actualHours: object.events.reduce(
              (s, e) => s + eventLossHours(row.perEvent[e.id]),
              0,
            ),
          };
        }),
    );
    const actualEventLoss = plan.items.reduce((s, i) => s + i.actualHours, 0),
      samplingMarginHours = Math.max(
        0,
        (row.statistics.mean - row.statistics.ciLow) * request.hours,
      ),
      planningEventLoss = actualEventLoss + samplingMarginHours,
      globalRatio =
        planningEventLoss > 0
          ? Math.min(1, eventBudget / planningEventLoss)
          : 1;
    const responsibilityLoss =
      (1 - currentRow(cards).statistics.mean) * request.hours;
    const mechanismPlan = priorities.length
      ? agreeLossAllocation(
          allowedHours,
          request.hours,
          priorities.map((p: any) => ({
            id: p.id,
            name: p.name,
            importance: p.importance,
            complexity: 1,
            actualHours:
              responsibilityLoss *
              (sum ? Math.max(0, p.contribution) / sum : 1 / priorities.length),
          })),
        )
      : null;
    return {
      cards,
      target: auditTarget(request, cards),
      totalAllowedHours: allowedHours,
      fixedHours,
      samplingMarginHours,
      planningEventLoss,
      fixedExcessHours: Math.max(0, fixedHours - allowedHours),
      gapHours,
      priorities,
      mechanismPlan,
      mechanismBudgetBasis:
        "将现状剩余损失按正Shapley份额分成不重叠的设计责任账，再以AGREE分配；不是每项机制的独立物理损失，不能与对象预算相加。",
      ...plan,
      items: plan.items.map((i) => {
        const object = objects.find((o) => o.id === i.id)!;
        const ratio = Math.min(
          globalRatio,
          i.actualHours > 0 ? i.allowedHours / i.actualHours : globalRatio,
        );
        return {
          ...i,
          currentFit: object.fit,
          targetFit: object.fit * Math.min(1, Math.max(0, ratio)),
          basis:
            "保持当前优化措施条件，按采样损失/FIT局部比例换算，并以筛选均值区间下限对应的损失加量收紧全局比例；仅作设计要求，仍需独立正向复评",
        };
      }),
    };
  });
  const proposedFits = input.fitTargets ?? request.candidateFitOverrides;
  if (proposedFits?.length)
    evaluate("显式 FIT 目标＋参数方案", [
      ...chosen.factors,
      {
        id: "fit:objects",
        name: "硬件 FIT 目标",
        kind: "fit",
        value: proposedFits,
        source: "用户提供的目标事件率",
      },
    ]);
  if (input.allowFitTargets ?? true) {
    const targets = resolved.events
      .filter((event: any) => event.fit > 0)
      .map((event: any) => {
        const object = objects.find((o) =>
          o.events.some((e) => e.id === event.id),
        )!;
        const ratio = Math.min(
          1,
          ...allocations.map(
            (a: any) =>
              a.items.find((i: any) => i.id === object.id)!.targetFit /
              object.fit,
          ),
        );
        return {
          id: event.id,
          fit: event.fit * ratio,
          source: "第二轮 AGREE 对象预算 · 四规模取最严要求 · 非实测",
          evidence: "scenario" as const,
          rateBasis: "npu-equivalent-hour",
          note: "对象内沿用当前故障类型比例；为产品专家讨论的设计目标，独立仿真验证不代表硬件已实现。",
        };
      });
    const baseFactors = chosen.factors.filter((f) => f.kind !== "fit");
    for (const tightening of [1, 0.5, 0.25, 0.125]) {
      const value = targets.map((e: any) => ({
        ...e,
        fit: e.fit * tightening,
        note: e.note + ` 复评收紧系数 ${tightening}。`,
      }));
      const candidate = evaluate(
        `AGREE FIT 目标＋措施复评 · 收紧系数 ${tightening}`,
        [
          ...baseFactors,
          {
            id: "fit:objects",
            name: "硬件 FIT 目标（按对象分配）",
            kind: "fit",
            value,
            source: "AGREE预算后离散候选收紧；不是实测改进",
          },
        ],
      );
      if (
        candidate.rows.every(
          (r: any) => r.statistics.ciLow >= auditTarget(request, r.cards),
        )
      )
        break;
    }
  }
  chosen = best();
  onProgress?.(0.5);
  const verified = scales.map((cards: number, index: number) => {
    const baseline = simulate(cards, [], seeds.verification),
      improved = simulate(cards, chosen.factors, seeds.verification);
    onProgress?.(0.5 + (0.15 * (index + 1)) / scales.length);
    return {
      cards,
      target: auditTarget(request, cards),
      current: {
        statistics: baseline.statistics,
        ledger: baseline.ledger,
        perEvent: baseline.perEvent,
      },
      optimized: {
        statistics: improved.statistics,
        ledger: improved.ledger,
        perEvent: improved.perEvent,
      },
      delta: stats(improved.values.map((v, i) => v - baseline.values[i])),
      gap: improved.statistics.mean - auditTarget(request, cards),
      status:
        improved.statistics.ciLow >= auditTarget(request, cards)
          ? "supported"
          : improved.statistics.ciHigh < auditTarget(request, cards)
            ? "below"
            : "uncertain",
    };
  });
  const attribution = scales.map((cards: number, scaleIndex: number) => {
    const factors = chosen.factors,
      cache = new Map<string, number[]>();
    const values = (indexes: number[]) => {
      const key = [...indexes].sort((a, b) => a - b).join(",");
      if (!cache.has(key))
        cache.set(
          key,
          simulate(
            cards,
            indexes.map((i) => factors[i]),
            seeds.attribution,
            false,
          ).values,
        );
      return cache.get(key)!;
    };
    const contributions = factors.map(
      () => Array(attributionTrials).fill(0) as number[],
    );
    let state = (request.seed ^ cards ^ 0x45d9f3b) >>> 0;
    for (let p = 0; p < permutations; p++) {
      const order = factors.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const j = Math.floor((state / 4294967296) * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const indexes: number[] = [];
      let previous = values(indexes);
      for (const index of order) {
        indexes.push(index);
        const next = values(indexes);
        for (let t = 0; t < attributionTrials; t++)
          contributions[index][t] += (next[t] - previous[t]) / permutations;
        previous = next;
      }
      onProgress?.(
        0.65 + (0.35 * (scaleIndex + (p + 1) / permutations)) / scales.length,
      );
    }
    const baseline = stats(values([])),
      combined = stats(values(factors.map((_, i) => i))),
      gain = combined.mean - baseline.mean;
    const rows = factors
      .map((f, i) => ({
        id: f.id,
        name: f.name,
        kind: f.kind,
        statistics: stats(contributions[i]),
      }))
      .sort((a, b) => b.statistics.mean - a.statistics.mean)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return {
      cards,
      method: "permutation-shapley",
      interpretation:
        "相对第一轮现状的第二轮改进增量；不是现有六项措施的总贡献",
      permutations,
      trials: attributionTrials,
      coalitionCount: cache.size,
      baseline,
      combined,
      gain,
      contributions: rows,
      residual: rows.reduce((s, r) => s + r.statistics.mean, 0) - gain,
      uncertainty:
        "区间反映固定排列下的轨迹抽样；有限排列也有近似误差。负贡献保留。",
    };
  });
  const recommendedRequest = structuredClone(request);
  recommendedRequest.optimization = {
    ...input,
    autoTune: false,
    allowFitTargets: false,
    extensions: [],
    model: {},
    policy: {},
    fitTargets: [],
  };
  for (const f of chosen.factors) {
    if (f.kind === "policy")
      recommendedRequest.optimization.policy![f.code!] = f.value;
    if (f.kind === "model")
      Object.assign(recommendedRequest.optimization.model!, f.value);
    if (f.kind === "extension")
      recommendedRequest.optimization.extensions!.push(f.value);
    if (f.kind === "fit") recommendedRequest.optimization.fitTargets = f.value;
  }
  onProgress?.(1);
  const fitFactor = chosen.factors.find((f) => f.kind === "fit");
  const targetEvents = resolved.events.map((event: any) => ({
    ...event,
    fit: fitFactor?.value.find((e: any) => e.id === event.id)?.fit ?? event.fit,
  }));
  const optimizedEvents = createEnhancedAuditEngine(
    targetEvents,
    resolved.policy,
    resolved.model,
    chosen.factors.filter((f) => f.kind === "extension").map((f) => f.value),
  ).events;
  return {
    ...basis,
    status: "evaluated",
    reason: `第一轮 ${unmet.length} 个规模尚无充分达标证据，已完成第二轮有限候选筛选与独立复评。`,
    allocations,
    candidates: candidates.map((c) => ({
      id: c.id,
      name: c.name,
      noFaultReference: c.noFaultReference,
      factorIds: c.factors.map((f) => f.id),
      rows: describe(c.rows),
    })),
    chosenId: chosen.id,
    chosenName: chosen.name,
    optimizedEvents,
    configurationHash: createHash("sha256")
      .update(
        JSON.stringify({
          firstRound: current.config.inputHash,
          factors: chosen.factors,
        }),
      )
      .digest("hex"),
    factors: chosen.factors.map((f) => ({
      ...f,
      before:
        f.kind === "policy"
          ? resolved.policy[f.code!]
          : f.kind === "model"
            ? Object.fromEntries(
                Object.keys(f.value).map((key) => [key, resolved.model[key]]),
              )
            : f.kind === "fit"
              ? resolved.events.map((e: any) => ({ id: e.id, fit: e.fit }))
              : "现状未部署",
    })),
    scales: verified,
    attribution,
    seeds,
    recommendedRequest,
    allScalesSupported: verified.every((r: any) => r.status === "supported"),
    primaryStatus: verified.find((r: any) => r.cards === primaryCards)!.status,
    assumptions: [
      "第一轮措施不因第二轮改进而改变；第二轮为工程目标情景，不是已部署性能。",
      "自动调参以主规模贡献建议重要度控制改进幅度，探索最高检出率99.95%、恢复成功率99%/99.9%、检查点300/900/3600秒及显式候选；实际目标详见参数表，均待产品专家确认。",
      "AGREE以现状Shapley建议工程重要度、以候选损失/FIT局部比例提出对象目标，再由四规模最严约束组成统一硬件目标；不能把规划预算当作达标证明。",
      "FIT收紧范围最多为初始分配的1/8；没有无限降率或穷举全局最优。未找到达标方案时保留缺口。",
      "恢复阶段使用读取、启动、通信三等份预算；图准备属于启动，同段改善取最优适用路径，跨段才相加。阶段拆分需产品实测替换。",
      "扩展适用比例和成功率必须显式输入；FP8/FP4风险份额互斥，ABFT针对上游漏检的条件覆盖。",
      "异步检查点采用期望阻塞预算与保守持久化滞后；正常态开销单独记账，未持久化副本不作回滚起点。",
      "现有措施的参数候选由主规模重要度映射至有限工程目标，并非 AGREE 公式对物理参数的唯一逆解；AGREE 预算与正向复评共同约束方案。",
      "独立验证使用与第一轮、候选筛选及归因均不重叠的种子；区间不包含输入参数和模型误差。",
    ],
  };
}

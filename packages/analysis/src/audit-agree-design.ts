import { agreeLossAllocation } from "./audit-allocation";
import {
  auditExtensionCatalog,
  type AuditExtensionInput,
} from "../../contracts/src/audit-extensions";
import type { mechanismLossBudget } from "./audit-mechanism-budget";

export const expertBudgetPaths: Record<string, string[]> = {
  "R-LINK-LOCAL": ["downtime", "rollback"],
  "R-FABRIC-DEGRADE": ["downtime", "rollback", "localLoss"],
  "I-CONTAIN": ["localLoss"],
  "H-CONTROL-CONTINUITY": ["downtime", "rollback"],
  "R-WARM-PROCESS": ["downtime"],
  "R-RUNTIME-SNAPSHOT": ["downtime", "localLoss"],
  "C-ASYNC": ["save", "rollback"],
  "C-LOSSLESS": ["downtime", "localLoss"],
  "D-RECOVERY-CLASSIFY": ["downtime"],
  "D-SDC-FP8": ["rollback", "terminalInvalid"],
  "D-SDC-FP4": ["rollback", "terminalInvalid"],
  "D-ABFT": ["rollback", "terminalInvalid", "mechanismOverhead"],
  "D-NET-SDC": ["rollback", "terminalInvalid"],
  "H-SDC-SCREEN": ["rollback", "terminalInvalid"],
  "R-HCCL-ELASTIC": ["localLoss"],
  "R-CANN-GRAPH": ["downtime", "localLoss"],
};
export const designReserve = 0.15;
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
export type DesignRequirement = {
  id: string;
  path: string;
  mechanism: string;
  code: string;
  key: string;
  reference: number;
  required: number;
  adopted: number;
  direction: "up" | "down";
  allowedHours: number;
  exposurePerHour: number;
  formula: string;
  source: string;
  locked: boolean;
};
type Budget = ReturnType<typeof mechanismLossBudget>;

/** AGREE budgets are frozen before this physical inverse. These are sufficient
 * expected-loss design approximations, NOT a unique AGREE inverse or measurements.
 * Event path probabilities follow the same ordered recovery scopes as the engine.
 */
export function deriveAgreeDesign(args: {
  architecture?: import("../../contracts/src/audit-architecture").AuditArchitecture;
  hours: number;
  scales: number[];
  events: any[];
  model: any;
  policy: any;
  selected: string[];
  recoveryOrder: string[];
  budgets: Map<number, Budget>;
  extensions: AuditExtensionInput[];
  input: any;
  utilization?: number;
}) {
  const { hours, scales, selected, input } = args;
  const utilization = args.utilization ?? 1 - designReserve;
  const refPolicy = structuredClone(args.policy),
    refModel = { ...args.model };
  const referenceSources: Record<string, string> = {};
  const reference = (
    code: string,
    key: string,
    id: string,
    suggested?: number,
  ) => {
    const obj = code === "model" ? refModel : refPolicy[code];
    const value = input.parameterTargets?.[id] ?? suggested;
    if (value !== undefined) obj[key] = value;
    referenceSources[code + "." + key] =
      input.parameterTargets?.[id] !== undefined
        ? "用户参考初值（不锁定分配结果）"
        : suggested !== undefined
          ? "用户提出的第二轮参考目标（非实测）"
          : "现状专家审核参数";
  };
  reference("D-SDC", "coverage", "sdcCoverage", 0.995);
  reference("D-SDC", "detectSeconds", "detectSeconds", 0.5);
  reference("C-FAST", "saveSeconds", "saveSeconds", 0.5);
  reference("R-ELASTIC", "recoverSeconds", "elasticSeconds");
  reference("R-ELASTIC", "success", "elasticSuccess");
  reference("R-ELASTIC", "syncSeconds", "syncSeconds");
  reference("R-PROCESS", "successSeconds", "processSeconds");
  reference("R-REPLAY", "successSeconds", "replaySeconds");
  reference("model", "recoveryAttemptSeconds", "recoverySeconds");
  reference("model", "recoverySuccess", "recoverySuccess");
  reference("model", "sdcDelayHours", "latentHours");
  reference("model", "validationOverhead", "validationOverhead", 0.0001);
  for (const code of ["R-PROCESS", "R-REPLAY"])
    reference(code, "success", "localSuccess");
  for (const code of ["R-PROCESS", "R-REPLAY", "R-ELASTIC"])
    reference(code, "failureSeconds", "failureSeconds");
  const hardCode = selected.includes("hardDetect") ? "D-HARD" : "model";
  const hardCoverage = hardCode === "model" ? "detectProbability" : "coverage";
  const slowCode = selected.includes("slowDetect") ? "D-SLOW" : "model";
  const slowCoverage =
    slowCode === "model" ? "slowDetectProbability" : "coverage";
  const slowDelay = slowCode === "model" ? "slowDetectHours" : "detectSeconds";
  reference(hardCode, hardCoverage, "hardCoverage");
  reference(hardCode, "detectSeconds", "detectSeconds", 0.5);
  reference(slowCode, slowCoverage, "slowCoverage");
  reference(slowCode, slowDelay, "detectSeconds", 0.5);
  if (slowCode === "model") refModel.slowDetectHours /= 3600;
  Object.assign(refModel, input.model);
  for (const [code, patch] of Object.entries(input.policy ?? {}))
    Object.assign(refPolicy[code], patch);
  const baseExtensions = structuredClone(args.extensions);
  const explicitIds = new Set((input.extensions ?? []).map((e: any) => e.id));
  const originalEvents = args.events;
  const screening = baseExtensions.find((e) => e.id === "H-SDC-SCREEN");
  const screenScope = auditExtensionCatalog.find(
    (e) => e.id === "H-SDC-SCREEN",
  )!.eventCandidates;
  const referenceEvents = originalEvents.map((e) => ({
    ...e,
    fit:
      e.fit *
      (screening && screenScope.some((id: string) => id === e.id)
        ? 1 -
          screening.parameters.eligibleShare *
            screening.parameters.success *
            screening.parameters.reduction
        : 1),
  }));
  const perScale = scales.map((cards) => {
    const events = hardwareScaleEvents(
      referenceEvents,
      args.architecture,
      cards,
    );
    const policy = structuredClone(refPolicy),
      model = { ...refModel },
      extensions = structuredClone(baseExtensions);
    const plan = args.budgets.get(cards)!;
    const budget = (path: string) =>
      plan.items.find((i) => i.id === path)!.allowedHours * utilization;
    const importance = (path: string) =>
      plan.items.find((i) => i.id === path)!.importance;
    const requirements: DesignRequirement[] = [];
    const componentPlans: any[] = [];
    const get = (code: string) =>
      code === "model"
        ? model
        : code.startsWith("ext:")
          ? extensions.find((e) => e.id === code.slice(4))!.parameters
          : policy[code];
    const set = (
      path: string,
      code: string,
      key: string,
      required: number,
      allowedHours: number,
      rate: number,
      formula: string,
      direction: "up" | "down" = "down",
    ) => {
      if (
        code !== "model" &&
        !code.startsWith("ext:") &&
        !selected.some(
          (id) =>
            (
              ({
                fast: "C-FAST",
                sdcDetect: "D-SDC",
                step: "R-SDC",
                replay: "R-REPLAY",
                process: "R-PROCESS",
                elastic: "R-ELASTIC",
                hardDetect: "D-HARD",
                slowDetect: "D-SLOW",
              }) as any
            )[id] === code,
        )
      )
        return;
      const object = get(code),
        initial = object[key];
      const locked =
        code === "model"
          ? input.model?.[key] !== undefined
          : code.startsWith("ext:")
            ? explicitIds.has(code.slice(4))
            : input.policy?.[code]?.[key] !== undefined;
      const wanted =
        direction === "up"
          ? Math.max(initial, clamp(required, 0, 1))
          : Math.min(initial, Math.max(0, required));
      const source = code.startsWith("ext:")
        ? `专家单点量化交付包 / ${code.slice(4)}，仅调整该机制适用路径`
        : `${referenceSources[code + "." + key] ?? "现状专家审核参数"}；完整恢复包含各阶段，不将 HCCL 15秒误作总恢复`;
      object[key] = locked ? initial : wanted;
      requirements.push({
        id: code + "." + key,
        mechanism: code.startsWith("ext:") ? code.slice(4) : code,
        code,
        key,
        path,
        reference: initial,
        required: wanted,
        adopted: object[key],
        direction,
        allowedHours,
        exposurePerHour: rate,
        formula,
        source,
        locked,
      });
    };
    const rate = (type: string) =>
      events
        .filter((e) => e.type === type)
        .reduce((s, e) => s + (e.fit * cards) / 1e9, 0);
    const hard = rate("hard"),
      slow = rate("slow"),
      sdc = rate("sdc");
    const routes: Record<string, number> = {
      global:
        slow +
        sdc *
          (selected.includes("step") && selected.includes("sdcDetect")
            ? 1 - policy["D-SDC"].coverage
            : 1),
      hardGlobal: 0,
      replay: 0,
      process: 0,
      elastic: 0,
      detection: 0,
    };
    const failures: Record<string, number> = {};
    for (const event of events.filter((e) => e.type === "hard")) {
      let remaining = (event.fit * cards) / 1e9;
      for (const id of [
        "R-LINK-LOCAL",
        "H-CONTROL-CONTINUITY",
        "R-FABRIC-DEGRADE",
      ]) {
        const e = extensions.find((e) => e.id === id);
        if (
          !e ||
          !auditExtensionCatalog
            .find((m) => m.id === id)!
            .eventCandidates.some((id: string) => id === event.id)
        )
          continue;
        const p = e.parameters,
          pass = p.eligibleShare * p.success;
        routes[id] = (routes[id] ?? 0) + remaining * pass;
        failures["ext:" + id] =
          (failures["ext:" + id] ?? 0) +
          remaining * p.eligibleShare * (1 - p.success);
        remaining *= 1 - pass;
      }
      routes.detection += remaining;
      for (const id of args.recoveryOrder) {
        if (!selected.includes(id) || !event[id]) continue;
        const code = (
          {
            replay: "R-REPLAY",
            elastic: "R-ELASTIC",
            process: "R-PROCESS",
          } as any
        )[id];
        if (!code) continue;
        routes[id] += remaining * policy[code].success;
        failures[code] =
          (failures[code] ?? 0) + remaining * (1 - policy[code].success);
        remaining *= 1 - policy[code].success;
      }
      routes.global += remaining;
      routes.hardGlobal += remaining;
    }
    // Disjoint conservative timing components. Every route retains failure cost.
    const components: Array<{
      id: string;
      code: string;
      key: string;
      rate: number;
      importance: number;
    }> = [
      {
        id: "hard-detect",
        code: hardCode,
        key: "detectSeconds",
        rate: routes.detection,
        importance: importance("downtime"),
      },
      {
        id: "hard-miss",
        code: hardCode,
        key: hardCoverage,
        rate: routes.detection,
        importance: importance("downtime"),
      },
      {
        id: "replay",
        code: "R-REPLAY",
        key: "successSeconds",
        rate: routes.replay,
        importance: importance("downtime"),
      },
      {
        id: "process",
        code: "R-PROCESS",
        key: "successSeconds",
        rate: routes.process,
        importance: importance("downtime"),
      },
      {
        id: "elastic-sync",
        code: "R-ELASTIC",
        key: "syncSeconds",
        rate: routes.elastic,
        importance: importance("localLoss"),
      },
      {
        id: "global",
        code: "model",
        key: "recoveryAttemptSeconds",
        rate: routes.global,
        importance: importance("downtime"),
      },
      {
        id: "manual",
        code: "model",
        key: "recoverySuccess",
        rate: routes.global,
        importance: importance("downtime"),
      },
      {
        id: "sdc-detect",
        code: "D-SDC",
        key: "detectSeconds",
        rate: sdc,
        importance: importance("terminalInvalid"),
      },
      {
        id: "sdc-step",
        code: "R-SDC",
        key: "recoverSeconds",
        rate: sdc,
        importance: importance("rollback"),
      },
      ...Object.entries(failures).map(([code, rate]) => ({
        id: code + "-failure",
        code,
        key: "failureSeconds",
        rate,
        importance: importance("downtime"),
      })),
      ...["R-LINK-LOCAL", "H-CONTROL-CONTINUITY", "R-FABRIC-DEGRADE"]
        .filter((id) => routes[id] > 0)
        .map((id) => ({
          id,
          code: "ext:" + id,
          key: "pauseSeconds",
          rate: routes[id],
          importance: importance("downtime"),
        })),
    ].filter((c) => c.rate > 0);
    if (components.length) {
      const subplan = agreeLossAllocation(
        budget("downtime"),
        hours,
        components.map((c) => ({
          id: c.id,
          name: c.id,
          importance: c.importance,
          complexity: 1,
          actualHours: 0,
        })),
      );
      componentPlans.push({ path: "downtime", ...subplan });
      components.forEach((c, i) => {
        const b = subplan.items[i].allowedHours,
          seconds = (b * 3600) / (c.rate * hours);
        if (c.id === "hard-miss" || c.id === "manual") {
          const delay =
            c.id === "manual"
              ? model.manualAdditionalSeconds
              : model.timeoutSeconds;
          set(
            "downtime",
            c.code,
            c.key,
            delay > 0 ? 1 - seconds / delay : 0,
            b,
            c.rate,
            "p≥1−3600b/(λT·失败/超时秒数)，保留失败路径",
            "up",
          );
        } else
          set(
            "downtime",
            c.code,
            c.key,
            seconds,
            b,
            c.rate,
            "d≤3600b/(λT)；λ为按事件适用范围与前序成功率计算的路径到达率",
          );
      });
    }
    // Nested AGREE: checkpoint rollback, detected step rollback, missed pollution.
    const rollbackRate = routes.hardGlobal + routes.process;
    const rollback = agreeLossAllocation(budget("rollback"), hours, [
      {
        id: "checkpoint",
        name: "检查点回滚",
        importance: importance("save"),
        complexity: 1,
        actualHours: 0,
      },
      {
        id: "step",
        name: "已检出 SDC step 回滚",
        importance: importance("rollback"),
        complexity: 1,
        actualHours: 0,
      },
      {
        id: "pollution",
        name: "漏检污染回滚",
        importance: importance("terminalInvalid"),
        complexity: 1,
        actualHours: 0,
      },
    ]);
    componentPlans.push({ path: "rollback", ...rollback });
    const rb = (id: string) =>
      rollback.items.find((i) => i.id === id)!.allowedHours;
    const maxPeriod =
      rollbackRate > 0
        ? (rb("checkpoint") * 7200) / (rollbackRate * hours)
        : refPolicy["C-FAST"].computeSeconds;
    const period =
      input.checkpointPeriods?.[String(cards)] ??
      input.policy?.["C-FAST"]?.computeSeconds ??
      clamp(maxPeriod, 1, 31536000);
    // τ/2 is a renewal approximation. Async durability adds lag; forward check required.
    requirements.push({
      id: "checkpoint-period",
      path: "rollback",
      mechanism: "C-FAST",
      code: "schedule",
      key: String(cards),
      reference: refPolicy["C-FAST"].computeSeconds,
      required: Math.min(maxPeriod, 31536000),
      adopted: period,
      direction: "down",
      allowedHours: rb("checkpoint"),
      exposurePerHour: rollbackRate,
      formula:
        "λ回滚·T·τ/(2×3600)≤b；选预算允许的最大周期，减少保存压力；最低1秒",
      source:
        "AGREE回滚子预算；独立到达/均匀相位近似，需与污染、持久化滞后联合复评",
      locked:
        input.checkpointPeriods?.[String(cards)] !== undefined ||
        input.policy?.["C-FAST"]?.computeSeconds !== undefined,
    });
    const saveFraction = budget("save") / hours;
    set(
      "save",
      "C-FAST",
      "saveSeconds",
      (period * saveFraction) / Math.max(1e-12, 1 - saveFraction),
      budget("save"),
      3600 / period,
      "s/(τ+s)≤b/T ⇒ s≤τb/(T−b)，正常态连续保存上界",
    );
    set(
      "rollback",
      "R-SDC",
      "stepSeconds",
      sdc > 0
        ? (rb("step") * 3600) / (sdc * hours)
        : policy["R-SDC"].stepSeconds,
      rb("step"),
      sdc,
      "step≤3600b/(λSDC·T)，按全部SDC计为保守上界",
    );
    const pollutionBudget = Math.min(
      rb("pollution"),
      budget("terminalInvalid"),
    );
    const exposure = Math.min(hours, model.sdcDelayHours + period / 3600);
    if (sdc > 0 && exposure > 0)
      set(
        "terminalInvalid",
        "D-SDC",
        "coverage",
        1 - pollutionBudget / (sdc * hours * exposure),
        pollutionBudget,
        sdc,
        "c≥1−min(b污染回滚,b期末污染)/(λSDC·T·min(T,漏检发现时间+τ))；不借未验证子集覆盖证明全系统覆盖",
        "up",
      );
    if (slow > 0 && model.slowLoss > 0) {
      const half = budget("slowdown") / 2;
      set(
        "slowdown",
        slowCode,
        slowCoverage,
        1 - half / (slow * hours * model.slowLoss * model.slowLifetimeHours),
        half,
        slow,
        "c≥1−b漏检/(λslow·T·吞吐损失率·漏检持续时间)，检测与漏检各预留一半",
        "up",
      );
      set(
        "slowdown",
        slowCode,
        slowDelay,
        (half / (slow * hours * model.slowLoss)) *
          (slowCode === "model" ? 1 : 3600),
        half,
        slow,
        "发现时间≤b已检出/(λslow·T·吞吐损失率)；按全部slow检出计上界",
      );
    }
    const localItems = [
      ...(routes.elastic > 0
        ? [
            {
              id: "elastic",
              name: "弹性域容量",
              importance: importance("localLoss"),
              complexity: 1,
              actualHours: 0,
            },
          ]
        : []),
      ...(routes["R-FABRIC-DEGRADE"] > 0
        ? [
            {
              id: "degrade",
              name: "网络降级吞吐",
              importance: importance("localLoss"),
              complexity: 1,
              actualHours: 0,
            },
          ]
        : []),
    ];
    if (localItems.length) {
      const localPlan = agreeLossAllocation(
        budget("localLoss"),
        hours,
        localItems,
      );
      componentPlans.push({ path: "localLoss", ...localPlan });
      const elasticBudget = localPlan.items.find(
        (i) => i.id === "elastic",
      )?.allowedHours;
      if (elasticBudget !== undefined) {
        const localSeconds =
          (elasticBudget * 3600 * policy["R-ELASTIC"].domains) /
          (routes.elastic * hours);
        const detector = get(hardCode);
        const detectionSeconds =
          detector[hardCoverage] * detector.detectSeconds +
          (1 - detector[hardCoverage]) * model.timeoutSeconds;
        set(
          "localLoss",
          "R-ELASTIC",
          "recoverSeconds",
          Math.max(0, localSeconds - detectionSeconds),
          elasticBudget,
          routes.elastic,
          "恢复秒数≤3600b·域数/(λ弹性·T)−平均检测秒数；容量等效近似，失败尝试另经正向模型计账",
        );
      }
      const degradeBudget = localPlan.items.find(
        (i) => i.id === "degrade",
      )?.allowedHours;
      if (degradeBudget !== undefined) {
        const e = extensions.find(
          (e) => e.id === "R-FABRIC-DEGRADE",
        )!.parameters;
        const loss =
          1 -
          1 /
            (1 -
              e.communicationFraction +
              e.communicationFraction / e.bandwidthRatio);
        set(
          "localLoss",
          "ext:R-FABRIC-DEGRADE",
          "repairSeconds",
          loss > 0
            ? (degradeBudget * 3600) /
                (routes["R-FABRIC-DEGRADE"] * hours * loss)
            : e.repairSeconds,
          degradeBudget,
          routes["R-FABRIC-DEGRADE"],
          "降级持续秒数≤3600b/(λ降级·T·吞吐损失率)；吞吐损失按通信比例和剩余带宽折算",
        );
      }
    }
    const extraOverhead =
      1 - extensions.reduce((v, e) => v * (1 - e.parameters.overhead), 1);
    set(
      "mechanismOverhead",
      "model",
      "validationOverhead",
      Math.max(
        0,
        (budget("mechanismOverhead") / hours - extraOverhead) /
          Math.max(1e-12, 1 - extraOverhead),
      ),
      budget("mechanismOverhead"),
      0,
      "1−(1−校验开销)Π(1−扩展开销)≤b/T；新增检测所需的开销上限，非已测性能",
    );
    return {
      cards,
      utilization,
      requirements,
      componentPlans,
      routes,
      model,
      policy,
      extensions,
      period,
      sourceHardRate: hard,
    };
  });
  // A common implementation must meet the strictest scale requirement; schedules differ by scale.
  const model = { ...refModel },
    policy = structuredClone(refPolicy),
    extensions = structuredClone(baseExtensions);
  const sources: Record<string, string> = {},
    envelope: any[] = [];
  const all = perScale.flatMap((s) =>
    s.requirements.map((r) => ({ ...r, cards: s.cards })),
  );
  for (const id of new Set(
    all.filter((r) => r.code !== "schedule").map((r) => r.id),
  )) {
    const rows = all.filter((r) => r.id === id);
    const binding = rows.reduce((a, b) =>
      a.direction === "up"
        ? a.adopted >= b.adopted
          ? a
          : b
        : a.adopted <= b.adopted
          ? a
          : b,
    );
    const obj =
      binding.code === "model"
        ? model
        : binding.code.startsWith("ext:")
          ? extensions.find((e) => e.id === binding.code.slice(4))!.parameters
          : policy[binding.code];
    obj[binding.key] = binding.adopted;
    const description = `AGREE先行分配 / ${binding.cards}卡约束 / ${binding.path} / 子预算${binding.allowedHours.toPrecision(6)}h / 到达率${binding.exposurePerHour.toPrecision(6)}/h；${binding.formula}；参考${binding.reference} → 要求${binding.required}；${binding.source}；${binding.locked ? "用户显式锁定，未自动改动" : "分配反解的工程要求，非专家已实现能力"}`;
    sources[id] = description;
    envelope.push({ ...binding, source: description });
  }
  for (const e of extensions)
    e.source +=
      "；" +
      envelope
        .filter((r) => r.code === "ext:" + e.id)
        .map((r) => r.source)
        .join("；");
  return {
    model,
    policy,
    extensions,
    sources,
    envelope,
    perScale,
    schedule: Object.fromEntries(
      perScale.map((s) => [String(s.cards), s.period]),
    ),
    utilization,
    method: "agree-budget-physical-inverse.v1",
    reserveFraction: 1 - utilization,
  };
}
import { hardwareScaleEvents } from "../../contracts/src/audit-hardware";

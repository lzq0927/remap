import { agreeLossAllocation } from "./audit-allocation";

const lossPaths = [
  {
    id: "save",
    name: "检查点保存阻塞",
    mechanisms: ["fast"],
    action: "缩短保存阻塞；按规模权衡检查点周期与回滚。",
  },
  {
    id: "downtime",
    name: "检测与恢复停机",
    mechanisms: ["process", "elastic", "replay"],
    action: "缩短检测、重执行、进程及全局恢复；降低失败后人工介入。",
  },
  {
    id: "rollback",
    name: "检查点与污染回滚",
    mechanisms: ["fast", "step", "sdcDetect"],
    action: "提高 SDC 覆盖、缩短漏检兜底；增加无回滚的局部恢复，重新权衡周期。",
  },
  {
    id: "terminalInvalid",
    name: "期末未发现污染",
    mechanisms: ["sdcDetect", "step"],
    action: "增加可信周期正确性复核；0.5秒即时检测不能代替漏检兜底。",
  },
  {
    id: "slowdown",
    name: "亚健康降速",
    mechanisms: ["slowDetect"],
    action: "改善亚健康检出率与发现时延，检查漏检持续时间。",
  },
  {
    id: "localLoss",
    name: "弹性域容量损失",
    mechanisms: ["elastic"],
    action: "缩短完整域恢复与协调暂停；避免与通信阶段收益重复计入。",
  },
  {
    id: "mechanismOverhead",
    name: "新增机制正常态开销",
    mechanisms: ["sdcDetect"],
    action: "测量校验、复核、筛查的实际吞吐成本，不能按零开销验收。",
  },
];

/** Disjoint physical time ledger; separate from the Shapley responsibility ledger. */
export function mechanismLossBudget(
  hours: number,
  allowed: number,
  ledger: Record<string, number>,
  priorities: any[],
) {
  const plan = agreeLossAllocation(
    allowed,
    hours,
    lossPaths.map((path) => {
      const related = priorities.filter((p) => path.mechanisms.includes(p.id));
      return {
        id: path.id,
        name: path.name,
        complexity: 1,
        importance: related.length
          ? related.reduce((s, p) => s + p.importance, 0) / related.length
          : 0.2,
        actualHours: ledger[path.id] ?? 0,
      };
    }),
  );
  return {
    ...plan,
    items: plan.items.map((item, i) => ({
      ...item,
      action: lossPaths[i].action,
    })),
  };
}

/** Necessary local design clues, not a physical inverse or proof of feasibility. */
export function mechanismGapDiagnostics(
  hours: number,
  target: number,
  ledger: Record<string, number>,
  perEvent: Record<string, any>,
  plan: ReturnType<typeof mechanismLossBudget>,
  period: number,
  saveSeconds: number,
) {
  const budget = (id: string) =>
    plan.items.find((p) => p.id === id)!.allowedHours;
  const fraction = budget("save") / hours;
  const recoveries = Object.values(perEvent).reduce(
    (s, p) => s + (p.recoveries ?? 0),
    0,
  );
  return {
    totalExcessHours: Math.max(
      0,
      Object.values(ledger).reduce((s, v) => s + v, 0) - (1 - target) * hours,
    ),
    checkpoint: {
      periodSeconds: period,
      saveSeconds,
      allocatedSaveSeconds:
        fraction < 1 ? (period * fraction) / (1 - fraction) : null,
      basis:
        "s/(τ+s)≤保存预算/T，在所选周期下反解保存阻塞上限；采用无故障连续保存近似，必须与回滚联合复评。",
    },
    downtimeSecondsPerObservedRecovery:
      recoveries > 0 ? (budget("downtime") * 3600) / recoveries : null,
    paths: plan.items
      .map((item) => ({
        ...item,
        actualHours: ledger[item.id] ?? 0,
        excessHours: (ledger[item.id] ?? 0) - item.allowedHours,
      }))
      .sort((a, b) => b.excessHours - a.excessHours),
  };
}

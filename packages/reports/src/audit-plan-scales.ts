import type { AuditSection } from "./audit";
import { lineChart } from "./audit-charts";
import { parameterLabels } from "./audit-labels";
import {
  summaryNumber as num,
  summaryScaleLabel as label,
  summaryColors,
} from "./audit-scale-summary";
const pct = (v: number) => num(v * 100) + "%";
const probability = (key: string) =>
  /^(coverage|success|recoverySuccess|detectProbability|slowDetectProbability|manualProbability|overhead|validationOverhead|eligibleShare|reduction|communicationFraction|bandwidthRatio)$/i.test(
    key,
  );
const format = (key: string, value: unknown) =>
  typeof value === "number"
    ? probability(key)
      ? pct(value)
      : num(value, 6)
    : String(value ?? "未调整");

export function planScaleChart(result: any) {
  const plans = [...result.plans].sort(
    (a, b) => a.prediction.cards - b.prediction.cards,
  );
  return lineChart({
    title: "各规模目标、现状与独立规划预期",
    series: [
      {
        name: "各规模可用度目标",
        color: "#b24b4b",
        dashed: true,
        points: plans.map((p) => ({
          x: p.prediction.cards,
          statistics: {
            mean: p.prediction.target,
            ciLow: p.prediction.target,
            ciHigh: p.prediction.target,
          },
        })),
      },
      {
        name: "第一轮现状均值",
        color: summaryColors[1],
        points: plans.map((p) => {
          const a = p.allocations.find(
            (a: any) => a.cards === p.prediction.cards,
          );
          return {
            x: p.prediction.cards,
            statistics: {
              mean: a.current.mean,
              ciLow: a.current.mean,
              ciHigh: a.current.mean,
            },
          };
        }),
      },
      {
        name: "各自方案的规划试算（未评估）",
        color: summaryColors[0],
        points: plans.map((p) => ({
          x: p.prediction.cards,
          statistics: {
            mean: p.prediction.mean,
            ciLow: p.prediction.mean,
            ciHigh: p.prediction.mean,
          },
        })),
      },
    ],
    xLabel: "需求规模 / 卡",
    formatX: label,
    showIntervals: false,
    note: "每个规划点对应不同的措施参数配置，不能当作同一方案跨规模效果。规划试算没有正式评估置信区间；须分别载入并独立评估，未满足目标时保留缺口。",
  });
}

export function planScaleSections(result: any): AuditSection[] {
  const plans = [...result.plans].sort(
    (a, b) => a.prediction.cards - b.prediction.cards,
  );
  const sourceEntries: { id: string; text: string }[] = [];
  const sourceId = (p: any, f: any) => {
    const id = `${label(p.prediction.cards)} / ${f.id}`;
    if (!sourceEntries.some((s) => s.id === id))
      sourceEntries.push({ id, text: f.source });
    return id;
  };
  const parameters = new Map<
    string,
    { name: string; field: string; before: string; values: Map<number, string> }
  >();
  for (const p of plans)
    for (const f of p.factors) {
      const values =
        f.kind === "extension"
          ? f.value.parameters
          : f.kind === "fit"
            ? Object.fromEntries(
                f.value.map((e: any) => [e.id + " FIT", e.fit]),
              )
            : f.value;
      for (const [key, value] of Object.entries(values)) {
        const id = f.id + "." + key;
        const before =
          f.kind === "extension"
            ? "未部署"
            : f.kind === "fit"
              ? f.before.find((e: any) => e.id + " FIT" === key)?.fit
              : f.before?.[key];
        if (!parameters.has(id))
          parameters.set(id, {
            name: f.name,
            field: (parameterLabels[key] ?? key).replace("（0–1）", ""),
            before: format(key, before),
            values: new Map(),
          });
        parameters.get(id)!.values.set(p.prediction.cards, format(key, value));
      }
      sourceId(p, f);
    }
  const factors = [
    ...new Set<string>(plans.flatMap((p) => p.factors.map((f: any) => f.id))),
  ];
  const allocations = plans.map((p) =>
    p.allocations.find((a: any) => a.cards === p.prediction.cards),
  );
  const responsibilities = [
    ...new Set<string>(
      allocations.flatMap((a) => a.items.map((item: any) => item.id)),
    ),
  ];
  return [
    {
      title: "分规模优化 / 目标到可靠性改进建议",
      visual: "plan-set",
      paragraphs: [...result.assumptions],
      tables: [
        {
          heads: [
            "规模",
            "目标",
            "第一轮现状",
            "规划均值（未评估）",
            "规划仍需提升 / pp",
            "主要薄弱点",
          ],
          rows: plans.map((p) => {
            const a = p.allocations.find(
                (a: any) => a.cards === p.prediction.cards,
              ),
              s = result.architectureDiagnosis.scales.find(
                (s: any) => s.cards === p.prediction.cards,
              );
            return [
              label(p.prediction.cards),
              pct(p.prediction.target),
              pct(a.current.mean),
              pct(p.prediction.mean),
              num(Math.max(0, p.prediction.target - p.prediction.mean) * 100),
              s.weaknesses
                .slice(0, 3)
                .map((w: any) => w.name + " · " + w.focus)
                .join("；"),
            ];
          }),
        },
      ],
    },
    {
      title: "各规模AGREE责任预算与重要度",
      collapsed: true,
      paragraphs: [
        "每格为：重要度 / 允许损失 / 现状损失，时间单位为小时。重要度来自各自第一轮Shapley与本次覆盖范围，可由专家修订；各列分别分配，不跨规模相加。预算用于设计责任追溯，最终仍按总可用度及独立复评判断，不强制每项子预算均通过。",
        ...new Set<string>(allocations.map((a) => a.interpretation)),
        ...new Set<string>(allocations.map((a) => "依据：" + a.source)),
      ],
      tables: [
        {
          heads: ["责任机制", ...plans.map((p) => label(p.prediction.cards))],
          rows: responsibilities.map((id) => [
            allocations.flatMap((a) => a.items).find((i: any) => i.id === id)!
              .name,
            ...allocations.map((a) => {
              const item = a.items.find((i: any) => i.id === id);
              return item
                ? `${num(item.importance, 4)} / ${num(item.allowedHours)} / ${num(item.actualHours)}`
                : "本规模未分配";
            }),
          ]),
        },
      ],
    },
    {
      title: "不同规模建议采用的可靠性改进措施",
      paragraphs: [
        "未建议调整表示本次有限规划没有保留该项，不表示机制无用或已达到全局最优。每列分别服务于该规模目标；不会自动执行独立改进评估。",
      ],
      tables: [
        {
          heads: ["改进措施", ...plans.map((p) => label(p.prediction.cards))],
          rows: factors.map((id) => {
            const name = plans
              .flatMap((p) => p.factors)
              .find((f: any) => f.id === id)!.name;
            return [
              name,
              ...plans.map((p) => {
                const f = p.factors.find((f: any) => f.id === id);
                return f ? "建议调整 · " + sourceId(p, f) : "未建议调整";
              }),
            ];
          }),
        },
      ],
    },
    {
      title: "各规模参数要求对照",
      paragraphs: [
        "现状值始终来自同一冻结第一轮；数值是待验证的工程要求。覆盖率、成功率与开销以百分数显示，其余单位沿用字段标注。",
      ],
      tables: [
        {
          heads: [
            "措施",
            "参数",
            "第一轮",
            ...plans.map((p) => label(p.prediction.cards)),
          ],
          rows: [...parameters.values()].map((p) => [
            p.name,
            p.field,
            p.before,
            ...plans.map(
              (plan) => p.values.get(plan.prediction.cards) ?? "保持现状",
            ),
          ]),
        },
      ],
    },
    {
      title: "分规模分配依据与措施来源",
      collapsed: true,
      tables: [
        {
          heads: ["来源索引", "依据与适用边界"],
          rows: sourceEntries.map((s) => [s.id, s.text]),
        },
      ],
    },
  ];
}

import { auditReferenceOnly } from "../../contracts/src/audit-presets";
import type { Run } from "../../contracts/src/types";
import type { AuditSection } from "./audit";
import { parameterLabels } from "./audit-labels";
import { lineChart } from "./audit-charts";
const number = (value: number, digits = 5) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const percent = (value: number) => number(value * 100) + "%";
export const experimentStatus: Record<string, string> = {
  supported: "假设下采样支持",
  below: "低于目标",
  uncertain: "区间跨目标，需复核",
};
export function compareAuditExperiments(runs: Run[]) {
  if (
    runs.some(
      (r) =>
        r.status !== "succeeded" ||
        !["expert-review-audit", "expert-audit-experiment"].includes(
          r.result?.kind,
        ),
    )
  )
    throw new Error("只能比较已完成的第一轮或改进评估；分配建议不是评估结果");
  const bases = runs.filter((r) => r.result.kind === "expert-review-audit");
  const sourceIds = new Set(
    runs.map((r) =>
      r.result.kind === "expert-review-audit" ? r.id : r.result.sourceRunId,
    ),
  );
  if (sourceIds.size !== 1 || bases.length > 1)
    throw new Error("请选择基于同一次第一轮、相同目标和故障证据的评估");
  const base = bases[0],
    first = runs[0];
  const request = base?.result.request ?? first.result.request;
  const entries = runs.map((run) => ({
    id: run.id,
    name:
      run.result.kind === "expert-review-audit"
        ? "第一轮现状 · 原六项"
        : run.result.name,
    round: run.result.kind === "expert-review-audit" ? "current" : "scenario",
    inputHash: run.inputHash,
    createdAt: run.createdAt,
    rows:
      run.result.kind === "expert-review-audit"
        ? run.result.rows
            .filter((r: any) => r.id === "combined")
            .map((r: any) => ({
              ...r,
              referenceOnly: auditReferenceOnly(request, r.cards),
              target:
                r.cards === request.cards
                  ? request.target
                  : (request.targets?.[String(r.cards)] ?? request.target),
              status:
                r.statistics.ciLow >=
                (r.cards === request.cards
                  ? request.target
                  : (request.targets?.[String(r.cards)] ?? request.target))
                  ? "supported"
                  : r.statistics.ciHigh <
                      (r.cards === request.cards
                        ? request.target
                        : (request.targets?.[String(r.cards)] ??
                          request.target))
                    ? "below"
                    : "uncertain",
            }))
        : run.result.rows,
    configuration: run.result.configuration ?? {
      policy: run.result.config.policy,
      model: run.result.config.model,
    },
    factors: run.result.factors ?? [],
    attribution: run.result.attribution,
    sampling:
      run.result.kind === "expert-review-audit"
        ? run.result.request.trials
        : run.result.rows[0]?.statistics.n,
  }));
  return {
    kind: "expert-audit-comparison",
    name: "多次评估横向比较",
    metricId: "training.retained-clean-progress",
    request,
    sourceRunId: [...sourceIds][0],
    entries,
    assumptions: [
      "只比较同一冻结第一轮、目标、故障模式与计算口径；每次参数独立保存，不重新计算或替换旧结果。",
      "第一轮排名是六项现有措施相对基线的总贡献；改进排名是相对第一轮的增量，基准不同，不直接相加排名。",
      "第一轮真实现状指使用确认的现状参数评估，不等同于现场可用度实测。",
      "分配建议未执行第二轮；只有用户单独点击并完成的评估进入横向比较。",
    ],
  };
}
function parameterEntries(result: any) {
  const output: unknown[][] = [];
  for (const factor of result.factors ?? []) {
    if (factor.kind === "fit") {
      for (const event of factor.value)
        output.push([
          factor.name,
          event.id + " FIT",
          number(factor.before.find((e: any) => e.id === event.id)?.fit),
          number(event.fit),
          event.source +
            "；" +
            (event.note ?? "用户明确提供的工程情景，需验证"),
        ]);
      continue;
    }
    if (factor.kind === "extension") {
      output.push([
        factor.name,
        "新增专家机制",
        "未部署",
        Object.entries(factor.value.parameters)
          .map(([k, v]) => `${k}=${v}`)
          .join("；"),
        factor.source,
      ]);
      continue;
    }
    for (const [key, value] of Object.entries(factor.value))
      output.push([
        factor.name,
        parameterLabels[key] ??
          (factor.kind === "schedule"
            ? `${number(Number(key), 0)}卡周期 / 秒`
            : key),
        factor.kind === "fit" ? "见来源" : number(factor.before?.[key]),
        number(Number(value)),
        factor.source,
      ]);
  }
  return output;
}
function parameters(result: any) {
  return parameterEntries(result).map((row, index) => [
    ...row.slice(0, 4),
    `P${index + 1}`,
  ]);
}
function parameterSources(result: any): AuditSection {
  return {
    title: "本次参数来源与验收条件",
    collapsed: true,
    paragraphs: parameterEntries(result).map(
      (row, index) => `P${index + 1} · ${row[0]} / ${row[1]}：${row[4]}`,
    ),
  };
}
export function experimentSections(result: any): AuditSection[] {
  if (result.kind === "expert-audit-plan") {
    return [
      {
        title: "第二轮 / AGREE分配建议（尚未评估）",
        paragraphs: [
          `第一轮运行 ${result.sourceRunId}；规划规模${number(result.prediction.cards, 0)}卡，目标${percent(result.prediction.target)}，规划试算${percent(result.prediction.mean)}。${result.prediction.note}`,
          "第一轮静默检出率95%等原始参数保持在其运行快照中。改进方案的99.5%或进一步覆盖属于第二轮要求。",
          ...result.assumptions,
        ],
        tables: [
          {
            heads: ["规模 / 卡", "现状可用度", "目标", "总改进缺口 / h"],
            rows: result.allocations.map((a: any) => [
              number(a.cards, 0),
              percent(a.current.mean),
              percent(a.target),
              number(a.gapHours),
            ]),
          },
        ],
      },
      {
        title: "AGREE责任分配与重要度",
        paragraphs: [
          result.allocations[0].formula,
          result.allocations[0].interpretation,
          result.allocations[0].basis,
        ],
        tables: [
          {
            heads: [
              "措施",
              "第一轮Shapley / pp",
              "建议重要度",
              "采用重要度",
              "现状责任 / h",
              "分配允许责任 / h",
            ],
            rows: [],
            scaleRows: result.allocations.map((a: any) => ({
              cards: a.cards,
              rows: a.items.map((i: any) => [
                i.name,
                number(i.contribution * 100),
                number(i.suggestedImportance),
                number(i.importance),
                number(i.actualHours),
                number(i.allowedHours),
              ]),
            })),
            scaleLabel: "分配查看规模",
          },
        ],
      },
      {
        title: "建议参数与采用依据",
        paragraphs: [
          "以下仅为待执行方案；按总目标约束反解改进幅度，不强迫每条损失路径硬达标，不把四个规模最严要求合成一套参数。",
        ],
        tables: [
          {
            heads: ["措施", "参数", "第一轮", "建议值", "来源索引"],
            rows: parameters(result),
          },
        ],
      },
      parameterSources(result),
      {
        title: "参考方案采用记录",
        collapsed: true,
        tables: [
          {
            heads: ["方案", "采用", "理由", "来源"],
            rows: result.decisions.map((d: any) => [
              d.name,
              d.selected ? "是" : "否",
              d.reason,
              d.source,
            ]),
          },
        ],
      },
    ];
  }
  if (result.kind === "expert-audit-experiment") {
    return [
      {
        title: `第二轮 / ${result.name}（独立执行）`,
        paragraphs: [
          `基于第一轮 ${result.sourceRunId}，本次只执行已确认的方案参数。源输入哈希：${result.sourceInputHash}。`,
          ...(result.planningRunId
            ? [
                `参数来源：AGREE分配运行 ${result.planningRunId}。手动调整以本次快照为准。`,
              ]
            : []),
          ...result.assumptions,
        ],
        visual: "experiment-comparison",
        tables: [
          {
            heads: [
              "规模 / 卡",
              "目标",
              "第一轮现状",
              "本次可用度",
              "95%均值区间",
              "改进 / pp",
              "结论",
            ],
            rows: result.rows.map((r: any) => [
              number(r.cards, 0),
              r.referenceOnly ? "参考点" : percent(r.target),
              percent(
                result.baseline.rows.find((b: any) => b.cards === r.cards)
                  ?.statistics.mean,
              ),
              percent(r.statistics.mean),
              percent(r.statistics.ciLow) +
                " ～ " +
                percent(r.statistics.ciHigh),
              number(
                (r.statistics.mean -
                  result.baseline.rows.find((b: any) => b.cards === r.cards)
                    ?.statistics.mean) *
                  100,
              ),
              r.referenceOnly ? "参考点" : experimentStatus[r.status],
            ]),
          },
        ],
      },
      {
        title: "本次参数快照与第一轮差异",
        tables: [
          {
            heads: ["措施", "参数", "第一轮", "本次值", "来源索引"],
            rows: parameters(result),
          },
        ],
      },
      parameterSources(result),
      {
        title: "本次增量Shapley排名",
        paragraphs: [
          "仅分摊本次改进相对冻结第一轮的增量；第一轮现有六项的总贡献请查看第一轮报告。每次评估的排名独立保存。",
          `本次归因每子集${result.attribution[0]?.trials ?? 0}条轨迹、${result.attribution[0]?.permutations ?? 0}个排列；区间反映轨迹抽样，有限排列还有近似误差。`,
        ],
        tables: [
          {
            heads: ["排名", "改进措施", "增量 / pp", "95%区间 / pp"],
            rows: [],
            scaleRows: result.attribution.map((a: any) => ({
              cards: a.cards,
              rows: a.contributions.map((c: any) => [
                c.rank,
                c.name,
                number(c.statistics.mean * 100),
                number(c.statistics.ciLow * 100) +
                  " ～ " +
                  number(c.statistics.ciHigh * 100),
              ]),
            })),
            scaleLabel: "本次贡献规模",
          },
        ],
      },
      {
        title: "本次损失与达标缺口",
        tables: [
          {
            heads: [
              "规模 / 卡",
              "允许损失 / h",
              "实际损失 / h",
              "停机 / h",
              "保存 / h",
              "回滚 / h",
              "污染 / h",
              "剩余缺口 / h",
            ],
            rows: result.rows
              .filter((r: any) => !r.referenceOnly)
              .map((r: any) => [
                number(r.cards, 0),
                number((1 - r.target) * result.request.hours),
                number((1 - r.statistics.mean) * result.request.hours),
                number(r.ledger.downtime ?? 0),
                number(r.ledger.save ?? 0),
                number(r.ledger.rollback ?? 0),
                number(r.ledger.terminalInvalid ?? 0),
                number(
                  Math.max(
                    0,
                    (r.target - r.statistics.mean) * result.request.hours,
                  ),
                ),
              ]),
          },
        ],
      },
    ];
  }
  const entries = result.entries;
  const scales = [
    ...new Set<number>(
      entries.flatMap((e: any) => e.rows.map((r: any) => r.cards)),
    ),
  ].sort((a, b) => b - a);
  const main = result.request.cards;
  const comparisonRows = (cards: number) =>
    entries.map((e: any) => {
      const row = e.rows.find((r: any) => r.cards === cards);
      const referenceOnly = auditReferenceOnly(result.request, cards);
      return [
        e.name,
        e.id.slice(0, 8),
        referenceOnly ? "参考点" : percent(row.target),
        percent(row.statistics.mean),
        percent(row.statistics.ciLow) + " ～ " + percent(row.statistics.ciHigh),
        e.sampling,
        referenceOnly ? "参考点" : experimentStatus[row.status],
      ];
    });
  const parameterKeys = [
    ...new Set<string>(
      entries.flatMap((e: any) =>
        e.factors.flatMap((f: any) =>
          f.kind === "policy"
            ? Object.keys(f.value).map((k) => f.code + "." + k)
            : f.kind === "model"
              ? Object.keys(f.value).map((k) => "model." + k)
              : f.kind === "extension"
                ? Object.keys(f.value.parameters).map(
                    (k) => "ext:" + f.id + "." + k,
                  )
                : [],
        ),
      ),
    ),
  ];
  const base = entries.find((e: any) => e.round === "current");
  const value = (entry: any, key: string) => {
    const [code, field] = key.split(".");
    if (code.startsWith("ext:"))
      return entry.configuration.extensions?.find(
        (e: any) => e.id === code.slice(4),
      )?.parameters[field];
    return code === "model"
      ? (entry.configuration.model?.[field] ??
          base?.configuration.model?.[field])
      : (entry.configuration.policy?.[code]?.[field] ??
          base?.configuration.policy?.[code]?.[field]);
  };
  return [
    {
      title: "多次评估 / 横向结论",
      paragraphs: [
        `共同第一轮：${result.sourceRunId}。主规模${number(main, 0)}卡，目标${percent(result.request.target)}。每行对应一次实际完成的评估。`,
        ...result.assumptions,
      ],
      visual: "experiment-comparison",
      tables: [
        {
          heads: [
            "评估方案",
            "运行",
            "目标",
            "可用度",
            "95%均值区间",
            "轨迹数",
            "结论",
          ],
          rows: comparisonRows(main),
          scaleRows: scales.map((cards) => ({
            cards,
            rows: comparisonRows(cards),
          })),
          scaleLabel: "横向比较规模",
        },
      ],
    },
    {
      title: "多次评估 / 参数横向比较",
      tables: [
        {
          heads: ["参数", ...entries.map((e: any) => e.name)],
          rows: parameterKeys.map((key) => [
            key.split(".")[0] +
              " / " +
              (parameterLabels[key.split(".")[1]] ?? key),
            ...entries.map((e: any) =>
              key.startsWith("ext:") && value(e, key) === undefined
                ? "未部署"
                : number(value(e, key)),
            ),
          ]),
        },
      ],
    },
    ...entries.map((entry: any) => ({
      title: `独立结论 / ${entry.name}`,
      collapsed: true,
      paragraphs: [
        `运行${entry.id}，输入哈希${entry.inputHash}，时间${entry.createdAt}。${entry.round === "current" ? "第一轮现状六项措施贡献。" : "本次改进相对第一轮的增量贡献。"}`,
      ],
      tables: [
        {
          heads: ["措施", "Shapley / pp", "95%区间 / pp"],
          rows: [],
          scaleRows: entry.attribution.map((a: any) => ({
            cards: a.cards,
            rows: a.contributions.map((c: any) => [
              c.name,
              number(c.statistics.mean * 100),
              number(c.statistics.ciLow * 100) +
                " ～ " +
                number(c.statistics.ciHigh * 100),
            ]),
          })),
          scaleLabel: "独立排名规模 · " + entry.id.slice(0, 8),
        },
      ],
    })),
  ];
}
export function experimentChart(result: any) {
  if (result.kind === "expert-audit-plan") return "";
  const entries =
    result.kind === "expert-audit-comparison"
      ? result.entries
      : [
          { name: "第一轮现状", rows: result.baseline.rows },
          { name: result.name, rows: result.rows },
        ];
  const colors = [
    "#647f84",
    "#16816a",
    "#b68035",
    "#8263a6",
    "#ae546b",
    "#3c83b1",
  ];
  const scales = [
    ...new Set<number>(
      entries.flatMap((e: any) => e.rows.map((r: any) => r.cards)),
    ),
  ];
  const targetPoints = scales
    .filter(
      (n) => n !== 1000 || result.request.targets?.[String(n)] !== undefined,
    )
    .map((x) => {
      const v =
        x === result.request.cards
          ? result.request.target
          : (result.request.targets?.[String(x)] ?? result.request.target);
      return { x, statistics: { mean: v, ciLow: v, ciHigh: v } };
    });
  return lineChart({
    title: "各次评估与目标的规模曲线",
    series: [
      ...entries.map((e: any, i: number) => ({
        name: e.name,
        color: colors[i % colors.length],
        points: e.rows.map((r: any) => ({
          x: r.cards,
          statistics: r.statistics,
        })),
      })),
      {
        name: "可用度目标",
        color: "#b24b4b",
        dashed: true,
        points: targetPoints,
      },
    ],
    xLabel: "作业规模 / 卡",
    formatX: (n) => n.toLocaleString() + "卡",
    logarithmic: true,
    note: "只展示各次独立完成评估的冻结数值；连接离散点不证明中间规模。95%均值区间仅反映抽样误差。",
  });
}

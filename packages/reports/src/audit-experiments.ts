import { planScaleSections } from "./audit-plan-scales";
import { auditArchitectureDiagnosis } from "../../analysis/src/audit-architecture";
import { trainingScenarioComparisonTables } from "./audit-training-scenario";
import { analysisWorkbenchHtml } from "./audit-analysis-workbench";
import { topologyEstimateDetails } from "./audit-topology-decision";
import { topologyDecision } from "../../analysis/src/audit-topology-decision";
import { decisionStudySections } from "./audit-decision-study";
import { architectureSections } from "./audit-architecture";
import { auditMechanismSummary } from "../../contracts/src/audit-mechanism-view";
import {
  auditReferenceOnly,
  auditSummaryRows,
} from "../../contracts/src/audit-presets";
import type { Run } from "../../contracts/src/types";
import type { AuditSection } from "./audit";
import { parameterLabels } from "./audit-labels";
import { lineChart } from "./audit-charts";
import {
  auditNumber as number,
  auditPercent as percent,
  auditParameter,
} from "../../contracts/src/audit-recovery-budget";
export const experimentStatus: Record<string, string> = {
  supported: "假设下采样支持",
  below: "低于目标",
  uncertain: "区间跨目标，需复核",
};
export function compareAuditExperiments(
  runs: Run[],
  mechanismStudies: Run[] = [],
) {
  if (
    runs.length < 2 ||
    runs.length > 12 ||
    new Set(runs.map((r) => r.id)).size !== runs.length
  )
    throw new Error("请选择2至12次不同的已完成评估");
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
  const trainingFamily = runs.every(
    (r) =>
      r.result.kind === "expert-review-audit" &&
      r.result.request.trainingScenario?.version === "training-600h.v1",
  );
  if (trainingFamily) {
    const order = ["current", "extension", "breakthrough"];
    runs = [...runs].sort(
      (a, b) =>
        order.indexOf(a.result.request.trainingScenario.id) -
          order.indexOf(b.result.request.trainingScenario.id) ||
        String(a.createdAt).localeCompare(String(b.createdAt)),
    );
    const identity = (r: any) =>
      JSON.stringify({
        hours: r.request.hours,
        metric: r.metricId,
        version: r.modelVersion,
        cards: r.request.cards,
        target: r.request.target,
        targets: r.request.targets,
        scales: [...new Set(r.rows.map((s: any) => s.cards))].sort(),
        architecture: r.architectureDiagnosis?.architecture,
        events: r.events.map((e: any) => [e.id, e.type]).sort(),
      });
    if (
      runs.some(
        (r) =>
          r.result.request.hours !== 600 ||
          identity(r.result) !== identity(runs[0].result),
      )
    )
      throw new Error(
        "三档独立评估需使用相同600小时窗口、目标、规模、架构、事件目录及模型版本；FIT与措施参数可不同",
      );
  }
  if (!trainingFamily && (sourceIds.size !== 1 || bases.length > 1))
    throw new Error("请选择基于同一次第一轮、相同目标和故障证据的评估");
  const base =
      (trainingFamily
        ? bases.find((r) => r.result.request.trainingScenario.id === "current")
        : undefined) ?? bases[0],
    first = runs[0];
  const request = base?.result.request ?? first.result.request;
  if (
    mechanismStudies.length > 6 ||
    new Set(mechanismStudies.map((r) => r.id)).size !==
      mechanismStudies.length ||
    mechanismStudies.some(
      (r) =>
        r.status !== "succeeded" ||
        r.result?.kind !== "expert-audit-experiment" ||
        r.result.sourceRunId !== base?.id ||
        r.result.sourceInputHash !== base?.inputHash,
    )
  )
    throw new Error(
      "增量收益研究须来自本比较冻结的现状运行，最多6项且不可重复",
    );
  const entries = runs.map((run) => ({
    id: run.id,
    name:
      run.result.kind === "expert-review-audit"
        ? trainingFamily
          ? run.result.request.trainingScenario.name
          : "第一轮现状"
        : run.result.name,
    round: run.result.kind === "expert-review-audit" ? "current" : "scenario",
    inputHash: run.inputHash,
    trainingScenario: run.result.request.trainingScenario,
    events: run.result.events,
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
    architectureDiagnosis:
      trainingFamily && base?.result.architectureDiagnosis
        ? auditArchitectureDiagnosis(
            run.result,
            base.result.architectureDiagnosis,
          )
        : run.result.architectureDiagnosis,
    sampling:
      run.result.kind === "expert-review-audit"
        ? run.result.request.trials
        : run.result.rows[0]?.statistics.n,
  }));
  const comparison = {
    kind: "expert-audit-comparison",
    name: "多次评估横向比较",
    metricId: "training.retained-clean-progress",
    request,
    sourceRunId: trainingFamily ? base?.id : [...sourceIds][0],
    comparisonMode: trainingFamily ? "training-scenarios" : "frozen-baseline",
    allocationReferenceRunId: trainingFamily ? base?.id : undefined,
    entries,
    mechanismStudies: mechanismStudies.map((r) => ({
      ...r.result,
      id: r.id,
      inputHash: r.inputHash,
      createdAt: r.createdAt,
    })),
    assumptions: trainingFamily
      ? [
          "这些是分别执行的600小时输入场景，60%/82%/98.5%是用户参考值，结果使用各次实际仿真值。FIT与措施允许不同，不能将跨场景差值解释为单项措施的因果贡献。",
          `比较图统一沿用 ${base?.result.request.trainingScenario.name}（${base?.id}）的分层预算与证据；仅派生比较视图，不修改任何原始运行。`,
          "每档Shapley相对各自固定基线，排名不直接相减；需要改进增量归因时，从同一现状运行创建独立改进评估。",
          "源模板记录载入意图，之后允许继续编辑；真实输入以每次计算配置和事件快照为准。未建模对象不构成达标证明。",
        ]
      : [
          `现状配置：${auditMechanismSummary(request, (base ?? first).result.selection).title}；${auditMechanismSummary(request, (base ?? first).result.selection).roles}。`,
          "只比较同一冻结第一轮、目标、故障模式与计算口径；每次参数独立保存，不重新计算或替换旧结果。",
          "第一轮排名是所选候选措施相对固定基线的组合贡献；改进排名是相对第一轮的增量，基准不同，不直接相加排名。",
          "第一轮真实现状指使用确认的现状参数评估，不等同于现场可用度实测。",
          "分配建议未执行第二轮；只有用户单独点击并完成的评估进入横向比较。",
        ],
  };
  return {
    ...comparison,
    topologyDecision: topologyDecision(
      comparison,
      base?.result.topologyDecision,
    ),
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
          .map(([k, v]) => `${k}=${auditParameter(Number(v), k)}`)
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
        factor.kind === "fit"
          ? "见来源"
          : auditParameter(factor.before?.[key], key),
        auditParameter(Number(value), key),
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
  result = {
    ...result,
    ...(result.rows
      ? { rows: auditSummaryRows(result.request, result.rows) }
      : {}),
    ...(result.allocations
      ? { allocations: auditSummaryRows(result.request, result.allocations) }
      : {}),
    ...(result.attribution
      ? { attribution: auditSummaryRows(result.request, result.attribution) }
      : {}),
  };
  if (result.kind === "expert-audit-plan-set") return planScaleSections(result);
  if (result.kind === "expert-audit-plan") {
    return [
      ...decisionStudySections(result),
      {
        title:
          "改进分配 / " +
          (result.allocations[0]?.methodName ?? "AGREE") +
          "建议（尚未评估）",
        paragraphs: [
          `现状配置：${auditMechanismSummary(result.request, result.selection).title}；${auditMechanismSummary(result.request, result.selection).roles}。`,
          `第一轮运行 ${result.sourceRunId}；规划规模${number(result.prediction.cards, 0)}卡，目标${percent(result.prediction.target)}，规划试算${percent(result.prediction.mean)}。${result.prediction.note}`,
          "现状措施、参数与故障证据保持在原运行快照中；本次分配生成独立的改进要求，具体数值以方案参数表为准。",
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
      ...architectureSections(result),
      {
        title: "分层薄弱点到机制的责任追溯",
        paragraphs: [
          "原分层预算与现状保持冻结；只在机制适用的故障范围内分担设计责任。未覆盖责任单列，需要新增措施或进一步建模；下表不是机制独立物理损失。",
        ],
        tables: [
          {
            heads: [
              "架构叶层",
              "适用措施",
              "现状设计责任 / h",
              "原分层参照 / h",
              "故障 / 开销",
              "可改善损失项",
            ],
            rows: [],
            scaleLabel: "责任追溯规模",
            scaleRows: result.allocations.map((a: any) => ({
              cards: a.cards,
              rows: (a.layerLinks ?? [])
                .filter((l: any) => l.actualHours > 0 || l.allowedHours > 0)
                .map((l: any) => [
                  l.layerName,
                  l.mechanismName,
                  number(l.actualHours),
                  number(l.allowedHours),
                  l.eventIds.join("、"),
                  l.lossKeys?.join("、") ?? "历史责任未分损失项",
                ]),
            })),
          },
        ],
      },
      {
        title:
          (result.allocations[0]?.methodName ?? "AGREE责任") + "分配与重要度",
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
        title: `改进评估 / ${result.name}（独立执行）`,
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
      ...architectureSections(result),
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
          "仅分摊本次改进相对冻结第一轮的增量；现状候选措施相对固定基线的贡献请查看第一轮报告。每次评估的排名独立保存。",
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
  ].sort(
    (a, b) =>
      Number(auditReferenceOnly(result.request, a)) -
        Number(auditReferenceOnly(result.request, b)) || a - b,
  );
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
        `${result.comparisonMode === "training-scenarios" ? "分层预算参照" : "共同第一轮"}：${result.allocationReferenceRunId ?? result.sourceRunId}。主规模${number(main, 0)}卡，目标${percent(result.request.target)}。每行对应一次实际完成的评估。`,
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
      title: "各轮分层薄弱点比较",
      paragraphs: [
        "按相同架构、同一分层目标比较各轮叶层损失；父层只作汇总。现有措施贡献与改进增量分别排序。",
      ],
      tables: [
        {
          heads: [
            "评估",
            "主要薄弱层",
            "主要损失",
            "损失 / h",
            "超分层预算 / h",
            "改善方向",
          ],
          rows: [],
          scaleLabel: "薄弱点对比规模",
          scaleRows: scales.map((cards) => ({
            cards,
            rows: entries.flatMap((entry: any) => {
              const scale = entry.architectureDiagnosis?.scales.find(
                (s: any) => s.cards === cards,
              );
              return scale
                ? scale.weaknesses
                    .slice(0, 3)
                    .map((w: any) => [
                      entry.name,
                      w.name,
                      w.focus,
                      number(w.lossHours),
                      number(w.excessHours),
                      w.action,
                    ])
                : [
                    [
                      entry.name,
                      "历史结果未保存分层诊断",
                      "—",
                      "—",
                      "—",
                      "保持原结果与口径",
                    ],
                  ];
            }),
          })),
        },
      ],
    },
    {
      title: "多次评估 / 参数横向比较",
      tables: [
        ...trainingScenarioComparisonTables(result),
        {
          heads: ["参数", ...entries.map((e: any) => e.name)],
          rows: parameterKeys.map((key) => [
            key.split(".")[0] +
              " / " +
              (parameterLabels[key.split(".")[1]] ?? key),
            ...entries.map((e: any) =>
              key.startsWith("ext:") && value(e, key) === undefined
                ? "未部署"
                : auditParameter(value(e, key), key),
            ),
          ]),
        },
      ],
    },
    ...entries.map((entry: any) => ({
      title: `独立结论 / ${entry.name}`,
      collapsed: true,
      paragraphs: [
        `运行${entry.id}，输入哈希${entry.inputHash}，时间${entry.createdAt}。${entry.round === "current" ? "现状所选候选措施相对固定基线的贡献。" : "本次改进相对第一轮的增量贡献。"}`,
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
    .filter((n) => !auditReferenceOnly(result.request, n))
    .map((x) => {
      const v =
        x === result.request.cards
          ? result.request.target
          : (result.request.targets?.[String(x)] ?? result.request.target);
      return { x, statistics: { mean: v, ciLow: v, ciHigh: v } };
    });
  const decision =
    result.comparisonMode === "training-scenarios"
      ? `<details open><summary>展开三档分层分配、差距与机制总图</summary><div class="table-wrap">${analysisWorkbenchHtml(result, result.request.cards)}</div></details>${topologyEstimateDetails(result, result.request.cards)}`
      : "";
  return (
    decision +
    lineChart({
      title: "各次评估与目标的规模曲线",
      series: [
        ...entries.map((e: any, i: number) => ({
          name: e.name,
          color: colors[i % colors.length],
          points: e.rows
            .filter((r: any) => !auditReferenceOnly(result.request, r.cards))
            .map((r: any) => ({
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
    })
  );
}

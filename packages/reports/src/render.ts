import { planScaleChart } from "./audit-plan-scales";
import { decisionStudyCharts } from "./audit-decision-study";
import {
  architectureReport,
  architectureCss,
  architectureMarkdown,
} from "./audit-architecture";
import { experimentSections, experimentChart } from "./audit-experiments";
import { runAssessmentModel } from "../../contracts/src/assessment-model";
import { auditObjectDiagram } from "./audit-object-diagram";
import type { Run } from "../../contracts/src/types";
import {
  validationSummary,
  reportAttachment,
  diagnosticText,
} from "./validation-summary";
import { auditSections, type AuditSection, type AuditTable } from "./audit";
import {
  auditOptimizationBrief,
  auditOptimizationChart,
  auditOptimizedObjectDiagram,
  optimizationCss,
} from "./audit-optimization";
import {
  auditChartCss,
  auditGainCharts,
  auditContributionChart,
  auditContributionScaleControl,
  auditScaleCurve,
  auditSensitivityCurves,
} from "./audit-charts";
import {
  auditVisuals,
  auditMethodVisual,
  reportEnhancementCss,
  reportInteractionScript,
} from "./audit-visuals";
type Table = AuditTable;
type Section = AuditSection;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const num = (v: unknown) =>
  finite(v) ? v.toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—";
const pct = (v: unknown) => (finite(v) ? (v * 100).toFixed(3) + "%" : "—");
const points = (v: unknown) =>
  finite(v) ? (v > 0 ? "+" : "") + (v * 100).toFixed(3) + " 百分点" : "—";
const range = (s: any) => pct(s?.ciLow) + " ～ " + pct(s?.ciHigh);
const escape = (v: unknown) =>
  String(v ?? "—").replace(/[&<>"']/g, (c) =>
    c === "'"
      ? "&#39;"
      : { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!,
  );
const mdCell = (v: unknown) =>
  escape(v)
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");
const referenceSourceFields = (
  e: NonNullable<AuditTable["eventSources"]>[number],
) =>
  [
    ["专家事件证据", e.referenceEvidence],
    ["专家审核备注", e.referenceReviewNote],
    ["历史事件细分依据", e.legacyEvidence],
    ["历史FIT依据", e.fitEvidence],
  ].filter((entry) => entry[1]);
const statuses: Record<string, string> = {
  queued: "等待运行",
  running: "正在计算",
  succeeded: "计算完成",
  failed: "计算失败",
  cancelled: "已取消",
};
const methods: Record<string, string> = {
  equal: "等分故障率预算",
  arinc: "按基线故障率分配",
  agree: "AGREE 近似分配",
  "agree.nasa2016-rate": "AGREE 近似分配",
  "agree.classical": "AGREE 经典条件分配",
  availability: "稳态可用度分配",
  rbd: "可靠性框图",
  fta: "故障树",
  bdd: "二叉决策图",
};
const parameters: Record<string, string> = {
  saveSeconds: "检查点保存阻塞（秒）",
  intervalSeconds: "检查点计算周期（秒）",
  silentDetect: "静默即时检出率（%）",
  mode: "恢复方式",
  globalMinutes: "全局恢复（分钟）",
  localMinutes: "局部恢复（分钟）",
  fits: "四类 FIT",
  recoveryDomains: "恢复域数",
};
const losses: Record<string, string> = {
  pause: "停顿与恢复",
  checkpointSave: "检查点保存阻塞",
  unavailableCapacity: "失效容量",
  slowdown: "亚健康降速",
  monitoring: "监测开销",
  replaySlowdown: "重放降速",
  rollback: "回退与重算",
  unrecoveredCorruptWork: "未恢复污染工作",
  terminalDiscard: "终末污染连带丢弃",
};
const searchNames: Record<string, string> = {
  proven_infeasible: "有限设计范围内有不可行证据",
  no_candidate_found: "本次采样未找到候选",
  verified_candidate: "候选通过本次独立采样验证",
  candidate_unconfirmed: "候选仍需更多验证",
};
const operations: Record<string, string> = {
  audit: "第一轮现状评估",
  "audit-plan": "AGREE第二轮分配建议（未评估）",
  "audit-plan-scales": "各规模AGREE改进建议（未评估）",
  "audit-experiment": "改进方案独立评估",
  "audit-compare": "多次评估横向比较",
  training: "历史模型 V4 评估",
  allocate: "目标分配",
  compare: "方案比较",
  search: "有限设计搜索",
  sensitivity: "参数敏感性",
  attribute: "组合贡献分析",
  static: "静态结构求解",
  ctmc: "状态与奖励求解",
  repairable: "可修复系统评估",
};
function evidence(s: any, target: unknown) {
  if (!finite(target) || !finite(s?.mean)) return "未设置可比较的目标";
  if (finite(s.ciLow) && s.ciLow >= target)
    return "采样区间下限达到目标，仅支持当前场景条件";
  if (finite(s.ciHigh) && s.ciHigh < target) return "采样区间整体低于目标";
  return "采样区间跨越目标，尚不能确认";
}
function sampling(s: any) {
  return (
    "样本 " +
    num(s?.n) +
    " 条。固定样本 Student-t 95% 均值区间采用近似分位数，仅反映蒙特卡洛采样误差，不含参数与模型误差。" +
    (s?.n < 30 || s?.variance === 0
      ? " 当前样本量较少或样本方差为零，不能由未观察到差异证明稀有故障不存在。"
      : " 稀有故障仍需足够暴露量与独立验证。")
  );
}
function training(r: any, target: unknown): Section[] {
  const s = r.statistics,
    point = finite(target)
      ? "点估计" + (s.mean >= target ? "达到" : "低于") + "目标 " + pct(target)
      : "未设置目标";
  const sections: Section[] = [
    {
      title: "训练结论",
      paragraphs: [
        "可用度（历史模型 V4）均值 " +
          pct(s.mean) +
          "；" +
          point +
          "。" +
          evidence(s, target) +
          "。",
        sampling(s),
        "当前结果评价已声明的场景条件，不能据此宣称产品已经达标。",
      ],
      tables: [
        {
          heads: ["指标", "结果"],
          rows: [
            ["可用度均值", pct(s.mean)],
            [
              "距目标（均值 − 目标）",
              finite(target) ? points(s.mean - target) : "—",
            ],
            ["95% 均值区间", range(s)],
            ["满足目标的轨迹比例", pct(s.achievementProbability)],
            [
              "轨迹比例的 Wilson 95% 区间",
              pct(s.achievementInterval?.low) +
                " ～ " +
                pct(s.achievementInterval?.high),
            ],
            [
              "P05 / P50 / P95",
              pct(s.p05) + " / " + pct(s.p50) + " / " + pct(s.p95),
            ],
            ["辅助指标：运行可用度", pct(r.diagnostics?.uptime)],
          ],
        },
      ],
    },
    {
      title: "指标口径与风险",
      paragraphs: [
        "正确进展乘以期末无未解决污染指示，再除以窗口理想产出。期末仍存在污染时，整条轨迹交付为零，污染前正确工作也计入终末污染连带丢弃。",
        "单窗口满足目标的比例与均值是否达到目标分别判断。运行可用度、MTBF 与主指标可用度的计算口径不同，不能混用。",
      ],
    },
    {
      title: "损失账本",
      paragraphs: [
        "单位为平均等效训练小时。仅列互斥损失项，不将总计算工作、已交付工作或数值残差重复当作损失。账本是核算，干预贡献需单独比较。",
      ],
      tables: [
        {
          heads: ["损失项", "平均损失（等效小时）"],
          rows: Object.entries(losses)
            .filter(([k]) => finite(r.ledger?.[k]))
            .map(([k, name]) => [name, num(r.ledger[k])]),
        },
      ],
    },
  ];
  const budget = r.request?.lossBudget;
  if (budget) {
    const groups = [
      ["0", "检测与恢复停顿", ["pause"]],
      ["1", "检查点与回滚", ["checkpointSave", "rollback"]],
      [
        "2",
        "容量与亚健康",
        ["unavailableCapacity", "slowdown", "monitoring", "replaySlowdown"],
      ],
      ["3", "污染与交付清零", ["unrecoveredCorruptWork", "terminalDiscard"]],
    ] as const;
    const items = Array.isArray(budget.items) ? budget.items : [],
      total = items.reduce(
        (sum: number, i: any) =>
          sum + (finite(i.lossHoursBudget) ? i.lossHoursBudget : 0),
        0,
      );
    const valid =
      budget.target === r.request.target &&
      budget.hours === r.request.hours &&
      items.length === 4 &&
      new Set(items.map((i: any) => String(i.id))).size === 4 &&
      groups.every(([id]) =>
        items.some(
          (i: any) =>
            String(i.id) === id &&
            finite(i.lossHoursBudget) &&
            i.lossHoursBudget >= 0,
        ),
      ) &&
      Math.abs(total - (1 - budget.target) * budget.hours) < 1e-8;
    sections.push({
      title: "实际损失与保存预算",
      paragraphs: [
        valid
          ? "目标与窗口一致，以下只比较平均损失点估计；工程能力仍需确认。"
          : "预算已失效：目标、窗口或预算结构与本次输入不匹配，当前不作符合结论。",
      ],
      tables: [
        {
          heads: [
            "互斥损失组",
            "平均实际损失（小时）",
            "预算（小时）",
            "点估计对照",
            "工程落实",
          ],
          rows: groups.map(([id, name, keys]) => {
            const actual = keys.reduce(
                (sum, k) => sum + (finite(r.ledger?.[k]) ? r.ledger[k] : 0),
                0,
              ),
              allocated = items.find(
                (i: any) => String(i.id) === id,
              )?.lossHoursBudget;
            return [
              name,
              num(actual),
              num(allocated),
              valid
                ? actual <= allocated + 1e-10
                  ? "平均点估计未超预算"
                  : "平均点估计超出预算"
                : "不作判断",
              "工程参数映射待确认",
            ];
          }),
        },
      ],
    });
  }
  return sections;
}
function core(r: any, run: Run): Section[] {
  if (!r)
    return [
      {
        title: "运行状态",
        paragraphs: [
          (statuses[run.status] ?? run.status) +
            "：" +
            (run.error
              ? diagnosticText(run.error.message)
              : "暂无成功计算结果"),
        ],
      },
    ];
  if (
    [
      "expert-audit-plan-set",
      "expert-audit-plan",
      "expert-audit-experiment",
      "expert-audit-comparison",
    ].includes(r.kind)
  )
    return experimentSections(r);
  if (r.kind === "expert-review-audit") return auditSections(r);
  if (r.statistics && r.ledger)
    return training(r, r.request?.target ?? run.input.target);
  if (r.contributions)
    return [
      {
        title: "Shapley 干预贡献",
        paragraphs: [
          "组合总交付变化 " +
            points(r.gain) +
            "。负贡献表示该干预在当前组合和参数下平均降低交付。",
          "完整组合枚举，保留正负贡献；贡献之和与组合总变化核对。账本比例不等同于 Shapley 贡献。",
          sampling(r.contributions[0]?.statistics),
        ],
        tables: [
          {
            heads: ["干预", "贡献", "95% 采样区间"],
            rows: r.contributions.map((i: any) => [
              i.name ?? i.id,
              points(i.shapley),
              points(i.statistics?.ciLow) +
                " ～ " +
                points(i.statistics?.ciHigh),
            ]),
          },
        ],
      },
      {
        title: "干预组合",
        tables: [
          {
            heads: ["组合", "交付均值", "95% 均值区间"],
            rows: (r.coalitions ?? []).map((c: any) => [
              c.factors?.length
                ? c.factors
                    .map(
                      (id: string) =>
                        r.contributions.find((i: any) => i.id === id)?.name ??
                        id,
                    )
                    .join(" + ")
                : "基线",
              pct(c.result?.statistics?.mean),
              range(c.result?.statistics),
            ]),
          },
        ],
      },
    ];
  if (searchNames[r.status]) {
    const target =
      r.target ??
      r.verification?.request?.target ??
      r.items?.[0]?.result?.request?.target;
    const sections: Section[] = [
      {
        title: "设计搜索",
        paragraphs: [
          searchNames[r.status],
          "仅枚举给定的有限设计集合；未找到候选不等于不可行。验证通过仅支持当前模型条件。",
          ...(r.status === "proven_infeasible"
            ? [
                "证书要求干净检查点回退，且不可通过即时 step 恢复保留工作并跳过保存；给定候选的有限窗口上界低于目标。",
              ]
            : []),
        ],
        tables: [
          {
            heads: ["搜索信息", "结果"],
            rows: [
              ["候选数量", num(r.candidateCount)],
              ["场景目标", pct(target)],
              ["有限窗口上界", pct(r.upperBound)],
              ["连续计算 / 保存占空比", pct(r.checkpointDutyCycle)],
            ],
          },
        ],
      },
    ];
    if (r.verification)
      sections.push({
        title: "独立验证",
        paragraphs: [
          evidence(r.verification.statistics, target),
          sampling(r.verification.statistics),
          "验证与筛选使用不重叠的实际轨迹种子集合，避免重复使用筛选样本。",
        ],
        tables: [
          {
            heads: ["验证统计", "结果"],
            rows: [
              ["交付均值", pct(r.verification.statistics.mean)],
              ["95% 均值区间", range(r.verification.statistics)],
              ["独立验证种子", num(r.verification.request?.seed)],
            ],
          },
        ],
      });
    sections.push({
      title: "搜索候选",
      tables: [
        {
          heads: ["候选设计", "筛选均值", "95% 均值区间", "目标证据"],
          rows: (r.items ?? []).map((i: any) => [
            Object.entries(i.patch ?? {})
              .map(
                ([k, v]) =>
                  (parameters[k] ?? k) +
                  "：" +
                  (Array.isArray(v) ? v.join(" / ") : String(v)),
              )
              .join("；"),
            pct(i.result?.statistics?.mean),
            range(i.result?.statistics),
            evidence(i.result?.statistics, target),
          ]),
        },
      ],
    });
    return sections;
  }
  if (r.base?.statistics && r.items)
    return [
      {
        title: r.parameter ? "参数敏感性" : "方案比较",
        paragraphs: [
          "基线可用度均值 " +
            pct(r.base.statistics.mean) +
            "。" +
            (r.parameter
              ? "参数：" + (parameters[r.parameter] ?? r.parameter) + "。"
              : "") +
            "使用配对样本比较变化。",
          sampling(r.base.statistics),
          "变化以百分点表示，正值为交付改善。配对种子不意味着变化后的故障事件严格对齐。",
        ],
        tables: [
          {
            heads: [
              "方案 / 参数取值",
              "交付均值",
              "95% 均值区间",
              "相对基线变化",
              "变化的 95% 区间",
              "目标证据",
            ],
            rows: r.items.map((i: any) => [
              i.name ?? i.id,
              pct(i.result?.statistics?.mean),
              range(i.result?.statistics),
              points(i.delta?.mean),
              points(i.delta?.ciLow) + " ～ " + points(i.delta?.ciHigh),
              evidence(i.result?.statistics, r.base.request?.target),
            ]),
          },
        ],
      },
    ];
  if (r.stationary)
    return [
      {
        title: "CTMC 状态与奖励",
        paragraphs: [
          "稳态期望奖励是输入状态奖励的加权平均，保留原奖励单位；只有输入奖励为 0/1 可用状态指示时，才可另行解释为可用度。",
          "恒定转移率与指数停留时间；稳态分布要求唯一。累计奖励从时间零积分至最后请求时刻，不等同于训练可用度。",
        ],
        tables: [
          {
            heads: ["奖励统计", "结果"],
            rows: [
              ["稳态期望奖励", num(r.stationaryReward)],
              ["累计期望奖励", num(r.integratedReward)],
            ],
          },
          {
            heads: ["状态", "稳态概率"],
            rows: r.stationary.map((p: number, i: number) => [
              "状态 " + i,
              pct(p),
            ]),
          },
        ],
      },
      {
        title: "CTMC 瞬态分布",
        tables: [
          {
            heads: [
              "时间",
              "期望奖励",
              ...r.stationary.map(
                (_: number, i: number) => "状态 " + i + " 概率",
              ),
            ],
            rows: (r.transient ?? []).map((i: any) => [
              num(i.time),
              num(i.reward),
              ...i.probabilities.map(pct),
            ]),
          },
        ],
      },
    ];
  if (finite(r.probability))
    return [
      {
        title: "静态结构结果",
        paragraphs: [
          "重复基本事件 ID 已共享处理；不同事件仍按独立假设计算，相关事件需联合模型。",
        ],
        tables: [
          {
            heads: ["指标", "结果"],
            rows: [
              ["方法", methods[r.method] ?? r.method],
              [
                r.details?.metric === "top-event probability"
                  ? "顶事件发生概率"
                  : "系统成功概率",
                pct(r.probability),
              ],
              ["基本事件数", num(r.details?.eventCount)],
              ["BDD 节点数", num(r.details?.bddNodes)],
            ],
          },
        ],
      },
    ];
  if (r.items && r.method)
    return [
      {
        title: methods[r.method] ?? "设计分配",
        paragraphs: [
          r.method === "availability"
            ? "稳态可用度设计预算，使用相同指标的实测基线比较。"
            : "任务可靠度与故障率设计预算，实施后需在适用结构中正向验证。",
          r.version === "agree.classical-conditional.v1"
            ? "经典AGREE以条件故障重要度分配；按∏[1−Eᵢ(1−Rᵢ)]核对设计目标。Eᵢ不能由Shapley贡献直接充当，实际结构仍需正向验证。"
            : r.version === "agree.nasa2016-rate"
              ? "AGREE 按 ∏Rᵢ^Eᵢ 回合成加权任务可靠度；普通串联乘积不一定等于总体目标。"
              : "分配不代表模块工程能力已经达成。",
          r.recomposition
            ? "回合成：" +
              r.recomposition.formula +
              " = " +
              pct(r.recomposition.achieved) +
              "；目标 " +
              pct(r.recomposition.target)
            : "",
          "先通过降低 FIT 或检测、恢复等机制落实子目标，再正向验证与做 Shapley 组合收益分摊。",
        ],
        tables: [
          {
            heads: [
              "模块",
              "当前估计",
              "分配目标",
              "目标与当前差额",
              "目标故障率 / 小时",
              "约束",
            ],
            rows: r.items.map((i: any) => [
              i.name ?? i.id,
              pct(i.current),
              pct(i.target),
              points(i.gap),
              r.method === "availability"
                ? "不适用"
                : finite(i.targetRate)
                  ? i.targetRate.toExponential(4)
                  : "—",
              i.locked !== undefined
                ? "锁定 " + pct(i.locked)
                : i.bounds
                  ? pct(i.bounds.min ?? 0) + " ～ " + pct(i.bounds.max ?? 1)
                  : "自由分配",
            ]),
          },
        ],
      },
    ];
  if (finite(r.availability))
    return [
      {
        title: "可修复系统",
        tables: [
          {
            heads: ["指标", "结果"],
            rows: [
              ["稳态系统可用度", pct(r.availability)],
              ["无中断任务可靠度", pct(r.taskReliability)],
              ["任务时长（小时）", num(r.hours)],
            ],
          },
          {
            heads: ["模块", "稳态可用度", "任务可靠度", "平均修复时间（小时）"],
            rows: (r.items ?? []).map((i: any) => [
              i.id,
              pct(i.availability),
              pct(i.taskReliability),
              num(i.mttr),
            ]),
          },
        ],
      },
    ];
  return [
    {
      title: "计算结果",
      paragraphs: [
        "已完成 " + run.operation + "；完整结构与诊断保留在详情中。",
      ],
    },
  ];
}
function mdTable(t: Table) {
  return [
    "| " + t.heads.map(mdCell).join(" | ") + " |",
    "| " + t.heads.map(() => "---").join(" | ") + " |",
    ...t.rows.map((row) => "| " + row.map(mdCell).join(" | ") + " |"),
  ].join("\n");
}
export interface ReportOptions {
  taskId?: string;
  /** Relative sibling JSON in offline files; task-scoped endpoint in the workspace. */
  attachmentHref?: string;
  onlineAttachmentHref?: string;
  offlinePackage?: boolean;
}
export function report(run: Run, format = "md", options: ReportOptions = {}) {
  if (format === "json") return JSON.stringify(run, null, 2);
  const result = run.status === "succeeded" ? run.result : undefined,
    sections = core(result, run);
  const isAudit = result?.kind === "expert-review-audit",
    model = runAssessmentModel(run),
    title = "可靠性设计与评估报告" + (model ? " · " + model.name : "");
  if (model)
    sections.unshift({
      title: "评估模型与指标口径",
      paragraphs: [
        model.name + "：" + model.description,
        "指标标识：" +
          model.metricId +
          "。本报告依据原运行快照生成，切换当前设计不会改变历史结果。不同口径的结果不直接排名。",
      ],
    });
  if (result)
    sections.push({
      title: "设计建议与可信度限制",
      paragraphs: [
        "优先分析实际损失，再通过方案比较、敏感性和组合贡献验证候选。未经比较，不指定所谓最优方案。",
        "参数、传播与机制成功率需产品实测校准。示例回归不能证明产品预测准确度；抽样区间不能覆盖参数与模型误差。",
      ],
    });
  const metadata =
    "运行：" +
    run.id +
    "；状态：" +
    (statuses[run.status] ?? run.status) +
    "；方法：" +
    (operations[run.operation] ?? run.operation) +
    "；时间：" +
    run.createdAt;
  const summary = validationSummary(run, options.taskId),
    attachment = reportAttachment(run);
  // Restrict custom links to HTTP(S), task paths or a safe sibling filename.
  const proposedHref = options.attachmentHref ?? attachment.filename;
  const href =
    /^(?:https?:\/\/[^\s<>"']+|\/api\/[^\s<>"']+|[a-zA-Z0-9._-]+\.json)$/.test(
      proposedHref,
    )
      ? proposedHref
      : attachment.filename;
  const onlineHref =
    options.onlineAttachmentHref &&
    /^https?:\/\/[^\s<>"']+$/.test(options.onlineAttachmentHref)
      ? options.onlineAttachmentHref
      : undefined;
  const attachmentNote = options.offlinePackage
    ? "完整技术附件已随离线报告包保存。请先解压，保持报告与 JSON 同目录；无需平台服务或网络。"
    : "正文不包含完整技术附件。离线阅读请下载包含完整技术附件的 ZIP 包并解压，或将独立 JSON 保存到正文同目录。";
  sections.push({
    title: "验证与诊断摘要",
    paragraphs: [
      summary.note,
      ...summary.trace,
      ...(summary.omittedAnomalies
        ? [`另有 ${summary.omittedAnomalies} 条异常/提醒，见 JSON 附件。`]
        : []),
    ],
    tables: [
      { heads: ["摘要项", "内容"], rows: summary.rows },
      ...(summary.anomalies.length
        ? [
            {
              heads: ["异常/提醒", "项目", "说明"],
              rows: summary.anomalies.map((a) => [a.status, a.name, a.detail]),
            },
          ]
        : []),
    ],
  });
  if (!result)
    sections[model ? 1 : 0].title =
      run.status === "failed" ? "失败诊断" : "未完成运行诊断";
  if (format !== "html")
    return (
      "# " +
      title +
      "\n\n" +
      mdCell(metadata) +
      "\n\n" +
      sections
        .map(
          (s) =>
            (s.collapsed
              ? "<details>\n<summary>" + mdCell(s.title) + "</summary>\n\n"
              : "## " + s.title + "\n\n") +
            (s.paragraphs ?? []).map(mdCell).join("\n\n") +
            (s.visual === "architecture" ? architectureMarkdown(result) : "") +
            (s.tables?.length
              ? "\n\n" +
                s.tables
                  .map(
                    (t) =>
                      (t.scaleRows && t.scaleRows.length > 1
                        ? t.scaleRows
                            .map(
                              (s) =>
                                "### " +
                                num(s.cards) +
                                " 卡 · " +
                                (t.scaleLabel ?? "对照") +
                                "\n\n" +
                                mdTable({ ...t, rows: s.rows }),
                            )
                            .join("\n\n")
                        : mdTable(t)) +
                      (t.eventSources
                        ? "\n\n### 数据来源与归因说明\n\n" +
                          t.eventSources
                            .map(
                              (e) =>
                                `#### ${mdCell(e.id)} · ${mdCell(e.description)}\n\n证据等级：${mdCell(e.evidence)}；硬件/根因域：${mdCell(e.domain)}。\n\n来源：${mdCell(e.source)}\n\n本次校准说明：${mdCell(e.note || "未补充")}\n\n${referenceSourceFields(
                                  e,
                                )
                                  .map(
                                    ([label, text]) =>
                                      `${mdCell(label)}：${mdCell(text)}`,
                                  )
                                  .join("\n\n")}\n`,
                            )
                            .join("\n")
                        : ""),
                  )
                  .join("\n\n")
              : "") +
            (s.collapsed ? "\n\n</details>" : ""),
        )
        .join("\n\n") +
      "\n\n## 技术附件\n\n[" +
      attachment.label +
      "](" +
      href +
      ")" +
      (onlineHref ? " · [在线下载 JSON](" + onlineHref + ")" : "") +
      "\n\n文件名：" +
      attachment.filename +
      "。" +
      attachmentNote +
      "\n"
    );
  let renderedTables = 0;
  const tableRows = (t: Table, rows: unknown[][]) =>
    rows
      .map(
        (row, index) =>
          "<tr" +
          (t.eventSources
            ? ' data-search="' +
              escape(
                [
                  t.eventSources[index].source,
                  t.eventSources[index].note,
                  ...referenceSourceFields(t.eventSources[index]).map(
                    (entry) => entry[1],
                  ),
                ].join(" "),
              ) +
              '" data-fit="' +
              escape(row[3]) +
              '"'
            : "") +
          ">" +
          row
            .map(
              (c, column) =>
                "<td>" +
                (t.eventSources && column === row.length - 1
                  ? '<span class="evidence-badge">' +
                    escape(c) +
                    '</span><a class="source-link" href="#event-source-' +
                    index +
                    '">查看来源 ↗</a>'
                  : escape(c)) +
                "</td>",
            )
            .join("") +
          "</tr>",
      )
      .join("");
  const htmlTable = (t: Table) => {
    const tableId = "report-table-" + renderedTables++;
    return (
      (t.scaleRows && t.scaleRows.length > 1
        ? '<label class="scale-table-control">' +
          escape(t.scaleLabel ?? "表格规模") +
          '<select aria-label="' +
          escape(t.scaleLabel ?? "表格规模") +
          '" data-table-scale="' +
          tableId +
          '">' +
          t.scaleRows
            .map(
              (s) =>
                '<option value="' +
                s.cards +
                '" ' +
                (s.cards === result.request.cards ? "selected" : "") +
                ">" +
                num(s.cards) +
                " 卡</option>",
            )
            .join("") +
          '</select></label><p class="print-only" data-table-caption="' +
          tableId +
          '">当前对照规模：' +
          num(result.request.cards) +
          " 卡</p>"
        : "") +
      '<div class="table-wrap' +
      (t.eventSources ? " event-library-table" : "") +
      '"><table' +
      (t.scaleRows ? ' id="' + tableId + '"' : "") +
      "><thead><tr>" +
      t.heads.map((h) => '<th scope="col">' + escape(h) + "</th>").join("") +
      "</tr></thead><tbody>" +
      tableRows(t, t.rows) +
      "</tbody></table></div>" +
      (t.scaleRows
        ?.map(
          (s) =>
            '<template id="' +
            tableId +
            "-" +
            s.cards +
            '"><table><tbody>' +
            tableRows(t, s.rows) +
            "</tbody></table></template>",
        )
        .join("") ?? "") +
      (t.eventSources
        ? '<div class="event-sources"><details class="source-register"><summary>数据来源与归因说明 · ' +
          t.eventSources.length +
          ' 条<small>按需展开，或点击表中“查看来源”直接定位</small></summary><p class="chart-note">按事件展开阅读完整来源；证据等级表示本次输入的来源声明，不代表已验证的实测证据。</p>' +
          t.eventSources
            .map(
              (e, index) =>
                '<details class="event-source" id="event-source-' +
                index +
                '"><summary><strong>' +
                escape(e.id) +
                "</strong><span>" +
                escape(e.description) +
                '</span><span class="evidence-badge">' +
                escape(e.evidence) +
                "</span></summary><dl><dt>硬件/根因域</dt><dd>" +
                escape(e.domain) +
                "</dd><dt>来源</dt><dd>" +
                escape(e.source) +
                "</dd><dt>本次校准说明</dt><dd>" +
                escape(e.note || "未补充") +
                "</dd>" +
                referenceSourceFields(e)
                  .map(
                    ([label, text]) =>
                      "<dt>" +
                      escape(label) +
                      "</dt><dd>" +
                      escape(text) +
                      "</dd>",
                  )
                  .join("") +
                "</dl></details>",
            )
            .join("") +
          "</details></div>"
        : "")
    );
  };
  const sectionHtml = sections
    .map(
      (s, i) =>
        '<section id="section-' +
        i +
        '"' +
        (s.title === "验证与诊断摘要" ? ' class="validation-summary"' : "") +
        (s.contributionCards === undefined
          ? ""
          : ' data-contribution-scale="' +
            s.contributionCards +
            '"' +
            (s.contributionCards === result.request.cards ? "" : " hidden")) +
        ">" +
        (s.collapsed
          ? "<details><summary>" + escape(s.title) + "</summary>"
          : "<h2>" + escape(s.title) + "</h2>") +
        (s.paragraphs ?? []).map((p) => "<p>" + escape(p) + "</p>").join("") +
        (s.visual === "plan-set"
          ? planScaleChart(result)
          : s.visual === "decision-study"
            ? decisionStudyCharts(result)
            : s.visual === "architecture"
              ? architectureReport(result)
              : s.visual === "experiment-comparison"
                ? experimentChart(result)
                : s.visual === "optimization"
                  ? auditOptimizationChart(result)
                  : s.visual === "optimized-objects"
                    ? auditOptimizedObjectDiagram(result)
                    : s.visual === "objects"
                      ? '<div class="table-wrap" tabindex="0" aria-label="可靠性框图，可横向滚动"><div style="min-width:780px">' +
                        auditObjectDiagram(
                          result.events,
                          result.rows.find(
                            (r: any) =>
                              r.cards === result.request.cards &&
                              r.id === "base",
                          ),
                          result.rows.find(
                            (r: any) =>
                              r.cards === result.request.cards &&
                              r.id === "combined",
                          ),
                        ) +
                        "</div></div>"
                      : s.visual === "overview"
                        ? auditScaleCurve(result) + auditGainCharts(result)
                        : s.visual === "sensitivity"
                          ? auditSensitivityCurves(result)
                          : s.visual === "method"
                            ? auditMethodVisual(result)
                            : s.visual === "contribution"
                              ? auditContributionChart(
                                  result,
                                  s.contributionCards,
                                )
                              : s.visual === "contribution-controls"
                                ? auditContributionScaleControl(result)
                                : "") +
        (s.tables ?? []).map(htmlTable).join("") +
        (s.collapsed ? "</details>" : "") +
        "</section>",
    )
    .join("");
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(title) +
    "</title><style>body{max-width:1320px;margin:32px auto;padding:0 24px;font:15px/1.8 system-ui,sans-serif;color:#182d35;background:#f5f6f2}header{background:#163c37;color:white;padding:36px;border-radius:16px}header p{color:#c7dbd4}h1{font-size:32px;line-height:1.4}h2{margin:0 0 20px;color:#176451}section p{overflow-wrap:anywhere}section{background:white;border:1px solid #dce3df;border-radius:12px;margin:24px 0;padding:24px;scroll-margin-top:20px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}nav a{color:#176451;padding:6px 12px;background:#e7eee8;border-radius:8px;text-decoration:none}small{color:#526b63}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}th,td{padding:10px 12px;border-bottom:1px solid #dce3df;text-align:left;vertical-align:top}th{background:#eef3ef}tr:nth-child(even){background:#fafbf8}pre{white-space:pre-wrap;word-break:break-word;background:#eef3ef;padding:20px}summary{cursor:pointer;font-weight:650;padding:12px 0}.chart-row{display:flex;gap:12px;align-items:center;margin:12px 0}.chart-row span{width:210px}.track{flex:1;background:#edf1ea;height:14px;border-radius:8px;overflow:hidden}.bar{height:100%;background:#b78756}.combined{background:#258a75}.chart-row strong{width:90px}@media(max-width:640px){body{padding:0 10px}header,section{padding:18px}.chart-row span{width:115px;font-size:12px}}@media print{body{margin:0;background:white}nav{display:none}header{background:white;color:#182d35;border-bottom:3px solid #137968}section{border:0;padding:10px 0}.table-wrap{overflow:visible}details>*{display:block!important}section,table{break-inside:auto}tr{break-inside:avoid}}" +
    reportEnhancementCss +
    architectureCss +
    optimizationCss +
    auditChartCss +
    ".validation-summary p{overflow-wrap:anywhere}</style></head><body><header><p>ReMAP / RELIABILITY MODELING AND ANALYSIS PLATFORM</p><h1>" +
    escape(title) +
    "</h1><p>" +
    escape(metadata) +
    '</p></header><nav aria-label="报告目录">' +
    sections
      .map((s, i) =>
        s.collapsed || s.contributionCards !== undefined
          ? ""
          : '<a href="#section-' + i + '">' + escape(s.title) + "</a>",
      )
      .join("") +
    "</nav>" +
    '<div class="report-actions"><button id="report-print" type="button">打印 / 保存 PDF</button><button id="report-expand" type="button" aria-expanded="false">展开机制明细</button></div>' +
    (isAudit ? auditOptimizationBrief(result) + auditVisuals(result) : "") +
    sectionHtml +
    '<section aria-label="技术附件"><h2>技术附件</h2><a download="' +
    escape(attachment.filename) +
    '" href="' +
    escape(href) +
    '">' +
    escape(attachment.label) +
    "</a>" +
    (onlineHref
      ? ' · <a href="' + escape(onlineHref) + '" download>在线下载 JSON</a>'
      : "") +
    "<p>文件名：" +
    escape(attachment.filename) +
    "。</p><p>" +
    escape(attachmentNote) +
    "</p></section>" +
    reportInteractionScript +
    "</body></html>"
  );
}

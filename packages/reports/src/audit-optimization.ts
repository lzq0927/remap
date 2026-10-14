import {
  auditObjectDiagram,
  auditObjectComparison,
} from "./audit-object-diagram";
import type { AuditSection } from "./audit";
import { lineChart } from "./audit-charts";
import { parameterLabels } from "./audit-labels";
import { auditExtensionCatalog } from "../../contracts/src/audit-extensions";
const num = (n: number, digits = 4) =>
  Number.isFinite(n)
    ? n.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const pct = (n: number) => num(n * 100) + "%";
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const optimizationStatus: Record<string, string> = {
  supported: "假设下采样支持",
  below: "仍低于目标",
  uncertain: "区间跨目标，待复核",
};

export function optimizationParameterRows(r: any) {
  return (r.optimization?.factors ?? []).flatMap((f: any) => {
    if (f.kind === "fit")
      return f.value.map((e: any) => [
        f.name,
        e.id + " FIT",
        num(f.before.find((b: any) => b.id === e.id)?.fit),
        num(e.fit),
        "工程目标，非实测",
      ]);
    const values = f.kind === "extension" ? f.value.parameters : f.value;
    const definition = auditExtensionCatalog.find((m) => m.id === f.id);
    return Object.entries(values).map(([key, value]) => [
      f.name,
      definition?.parameters[key]?.label ?? parameterLabels[key] ?? key,
      f.kind === "extension" ? "现状未部署" : num(f.before[key]),
      num(Number(value)),
      f.kind === "extension" ? f.value.evidence : "工程目标，待确认",
    ]);
  });
}
function firstRankingRows(r: any, cards: number) {
  return [
    ...(r.attribution.find((a: any) => a.cards === cards)?.contributions ?? []),
  ]
    .sort((a: any, b: any) => b.statistics.mean - a.statistics.mean)
    .map((m: any, i: number) => [
      i + 1,
      m.name,
      num(m.statistics.mean * 100),
      num(m.statistics.ciLow * 100) + " ～ " + num(m.statistics.ciHigh * 100),
    ]);
}
function improvedRankingRows(o: any, cards: number) {
  return (
    o.attribution.find((a: any) => a.cards === cards)?.contributions ?? []
  ).map((m: any) => [
    m.rank,
    m.name,
    num(m.statistics.mean * 100),
    num(m.statistics.ciLow * 100) + " ～ " + num(m.statistics.ciHigh * 100),
  ]);
}
export function optimizationFitRequirement(r: any) {
  const f = r.optimization?.factors?.find((item: any) => item.kind === "fit");
  if (!f) return "";
  const before = r.events.reduce((sum: number, e: any) => sum + e.fit, 0);
  const after = r.events.reduce(
    (sum: number, e: any) =>
      sum + (f.value.find((v: any) => v.id === e.id)?.fit ?? e.fit),
    0,
  );
  return `关键实施条件：总源 FIT 需由 ${num(before)} 降至 ${num(after)}（降低 ${num((1 - after / before) * 100, 2)}%）。这部分是硬件设计要求，不能归功于检测恢复参数，也不表示产品已具备该能力。`;
}
export function auditOptimizationSections(r: any): AuditSection[] {
  const o = r.optimization;
  if (!o) return [];
  const sections: AuditSection[] = [
    {
      title: "00 / 两轮评估与设计决策",
      paragraphs: [
        o.strategy,
        o.firstRound,
        o.reason,
        "初始目标由 50 万卡 98.5% 与参考 MTBF 0.6h 推导共同恢复预算，再用其他规模的参考 MTBF 得出需求目标；此推导不修改仿真的恢复时间。历史或自定义目标以本次冻结输入为准。",
        "第一轮评估现有措施，不先分配固定指标。第二轮先根据各规模贡献和缺口提出工程重要度与预算，再修改参数、提出硬件目标或新增措施，最终用同一故障模型复评。",
      ],
    },
  ];
  if (o.status !== "evaluated") return sections;
  sections[0].visual = "optimization";
  sections[0].paragraphs!.push(
    `优先规模 ${num(o.primaryCards, 0)} 卡：${optimizationStatus[o.primaryStatus]}；${o.allScalesSupported ? "所有需求规模均获本次采样支持" : "仍有规模未取得充分达标证据，见逐规模缺口"}。推荐：${o.chosenName}。共比较 ${o.candidates.length} 个有限候选，不代表全局最优或现场已实现。`,
  );
  sections[0].tables = [
    {
      heads: [
        "规模 / 卡",
        "可用度目标",
        "现状独立复核",
        "第二轮优化预期",
        "优化 95% 均值区间",
        "距目标 / pp",
        "结论",
      ],
      rows: o.scales.map((s: any) => [
        num(s.cards, 0),
        pct(s.target),
        pct(s.current.statistics.mean),
        pct(s.optimized.statistics.mean),
        pct(s.optimized.statistics.ciLow) +
          " ～ " +
          pct(s.optimized.statistics.ciHigh),
        num(s.gap * 100),
        optimizationStatus[s.status],
      ]),
    },
  ];
  sections.push({
    title: "两轮 / 各规模措施贡献排名",
    paragraphs: [
      "现状排名分摊第一轮所选措施相对确认基线的收益；优化排名分摊第二轮参数、FIT目标和新增措施相对第一轮现状的增量。两者基准不同，不直接相加排名。",
      "第二轮采用固定随机排列的 Shapley 近似；每条轨迹满足贡献和等于组合增量，保留负贡献。置信区间反映轨迹抽样，排列数有限也有近似误差。",
      "负贡献不能直接解释为应删除该措施，删减后须重新验证。检查点周期延长可能在原故障率下增加回滚，但与降低 FIT 组合后能减少保存开销；这种组合依赖正是贡献分摊需要解释的取舍。",
    ],
    tables: [
      {
        heads: ["现状排名", "措施", "Shapley / pp", "95% 区间 / pp"],
        rows: firstRankingRows(r, o.primaryCards),
        scaleRows: o.scales.map((s: any) => ({
          cards: s.cards,
          rows: firstRankingRows(r, s.cards),
        })),
        scaleLabel: "现状贡献规模",
      },
      {
        heads: ["优化增量排名", "改进措施", "Shapley / pp", "95% 区间 / pp"],
        rows: improvedRankingRows(o, o.primaryCards),
        scaleRows: o.scales.map((s: any) => ({
          cards: s.cards,
          rows: improvedRankingRows(o, s.cards),
        })),
        scaleLabel: "优化贡献规模",
      },
    ],
  });
  const objectImprovementRows = (scale: any) =>
    auditObjectComparison(
      r.events,
      scale.current,
      scale.optimized,
      r.events,
      o.optimizedEvents,
    ).map((item) => [
      item.name,
      num(item.leftFit),
      num(item.rightFit),
      num(item.leftLoss!),
      num(item.rightLoss!),
    ]);
  const primaryScale = o.scales.find(
    (scale: any) => scale.cards === o.primaryCards,
  );
  sections.push({
    title: "两轮 / 故障对象与改善结果",
    collapsed: true,
    visual: "optimized-objects",
    paragraphs: [
      "箭头前为第一轮现状，箭头后为最终第二轮方案。损失来自独立复核的逐事件时间账；残余 FIT 包括显式硬件目标与适用筛查效果。保存及正常态开销单独计账，不重复分配给对象。",
      "框图展示主规模的影响关系，不假设对象之间为物理串联系统；其他规模逐对象结果见表格。",
    ],
    tables: [
      {
        heads: [
          "对象",
          "现状 FIT",
          "优化残余 FIT",
          "现状损失 / h",
          "优化损失 / h",
        ],
        rows: objectImprovementRows(primaryScale),
        scaleRows: o.scales.map((scale: any) => ({
          cards: scale.cards,
          rows: objectImprovementRows(scale),
        })),
        scaleLabel: "优化对象结果规模",
      },
    ],
  });
  const selected =
    o.allocations.find((a: any) => a.cards === o.primaryCards) ??
    o.allocations[0];
  const objectRows = (a: any) =>
    a.items.map((i: any) => [
      i.name,
      num(i.complexity),
      num(i.importance),
      num(i.currentFit),
      num(i.targetFit),
      num(i.allowedHours),
      num(i.actualHours),
    ]);
  const priorityRows = (a: any) =>
    a.priorities.map((p: any) => [
      p.name,
      num(p.contribution * 100),
      num(p.suggestedImportance),
      num(p.importance),
      num(p.improvementPriorityHours),
      p.effect,
    ]);
  const mechanismBudgetRows = (a: any) =>
    (a.mechanismPlan?.items ?? []).map((i: any) => [
      i.name,
      num(i.importance),
      num(i.actualHours),
      num(i.allowedHours),
      num(Math.max(0, i.excessHours)),
    ]);
  sections.push({
    title: "两轮 / AGREE 目标进一步分配",
    collapsed: true,
    paragraphs: [
      selected.formula,
      selected.interpretation,
      selected.source,
      "先从总允许损失中扣除候选检查点保存和正常态机制开销，再分配对象事件预算。对象重要度取适用措施重要度平均；复杂度默认取非零FIT故障类型数。硬件目标采用各规模最严格值，并通过有限收紧候选复评。",
      "FIT 换算使用筛选均值区间下限对应的损失加量作为规划余量；这是减少低采样乐观估计的设计约束，不是未观测事件的保证上界，也不替代独立复评。",
      "下表是初始 AGREE 预算，最终采用的 FIT 目标见参数变化表。改善优先量只是缺口的工程排序，不是承诺各项可独立贡献该收益。",
    ],
    tables: [
      {
        heads: [
          "规模 / 卡",
          "总允许损失 / h",
          "保存与开销 / h",
          "事件分配预算 / h",
          "筛选规划余量 / h",
          "固定项超预算 / h",
          "预算守恒残差",
        ],
        rows: o.allocations.map((a: any) => [
          num(a.cards, 0),
          num(a.totalAllowedHours),
          num(a.fixedHours),
          num(a.allowedHours),
          num(a.samplingMarginHours),
          num(a.fixedExcessHours),
          num(a.residual, 12),
        ]),
      },
      {
        heads: [
          "措施",
          "现状贡献 / pp",
          "建议重要度",
          "采用重要度",
          "改善优先量 / h",
          "作用",
        ],
        rows: priorityRows(selected),
        scaleRows: o.allocations.map((a: any) => ({
          cards: a.cards,
          rows: priorityRows(a),
        })),
        scaleLabel: "重要度规模",
      },
      {
        heads: [
          "机制设计责任（不与对象预算相加）",
          "重要度",
          "现状责任损失 / h",
          "AGREE 允许损失 / h",
          "责任改进要求 / h",
        ],
        rows: mechanismBudgetRows(selected),
        scaleRows: o.allocations.map((a: any) => ({
          cards: a.cards,
          rows: mechanismBudgetRows(a),
        })),
        scaleLabel: "机制责任预算规模",
      },
      {
        heads: [
          "对象",
          "复杂度",
          "重要度",
          "当前 FIT",
          "初始目标 FIT",
          "允许损失 / h",
          "候选观测损失 / h",
        ],
        rows: objectRows(selected),
        scaleRows: o.allocations.map((a: any) => ({
          cards: a.cards,
          rows: objectRows(a),
        })),
        scaleLabel: "AGREE 分配规模",
      },
    ],
  });
  sections.push({
    title: "两轮 / 推荐参数与实施要求",
    paragraphs: [
      optimizationFitRequirement(r),
      "以下是可复算的第二轮输入。需要与产品专家逐项确认实现路径、覆盖范围、成本、性能开销与故障注入验收；仿真通过不证明这些要求已经实现。",
    ],
    tables: [
      {
        heads: ["改进措施", "参数", "现状", "建议目标", "证据口径"],
        rows: optimizationParameterRows(r),
      },
    ],
  });
  sections.push({
    title: "两轮 / 候选比较与独立验证",
    collapsed: true,
    paragraphs: [
      `候选筛选 ${o.seeds.screening.length} 条轨迹/规模；独立复评 ${o.seeds.verification.length} 条/规模；增量归因每子集 ${o.seeds.attribution.length} 条，${o.attribution[0]?.permutations ?? 0} 个排列。三批种子互不重叠，且与第一轮种子分离。`,
      ...o.assumptions,
    ],
    tables: [
      {
        heads: ["候选", "主规模筛选可用度", "无故障保存/开销参考", "选择"],
        rows: o.candidates.map((c: any) => [
          c.name,
          pct(
            c.rows.find((s: any) => s.cards === o.primaryCards).statistics.mean,
          ),
          pct(c.noFaultReference),
          c.id === o.chosenId ? "采用并独立复核" : "对照",
        ]),
      },
    ],
  });
  const extensions = o.factors.filter((f: any) => f.kind === "extension");
  if (extensions.length)
    sections.push({
      title: "两轮 / 新机制来源与适用条件",
      collapsed: true,
      paragraphs: extensions.flatMap((f: any) => {
        const m = auditExtensionCatalog.find((entry) => entry.id === f.id)!;
        return [
          `${m.name}（${m.id}）：${m.effect}。${f.source}`,
          `前提：${m.prerequisite} 失败回退：${m.failure}`,
          `重叠约束：${m.overlap} 验收：${m.acceptance}`,
          ...m.sources.map((s) => `${s.title}：${s.url}`),
        ];
      }),
    });
  return sections;
}

export function auditOptimizedObjectDiagram(r: any) {
  const o = r.optimization,
    scale = o?.scales?.find((s: any) => s.cards === o.primaryCards);
  if (!scale) return "";
  return (
    '<div class="table-wrap" tabindex="0" aria-label="第二轮可靠性框图，可横向滚动"><div style="min-width:780px">' +
    auditObjectDiagram(
      r.events,
      scale.current,
      scale.optimized,
      r.events,
      o.optimizedEvents,
    ) +
    "</div></div>"
  );
}

export function auditOptimizationChart(r: any) {
  const o = r.optimization;
  if (o?.status !== "evaluated") return "";
  return lineChart({
    title: "不同规模：现状、优化预期与目标",
    xLabel: "作业规模 / 卡",
    formatX: (n) => num(n / 10000, 0) + "万",
    logarithmic: true,
    series: [
      {
        name: "第一轮现状（独立复核）",
        color: "#b77935",
        points: o.scales.map((s: any) => ({
          x: s.cards,
          statistics: s.current.statistics,
        })),
      },
      {
        name: "第二轮优化预期（独立复核）",
        color: "#12816d",
        points: o.scales.map((s: any) => ({
          x: s.cards,
          statistics: s.optimized.statistics,
        })),
      },
      {
        name: "初始可用度目标",
        color: "#6370b7",
        dashed: true,
        points: o.scales.map((s: any) => ({
          x: s.cards,
          statistics: { mean: s.target, ciLow: s.target, ciHigh: s.target },
        })),
      },
    ],
    note: "现状与优化使用相同的独立复核种子；曲线连接离散规模，不证明中间规模。优化结果依赖所列工程目标，不能作为已部署可用度。",
  });
}

export function auditOptimizationBrief(r: any) {
  const o = r.optimization;
  if (!o) return "";
  if (o.status !== "evaluated")
    return `<section class="optimization-brief"><h2>两轮评估</h2><p>${esc(o.reason)}</p></section>`;
  const primary = o.scales.find((s: any) => s.cards === o.primaryCards);
  return `<section class="optimization-brief" aria-label="两轮决策摘要"><span class="kicker">目标 → 现状 → 分配 → 改进 → 复评</span><h2>${num(o.primaryCards / 10000, 0)}万卡为主的可靠性决策</h2><p>${esc(o.reason)} ${o.allScalesSupported ? "所有需求规模在本次工程假设下获得采样支持。" : "仍有规模未取得充分达标证据，需继续迭代。"}</p><div class="round-summary-cards"><div><span>主规模目标</span><b>${pct(primary.target)}</b></div><div><span>第一轮现状 · 独立复核</span><b>${pct(primary.current.statistics.mean)}</b></div><div><span>第二轮优化预期</span><b>${pct(primary.optimized.statistics.mean)}</b></div><div><span>独立复评结论</span><b class="verdict-text">${esc(optimizationStatus[primary.status])}</b></div></div><p class="evidence-note">${esc(optimizationFitRequirement(r))}</p><p class="evidence-note">推荐 ${esc(o.chosenName)}。参数和 FIT 是待确认的工程目标；先与产品专家确认，再以实测数据复评。各规模结论、分配及贡献排名见下方。</p></section>`;
}
export const optimizationCss = `
.optimization-brief{padding:22px;background:#f0f7f4;border:1px solid #cddfd8;border-radius:12px;margin:20px 0}.optimization-brief h2{margin:8px 0 12px}.round-summary-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.round-summary-cards>div{background:white;border:1px solid #dce6e1;border-radius:8px;padding:14px;min-width:0}.round-summary-cards span{font-size:12px;color:#526c61}.round-summary-cards b{display:block;color:#156b56;font-size:25px;margin-top:8px}.round-summary-cards .verdict-text{font-size:17px;line-height:1.5}.optimization-report-details{margin:18px 0;padding:16px;border:1px solid #dbe5e0;border-radius:8px}.optimization-report-details>summary{font-weight:600}.optimization-report-details p{line-height:1.7}.optimization-report-details table{width:100%;font-size:13px;border-collapse:collapse}.optimization-report-details td,.optimization-report-details th{padding:10px;text-align:left;border-bottom:1px solid #e1e7e3;white-space:normal;min-width:100px;overflow-wrap:anywhere}.optimization-report-details td:first-child{min-width:150px}.optimization-report-details .table-wrap{overflow:auto;max-width:100%}
@media(max-width:700px){.optimization-brief{padding:16px}.round-summary-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.round-summary-cards b{font-size:20px}.round-summary-cards .verdict-text{font-size:14px}.optimization-report-details{padding:12px}}
@media print{.round-summary-cards{grid-template-columns:repeat(4,minmax(0,1fr))}.optimization-brief{break-inside:avoid}}
`;

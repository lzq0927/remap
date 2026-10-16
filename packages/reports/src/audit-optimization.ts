import {
  auditObjectDiagram,
  auditObjectComparison,
} from "./audit-object-diagram";
import type { AuditSection } from "./audit";
import { lineChart } from "./audit-charts";
import { parameterLabels } from "./audit-labels";
import { auditExtensionCatalog } from "../../contracts/src/audit-extensions";
import { auditSummaryRows } from "../../contracts/src/audit-presets";
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

function parameterEntries(r: any) {
  const entries: Array<{ cells: any[]; source: string }> = [];
  for (const f of r.optimization?.factors ?? []) {
    if (f.kind === "fit") {
      for (const e of f.value)
        entries.push({
          cells: [
            f.name,
            e.id + " FIT",
            num(f.before.find((b: any) => b.id === e.id)?.fit),
            num(e.fit),
          ],
          source: e.source + "；" + (e.note ?? "工程目标，非实测"),
        });
      continue;
    }
    const values = f.kind === "extension" ? f.value.parameters : f.value;
    const definition = auditExtensionCatalog.find((m) => m.id === f.id);
    for (const [key, value] of Object.entries(values))
      entries.push({
        cells: [
          f.name,
          f.kind === "checkpoint-schedule"
            ? num(Number(key), 0) + "卡周期 / 秒"
            : (definition?.parameters[key]?.label ??
              parameterLabels[key] ??
              key),
          f.kind === "extension" ? "现状未部署" : num(f.before?.[key]),
          num(Number(value)),
        ],
        source: f.parameterSources?.[key] ?? f.source ?? "工程目标，待确认",
      });
  }
  return entries;
}
export function optimizationParameterRows(r: any) {
  return parameterEntries(r).map((e, i) => [
    ...e.cells,
    `P${i + 1} · 工程目标，非实测`,
  ]);
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
  if (!f) {
    const screen = r.optimization?.factors?.find(
      (item: any) => item.id === "H-SDC-SCREEN",
    );
    if (!screen)
      return "源 FIT 保持不变；本方案仅通过检测、恢复、保存与回滚等机制参数改善可用度。";
    const a = screen.value.parameters;
    const before = r.events.reduce((sum: number, e: any) => sum + e.fit, 0);
    const after = (r.optimization.optimizedEvents ?? r.events).reduce(
      (sum: number, e: any) => sum + e.fit,
      0,
    );
    return `源 FIT 保持不变；仅 H-SDC-SCREEN 对适用 SDC 风险降低 ${pct(a.reduction)}，适用比例 ${pct(a.eligibleShare)} × 执行成功率 ${pct(a.success)}。总残余 FIT ${num(before)} → ${num(after)}，全库下降 ${num((1 - after / before) * 100, 4)}%。出处：专家单点量化交付包 H-SDC-SCREEN；25% 为目标情景，非已测得的全硬件降幅。`;
  }
  const before = r.events.reduce((sum: number, e: any) => sum + e.fit, 0);
  const after = r.events.reduce(
    (sum: number, e: any) =>
      sum + (f.value.find((v: any) => v.id === e.id)?.fit ?? e.fit),
    0,
  );
  return `关键实施条件：总源 FIT 需由 ${num(before)} 降至 ${num(after)}（降低 ${num((1 - after / before) * 100, 2)}%）。这部分是硬件设计要求，不能归功于检测恢复参数，也不表示产品已具备该能力。`;
}
export function auditOptimizationSections(r: any): AuditSection[] {
  if (!r.optimization) return [];
  const o = {
    ...r.optimization,
    scales: auditSummaryRows(r.request, r.optimization.scales ?? []),
  };
  const sections: AuditSection[] = [
    {
      title: "00 / 两轮评估与设计决策",
      paragraphs: [
        o.strategy,
        o.firstRound,
        o.reason,
        "初始目标由 50 万卡 98.5% 与参考 MTBF 0.6h 推导共同恢复预算，再用其他规模的参考 MTBF 得出需求目标；此推导不修改仿真的恢复时间。历史或自定义目标以本次冻结输入为准。",
        o.planningVersion === "agree-mechanism-design-v3"
          ? "第一轮评估现有措施，不先分配固定指标。第二轮以各规模贡献建议 AGREE 工程重要度，先冻结损失路径预算，再筛选专家机制、反解参数，并用同一故障模型独立复评。源 FIT 不因目标缺口自动降低。"
          : o.planningVersion === "mechanism-bounds-v2"
            ? "历史V2口径：AGREE辅助有限参数候选评分；尚未由预算反解参数。保留当时结果，重新计算采用分配先行方法。"
            : "历史第二轮口径：可能包含由预算换算并收紧的硬件 FIT 目标；按原结果保留数值与来源。当前版本已转为机制优先，重新计算后才适用新方法，历史达标结论仍依赖原有 FIT 要求。",
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
  if (o.design) {
    const requirements = (cards: number) =>
      (
        o.design.perScale.find((s: any) => s.cards === cards)?.requirements ??
        []
      ).filter(
        (r: any) =>
          !r.code.startsWith("ext:") ||
          o.factors.some((f: any) => f.id === r.code.slice(4)),
      );
    const requirementName = (p: any) => {
      const extension = auditExtensionCatalog.find((m) => m.id === p.mechanism);
      const name =
        extension?.name ??
        (
          {
            model: "基础检测/恢复",
            "D-SDC": "静默检测",
            "D-HARD": "中断检测",
            "D-SLOW": "亚健康检测",
            "R-REPLAY": "重执行",
            "R-PROCESS": "进程恢复",
            "R-ELASTIC": "弹性恢复",
            "R-SDC": "干净step恢复",
            "C-FAST": "检查点",
          } as Record<string, string>
        )[p.mechanism] ??
        p.mechanism;
      return (
        name +
        " / " +
        (p.code === "schedule"
          ? "周期（秒）"
          : (extension?.parameters[p.key]?.label ??
            parameterLabels[p.key] ??
            p.key))
      );
    };
    const demanding = o.design.envelope.filter((p: any) =>
      p.direction === "up"
        ? p.reference < 1 && 1 - p.adopted < (1 - p.reference) / 10
        : p.reference > 0 && p.adopted < p.reference / 10,
    );
    const requirementRows = (cards: number) =>
      requirements(cards).map((p: any, i: number) => [
        requirementName(p),
        num(p.reference, 7),
        num(p.allowedHours, 7),
        (p.direction === "up" ? "≥ " : "≤ ") + num(p.required, 7),
        num(
          p.code === "schedule"
            ? p.adopted
            : o.design.envelope.find((e: any) => e.id === p.id)?.adopted,
          7,
        ),
        `D${cards}-${i + 1}${p.locked ? " · 显式锁定" : ""}`,
      ]);
    sections.push({
      title: "两轮 / 分配依据 → 机制选择 → 参数要求",
      paragraphs: [
        "第一轮各规模Shapley正贡献转换为工程重要度 → AGREE冻结互斥损失路径预算 → 按预算缺口逐项比较专家库 → 按路径到达率与时间损失关系反解参数 → 独立复评 → 新的增量Shapley排名。",
        `本方案保留${pct(o.design.reserveFraction)}分配预算作为建模余量。它是显式规划假设，不是置信水平；独立复评的95%区间另行计算。`,
        "AGREE负责分配预算，物理关系负责反解参数，二者不能混同。到达率考虑事件范围、恢复先后与前序成功概率。时间损失采用保守期望近似；周期按均匀相位近似，必须正向验证。参考值可被预算要求收紧，完整恢复要求不冒充专家某个子阶段的成果。",
        ...(demanding.length
          ? [
              "需优先论证的较大改进要求：" +
                demanding
                  .map(
                    (p: any) =>
                      `${requirementName(p)} ${num(p.reference, 7)} → ${num(p.adopted, 7)}`,
                  )
                  .join("；") +
                "。这些是预算反解要求，当前没有产品可达证据；评估达标以这些能力与成本同时实现为条件。",
            ]
          : []),
        "下面分别列出每个规模的分配要求；共同参数取各规模最严格要求，检查点周期分别配置。只在显式输入锁定时保留用户值，超预算仍显示；不把预算不足换算成大幅降低FIT。",
      ],
      tables: [
        {
          heads: [
            "机制 / 参数",
            "参考初值",
            "对应子预算 / h",
            "该规模要求",
            "共同采用值 / 周期",
            "推导索引",
          ],
          rows: requirementRows(o.primaryCards),
          scaleRows: o.scales.map((s: any) => ({
            cards: s.cards,
            rows: requirementRows(s.cards),
          })),
          scaleLabel: "参数分配规模",
        },
      ],
    });
    sections.push({
      title: "两轮 / 专家机制采用依据",
      collapsed: true,
      paragraphs: [
        `机制库中的${auditExtensionCatalog.length}项方案按预算缺口与适用范围核对；单点参考、执行假设和新增成本分别保留。筛选用同批种子作组合比较，后续仍需独立复评。未采用不等于机制无价值；参数反解后还会检查是否冗余。`,
      ],
      tables: [
        {
          heads: ["专家机制", "结果", "分配与采用理由"],
          rows: (o.libraryDecisions ?? []).map((d: any) => [
            d.name + " · " + d.id,
            d.selected ? "采用" : "未自动采用",
            d.reason,
          ]),
        },
      ],
    });
    sections.push({
      title: "两轮 / 参数反解公式与验收条件",
      collapsed: true,
      paragraphs: o.scales.flatMap((s: any) =>
        requirements(s.cards).map(
          (p: any, i: number) =>
            `D${s.cards}-${i + 1} · ${s.cards}卡 / ${p.mechanism} / ${parameterLabels[p.key] ?? p.key}：子预算${num(p.allowedHours, 8)}h，到达率${num(p.exposurePerHour, 8)}/h。${p.formula}。${p.source}。${p.locked ? "显式输入锁定，需检查预算缺口。" : "分配推导的工程要求，需用产品实测与故障注入验收。"}`,
        ),
      ),
    });
  }
  sections.push({
    title: "两轮 / 各规模措施贡献排名",
    paragraphs: [
      "现状排名分摊第一轮所选措施相对确认基线的收益；优化排名分摊第二轮参数、FIT目标和新增措施相对第一轮现状的增量。两者基准不同，不直接相加排名。",
      "第二轮采用固定随机排列的 Shapley 近似；每条轨迹满足贡献和等于组合增量，保留负贡献。置信区间反映轨迹抽样，排列数有限也有近似误差。",
      "负贡献不能直接解释为应删除该措施，删减后须重新验证。检查点周期延长会减少保存开销但增加回滚；新增检测也有正常态成本。这些组合依赖由贡献分摊解释，预算不是单项独立收益承诺。",
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
      num(
        ["mechanism-bounds-v2", "agree-mechanism-design-v3"].includes(
          o.planningVersion,
        )
          ? i.allowedEquivalentSeconds
          : i.targetFit,
      ),
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
      "新分配口径先冻结保存与正常态开销的AGREE预算，将剩余额度分配到对象；对象表为交叉核对，不反向要求降低FIT。对象重要度取适用措施重要度平均，复杂度取非零FIT故障类型数。当前口径保持源 FIT，以预算 / 期望事件次数折算每次事件允许的全系统等效损失。",
      "等效损失包括停机、回滚、污染、降速与局部容量损失，不等同于设备维修 MTTR。区间余量提示抽样不确定性，不生成 FIT 收紧系数。历史结果保留当时口径。",
      "机制设计责任账、物理损失路径账和对象账是不同分配视角，不能彼此相加。预算用于定位需要改进的路径，实际达标仍以独立正向复评为准。",
    ],
    tables: [
      {
        heads: [
          "规模 / 卡",
          "总允许损失 / h",
          o.design ? "保存与开销预算 / h" : "保存与开销 / h",
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
          ["mechanism-bounds-v2", "agree-mechanism-design-v3"].includes(
            o.planningVersion,
          )
            ? "每事件允许等效损失 / 秒"
            : "初始目标 FIT",
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
  if (o.scales.some((s: any) => s.diagnostics)) {
    const pathRows = (scale: any) =>
      (scale.diagnostics?.paths ?? []).map((p: any) => [
        p.name,
        num(p.allowedHours),
        num(p.actualHours),
        num(Math.max(0, p.excessHours)),
        p.action,
      ]);
    sections.push({
      title: "两轮 / 机制指标分解与剩余缺口",
      paragraphs: [
        "AGREE 将总允许损失分到互不重叠的物理时间账，重要度参考第一轮 Shapley；各项预算之和等于总预算。路径超预算是讨论优先级，不代表总目标一定未达标，最终仍按总账判断。",
        "保存约束 s/(τ+s)≤B保存/T；在当前周期 τ 下反解阻塞上限。停机预算除以复评中恢复次数得到每次允许的等效停机秒数。它们用于检查分配要求与复评实绩，不保证物理参数可以唯一反解或产品已经实现。",
        "若0.5秒保存仍超预算，需要更低阻塞、更少全局回滚或更低机制开销等额外能力，并与产品专家论证。缩短即时发现时延不能消除未检出SDC的长期污染。",
      ],
      tables: [
        {
          heads: [
            "规模 / 卡",
            "复评总超额损失 / h",
            "采用周期 / 秒",
            "保存阻塞 / 秒",
            "按保存预算反解上限 / 秒",
            "每次恢复允许停机 / 秒",
          ],
          rows: o.scales.map((s: any) => [
            num(s.cards, 0),
            num(s.diagnostics.totalExcessHours),
            num(s.diagnostics.checkpoint.periodSeconds),
            num(s.diagnostics.checkpoint.saveSeconds),
            num(s.diagnostics.checkpoint.allocatedSaveSeconds, 6),
            num(s.diagnostics.downtimeSecondsPerObservedRecovery),
          ]),
        },
        {
          heads: [
            "损失路径",
            "AGREE预算 / h",
            "独立复评损失 / h",
            "超预算 / h",
            "进一步改进方向",
          ],
          rows: pathRows(primaryScale),
          scaleRows: o.scales.map((s: any) => ({
            cards: s.cards,
            rows: pathRows(s),
          })),
          scaleLabel: "机制损失预算规模",
        },
      ],
    });
  }
  sections.push({
    title: "两轮 / 推荐参数与实施要求",
    paragraphs: [
      optimizationFitRequirement(r),
      "以下是可复算的第二轮输入。需要与产品专家逐项确认实现路径、覆盖范围、成本、性能开销与故障注入验收；仿真通过不证明这些要求已经实现。",
    ],
    tables: [
      {
        heads: ["改进措施", "参数", "现状", "采用目标", "来源索引"],
        rows: optimizationParameterRows(r),
      },
    ],
  });
  sections.push({
    title: "两轮 / 参数依据与参考初值",
    collapsed: true,
    paragraphs: [
      "参数表以 P 编号对应以下完整来源，长说明单独排版。用户目标、专家单点目标与平台探索假设分别保留；没有来源的硬件降率不进入自动候选。",
      ...parameterEntries(r).map(
        (e, i) => `P${i + 1} · ${e.cells[0]} / ${e.cells[1]}：${e.source}`,
      ),
      ...(o.parameterBounds ?? []).map(
        (p: any) => `参考初值 · ${p.label} = ${num(p.target, 6)}：${p.source}`,
      ),
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
  return `<section class="optimization-brief" aria-label="两轮决策摘要"><span class="kicker">目标 → 现状 → 分配 → 改进 → 复评</span><h2>${num(o.primaryCards / 10000, 0)}万卡为主的可靠性决策</h2><p>${esc(o.reason)} ${o.allScalesSupported ? "所有需求规模在本次工程假设下获得采样支持。" : "仍有规模未取得充分达标证据，需继续迭代。"}</p><div class="round-summary-cards"><div><span>主规模目标</span><b>${pct(primary.target)}</b></div><div><span>第一轮现状 · 独立复核</span><b>${pct(primary.current.statistics.mean)}</b></div><div><span>第二轮优化预期</span><b>${pct(primary.optimized.statistics.mean)}</b></div><div><span>独立复评结论</span><b class="verdict-text">${esc(optimizationStatus[primary.status])}</b></div></div><p class="evidence-note">${esc(optimizationFitRequirement(r))}</p><p class="evidence-note">推荐 ${esc(o.chosenName)}。${["mechanism-bounds-v2", "agree-mechanism-design-v3"].includes(o.planningVersion) ? "参数是待确认的工程目标；源 FIT 不自动降低，专家筛查效果单独注明。" : "历史结果按当时的参数及 FIT 要求成立，未自动套用当前机制优先方法。"}先与产品专家确认，再以实测数据复评。各规模结论、分配及贡献排名见下方。</p></section>`;
}
export const optimizationCss = `
.optimization-brief{padding:22px;background:#f0f7f4;border:1px solid #cddfd8;border-radius:12px;margin:20px 0}.optimization-brief h2{margin:8px 0 12px}.round-summary-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.round-summary-cards>div{background:white;border:1px solid #dce6e1;border-radius:8px;padding:14px;min-width:0}.round-summary-cards span{font-size:12px;color:#526c61}.round-summary-cards b{display:block;color:#156b56;font-size:25px;margin-top:8px}.round-summary-cards .verdict-text{font-size:17px;line-height:1.5}.optimization-report-details{margin:18px 0;padding:16px;border:1px solid #dbe5e0;border-radius:8px}.optimization-report-details>summary{font-weight:600}.optimization-report-details p{line-height:1.7}.optimization-report-details table{width:100%;font-size:13px;border-collapse:collapse}.optimization-report-details td,.optimization-report-details th{padding:10px;text-align:left;border-bottom:1px solid #e1e7e3;white-space:normal;min-width:100px;overflow-wrap:anywhere}.optimization-report-details td:first-child{min-width:150px}.optimization-report-details .table-wrap{overflow:auto;max-width:100%}
@media(max-width:700px){.optimization-brief{padding:16px}.round-summary-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.round-summary-cards b{font-size:20px}.round-summary-cards .verdict-text{font-size:14px}.optimization-report-details{padding:12px}}
@media print{.round-summary-cards{grid-template-columns:repeat(4,minmax(0,1fr))}.optimization-brief{break-inside:avoid}}
`;

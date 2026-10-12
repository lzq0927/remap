import { auditSummary } from "./audit-summary";
import { parameterLabels, sensitivityLabels } from "./audit-labels";
import {
  auditSelectedMechanisms,
  auditSamplingDescription,
} from "./audit-context";
const num = (v: any, digits = 3) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const pct = (v: number) => num(v * 100) + "%";
const pp = (v: number) => num(v * 100) + " pp";
const ci = (s: any) => pct(s.ciLow) + " ～ " + pct(s.ciHigh);
const types: Record<string, string> = {
  hard: "中断",
  slow: "亚健康",
  sdc: "静默",
};
const codes: Record<string, string> = {
  "D-HARD": "hardDetect",
  "D-SLOW": "slowDetect",
  "D-SDC": "sdcDetect",
  "R-SDC": "step",
  "R-REPLAY": "replay",
  "R-PROCESS": "process",
  "R-ELASTIC": "elastic",
  "C-FAST": "fast",
};
const loss = (row: any) =>
  ["downtime", "rollback", "slowdown", "terminalInvalid", "localLoss"].reduce(
    (s, k) => s + (row?.[k] ?? 0),
    0,
  );
export type EventSource = {
  id: string;
  domain: string;
  description: string;
  source: string;
  evidence: string;
  note: string;
  referenceEvidence?: string;
  referenceReviewNote?: string;
  legacyEvidence?: string;
  fitEvidence?: string;
};
export type AuditTable = {
  heads: string[];
  rows: unknown[][];
  eventSources?: EventSource[];
  scaleRows?: { cards: number; rows: unknown[][] }[];
  scaleLabel?: string;
};
export interface AuditSection {
  title: string;
  paragraphs?: string[];
  tables?: AuditTable[];
  collapsed?: boolean;
  visual?: "overview" | "sensitivity" | "method";
}
export function auditSections(r: any): AuditSection[] {
  const selected = r.request.cards,
    hours = r.request.hours;
  const selectedRows = r.rows.filter((row: any) => row.cards === selected),
    p = r.config.model;
  const scales = [...new Set<number>(r.rows.map((row: any) => row.cards))].sort(
    (a, b) => a - b,
  );
  const hardFit = r.events
    .filter((e: any) => e.type === "hard")
    .reduce((n: number, e: any) => n + e.fit, 0);
  const eventRows = (cards: number) => {
    const row = r.rows.find((x: any) => x.cards === cards && x.id === "base");
    const denominator = Object.values(row.perEvent).reduce(
      (s: number, v: any) => s + loss(v),
      0,
    );
    return r.events.map((e: any) => {
      const x = row.perEvent[e.id] ?? {};
      return [
        e.id,
        e.domain + " · " + e.description,
        types[e.type],
        num(e.fit, 6),
        num(e.fit > 0 ? 1e9 / (cards * e.fit) : null),
        pct(e.share),
        pct(e.withinTypeShare),
        num(x.events ?? 0),
        x.events ? num((x.downtime / x.events) * 60) : "未观察到",
        num(x.downtime ?? 0),
        num(loss(x) - (x.downtime ?? 0)),
        denominator ? pct(loss(x) / denominator) : "—",
        {
          "internal-measured": "内部观测",
          "external-prior": "外网先验",
          scenario: "方案假设",
        }[e.evidence as string] ?? e.evidence,
      ];
    });
  };
  const impactRows = (cards: number, scenario: string, eventIds: string[]) => {
    const a = r.rows.find((x: any) => x.cards === cards && x.id === "base"),
      b = r.rows.find((x: any) => x.cards === cards && x.id === scenario);
    return [
      ...r.events.map((e: any) => {
        const x = a.perEvent[e.id] ?? {},
          y = b.perEvent[e.id] ?? {};
        return [
          e.id,
          eventIds.includes(e.id) ? "是" : "间接影响",
          num(x.downtime ?? 0),
          num(y.downtime ?? 0),
          num(loss(x) - (x.downtime ?? 0)),
          num(loss(y) - (y.downtime ?? 0)),
          num(loss(x) - loss(y)),
        ];
      }),
      [
        "公共保存开销",
        "独立计账",
        "—",
        "—",
        num(a.ledger.save),
        num(b.ledger.save),
        num(a.ledger.save - b.ledger.save),
      ],
    ];
  };
  const classification = ["hard", "slow", "sdc"].map((type) => {
    const events = r.events.filter((e: any) => e.type === type),
      total = events.reduce((s: number, e: any) => s + e.fit, 0);
    return [
      types[type],
      num(total),
      pct(events.reduce((s: number, e: any) => s + e.share, 0)),
      `${events.filter((e: any) => e.evidence === "internal-measured").length} / ${events.length}`,
      type === "hard"
        ? "优先用内网中断总量与类内占比校准"
        : "缺内网数据时保留外网先验，不置零",
    ];
  });
  const brief = auditSummary(r);
  const sections: AuditSection[] = [
    {
      title: "审核结论与行动重点",
      paragraphs: [
        auditSamplingDescription(r),
        `${num(selected, 0)} 卡：${brief.statusLabel}。基线 ${pct(brief.base.statistics.mean)} → 组合 ${pct(brief.combined.statistics.mean)}；新增正确计算 ${num(brief.additionalHours)} 小时。`,
        brief.next,
        `最大基线损失为${brief.losses[0].name}（${num(brief.losses[0].base)} 小时）；优先核对 ${brief.drivers
          .slice(0, 3)
          .map((d: any) => d.id)
          .join("、")} 的数据来源与机制覆盖。`,
        `${r.events.length} 条事件中 ${brief.internal} 条标记为内部观测；其余为外网先验或方案假设。`,
        "下表是本次实际评估组合；后文推荐的是候选子集，不会自动替换本次组合。常规CKPT与人工恢复已包含在基线；硬件降FIT须单独提供目标。专家六项是对照方案，不表示每个规模的最优部署。",
      ],
      tables: [
        {
          heads: ["本次启用措施", "措施名称", "本次参数"],
          rows: auditSelectedMechanisms(r).map((m) => [
            m.code,
            m.name,
            m.parameters,
          ]),
        },
      ],
    },
    {
      title: "01 / 确认口径与数据证据",
      paragraphs: [
        `单作业 ${num(selected, 0)} 卡，${num(hours)} 小时窗口；计算 ${num(p.checkpointComputeSeconds)} 秒 / 保存 ${num(p.checkpointSaveSeconds)} 秒。`,
        `自动恢复尝试 ${num(p.recoveryAttemptSeconds)} 秒，成功率 ${pct(p.recoverySuccess)}，失败额外人工 ${num(p.manualAdditionalSeconds / 60)} 分钟；静默漏检兜底 ${num(p.sdcDelayHours)} 小时。`,
        "指标：期末保留的正确计算进度 / 窗口理想产出；仍污染时保留最后干净检查点。与旧 V4 整条任务清零结果不直接比较。",
        "FIT 为每十亿 NPU 等效运行小时的业务影响事件率，不能直接当成器件物理 FIT。0 FIT 是当前预算假设，不是不会发生。",
      ],
      tables: [
        {
          heads: [
            "单作业规模",
            "正确有效产出目标",
            "中断 MTBF / h",
            "基线运行可用度",
            "组合运行可用度",
            "组合正确有效产出",
            "目标判读",
          ],
          rows: scales.map((cards) => {
            const s = auditSummary(r, cards);
            return [
              num(cards, 0),
              s.referenceOnly ? "参考点，未设需求目标" : pct(s.target),
              num(hardFit > 0 ? 1e9 / (cards * hardFit) : null),
              pct(s.base.availability),
              pct(s.combined.availability),
              pct(s.combined.statistics.mean),
              s.statusLabel,
            ];
          }),
        },
        {
          heads: ["参数 / 行为", "当前基线", "本轮处理"],
          rows: [
            [
              "统计对象",
              `单一作业、全部卡参加，${num(hours)} 小时有限窗口`,
              "多规模独立比较；运行可用度与正确有效产出分别报告",
            ],
            [
              "保存策略",
              `${num(p.checkpointComputeSeconds)} 秒计算 / ${num(p.checkpointSaveSeconds)} 秒阻塞保存`,
              "停机不保存；step / 重执行保留周期相位，持久化保存与易失状态不混同",
            ],
            [
              "中断发现",
              `${pct(p.detectProbability)} 在 ${num(p.detectSeconds)} 秒发现，其余 ${num(p.timeoutSeconds)} 秒超时`,
              "检测优化另作单项，不重复领取既有检测收益",
            ],
            [
              "自动恢复与人工兜底",
              `${num(p.recoveryAttemptSeconds / 60)} 分钟尝试，成功率 ${pct(p.recoverySuccess)}；失败额外 ${num(p.manualAdditionalSeconds / 60)} 分钟`,
              `平均尝试与人工 ${num((p.recoveryAttemptSeconds + (1 - p.recoverySuccess) * p.manualAdditionalSeconds) / 60)} 分钟，不含检测；有限窗口实际停机另行统计`,
            ],
            [
              "亚健康",
              `降速 ${pct(p.slowLoss)}；${pct(p.slowDetectProbability)} 在 ${num(p.slowDetectHours * 60)} 分钟发现，漏检持续 ${num(p.slowLifetimeHours)} 小时`,
              "检出后保存当前进度并恢复，零回滚；带污染的状态仍带污染",
            ],
            [
              "静默兜底",
              `${num(p.sdcDelayHours)} 小时发现；即时检测为新增候选能力`,
              "回到错误前最后干净检查点；同一污染期合并，期末保留之前正确进度",
            ],
            [
              "事件分配",
              `${r.events.length} 条事件 / ${new Set(r.events.map((e: any) => e.domain)).size} 个硬件或根因域`,
              "总占比和类内占比来自冻结 FIT；0 FIT 保留为预算假设，不当作无风险",
            ],
          ],
        },
        {
          heads: [
            "事件类型",
            "合计 FIT",
            "总占比",
            "内部观测来源条目 / 总条目",
            "更新原则",
          ],
          rows: classification,
        },
      ],
    },
    {
      title: "02 / 目标分配、计算逻辑与收益分摊",
      visual: "method",
      paragraphs: [
        "先明确整体指标，再分配子模型目标，落实降 FIT 或检测/恢复等工程措施，正向计算具体场景，最后做组合收益与权衡。",
        "Availability：独立稳态串联 A=∏Aᵢ，在 −ln(A) 预算上分配。Equal：共同任务窗口下均分 −ln(R)/T 故障率预算。ARINC：按基线故障率等比缩放。",
        "AGREE：λᵢ=nᵢ(−ln R)/(N Eᵢ tᵢ)，使 ∏Rᵢ^Eᵢ=R；属于加权任务可靠度近似，不能将其普通乘积直接当作总体目标。训练正确产出需分配互斥损失预算后正向验证，不能直接串联相乘。",
        "λᵢ(N)=N×FITᵢ/10⁹；机制改变事件后果，硬件改进才通过明确的新旧 FIT 改变事件发生率。",
        `物理恢复链：检测 → ${r.config.recoveryOrder.join(" → ")} → 全局 CKPT → 人工；只走启用且适用节点，失败尝试耗时累加。`,
        "离散事件仿真处理固定发现时延、周期检查点、污染合并与局部容量损失。存在先后顺序不等于 CTMC；恒定转移率、指数停留时间成立时才适用 CTMC，其他持续时间可用半马尔科夫或仿真。",
        "Shapley 对各组合的边际增益取加权平均，不分配顶层设计指标，也不改变物理恢复顺序。统计独立不自动意味着收益可加；若价值函数确实可加，直接比较单项即可。",
        "窗口小时 = 正确进度 + 全局停机 + 保存阻塞 + 降速 + 局部容量损失 + 已回滚进度 + 期末污染；重算耗时已在后续时间中体现，不重复扣账。",
        "A运行 = 1 − 全局停机 / 窗口；A有效 = 期末保留的正确进度 / 窗口。当前目标约束 A有效。中断 MTBF = 10⁹ /（卡数 × 中断 FIT 总量），与全类型事件 MTBF 不同；MTBF 本身不能推出正确有效产出目标。",
        `基线无故障保存占比约 ${pct(p.checkpointSaveSeconds / (p.checkpointComputeSeconds + p.checkpointSaveSeconds))}，普通中断回滚距离参考约 ${(p.checkpointComputeSeconds / 120).toFixed(3)} 分钟；仍须通过有限窗口仿真核算。DP 按可用域数 / ${r.config.policy["R-ELASTIC"].domains} 折算容量，依赖其余域可继续产生可保留进度，未建模梯度同步阻塞、重分片、收敛、备用容量耗尽和跨域共因。`,
      ],
    },
    {
      title: "03 / 基线与改进收益总览",
      visual: "overview",
      paragraphs: [
        `${r.request.trials} 条配对轨迹 / 场景；${r.rows[0].statistics.intervalMethod.includes("normal") ? "95% 正态近似（1.96）" : "95% Student-t"} 均值区间仅反映抽样误差，不含参数及模型误差。运行时间变化会改变故障暴露，配对种子不意味着逐事件完全对齐。`,
      ],
      tables: [
        {
          heads: [
            "规模",
            "基线运行可用度",
            "基线正确产出 / 区间",
            "组合正确产出 / 区间",
            "基线停机 h",
            "保存 h",
            "降速 h",
            "局部容量 h",
            "回滚 h",
            "期末污染 h",
          ],
          rows: r.rows
            .filter((x: any) => x.id === "base")
            .map((x: any) => {
              const c = r.rows.find(
                (y: any) => y.cards === x.cards && y.id === "combined",
              );
              return [
                num(x.cards, 0),
                pct(x.availability),
                pct(x.statistics.mean) + " / " + ci(x.statistics),
                pct(c.statistics.mean) + " / " + ci(c.statistics),
                num(x.ledger.downtime),
                num(x.ledger.save),
                num(x.ledger.slowdown),
                num(x.ledger.localLoss),
                num(x.ledger.rollback),
                num(x.ledger.terminalInvalid),
              ];
            }),
        },
        {
          heads: [
            "所选规模方案",
            "正确有效产出",
            "相比基线提升",
            "提升 95% 区间",
            "新增正确计算 h",
            "单窗口达到目标比例",
          ],
          rows: selectedRows.map((row: any) => [
            row.name,
            pct(row.statistics.mean),
            pp(row.delta.mean),
            pp(row.delta.ciLow) + " ～ " + pp(row.delta.ciHigh),
            num(hours * row.delta.mean),
            pct(row.statistics.achievementProbability),
          ]),
        },
      ],
    },
    {
      title: "04 / 独立故障事件库",
      paragraphs: [
        "事件身份与基线损失独立于机制库。总损失占比分母排除公共保存开销；静默污染归给首次污染事件，同一污染期不重复计五天。单次停机为累计停机/次数，不能解释为每次都采用该恢复时长。",
        "表内仅显示证据等级，完整来源和归因说明在表后的同名事件明细中查看。长文本不挤入数值列；搜索仍覆盖全部来源与说明，打印保留完整明细。",
      ],
      tables: [
        {
          heads: [
            "事件",
            "硬件/根因域 · 故障表现",
            "类型",
            "FIT",
            "事件 MTBF h",
            "总占比",
            "类内占比",
            "窗口次数",
            "单次停机 min",
            "窗口停机 h",
            "计算损失 h",
            "损失占比",
            "数据证据",
          ],
          eventSources: r.events.map((e: any) => ({
            id: e.id,
            domain: e.domain,
            description: e.description,
            source: e.source,
            evidence:
              {
                "internal-measured": "内部观测",
                "external-prior": "外网先验",
                scenario: "方案假设",
              }[e.evidence as string] ?? e.evidence,
            note: e.note,
            referenceEvidence: e.referenceEvidence,
            referenceReviewNote: e.referenceReviewNote,
            legacyEvidence: e.legacyEvidence,
            fitEvidence: e.fitEvidence,
          })),
          rows: eventRows(selected),
          scaleLabel: "事件库规模",
          scaleRows: scales.map((cards) => ({ cards, rows: eventRows(cards) })),
        },
      ],
    },
    {
      title: "05 / 机制覆盖、失败回退与逐项收益",
      paragraphs: [
        "以下适用范围与前置条件参考专家审核；计算以本报告冻结的机器可读参数为准。基线已有 CKPT/人工能力不重复领取收益；硬件改进没有目标 FIT 时标为未估计。",
      ],
    },
  ];
  for (const m of r.mechanisms) {
    const single = selectedRows.find((row: any) => row.id === codes[m.id]);
    sections.push({
      title: m.id + " / " + m.name,
      collapsed: true,
      paragraphs: [
        m.prerequisite,
        m.failure,
        "参考说明：" + m.change,
        "本次生效参数：" +
          Object.entries(m.parameters ?? {})
            .map(
              ([key, value]) =>
                `${parameterLabels[key] ?? key} = ${typeof value === "number" ? num(value, 6) : value}`,
            )
            .join("；"),
        "覆盖事件：" + m.eventIds.join("、"),
        "证据：" + m.confidence,
      ],
      tables: single
        ? [
            {
              heads: [
                "规模",
                "单项产出",
                "相比基线提升",
                "提升区间",
                "新增正确计算 h",
              ],
              rows: r.rows
                .filter((row: any) => row.id === codes[m.id])
                .map((row: any) => [
                  num(row.cards, 0),
                  pct(row.statistics.mean),
                  pp(row.delta.mean),
                  pp(row.delta.ciLow) + " ～ " + pp(row.delta.ciHigh),
                  num(hours * row.delta.mean),
                ]),
            },
            {
              heads: [
                "事件",
                "直接覆盖",
                "基线停机 h",
                "启用后停机 h",
                "基线计算损失 h",
                "启用后计算损失 h",
                "减少总损失 h",
              ],
              rows: impactRows(selected, codes[m.id], m.eventIds),
              scaleLabel: "逐事件对照规模",
              scaleRows: scales.map((cards) => ({
                cards,
                rows: impactRows(cards, codes[m.id], m.eventIds),
              })),
            },
          ]
        : [
            {
              heads: ["收益状态"],
              rows: [
                [
                  m.id === "R-CKPT" || m.id === "R-MANUAL"
                    ? "已在基线，不重复计新增收益"
                    : "未估计；需要明确的独立增量参数",
                ],
              ],
            },
          ],
    });
  }
  sections.push({
    title: "06 / 组合贡献与条件依赖",
    paragraphs: [
      "组合增益不等于单项之和；保留负贡献。成对交互只描述相对空组合的二阶差分，不包含全部高阶交互。Shapley 的加入顺序不代表实际恢复链的先后顺序。",
      "φᵢ = Σₛ |S|! (m−|S|−1)! / m! × [A(S∪{i})−A(S)]；Σφᵢ = A(全部启用措施)−A(空组合基线)。枚举全部子集不代表模型和参数无误差；step 单独无收益，也可能因为依赖检测而分得组合贡献。",
    ],
  });
  for (const a of r.attribution)
    sections.push({
      title: `${num(a.cards, 0)} 卡 / Shapley 审核`,
      paragraphs: [
        `每个组合 ${a.trials} 条轨迹，${a.coalitions.length} 个子集。总提升 ${pp(a.gain)}；与单项之和差值 ${pp(a.nonAdditivity)}；守恒残差 ${num(a.residual, 12)}。`,
        `已启用静默检测后，step 的额外提升 ${pp(a.conditionalStep.mean)}，95% 区间 ${pp(a.conditionalStep.ciLow)} ～ ${pp(a.conditionalStep.ciHigh)}。此条件比较使用主评估 ${r.request.trials} 条轨迹。`,
      ],
      tables: [
        {
          heads: ["机制", "Shapley 贡献", "95% 区间", "新增正确计算 h / 窗口"],
          rows: a.contributions.map((c: any) => [
            c.name,
            pp(c.statistics.mean),
            pp(c.statistics.ciLow) + " ～ " + pp(c.statistics.ciHigh),
            num(c.statistics.mean * hours),
          ]),
        },
        {
          heads: ["机制对", "基线二阶交互", "95% 区间"],
          rows: a.interactions.map((i: any) => [
            i.a + " + " + i.b,
            pp(i.statistics.mean),
            pp(i.statistics.ciLow) + " ～ " + pp(i.statistics.ciHigh),
          ]),
        },
      ],
    });
  if (!r.attribution.length)
    sections.push({
      title: "组合分摊未启用",
      paragraphs: [
        "已提供单项与组合前向结果，本次未计算 Shapley；不能由未计算推断收益完全可加。",
      ],
    });
  sections.push({
    title: "07 / 关键参数敏感性",
    visual: "sensitivity",
    paragraphs: [
      ["expert-reference", "expert-reproduction"].includes(
        r.request.sensitivityMode,
      )
        ? "专家审核口径：静默检出率和 step 上限在“静默检测＋step”情景下扫描，弹性暂停在“DP 弹性单项”情景下扫描。每组保持其他输入不变，相对本组当前参数进行配对比较，与所选组合达标判断分别解释。"
        : "所选组合口径：保持已选措施及其他输入不变，相对当前组合进行配对比较；只有启用了对应机制才扫描相关参数。",
      "曲线只使用本次冻结结果。0% / 100% 检出率用于边界核查，不代表已实现能力；均值区间仅反映抽样误差。",
      (() => {
        const sdcFit = r.events
          .filter((e: any) => e.type === "sdc")
          .reduce((n: number, e: any) => n + e.fit, 0);
        const coreShare = sdcFit
          ? (r.events.find((e: any) => e.id === "CORE-sdc")?.fit ?? 0) / sdcFit
          : 0;
        return `当前 Core 占静默事件 ${pct(coreShare)}。如果 ${pct(r.config.policy["D-SDC"].coverage)} 的检出能力仅覆盖 Core，则全系统覆盖率最多约 ${pct(coreShare * r.config.policy["D-SDC"].coverage)}；必须逐条证明非零 SDC 事件的覆盖，不能直接替代全系统检出率。step 秒数同样是待校准输入。`;
      })(),
      ...(!r.sensitivity?.length
        ? [
            "本次未计算敏感性。选择比较口径并启用敏感性分析后重新评估，才会生成实际曲线与对照表。",
          ]
        : []),
    ],
    tables: [
      {
        heads: [
          "参数",
          "扫描规模 / 卡",
          "比较情景",
          "取值",
          "正确产出",
          "95% 均值区间",
          "相对本组当前参数提升",
          "提升区间",
          "期末污染 h",
          "停机 h",
          "局部容量损失 h",
        ],
        rows: (r.sensitivity ?? []).map((s: any) => [
          sensitivityLabels[s.parameter] ?? s.parameter,
          num(s.cards, 0),
          s.scenarioName ?? "所选机制组合",
          s.parameter === "sdcCoverage" ? pct(s.value) : num(s.value),
          pct(s.statistics.mean),
          ci(s.statistics),
          pp(s.delta.mean),
          pp(s.delta.ciLow) + " ～ " + pp(s.delta.ciHigh),
          num(s.ledger?.terminalInvalid),
          num(s.ledger?.downtime),
          num(s.ledger?.localLoss),
        ]),
      },
    ],
  });
  sections.push({
    title: "08 / 设计权衡与待校准项",
    paragraphs: [
      `所选组合目标 ${pct(r.decision.target)}；${r.decision.status === "supported-by-sampling" ? "采样均值区间下限达到目标" : r.decision.status === "below-target" ? "采样均值区间整体低于目标" : "区间跨越目标，证据不足"}，仍需独立种子与真实产品验证。`,
      r.decision.totalCost === null
        ? "缺少完整成本输入，暂不宣称最优性价比；所有机制成本须使用一致单位。"
        : `所选机制总成本 ${num(r.decision.totalCost)}（用户统一成本单位）；未计硬件换型成本及组合耦合成本。`,
      "优先校准中断总率、CORE-hard 等细分占比和重执行/弹性覆盖；静默和亚健康暂保留外网证据。只更新中断事件不会按旧总比例重缩放其余两类。",
      "重点扫描全系统静默检出率、漏检兜底时延、恢复耗时和检查点周期；Core 内检出率与全系统覆盖率不同，不能直接替代。",
      ...r.warnings,
      "本次自动核查只证明模型内数值和记账一致性。真实产品仍需验证误报、检测开销、带宽、备用容量、多作业、共因故障、寿命分布、SDC 长尾、训练收敛和 DP 重构。原专家回归由工程测试执行，不把上游历史“通过”记录充作本次内网数据认证。",
    ],
    tables: [
      {
        heads: ["本次结果自动核查", "状态", "依据"],
        rows: r.reviewChecks?.map((c: any) => [
          c.name,
          { passed: "通过", failed: "未通过", "not-run": "未执行" }[
            c.status as string
          ] ?? c.status,
          c.detail,
        ]) ?? [
          ["历史运行", "未保存核查记录", "保留原结果；不补写本次运行认证"],
        ],
      },
    ],
  });
  if (r.candidateEvents.length)
    sections.push({
      title: "硬件目标 FIT 对照",
      tables: [
        {
          heads: ["事件", "当前 FIT", "目标 FIT", "目标依据"],
          rows: r.candidateEvents
            .filter((e: any) =>
              r.request.candidateFitOverrides.some((p: any) => p.id === e.id),
            )
            .map((e: any) => [
              e.id,
              num(r.events.find((x: any) => x.id === e.id).fit),
              num(e.fit),
              e.source,
            ]),
        },
      ],
    });
  if (r.request.eventOverrides?.length)
    sections.push({
      title: "本次基线数据更新记录",
      paragraphs: [
        "下列记录取自本次冻结输入；更新中断事件时，未提交的静默与亚健康事件保留外网先验。总占比、类内占比及中断 MTBF 随本次 FIT 重新计算，需求目标保持用户给定值。",
      ],
      tables: [
        {
          heads: [
            "事件",
            "参考 FIT",
            "本次 FIT",
            "本次总占比",
            "本次类内占比",
            "证据等级",
          ],
          rows: r.events
            .filter((e: any) =>
              r.request.eventOverrides.some((p: any) => p.id === e.id),
            )
            .map((e: any) => [
              e.id,
              num(e.referenceFit),
              num(e.fit),
              pct(e.share),
              pct(e.withinTypeShare),
              e.evidence === "internal-measured"
                ? "内部观测"
                : e.evidence === "scenario"
                  ? "方案假设"
                  : "外网先验",
            ]),
        },
      ],
    });
  if (r.designReview)
    sections.push({
      title: "平台扩展 / 目标预算与实际缺口",
      paragraphs: [
        `无故障保存开销参考：基线 ${pct(r.designReview.baselineNoFault)}，所选检查点策略 ${pct(r.designReview.selectedNoFault)}；该参考不是任意机制下的可行性上界。`,
        "各规模目标由需求给定；六项损失互斥记账，预算不是故障率缩放。超预算项需结合故障证据和机制适用性落实措施，再正向复算。",
      ],
      tables: r.designReview.scales.map((s: any) => ({
        heads: [
          `${num(s.cards, 0)} 卡 · 目标 ${pct(s.target)}`,
          "预算/小时",
          "实际/小时",
          "超预算/小时",
          "工程核查",
        ],
        rows: s.items.map((x: any) => [
          x.name,
          num(x.allowedHours),
          num(x.actualHours),
          num(x.excessHours),
          x.action,
        ]),
      })),
    });
  if (r.recommendation) {
    const rec = r.recommendation,
      v = rec.verification;
    sections.push({
      title: "平台扩展 / 候选选择与独立验证",
      paragraphs: [
        rec.rule,
        "这里展示筛选建议；本次实际启用措施以前面的组合清单为准，建议须显式载入后重新确认和计算。",
        `筛选范围：${num(selected, 0)} 卡，${rec.candidateCount} 个候选；硬件 FIT 候选另列，不参与本次机制子集筛选。`,
        v
          ? `独立复核 ${v.trials} 条轨迹，种子索引偏移 ${v.seedOffset}；均值 ${pct(v.statistics.mean)}，95% 均值区间 ${ci(v.statistics)}，结论 ${v.status === "supported" ? "采样支持达标" : v.status === "below" ? "低于目标" : "证据不足"}。条件于输入模型，不能替代产品实测。`
          : "未执行独立复核；筛选数据不是独立验证证据。",
      ],
      tables: [
        {
          heads: ["候选机制", "筛选均值", "95% 均值区间", "成本"],
          rows: rec.shortlist.map((c: any) => [
            c.mechanisms
              .map(
                (id: string) =>
                  r.rows.find((m: any) => m.id === id)?.name ?? id,
              )
              .join(" + ") || "基线",
            pct(c.statistics.mean),
            ci(c.statistics),
            num(c.cost),
          ]),
        },
      ],
    });
  }
  return sections;
}

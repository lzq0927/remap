import type { AuditSection } from "./audit";
import {
  auditNumber as num,
  auditPercent as pct,
  auditParameter,
  recoveryBudget,
} from "../../contracts/src/audit-recovery-budget";
import {
  auditScalePresets,
  auditSummaryScales,
  auditReferenceOnly,
} from "../../contracts/src/audit-presets";
import { trainingRecoveryBudget } from "../../contracts/src/audit-training-scenario";

export function targetRecoverySections(result: any): AuditSection[] {
  const r = result.request,
    s = r.trainingScenario;
  const scales = auditSummaryScales(r, r.scales ?? [r.cards]).filter(
    (c) => !auditReferenceOnly(r, c),
  );
  return [
    {
      title: "目标、MTBF与等效MTTR预算",
      paragraphs: [
        "各需求规模默认采用共同最低目标98.5%；当前万卡98.5%是用户提供的现状参考。技术增强后小规模实际结果可以提高，更大规模也需达标；不将计算结果截断为目标值。历史或自定义目标仍以本次输入为准。",
        "MTTR = MTBF × (1−A) / A；总损失预算 = 总窗口 × (1−A)。这是同口径运行/损失周期下的条件换算，不能将该总预算分别交给每个检测或恢复阶段。",
        "实际可用度仍按故障模式FIT和机制计算的互斥损失账核验。回滚、静默、亚健康、保存及人工兜底均需占用预算；参考MTBF若仅覆盖计算中断，不能冒充全系统业务MTBF。",
        "各层先由现状损失、故障模式和Shapley证据进行非均分分配，再结合各层事件间隔换算等效恢复要求。父子预算守恒，层间秒数不能直接相加。参数参考值可调整；目标换算不自动改写参数或宣称达标。",
        s
          ? "本表MTBF来自载入模板，跨规模按同范围线性暴露折算；实际数量倍率、后续FIT编辑以正向评估快照为准。场景参考可用度与正式目标分别展示。"
          : "表中MTBF用于目标推导；实际事件间隔另见各层诊断。历史报告使用当时冻结目标，不追溯修改。",
      ],
      tables: [
        {
          heads: [
            "规模 / 卡",
            "参考MTBF / 分钟",
            "正式目标",
            "目标等效MTTR / 秒",
            "损失预算 / 小时",
            "场景参考可用度",
            "参考值折算MTTR / 秒",
          ],
          rows: scales.map((c) => {
            const target =
              c === r.cards ? r.target : (r.targets?.[c] ?? r.target);
            const t = s ? trainingRecoveryBudget(s, c, target, r.hours) : null;
            const b =
              t?.target ??
              recoveryBudget(
                auditScalePresets.find((p) => p.cards === c)?.hardMtbfHours ??
                  null,
                target,
                r.hours,
              );
            return [
              num(c, 0),
              num(b.mtbfHours == null ? null : b.mtbfHours * 60),
              pct(target),
              num(b.equivalentMttrSeconds, 1),
              num(b.lossHours),
              pct(t?.reference?.availability),
              num(t?.reference?.equivalentMttrSeconds, 1),
            ];
          }),
        },
      ],
    },
  ];
}
export function trainingScenarioSections(result: any): AuditSection[] {
  const s = result.request.trainingScenario;
  if (!s) return [];
  const p = result.config.model,
    policy = result.config.policy;
  const fit = result.events
    .filter((e: any) => s.mtbfEventIds.includes(e.id))
    .reduce((a: number, e: any) => a + e.fit, 0);
  return [
    {
      title: "600小时训练场景 · 输入依据与实际配置",
      paragraphs: [
        `场景：${s.name}。${result.request.hours}小时为固定总窗口；${num(s.referenceAvailabilityCards ?? 500000, 0)}卡参考可用度${pct(s.referenceAvailability)}，不是正式目标或强制校准后的结果。目标及达标结论使用本次输入与正向仿真。`,
        ...Object.entries(s.referenceAvailabilityByScale ?? {}).map(
          ([cards, a]) =>
            `补充现状参考：${num(Number(cards), 0)}卡 ${pct(a as number)}；独立于MTBF参考卡数，不强制拟合该参考点。`,
        ),
        `载入时MTBF意图：${s.referenceCards}卡 ${num(s.mtbfHours)}小时；作用事件：${s.mtbfEventIds.join("、")}。当前这些事件的等效FIT合计 ${num(fit)}，在参考卡数下折算间隔 ${num(1e9 / s.referenceCards / fit)}小时（实际数量缩放另见各规模事件快照）。`,
        "本表记录真实计算配置，模板只是可调整参考初值，静默检出率等不作为优化上限；AGREE分配后可调整机制并独立复评。人工恢复在自动失败后追加；人工排查按所选假设映射漏检暴露时长，不能重复算一次停机。串行恢复总时长不包含已单独计算的检测时间。未提供参数继承原模型，不代表专家给出了这些值。",
        "当前30小时@万卡按独立等效事件率外推是36分钟@50万卡；17分钟与其方向不同，需核对故障范围/架构，不能仅凭方案名称宣称频率改善。",
        `来源：${s.source}`,
        `机制意图：${s.mechanismNotes ?? "按本次选择与参数解释"} 这些名称是输入方案说明；当前模型通过参数体现效果，未单独叠加一笔同名收益。若改用专家扩展机制，需防止与已改善的基础参数重复计算。`,
      ],
      tables: [
        {
          heads: ["计算参数", "本轮配置"],
          rows: [
            [
              "检查点间隔 / 保存阻塞（秒）",
              `${num(policy["C-FAST"].computeSeconds)} / ${num(policy["C-FAST"].saveSeconds)}`,
            ],
            [
              "中断检出率 / 检测秒数",
              `${num(policy["D-HARD"].coverage * 100)}% / ${num(policy["D-HARD"].detectSeconds)}`,
            ],
            [
              "自动恢复尝试（秒，通信+构建+加载+编译）",
              num(p.recoveryAttemptSeconds),
            ],
            ["自动恢复成功率", num(p.recoverySuccess * 100) + "%"],
            [
              "失败后人工追加恢复（小时）",
              num(p.manualAdditionalSeconds / 3600),
            ],
            [
              "静默检出率 / 发现秒数",
              `${num(policy["D-SDC"].coverage * 100)}% / ${num(policy["D-SDC"].detectSeconds)}`,
            ],
            [
              "亚健康检出率 / 发现秒数",
              `${num(policy["D-SLOW"].coverage * 100)}% / ${num(policy["D-SLOW"].detectSeconds)}`,
            ],
            [
              "静默漏检兜底发现 / 亚健康漏检持续（小时）",
              `${num(p.sdcDelayHours)} / ${num(p.slowLifetimeHours)}`,
            ],
            [
              "载入的人工排查映射",
              s.investigationMapping === "sdc-and-slow"
                ? "静默兜底与亚健康持续近似"
                : "静默兜底",
            ],
          ],
        },
      ],
    },
  ];
}
export function trainingScenarioComparisonTables(
  result: any,
): NonNullable<AuditSection["tables"]> {
  if (result.comparisonMode !== "training-scenarios") return [];
  const entries = result.entries;
  const keys = [
    ...new Set<string>(
      entries.flatMap((e: any) => Object.keys(e.configuration.model ?? {})),
    ),
  ];
  const policyKeys = [
    ...new Set<string>(
      entries.flatMap((e: any) =>
        Object.entries(e.configuration.policy ?? {}).flatMap(([code, fields]) =>
          Object.keys(fields as object).map((k) => code + "." + k),
        ),
      ),
    ),
  ];
  return [
    {
      heads: ["实际输入参数", ...entries.map((e: any) => e.name)],
      rows: [
        [
          "用户参考可用度（非计算结果）",
          ...entries.map(
            (e: any) =>
              num(e.trainingScenario.referenceAvailability * 100) + "%",
          ),
        ],
        [
          "50万卡正式目标",
          ...entries.map((e: any) =>
            pct(
              e.architectureDiagnosis?.scales.find(
                (s: any) => s.cards === 500000,
              )?.target,
            ),
          ),
        ],
        [
          "50万卡目标等效MTTR / 秒（模板同范围折算）",
          ...entries.map((e: any) =>
            num(
              trainingRecoveryBudget(
                e.trainingScenario,
                500000,
                e.architectureDiagnosis?.scales.find(
                  (s: any) => s.cards === 500000,
                )?.target,
                result.hours ?? 600,
              ).target.equivalentMttrSeconds,
              1,
            ),
          ),
        ],
        [
          "参考可用度卡数 / 折算MTTR秒",
          ...entries.map((e: any) => {
            const c = e.trainingScenario.referenceAvailabilityCards ?? 500000;
            const b = trainingRecoveryBudget(
              e.trainingScenario,
              c,
              0.985,
            ).reference;
            return `${num(c, 0)} / ${num(b?.equivalentMttrSeconds, 1)}`;
          }),
        ],
        [
          "MTBF参考卡数 / 小时 / 事件范围",
          ...entries.map(
            (e: any) =>
              `${e.trainingScenario.referenceCards} / ${num(e.trainingScenario.mtbfHours)} / ${e.trainingScenario.mtbfEventIds.join("、")}`,
          ),
        ],
        ...keys.map((k) => [
          "model." + k,
          ...entries.map((e: any) =>
            auditParameter(e.configuration.model?.[k], k),
          ),
        ]),
        ...policyKeys.map((k) => {
          const [code, key] = k.split(".");
          return [
            k,
            ...entries.map((e: any) =>
              auditParameter(e.configuration.policy?.[code]?.[key], key),
            ),
          ];
        }),
        ...entries[0].events.map((e: any) => [
          e.id + " FIT",
          ...entries.map((x: any) =>
            num(x.events.find((v: any) => v.id === e.id)?.fit),
          ),
        ]),
      ],
    },
  ];
}

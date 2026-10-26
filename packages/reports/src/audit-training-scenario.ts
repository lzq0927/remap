import type { AuditSection } from "./audit";
const num = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString("zh-CN", { maximumFractionDigits: 5 })
    : "—";
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
        `场景：${s.name}。${result.request.hours}小时为固定总窗口；参考可用度${num(s.referenceAvailability * 100)}%，不是强制校准后的结果。目标及达标结论仍使用正式评估输入与仿真。`,
        `载入时MTBF意图：${s.referenceCards}卡 ${num(s.mtbfHours)}小时；作用事件：${s.mtbfEventIds.join("、")}。当前这些事件的等效FIT合计 ${num(fit)}，在参考卡数下折算间隔 ${num(1e9 / s.referenceCards / fit)}小时（实际数量缩放另见各规模事件快照）。`,
        "本表记录真实计算配置，模板载入后允许继续修改。人工恢复在自动失败后追加；人工排查按所选假设映射漏检暴露时长，不能重复算一次停机。串行恢复总时长不包含已单独计算的检测时间。未提供参数继承原模型，不代表专家给出了这些值。",
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
          "MTBF参考卡数 / 小时 / 事件范围",
          ...entries.map(
            (e: any) =>
              `${e.trainingScenario.referenceCards} / ${num(e.trainingScenario.mtbfHours)} / ${e.trainingScenario.mtbfEventIds.join("、")}`,
          ),
        ],
        ...keys.map((k) => [
          "model." + k,
          ...entries.map((e: any) => num(e.configuration.model?.[k])),
        ]),
        ...policyKeys.map((k) => {
          const [code, key] = k.split(".");
          return [
            k,
            ...entries.map((e: any) =>
              num(e.configuration.policy?.[code]?.[key]),
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

import type { AuditSection } from "./audit";
import { lineChart } from "./audit-charts";
import {
  summaryNumber as n,
  summaryScaleLabel as scale,
  summaryEscape as esc,
  summaryColors as colors,
  orderedDiagnosisScales,
  lossLabels,
} from "./audit-scale-summary";
import { auditMechanismCodes } from "../../contracts/src/audit-mechanism-view";
const pct = (v: number) => n(v * 100) + "%";
const statistics = (v: number) => ({ mean: v, ciLow: v, ciHigh: v });

export function contributionHeatmap(
  d: any,
  adopted: Record<string, string[]> = {},
) {
  const scales = orderedDiagnosisScales(d).filter((s) => s.ranking.length);
  const ids = [
    ...new Set<string>(scales.flatMap((s) => s.ranking.map((r: any) => r.id))),
  ];
  if (!ids.length) return "";
  const value = (id: string, s: any) => s.ranking.find((r: any) => r.id === id);
  const sorted = ids.sort((a, b) =>
    scales.reduce(
      (t, s) =>
        t +
        (value(b, s)?.statistics.mean ?? 0) -
        (value(a, s)?.statistics.mean ?? 0),
      0,
    ),
  );
  const max = Math.max(
    1e-9,
    ...scales.flatMap((s) =>
      s.ranking.map((r: any) => Math.abs(r.statistics.mean)),
    ),
  );
  const height = 85 + sorted.length * 39,
    colWidth = 135,
    left = 255,
    width = Math.max(860, left + scales.length * colWidth + 20);
  let svg =
    '<svg viewBox="0 0 ' +
    width +
    " " +
    height +
    '" role="img" aria-label="跨规模贡献热力图">';
  scales.forEach((s, j) => {
    svg +=
      '<text x="' +
      (left + j * colWidth + colWidth / 2) +
      '" y="23" text-anchor="middle">' +
      scale(s.cards) +
      "</text>";
  });
  sorted.forEach((id, i) => {
    const name = scales.map((s) => value(id, s)).find(Boolean)?.name ?? id,
      y = 40 + i * 39;
    svg += '<text x="8" y="' + (y + 22) + '">' + esc(name) + "</text>";
    scales.forEach((s, j) => {
      const r = value(id, s),
        v = r?.statistics.mean,
        x = left + j * colWidth,
        selected = adopted[String(s.cards)]?.includes(
          "policy:" + auditMechanismCodes[id],
        );
      const opacity = v === undefined ? 0 : 0.12 + (0.8 * Math.abs(v)) / max;
      svg +=
        '<g data-heatmap-factor="' +
        esc(id) +
        '" data-cards="' +
        s.cards +
        '" data-adopted="' +
        !!selected +
        '"><title>' +
        esc(name) +
        " · " +
        scale(s.cards) +
        "：" +
        (r
          ? n(v * 100) +
            " pp；95%区间 " +
            n(r.statistics.ciLow * 100) +
            "～" +
            n(r.statistics.ciHigh * 100)
          : "未计算") +
        (selected ? "；方案拟继续改善" : "") +
        '</title><rect x="' +
        x +
        '" y="' +
        y +
        '" width="' +
        (colWidth - 4) +
        '" height="35" fill="' +
        (v < 0 ? "#bd4d58" : "#377faa") +
        '" fill-opacity="' +
        opacity +
        '"/>' +
        (selected
          ? '<rect x="' +
            (x + 2) +
            '" y="' +
            (y + 2) +
            '" width="' +
            (colWidth - 8) +
            '" height="31" fill="none" stroke="#244f40" stroke-width="2"/>'
          : "") +
        '<text x="' +
        (x + colWidth / 2) +
        '" y="' +
        (y + 23) +
        '" text-anchor="middle" style="fill:' +
        (Math.abs(v) / max > 0.6 ? "#fff" : "#263d35") +
        '">' +
        (v === undefined ? "—" : n(v * 100) + " pp") +
        "</text></g>";
    });
  });
  svg +=
    '<text x="8" y="' +
    (height - 5) +
    '">蓝色为正、红色为负；数值为贡献百分点；边框为方案拟改善的现有措施。</text></svg>';
  return (
    '<div class="arch-chart" data-summary-chart="contribution-heatmap"><h3>跨规模贡献热力图</h3><div class="reliability-plot" tabindex="0">' +
    svg +
    '</div><p class="note">贡献来自本轮冻结归因；边框是参数改善选择，不是新的增量贡献。完整增量Shapley须在用户独立评估后计算，颜色不代表统计显著性。</p></div>'
  );
}

export function decisionStudyCharts(
  result: any,
  alternativeId?: string,
): string {
  if (result.kind === "expert-audit-plan-set") {
    const p =
      result.plans.find(
        (p: any) => p.prediction.cards === result.request.cards,
      ) ?? result.plans[0];
    return p ? decisionStudyCharts(p, alternativeId) : "";
  }
  const d = result.decisionStudy;
  if (!d) return "";
  const chosen =
    d.alternatives.find((a: any) => a.id === alternativeId) ??
    d.alternatives.find((a: any) => a.id === d.recommendedId);
  const plotted = d.alternatives.filter(
    (a: any) => a.factorIds.length > 0 || a.id === chosen.id,
  );
  const series = [
    {
      name: "冻结现状配置 · 规划采样",
      color: colors[6],
      points: d.baselineCurves.map((r: any) => ({
        x: r.cards,
        statistics: r.statistics,
      })),
    },
    ...plotted.map((a: any) => ({
      name:
        (a.factorIds.length ? a.label : "现状对照") +
        " · 工作量" +
        n(a.effort) +
        "（配置固定）",
      color:
        colors[d.alternatives.findIndex((other: any) => other.id === a.id)],
      points: a.curves.map((r: any) => ({
        x: r.cards,
        statistics: r.statistics,
      })),
    })),
    {
      name: "各规模目标",
      color: "#b34f65",
      dashed: true,
      points: d.baselineCurves.map((r: any) => ({
        x: r.cards,
        statistics: statistics(r.target),
      })),
    },
  ];
  const bands = plotted
    .filter((a: any) => a.conservativeCurves?.length)
    .map((a: any) => ({
      name: a.label,
      color:
        colors[d.alternatives.findIndex((other: any) => other.id === a.id)],
      points: a.curves.map((r: any) => ({
        x: r.cards,
        low: Math.min(
          r.statistics.mean,
          a.conservativeCurves.find((c: any) => c.cards === r.cards).statistics
            .mean,
        ),
        high: Math.max(
          r.statistics.mean,
          a.conservativeCurves.find((c: any) => c.cards === r.cards).statistics
            .mean,
        ),
      })),
    }));
  const curve = lineChart({
    title: "固定方案在各规模的可用度与保守情景",
    series,
    bands,
    xLabel: "需求规模 / 卡",
    formatX: scale,
    note:
      "现状配置与备选均按" +
      d.trials +
      "条规划轨迹配对试算，原" +
      result.request.trials +
      "条第一轮结果保持冻结并列于摘要。每条方案线固定配置；色带为参数情景范围，细竖线为均值95%抽样区间。未完成正式复评，不外推支持规模。",
  });
  const keys = Object.keys(lossLabels),
    rows = d.baselineCurves.flatMap((r: any) => [
      { cards: r.cards, name: "现状", row: r },
      {
        cards: r.cards,
        name: "方案",
        row: chosen.curves.find((c: any) => c.cards === r.cards),
      },
    ]);
  const max = Math.max(
    1e-9,
    ...rows.map((r: any) =>
      Math.max(
        (1 - r.row.target) * result.request.hours,
        keys.reduce((s, k) => s + (r.row.ledger[k] ?? 0), 0),
      ),
    ),
  );
  const h = 80 + rows.length * 43;
  let bars =
    '<svg viewBox="0 0 1000 ' +
    h +
    '" role="img" aria-label="各规模现状与方案损失成对比较">';
  rows.forEach((r: any, i: number) => {
    let total = 0;
    const y = 30 + i * 43;
    bars +=
      '<g data-paired-cards="' +
      r.cards +
      '" data-paired-kind="' +
      r.name +
      '"><text x="140" y="' +
      (y + 18) +
      '" text-anchor="end">' +
      scale(r.cards) +
      " · " +
      r.name +
      "</text>";
    keys.forEach((k, j) => {
      const v = r.row.ledger[k] ?? 0,
        x = 160 + (total / max) * 700;
      total += v;
      if (v > 0)
        bars +=
          '<rect x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          (v / max) * 700 +
          '" height="24" fill="' +
          colors[j] +
          '" data-hours="' +
          v +
          '"><title>' +
          esc(lossLabels[k]) +
          " " +
          n(v) +
          " h</title></rect>";
    });
    const bx = 160 + (((1 - r.row.target) * result.request.hours) / max) * 700;
    bars +=
      '<path d="M' +
      bx +
      "," +
      (y - 3) +
      'v30" stroke="#b34f65" stroke-width="2" stroke-dasharray="4 3"/><text x="875" y="' +
      (y + 18) +
      '">' +
      n(total) +
      " h</text></g>";
  });
  for (let i = 0; i <= 4; i++)
    bars +=
      '<text x="' +
      (160 + i * 175) +
      '" y="' +
      (h - 18) +
      '" text-anchor="middle">' +
      n((max * i) / 4) +
      " h</text>";
  bars += "</svg>";
  const adopted = Object.fromEntries(
    chosen.curves.map((r: any) => [String(r.cards), chosen.factorIds]),
  );
  return (
    '<div class="decision-study-charts" data-decision-alternative="' +
    esc(chosen.id) +
    '">' +
    curve +
    '<figure class="reliability-chart"><h3>各规模现状与方案损失成对比较 · ' +
    esc(chosen.label) +
    '</h3><div class="reliability-legend">' +
    keys
      .map(
        (k, i) =>
          '<span><i style="background:' +
          colors[i] +
          '"></i>' +
          esc(lossLabels[k]) +
          "</span>",
      )
      .join("") +
    '</div><div class="reliability-plot" tabindex="0">' +
    bars +
    "</div><figcaption>同一规划种子、相同窗口的配对试算；红线为各规模自己的允许损失预算。柱长为等效损失小时，保持互斥账本。</figcaption></figure>" +
    contributionHeatmap(result.architectureDiagnosis, adopted) +
    "</div>"
  );
}

export function decisionStudySections(result: any): AuditSection[] {
  const d = result.decisionStudy;
  if (!d) return [];
  const a = d.alternatives.find(
    (a: any) => a.id === (d.displayAlternativeId ?? d.recommendedId),
  );
  const parameters = new Map<string, Map<string, string>>();
  for (const alternative of d.alternatives)
    for (const factor of alternative.factors ?? []) {
      const values =
        factor.kind === "extension"
          ? factor.value.parameters
          : factor.kind === "fit"
            ? Object.fromEntries(factor.value.map((e: any) => [e.id, e.fit]))
            : factor.value;
      for (const [key, value] of Object.entries(values)) {
        const path = factor.id + "." + key;
        if (!parameters.has(path)) parameters.set(path, new Map());
        parameters
          .get(path)!
          .set(
            alternative.id,
            typeof value === "number" ? n(value, 6) : String(value),
          );
      }
    }
  return [
    {
      title: "决策摘要 / 可达性、备选方案与验证",
      paragraphs: [
        a.nominal.statistics.mean < d.target
          ? "所选方案的名义规划均值仍有缺口；本次搜索没有证明目标不可达。正式第二轮尚未执行。"
          : a.conservative && a.conservative.statistics.mean < d.target
            ? "所选方案的名义规划均值达到目标，保守情景仍未达到目标；尚未获得稳健达标证据，正式第二轮尚未执行。"
            : "所选方案的规划均值达到本次条件；结果仍依赖所列参数和候选范围，正式第二轮尚未执行。",
        "分配使用工程责任小时。Shapley优先级不是经典AGREE条件失效概率，最终由原专家引擎进行正向试算。",
        "保守情景：" + d.conservative.source,
      ],
      tables: [
        {
          heads: [
            "规模",
            "目标",
            "冻结第一轮",
            "所选方案试算 / 95%均值区间",
            "剩余缺口 / pp",
            "保守情景",
            "窗口达标比例 / 95%区间",
          ],
          rows: a.curves.map((r: any) => {
            const s = r.statistics,
              c = a.conservativeCurves.find((c: any) => c.cards === r.cards),
              base = d.baselineCurves.find((b: any) => b.cards === r.cards);
            return [
              scale(r.cards),
              pct(r.target),
              pct(
                result.allocations.find(
                  (allocated: any) => allocated.cards === r.cards,
                )?.current.mean ?? base.statistics.mean,
              ),
              pct(s.mean) + " / " + pct(s.ciLow) + "～" + pct(s.ciHigh),
              n(Math.max(0, r.target - s.mean) * 100),
              c ? pct(c.statistics.mean) : "未启用",
              pct(s.achievementProbability) +
                " / " +
                pct(s.achievementInterval.low) +
                "～" +
                pct(s.achievementInterval.high),
            ];
          }),
        },
      ],
    },
    {
      title: "固定方案、多规模损失与贡献对比",
      visual: "decision-study",
      paragraphs: d.notes,
    },
    {
      title: "备选方案与工作量—收益前沿",
      tables: [
        {
          heads: [
            "方案",
            "参数块/措施数量",
            "工作量评分",
            "名义可用度",
            "保守情景",
            "规划条件",
            "配置选择ID",
          ],
          rows: d.alternatives.map((a: any) => [
            a.label,
            a.factorIds.length,
            n(a.effort),
            pct(a.nominal.statistics.mean),
            a.conservative ? pct(a.conservative.statistics.mean) : "未启用",
            a.feasible ? "本次规划条件满足" : "仍需改进",
            a.id,
          ]),
        },
      ],
      paragraphs: [
        "已评估 " +
          d.search.evaluated +
          " 个组合，上限 " +
          d.search.limit +
          "；" +
          (d.search.method === "enumerated-discrete-pool"
            ? "本离散候选池穷举"
            : "有界子集比较") +
          "，不宣称全局最优。",
        "本次可行组合共同包含：" +
          (d.search.necessary.join("、") || "未识别") +
          "。" +
          d.search.necessaryScope,
      ],
    },
    {
      title: "分配方法与权重依据",
      collapsed: true,
      paragraphs: [
        result.allocations.find((x: any) => x.cards === d.primaryCards)
          .weightBasis,
      ],
      tables: [
        {
          heads: ["方法", "可用状态", "责任预算与当前损失 / h"],
          rows: result.allocations
            .find((x: any) => x.cards === d.primaryCards)
            .comparisons.map((c: any) => [
              c.method,
              c.status === "available" ? "可对照" : c.reason,
              c.result
                ? c.result.items
                    .map(
                      (i: any) =>
                        i.name +
                        " " +
                        n(i.allowedHours) +
                        "/" +
                        n(i.actualHours),
                    )
                    .join("；")
                : "需补充输入",
            ]),
        },
        {
          heads: [
            "措施",
            "重要度",
            "复杂度",
            "权重来源",
            "重要度±20%时AGREE参照预算 / h",
          ],
          rows: d.weightEvidence.map((w: any) => [
            w.name,
            n(w.importance),
            n(w.complexity),
            w.source,
            w.sensitivity.map((v: any) => n(v)).join("～"),
          ]),
        },
      ],
    },
    {
      title: "备选方案参数对照",
      collapsed: true,
      paragraphs: [
        "数值单位沿用参数路径；未调整表示该备选保持冻结现状。独立评估使用所选备选的完整configuration。",
      ],
      tables: [
        {
          heads: ["参数路径", ...d.alternatives.map((a: any) => a.label)],
          rows: [...parameters].map(([path, values]) => [
            path,
            ...d.alternatives.map((a: any) => values.get(a.id) ?? "未调整"),
          ]),
        },
      ],
    },
    {
      title: "工程边界、单类杠杆与待验证证据",
      collapsed: true,
      tables: [
        {
          heads: ["责任预算约束", "下限 / h", "上限 / h", "锁定 / h", "依据"],
          rows: Object.entries(d.settings?.budgetBounds ?? {}).map(
            ([id, b]: [string, any]) => [
              id,
              n(b.min),
              n(b.max),
              n(b.locked),
              b.source,
            ],
          ),
        },
        {
          heads: ["成本资料", "a", "b", "依据"],
          rows: Object.entries(d.settings?.costs ?? {}).map(
            ([id, c]: [string, any]) => [id, n(c.a), n(c.b), c.source],
          ),
        },
        {
          heads: ["单类试算", "可用度", "目标", "仍需减少 / h", "解释"],
          rows: d.leverDiagnostics.map((l: any) => [
            l.name,
            pct(l.row.statistics.mean),
            pct(d.target),
            n(l.gapHours),
            "仅所列参数点，不是理论上界",
          ]),
        },
        {
          heads: ["参数路径", "现状", "下限", "上限", "锁定值", "来源"],
          rows: d.constraints.map((b: any) => [
            b.path,
            n(b.current),
            n(b.min),
            n(b.max),
            n(b.locked),
            b.source,
          ]),
        },
        {
          heads: ["措施", "依赖工程假设的字段", "来源"],
          rows: d.assumptionGaps.map((g: any) => [
            g.name,
            g.fields.join("、"),
            g.source,
          ]),
        },
      ],
    },
  ];
}

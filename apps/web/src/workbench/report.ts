import {
  allocationMethodInfo,
  evidenceStateNames,
  faultKindNames,
  lossPerEvent,
  measureScaleStudy,
  type Analysis,
  type CoreModel,
  type VerificationResult,
} from "../../../../packages/core/src/index";
import { measureCurveSvg } from "./measure-curve";
import { effectText } from "./helpers";
import {
  count,
  duration,
  fit,
  hours,
  percent,
  points,
  saveFile,
  scale,
  times,
} from "./format";

const escape = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const table = (head: string[], rows: unknown[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>`;

/** 生成可离线打开的四步报告；数值与界面取自同一份解析结果。 */
export function buildReport(
  title: string,
  model: CoreModel,
  analysis: Analysis,
  verification: VerificationResult | null,
) {
  const { scenario } = model,
    {
      baseline,
      design,
      allocation,
      baselineGaps,
      designGaps,
      contributions,
      recommendation,
    } = analysis,
    method = allocationMethodInfo[allocation.method],
    enabled = model.measures.filter((m) => m.enabled),
    study = measureScaleStudy(model);
  const usage = (value: number) =>
    value <= 1 ? "占用 " + percent(value, 0) : "超预算 " + times(value);
  const verdict = !verification
    ? "尚未对当前参数运行独立验证。"
    : verification.verdict === "pass"
      ? "独立仿真验证通过。"
      : verification.verdict === "warn"
        ? "独立仿真数值达标，仍有待确认项。"
        : "独立仿真验证未通过。";
  const advice =
    recommendation.kind === "met"
      ? "当前设计已达标。"
      : recommendation.kind === "add"
        ? `建议再启用：${recommendation.add
            .map((id) => model.measures.find((m) => m.id === id)?.name ?? id)
            .join("、")}，可达到 ${percent(recommendation.availability)}。`
        : `当前搜索到的组合为 ${percent(recommendation.ceiling)}，尚未满足全部目标；仅按系统均值估算还需把全部故障率或单次损失再降低 ${percent(recommendation.furtherReduction, 0)}。`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(title)} · 可用度设计报告</title>
<style>
body{font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#101828;max-width:1040px;margin:40px auto;padding:0 24px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 8px;padding-top:16px;border-top:1px solid #e4e7ec}
p{margin:8px 0}small,.muted{color:#344961}.curves{display:grid;grid-template-columns:1fr;gap:16px}.curves svg{width:100%;fill:#142d48}article{break-inside:avoid;margin:24px 0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13.5px}th,td{padding:7px 10px;border-bottom:1px solid #e4e7ec;text-align:left;vertical-align:top}
th{color:#475467;font-weight:600;background:#f8f9fb}td:not(:first-child){font-variant-numeric:tabular-nums}
.kpis{display:flex;gap:16px;margin:20px 0}.kpis div{flex:1;padding:14px 16px;border:1px solid #e4e7ec;border-radius:10px}
.kpis strong{display:block;font-size:26px}.formula{font-family:ui-monospace,Menlo,Consolas,monospace;background:#f8f9fb;padding:8px 12px;border-radius:6px;margin:8px 0}
@media print{body{margin:0}}
</style></head><body>
<h1>${escape(title)}</h1>
<p class="muted">可用度设计报告 · ${escape(new Date().toLocaleString("zh-CN"))} · ${escape(scale(scenario.cards))} · 窗口 ${scenario.hours} 小时 · 目标 ${percent(scenario.target)}</p>
<div class="kpis">
<div><small>现状</small><strong>${percent(baseline.system.availability)}</strong><small>距目标 ${points(baseline.system.availability - scenario.target)}</small></div>
<div><small>设计后（解析）</small><strong>${percent(design.system.availability)}</strong><small>距目标 ${points(design.system.availability - scenario.target)}</small></div>
<div><small>设计后（仿真）</small><strong>${verification ? percent(verification.design.mean) : "—"}</strong><small>${verification ? `95% 区间 ${percent(verification.design.interval[0])}–${percent(verification.design.interval[1])}` : "未验证"}</small></div>
</div>
<p><strong>结论：</strong>${escape(verdict)}${escape(advice)}</p>
<p class="muted">${escape(model.source)}</p>

<h2>1　目标分配（${escape(method.name)}）</h2>
${
  model.requirements
    ? `<p>已知现状是域级独立评估输入，不能将网络63%与非网络60%同时当作整系统60%。保持FIT、检出率与48小时漏检分支不变，未知中断恢复段按域级约束反求；部件拆分依赖故障库先验，尚不是实测标定。</p>${table(
        [
          "独立评估范围",
          "参考规模已知现状",
          "参考规模固定目标",
          "当前规模现状",
          "当前规模设计后",
        ],
        analysis.requirements.map((d) => [
          d.name,
          d.baselineAvailability === null
            ? "由模型评估"
            : percent(d.baselineAvailability, 5),
          d.targetAvailability === null
            ? "剩余预算分配"
            : percent(d.targetAvailability, 5),
          percent(d.baseline.availability, 5),
          percent(d.design.availability, 5),
        ]),
      )}<p>先冻结网络与供电预算，再分配剩余负荷。规模目标：A*(N)=(1−o)/(1+ρ*×N/Nref)，ρ*=(1−o)/Aref−1。参考规模${model.requirements.referenceCards}卡，Aref=${percent(model.requirements.systemTarget)}，固定公共开销预算o=${percent(model.requirements.overheadBudget, 5)}。不重复放大器件数量或代际倍率。</p>`
    : ""
}
<p>窗口允许的总损失 ${hours(allocation.lossHours)}，其中公共开销 ${hours(allocation.overheadLossHours)}，可分给各模块 ${hours(allocation.failureLossHours)}。系统允许的损失负荷 ρ* = ${allocation.load.toFixed(4)}。</p>
<div class="formula">A = (1 − 公共开销) / (1 + ρ)，ρ = Σ λᵢ·MTTRᵢ；ρᵢ* = wᵢ·ρ*，${escape(method.formula)}</div>
${method.reasoning.map((line) => `<p>· ${escape(line)}</p>`).join("")}
${table(
  [
    "模块",
    "权重",
    "目标可用度",
    "损失预算",
    "提 MTBF：每卡 FIT ≤",
    "降 MTTR：单次损失 ≤",
  ],
  allocation.modules.map((m) => [
    m.name,
    percent(m.weight, 1),
    percent(m.availability),
    hours(m.lossHours),
    m.maxFitPerCard === null ? "—" : fit(m.maxFitPerCard),
    m.maxMttrHours === null ? "—" : duration(m.maxMttrHours),
  ]),
)}

<h2>2　可用度评估（现状）</h2>
<p>周故障频次按连续168小时暴露计算（λ×168）；窗口内实际采样事件会因停机减少，二者分别列出。周损失为168×(1−A)，包含停机、回滚、降速、污染及公共开销的等效产出损失。</p>
${table(
  [
    "差距排序 / 部件",
    "连续暴露次/周",
    "现状周损失",
    "目标周损失",
    "超预算",
    "设计后周损失",
  ],
  [...baselineGaps]
    .sort((a, b) => b.lossHours - b.budgetHours - (a.lossHours - a.budgetHours))
    .map((g, i) => {
      const b = baseline.modules.find((m) => m.id === g.id)!,
        d = design.modules.find((m) => m.id === g.id)!;
      return [
        `${i + 1}. ${b.name}`,
        count(b.rate * 168, 4),
        hours((b.lossHours * 168) / scenario.hours),
        hours((g.budgetHours * 168) / scenario.hours),
        hours(((g.lossHours - g.budgetHours) * 168) / scenario.hours),
        hours((d.lossHours * 168) / scenario.hours),
      ];
    }),
)}
<p>每卡故障率 ${fit(baseline.system.fitPerCard)} FIT，系统 MTBF ${duration(baseline.system.mtbfHours)}，单次等效损失 ${duration(baseline.system.mttrHours)}，窗口内约 ${count(baseline.system.events, 1)} 次故障，损失 ${hours(baseline.system.lossHours)}。</p>
${table(
  [
    "模块",
    "FIT / 卡",
    "MTBF",
    "单次等效损失",
    "可用度",
    "损失时间",
    "预算",
    "差距",
  ],
  baseline.modules.map((m) => {
    const gap = baselineGaps.find((g) => g.id === m.id)!;
    return [
      m.name,
      fit(m.fitPerCard),
      duration(m.mtbfHours),
      duration(m.mttrHours),
      percent(m.availability),
      hours(m.lossHours),
      hours(gap.budgetHours),
      usage(gap.usage),
    ];
  }),
)}
${table(
  [
    "故障模式",
    "模块",
    "类型",
    "单件 FIT",
    "检出率",
    "检测",
    "恢复",
    "回滚重算",
    "漏检损失",
    "单次等效损失",
    "数据来源",
  ],
  model.modes.map((mode) => [
    mode.name,
    model.modules.find((m) => m.id === mode.moduleId)?.name ?? "",
    faultKindNames[mode.kind],
    fit(mode.fit),
    percent(mode.coverage),
    duration(mode.detectHours),
    duration(mode.recoverHours),
    duration(mode.reworkHours),
    duration(mode.missedLossHours),
    duration(lossPerEvent(mode)),
    mode.evidence,
  ]),
)}

<h2>3　机制设计</h2>
<p>已启用 ${enabled.length} 项措施，可用度由 ${percent(baseline.system.availability)} 提升到 ${percent(design.system.availability)}（${points(design.system.availability - baseline.system.availability)}）。贡献按 Shapley 值分摊，各项相加等于总提升。</p>
${table(
  ["措施", "方向", "参数变化", "Shapley 贡献", "单独启用", "证据", "工程依据"],
  enabled.map((m) => {
    const c = contributions.items.find((item) => item.id === m.id)!;
    return [
      m.name,
      m.direction === "mtbf" ? "提升 MTBF" : "降低 MTTR",
      m.effects.map(effectText).join("；") +
        (m.applicability < 1 ? `（适用 ${percent(m.applicability, 0)}）` : ""),
      points(c.shapley),
      points(c.standalone),
      evidenceStateNames[m.evidence],
      m.rationale,
    ];
  }),
)}
<h3>五规模与逐措施收益</h3><p>${escape(study.basis)} 曲线按50万卡单项提升排序；不以Shapley代替单项曲线。组合Shapley的基准是未启用候选改进的冻结现状。</p>
${table(
  ["规模", "目标", "周损失预算", "现状", "组合", "组合周损失"],
  study.rows.map((r) => [
    scale(r.cards),
    percent(r.target, 4),
    hours(r.targetLossHours),
    percent(r.baseline, 4),
    percent(r.combination, 4),
    hours(r.combinationLossHours),
  ]),
)}
${study.measures
  .map(
    (m, i) =>
      `<article><h3>${i + 1}. ${escape(m.name)} · ${m.direction === "mtbf" ? "提升MTBF" : "降低MTTR"}</h3><p>50万卡单项增益 ${points(m.points.at(-1)!.gainPp / 100)}，周减损 ${hours(m.points.at(-1)!.savedHours)}。</p><div class="curves">${measureCurveSvg(m)}</div><details><summary>准确数值</summary>${table(
        ["规模", "目标", "现状", "仅优化该项", "增益pp", "周损失", "周减损"],
        m.points.map((p) => [
          scale(p.cards),
          percent(p.target, 4),
          percent(p.baseline, 4),
          percent(p.availability, 4),
          p.gainPp.toFixed(4),
          hours(p.lossHours),
          hours(p.savedHours),
        ]),
      )}</details></article>`,
  )
  .join("")}
${table(
  ["模块", "现状损失", "设计后损失", "预算", "设计后可用度", "设计后与预算"],
  design.modules.map((m) => {
    const gap = designGaps.find((g) => g.id === m.id)!;
    return [
      m.name,
      hours(baseline.modules.find((b) => b.id === m.id)!.lossHours),
      hours(m.lossHours),
      hours(gap.budgetHours),
      percent(m.availability),
      usage(gap.usage),
    ];
  }),
)}

<h2>4　机制验证</h2>
${
  verification?.scales
    ? table(
        [
          "规模",
          "目标",
          "仿真均值",
          "95%均值区间",
          "周损失",
          "窗口达标比例",
          "结论",
        ],
        verification.scales.map((s) => [
          scale(s.cards),
          percent(s.target, 4),
          percent(s.mean, 4),
          `${percent(s.interval[0], 4)}–${percent(s.interval[1], 4)}`,
          hours(s.weeklyLossHours),
          percent(s.passRatio, 1),
          s.met ? "通过" : "未通过",
        ]),
      )
    : ""
}
${
  verification?.domains
    ? table(
        ["规模", "独立范围", "目标", "仿真均值", "区间下限", "结论"],
        verification.domains.map((d) => [
          scale(d.cards),
          d.name,
          percent(d.target, 5),
          percent(d.mean, 5),
          percent(d.interval[0], 5),
          d.met ? "通过" : "未通过",
        ]),
      )
    : ""
}
${
  verification
    ? `<p>${count(verification.trials)} 个仿真窗口，随机种子 ${verification.seed}，${escape(new Date(verification.createdAt).toLocaleString("zh-CN"))}。达到目标的窗口占 ${percent(verification.design.passRatio, 1)}；第 5 百分位窗口 ${percent(verification.design.p05)}。</p>
${table(
  ["判定", "结果", "说明"],
  verification.checks.map((c) => [
    c.title,
    c.state === "pass" ? "通过" : c.state === "warn" ? "待确认" : "未通过",
    c.detail,
  ]),
)}
${table(
  ["模块", "仿真损失", "解析损失", "分配预算", "结论"],
  verification.modules.map((m) => [
    m.name,
    hours(m.simulatedLossHours),
    hours(m.analyticLossHours),
    hours(m.budgetHours),
    m.withinBudget ? "预算内" : "超出",
  ]),
)}`
    : "<p>尚未对当前参数运行独立验证，以上“设计后”结果仅为解析评估。</p>"
}
<p class="muted">说明：置信区间只反映随机抽样误差，不包含故障率与恢复参数本身的不确定性。标为“设计假设”或“已立项待验证”的措施，其参数需由工程实测确认。</p>
</body></html>`;
}

export function downloadReport(
  title: string,
  model: CoreModel,
  analysis: Analysis,
  verification: VerificationResult | null,
) {
  saveFile(
    title + "-可用度设计报告.html",
    buildReport(title, model, analysis, verification),
    "text/html;charset=utf-8",
  );
}

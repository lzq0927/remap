import type { TopologyDecision } from "../../analysis/src/audit-topology-decision";
import { esc } from "./audit-decision-pages";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";

type Stage = TopologyDecision["scales"][number]["scenarios"][number];
export const benefitMeasures = [
  {
    id: "fit",
    name: "M1 故障源治理",
    category: "增加 MTBF · 降低频率",
    current: "",
    path: "全部故障损失",
  },
  {
    id: "redundancy",
    name: "M2 冗余 / 副本级弹性",
    category: "增加 MTBF · 阻止中断传播",
    current: "",
    path: "停机 / 局部降容",
  },
  {
    id: "policy:D-HARD",
    name: "M3 中断检测",
    category: "降低 MTTR · 检测",
    current: "hardDetect",
    path: "停机",
  },
  {
    id: "model:recovery",
    name: "M4/M8 恢复与失败升级",
    category: "降低 MTTR · 恢复",
    current: "",
    path: "停机 / 回滚",
  },
  {
    id: "policy:C-FAST",
    name: "M5 异步检查点",
    category: "降低等效 MTTR · 回滚 / 开销",
    current: "fast",
    path: "回滚 / 保存",
  },
  {
    id: "policy:D-SDC",
    name: "M6 静默错误检出",
    category: "降低等效 MTTR · 检测",
    current: "sdcDetect",
    path: "回滚 / 污染",
  },
  {
    id: "model:silent",
    name: "M6 漏检后排查",
    category: "降低等效 MTTR · 检测",
    current: "",
    path: "回滚 / 污染",
  },
  {
    id: "policy:D-SLOW",
    name: "M7 亚健康检测",
    category: "降低等效 MTTR · 检测",
    current: "slowDetect",
    path: "降速",
  },
];
const modelKeys = [
  "recoveryAttemptSeconds",
  "recoverySuccess",
  "manualAdditionalSeconds",
  "timeoutSeconds",
  "slowLifetimeHours",
  "slowLoss",
  "sdcDelayHours",
  "validationOverhead",
  "checkpointDurableLagSeconds",
  "sdcDelayDistribution",
  "terminalRule",
  "sdcImmediateProbability",
];
const equal = (a: any, b: any): boolean => {
  if (typeof a === "number" && typeof b === "number")
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (a && b && typeof a === "object" && typeof b === "object")
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) =>
      equal(a[k], b[k]),
    );
  return a === b;
};
/** A title is not provenance: a study must use this frozen source and reproduce the target parameters and FIT. */
export function matchesBenefitStudy(study: any, baseline: any, target: any) {
  if (
    !baseline.id ||
    !baseline.inputHash ||
    study.kind !== "expert-audit-experiment" ||
    study.sourceRunId !== baseline.id ||
    study.sourceInputHash !== baseline.inputHash
  )
    return false;
  const config = study.configuration,
    source = baseline.configuration,
    end = target.configuration;
  if (!config || !source || !end) return false;
  const supported = new Set(benefitMeasures.map((m) => m.id));
  if (
    study.attribution?.some((a: any) =>
      a.contributions.some((c: any) => !supported.has(c.id)),
    )
  )
    return false;
  if (
    !equal(
      study.architectureDiagnosis?.architecture ??
        baseline.architectureDiagnosis?.architecture,
      target.architectureDiagnosis?.architecture,
    )
  )
    return false;
  const policyKeys = [
    ...new Set([
      ...Object.keys(source.policy ?? {}),
      ...Object.keys(config.policy ?? {}),
      ...Object.keys(end.policy ?? {}),
    ]),
  ];
  if (
    !policyKeys.every((k) =>
      equal({ ...source.policy?.[k], ...config.policy?.[k] }, end.policy?.[k]),
    )
  )
    return false;
  const model = { ...source.model, ...config.model };
  if (!modelKeys.every((k) => equal(model[k], end.model?.[k]))) return false;
  const targets = new Map(
    (config.fitTargets ?? []).map((e: any) => [e.id, e.fit]),
  );
  if (
    !baseline.events?.length ||
    baseline.events.length !== target.events?.length
  )
    return false;
  return baseline.events.every((e: any) => {
    const other = target.events.find((v: any) => v.id === e.id);
    return other && equal(targets.get(e.id) ?? e.fit, other.fit);
  });
}
export type BenefitCell = {
  pp: number | null;
  low?: number;
  high?: number;
  status: "measured" | "unchanged" | "missing";
  note: string;
};
export function mechanismBenefitMatrix(result: any) {
  const entries: any[] =
    result.entries ??
    (result.kind === "expert-audit"
      ? [
          {
            ...result,
            configuration: result.configuration ?? result.config,
            trainingScenario: result.request?.trainingScenario ?? {
              id: "current",
            },
          },
        ]
      : []);
  const current =
    entries.find((e) => e.trainingScenario?.id === "current") ?? entries[0];
  const scales: number[] = [10000, 100000, 200000, 500000];
  const stages = ["current", "extension", "breakthrough"].map((id, i) => {
    const entry = entries.find((e) => e.trainingScenario?.id === id);
    const study =
      entry && current && i > 0
        ? (result.mechanismStudies ?? []).find((s: any) =>
            matchesBenefitStudy(s, current, entry),
          )
        : undefined;
    const source = i === 0 ? entry : study;
    const cells: BenefitCell[][] = benefitMeasures.map((m) =>
      scales.map((cards) => {
        const attr = source?.attribution?.find((a: any) => a.cards === cards);
        const c = attr?.contributions.find(
          (c: any) => c.id === (i === 0 ? m.current : m.id),
        );
        if (c && Number.isFinite(c.statistics?.mean))
          return {
            pp: c.statistics.mean * 100,
            low: c.statistics.ciLow * 100,
            high: c.statistics.ciHigh * 100,
            status: "measured",
            note: "独立配对归因；区间仅含采样误差",
          };
        if (
          attr &&
          i > 0 &&
          m.id === "fit" &&
          !study.configuration.fitTargets?.length
        )
          return {
            pp: 0,
            status: "unchanged",
            note: "与冻结现状使用相同FIT，未增加此项改进",
          };
        return {
          pp: null,
          status: "missing",
          note:
            m.id === "redundancy"
              ? "候选机制尚未单独验证，不领取收益"
              : "未保存与此阶段参数和基线一致的独立归因",
        };
      }),
    );
    return {
      id,
      name: ["现状", "延长线改进", "突破性改进"][i],
      basis:
        i === 0 ? "已有措施贡献 · 相对本轮固定基线" : "改进增量 · 相对冻结现状",
      sourceId: source?.id ?? study?.sourceRunId ?? null,
      cells,
      gains: scales
        .map(
          (cards) =>
            source?.attribution?.find((a: any) => a.cards === cards)?.gain *
            100,
        )
        .map((v) => (Number.isFinite(v) ? v : null)),
    };
  });
  const ceiling = Math.max(
    5,
    Math.ceil(
      Math.max(
        0,
        ...stages.flatMap((s) =>
          s.cells.flat().map((c) => Math.abs(c.pp ?? 0)),
        ),
      ) / 5,
    ) * 5,
  );
  return { scales, rows: benefitMeasures, stages, ceiling };
}
export function benefitFill(pp: number | null, ceiling: number) {
  if (pp === null) return "#f1f3f5";
  const t = Math.sqrt(Math.min(1, Math.abs(pp) / Math.max(ceiling, 1)));
  const a = pp >= 0 ? [241, 247, 253] : [255, 241, 243];
  const b = pp >= 0 ? [89, 153, 205] : [220, 133, 105];
  return (
    "#" +
    a
      .map((v, i) =>
        Math.round(v + (b[i] - v) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function mechanismBenefitHtml(result: any, cards: number) {
  const m = mechanismBenefitMatrix(result),
    split = (parts: string[]) =>
      parts.join('<td class="analysis-stage-gap" aria-hidden="true"></td>');
  const column = m.scales.indexOf(cards),
    last = m.stages[2];
  const order = m.rows
    .map((row, i) => ({ row, i, value: last.cells[i][column]?.pp }))
    .filter((v) => v.value != null)
    .sort((a, b) => b.value! - a.value!);
  const ranks = new Map(order.map((v, i) => [v.i, i + 1]));
  return `<section class="analysis-card" data-analysis-section="benefits"><h3>措施收益热力图 · Shapley 分摊 / pp</h3><p>横向每块均为万卡、十万卡、二十万卡、50万卡；纵向固定为相同措施。蓝色表示正收益，粉橙表示负收益，数值为可用度百分点（pp）。</p><div class="analysis-table-scroll"><table class="analysis-benefit-matrix" aria-label="三阶段四规模措施收益热力图"><thead><tr><th rowspan="2" scope="col">可靠性措施 / 分类<br/><small>序号：当前所选规模突破收益排名</small></th>${m.stages.map((s, i) => `${i ? '<th rowspan="2" class="analysis-stage-gap" aria-hidden="true"></th>' : ""}<th colspan="4" scope="colgroup">${s.name}<small>${s.basis}</small></th>`).join("")}</tr><tr>${m.stages.map(() => m.scales.map((c) => `<th scope="col">${c / 10000}万卡</th>`).join("")).join("")}</tr></thead><tbody>${m.rows.map((r, i) => `<tr data-benefit-measure="${r.id}"><th scope="row">${ranks.has(i) ? `<b class="analysis-rank">${ranks.get(i)}</b>` : ""}${r.name}<small>${r.category} → ${r.path}</small></th>${split(m.stages.map((s) => s.cells[i].map((c, j) => `<td data-benefit-stage="${s.id}" data-benefit-cards="${m.scales[j]}" data-benefit-pp="${c.pp ?? ""}" data-benefit-status="${c.status}" style="background:${benefitFill(c.pp, m.ceiling)}" title="${esc(s.basis)}；${esc(c.note)}${c.low == null ? "" : `；95% [${num(c.low, 3)}, ${num(c.high, 3)}] pp`}">${c.pp == null ? "—" : `${c.pp > 0 ? "+" : ""}${num(c.pp, 3)}`}</td>`).join("")))}</tr>`).join("")}<tr class="analysis-total-row"><th>本研究组合收益<small>每列所评估因子之和</small></th>${split(m.stages.map((s) => s.gains.map((v) => `<td>${v == null ? "—" : `${v > 0 ? "+" : ""}${num(v, 3)}`}</td>`).join("")))}</tr></tbody></table></div><div class="analysis-heat-legend"><b>正收益 pp</b>${[
    0,
    0.5,
    2,
    5,
    10,
    m.ceiling,
  ]
    .filter((v, i, a) => a.indexOf(v) === i && v <= m.ceiling)
    .map(
      (v) =>
        `<span style="background:${benefitFill(v, m.ceiling)}">${num(v)}</span>`,
    )
    .join(
      "",
    )}<span>三块共用 √(pp / ${m.ceiling}) 色尺</span></div><p class="analysis-note"><b>归因基线不同：</b>现状衡量已有所选措施相对原固定基线的贡献；后两块衡量相对冻结现状的改进增量。不能跨块相加或相减。0 表示在该基线下无增量；— 表示未独立评估，不能视为无效。现状部分能力已存在于基线，因此其边际贡献为0。</p><p class="analysis-note">延长线/突破研究按来源快照、参数及逐事件FIT匹配，使用独立配对采样；组合增量与主评估跨档差值可能不同。悬停查看95%采样区间；区间重叠时不强判排名。M2须另做冗余、备用耗尽与共因验证，已有光模块保护不能重复领取收益。</p>${
    order.length
      ? `<p class="analysis-priority"><b>${cards / 10000}万卡突破收益优先级：</b>${order
          .slice(0, 4)
          .map((v) => `${v.row.name} +${num(v.value, 2)} pp`)
          .join(" → ")}</p>`
      : ""
  }</section>`;
}

const finite = (v: any): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
/** Conditional hard-interruption chain. Not a substitute for the DES ledger or equivalent MTTR. */
export function recoveryEvolution(d: TopologyDecision, cards: number) {
  const scale = d.scales.find((s) => s.cards === cards);
  return (scale?.scenarios ?? []).map((s: Stage) => {
    const p = s.configuration?.policy ?? {},
      m = s.configuration?.model ?? {},
      root = s.nodes.find((n) => n.id === "system")!;
    const coverage = finite(p["D-HARD"]?.coverage ?? m.detectProbability),
      detect = finite(p["D-HARD"]?.detectSeconds ?? m.detectSeconds),
      timeout = finite(m.timeoutSeconds);
    const attempt = finite(m.recoveryAttemptSeconds),
      success = finite(m.recoverySuccess),
      manual = finite(m.manualAdditionalSeconds);
    const detection =
      coverage != null && detect != null && timeout != null
        ? coverage * detect + (1 - coverage) * timeout
        : null;
    const escalation =
      success != null && manual != null ? (1 - success) * manual : null;
    return {
      name: s.name,
      coverage,
      detect,
      timeout,
      attempt,
      success,
      manual,
      detection,
      escalation,
      total:
        detection != null && attempt != null && escalation != null
          ? detection + attempt + escalation
          : null,
      mtbfMinutes: root.mtbfHours == null ? null : root.mtbfHours * 60,
      equivalentMttrSeconds: root.mttrSeconds,
      targetMttrSeconds: root.targetMttrSeconds,
      sdcCoverage: finite(p["D-SDC"]?.coverage),
      sdcDetect: finite(p["D-SDC"]?.detectSeconds),
      sdcDelayHours: finite(m.sdcDelayHours),
      slowCoverage: finite(p["D-SLOW"]?.coverage),
      slowDetect: finite(p["D-SLOW"]?.detectSeconds),
      checkpoint: finite(
        p["C-FAST"]?.computeSeconds ?? m.checkpointComputeSeconds,
      ),
      save: finite(p["C-FAST"]?.saveSeconds ?? m.checkpointSaveSeconds),
    };
  });
}
export function recoveryEvolutionHtml(d: TopologyDecision, cards: number) {
  const stages = recoveryEvolution(d, cards);
  const maximum = Math.max(1, ...stages.map((s) => s.total ?? 0)),
    first = stages[0],
    last = stages.at(-1);
  const colors = ["#6b94b8", "#367cab", "#c68a70"];
  const parameters: { label: string; values: string[] }[] = [
    {
      label: "M1 增加MTBF · 全系统中断间隔",
      values: stages.map((s) => `${num(s.mtbfMinutes, 3)} min`),
    },
    {
      label: "M3 检测 · 检出率 / 耗时",
      values: stages.map((s) => `${pct(s.coverage)} / ${num(s.detect, 3)} s`),
    },
    {
      label: "M4 恢复 · 尝试时长 / 成功率",
      values: stages.map((s) => `${num(s.attempt, 3)} s / ${pct(s.success)}`),
    },
    {
      label: "M8 失败升级 · 额外人工时间",
      values: stages.map((s) => `${num(s.manual, 0)} s（失败时）`),
    },
    {
      label: "M5 检查点 · 周期 / 保存阻塞",
      values: stages.map(
        (s) => `${num(s.checkpoint, 3)} / ${num(s.save, 3)} s`,
      ),
    },
    {
      label: "M6 静默检测 · 检出率 / 耗时 / 漏检排查",
      values: stages.map(
        (s) =>
          `${pct(s.sdcCoverage)} / ${num(s.sdcDetect, 2)} s / ${num(s.sdcDelayHours, 0)} h`,
      ),
    },
    {
      label: "M7 亚健康 · 检出率 / 耗时",
      values: stages.map(
        (s) => `${pct(s.slowCoverage)} / ${num(s.slowDetect, 3)} s`,
      ),
    },
  ];
  return `<section class="analysis-card" data-analysis-section="parameters"><h3>参数如何缩短时间 · MTBF 与 MTTR 分开看</h3><p>增加MTBF：M1降低故障频率，M2用冗余抑制故障向作业中断传播。降低MTTR：M3/M6/M7加快检测，M4/M8加快恢复；M5减少回滚和保存开销，改善全损失等效MTTR。</p><figure class="analysis-recovery-bars" aria-label="单次中断期望恢复链"><figcaption><b>单次中断期望链 / 秒</b> · 同一线性时间轴，0–${num(maximum, 3)} s</figcaption>${stages.map((s) => `<div class="analysis-recovery-row"><b>${esc(s.name)}</b><div class="analysis-recovery-track">${[s.detection, s.attempt, s.escalation].map((v, i) => (v == null ? "" : `<i style="width:${(100 * v) / maximum}%;background:${colors[i]}" title="${["检测期望", "恢复尝试", "失败升级期望"][i]} ${num(v, 3)} s"></i>`)).join("")}</div><strong>${num(s.total, 3)} s</strong><small>检测 ${num(s.detection, 3)} + 恢复 ${num(s.attempt, 3)} + 失败升级 ${num(s.escalation, 3)}</small></div>`).join("")}</figure><div class="analysis-loss-key">${colors.map((c, i) => `<span><i style="background:${c}"></i>${["检测：p×检测耗时 + (1−p)×超时", "恢复：每次尝试耗时", "升级：(1−成功率)×额外人工耗时"][i]}</span>`).join("")}</div>${first?.total != null && last?.total != null ? `<p class="analysis-priority">现状 → ${esc(last.name)}：单次期望链减少 <b>${num(first.total - last.total, 3)} s（${pct(1 - last.total / first.total)}）</b>。当前突破链 ${num(last.detection, 3)} + ${num(last.attempt, 3)} + ${num(last.escalation, 3)} = ${num(last.total, 3)} s。</p>` : ""}<p class="analysis-note">这是工程参数的条件期望，未计回滚、并发停机重叠与600小时窗口裁剪。失败升级的平均占用不是人工修复上限；恢复链15秒等参数仍待工程验证。</p><div class="analysis-equivalent">${stages.map((s) => `<div><span>${esc(s.name)} · 全损失等效MTTR</span><b>${num(s.equivalentMttrSeconds, 3)} s</b><small>本阶段MTBF条件预算 ${num(s.targetMttrSeconds, 3)} s</small></div>`).join("")}</div><p class="analysis-note">等效MTTR = MTBF × (1−A) / A，由逐事件损失账换算，含停机、回滚、降速、污染及开销，不能当作物理维修时间。条件预算只用于对照目标，不写入仿真。</p><div class="analysis-table-scroll"><table class="analysis-parameter-evolution" aria-label="三阶段机制参数演进"><thead><tr><th>措施 / 生效参数</th>${stages.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr></thead><tbody>${parameters.map((p) => `<tr><th>${p.label}</th>${p.values.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="analysis-note">检查点1秒、保存阻塞0秒为采用的情景假设；仍需验证持久化滞后、恢复带宽和状态可信。M2新增冗余、备用池与副本恢复需独立验证，其收益未计入上述参数。</p></section>`;
}

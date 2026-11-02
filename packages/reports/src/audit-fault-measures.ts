import type { TopologyDecision } from "../../analysis/src/audit-topology-decision";
import study from "../../../references/remap-studies/2026-11-01-measure-necessity-50w.json";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";
import { esc } from "./audit-decision-pages";
import { measureRankingHtml } from "./audit-measure-ranking";

const fields = [
  "downtime",
  "rollback",
  "slowdown",
  "localLoss",
  "terminalInvalid",
];
const entryFor = (result: any, name: string) =>
  result.entries?.find((e: any) => e.name === name);
const rowFor = (entry: any, cards: number) =>
  entry?.rows?.find(
    (r: any) => r.cards === cards && (!r.id || r.id === "combined"),
  );
const canonical = (value: any): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, v[key]]),
        )
      : v,
  );

/** Frozen evidence is displayed only for the exact parameter/FIT snapshot and scale. */
export function matchedMeasureNecessity(
  entry: any,
  cards: number,
  hours: number,
  baseline: any,
) {
  const row = rowFor(entry, cards);
  if (
    baseline?.inputHash !== study.baselineInputHash ||
    canonical(baseline?.configuration) !==
      canonical(study.baselineConfiguration)
  )
    return null;
  if (
    !row ||
    cards !== study.cards ||
    hours !== study.hours ||
    entry.inputHash !== study.targetInputHash
  )
    return null;
  if (canonical(entry.configuration) !== canonical(study.targetConfiguration))
    return null;
  const events = (row.scaleEvents ?? entry.events ?? []).map((e: any) => [
    e.id,
    e.type,
    e.fit,
  ]);
  const sorted = (v: any[]) =>
    [...v].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (canonical(sorted(events)) !== canonical(sorted(study.targetEvents)))
    return null;
  const mean = row.statistics?.mean ?? row.availability;
  if (
    typeof mean !== "number" ||
    !Number.isFinite(mean) ||
    Math.abs(mean - study.targetAvailability) > 1e-12
  )
    return null;
  return study;
}

export function faultMeasureComparison(
  result: any,
  d: TopologyDecision,
  cards: number,
) {
  const stages = d.scales.find((s) => s.cards === cards)?.scenarios;
  const current = stages?.find((s) => s.trainingScenario?.id === "current");
  const target = stages?.find((s) => s.trainingScenario?.id === "breakthrough");
  if (!current || !target) return null;
  const source = entryFor(result, current.name),
    dest = entryFor(result, target.name);
  const before = rowFor(source, cards),
    after = rowFor(dest, cards);
  if (!before?.perEvent || !after?.perEvent) return null;
  const events = new Map<string, any>(
    (source.events ?? []).map((e: any) => [e.id, e]),
  );
  const loss = (v: any) => fields.reduce((s, key) => s + (v?.[key] ?? 0), 0);
  const ids = new Set([
    ...events.keys(),
    ...Object.keys(before.perEvent),
    ...Object.keys(after.perEvent),
  ]);
  const modes = [...ids]
    .map((id) => {
      const a = before.perEvent[id] ?? {},
        b = after.perEvent[id] ?? {},
        event = events.get(id);
      return {
        id,
        description: event?.description ?? id,
        type: event?.type,
        before: loss(a),
        after: loss(b),
        beforeDown: a.downtime ?? 0,
        afterDown: b.downtime ?? 0,
        beforeRollback: a.rollback ?? 0,
        afterRollback: b.rollback ?? 0,
      };
    })
    .sort((a, b) => b.before - a.before || a.id.localeCompare(b.id));
  const currentManual = current.configuration?.model?.manualAdditionalSeconds;
  const targetManual = target.configuration?.model?.manualAdditionalSeconds;
  const success = target.configuration?.model?.recoverySuccess;
  const manualWeightedSavingSeconds =
    [currentManual, targetManual, success].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) &&
    success >= 0 &&
    success <= 1
      ? (currentManual - targetManual) * (1 - success)
      : null;
  return {
    current,
    target,
    modes,
    currentManual,
    targetManual,
    success,
    manualWeightedSavingSeconds,
    necessity: matchedMeasureNecessity(dest, cards, d.hours, source),
  };
}

export function faultMeasureClosureHtml(
  result: any,
  d: TopologyDecision,
  cards: number,
) {
  const data = faultMeasureComparison(result, d, cards);
  if (!data) return "";
  const { current, target, modes, necessity } = data;
  const root = target.nodes.find((n) => n.id === "system")!;
  const cp = current.configuration?.policy ?? {},
    tp = target.configuration?.policy ?? {};
  const actions: Record<string, string> = {
    sdc: "① 静默故障检测＋② 极致CKPT；正确性校验、污染追溯和可信状态回退",
    hard: "② 极致CKPT＋③ Agent人工处置（仅自动失败）；同时进行FIT治理和快速自动恢复",
    slow: "亚健康检测、定位、隔离与受控降容",
  };
  const targetMet =
    root.allowedHours != null && root.actualHours <= root.allowedHours;
  const definitions = [
    {
      id: "sdc_detection",
      name: "① 静默故障检测",
      tag: "改进已有 · 正确性检测",
      parameter: `检出率 ${pct(cp["D-SDC"]?.coverage, 2)} → ${pct(tp["D-SDC"]?.coverage, 2)}`,
      scope:
        "作用于CORE等静默错算，主要降低污染回退损失；检测耗时与漏检追溯参数分别验收。",
    },
    {
      id: "checkpoint",
      name: "② 极致CKPT",
      tag: "改进已有 · 回滚 / 保存",
      parameter: `周期/阻塞 ${num(cp["C-FAST"]?.computeSeconds)}/${num(cp["C-FAST"]?.saveSeconds)}s → ${num(tp["C-FAST"]?.computeSeconds)}/${num(tp["C-FAST"]?.saveSeconds)}s`,
      scope:
        "异步/分层保存、内存暂存与恢复读取协同；低前台阻塞仍须验证持久化滞后与可恢复性。",
    },
    {
      id: "agent_manual",
      name: "③ 智能故障分析Agent",
      tag: "新增建议 · 人工处置",
      parameter: `人工追加 ${num(data.currentManual == null ? null : data.currentManual / 3600)}h → ${num(data.targetManual == null ? null : data.targetManual / 3600)}h`,
      scope: `遥测汇聚、根因候选、定界和恢复预案；固定自动成功率${pct(data.success, 1)}，期望人工耗时每次减少${num(data.manualWeightedSavingSeconds, 2)}s。此预算需逐模式实测，自动恢复链另计。`,
    },
  ];
  const maxLoss = necessity
    ? Math.max(...necessity.results.map((r) => r.loss))
    : 1;
  const complete = necessity?.results.find((r) => r.id === "target");
  const cardsHtml = definitions
    .map((m) => {
      const test = necessity?.results.find((r) => r.id === m.id);
      const delta = test?.conditionalSaving;
      const bars =
        test && complete && delta
          ? `<div class="measure-conditional" data-measure-ablation="${m.id}"><p>仅此项保留现状：${pct(test.availability, 3)} / ${num(test.loss, 3)}h<br/>完整突破：${pct(complete.availability, 3)} / ${num(complete.loss, 3)}h</p><div class="measure-conditional-track"><i style="width:${(100 * test.loss) / maxLoss}%;background:#d78261"></i></div><div class="measure-conditional-track"><i style="width:${(100 * complete.loss) / maxLoss}%;background:#175b8f"></i></div><b>净减损 ${num(delta.mean, 3)}h</b>${m.id === "agent_manual" ? `<small>其中停机减少 ${num(test.ledgerSaving?.downtime.mean, 3)}h</small>` : ""}</div>`
          : "<small>此快照未匹配独立单项回退核查；不沿用其他规模/参数的收益。</small>";
      return `<article><h4>${m.name}</h4><small>${m.tag}</small><strong>${esc(m.parameter)}</strong><p>${esc(m.scope)}</p>${bars}</article>`;
    })
    .join("");
  return `<section class="analysis-card analysis-fault-measures" data-target-status="${targetMet ? "met" : "gap"}"><h3>TOP故障 → 重点措施 → 可用度目标</h3><p class="analysis-priority">${esc(target.name)}：A ${pct(root.availability, 3)} / 目标 ${pct(root.target, 3)}；损失 ${num(root.actualHours, 3)}h / 预算 ${num(root.allowedHours, 3)}h。${targetMet ? "模型均值达标，参数需工程验收。" : "当前组合尚未满足总损失预算。"}</p><div class="analysis-table-scroll"><table><thead><tr><th>现状TOP源故障模式</th><th>对应具体措施</th><th>停机h · 前→后</th><th>回滚h · 前→后</th><th>总损失h · 前→后</th></tr></thead><tbody>${modes
    .slice(0, 5)
    .map(
      (r, i) =>
        `<tr data-top-fault="${esc(r.id)}"><th>${i + 1}. ${esc(r.id)}<small>${esc(r.description)}</small></th><td>${actions[r.type] ?? "需补全故障分类及恢复路径"}</td><td>${num(r.beforeDown, 3)} → ${num(r.afterDown, 3)}</td><td>${num(r.beforeRollback, 3)} → ${num(r.afterRollback, 3)}</td><td><b>${num(r.before, 3)} → ${num(r.after, 3)}</b></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p class="analysis-note">表中前后为现状与突破两套组合，总损失还包含污染等账项；行内减损不能全部归给一项措施。停机、回滚与污染不混称为中断时长。</p><div class="analysis-named-measures">${cardsHtml}</div><p class="analysis-note">${necessity ? `本快照的三项回退核查均固定其余突破参数，${necessity.n}条同种子配对轨迹，完整突破端点精确复现。条形共用线性小时尺度；条件减损有交互，不可相加，不替代Shapley分摊。` : "组合达成结果与单项机制收益分开；需要补充与当前快照一致的单项回退核查。"} 共同改进还包括选定中断FIT治理、快速检测、自动恢复及漏检追溯；Agent仅通过人工追加耗时预算建模，尚非实测产品收益。</p></section>${measureRankingHtml(result, d, cards)}`;
}

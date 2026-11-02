import type { TopologyDecision } from "../../analysis/src/audit-topology-decision";
import study from "../../../references/remap-studies/2026-11-02-measure-ranking-50w.json";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";
import { esc } from "./audit-decision-pages";

const canonical = (v: any): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
const sortedEvents = (events: any[]) =>
  [...events].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

/** Never reuse frozen study numbers after either endpoint or exposure changes. */
export function matchedMeasureRanking(
  baseline: any,
  target: any,
  cards: number,
  hours: number,
) {
  if (cards !== study.cards || hours !== study.hours) return null;
  for (const [entry, inputHash, configuration, events, saved] of [
    [
      baseline,
      study.baselineInputHash,
      study.baselineConfiguration,
      study.baselineEvents,
      study.frozenBaseline,
    ],
    [
      target,
      study.targetInputHash,
      study.targetConfiguration,
      study.targetEvents,
      study.frozenTarget,
    ],
  ] as const) {
    const row = entry?.rows?.find(
      (r: any) => r.cards === cards && (!r.id || r.id === "combined"),
    );
    if (
      !row ||
      entry.inputHash !== inputHash ||
      canonical(entry.configuration) !== canonical(configuration)
    )
      return null;
    const mean = row.statistics?.mean;
    if (!Number.isFinite(mean) || Math.abs(mean - saved.availability) > 1e-12)
      return null;
    const actualEvents = row.scaleEvents ?? entry.events;
    if (
      !Array.isArray(actualEvents) ||
      canonical(
        sortedEvents(
          actualEvents.map(({ id, type, fit }: any) => [id, type, fit]),
        ),
      ) !== canonical(sortedEvents(events))
    )
      return null;
  }
  return study;
}

export function measureRankingHtml(
  result: any,
  d: TopologyDecision,
  cards: number,
) {
  const stages = d.scales.find((s) => s.cards === cards)?.scenarios;
  const current = stages?.find((s) => s.trainingScenario?.id === "current");
  const target = stages?.find((s) => s.trainingScenario?.id === "breakthrough");
  const evidence = matchedMeasureRanking(
    result.entries?.find((e: any) => e.name === current?.name),
    result.entries?.find((e: any) => e.name === target?.name),
    cards,
    d.hours,
  );
  if (!evidence) return "";
  const rows = evidence.ranking;
  const agent = rows.find((r) => r.id === "agent_manual")!;
  const max = Math.max(
    ...rows.flatMap((r) => [
      r.shapley.loss.mean,
      r.baselineOnly.loss.mean,
      r.necessity.loss.mean,
    ]),
  );
  const heat = (v: number) => {
    const t = Math.max(
      0,
      Math.min(1, Math.log1p(Math.abs(v)) / Math.log1p(max)),
    );
    const a = [242, 248, 252],
      b = v >= 0 ? [126, 181, 219] : [235, 163, 148];
    return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
  };
  const cell = (v: number, strong = false) =>
    `<td style="background:${heat(v)}">${strong ? "<b>" : ""}${num(v, 2)}${strong ? "</b>" : ""}</td>`;
  const agentRank = rows.indexOf(agent) + 1;
  const currentModel = evidence.baselineConfiguration.model;
  const targetModel = evidence.targetConfiguration.model;
  const savedSeconds =
    currentModel.manualAdditionalSeconds - targetModel.manualAdditionalSeconds;
  const ledgerFields = [
    ["downtime", "停机"],
    ["rollback", "回滚"],
    ["slowdown", "降速"],
    ["terminalInvalid", "期末污染失效"],
    ["save", "保存阻塞"],
    ["localLoss", "局部降容"],
    ["mechanismOverhead", "机制开销"],
  ] as const;
  return `<section class="analysis-card analysis-measure-ranking" data-measure-ranking="exact-shapley"><h3>全部9项改进收益排名 · Shapley分摊</h3><p class="analysis-priority">Agent人工处置每次缩短${num(savedSeconds / 3600, 1)}h；按组合收益分摊为${num(agent.shapley.loss.mean, 2)}h，排名${agentRank}。此前${num(agent.necessity.loss.mean, 2)}h是其他突破参数已生效后的边际收益，两者回答不同问题。</p><p>50万卡 / 600h；9组参数的${evidence.coalitions}种组合，每组${evidence.n}条同种子轨迹。排名按Shapley减损从大到小；蓝色越深收益越大，负值用淡橙色。Shapley列可相加；右侧两列用于判断实施次序和方案必要性，不可相加。</p><div class="analysis-table-scroll"><table class="measure-ranking-main"><thead><tr><th>排名 / 措施</th><th>作用类别</th><th>关键参数：现状→突破</th><th>Shapley减损 h</th><th>可用度提升 pp</th><th>仅在现状加入：减损 h</th><th>完整方案缺少该项：增加损失 h</th></tr></thead><tbody>${rows.map((r, i) => `<tr data-ranked-measure="${r.id}"><th>${i + 1}. ${esc(r.name)}</th><td>${esc(r.category)}</td><td>${esc(r.parameter)}</td>${cell(r.shapley.loss.mean, true)}<td><b>${num(r.shapley.availabilityGainPp, 3)}</b></td>${cell(r.baselineOnly.loss.mean)}${cell(r.necessity.loss.mean)}</tr>`).join("")}<tr class="measure-ranking-total"><th colspan="3">整套改进组合 · Shapley合计</th><td>${num(evidence.combined.loss.mean, 2)}</td><td>${num(evidence.combined.availabilityGainPp, 3)}</td><td colspan="2">条件单项收益有交互，不合计</td></tr></tbody></table></div><p class="analysis-note">本轮配对复核端点：现状${pct(evidence.endpoints.baseline.availability, 3)} / ${num(evidence.endpoints.baseline.loss.mean, 3)}h → 突破${pct(evidence.endpoints.target.availability, 3)} / ${num(evidence.endpoints.target.loss.mean, 3)}h。原现状快照${pct(evidence.frozenBaseline.availability, 3)}采用${evidence.frozenBaseline.n}轨迹，本轮采用${evidence.n}轨迹并统一种子；历史结果未改写。现状基线仍待校准到专家约60%，本排序是当前输入下的改进贡献，非实测产品收益。</p><details open><summary>Agent为何不是每次故障都减少3.5小时</summary><p>人工追加只在自动恢复失败时发生。现状自动成功率${pct(currentModel.recoverySuccess, 1)}，失败比例${pct(1 - currentModel.recoverySuccess, 1)}；突破自动成功率${pct(targetModel.recoverySuccess, 1)}，失败比例${pct(1 - targetModel.recoverySuccess, 1)}。相同人工分支下，每次恢复尝试的期望缩短为${num(savedSeconds * (1 - currentModel.recoverySuccess), 1)}s或${num(savedSeconds * (1 - targetModel.recoverySuccess), 1)}s，不能把3.5h乘以全部故障次数。</p><p>在现状单独加入Agent人工处置改进，停机减少${num(agent.baselineOnly.ledger.downtime, 2)}h，净减损${num(agent.baselineOnly.loss.mean, 2)}h；其他突破措施已生效时，净减损${num(agent.necessity.loss.mean, 2)}h，其中停机减少${num(agent.necessity.ledger.downtime, 2)}h。若Agent还承担“漏检静默调查168→24h”，两项合并的条件减损为${num(evidence.agentExpandedScope.necessity.loss.mean, 2)}h；这是扩展职责情景，必须验证能力，且不能再与独立行重复相加。</p><p>停机缩短后，释放的运行时间仍会遇到故障、回滚和污染；因此停机减损不等于有效产出的净增益，不能简单用“人工次数×3.5h”代替全窗口仿真。</p></details><details><summary>按损失类型展开：各措施具体减少了什么</summary><div class="analysis-table-scroll"><table><thead><tr><th>措施 / Shapley减损h</th>${ledgerFields.map(([, label]) => `<th>${label} h</th>`).join("")}<th>合计 h / 95%采样区间</th></tr></thead><tbody>${rows.map((r) => `<tr><th>${esc(r.name)}</th>${ledgerFields.map(([k]) => cell(r.shapley.ledger[k])).join("")}<td>${num(r.shapley.loss.mean, 2)}<small>${num(r.shapley.loss.ciLow, 2)}–${num(r.shapley.loss.ciHigh, 2)}</small></td></tr>`).join("")}</tbody></table></div><p>正值表示减少该类损失，负值表示该类损失增加。机制改变有效运行时间、故障暴露与污染路径，因此某一账项可能增加而总损失减少。区间仅描述仿真采样误差，不包含参数与模型误差；9组措施的分组方式也会影响Shapley分摊。</p></details><details><summary>具体工程措施、参数名与尚未量化的候选</summary>${rows.map((r) => `<article><h4>${esc(r.name)}</h4><p>${esc(r.action)}</p><div class="analysis-table-scroll"><table><thead><tr><th>模型参数名</th><th>现状</th><th>突破</th></tr></thead><tbody>${r.namedParameters.map((p) => `<tr><th>${esc(p.path)}</th><td>${num(p.before, 6)}</td><td>${num(p.after, 6)}</td></tr>`).join("")}</tbody></table></div></article>`).join("")}<p>以下措施没有完整的独立收益输入，不能编造名次或把收益填成0：重执行、进程重调度、DP局部恢复，以及已找回的16项单点工程措施。部分方向已包含在上述总参数改进里，未分别归因。</p><div class="analysis-table-scroll"><table><thead><tr><th>候选措施</th><th>量化状态</th></tr></thead><tbody>${evidence.notSeparatelyQuantified.map((r) => `<tr><th>${esc("name" in r ? `${r.id} · ${r.name}` : r.id)}</th><td>${esc(r.status)}</td></tr>`).join("")}</tbody></table></div></details></section>`;
}

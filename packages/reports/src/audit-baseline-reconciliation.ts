import type { TopologyDecision } from "../../analysis/src/audit-topology-decision";
import study from "../../../references/remap-studies/2026-11-02-baseline-reconciliation-50w.json";
import {
  auditNumber as num,
  auditPercent as pct,
} from "../../contracts/src/audit-recovery-budget";
import { esc } from "./audit-decision-pages";
const canonical = (value: any): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );

export function matchedBaselineReconciliation(
  entry: any,
  cards: number,
  hours: number,
) {
  const row = entry?.rows?.find(
    (r: any) => r.cards === cards && (!r.id || r.id === "combined"),
  );
  const replay = study.results.find((r) => r.id === "replay")!;
  if (
    cards !== 500000 ||
    hours !== 600 ||
    !row ||
    entry.inputHash !== study.baselineInputHash ||
    canonical(entry.configuration) !== canonical(study.baselineConfiguration) ||
    Math.abs(row.statistics?.mean - replay.mean) > 1e-10 ||
    !Number.isFinite(row.statistics?.mean)
  )
    return null;
  const events = row.scaleEvents;
  if (
    !Array.isArray(events) ||
    events.length !== replay.eventFits.length ||
    replay.eventFits.some(
      ([id, type, fit]) =>
        !events.some(
          (e: any) =>
            e.id === id &&
            e.type === type &&
            Math.abs(e.fit - Number(fit)) < 1e-10,
        ),
    )
  )
    return null;
  return study;
}

/** External reference values and conditional diagnostics never replace a saved run. */
export function baselineReconciliationHtml(
  result: any,
  d: TopologyDecision,
  cards: number,
) {
  const scale = d.scales.find((s) => s.cards === cards),
    baseline = scale?.scenarios.find(
      (s) => s.trainingScenario?.id === "current",
    );
  if (!baseline) return "";
  const entry = result.entries?.find((e: any) => e.name === baseline.name);
  const evidence = matchedBaselineReconciliation(entry, cards, d.hours);
  if (!evidence) return "";
  const get = (id: string) => baseline.nodes.find((n) => n.id === id)!,
    network = evidence.results.find((r) => r.id === "network_only")!,
    compute = evidence.results.find((r) => r.id === "compute_only")!;
  const rows = [
    [
      "全系统",
      "全部已建模故障与公共开销",
      `${pct(get("system").availability, 3)} / ${num(get("system").actualHours, 3)}h`,
      "专家约60%（约240h损失）",
      "现状模型尚未校准；不能将36.607%当作现场实测",
    ],
    [
      "网络 · 单独评估",
      "仅网络故障，含IOD；独立仿真",
      `${pct(network.mean, 3)} / ${num(network.loss, 3)}h`,
      "专家约84%（原始指标口径待核实）",
      `1024轨迹；95%均值区间 ${pct(network.ciLow, 3)}–${pct(network.ciHigh, 3)}`,
    ],
    [
      "网络 · 责任损失",
      "全系统运行中归给网络的损失",
      `${pct(get("hardware-network").availability, 3)} / ${num(get("hardware-network").actualHours, 3)}h`,
      "不能直接与单域84%比较",
      "其他域停机、污染和回滚会改变网络暴露及计损路径",
    ],
    [
      "计算 · 不含IOD",
      "责任损失 / 单域独立结果",
      `${pct(get("domain-1").availability, 3)} / ${pct(compute.mean, 3)}`,
      "计算域故障率与恢复链仍需校准",
      `责任损失 ${num(get("domain-1").actualHours, 3)}h；单域含自身保存开销，不与其他域单独结果相加`,
    ],
  ];
  const parameters: Record<string, string> = {
    "R-LINK-LOCAL": "训练可见停顿2s（1–3s），成功时回滚0s",
    "R-FABRIC-DEGRADE": "切换2s；暴露通信占比30%；剩余带宽75%；修复1800s",
    "R-HCCL-ELASTIC": "通信重建60→15s（10–20s）；仅适用局部恢复",
    "D-NET-SDC": "端到端检出目标95% / 1s；适用风险比例待测",
    "C-ASYNC": "保存阻塞4→1s（0.5–2s）；另计持久化滞后10s",
    "R-WARM-PROCESS": "启动60→20s（10–30s）；其他恢复阶段另计",
    "D-RECOVERY-CLASSIFY": "人工升级概率1%→0.1%；原专家示例追加7200s",
  };
  const mechanisms = Object.keys(parameters).map(
    (id) => evidence.recoveredMechanisms.find((m) => m.id === id)!,
  );
  return `<section class="analysis-card analysis-baseline-review" data-baseline-calibration="pending"><h3>现状基线核查：专家参照与模型分开列</h3><p class="analysis-priority">IOD属于02网络责任域，物理位置仍在NPU芯片。整网约60%、网络约84%保留为专家参照；当前输入尚未复现这两个参考点。</p><div class="analysis-table-scroll"><table><thead><tr>${["对象", "口径", "模型可用度 / 损失", "专家参照", "结论"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v, i) => `<${i ? "td" : "th"}>${esc(v)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody></table></div><p class="analysis-note">单域独立评估重新计算暴露、检查点与污染；责任损失来自整网同一份账。两者不同，六层责任可用度不能相乘。IOD的原叶预算随责任归属迁移，总预算仍为9h；这是归属修订，未改写原始仿真。</p><details><summary>已找回的专家措施与参数 · 网络及其他恢复能力</summary><div class="analysis-table-scroll"><table><thead><tr><th>具体措施</th><th>原始参考参数</th><th>适用事件</th><th>现状接入所缺证据</th></tr></thead><tbody>${mechanisms.map((m) => `<tr><th>${esc(m.name)}<small>${m.id}</small></th><td>${esc(parameters[m.id])}</td><td>${esc((m.eventCandidates ?? []).join("、"))}</td><td>部署状态、适用比例、条件成功率、失败耗时与正常态开销待核实；原库为单点工程参考，不能直接当作已部署收益。</td></tr>`).join("")}</tbody></table></div><p>来源：新可靠性机制库单点量化交付包（2026-10-14）。原库共16项；上表列出本次最相关的7项。已建模的保护后残余故障不重复扣冗余收益。</p></details><details><summary>计算域校准敏感性 · 保留原输入，逐项核查</summary><div class="analysis-table-scroll"><table><thead><tr><th>独立诊断情景</th><th>可用度</th><th>损失h</th><th>状态</th></tr></thead><tbody>${evidence.results
    .filter((r) =>
      [
        "independent",
        "expert_older_recovery",
        "exposure_x1",
        "whole_mtbf_18",
      ].includes(r.id),
    )
    .map(
      (r) =>
        `<tr><th>${esc(r.name)}</th><td>${pct(r.mean, 3)}</td><td>${num(r.loss, 3)}</td><td>1024轨迹，仅诊断，不替换现状输入</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><p>现状80%静默检测、漏检168h发现、600s检查点/4s阻塞保持不变。上述条件核查仍未复现60%，需要补齐原专家算例的事件范围、故障率和各故障模式恢复链。</p></details></section>`;
}

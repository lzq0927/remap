import type { TopologyDecision } from "../../analysis/src/audit-topology-decision";
import { esc } from "./audit-decision-pages";
import { auditNumber as num } from "../../contracts/src/audit-recovery-budget";

type Stage = TopologyDecision["scales"][number]["scenarios"][number];
type EventLedger = { events: number; downtime: number; rollback: number };
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Read the saved event ledger; no extra simulation and no reallocation of rollback to saving overhead. */
export function checkpointAccounting(
  result: any,
  stage: Stage,
  cards: number,
  window: number,
) {
  const source =
    result.entries?.find((entry: any) => entry.name === stage.name) ??
    (result.entries ? undefined : result);
  const row = source?.rows?.find(
    (r: any) => r.cards === cards && (!r.id || r.id === "combined"),
  );
  const types = new Map<string, string>(
    (source?.events ?? result.events ?? []).map((e: any) => [e.id, e.type]),
  );
  const total = (type: string): EventLedger | null => {
    if (!row?.perEvent) return null;
    // Do not guess types from ID suffixes for imported/custom event catalogs.
    if (Object.keys(row.perEvent).some((id) => !types.has(id))) return null;
    const events = Object.entries(row.perEvent).filter(
      ([id]) => types.get(id) === type,
    );
    if (
      events.some(([, raw]) => {
        const e = raw as EventLedger | null;
        return (
          !e ||
          [e.events, e.downtime, e.rollback].some((v) => finite(v) == null)
        );
      })
    )
      return null;
    return events.reduce<EventLedger>(
      (sum, [, raw]) => {
        const e = raw as EventLedger;
        return {
          events: sum.events + e.events,
          downtime: sum.downtime + e.downtime,
          rollback: sum.rollback + e.rollback,
        };
      },
      { events: 0, downtime: 0, rollback: 0 },
    );
  };
  const model = stage.configuration?.model ?? {},
    fast = stage.configuration?.policy?.["C-FAST"];
  const baseCompute = finite(model.checkpointComputeSeconds),
    baseSave = finite(model.checkpointSaveSeconds);
  // Comparison snapshots do not always retain selected mechanism switches. Report a parameter
  // only when the possible base and fast settings agree, or when no fast override was saved.
  const compute =
    fast && fast.computeSeconds !== baseCompute ? null : baseCompute;
  const save = fast && fast.saveSeconds !== baseSave ? null : baseSave;
  const hasAsync = (model.extensions ?? []).some(
    (m: any) => m.id === "C-ASYNC",
  );
  const blockingFraction =
    !hasAsync && compute != null && compute > 0 && save != null && save >= 0
      ? save / (compute + save)
      : null;
  const hard = total("hard"),
    sdc = total("sdc");
  return {
    compute,
    save,
    hasAsync,
    blockingFraction,
    uninterruptedSaveHours:
      blockingFraction == null ? null : window * blockingFraction,
    load: finite(stage.trainingScenario?.loadSeconds),
    attempt: finite(model.recoveryAttemptSeconds),
    saveHours: stage.nodes.find((n) => n.id === "overhead")!.loss.save,
    rollbackHours: stage.nodes.find((n) => n.id === "system")!.loss.rollback,
    hard,
    sdc,
    hardRollbackSeconds:
      hard && hard.events > 0 ? (hard.rollback / hard.events) * 3600 : null,
    hardDowntimeSeconds:
      hard && hard.events > 0 ? (hard.downtime / hard.events) * 3600 : null,
  };
}

export function checkpointImpactHtml(
  result: any,
  stage: Stage,
  cards: number,
  window: number,
) {
  const a = checkpointAccounting(result, stage, cards, window);
  const value = (v: number | null | undefined, digits = 3) =>
    v == null ? "未记录" : num(v, digits);
  const rows = [
    [
      "正常保存阻塞",
      "每次保存阻塞 " + value(a.save, 2) + "s",
      value(a.saveHours) + "h",
      "06公共开销；不能当作恢复加载时间",
    ],
    [
      "中断回滚重算",
      "检查点间计算 " + value(a.compute, 2) + "s",
      value(a.hard?.rollback) + "h",
      "回到最近持久化检查点；损失归触发故障的部件",
    ],
    [
      "静默污染追溯回滚",
      "回到最后干净检查点",
      value(a.sdc?.rollback) + "h",
      "包含漏检后的长时间追溯；仅缩短周期不足以解决",
    ],
    [
      "恢复状态加载",
      value(a.load, 2) + "s（工程拆分）",
      "未单独记账",
      "已含在自动恢复尝试" +
        value(a.attempt, 2) +
        "s内；须用状态体积、有效带宽和实测时长校准",
    ],
  ];
  const cycle =
    a.blockingFraction == null
      ? "快照未能唯一确定生效的周期/阻塞参数，或启用了异步扩展；实际保存损失仍采用原仿真账项。"
      : `按${value(a.compute, 2)}s计算 + ${value(a.save, 2)}s保存的正常周期，阻塞占${value(a.blockingFraction * 100)}%；${window}h无故障连续运行约耗${value(a.uninterruptedSaveHours)}h。含故障的实际保存损失为${value(a.saveHours)}h，停机、失败和回滚会改变保存次数。`;
  const average =
    a.hardRollbackSeconds == null
      ? "该快照缺少可核对的中断事件计数，无法计算每次平均回滚。"
      : `每次中断平均：停机${value(a.hardDowntimeSeconds, 2)}s + 回滚${value(a.hardRollbackSeconds, 2)}s（${value(a.hardRollbackSeconds / 60, 2)}min）。回滚合计${value(a.rollbackHours)}h已在原部件损失中，不另加到保存开销。`;
  return `<section class="analysis-card" data-checkpoint-accounting><h3>检查点影响：保存阻塞、回滚重算与恢复加载</h3><p>${esc(stage.name)} · ${esc(cycle)}</p><div class="analysis-table-scroll"><table><thead><tr><th>环节</th><th>参数 / 动作</th><th>${window}h损失</th><th>记账与核验</th></tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v, i) => `<${i ? "td" : "th"}>${esc(v)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody></table></div><p class="analysis-priority">${esc(average)}</p><p class="analysis-note">保存4s不能推算加载时长。加载参数以旧工程输入展示，尚需检查点体积、有效恢复带宽或实测数据校准。若周期仅改为1s而仍阻塞4s，保存会占正常周期的80%；必须同步核验低阻塞保存、持久化滞后及可恢复性。</p></section>`;
}

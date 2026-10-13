import type { AuditRequest } from "../../../packages/analysis/src/audit";
export default function AuditBaselineEditor({
  request,
  onChange,
  events,
  mechanisms,
}: {
  request: AuditRequest;
  onChange: (r: AuditRequest) => void;
  events: any[];
  mechanisms: any[];
}) {
  const baseline = request.baseline ?? {},
    fixed = baseline.mechanisms ?? [],
    resolved = baseline.resolvedEventIds ?? [];
  const update = (key: "mechanisms" | "resolvedEventIds", ids: string[]) =>
    onChange({ ...request, baseline: { ...baseline, [key]: ids } });
  const toggle = (ids: string[], id: string, checked: boolean) =>
    checked ? [...new Set([...ids, id])] : ids.filter((x) => x !== id);
  const names: Record<string, string> = {
    hard: "中断",
    slow: "亚健康",
    sdc: "静默",
  };
  return (
    <details
      className="audit-baseline-editor"
      open={!!(fixed.length || resolved.length)}
    >
      <summary>已解决条件 · 重算剩余机制排序</summary>
      <p className="note">
        可自由组合两类条件。已部署机制保留故障率和真实覆盖率；假设已完全消除的故障仅在本次评估中按FIT为零处理。它们均成为所有候选的共同基线，不改写故障库，也不等于已经验证零风险。
      </p>
      <fieldset>
        <legend>已部署机制（固定基线）</legend>
        <div className="mechanism-grid">
          {mechanisms.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                aria-label={`已部署：${m.name}`}
                checked={fixed.includes(m.id)}
                onChange={(e) =>
                  update("mechanisms", toggle(fixed, m.id, e.target.checked))
                }
              />
              {m.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>假设已完全消除的故障（可多选）</legend>
        <p className="note">
          若只是降低了发生率，请在故障与证据中填写实际剩余FIT，不勾选“完全消除”。例如检测静默错误不等于消除静默故障。
        </p>
        {[...new Set(events.map((e) => e.type))].map((type) => {
          const group = events.filter((e) => e.type === type),
            ids = group.map((e) => e.id);
          return (
            <details key={type}>
              <summary>
                {names[type] ?? type}故障 ·{" "}
                {ids.filter((id) => resolved.includes(id)).length}/{ids.length}
              </summary>
              <button
                type="button"
                onClick={() =>
                  update("resolvedEventIds", [
                    ...new Set([...resolved, ...ids]),
                  ])
                }
              >
                假设{names[type] ?? type}故障全部消除
              </button>
              <button
                type="button"
                onClick={() =>
                  update(
                    "resolvedEventIds",
                    resolved.filter((id) => !ids.includes(id)),
                  )
                }
              >
                清除{names[type] ?? type}选择
              </button>
              <div className="mechanism-grid">
                {group.map((event) => (
                  <label key={event.id}>
                    <input
                      type="checkbox"
                      aria-label={`假设已消除：${event.id}`}
                      checked={resolved.includes(event.id)}
                      onChange={(e) =>
                        update(
                          "resolvedEventIds",
                          toggle(resolved, event.id, e.target.checked),
                        )
                      }
                    />
                    <span>
                      {event.id} · {event.description}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </fieldset>
      <label>
        已解决条件说明
        <input
          aria-label="已解决条件说明"
          maxLength={2000}
          value={baseline.note ?? ""}
          onChange={(e) =>
            onChange({
              ...request,
              baseline: { ...baseline, note: e.target.value },
            })
          }
        />
      </label>
      <button
        type="button"
        onClick={() => onChange({ ...request, baseline: undefined })}
      >
        清除全部已解决条件
      </button>
      <p className="note">
        修改条件后需重新评估。排序范围由下方候选措施选择确定；已部署的措施自动从新增排序与新增成本中排除。
      </p>
    </details>
  );
}

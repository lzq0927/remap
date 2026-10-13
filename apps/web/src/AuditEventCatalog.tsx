import { useState } from "react";
import {
  auditObjects,
  faultTypeLabels,
  type AuditEventView,
} from "../../../packages/contracts/src/audit-objects";

const fit = (value: number) =>
  value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
const evidence: Record<string, string> = {
  "external-prior": "外网先验",
  "internal-measured": "内部观测",
  scenario: "方案假设",
};
export default function AuditEventCatalog({
  events,
  onEdit,
}: {
  events: AuditEventView[];
  onEdit: (id: string) => void;
}) {
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const objects = auditObjects(events),
    total = events.reduce((s, e) => s + e.fit, 0);
  const matches = (e: AuditEventView) =>
    (!type || e.type === type) &&
    (!query ||
      `${e.id} ${e.domain} ${e.description}`
        .toLowerCase()
        .includes(query.toLowerCase()));
  const groups = objects.filter(
    (o) => (!category || o.category === category) && o.events.some(matches),
  );
  return (
    <section className="fault-catalog" aria-label="分类故障模式库">
      <div className="fault-summary">
        <div>
          <span>全部对象</span>
          <strong>
            {objects.length} 类 · {events.length} 个模式
          </strong>
          <small>合计 {fit(total)} FIT</small>
        </div>
        {Object.entries(faultTypeLabels).map(([key, label]) => {
          const sum = events
            .filter((e) => e.type === key)
            .reduce((s, e) => s + e.fit, 0);
          return (
            <div key={key}>
              <span>{label}</span>
              <strong>{fit(sum)} FIT</strong>
              <small>
                当前占比 {total ? ((100 * sum) / total).toFixed(2) : "0"}%
              </small>
            </div>
          );
        })}
      </div>
      <p className="note">
        统一为每十亿 NPU 等效运行小时。参考总占比：中断 96.6%、亚健康 2%、静默
        1.4%；更新事件 FIT 后按实际值重算占比。类内占比以同类故障的 FIT
        总和为分母。
      </p>
      <div className="fault-filters fields">
        <label>
          对象类型
          <select
            aria-label="筛选对象类型"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">全部对象类型</option>
            {[...new Set(objects.map((o) => o.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          故障类型
          <select
            aria-label="筛选故障类型"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">全部故障类型</option>
            {Object.entries(faultTypeLabels).map(([key, name]) => (
              <option value={key} key={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          查找故障模式
          <input
            aria-label="查找故障模式"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="对象、模式名称或编号"
          />
        </label>
      </div>
      <p className="mobile-table-hint">
        横向滑动查看各类 FIT 与证据；点对象名称展开故障模式。
      </p>
      <div
        className="table-wrap fault-table"
        tabIndex={0}
        aria-label="故障模式分类表，可横向滚动"
      >
        <table>
          <thead>
            <tr>
              <th>对象 / 展开模式</th>
              <th>中断 FIT</th>
              <th>亚健康 FIT</th>
              <th>静默 FIT</th>
              <th>合计 FIT</th>
              <th>证据</th>
            </tr>
          </thead>
          {groups.map((object) => {
            const open = expanded.includes(object.id) || !!type || !!query;
            return (
              <tbody key={object.id}>
                <tr className="fault-object-row">
                  <th>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={`展开${object.name}故障模式`}
                      onClick={() =>
                        setExpanded(
                          open
                            ? expanded.filter((id) => id !== object.id)
                            : [...expanded, object.id],
                        )
                      }
                    >
                      {open ? "▾" : "▸"} {object.name}
                    </button>
                    <small>
                      {object.category} · {object.id}
                    </small>
                  </th>
                  <td>{fit(object.types.hard)}</td>
                  <td>{fit(object.types.slow)}</td>
                  <td>{fit(object.types.sdc)}</td>
                  <td>
                    <strong>{fit(object.fit)}</strong>
                  </td>
                  <td>
                    {
                      object.events.filter(
                        (e) => e.evidence === "internal-measured",
                      ).length
                    }{" "}
                    / {object.events.length} 内部观测
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={6} className="fault-mode-cell">
                      <div className="fault-mode-list">
                        {object.events.filter(matches).map((event) => {
                          const classFit = events
                            .filter((e) => e.type === event.type)
                            .reduce((s, e) => s + e.fit, 0);
                          return (
                            <article key={event.id} className="fault-mode">
                              <div>
                                <strong>
                                  {faultTypeLabels[event.type]} ·{" "}
                                  {event.description}
                                </strong>
                                <small>
                                  {event.id} ·{" "}
                                  {evidence[event.evidence ?? ""] ?? "待核对"}
                                </small>
                              </div>
                              <div>
                                <strong>{fit(event.fit)} FIT</strong>
                                <small>
                                  总占比{" "}
                                  {total
                                    ? ((event.fit / total) * 100).toFixed(2)
                                    : "0"}
                                  % · 类内{" "}
                                  {classFit
                                    ? ((event.fit / classFit) * 100).toFixed(2)
                                    : "0"}
                                  %
                                </small>
                              </div>
                              <button
                                type="button"
                                onClick={() => onEdit(event.id)}
                              >
                                更新 {event.id}
                              </button>
                              <details>
                                <summary>影响范围与来源</summary>
                                <p>
                                  {event.scope === "global"
                                    ? "全局影响"
                                    : event.scope === "local"
                                      ? "局部影响"
                                      : event.scope}{" "}
                                  ·{" "}
                                  {event.persistence === "transient"
                                    ? "瞬态"
                                    : event.persistence === "persistent"
                                      ? "持续性"
                                      : event.persistence}
                                </p>
                                <p>{event.source}</p>
                                <p>{event.note}</p>
                              </details>
                            </article>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
      {!groups.length && <p role="status">没有符合筛选条件的故障模式。</p>}
    </section>
  );
}

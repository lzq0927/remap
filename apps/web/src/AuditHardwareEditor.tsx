import { useState } from "react";
import type {
  AuditArchitecture,
  AuditArchitectureNode,
} from "../../../packages/contracts/src/audit-architecture";
import {
  hardwareCount,
  hardwareLevels,
} from "../../../packages/contracts/src/audit-hardware";
import type { AuditEventView } from "../../../packages/contracts/src/audit-objects";

type Props = {
  architecture: AuditArchitecture;
  scales: number[];
  events: AuditEventView[];
  onChange: (a: AuditArchitecture) => void;
};
function Inventory({
  architecture: a,
  scales,
  node: n,
  onChange,
}: Props & { node: AuditArchitectureNode }) {
  const [totals, setTotals] = useState<Record<string, string>>(
    Object.fromEntries(
      scales.map((c) => [c, n.inventory?.totals[c]?.toString() ?? ""]),
    ),
  );
  const [ratio, setRatio] = useState(
    n.inventory?.unitsPerParent?.toString() ?? "",
  );
  const [source, setSource] = useState(n.inventory?.source ?? "");
  const [level, setLevel] = useState(n.hardwareLevel ?? "other");
  const [enabled, setEnabled] = useState(!!n.rateModel);
  const [referenceCards, setReferenceCards] = useState(
    n.rateModel?.referenceCards ?? 10000,
  );
  const [referenceCount, setReferenceCount] = useState(
    n.rateModel?.referenceCount?.toString() ?? "",
  );
  const [rateSource, setRateSource] = useState(n.rateModel?.source ?? "");
  const leaf = !a.nodes.some((c) => c.parentId === n.id);
  return (
    <div className="hardware-edit-form">
      <div className="fields">
        <label>
          硬件层次
          <select
            aria-label="硬件层次"
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
          >
            {Object.entries(hardwareLevels).map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          每个上级包含数量（可留空）
          <input
            aria-label="每上级硬件数量"
            type="number"
            min="0"
            step="1"
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
          />
        </label>
      </div>
      <p className="note">
        各规模总数量优先于上级数量比例；空白表示未知。规模方案彼此独立。仅记录数量不会改变故障率。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>规模</th>
              <th>本类硬件总数量</th>
              <th>当前已保存数量</th>
            </tr>
          </thead>
          <tbody>
            {scales.map((cards) => (
              <tr key={cards}>
                <th>{cards.toLocaleString()}卡</th>
                <td>
                  <input
                    aria-label={`硬件总数量 ${cards}`}
                    type="number"
                    min="0"
                    step="1"
                    value={totals[cards]}
                    onChange={(e) =>
                      setTotals({ ...totals, [cards]: e.target.value })
                    }
                  />
                </td>
                <td>
                  {hardwareCount(a, n.id, cards)?.toLocaleString() ?? "待补充"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label>
        数量依据
        <input
          aria-label="硬件数量依据"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="配置清单、设计假设或测量记录"
        />
      </label>
      {leaf && !!n.eventIds.length && (
        <>
          <label className="arch-toggle">
            <input
              type="checkbox"
              aria-label="按硬件数量折算事件率"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            按硬件数量折算事件率
          </label>
          {enabled && (
            <>
              <p className="note">
                当前故障库为每NPU等效FIT。折算倍率 = 当前硬件数量 ÷ 参考数量 ×
                参考卡数 ÷
                当前卡数。参考点不变；其他规模使用所填数量。必须提供全部评估规模及敏感性规模的数量。
              </p>
              <div className="fields">
                <label>
                  参考卡数
                  <input
                    aria-label="数量折算参考卡数"
                    type="number"
                    min="1"
                    value={referenceCards}
                    onChange={(e) => setReferenceCards(Number(e.target.value))}
                  />
                </label>
                <label>
                  参考硬件数量
                  <input
                    aria-label="数量折算参考数量"
                    type="number"
                    min="1"
                    value={referenceCount}
                    onChange={(e) => setReferenceCount(e.target.value)}
                  />
                </label>
              </div>
              <label>
                折算适用依据
                <input
                  aria-label="数量折算依据"
                  value={rateSource}
                  onChange={(e) => setRateSource(e.target.value)}
                  placeholder="说明源FIT对应的参考硬件配置"
                />
              </label>
            </>
          )}
        </>
      )}
      <button
        type="button"
        disabled={
          !source.trim() || (enabled && (!rateSource.trim() || !referenceCount))
        }
        onClick={() =>
          onChange({
            ...a,
            nodes: a.nodes.map((v) =>
              v.id === n.id
                ? {
                    ...v,
                    hardwareLevel: level,
                    inventory: {
                      totals: Object.fromEntries(
                        Object.entries(totals)
                          .filter(([, v]) => v !== "")
                          .map(([k, v]) => [k, Number(v)]),
                      ),
                      ...(ratio !== ""
                        ? { unitsPerParent: Number(ratio) }
                        : {}),
                      source,
                    },
                    rateModel: enabled
                      ? {
                          referenceCards,
                          referenceCount: Number(referenceCount),
                          source: rateSource,
                        }
                      : undefined,
                  }
                : v,
            ),
          })
        }
      >
        保存硬件规模配置
      </button>
    </div>
  );
}
function Propagation({ architecture: a, events, onChange }: Props) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const current = a.propagations?.find((p) => p.eventId === eventId);
  return (
    <>
      <label>
        故障模式
        <select
          aria-label="传播故障模式"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.domain} · {e.id}
            </option>
          ))}
        </select>
      </label>
      <PropagationForm
        key={eventId + JSON.stringify(current)}
        architecture={a}
        eventId={eventId}
        onChange={onChange}
      />
      {!!a.propagations?.length && (
        <p className="note">
          已记录 {a.propagations.length} 条故障传播证据；选择故障可复核或修改。
        </p>
      )}
    </>
  );
}
function PropagationForm({
  architecture: a,
  eventId,
  onChange,
}: {
  architecture: AuditArchitecture;
  eventId: string;
  onChange: Props["onChange"];
}) {
  const old = a.propagations?.find((p) => p.eventId === eventId);
  const owner = a.nodes.find((n) => n.eventIds.includes(eventId));
  const [path, setPath] = useState(old?.path ?? (owner ? [owner.id] : []));
  const [manifestation, setManifestation] = useState(old?.manifestation ?? "");
  const [impact, setImpact] = useState(old?.impact ?? "");
  const [containment, setContainment] = useState(old?.containment ?? "");
  const [source, setSource] = useState(old?.source ?? "");
  return (
    <div className="hardware-edit-form">
      <p className="note">
        从根故障所属对象开始，依次添加受影响对象。此处记录证据与影响，实际收益由评估中选定的检测恢复措施计算。
      </p>
      <ol className="hardware-path-editor">
        {path.map((id, i) => (
          <li key={i}>
            {i === 0 ? (
              <b>{owner?.name ?? "未归属"}</b>
            ) : (
              <select
                aria-label={`传播路径第${i + 1}步`}
                value={id}
                onChange={(e) =>
                  setPath(path.map((v, j) => (j === i ? e.target.value : v)))
                }
              >
                {a.nodes
                  .filter((n) => n.kind !== "overhead")
                  .map((n) => (
                    <option value={n.id} key={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            )}
            {i > 0 && (
              <button
                type="button"
                onClick={() => setPath(path.filter((_, j) => i !== j))}
              >
                移除第{i + 1}步
              </button>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={path.length >= 10}
        onClick={() => {
          const next = a.nodes.find(
            (n) => n.kind !== "overhead" && !path.includes(n.id),
          );
          if (next) setPath([...path, next.id]);
        }}
      >
        添加传播步骤
      </button>
      <div className="fields">
        <label>
          上层故障表现
          <input
            aria-label="传播上层表现"
            value={manifestation}
            onChange={(e) => setManifestation(e.target.value)}
            placeholder="例如算子异常、作业挂起、错误梯度"
          />
        </label>
        <label>
          影响范围
          <input
            aria-label="传播影响范围"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
            placeholder="例如单进程、节点、同步作业"
          />
        </label>
        <label>
          隔离与恢复条件
          <input
            aria-label="传播恢复条件"
            value={containment}
            onChange={(e) => setContainment(e.target.value)}
            placeholder="例如局部重执行失败后全局回滚"
          />
        </label>
        <label>
          传播证据
          <input
            aria-label="传播证据"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={
          !owner ||
          ![manifestation, impact, containment, source].every((v) => v.trim())
        }
        onClick={() =>
          onChange({
            ...a,
            propagations: [
              ...(a.propagations ?? []).filter((p) => p.eventId !== eventId),
              { eventId, path, manifestation, impact, containment, source },
            ],
          })
        }
      >
        保存故障传播记录
      </button>
      {old && (
        <button
          type="button"
          onClick={() =>
            onChange({
              ...a,
              propagations: a.propagations?.filter(
                (p) => p.eventId !== eventId,
              ),
            })
          }
        >
          移除本条传播记录
        </button>
      )}
    </div>
  );
}
export default function AuditHardwareEditor(props: Props) {
  const choices = props.architecture.nodes.filter(
    (n) => n.parentId && n.kind !== "overhead",
  );
  const [selected, setSelected] = useState("");
  const node = choices.find((n) => n.id === selected) ?? choices[0];
  return (
    <>
      <details>
        <summary>硬件组成与各规模数量</summary>
        <label>
          硬件对象
          <select
            aria-label="规模配置硬件对象"
            value={node.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {choices.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <Inventory
          key={
            node.id +
            JSON.stringify(node.inventory) +
            JSON.stringify(node.rateModel)
          }
          {...props}
          node={node}
        />
      </details>
      <details>
        <summary>逐故障传播与业务影响</summary>
        <Propagation {...props} />
      </details>
    </>
  );
}

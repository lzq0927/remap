import { useState } from "react";
import type { AuditOptimizationRequest } from "../../../packages/contracts/src/audit-optimization";
import {
  auditMechanismCodes,
  auditMechanismNames,
  auditMechanismSummary,
} from "../../../packages/contracts/src/audit-mechanism-view";
import { parameterLabels } from "../../../packages/reports/src/audit-labels";

type Group = {
  id: string;
  name: string;
  code?: string;
  values: Record<string, number>;
  kind: "model" | "policy" | "schedule";
};
export default function AuditParameterEditor({
  source,
  configuration,
  onChange,
}: {
  source: any;
  configuration: AuditOptimizationRequest;
  onChange: (next: AuditOptimizationRequest) => void;
}) {
  const active = auditMechanismSummary(source.request, source.selection).ids;
  const groups: Group[] = [
    {
      id: "model",
      name: "基础能力与开销",
      kind: "model",
      values: Object.fromEntries(
        Object.keys(source.config.model)
          .filter(
            (key) =>
              parameterLabels[key] ||
              Object.hasOwn(source.request.model ?? {}, key),
          )
          .filter((key) => Number.isFinite(source.config.model[key]))
          .map((key) => [key, source.config.model[key]]),
      ),
    },
  ];
  for (const code of new Set([
    ...active.map((id) => auditMechanismCodes[id]).filter(Boolean),
    ...Object.keys(configuration.policy ?? {}),
  ])) {
    const id = Object.keys(auditMechanismCodes).find(
      (id) => auditMechanismCodes[id] === code,
    );
    if (source.config.policy[code])
      groups.push({
        id: "policy:" + code,
        name: auditMechanismNames[id ?? ""] ?? code,
        kind: "policy",
        code,
        values: source.config.policy[code],
      });
  }
  if (
    active.includes("fast") ||
    Object.keys(configuration.checkpointPeriods ?? {}).length
  )
    groups.push({
      id: "schedule",
      name: "分规模检查点周期",
      kind: "schedule",
      values: Object.fromEntries(
        source.rows
          .filter((row: any) => row.id === "combined")
          .map((row: any) => [
            String(row.cards),
            source.config.policy["C-FAST"].computeSeconds,
          ]),
      ),
    });
  const [groupId, setGroupId] = useState(groups[0].id),
    [key, setKey] = useState("");
  const group = groups.find((g) => g.id === groupId) ?? groups[0];
  const keys = Object.keys(group.values).filter((k) =>
    Number.isFinite(group.values[k]),
  );
  const parameterKey = keys.includes(key) ? key : keys[0];
  const label = (g: Group, k: string) =>
    g.kind === "schedule"
      ? `${Number(k).toLocaleString()}卡周期（秒）`
      : (parameterLabels[k] ?? k).replace("（0–1）", "（%）");
  const percent = (g: Group, k: string) =>
    g.kind !== "schedule" && parameterLabels[k]?.includes("（0–1）");
  const valuesFor = (g: Group): Record<string, number> =>
    g.kind === "model"
      ? (configuration.model ?? {})
      : g.kind === "schedule"
        ? (configuration.checkpointPeriods ?? {})
        : (configuration.policy?.[g.code!] ?? {});
  const setValue = (g: Group, k: string, value?: number) => {
    const values = { ...valuesFor(g) };
    if (value === undefined) delete values[k];
    else values[k] = value;
    if (g.kind === "model") onChange({ ...configuration, model: values });
    else if (g.kind === "schedule")
      onChange({ ...configuration, checkpointPeriods: values });
    else
      onChange({
        ...configuration,
        policy: { ...configuration.policy, [g.code!]: values },
      });
  };
  const adjustments = groups.flatMap((g) =>
    Object.entries(valuesFor(g))
      .filter(([k]) => Number.isFinite(g.values[k]))
      .map(([k, value]) => ({ group: g, key: k, value })),
  );
  return (
    <section aria-label="参数调整编辑器" className="parameter-adjustments">
      <p>
        选择要调整的能力与参数，填写本次要求。可做单参数对照或组合改进；未调整项沿用现状。
      </p>
      <div className="fields">
        <label>
          调整对象
          <select
            aria-label="调整对象"
            value={group.id}
            onChange={(e) => {
              setGroupId(e.target.value);
              setKey("");
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          调整参数
          <select
            aria-label="调整参数"
            value={parameterKey ?? ""}
            onChange={(e) => setKey(e.target.value)}
          >
            {keys.map((k) => (
              <option key={k} value={k}>
                {label(group, k)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        disabled={!parameterKey || valuesFor(group)[parameterKey] !== undefined}
        onClick={() =>
          setValue(group, parameterKey, group.values[parameterKey])
        }
      >
        加入参数调整
      </button>
      {!adjustments.length ? (
        <p className="note">
          尚未添加参数调整。也可在下方新增机制或设置有来源的故障FIT方案。
        </p>
      ) : (
        <div className="parameter-adjustment-list">
          {adjustments.map(({ group: g, key: k, value }) => {
            const multiplier = percent(g, k) ? 100 : 1;
            return (
              <div className="parameter-adjustment" key={`${g.id}.${k}`}>
                <label>
                  {g.name} · {label(g, k)}
                  <input
                    aria-label={`改进值 ${g.name} · ${label(g, k)}`}
                    type="number"
                    min="0"
                    max={multiplier === 100 ? 100 : undefined}
                    step="any"
                    value={Number((value * multiplier).toFixed(9))}
                    onChange={(e) =>
                      setValue(g, k, Number(e.target.value) / multiplier)
                    }
                  />
                </label>
                <small>
                  现状 {Number((g.values[k] * multiplier).toFixed(9))}
                  {multiplier === 100 ? "%" : ""}
                  {value === g.values[k] ? " · 与现状一致" : " · 本次调整"}
                </small>
                <button
                  type="button"
                  aria-label={`撤销调整 ${g.name} · ${label(g, k)}`}
                  onClick={() => setValue(g, k)}
                >
                  撤销调整
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="note">
        概率与覆盖率按百分比填写；时间单位见参数名。提高能力若增加开销，请同时填写对应成本参数。
      </p>
    </section>
  );
}

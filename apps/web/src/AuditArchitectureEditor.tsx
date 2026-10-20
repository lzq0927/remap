import AuditAtlasExplorer from "./AuditAtlasExplorer";
import { auditSummaryScales } from "../../../packages/contracts/src/audit-presets";
import { useState } from "react";
import AuditHardwareEditor from "./AuditHardwareEditor";
import { hardwareAuditArchitecture } from "../../../packages/contracts/src/audit-hardware";
import {
  defaultAuditArchitecture,
  resolveAuditArchitecture,
  type AuditArchitecture,
  type AuditArchitectureNode,
} from "../../../packages/contracts/src/audit-architecture";
import { architectureBudgets } from "../../../packages/analysis/src/audit-architecture";
import {
  architectureTree,
  architectureCss,
} from "../../../packages/reports/src/audit-architecture";
import { auditReferenceOnly } from "../../../packages/contracts/src/audit-presets";
import type { AuditEventView } from "../../../packages/contracts/src/audit-objects";
import type { AuditRequest } from "../../../packages/analysis/src/audit";

export default function AuditArchitectureEditor({
  request,
  events,
  onChange,
  mode = "structure",
}: {
  request: AuditRequest;
  events: AuditEventView[];
  onChange: (request: AuditRequest) => void;
  mode?: "structure" | "budget";
}) {
  const [expandGraph, setExpandGraph] = useState(false);
  const [showObjects, setShowObjects] = useState(false);
  const [error, setError] = useState("");
  const [relationKind, setRelationKind] = useState<
    "dependency" | "connection" | "shared-domain"
  >("dependency");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [label, setLabel] = useState(""),
    [source, setSource] = useState("");
  let architecture: AuditArchitecture;
  try {
    architecture = resolveAuditArchitecture(request.architecture, events);
  } catch (e) {
    return <p role="alert">架构配置无效：{(e as Error).message}</p>;
  }
  const update = (candidate: AuditArchitecture) => {
    try {
      const next = resolveAuditArchitecture(candidate, events);
      setError("");
      onChange({ ...request, architecture: next });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const patch = (id: string, values: Partial<AuditArchitectureNode>) =>
    update({
      ...architecture,
      nodes: architecture.nodes.map((n) =>
        n.id === id ? { ...n, ...values } : n,
      ),
    });
  const root = architecture.nodes.find((n) => !n.parentId)!;
  const prefix = mode === "budget" ? "分层预算" : "架构";
  const scales = auditSummaryScales(request, [
    request.cards,
    ...(request.scales ?? []),
  ]).filter((cards) => !auditReferenceOnly(request, cards));
  let budgets: { cards: number; values: Map<string, number | null> }[] = [];
  let budgetError = "";
  try {
    budgets = scales.map((cards) => ({
      cards,
      values: architectureBudgets(
        architecture,
        cards,
        request.hours,
        architecture.budgetMethod === "none"
          ? null
          : (1 -
              (cards === request.cards
                ? request.target
                : (request.targets?.[cards] ?? request.target))) *
              request.hours,
      ),
    }));
  } catch (e) {
    budgetError = (e as Error).message;
  }
  return (
    <section
      className="audit-architecture-editor"
      aria-label={mode === "structure" ? "系统架构与故障归属" : "分层目标预算"}
    >
      <style>{architectureCss}</style>
      <h4>
        {mode === "structure" ? "系统架构与故障归属" : "按系统架构查看分层目标"}
      </h4>
      <p className="arch-short-note">
        {mode === "structure"
          ? "按硬件组成逐层确认故障归属。Pod、机柜、超节点顺序可调整；各规模为并列方案，数量、连接与共享故障域分别记录。"
          : "分层损失预算用于定位差距，保持现状FIT与措施参数不变。父层汇总子层；当前默认均分仅为暂定设计参照，不代表专家已确认的模块指标。"}
      </p>
      {mode === "structure" && (
        <AuditAtlasExplorer
          architecture={architecture}
          events={events}
          request={request}
          cards={request.cards}
          onDomainChange={(id, functionalDomain) =>
            patch(id, { functionalDomain })
          }
        />
      )}
      {mode === "structure" && (
        <details>
          <summary>查看系统分层架构图</summary>
          <label className="arch-toggle">
            <input
              type="checkbox"
              aria-label="展开架构对象"
              checked={expandGraph}
              onChange={(e) => setExpandGraph(e.target.checked)}
            />
            展开故障对象
          </label>
          <div
            dangerouslySetInnerHTML={{
              __html: architectureTree(
                architecture,
                undefined,
                undefined,
                expandGraph ? 10 : 1,
              ),
            }}
          />
        </details>
      )}
      {mode === "budget" && (
        <>
          <label>
            分层目标分配方法
            <select
              aria-label="分层目标分配方法"
              value={architecture.budgetMethod}
              onChange={(e) =>
                update({
                  ...architecture,
                  budgetMethod: e.target
                    .value as AuditArchitecture["budgetMethod"],
                })
              }
            >
              <option value="equal">同级均分 · 暂定参照</option>
              <option value="weighted">按设计权重分配</option>
              <option value="agree">AGREE损失预算适配</option>
              <option value="none">暂不分配 · 仅诊断实际损失</option>
            </select>
          </label>
          <p className="note">
            总损失预算 =（1 − 规模目标）×
            评估窗口。AGREE使用设计复杂度与重要度分配，再归一化到总损失预算；这是有限窗口损失适配，最终仍回代完整模型。重要度越高，允许损失越小。
          </p>
          <label className="arch-toggle">
            <input
              type="checkbox"
              aria-label="展开对象预算"
              checked={showObjects}
              onChange={(e) => setShowObjects(e.target.checked)}
            />
            展开对象预算
          </label>
          {budgetError ? (
            <p role="alert">分层预算不可行：{budgetError}</p>
          ) : (
            <div className="table-wrap" tabIndex={0}>
              <table className="arch-budget-table">
                <thead>
                  <tr>
                    <th>层级 / 对象</th>
                    {budgets.map((b) => (
                      <th key={b.cards}>{b.cards.toLocaleString()} 卡 / h</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {architecture.nodes
                    .filter(
                      (n) =>
                        showObjects || !n.parentId || n.parentId === root.id,
                    )
                    .map((n) => (
                      <tr key={n.id}>
                        <th>
                          {n.name}
                          <small className="arch-short-note">
                            {n.parentId
                              ? " ← " +
                                architecture.nodes.find(
                                  (p) => p.id === n.parentId,
                                )?.name
                              : "总体目标"}
                          </small>
                        </th>
                        {budgets.map((b) => (
                          <td key={b.cards}>
                            {b.values.get(n.id)?.toFixed(4) ?? "未分配"}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <details>
        <summary>
          {mode === "structure"
            ? "编辑层级、名称与依据"
            : "编辑分层设计权重与重要度"}
        </summary>
        <div className="arch-editor-actions">
          <button
            type="button"
            onClick={() => update(hardwareAuditArchitecture(events))}
          >
            载入硬件分层模板
          </button>
          <button
            type="button"
            onClick={() => {
              let index = 1;
              while (architecture.nodes.some((n) => n.id === "layer-" + index))
                index++;
              update({
                ...architecture,
                nodes: [
                  ...architecture.nodes,
                  {
                    id: "layer-" + index,
                    name: "新增层级 " + index,
                    parentId: root.id,
                    kind: "subsystem",
                    eventIds: [],
                    weight: 1,
                    importance: 1,
                    source: "用户新增，待补充架构与目标依据",
                  },
                ],
              });
            }}
          >
            新增层级
          </button>
          <button
            type="button"
            onClick={() => update(defaultAuditArchitecture(events))}
          >
            载入功能分组模板
          </button>
        </div>
        <div className="table-wrap" tabIndex={0}>
          <table className="arch-editor-table">
            <thead>
              <tr>
                <th>层级 / 对象</th>
                <th>归属上级</th>
                <th>权重 / 复杂度</th>
                <th>重要度（0–1）</th>
                <th>依据</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {architecture.nodes.map((n) => (
                <tr key={n.id}>
                  <td>
                    <input
                      aria-label={`${prefix}名称 ${n.id}`}
                      value={n.name}
                      onChange={(e) => patch(n.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    {!n.parentId ? (
                      "系统根节点"
                    ) : (
                      <select
                        aria-label={`${prefix}上级 ${n.id}`}
                        value={n.parentId}
                        onChange={(e) =>
                          patch(n.id, { parentId: e.target.value })
                        }
                      >
                        {architecture.nodes
                          .filter(
                            (p) =>
                              p.id !== n.id &&
                              (p.kind === "system" || p.kind === "subsystem") &&
                              !p.eventIds.length,
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <input
                      aria-label={`${prefix}权重 ${n.id}`}
                      type="number"
                      min="0.0001"
                      max="1000000"
                      step="0.1"
                      value={n.weight}
                      onChange={(e) =>
                        patch(n.id, { weight: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${prefix}重要度 ${n.id}`}
                      type="number"
                      min="0.0001"
                      max="1"
                      step="0.05"
                      value={n.importance}
                      onChange={(e) =>
                        patch(n.id, { importance: Number(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${prefix}依据 ${n.id}`}
                      value={n.source}
                      onChange={(e) => patch(n.id, { source: e.target.value })}
                    />
                  </td>
                  <td>
                    {n.parentId &&
                      n.kind !== "overhead" &&
                      !n.eventIds.length &&
                      !architecture.nodes.some((c) => c.parentId === n.id) && (
                        <button
                          type="button"
                          onClick={() =>
                            update({
                              ...architecture,
                              nodes: architecture.nodes.filter(
                                (c) => c.id !== n.id,
                              ),
                              dependencies: architecture.dependencies.filter(
                                (d) => d.from !== n.id && d.to !== n.id,
                              ),
                            })
                          }
                        >
                          删除空层级
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {mode === "structure" && (
        <>
          <AuditHardwareEditor
            architecture={architecture}
            events={events}
            scales={[
              ...new Set([
                request.cards,
                ...(request.scales ?? []),
                ...(request.sensitivity
                  ? [request.sensitivityCards ?? request.cards]
                  : []),
              ]),
            ].sort((a, b) => a - b)}
            onChange={update}
          />
          <details>
            <summary>逐事件调整故障归属</summary>
            <p className="note">
              每个根故障只绑定一个叶节点，上级自动汇总。未归属故障会显式保留，不会从计算中消失。
            </p>
            <div className="table-wrap">
              <table className="arch-editor-table">
                <thead>
                  <tr>
                    <th>故障模式</th>
                    <th>FIT</th>
                    <th>归属叶节点</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <th>{e.id}</th>
                      <td>{e.fit.toFixed(4)}</td>
                      <td>
                        <select
                          aria-label={`故障归属 ${e.id}`}
                          value={
                            architecture.nodes.find((n) =>
                              n.eventIds.includes(e.id),
                            )?.id ?? ""
                          }
                          onChange={(ev) =>
                            update({
                              ...architecture,
                              nodes: architecture.nodes.map((n) => ({
                                ...n,
                                eventIds:
                                  n.id === ev.target.value
                                    ? [...new Set([...n.eventIds, e.id])]
                                    : n.eventIds.filter((id) => id !== e.id),
                              })),
                            })
                          }
                        >
                          {architecture.nodes
                            .filter(
                              (n) =>
                                n.kind !== "overhead" &&
                                !architecture.nodes.some(
                                  (c) => c.parentId === n.id,
                                ),
                            )
                            .map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.name}
                              </option>
                            ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>共同依赖与故障传播关系</summary>
            <p className="note">
              记录保护范围和共同依赖；不会据此新增独立故障或推算额外收益。共因、冗余与传播概率需要相应数据和模型。
            </p>
            <div className="fields">
              <label>
                关系类型
                <select
                  aria-label="架构关系类型"
                  value={relationKind}
                  onChange={(e) =>
                    setRelationKind(e.target.value as typeof relationKind)
                  }
                >
                  <option value="dependency">服务依赖</option>
                  <option value="connection">网络连接</option>
                  <option value="shared-domain">共享故障域</option>
                </select>
              </label>
              <label>
                依赖方
                <select
                  aria-label="架构依赖方"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                >
                  <option value="">请选择</option>
                  {architecture.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                被依赖方
                <select
                  aria-label="架构被依赖方"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                >
                  <option value="">请选择</option>
                  {architecture.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                关系说明
                <input
                  aria-label="架构关系说明"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label>
                关系依据
                <input
                  aria-label="架构关系依据"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={!from || !to || !label || !source}
              onClick={() =>
                update({
                  ...architecture,
                  dependencies: [
                    ...architecture.dependencies,
                    { from, to, label, source, kind: relationKind },
                  ],
                })
              }
            >
              加入依赖关系
            </button>
            {architecture.dependencies.map((d, i) => (
              <p key={i}>
                {architecture.nodes.find((n) => n.id === d.from)?.name} →{" "}
                {architecture.nodes.find((n) => n.id === d.to)?.name}：{d.label}{" "}
                <button
                  type="button"
                  onClick={() =>
                    update({
                      ...architecture,
                      dependencies: architecture.dependencies.filter(
                        (_, j) => i !== j,
                      ),
                    })
                  }
                >
                  移除关系
                </button>
              </p>
            ))}
          </details>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>{prefix}高级配置 JSON（含分规模权重）</summary>
        <p className="note">
          scaleWeights按卡数覆盖同级权重；共同依赖与每个层级的source保留在冻结输入中。
        </p>
        <textarea
          aria-label={`${prefix}高级配置 JSON`}
          className="json"
          defaultValue={JSON.stringify(architecture, null, 2)}
          key={JSON.stringify(architecture)}
          onBlur={(e) => {
            try {
              update(JSON.parse(e.target.value));
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </details>
    </section>
  );
}

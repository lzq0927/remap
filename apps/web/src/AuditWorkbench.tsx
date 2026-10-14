import { optimizationSampling } from "../../../packages/contracts/src/audit-optimization";
import {
  auditLossBudgetLabels,
  auditBudgetDefaults,
} from "../../../packages/analysis/src/audit-design";
import { useEffect, useState } from "react";
import { EventEditor, NumericParameters } from "./AuditEditors";
import type { AuditRequest } from "../../../packages/analysis/src/audit";
import {
  equalLossWeights,
  type LossBudgetMethod,
} from "../../../packages/analysis/src/audit-allocation";
import AuditAllocationEditor from "./AuditAllocationEditor";
import AuditBaselineEditor from "./AuditBaselineEditor";
import AuditEventCatalog from "./AuditEventCatalog";
import AuditReliabilityDiagram from "./AuditReliabilityDiagram";
import { auditDraftEvents } from "../../../packages/contracts/src/audit-objects";
import {
  changeAuditCards,
  auditSamplingPreset,
  auditReferenceMechanisms,
  auditScalePresets,
  auditDefaultTargets,
  auditScaleOrder,
} from "../../../packages/contracts/src/audit-presets";

import {
  auditDraftInput,
  type AuditDraft,
} from "../../../packages/contracts/src/audit-draft";
export {
  auditDraftInput,
  type AuditDraft,
} from "../../../packages/contracts/src/audit-draft";
export default function AuditWorkbench({
  defaults,
  draft,
  onDraftChange,
  events,
  mechanisms,
  busy,
  onRun,
  stage,
}: {
  defaults: AuditRequest;
  draft?: AuditDraft;
  onDraftChange: (draft: AuditDraft) => void;
  events: any[];
  mechanisms: any[];
  busy: boolean;
  onRun: (request: AuditRequest) => void;
  /** Undefined retains the complete configuration editor. */
  stage?: number;
  lastResult?: any;
}) {
  const [request, setRequest] = useState<AuditRequest>(() =>
    structuredClone({
      ...(draft?.request ?? defaults),
      optimization: {
        ...(draft?.request ?? defaults).optimization,
        enabled: false,
      },
    }),
  );
  const [overrides, setOverrides] = useState(draft?.overrides ?? "[]"),
    [hardware, setHardware] = useState(draft?.hardware ?? "[]");
  const [error, setError] = useState("");
  const [editingEvent, setEditingEvent] = useState<string>();
  const [model, setModel] = useState(
    draft?.model ?? JSON.stringify(defaults.model, null, 2),
  );
  const [policy, setPolicy] = useState(
    draft?.policy ?? JSON.stringify(defaults.policy, null, 2),
  );
  const [allScales, setAllScales] = useState(
    draft?.allScales ?? (defaults.scales?.length ?? 0) > 1,
  );
  useEffect(() => {
    onDraftChange({ request, overrides, hardware, model, policy, allScales });
  }, [request, overrides, hardware, model, policy, allScales, onDraftChange]);
  let parsedModel: Record<string, number> | undefined,
    parsedPolicy: Record<string, Record<string, number>> | undefined;
  try {
    parsedModel = JSON.parse(model);
    parsedPolicy = JSON.parse(policy);
  } catch {
    /* keep advanced JSON editable */
  }
  let currentEvents = events;
  try {
    currentEvents = auditDraftEvents(
      events,
      overrides,
      request.baseline?.resolvedEventIds,
    );
  } catch {
    /* Preserve the invalid JSON for correction. */
  }
  let targetEvents = currentEvents;
  try {
    targetEvents = auditDraftEvents(currentEvents, hardware);
  } catch {
    /* Targets remain editable. */
  }
  const descriptions: Record<string, string> = {
    hardDetect: "更早发现中断，减少检测等待。",
    slowDetect: "缩短降速持续时间，恢复正常吞吐。",
    sdcDetect: "发现静默错误，启动正确性恢复。",
    step: "依赖错误检测，回到干净 step。",
    replay: "适用瞬态故障，先尝试局部重执行。",
    process: "局部尝试失败后重新调度进程。",
    elastic: "隔离受影响 DP 域，保留其他域产出。",
    fast: "缩短回滚距离，同时计入保存开销。",
  };
  return (
    <section
      className="paper audit-workbench"
      aria-label="故障事件与机制收益审核"
      hidden={stage === 5}
    >
      <div hidden={stage !== undefined} className="audit-intro">
        <div className="section-head">
          <div>
            <span className="eyebrow">事件 · 机制 · 决策</span>
            <h2>从目标、故障证据到方案决策</h2>
          </div>
          <span className="badge">专家审核口径 · 2026-10-09</span>
        </div>
        <p className="audit-lead">
          哪些故障消耗了训练产出？哪些措施值得组合？在同一组故障假设下比较基线、单项和组合，形成可复核的设计依据。
        </p>
        <div className="audit-context">
          <strong>本次衡量：窗口结束时保留的正确计算进度</strong>
          <span>已注明来源的参考参数 · 当前故障基准 · 机制能力需验证</span>
        </div>
      </div>
      {stage !== undefined && (
        <p className="workspace-context">
          当前设计 · {request.cards.toLocaleString()} 卡 · {request.hours} 小时
          · 可用度目标 {(request.target * 100).toFixed(2)}%
        </p>
      )}
      <div className="audit-stage" hidden={stage !== undefined && stage !== 0}>
        <h3 id="audit-scope" className="audit-step-title">
          01 / 评估范围
        </h3>
        <div className="fields">
          <label>
            采样配置
            <select
              aria-label="采样配置"
              value={request.samplingProfile ?? "custom"}
              onChange={(e) => {
                if (e.target.value === "custom")
                  setRequest({ ...request, samplingProfile: "custom" });
                else {
                  setRequest({
                    ...request,
                    ...auditSamplingPreset(
                      e.target.value as "expert-reproduction" | "quick",
                    ),
                  });
                  setAllScales(true);
                }
              }}
            >
              <option value="expert-reproduction">
                完整采样 · 正式评估（默认）
              </option>
              <option value="quick">快速试算 · 方向探索</option>
              <option value="custom">自定义 / 历史采样</option>
            </select>
          </label>
        </div>
        <details className="audit-help" open={stage === undefined}>
          <summary>采样配置与适用边界</summary>
          <p className="note">
            沿用专家采样量：主场景4000条、Shapley每子集2000条、敏感性每点2000条；五规模曲线、50万卡13点扫描及原始三组种子。快速试算为128
            / 64 /
            128条，不能作为正式达标确认。切换配置保留已编辑目标、故障证据和措施；修改方案后会在报告中列出与专家原始配置的差异。
          </p>
        </details>
        <div className="fields">
          {[
            ["cards", "评估卡数", 1, 1000000],
            ["hours", "评估窗口（小时）", 0.01, 8760],
            ["target", "可用度目标（0–1）", 0, 1],
          ].map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                aria-label={String(label)}
                type="number"
                min={Number(min)}
                max={Number(max)}
                step={key === "target" ? 0.000001 : key === "hours" ? 0.01 : 1}
                value={(request as any)[key]}
                onChange={(e) =>
                  setRequest(
                    key === "cards"
                      ? changeAuditCards(request, Number(e.target.value))
                      : { ...request, [key]: Number(e.target.value) },
                  )
                }
              />
            </label>
          ))}
        </div>
        <details className="audit-help" open={stage === undefined}>
          <summary>规模目标与 MTBF 口径说明</summary>
          <p className="note">
            初始目标以五十万卡 98.5%、参考 MTBF 0.6 小时为锚点， 按 A = MTBF /
            (MTBF + 参考恢复预算) 推导其他规模目标。 参考 MTBF：二十万卡 1.5
            小时、十万卡 3 小时、万卡 30 小时。
            这些仅用于需求推导；实际可用度仍由故障模式
            FIT、措施和时间损失账计算，恢复时间不会被统一替换。
          </p>
          <div className="target-preset-grid">
            {auditScalePresets.map((p) => (
              <div key={p.cards}>
                <b>{(p.cards / 10000).toLocaleString()} 万卡</b>
                <strong>{(p.target * 100).toFixed(2)}%</strong>
                <small>参考 MTBF {p.hardMtbfHours} h</small>
              </div>
            ))}
          </div>
        </details>
        <button
          type="button"
          onClick={() => {
            setRequest({
              ...request,
              cards: 500000,
              target: 0.985,
              targets: { ...auditDefaultTargets },
            });
            setAllScales(true);
          }}
        >
          载入当前四规模初始目标
        </button>
        <div className="fields">
          <label>
            <input
              type="checkbox"
              checked={allScales}
              onChange={(e) => setAllScales(e.target.checked)}
            />
            同时对比五十万卡、二十万卡、十万卡、万卡
          </label>
        </div>
        {allScales && request.samplingProfile && (
          <p className="note">
            规模曲线同时加入1000卡参考点，不额外设定需求目标，也不计入四规模达标汇总。
          </p>
        )}
        {allScales && (
          <div className="fields" aria-label="分规模目标">
            {[...new Set([request.cards, 10000, 100000, 200000, 500000])]
              .sort(auditScaleOrder)
              .filter((n) => n !== request.cards)
              .map((n) => (
                <label key={n}>
                  {n.toLocaleString()} 卡目标（0–1）
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.000001"
                    value={request.targets?.[String(n)] ?? request.target}
                    onChange={(e) =>
                      setRequest({
                        ...request,
                        targets: {
                          ...request.targets,
                          [String(n)]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            <p className="note">
              可分别编辑各规模目标；切换评估卡数保留已编辑目标。其他自定义规模默认沿用当前目标。
            </p>
          </div>
        )}
      </div>
      <div className="audit-stage" hidden={stage !== undefined && stage !== 1}>
        <h3 className="audit-step-title" id="audit-evidence">
          02 / 故障模式
        </h3>
        <label>
          故障模式基准
          <select
            aria-label="故障模式基准"
            value={request.eventCatalogVersion ?? "expert-2026-10-09"}
            onChange={(e) =>
              setRequest({
                ...request,
                eventCatalogVersion: e.target
                  .value as AuditRequest["eventCatalogVersion"],
              })
            }
          >
            <option value="baseline-2026-10-14">
              当前基准 · CORE中断6% / SRAM中断10%
            </option>
            <option value="expert-2026-10-09">
              专家原始基准 · 2026-10-09（历史对照）
            </option>
          </select>
        </label>
        {request.eventCatalogVersion === "baseline-2026-10-14" && (
          <p className="note">
            中断类内：CORE 6%、SRAM
            10%；其余模式按原比例分配剩余84%。CORE、SRAM亚健康分别按原值的6/14、10/5折算，其余亚健康补足本类总量。静默保持原值；三类总量保持96.6%
            / 2% / 1.4%，万卡中断 MTBF 约30小时。逐项更新仍优先使用你填写的值。
          </p>
        )}
        <AuditEventCatalog
          events={currentEvents}
          onEdit={(id) => {
            setEditingEvent(id);
            const panel = document.getElementById(
              "audit-event-update",
            ) as HTMLDetailsElement;
            if (panel) {
              panel.open = true;
              panel.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }}
        />
        <details id="audit-event-update">
          <summary>更新故障证据与基线 FIT</summary>
          <p>
            只替换明确提供的事件。中断总量或 CORE-hard
            等细分比例变化时，静默和亚健康保留各自已确认值，不随旧比例缩放。零观测不能直接推断零
            FIT。
          </p>
          <p className="note">
            选择故障模式，填写已换算为 NPU 等效运行小时的 FIT
            和证据来源。器件物理 FIT 需要先换算；后续可逐项用观测数据校准。
          </p>
          <EventEditor
            title="基线事件更新"
            events={currentEvents}
            selectedId={editingEvent}
            value={overrides}
            onChange={setOverrides}
          />

          <details>
            <summary>高级：批量更新 JSON</summary>
            <label>
              基线事件更新 JSON
              <textarea
                aria-label="基线事件更新"
                className="json"
                value={overrides}
                onChange={(e) => setOverrides(e.target.value)}
              />
            </label>
          </details>
        </details>
      </div>
      <div className="audit-stage" hidden={stage !== undefined && stage !== 2}>
        <section id="audit-budget" aria-label="损失预算分配">
          <h3 className="audit-step-title">03 / 可用度分配</h3>
          <div className="round-flow">
            <div>
              <b>第一轮 · 评估现状</b>
              <span>原六项与现状参数固定，先看真实建模结果</span>
            </div>
            <span aria-hidden="true">→</span>
            <div>
              <b>第二轮 · 分配与改进</b>
              <span>第一轮完成后，单独生成AGREE建议，再点击评估</span>
            </div>
          </div>
          <p>
            第一轮不预先分配指标，也不自动采用99.5%等改进目标。评估完成后，可在“分轮评估与横向比较”中调整或新增措施，逐次计算与导出报告。
          </p>
          <details
            className="audit-help"
            open={
              !!request.submodelAllocation ||
              (request.lossBudgetMethod !== undefined &&
                request.lossBudgetMethod !== "none")
            }
          >
            <summary>高级：独立子模型与第一轮损失预算</summary>
            <p className="note">
              第一轮现状评估默认不做分配。以下保留历史任务与专项设计的手动分配功能。
            </p>
            <AuditAllocationEditor
              request={request}
              events={currentEvents}
              onChange={setRequest}
              onApplyHardware={setHardware}
            />
            <h4>检测恢复与运行损失预算</h4>
            <label>
              训练损失预算分配方法
              <select
                aria-label="训练损失预算分配方法"
                value={request.lossBudgetMethod ?? "custom"}
                onChange={(e) =>
                  setRequest({
                    ...request,
                    lossBudgetMethod: e.target.value as LossBudgetMethod,
                    lossBudgetWeights:
                      e.target.value === "baseline-proportional" ||
                      e.target.value === "none"
                        ? undefined
                        : e.target.value === "equal"
                          ? { ...equalLossWeights }
                          : (request.lossBudgetWeights ?? {
                              ...equalLossWeights,
                            }),
                  })
                }
              >
                <option value="none">第一轮不分配 · 固定现状</option>
                <option value="equal">均分六项损失预算</option>
                <option value="baseline-proportional">
                  按本次基线损失比例分配
                </option>
                <option value="custom">用户指定权重</option>
              </select>
            </label>
            {request.lossBudgetMethod === "baseline-proportional" && (
              <p className="note">
                先计算各规模基线，再按损失比例冻结预算，随后评估措施。最终报告列出实际权重与预算。
              </p>
            )}
            <p>
              允许总损失 =（1 − 目标）× 窗口。六项预算用于追踪缺口，不是直接降低
              FIT 的比例；工程措施需再经正向仿真验证。
            </p>
            <p>
              当前规模允许损失{" "}
              <strong>
                {((1 - request.target) * request.hours).toFixed(3)} 小时
              </strong>
              {request.lossBudgetMethod !== "none" &&
                request.lossBudgetMethod !== "baseline-proportional" && (
                  <>
                    ；权重合计{" "}
                    <strong>
                      {(
                        Object.values(request.lossBudgetWeights ?? {}).reduce(
                          (a, b) => a + b,
                          0,
                        ) * 100
                      ).toFixed(2)}
                      %
                    </strong>
                    （需为 100%）。
                  </>
                )}
            </p>
            {request.lossBudgetMethod !== "none" &&
              request.lossBudgetMethod !== "baseline-proportional" && (
                <div className="fields">
                  {Object.entries(auditLossBudgetLabels).map(([id, name]) => (
                    <label key={id}>
                      {name}预算（%）
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        disabled={
                          request.lossBudgetMethod === "baseline-proportional"
                        }
                        value={
                          Math.round(
                            (request.lossBudgetWeights?.[id] ?? 0) * 10000,
                          ) / 100
                        }
                        onChange={(e) =>
                          setRequest({
                            ...request,
                            lossBudgetMethod: "custom",
                            lossBudgetWeights: {
                              ...request.lossBudgetWeights,
                              [id]: Number(e.target.value) / 100,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            <button
              onClick={() =>
                setRequest({
                  ...request,
                  lossBudgetMethod: "custom",
                  lossBudgetWeights: { ...auditBudgetDefaults },
                })
              }
            >
              载入参考预算
            </button>
            <p className="note">
              参考权重为设计假设，请按产品优先级调整并在流程中确认。
            </p>
          </details>
        </section>
      </div>
      <div className="audit-stage" hidden={stage !== undefined && stage !== 3}>
        <h3 className="audit-step-title" id="audit-mechanisms">
          04 / 可靠性措施
        </h3>
        <p className="note">
          第一轮固定现有措施与参数，评估现状。第二轮再比较参数改进和新增机制。
          降低 FIT 会提高 MTBF；检测、恢复、隔离和检查点策略减少恢复及进度损失。
        </p>
        <details className="hardware-target-editor">
          <summary>硬件降 FIT · 设计目标与来源</summary>
          <EventEditor
            title="硬件改进目标"
            events={currentEvents}
            value={hardware}
            onChange={setHardware}
          />
          <details>
            <summary>高级：硬件目标 JSON</summary>
            <label>
              硬件改进目标 JSON
              <textarea
                aria-label="硬件目标更新"
                className="json"
                value={hardware}
                onChange={(e) => setHardware(e.target.value)}
              />
            </label>
          </details>
        </details>
        <AuditBaselineEditor
          request={request}
          onChange={setRequest}
          events={events}
          mechanisms={mechanisms}
        />
        <fieldset className="mechanism-picker">
          <legend>第一轮：现状组合措施</legend>
          <button
            type="button"
            onClick={() =>
              setRequest({
                ...request,
                mechanisms: mechanisms.map((m) => m.id),
              })
            }
          >
            选择全部可用候选
          </button>
          <p className="note">
            勾选措施用于组合评估；每个单项也会独立计算，避免把单项收益直接相加。
            默认采用专家六项对照方案；中断检测与亚健康检测增强为额外候选，常规CKPT和人工兜底已包含于基线。
          </p>
          <button
            type="button"
            onClick={() => {
              setRequest({
                ...request,
                mechanisms: [...auditReferenceMechanisms],
                recoveryOrder: ["replay", "elastic", "process"],
              });
              const selectedCodes = mechanisms
                .filter((m) => auditReferenceMechanisms.includes(m.id))
                .map((m) => m.code);
              setPolicy(
                JSON.stringify(
                  {
                    ...parsedPolicy,
                    ...Object.fromEntries(
                      selectedCodes.map((code) => [
                        code,
                        defaults.policy?.[code],
                      ]),
                    ),
                  },
                  null,
                  2,
                ),
              );
            }}
          >
            载入专家六项及参数
          </button>
          <div className="mechanism-grid">
            {mechanisms.map((m) => (
              <label
                key={m.id}
                className={
                  request.mechanisms?.includes(m.id)
                    ? "mechanism-option selected"
                    : "mechanism-option"
                }
              >
                <input
                  type="checkbox"
                  checked={
                    (request.mechanisms?.includes(m.id) ?? false) ||
                    !!request.baseline?.mechanisms?.includes(m.id)
                  }
                  disabled={request.baseline?.mechanisms?.includes(m.id)}
                  onChange={(e) =>
                    setRequest({
                      ...request,
                      mechanisms: e.target.checked
                        ? [...(request.mechanisms ?? []), m.id]
                        : (request.mechanisms ?? []).filter(
                            (id) => id !== m.id,
                          ),
                    })
                  }
                />
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.effect}</small>
                  <small>{descriptions[m.id]}</small>
                  {request.baseline?.mechanisms?.includes(m.id) && (
                    <small>已部署 · 固定基线，不参与新增排序</small>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="note">
          Shapley
          的加入顺序用于分摊收益，物理恢复顺序在第五步“参数核对”中设置。无检测时
          step 不能自行发现静默错误；机制改变后果，不自动降低源 FIT。
        </p>
        <details className="diagram-preview">
          <summary>预览可靠性框图与措施覆盖</summary>
          <AuditReliabilityDiagram
            events={currentEvents}
            candidateEvents={targetEvents}
            mechanisms={mechanisms}
            selectedMechanisms={[
              ...(request.mechanisms ?? []),
              ...(request.baseline?.mechanisms ?? []),
            ]}
          />
        </details>
        <details>
          <summary>第一轮现状机制参数</summary>
          <p>默认使用原六项参数。99.5%等目标在第一轮完成后的改进方案中填写。</p>
          <div className="fields">
            {[
              {
                code: "D-SDC",
                key: "coverage",
                label: "现状静默检出覆盖率（%）",
                percent: true,
              },
              {
                code: "D-SDC",
                key: "detectSeconds",
                label: "现状静默发现时延（秒）",
              },
              {
                code: "C-FAST",
                key: "saveSeconds",
                label: "现状检查点保存阻塞（秒）",
              },
              {
                code: "C-FAST",
                key: "computeSeconds",
                label: "现状检查点周期（秒）",
              },
            ].map((field) => (
              <label key={field.label}>
                {field.label}
                <input
                  aria-label={field.label}
                  type="number"
                  min="0"
                  max={field.percent ? 100 : 31536000}
                  step="any"
                  value={
                    (parsedPolicy?.[field.code]?.[field.key] ??
                      defaults.policy?.[field.code]?.[field.key] ??
                      0) * (field.percent ? 100 : 1)
                  }
                  onChange={(e) =>
                    setPolicy(
                      JSON.stringify(
                        {
                          ...parsedPolicy,
                          [field.code]: {
                            ...parsedPolicy?.[field.code],
                            [field.key]:
                              Number(e.target.value) /
                              (field.percent ? 100 : 1),
                          },
                        },
                        null,
                        2,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
        </details>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="audit-stage" hidden={stage !== undefined && stage !== 4}>
        <div className="audit-run-summary" id="audit-run">
          <div>
            <strong>05 / 第一轮现状评估</strong>
            <p>
              {
                (request.mechanisms ?? []).filter(
                  (id) => !request.baseline?.mechanisms?.includes(id),
                ).length
              }{" "}
              项新增候选 · {request.baseline?.mechanisms?.length ?? 0}{" "}
              项已部署基线措施 · {request.trials} 条轨迹 / 场景
              {request.attribution
                ? ` · Shapley ${2 ** (request.mechanisms ?? []).filter((id) => !request.baseline?.mechanisms?.includes(id)).length} 个剩余候选子集 × ${request.attributionTrials} 条轨迹`
                : " · 未开启收益分摊"}
            </p>
            <small>
              轨迹越多，采样区间通常越稳定；它不能替代真实参数校准。
            </small>
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              try {
                const input = auditDraftInput({
                  request,
                  overrides,
                  hardware,
                  model,
                  policy,
                  allScales,
                });
                setError("");
                onRun(input);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {busy ? "正在计算第一轮…" : "运行可靠性评估"}
          </button>
        </div>
        <p className="note">
          本次只计算第一轮现状；不会自动生成或评估第二轮。前四步确认后，运行将关联正式流程。结果保留输入快照，
          在“实验与报告”下载完整 HTML。正式交付仍需人工确认。
        </p>
      </div>
      <div
        className="audit-stage audit-parameter-stage"
        hidden={stage !== undefined && stage !== 4}
      >
        <details id="audit-parameters" className="parameter-review">
          <summary>
            <span>参数核对</span>
            <small>采样与复核、基线参数、机制能力及成本 · 按需展开</small>
          </summary>
          <h3>采样与复核</h3>
          <div className="fields">
            {[
              ["trials", "每场景轨迹数", 2, 8192],
              ["seed", "评估随机种子", 0, 4294967295],
              ["attributionTrials", "每组合轨迹数", 2, 2048],
              ["sensitivityTrials", "每扫描点轨迹数", 2, 8192],
              ["sensitivityCards", "敏感性扫描卡数", 1, 1000000],
              ["attributionSeed", "Shapley随机种子", 0, 4294967295],
              ["sensitivitySeed", "敏感性随机种子", 0, 4294967295],
            ].map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={String(label)}
                  type="number"
                  min={Number(min)}
                  max={Number(max)}
                  step="1"
                  value={
                    (request as any)[key] ??
                    (key === "sensitivityTrials"
                      ? request.trials
                      : key === "sensitivityCards"
                        ? request.cards
                        : request.seed)
                  }
                  onChange={(e) =>
                    setRequest({
                      ...request,
                      samplingProfile: "custom",
                      [key]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          {request.optimization?.enabled && (
            <details className="audit-help">
              <summary>第二轮筛选与贡献采样</summary>
              <p>
                复评沿用下方独立复核轨迹数。增加归因轨迹与排列可检查排名稳定性；低采样或置信区间跨零时不要把名次当作确定结论。
              </p>
              <div className="fields">
                {(
                  [
                    ["screeningTrials", "第二轮筛选轨迹数", 256],
                    ["attributionTrials", "第二轮归因轨迹数", 128],
                    ["permutations", "第二轮 Shapley 排列数", 32],
                  ] as const
                ).map(([key, label, max]) => (
                  <label key={key}>
                    {label}
                    <input
                      aria-label={label}
                      type="number"
                      min="2"
                      max={max}
                      step="1"
                      value={optimizationSampling(request)[key]}
                      onChange={(e) =>
                        setRequest({
                          ...request,
                          optimization: {
                            ...request.optimization!,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          )}
          <div className="fields">
            <label>
              置信区间口径
              <select
                aria-label="置信区间口径"
                value={request.confidenceMethod ?? "student-t"}
                onChange={(e) =>
                  setRequest({
                    ...request,
                    samplingProfile: "custom",
                    confidenceMethod: e.target
                      .value as AuditRequest["confidenceMethod"],
                  })
                }
              >
                <option value="normal-1.96">专家原报告 · 1.96正态近似</option>
                <option value="student-t">Student-t近似</option>
              </select>
            </label>
            <label>
              独立复核轨迹数
              <input
                type="number"
                min="2"
                max="2048"
                value={request.verificationTrials ?? 64}
                aria-label="独立复核轨迹数"
                onChange={(e) =>
                  setRequest({
                    ...request,
                    verificationTrials: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              敏感性比较口径
              <select
                aria-label="敏感性比较口径"
                value={request.sensitivityMode ?? "legacy"}
                disabled={request.sensitivity === false}
                onChange={(e) =>
                  setRequest({
                    ...request,
                    sensitivityMode:
                      e.target.value === "legacy"
                        ? undefined
                        : (e.target.value as AuditRequest["sensitivityMode"]),
                  })
                }
              >
                {request.sensitivityMode === undefined && (
                  <option value="legacy">
                    历史扫描：所选组合的五个静默参数点
                  </option>
                )}
                <option value="expert-reproduction">
                  专家原始13点：静默检出率、弹性暂停、step上限
                </option>
                <option value="expert-reference">
                  扩展16点：增加静默漏检兜底时延
                </option>
                <option value="selected-combination">
                  所选组合：保持已选措施进行扫描
                </option>
              </select>
            </label>
            <label>
              物理恢复顺序
              <select
                aria-label="物理恢复顺序"
                value={request.recoveryOrder?.join(",")}
                onChange={(e) =>
                  setRequest({
                    ...request,
                    recoveryOrder: e.target.value.split(","),
                  })
                }
              >
                <option value="replay,elastic,process">
                  重执行 → 弹性 → 进程
                </option>
                <option value="replay,process,elastic">
                  重执行 → 进程 → 弹性
                </option>
                <option value="elastic,replay,process">
                  弹性 → 重执行 → 进程
                </option>
                <option value="elastic,process,replay">
                  弹性 → 进程 → 重执行
                </option>
                <option value="process,replay,elastic">
                  进程 → 重执行 → 弹性
                </option>
                <option value="process,elastic,replay">
                  进程 → 弹性 → 重执行
                </option>
              </select>
            </label>
          </div>
          <fieldset className="analysis-options">
            <legend>可选分析与复核</legend>
            {[
              [
                "attribution",
                "计算组合 Shapley 与交互",
                "比较措施组合并解释收益分摊；计算量随候选数量增加。",
                true,
              ],
              [
                "sensitivity",
                "启用参数敏感性扫描",
                "扫描关键参数，识别哪些假设最影响可用度。",
                true,
              ],
              [
                "verifyRecommendation",
                "独立种子复核建议组合",
                "用未参与筛选的样本复核候选，减少偶然达标的影响。",
                false,
              ],
            ].map(([key, title, description, fallback]) => (
              <label className="analysis-option" key={String(key)}>
                <input
                  type="checkbox"
                  checked={(request as any)[String(key)] ?? fallback}
                  onChange={(e) =>
                    setRequest({ ...request, [String(key)]: e.target.checked })
                  }
                />
                <span>
                  <strong>{String(title)}</strong>
                  <small>{String(description)}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <h3>当前基线</h3>
          {parsedModel && (
            <NumericParameters
              prefix="基线"
              value={parsedModel}
              onChange={(v) => setModel(JSON.stringify(v, null, 2))}
            />
          )}
          <h3>机制目标</h3>
          {parsedPolicy &&
            mechanisms
              .filter((m) => request.mechanisms?.includes(m.id))
              .map((m) => (
                <details key={m.id} className="mechanism-parameters">
                  <summary>{m.name} · 编辑目标参数</summary>
                  <NumericParameters
                    prefix={m.name}
                    value={parsedPolicy![m.code] ?? {}}
                    onChange={(v) =>
                      setPolicy(
                        JSON.stringify(
                          { ...parsedPolicy, [m.code]: v },
                          null,
                          2,
                        ),
                      )
                    }
                  />
                </details>
              ))}
          <details>
            <summary>高级 JSON 参数</summary>
            <div className="fields">
              <label>
                基线参数 JSON
                <textarea
                  aria-label="审核基线参数"
                  className="json"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
              <label>
                机制目标 JSON
                <textarea
                  aria-label="审核机制参数"
                  className="json"
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value)}
                />
              </label>
            </div>
          </details>
          <h3>工程成本（可选）</h3>
          <div className="fields">
            {mechanisms
              .filter(
                (m) =>
                  request.mechanisms?.includes(m.id) &&
                  !request.baseline?.mechanisms?.includes(m.id),
              )
              .map((m) => (
                <label key={m.id}>
                  {m.name}成本（统一单位，可留空）
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={request.costs?.[m.id] ?? ""}
                    onChange={(e) => {
                      const costs = { ...request.costs };
                      if (e.target.value === "") delete costs[m.id];
                      else costs[m.id] = Number(e.target.value);
                      setRequest({ ...request, costs });
                    }}
                  />
                </label>
              ))}
          </div>
        </details>
      </div>
    </section>
  );
}

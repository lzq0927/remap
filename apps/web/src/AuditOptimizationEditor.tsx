import { useState } from "react";
import type { AuditRequest } from "../../../packages/analysis/src/audit";
import { auditOptimizationDefaults } from "../../../packages/contracts/src/audit-optimization";
import {
  auditExtensionCatalog,
  extensionScenario,
  mechanismStages,
} from "../../../packages/contracts/src/audit-extensions";
import {
  mechanismTargetCatalog,
  automaticExtensionIds,
} from "../../../packages/contracts/src/audit-mechanism-targets";
import { auditScalePresets } from "../../../packages/contracts/src/audit-presets";
import { EventEditor, NumericParameters } from "./AuditEditors";

const mechanismNames: Record<string, string> = {
  hardDetect: "中断检测",
  slowDetect: "亚健康检测",
  sdcDetect: "静默即时检测",
  step: "干净 step 恢复",
  replay: "通信/算子重执行",
  process: "进程重调度",
  elastic: "DP 域弹性恢复",
  fast: "检查点策略",
};
export default function AuditOptimizationEditor({
  request,
  onChange,
  mode,
  defaults,
  lastResult,
  events = [],
}: {
  request: AuditRequest;
  onChange: (r: AuditRequest) => void;
  mode: "allocation" | "mechanisms";
  defaults: AuditRequest;
  lastResult?: any;
  events?: any[];
}) {
  const input = request.optimization ?? {
    ...auditOptimizationDefaults,
    enabled: false,
  };
  const [stage, setStage] = useState("");
  const [query, setQuery] = useState("");
  const [scale, setScale] = useState(request.cards);
  const update = (patch: Partial<typeof input>) =>
    onChange({ ...request, optimization: { ...input, ...patch } });
  if (mode === "allocation")
    return (
      <section className="optimization-editor" aria-label="两轮评估策略">
        <div className="round-flow">
          <div>
            <b>第一轮 · 评估现状</b>
            <span>固定 FIT 与现有六项措施 → 各规模 Shapley</span>
          </div>
          <span aria-hidden="true">→</span>
          <div>
            <b>第二轮 · 分配与改进</b>
            <span>AGREE预算 → 专家机制选择 → 参数反解 → 复评与新排名</span>
          </div>
        </div>
        <p>
          第一轮不要求重新分配既定失效率或措施指标。第二轮以 50
          万卡为主，同时检查其他需求规模；已有任务可保留单轮方式。
        </p>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={input.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          现状未达标时继续第二轮评估
        </label>
        {input.enabled && (
          <>
            <div className="optimization-options">
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={input.autoTune ?? true}
                  onChange={(e) => update({ autoTune: e.target.checked })}
                />
                <span>
                  依据 AGREE 预算推导机制参数
                  <small>
                    先分配损失预算，再反解覆盖率、发现/恢复耗时与保存要求；超出参考值的要求需产品论证。
                  </small>
                </span>
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={input.exploreExtensions ?? true}
                  onChange={(e) =>
                    update({ exploreExtensions: e.target.checked })
                  }
                />
                <span>
                  按分配缺口逐项筛选专家机制库
                  <small>
                    核对全部16项方案的范围、前提、成本与重叠；报告说明每项为何采用或未采用。
                  </small>
                </span>
              </label>
            </div>
            <p className="note">
              源 FIT 默认保持不变，不再把可用度缺口自动折算为降 FIT
              要求。专家筛查仅作用于适用 SDC 风险，25%
              为待验证单点目标。历史自动 FIT 收紧设置不再执行；显式 FIT
              输入仍需逐项注明来源。
            </p>
            <details className="audit-help">
              <summary>AGREE 如何使用 Shapley，能否修改重要度？</summary>
              <p>
                Shapley 衡量已建模组合的贡献，平台将正贡献转换为 0.2–1
                的工程重要度建议。它不是系统失效条件概率，也不说明该措施一定还有同等改进空间。重要度越高，对应允许损失越少。
              </p>
              <p>
                <code>Rᵢ = 1 − (1 − R*^(nᵢ/Σn))/Eᵢ</code>，再将 −ln Rᵢ
                归一到允许损失预算。先冻结各规模物理路径预算，再结合路径故障到达率推导参数；对象预算用于交叉核对。重要度会改变预算及实际参数要求。
              </p>
              <label>
                调整重要度的规模
                <select
                  aria-label="第二轮重要度规模"
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value))}
                >
                  {[
                    ...new Set([
                      request.cards,
                      ...(request.scales ??
                        auditScalePresets.map((s) => s.cards)),
                    ]),
                  ]
                    .filter(
                      (n) =>
                        n !== 1000 ||
                        request.targets?.[String(n)] !== undefined,
                    )
                    .sort((a, b) => b - a)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString()} 卡
                      </option>
                    ))}
                </select>
              </label>
              <div className="fields">
                {(request.mechanisms ?? []).map((id) => {
                  const prior = lastResult?.optimization?.allocations
                    ?.find((a: any) => a.cards === scale)
                    ?.priorities.find((p: any) => p.id === id);
                  return (
                    <label key={id}>
                      {mechanismNames[id] ?? id} · 重要度
                      <input
                        aria-label={`${scale}卡 ${id}重要度`}
                        type="number"
                        min="0.01"
                        max="1"
                        step="0.01"
                        placeholder={
                          prior
                            ? `上次建议 ${prior.suggestedImportance.toFixed(3)}`
                            : "自动：计算后据该规模贡献生成"
                        }
                        value={input.importance?.[String(scale)]?.[id] ?? ""}
                        onChange={(e) => {
                          const values = {
                            ...input.importance?.[String(scale)],
                          };
                          if (e.target.value === "") delete values[id];
                          else values[id] = Number(e.target.value);
                          update({
                            importance: {
                              ...input.importance,
                              [String(scale)]: values,
                            },
                          });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
              <p className="note">
                留空采用本次计算建议；上次建议仅供参考。复杂度默认取对象中非零
                FIT 故障类型数；历史 NASA 近似 AGREE 保留在下方高级分配中。
              </p>
            </details>
          </>
        )}
      </section>
    );
  const visible = auditExtensionCatalog.filter(
    (m) =>
      (!stage || m.stage === stage) &&
      (!query ||
        (m.name + m.id + m.effect + m.scope)
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const targetField = (p: (typeof mechanismTargetCatalog)[number]) => (
    <label key={p.id}>
      {p.label}
      <input
        aria-label={"第二轮目标 " + p.label}
        type="number"
        min={p.min}
        max={p.max}
        step="any"
        placeholder={String(p.target)}
        value={input.parameterTargets?.[p.id] ?? ""}
        onChange={(e) => {
          const parameterTargets = { ...input.parameterTargets };
          if (e.target.value === "") delete parameterTargets[p.id];
          else parameterTargets[p.id] = Number(e.target.value);
          update({ parameterTargets });
        }}
      />
      <small>{p.source}</small>
    </label>
  );
  const selected = input.extensions ?? [];
  return (
    <section
      className="optimization-editor mechanism-library"
      aria-label="第二轮专家机制库"
    >
      <div className="section-head">
        <div>
          <span className="eyebrow">第二轮 · 候选改进</span>
          <h4>专家机制库 · 16 项</h4>
        </div>
        <span className="badge">已选 {selected.length} 项</span>
      </div>
      <p>
        原有六项主要减少检测、恢复和进度损失，不降低源
        FIT。新增筛查类机制降低适用残余 FIT、提高
        MTBF；其余方案按发生时机与影响分类。
      </p>
      {!input.enabled && (
        <p className="note">
          第二轮当前关闭，可浏览机制库；在“可用度分配”中启用后再计算改进候选。
        </p>
      )}
      <details className="mechanism-targets" open>
        <summary>第二轮参数参考初值（AGREE 将推导实际要求）</summary>
        <p>
          专家机制库和现状参数为参考；99.5%覆盖、0.5秒发现与保存是补充起点。AGREE先分配预算，再反解具体要求，可以严于参考值。最终共同参数采用各规模最严格要求，并独立复评。高级显式参数可锁定，锁定后不足仍显示缺口。
        </p>
        <div className="fields">
          {mechanismTargetCatalog
            .filter((p) =>
              [
                "sdcCoverage",
                "detectSeconds",
                "saveSeconds",
                "elasticSeconds",
              ].includes(p.id),
            )
            .map(targetField)}
        </div>
        <details>
          <summary>补充参考值与检测成本</summary>
          <div className="fields">
            {mechanismTargetCatalog
              .filter(
                (p) =>
                  ![
                    "sdcCoverage",
                    "detectSeconds",
                    "saveSeconds",
                    "elasticSeconds",
                  ].includes(p.id),
              )
              .map(targetField)}
          </div>
        </details>
        <p className="note">
          99.5% 是全系统工程要求，专家 ABFT
          只在指定算子子集成立；不会自动重复叠加一次 ABFT。0.5秒发现时延与漏检
          SDC
          的兜底发现时间分别建模。检查点周期按不同规模比较，保存、回滚与正常态校验开销同时计入。
        </p>
        {(input.exploreExtensions ?? true) && (
          <details>
            <summary>自动比较的专家扩展及假设</summary>
            <p>
              全部机制逐项核对分配缺口，并非全部启用。探索情景：适用比例通常100%（FP8/FP4各50%）、成功率95%、失败额外耗时0，未知正常态开销暂按0、ABFT按0.1%，均需验收。显式选入的机制参数会锁定。
            </p>
            <ul>
              {automaticExtensionIds.map((id) => {
                const m = auditExtensionCatalog.find((m) => m.id === id)!;
                return (
                  <li key={id}>
                    {m.name}（{id}）：{m.change} {m.evidence}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </details>
      <div className="fields library-filters">
        <label>
          处理阶段
          <select
            aria-label="机制处理阶段"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="">全部阶段</option>
            {Object.entries(mechanismStages).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          查找机制
          <input
            aria-label="查找专家机制"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名称、FIT、检测、恢复…"
          />
        </label>
      </div>
      <p className="note">
        加入时会载入专家单点目标与明确标识的探索假设。适用比例、成功率、开销需逐项复核；已部署收益不重复计入。
      </p>
      <div className="extension-grid">
        {visible.map((m) => {
          const item = selected.find((e) => e.id === m.id);
          return (
            <article
              className={item ? "extension-card selected" : "extension-card"}
              key={m.id}
            >
              <div className="extension-heading">
                <div>
                  <span className="badge">
                    {mechanismStages[m.stage]} · {m.effect}
                  </span>
                  <h4>{m.name}</h4>
                  <small>{m.id}</small>
                </div>
                <button
                  type="button"
                  disabled={!input.enabled}
                  aria-label={(item ? "移除" : "加入") + m.name}
                  onClick={() =>
                    update({
                      extensions: item
                        ? selected.filter((e) => e.id !== m.id)
                        : [...selected, extensionScenario(m.id)],
                    })
                  }
                >
                  {item ? "移除" : "加入第二轮"}
                </button>
              </div>
              <p>{m.change}</p>
              <details>
                <summary>原理、适用事件与重叠约束</summary>
                <p>{m.principle}</p>
                <p>
                  <b>适用：</b>
                  {m.eventCandidates.join("、") || "检查点或全局恢复阶段"}
                </p>
                <p>
                  <b>前提：</b>
                  {m.prerequisite}
                </p>
                <p>
                  <b>失败：</b>
                  {m.failure}
                </p>
                <p>
                  <b>重叠：</b>
                  {m.overlap}
                </p>
                <p>
                  <b>验收：</b>
                  {m.acceptance}
                </p>
                <p>
                  {m.sources.map((s) => (
                    <a
                      key={s.url}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.title}{" "}
                    </a>
                  ))}
                </p>
              </details>
              {item && (
                <details open className="extension-parameters">
                  <summary>
                    第二轮参数 ·{" "}
                    {item.evidence === "scenario" ? "工程假设" : "已注明证据"}
                  </summary>
                  <div className="fields">
                    {Object.entries(m.parameters).map(([key, p]) => (
                      <label key={key}>
                        {p.label}
                        <input
                          aria-label={m.name + " · " + p.label}
                          type="number"
                          min={p.min}
                          max={p.max}
                          step="any"
                          value={item.parameters[key]}
                          onChange={(e) =>
                            update({
                              extensions: selected.map((old) =>
                                old.id === m.id
                                  ? {
                                      ...old,
                                      parameters: {
                                        ...old.parameters,
                                        [key]: Number(e.target.value),
                                      },
                                    }
                                  : old,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    参数来源
                    <input
                      aria-label={m.name + "参数来源"}
                      value={item.source}
                      onChange={(e) =>
                        update({
                          extensions: selected.map((old) =>
                            old.id === m.id
                              ? { ...old, source: e.target.value }
                              : old,
                          ),
                        })
                      }
                    />
                  </label>
                </details>
              )}
            </article>
          );
        })}
      </div>
      <details className="audit-help">
        <summary>手动修改第二轮现有措施参数</summary>
        <p>
          这里的修改只用于第二轮，第一轮现状保持不变。手动值优先于自动探索值。
        </p>
        {Object.entries(defaults.policy ?? {}).map(([code, values]) => (
          <details key={code}>
            <summary>{code} · 候选参数</summary>
            <NumericParameters
              prefix={"第二轮 " + code}
              value={{ ...values, ...input.policy?.[code] }}
              onChange={(value) =>
                update({ policy: { ...input.policy, [code]: value } })
              }
            />
          </details>
        ))}
        <details>
          <summary>全局恢复与检查点基础参数</summary>
          <NumericParameters
            prefix="第二轮基础参数"
            value={{ ...defaults.model, ...input.model }}
            onChange={(value) => update({ model: value })}
          />
        </details>
        {Object.keys(input.checkpointPeriods ?? {}).length > 0 && (
          <div className="fields">
            {Object.entries(input.checkpointPeriods ?? {}).map(
              ([cards, period]) => (
                <label key={cards}>
                  {Number(cards).toLocaleString()}卡检查点周期（秒）
                  <input
                    aria-label={cards + "卡第二轮检查点周期"}
                    type="number"
                    min="1"
                    step="any"
                    value={period}
                    onChange={(e) =>
                      update({
                        checkpointPeriods: {
                          ...input.checkpointPeriods,
                          [cards]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ),
            )}
          </div>
        )}
        {input.fitTargets?.length ? (
          <p>
            已载入 {input.fitTargets.length} 项第二轮 FIT
            目标；其明细会随冻结输入与报告保存。
          </p>
        ) : null}
        <details>
          <summary>修改第二轮硬件 FIT 目标</summary>
          <p>
            可逐事件调整已载入的工程要求并注明来源；这里不会更新第一轮故障模式。
          </p>
          <EventEditor
            events={events}
            title="第二轮 FIT 目标"
            value={JSON.stringify(input.fitTargets ?? [])}
            onChange={(value) => update({ fitTargets: JSON.parse(value) })}
          />
        </details>
        <button
          type="button"
          onClick={() =>
            update({
              policy: undefined,
              model: undefined,
              fitTargets: undefined,
              checkpointPeriods: undefined,
              parameterTargets: undefined,
            })
          }
        >
          清除手动第二轮参数
        </button>
      </details>
      <p className="note">
        机制组合按事件分支执行，失败回退另计；启动与图准备等同一阶段不叠加节省。
        保存、回滚、检测与恢复共同权衡；未找到达标方案时保留缺口。
      </p>
    </section>
  );
}

import { Fragment, useMemo } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import {
  allocate,
  allocationMethodInfo,
  allocationMethods,
  type AllocationMethod,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import ArchitectureDiagram from "./ArchitectureDiagram";
import { duration, fit, hours, percent } from "./format";
import { Disclosure, Formula, NumberField } from "./ui";

export default function StepAllocate() {
  const { model, analysis, update } = useWorkbench(),
    { allocation, baseline } = analysis,
    method = model.allocation.method,
    info = allocationMethodInfo[method],
    { hours: window, target, overhead } = model.scenario;
  const comparison = useMemo(
    () =>
      (["agree", "arinc", "equal", "min-effort"] as const).map((id) => ({
        id,
        result: allocate(model, id, baseline),
      })),
    [model, baseline],
  );
  const closure =
    allocation.modules.reduce((sum, m) => sum + m.lossHours, 0) +
    allocation.overheadLossHours;
  const maxWeight = Math.max(...allocation.modules.map((m) => m.weight), 1e-9);

  return (
    <div className="rw-stack">
      <div className="rw-grid is-side">
        <section className="rw-card" aria-label="分配方法">
          <h2>损失预算</h2>
          <div className="rw-budget">
            <div>
              <strong>{hours(allocation.lossHours)}</strong>
              <span>
                每 {window} 小时窗口允许的总损失 = {window} × (1 −{" "}
                {percent(target)})
              </span>
            </div>
            <dl>
              <div>
                <dt>可分给各模块的故障损失</dt>
                <dd>{hours(allocation.failureLossHours)}</dd>
              </div>
              <div>
                <dt>
                  公共开销
                  <NumberField
                    label="公共开销占比（%）"
                    value={overhead}
                    factor={100}
                    min={0}
                    max={0.5}
                    digits={3}
                    suffix="%"
                    width={92}
                    onCommit={(v) =>
                      update((d) => void (d.scenario.overhead = v))
                    }
                  />
                </dt>
                <dd>{hours(allocation.overheadLossHours)}</dd>
              </div>
            </dl>
            <p className="rw-hint">
              公共开销是与故障无关的固定损耗，例如保存检查点占用的时间。它先从预算中扣除，不参与分配。
            </p>
            {!allocation.feasible && (
              <p className="rw-alert is-bad" role="alert">
                公共开销已经超过允许的总损失，这个目标无法达到。请降低开销或下调目标。
              </p>
            )}
          </div>

          <h2>分配方法</h2>
          <div className="rw-methods" role="radiogroup" aria-label="分配方法">
            {allocationMethods.map((id) => {
              const item = allocationMethodInfo[id];
              return (
                <label
                  key={id}
                  className={"rw-method" + (id === method ? " is-active" : "")}
                >
                  <input
                    type="radio"
                    name="allocation-method"
                    checked={id === method}
                    onChange={() =>
                      update((d) => void (d.allocation.method = id))
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.summary}</small>
                  </span>
                </label>
              );
            })}
          </div>
          {method === "agree" && (
            <div className="rw-inline-option">
              <span>复杂度 n 取</span>
              <div className="rw-tabs" role="tablist" aria-label="复杂度口径">
                {(
                  [
                    ["fit", "固有失效率"],
                    ["units", "部件数量"],
                  ] as const
                ).map(([id, name]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={model.allocation.complexityBasis === id}
                    className={
                      model.allocation.complexityBasis === id ? "is-active" : ""
                    }
                    onClick={() =>
                      update((d) => void (d.allocation.complexityBasis = id))
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="rw-stack">
          <section className="rw-card" aria-label="分配结果">
            <div className="rw-card-head">
              <h2>各模块的目标</h2>
              <span className="rw-closure">
                <CheckCircle2 size={15} aria-hidden />
                各模块预算 + 公共开销 = {hours(closure)}，与总预算一致
              </span>
            </div>
            <div className="rw-table-wrap">
              <table className="rw-table">
                <thead>
                  <tr>
                    <th>模块</th>
                    {method === "agree" && (
                      <>
                        <th className="is-num">复杂度 n</th>
                        <th className="is-num">重要度 ω</th>
                      </>
                    )}
                    <th>权重</th>
                    <th className="is-num">目标可用度</th>
                    <th className="is-num">损失预算</th>
                    <th>兑现预算的两种方式（任选其一或组合）</th>
                  </tr>
                </thead>
                <tbody>
                  {model.groups.map((group) => {
                    const rows = allocation.modules.filter(
                      (m) => m.groupId === group.id,
                    );
                    if (!rows.length) return null;
                    return (
                      <Fragment key={group.id}>
                        <tr className="rw-group-row">
                          <th colSpan={method === "agree" ? 7 : 5}>
                            {group.name}
                          </th>
                        </tr>
                        {rows.map((row) => {
                          const module = model.modules.find(
                            (m) => m.id === row.id,
                          )!;
                          return (
                            <tr key={row.id}>
                              <td>{row.name}</td>
                              {method === "agree" && (
                                <>
                                  <td className="is-num">
                                    <span className="rw-cell-edit">
                                      <NumberField
                                        label={row.name + " 的复杂度"}
                                        value={row.complexity}
                                        min={1e-6}
                                        max={1e9}
                                        digits={1}
                                        width={84}
                                        onCommit={(v) =>
                                          update((d) => {
                                            d.modules.find(
                                              (m) => m.id === row.id,
                                            )!.complexity = v;
                                          })
                                        }
                                      />
                                      {module.complexity !== null && (
                                        <button
                                          className="rw-icon-button is-small"
                                          title="恢复自动取值"
                                          aria-label={
                                            row.name + " 的复杂度恢复自动取值"
                                          }
                                          onClick={() =>
                                            update((d) => {
                                              d.modules.find(
                                                (m) => m.id === row.id,
                                              )!.complexity = null;
                                            })
                                          }
                                        >
                                          <RotateCcw size={13} />
                                        </button>
                                      )}
                                    </span>
                                  </td>
                                  <td className="is-num">
                                    <NumberField
                                      label={row.name + " 的重要度"}
                                      value={row.importance}
                                      min={0.01}
                                      max={1}
                                      digits={2}
                                      width={64}
                                      onCommit={(v) =>
                                        update((d) => {
                                          d.modules.find(
                                            (m) => m.id === row.id,
                                          )!.importance = v;
                                        })
                                      }
                                    />
                                  </td>
                                </>
                              )}
                              <td>
                                <span className="rw-weight">
                                  {method === "custom" ? (
                                    <NumberField
                                      label={row.name + " 的自定义权重"}
                                      value={
                                        model.allocation.customWeights[
                                          row.id
                                        ] ?? 0
                                      }
                                      min={0}
                                      max={1e6}
                                      digits={3}
                                      width={72}
                                      onCommit={(v) =>
                                        update((d) => {
                                          d.allocation.customWeights[row.id] =
                                            v;
                                        })
                                      }
                                    />
                                  ) : (
                                    <span className="rw-bar">
                                      <span
                                        style={{
                                          width:
                                            (row.weight / maxWeight) * 100 +
                                            "%",
                                        }}
                                      />
                                    </span>
                                  )}
                                  <em>{percent(row.weight, 1)}</em>
                                </span>
                              </td>
                              <td className="is-num is-strong">
                                {percent(row.availability)}
                              </td>
                              <td className="is-num">{hours(row.lossHours)}</td>
                              <td className="rw-ways">
                                {row.minMtbfHours === null ? (
                                  <span className="rw-muted">
                                    该模块暂无故障模式
                                  </span>
                                ) : (
                                  <>
                                    <span>
                                      <b>提 MTBF</b> 每卡 ≤{" "}
                                      {fit(row.maxFitPerCard!)} FIT
                                    </span>
                                    <span>
                                      <b>降 MTTR</b> 单次损失 ≤{" "}
                                      {duration(row.maxMttrHours!)}
                                    </span>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>系统合计</td>
                    {method === "agree" && <td colSpan={2} />}
                    <td>
                      <span className="rw-weight">
                        <em>100%</em>
                      </span>
                    </td>
                    <td className="is-num is-strong">{percent(target)}</td>
                    <td className="is-num">{hours(allocation.lossHours)}</td>
                    <td className="rw-muted">
                      含公共开销 {hours(allocation.overheadLossHours)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {method === "custom" &&
              !Object.values(model.allocation.customWeights).some(
                (v) => v > 0,
              ) && (
                <p className="rw-alert is-warn">
                  还没有填写权重，暂按等分配显示。在“权重”列填入各模块的相对值即可。
                </p>
              )}
          </section>

          <section className="rw-card rw-explain" aria-label="分配依据">
            <h2>为什么这样分配</h2>
            <ol>
              <li>
                <p>
                  任务每运行 1 小时，平均损失 ρ 小时。ρ 是各故障模式的“事件率 ×
                  单次等效损失”之和，对模块可以直接相加。
                </p>
                <Formula>
                  A = (1 − 公共开销) / (1 + ρ)，ρ = Σᵢ λᵢ · MTTRᵢ
                </Formula>
              </li>
              <li>
                <p>
                  由目标反推系统允许的总损失负荷：ρ* = (1 − {percent(overhead)})
                  / {percent(target)} − 1 = {allocation.load.toFixed(4)}。
                </p>
              </li>
              <li>
                <p>
                  按 <strong>{info.name}</strong> 的权重把 ρ* 分给各模块：ρᵢ* =
                  wᵢ · ρ*。权重合计为 1，所以各模块目标合成后恰好回到系统目标。
                </p>
                <Formula>{info.formula}</Formula>
                <ul>
                  {info.reasoning.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {allocation.waterline !== null && (
                  <p>
                    本次解出的统一水位 ρ₀ = {allocation.waterline.toFixed(5)}
                    ，相当于每个被压低的模块可用度{" "}
                    {percent(1 / (1 + allocation.waterline))}。
                  </p>
                )}
              </li>
              <li>
                <p>
                  模块目标可用度 Aᵢ* = 1 / (1 +
                  ρᵢ*)，表示“只有这个模块出故障时”系统能达到的可用度。每个模块的预算可以靠降低故障率兑现，也可以靠缩短单次损失兑现：
                </p>
                <Formula>MTBFᵢ ≥ MTTRᵢ / ρᵢ*　或　MTTRᵢ ≤ ρᵢ* / λᵢ</Formula>
              </li>
            </ol>
            <p className="rw-hint">
              <strong>适用范围：</strong>
              {info.fit}
            </p>
          </section>

          <Disclosure title="对比四种方法的分配结果">
            <div className="rw-table-wrap">
              <table className="rw-table is-compact">
                <thead>
                  <tr>
                    <th>模块</th>
                    <th className="is-num">现状损失</th>
                    {comparison.map((c) => (
                      <th key={c.id} className="is-num">
                        {allocationMethodInfo[c.id as AllocationMethod].name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {baseline.modules.map((module, index) => (
                    <tr key={module.id}>
                      <td>{module.name}</td>
                      <td className="is-num">{hours(module.lossHours)}</td>
                      {comparison.map((c) => (
                        <td
                          key={c.id}
                          className={
                            "is-num" + (c.id === method ? " is-strong" : "")
                          }
                        >
                          {hours(c.result.modules[index].lossHours)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rw-hint">
              表中为各方法分给每个模块的损失预算（小时 /
              窗口）。四种方法的合计相同，差别只在模块之间怎么分。
            </p>
          </Disclosure>
        </div>
      </div>
      <ArchitectureDiagram
        views={["target"]}
        title="架构上的目标"
        hint="把上表的分配结果标到系统架构图上：每处硬件旁是对应模块的目标可用度和损失预算。"
      />
    </div>
  );
}

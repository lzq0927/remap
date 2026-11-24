import { Fragment, useMemo } from "react";
import {
  CheckCircle2,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  allocate,
  allocationMethodInfo,
  allocationMethods,
  consequenceRareLimit,
  consequenceThreshold,
  createEvaluator,
  loadPerTenThousand,
  targetFromCurve,
  type AllocationMethod,
  type CoreModel,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import ArchitectureDiagram from "./ArchitectureDiagram";
import { LineChart, chartInk, chartNeutral, seriesColors } from "./Charts";
import { duration, frequency, hours, percent, scale } from "./format";
import { Disclosure, Formula, NumberField, Status } from "./ui";

/** 修改规模—目标对照后，当前规模的目标跟着曲线走。 */
function syncTarget(draft: CoreModel) {
  const target = targetFromCurve(
    draft.scenario.targetCurve,
    draft.scenario.cards,
  );
  if (target) draft.scenario.target = target;
}

export default function StepAllocate() {
  const { model, analysis, update } = useWorkbench(),
    { allocation, baseline, consequences } = analysis,
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
  const freeModules = allocation.modules.filter((m) => !m.pinned),
    maxWeight = Math.max(...freeModules.map((m) => m.weight), 1e-9),
    columns = method === "agree" ? 8 : 6;
  const setFixed = (id: string, value: number | null) =>
    update((d) => {
      d.modules.find((m) => m.id === id)!.fixedTarget = value;
    });

  return (
    <div className="rw-stack">
      <ScaleTarget />

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
                {allocation.pinnedLoad > allocation.load && allocation.load > 0
                  ? "单独指定的目标已经用完全部预算，其余模块没有预算可分。请收紧指定的目标或下调系统目标。"
                  : "公共开销已经超过允许的总损失，这个目标无法达到。请降低开销或下调目标。"}
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
          <section className="rw-card" aria-label="高后果模块">
            <div className="rw-card-head">
              <h2>单次故障后果很大的模块：单独定目标</h2>
            </div>
            <p className="rw-hint">
              多数故障每周发生很多次、每次损失很小，窗口损失接近平均值，按平均损失分预算即可。少数事件发生得少（每个窗口不到{" "}
              {consequenceRareLimit} 次），但一次就吃掉窗口预算的一大块（这里按
              ≥ {percent(consequenceThreshold, 0)}{" "}
              计）：平均下来很小，可只要发生，这个窗口就不达标。它们该约束的是“发生的概率”，所以目标单独指定，先从总预算里扣除。恢复能力按当前设计计。
            </p>
            {consequences.length === 0 ? (
              <p className="rw-empty">
                按当前设计，没有少见且单次损失达到窗口预算{" "}
                {percent(consequenceThreshold, 0)} 的事件。
              </p>
            ) : (
              <div className="rw-table-wrap">
                <table className="rw-table">
                  <thead>
                    <tr>
                      <th>模块</th>
                      <th className="is-num">最重的一次损失</th>
                      <th className="is-num">占窗口预算</th>
                      <th className="is-num">发生频次</th>
                      <th className="is-num">一个窗口内发生的概率</th>
                      <th>目标</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consequences.map((row) => {
                      const module = model.modules.find(
                          (m) => m.id === row.id,
                        )!,
                        pinned = module.fixedTarget !== null;
                      return (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td className="is-num is-strong">
                            {duration(row.worstLossHours)}
                          </td>
                          <td className="is-num">
                            {percent(row.budgetShare, 0)}
                          </td>
                          <td className="is-num">
                            {frequency(row.eventsPerWindow * (168 / window))}
                          </td>
                          <td className="is-num">
                            {percent(
                              row.windowRisk,
                              row.windowRisk < 0.01 ? 2 : 1,
                            )}
                          </td>
                          <td>
                            {pinned ? (
                              <Status tone="good">
                                已指定 {percent(module.fixedTarget!, 3)}
                              </Status>
                            ) : (
                              <button
                                className="rw-button is-small"
                                onClick={() =>
                                  setFixed(
                                    row.id,
                                    Number(row.suggestedTarget.toFixed(5)),
                                  )
                                }
                              >
                                <Pin size={14} aria-hidden />
                                指定为 {percent(row.suggestedTarget, 3)}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="rw-hint">
              建议值的来历：允许不达标的窗口比例（1 −{" "}
              {percent(model.scenario.passRatio, 0)}
              ）拿出一半，平均分给上面这些模块，换算成各自允许的发生频次，再乘单次损失得到目标。也可以在下表里直接填写，例如供电填
              99.999%。
            </p>
          </section>

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
                    <th>目标可用度</th>
                    <th className="is-num">每周预算</th>
                    <th className="is-num">允许频次</th>
                    <th className="is-num">或单次损失</th>
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
                          <th colSpan={columns}>{group.name}</th>
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
                                    {row.pinned ? (
                                      <span className="rw-muted">—</span>
                                    ) : (
                                      <span className="rw-cell-edit">
                                        <NumberField
                                          label={row.name + " 的复杂度"}
                                          value={row.complexity}
                                          min={1e-6}
                                          max={1e9}
                                          digits={1}
                                          width={76}
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
                                    )}
                                  </td>
                                  <td className="is-num">
                                    {row.pinned ? (
                                      <span className="rw-muted">—</span>
                                    ) : (
                                      <NumberField
                                        label={row.name + " 的重要度"}
                                        value={row.importance}
                                        min={0.01}
                                        max={1}
                                        digits={2}
                                        width={56}
                                        onCommit={(v) =>
                                          update((d) => {
                                            d.modules.find(
                                              (m) => m.id === row.id,
                                            )!.importance = v;
                                          })
                                        }
                                      />
                                    )}
                                  </td>
                                </>
                              )}
                              <td>
                                {row.pinned ? (
                                  <span className="rw-muted">单独指定</span>
                                ) : (
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
                                )}
                              </td>
                              <td>
                                <span className="rw-cell-edit is-left">
                                  {row.pinned ? (
                                    <>
                                      <NumberField
                                        label={row.name + " 的指定目标（%）"}
                                        value={module.fixedTarget!}
                                        factor={100}
                                        min={0.5}
                                        max={0.9999999}
                                        digits={5}
                                        suffix="%"
                                        width={112}
                                        onCommit={(v) => setFixed(row.id, v)}
                                      />
                                      <button
                                        className="rw-icon-button is-small"
                                        title="改回按权重分配"
                                        aria-label={
                                          row.name + " 改回按权重分配"
                                        }
                                        onClick={() => setFixed(row.id, null)}
                                      >
                                        <PinOff size={14} />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <b>{percent(row.availability)}</b>
                                      <button
                                        className="rw-icon-button is-small"
                                        title="单独指定这个模块的目标"
                                        aria-label={
                                          "单独指定 " + row.name + " 的目标"
                                        }
                                        onClick={() =>
                                          setFixed(
                                            row.id,
                                            Number(row.availability.toFixed(5)),
                                          )
                                        }
                                      >
                                        <Pin size={14} />
                                      </button>
                                    </>
                                  )}
                                </span>
                              </td>
                              <td className="is-num">
                                {hours(row.lossHoursPerWeek)}
                              </td>
                              <td className="is-num">
                                {row.maxRatePerWeek === null
                                  ? "—"
                                  : "≤ " + frequency(row.maxRatePerWeek)}
                              </td>
                              <td className="is-num">
                                {row.maxMttrHours === null
                                  ? "—"
                                  : "≤ " + duration(row.maxMttrHours)}
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
                    <td>
                      <b>{percent(target)}</b>
                    </td>
                    <td className="is-num">
                      {hours(allocation.lossHours * (168 / window))}
                    </td>
                    <td colSpan={2} className="rw-muted">
                      含公共开销{" "}
                      {hours(allocation.overheadLossHours * (168 / window))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="rw-hint">
              后两列是兑现预算的两条路，任选其一或组合：保持现状的单次损失不变，把故障频次（每连续运行一周的次数）降到左边的值（提升
              MTBF）；或保持现状的故障频次不变，把单次损失缩短到右边的值（降低
              MTTR）。点模块目标旁的图钉可以改为单独指定。
            </p>
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
                  {allocation.pinnedLoad > 0 &&
                    `单独指定目标的模块先占用 ${allocation.pinnedLoad.toFixed(5)}，余下 ${allocation.freeLoad.toFixed(4)} 分给其余模块。`}
                </p>
              </li>
              <li>
                <p>
                  按 <strong>{info.name}</strong>{" "}
                  的权重把余下的预算分给各模块。权重合计为
                  1，所以各模块目标合成后恰好回到系统目标。
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
                  ρᵢ*)，表示“只有这个模块出故障时”系统能达到的可用度。每个模块的预算可以靠降低故障频次兑现，也可以靠缩短单次损失兑现：
                </p>
                <Formula>
                  每周损失预算 = 故障频次 × 单次等效损失　⇒　频次 ≤ 预算 /
                  单次损失　或　单次损失 ≤ 预算 / 频次
                </Formula>
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
              窗口）。四种方法的合计相同，差别只在模块之间怎么分；单独指定目标的模块在四种方法下相同。
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

/** 规模与目标：不同规模下的目标，以及它们之间的换算关系。 */
function ScaleTarget() {
  const { model, update } = useWorkbench(),
    { cards, target } = model.scenario;
  const curve = [...model.scenario.targetCurve].sort(
    (a, b) => a.cards - b.cards,
  );
  const chart = useMemo(() => {
    const scales = new Set<number>();
    for (let i = 0; i <= 24; i++)
      scales.add(Math.round(10000 * 10 ** ((i / 24) * 2)));
    for (const p of curve) scales.add(p.cards);
    scales.add(cards);
    const list = [...scales].sort((a, b) => a - b),
      enabled = new Set(
        model.measures.filter((m) => m.enabled).map((m) => m.id),
      );
    return list.map((n) => {
      const evaluate = createEvaluator({
        ...model,
        scenario: { ...model.scenario, cards: n },
      });
      return {
        cards: n,
        target: targetFromCurve(curve, n),
        baseline: evaluate(new Set()),
        design: evaluate(enabled),
      };
    });
  }, [model]);
  const fromCurve = targetFromCurve(curve, cards);
  return (
    <section className="rw-card" aria-label="规模与目标">
      <div className="rw-card-head">
        <h2>规模与目标</h2>
        <span className="rw-muted">
          当前 {scale(cards)}，目标 {percent(target)}
        </span>
      </div>
      <div className="rw-grid is-scale">
        <div>
          <div className="rw-table-wrap">
            <table className="rw-table is-edit">
              <thead>
                <tr>
                  <th>规模</th>
                  <th>可用度目标</th>
                  <th className="is-num">每万卡损失负荷</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {curve.map((point) => {
                  const at = model.scenario.targetCurve.indexOf(point);
                  return (
                    <tr key={point.cards}>
                      <td>
                        <NumberField
                          label={`${scale(point.cards)} 这一行的规模（卡）`}
                          value={point.cards}
                          min={1}
                          max={10000000}
                          digits={0}
                          suffix="卡"
                          width={128}
                          onCommit={(v) =>
                            update((d) => {
                              d.scenario.targetCurve[at].cards = Math.round(v);
                              syncTarget(d);
                            })
                          }
                        />
                      </td>
                      <td>
                        <NumberField
                          label={`${scale(point.cards)} 的可用度目标（%）`}
                          value={point.target}
                          factor={100}
                          min={0.01}
                          max={0.99999}
                          digits={3}
                          suffix="%"
                          width={104}
                          onCommit={(v) =>
                            update((d) => {
                              d.scenario.targetCurve[at].target = v;
                              syncTarget(d);
                            })
                          }
                        />
                      </td>
                      <td className="is-num">
                        {(loadPerTenThousand(point) * 1000).toFixed(3)} ‰
                      </td>
                      <td>
                        <button
                          className="rw-icon-button"
                          aria-label={`删除 ${scale(point.cards)} 的目标`}
                          title="删除"
                          onClick={() =>
                            update((d) => {
                              d.scenario.targetCurve.splice(at, 1);
                              syncTarget(d);
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            className="rw-button"
            disabled={curve.length >= 12}
            onClick={() =>
              update((d) => {
                const used = new Set(
                  d.scenario.targetCurve.map((p) => p.cards),
                );
                let next = d.scenario.cards;
                while (used.has(next)) next = Math.round(next * 2);
                d.scenario.targetCurve.push({
                  cards: next,
                  target:
                    targetFromCurve(d.scenario.targetCurve, next) ??
                    d.scenario.target,
                });
              })
            }
          >
            <Plus size={15} aria-hidden />
            添加一个规模
          </button>
          {fromCurve !== null && Math.abs(fromCurve - target) > 1e-9 && (
            <p className="rw-alert is-warn">
              按上表换算，{scale(cards)} 的目标是 {percent(fromCurve)}
              ，与当前目标 {percent(target)} 不同。
              <button
                className="rw-link"
                onClick={() => update((d) => syncTarget(d))}
              >
                改用换算值
              </button>
            </p>
          )}
          <div className="rw-explain is-inline">
            <p>
              <strong>目标为什么不随规模线性变化。</strong>
              故障次数与卡数成正比，所以损失负荷 r = 1/A − 1
              与规模成正比，而不是可用度本身：
            </p>
            <Formula>A(N) = 1 / (1 + k · N)</Formula>
            <p>
              k
              是每张卡带来的损失负荷，代表一个可靠性水平。把上表各行换算成“每万卡损失负荷”就能直接比较：
              {curve.length >= 2 &&
                `${scale(curve[0].cards)} 的 ${percent(curve[0].target)} 与 ${scale(curve[curve.length - 1].cards)} 的 ${percent(curve[curve.length - 1].target)}，对应 ${(loadPerTenThousand(curve[0]) * 1000).toFixed(2)}‰ 与 ${(loadPerTenThousand(curve[curve.length - 1]) * 1000).toFixed(2)}‰，${
                  Math.abs(
                    loadPerTenThousand(curve[0]) /
                      loadPerTenThousand(curve[curve.length - 1]) -
                      1,
                  ) < 0.15
                    ? "两者几乎相同，说明是同一个单卡可靠性水平在不同规模下的体现。"
                    : "两者不同，说明不同规模对单卡可靠性的要求不一样。"
                }`}
              其它规模的目标按 k 对规模的对数插值得到，表外沿用端点的 k。
            </p>
          </div>
        </div>
        <div>
          <LineChart
            label="规模与可用度：目标曲线、现状与设计后"
            xLabel="规模（卡，对数刻度）"
            yLabel="可用度"
            xLog
            xTicks={[10000, 30000, 100000, 300000, 1000000]}
            formatX={(v) => scale(v)}
            formatY={(v) => percent(v, 1)}
            yMax={1}
            vertical={[{ x: cards, label: "当前 " + scale(cards) }]}
            series={[
              {
                name: "目标",
                color: chartInk,
                dashed: true,
                points: chart
                  .filter((p) => p.target !== null)
                  .map((p) => ({ x: p.cards, y: p.target! })),
                marks: curve.map((p) => ({ x: p.cards, y: p.target })),
              },
              {
                name: "现状",
                color: chartNeutral,
                points: chart.map((p) => ({ x: p.cards, y: p.baseline })),
              },
              {
                name: "设计后",
                color: seriesColors[0],
                points: chart.map((p) => ({ x: p.cards, y: p.design })),
              },
            ]}
          />
          <p className="rw-hint">
            同一套故障率和恢复能力放到不同规模下的可用度。现状与设计后的曲线随规模下降，是因为故障次数随卡数增加；固定数量的部件（如机房供配电）不随规模变化。圆点是上表给定的目标。
          </p>
        </div>
      </div>
    </section>
  );
}

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Timer, Trash2, TrendingUp } from "lucide-react";
import {
  diagramSlotNames,
  diagramSlots,
  faultKindNames,
  faultKinds,
  layerPotential,
  lossPerEvent,
  type FaultKind,
  type FaultMode,
  type ModuleGap,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import ArchitectureDiagram from "./ArchitectureDiagram";
import RecoveryChain, { ComputationTrace, LadderEditor } from "./RecoveryChain";
import { blankMode, blankModule, dropModes, dropModule } from "./helpers";
import { duration, fit, frequency, hours, percent, times } from "./format";
import {
  Disclosure,
  Drawer,
  DurationField,
  Formula,
  NumberField,
  Status,
  TextField,
  useTooltip,
  type Tone,
} from "./ui";

const gapTone = (gap: ModuleGap): Tone =>
  gap.status === "met" ? "good" : gap.status === "near" ? "warn" : "bad";
export const usageText = (gap: ModuleGap) =>
  gap.usage <= 1
    ? "占用预算 " + percent(gap.usage, 0)
    : "超预算 " + times(gap.usage);

/** 排名条：同一色的横条，按数值从大到小。 */
function RankBars({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: {
    id: string;
    name: string;
    value: number;
    text: string;
    share: number;
  }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1e-12);
  return (
    <section className="rw-card" aria-label={title}>
      <h2>{title}</h2>
      <ul className="rw-rank">
        {rows.map((row) => (
          <li key={row.id}>
            <span>{row.name}</span>
            <span className="rw-rank-track">
              <span
                style={{ width: Math.max(1, (row.value / max) * 100) + "%" }}
              />
            </span>
            <em>
              {row.text}
              <small>{percent(row.share, 0)}</small>
            </em>
          </li>
        ))}
      </ul>
      <p className="rw-hint">{hint}</p>
    </section>
  );
}

/**
 * 差距从哪边补：每个模块三根横条，分别是“只降频次”“只缩短单次损失”“两边都做”
 * 能把损失从现状压到预算的多少倍。横轴是对数刻度的“损失 ÷ 预算”，1× 就是预算线。
 */
function LeverSection({ onSelect }: { onSelect: (id: string) => void }) {
  const { model, analysis } = useWorkbench(),
    tooltip = useTooltip(),
    [all, setAll] = useState(false);
  const potential = useMemo(() => layerPotential(model), [model]);
  const rows = analysis.baselineGaps
    .map((gap) => {
      const reach = potential.get(gap.id) ?? {
          component: 0,
          system: 0,
          both: 0,
        },
        now = gap.usage;
      return {
        id: gap.id,
        name: gap.name,
        now,
        component: now * (1 - reach.component),
        system: now * (1 - reach.system),
        both: now * (1 - reach.both),
        cut: reach,
        budgetHours: gap.budgetHours,
      };
    })
    .filter((row) => Number.isFinite(row.now) && row.now > 0)
    .sort((a, b) => b.now - a.now);
  if (!rows.length) return null;
  const over = rows.filter((row) => row.now > 1),
    shown = all || !over.length ? rows : over,
    values = rows.flatMap((r) => [r.now, r.component, r.system, r.both]),
    floor = 0.01,
    low = Math.floor(
      Math.log10(
        Math.max(floor, Math.min(0.5, ...values.filter((v) => v > 0))),
      ),
    ),
    // 右侧留出写“现状倍数”的位置
    high = Math.log10(Math.max(2, ...values)) + 0.45,
    at = (value: number) =>
      ((Math.log10(Math.max(value, 10 ** low)) - low) / (high - low)) * 100,
    ticks = Array.from(
      { length: Math.floor(high) - low + 1 },
      (_, i) => 10 ** (low + i),
    ),
    tickText = (value: number) =>
      value >= 1
        ? value.toFixed(0) + "×"
        : String(Number(value.toPrecision(1))) + "×",
    multiple = (value: number) =>
      value >= 100
        ? value.toFixed(0) + "×"
        : value >= 10
          ? value.toFixed(1) + "×"
          : value.toFixed(2) + "×";
  const verdict = (row: (typeof rows)[number]): { tone: Tone; text: string } =>
    row.now <= 1
      ? { tone: "good", text: "现状已在预算内" }
      : row.system <= 1 && row.component <= 1
        ? { tone: "good", text: "任选一边都能达标" }
        : row.system <= 1
          ? { tone: "good", text: "缩短单次损失即可达标" }
          : row.component <= 1
            ? { tone: "good", text: "降低频次即可达标" }
            : row.both <= 1
              ? { tone: "warn", text: "两边都做才达标" }
              : {
                  tone: "bad",
                  text: `两边都做仍是预算的 ${multiple(row.both)}`,
                };
  const lanes = [
    { key: "component", tone: "mtbf", name: "只降频次" },
    { key: "system", tone: "mttr", name: "只缩短单次损失" },
    { key: "both", tone: "both", name: "两边都做" },
  ] as const;
  const reached = rows.filter((r) => r.now > 1 && r.both <= 1).length,
    systemFirst = over.filter((r) => r.cut.system >= r.cut.component).length;
  return (
    <section className="rw-card" aria-label="差距从哪边补">
      <div className="rw-card-head">
        <h2>差距从哪边补：降低频次，还是缩短单次损失</h2>
        <span className="rw-legend">
          <span className="rw-key is-tick" />
          现状
          <span className="rw-key is-mtbf" />
          只降频次（组件级措施全做）
          <span className="rw-key is-mttr" />
          只缩短单次损失（系统级措施全做）
          <span className="rw-key is-both" />
          两边都做
        </span>
      </div>
      <p className="rw-lead">
        每个模块三根横条，从现状（右端竖线）向左画到“措施库里这一边全部做足”能压到的位置；横条越长，这一边越管用，进入左侧绿色区域就是压到了预算以内。
        {over.length > 0 && (
          <>
            {" "}
            现状超预算的 {over.length} 个模块里，{systemFirst}{" "}
            个主要靠缩短单次损失，{over.length - systemFirst}{" "}
            个主要靠降低频次；两边都做之后 {reached} 个能回到预算以内。
          </>
        )}
      </p>
      <div
        className="rw-lever"
        role="table"
        aria-label="各模块现状与两个改进方向能达到的损失（以预算的倍数计）"
      >
        <div className="rw-lever-row is-axis" role="row">
          <span role="columnheader">模块</span>
          <span className="rw-lever-track" role="columnheader">
            {ticks.map((tick) => (
              <i
                key={tick}
                className={tick === 1 ? "is-budget" : ""}
                style={{ left: at(tick) + "%" }}
              >
                {tick === 1 ? "预算 1×" : tickText(tick)}
              </i>
            ))}
          </span>
          <span role="columnheader">结论</span>
        </div>
        {shown.map((row) => {
          const result = verdict(row);
          return (
            <div key={row.id} className="rw-lever-row" role="row">
              <button
                className="rw-lever-name"
                role="rowheader"
                onClick={() => onSelect(row.id)}
                title="查看并修改这个模块的参数"
              >
                {row.name}
              </button>
              <span
                className="rw-lever-track"
                role="cell"
                tabIndex={0}
                style={{ ["--rw-budget" as string]: at(1) + "%" }}
                aria-label={`${row.name}：现状是预算的 ${multiple(row.now)}；只降频次 ${multiple(row.component)}，只缩短单次损失 ${multiple(row.system)}，两边都做 ${multiple(row.both)}`}
                {...tooltip.bind(
                  <>
                    <strong>{multiple(row.now)}</strong>
                    <span>{row.name} · 现状损失 ÷ 预算</span>
                    <strong>{multiple(row.component)}</strong>
                    <span>只降频次（降 {percent(row.cut.component, 0)}）</span>
                    <strong>{multiple(row.system)}</strong>
                    <span>
                      只缩短单次损失（降 {percent(row.cut.system, 0)}）
                    </span>
                    <strong>{multiple(row.both)}</strong>
                    <span>两边都做（降 {percent(row.cut.both, 0)}）</span>
                    <strong>{hours(row.budgetHours)}</strong>
                    <span>窗口内的损失预算</span>
                  </>,
                )}
              >
                {ticks.map((tick) => (
                  <i
                    key={tick}
                    className={
                      "rw-lever-grid" + (tick === 1 ? " is-budget" : "")
                    }
                    style={{ left: at(tick) + "%" }}
                  />
                ))}
                {lanes.map((lane, index) => {
                  const to = row[lane.key];
                  return row.now - to < row.now * 0.005 ? null : (
                    <span
                      key={lane.key}
                      className={"rw-lever-bar is-" + lane.tone}
                      style={{
                        left: at(to) + "%",
                        width: Math.max(at(row.now) - at(to), 0.4) + "%",
                        top: 7 + index * 11,
                      }}
                    >
                      {lane.key === "both" && <em>{multiple(to)}</em>}
                    </span>
                  );
                })}
                <b style={{ left: at(row.now) + "%" }}>
                  <em>{multiple(row.now)}</em>
                </b>
              </span>
              <span role="cell">
                <Status tone={result.tone}>{result.text}</Status>
              </span>
            </div>
          );
        })}
      </div>
      {over.length > 0 && over.length < rows.length && (
        <button className="rw-more" onClick={() => setAll(!all)}>
          <ChevronDown size={15} aria-hidden />
          {all
            ? "只显示超预算的模块"
            : `另有 ${rows.length - over.length} 个模块现状已在预算内，显示全部`}
        </button>
      )}
      <p className="rw-hint">
        横轴是“损失 ÷ 预算”，对数刻度：每一格相差 10 倍，1×
        是分配给这个模块的预算。三根横条分别是把措施库里的组件级措施（降低故障频次）、系统级措施（缩短单次损失）、以及两者全部用上之后的位置；某一边没有横条，说明措施库里没有针对它的这类措施。标了“暂不优化”的措施不计入。这里回答“潜力在哪边”，具体启用哪些措施在第
        3 步定。点模块名可查看和修改它的参数。
      </p>
      {tooltip.node}
    </section>
  );
}

export default function StepAssess() {
  const { model, analysis, update } = useWorkbench(),
    { baseline, design, allocation, baselineGaps } = analysis,
    [selected, setSelected] = useState<string>(),
    tooltip = useTooltip(),
    potential = useMemo(() => layerPotential(model), [model]);
  const system = baseline.system,
    ranked = [...baseline.modules].sort((a, b) => b.lossHours - a.lossHours),
    byFit = [...baseline.modules].sort((a, b) => b.fitPerCard - a.fitPerCard),
    scaleMax = Math.max(
      ...baseline.modules.map((m) => m.lossHoursPerWeek),
      ...allocation.modules.map((m) => m.lossHoursPerWeek),
      1e-9,
    ),
    gapOf = (id: string) => baselineGaps.find((g) => g.id === id)!,
    // 差距排序：超出分配预算的损失小时从大到小
    overBudget = (id: string) => {
      const gap = baselineGaps.find((g) => g.id === id)!;
      return gap.lossHours - gap.budgetHours;
    },
    byGap = [...baseline.modules].sort(
      (a, b) => overBudget(b.id) - overBudget(a.id),
    ),
    budgetOf = (id: string) => allocation.modules.find((m) => m.id === id)!;
  const selectedModule = model.modules.find((m) => m.id === selected),
    selectedResult = baseline.modules.find((m) => m.id === selected);

  return (
    <div className="rw-stack">
      <section className="rw-stats" aria-label="系统现状">
        {[
          [
            "故障频次",
            frequency(system.ratePerWeek),
            `每连续运行一周；系统 MTBF ${duration(system.mtbfHours)}`,
          ],
          [
            "单次等效损失",
            duration(system.mttrHours),
            "平均每次故障损失的时间（等效 MTTR）",
          ],
          [
            "每周损失",
            hours(system.lossHoursPerWeek),
            `允许 ${hours(allocation.lossHours * (168 / model.scenario.hours))}`,
          ],
          [
            "每卡故障率",
            fit(system.fitPerCard) + " FIT",
            "各故障模式折算到每张卡后相加",
          ],
          [
            "现状可用度",
            percent(system.availability),
            `目标 ${percent(model.scenario.target)}`,
          ],
        ].map(([label, value, hint]) => (
          <div key={label} className="rw-stat">
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </section>

      <ArchitectureDiagram
        views={["baseline", "design"]}
        title="系统架构图"
        hint="按超节点的硬件拓扑绘制，可用度与目标、每周损失和故障频次标在对应硬件上；底色浅蓝表示损失少，损失越多越红。悬停可看每卡 FIT、损失预算等明细，点击硬件可查看并修改它的故障模式和恢复链。"
        onSelect={setSelected}
        actions={
          <button
            className="rw-button"
            onClick={() => {
              const module = blankModule(model.groups[0].id);
              update((d) => void d.modules.push(module));
              setSelected(module.id);
            }}
          >
            <Plus size={15} aria-hidden />
            添加模块
          </button>
        }
      />

      <div className="rw-grid is-half">
        <RankBars
          title="失效率排名：谁坏得最多"
          hint="每卡 FIT 及其占全部故障率的比例。排在前面的是降低故障频次（组件级高可用）的重点对象。"
          rows={byFit.slice(0, 6).map((m) => ({
            id: m.id,
            name: m.name,
            value: m.fitPerCard,
            text: fit(m.fitPerCard) + " FIT",
            share: system.fitPerCard > 0 ? m.fitPerCard / system.fitPerCard : 0,
          }))}
        />
        <RankBars
          title="损失排名：时间丢在哪里"
          hint="每周损失小时及其占全部故障损失的比例。失效率不高却排在前面的模块，问题出在单次损失上。"
          rows={ranked.slice(0, 6).map((m) => ({
            id: m.id,
            name: m.name,
            value: m.lossHoursPerWeek,
            text: hours(m.lossHoursPerWeek),
            share: m.share,
          }))}
        />
      </div>

      <section className="rw-card" aria-label="硬件损失差距排序">
        <div className="rw-card-head">
          <h2>各模块的目标与差距</h2>
          <span className="rw-muted">按超出预算的每周小时从大到小排列</span>
        </div>
        <div className="rw-table-wrap">
          <table className="rw-table">
            <thead>
              <tr>
                <th rowSpan={2}>模块</th>
                <th colSpan={2} className="is-group">
                  可用度
                </th>
                <th colSpan={2} className="is-group">
                  故障频次（MTBF 角度）
                </th>
                <th colSpan={2} className="is-group">
                  单次等效损失（MTTR 角度）
                </th>
                <th rowSpan={2}>每周损失与预算</th>
                <th rowSpan={2}>差距</th>
                <th rowSpan={2}>优先方向</th>
              </tr>
              <tr>
                <th className="is-num">现状</th>
                <th className="is-num">目标</th>
                <th className="is-num">现状</th>
                <th className="is-num">允许</th>
                <th className="is-num">现状</th>
                <th className="is-num">允许</th>
              </tr>
            </thead>
            <tbody>
              {byGap.map((module) => {
                const gap = gapOf(module.id),
                  after = design.modules.find((m) => m.id === module.id)!,
                  modeIds = new Set(module.modes.map((m) => m.id)),
                  related = model.measures.filter((m) =>
                    m.modeIds.some((id) => modeIds.has(id)),
                  ),
                  over = Math.max(
                    0,
                    module.lossHoursPerWeek -
                      budgetOf(module.id).lossHoursPerWeek,
                  ),
                  budget = budgetOf(module.id),
                  tone = gapTone(gap),
                  reach = potential.get(module.id);
                return (
                  <tr key={module.id} data-gap-module={module.id}>
                    <td>
                      <button
                        className="rw-link"
                        onClick={() => setSelected(module.id)}
                      >
                        {module.name}
                      </button>
                    </td>
                    <td className="is-num is-strong">
                      {percent(module.availability)}
                    </td>
                    <td className="is-num">{percent(budget.availability)}</td>
                    <td className="is-num is-strong">
                      {frequency(module.ratePerWeek)}
                    </td>
                    <td className="is-num">
                      {budget.maxRatePerWeek === null
                        ? "—"
                        : frequency(budget.maxRatePerWeek)}
                    </td>
                    <td className="is-num is-strong">
                      {duration(module.mttrHours)}
                    </td>
                    <td className="is-num">
                      {budget.maxMttrHours === null
                        ? "—"
                        : duration(budget.maxMttrHours)}
                    </td>
                    <td>
                      <span
                        className="rw-lossbar"
                        tabIndex={0}
                        {...tooltip.bind(
                          <>
                            <strong>{hours(module.lossHoursPerWeek)}</strong>
                            <span>{module.name} 每周损失</span>
                            <strong>{hours(budget.lossHoursPerWeek)}</strong>
                            <span>每周损失预算</span>
                            <strong>{hours(after.lossHoursPerWeek)}</strong>
                            <span>当前设计下的每周损失</span>
                            <strong>{percent(module.share, 1)}</strong>
                            <span>占全部故障损失</span>
                          </>,
                        )}
                      >
                        <span className="rw-lossbar-track">
                          <span
                            className="rw-lossbar-fill"
                            style={{
                              width:
                                (module.lossHoursPerWeek / scaleMax) * 100 +
                                "%",
                            }}
                          />
                          <i
                            style={{
                              left:
                                (budget.lossHoursPerWeek / scaleMax) * 100 +
                                "%",
                            }}
                          />
                        </span>
                        <em>
                          {hours(module.lossHoursPerWeek)}
                          <small> / {hours(budget.lossHoursPerWeek)}</small>
                        </em>
                      </span>
                    </td>
                    <td>
                      <span className="rw-direction-cell">
                        <Status tone={tone}>{usageText(gap)}</Status>
                        {over > 0 && <small>超出 {hours(over)} / 周</small>}
                      </span>
                    </td>
                    <td>
                      {gap.suggestion === "none" || !reach ? (
                        <span className="rw-muted">—</span>
                      ) : (
                        <span className="rw-direction-cell">
                          {reach.system >= reach.component ? (
                            <span className="rw-direction is-mttr">
                              <Timer size={14} aria-hidden />
                              缩短单次损失
                            </span>
                          ) : (
                            <span className="rw-direction is-mtbf">
                              <TrendingUp size={14} aria-hidden />
                              降低频次
                            </span>
                          )}
                          <small title={related.map((m) => m.name).join("；")}>
                            措施库 {related.length} 项可降：单次损失{" "}
                            {percent(reach.system, 0)} · 频次{" "}
                            {percent(reach.component, 0)}
                          </small>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="rw-row-muted">
                <td>公共开销</td>
                <td colSpan={6} className="rw-muted">
                  与故障无关的固定损耗，占运行时间的 {percent(system.overhead)}
                </td>
                <td>
                  <span className="rw-lossbar">
                    <span className="rw-lossbar-track" />
                    <em>
                      {hours(
                        system.overheadLossHours * (168 / model.scenario.hours),
                      )}
                      <small>
                        {" "}
                        /{" "}
                        {hours(
                          allocation.overheadLossHours *
                            (168 / model.scenario.hours),
                        )}
                      </small>
                    </em>
                  </span>
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="rw-hint">
          故障频次是每连续运行一周（168 小时）发生的次数，等于 168 ÷
          MTBF，只由器件失效率和数量决定。每周损失 = 故障频次 × 单次等效损失 ×
          运行时间占比（停机时不产生新故障，现状运行时间占{" "}
          {percent(system.runShare, 0)}
          ）。“允许”的两列是分别只走一条路时的要求：单次损失不变时频次要降到多少，或频次不变时单次损失要缩到多少。“差距”一列同时给出超预算的倍数和超出的小时数，表按后者排序。“优先方向”看措施库里哪一边能补得更多：把全部系统级措施用上，这个模块的损失能降多少（缩短单次损失）；把全部组件级措施用上能降多少（降低频次）。竖线是损失预算。
        </p>
      </section>

      <LeverSection onSelect={setSelected} />

      <RecoveryChain />
      <ComputationTrace />

      <Disclosure title="评估方法与假设">
        <div className="rw-explain">
          <ol>
            <li>
              <p>
                <strong>故障频次。</strong>
                每个故障模式的全系统事件率由单件 FIT 和部件总数得到（1 FIT = 每
                10⁹ 器件小时 1
                次）。按卡计的部件，总数随规模增长；固定数量的部件（如机房供配电）不随规模变化。
              </p>
              <Formula>
                λᵢ = FITᵢ × 部件总数 / 10⁹　（次 / 运行小时）；每周次数 = λᵢ ×
                每周运行小时
              </Formula>
            </li>
            <li>
              <p>
                <strong>单次等效损失。</strong>
                故障先被检出（概率
                c），或漏检后被兜底手段发现；然后沿恢复链从小到大走——就地恢复、进程重调度、弹性恢复、CKPT
                回滚、人工。进程重调度成功即恢复，失败走弹性恢复；弹性恢复成功后再走
                CKPT 回滚，失败转人工；CKPT
                回滚失败也转人工。每一级不论成败都要花掉它的时间。各环节的“概率
                × 时间”相加：
              </p>
              <Formula>
                MTTRᵢ = κ · [ c·t检出 + (1−c)·t发现 + Σₖ 到达ₖ·(pₖ·tₖ·κₖ +
                (1−pₖ)·fₖ·κₖ) + Σ需回滚 到达ₖ·pₖ·t回滚 ]
              </Formula>
              <p>
                到达ₖ 是走到第 k
                级的概率（沿上面的走法逐级推出）；pₖ、tₖ、fₖ、κₖ 是第 k
                级的成功率、成功耗时、失败白费的时间和影响范围。回滚重算只在最终恢复的那一级计一次，CKPT
                回滚一次的耗时 ≈ 恢复时间 + 保存间隔的一半。
              </p>
            </li>
            <li>
              <p>
                <strong>系统可用度。</strong>
                训练任务是串联系统：任何一个模块故障都会打断任务，任务停下来时不会再产生新故障。按更新报酬定理，每运行
                1 小时平均损失 ρ = Σ λᵢ·MTTRᵢ 小时，所以有效产出占比为：
              </p>
              <Formula>A = (1 − 公共开销) / (1 + ρ)</Formula>
              <p>
                这个式子对任何损失水平都成立，不会像“1 −
                损失/窗口”那样算出负数。
              </p>
            </li>
            <li>
              <p>
                <strong>模块指标。</strong>
                模块可用度 Aᵢ = 1 / (1 + ρᵢ)
                是“只有这个模块出故障”时的系统可用度；模块损失时间 = 窗口 × ρᵢ /
                (1 +
                ρ)，各模块相加再加公共开销，恰好等于系统总损失。是否超预算按 ρᵢ
                与分配值 ρᵢ* 比较。
              </p>
            </li>
          </ol>
          <p className="rw-hint">
            <strong>假设与边界：</strong>
            故障按恒定失效率到达；静默故障漏检后到被发现之间的产出按作废计；亚健康按降速比例折算成等效停机；不考虑多个故障同时发生时共享一次恢复。第
            4 步的仿真会独立检验这些近似在有限窗口内的偏差。
          </p>
        </div>
      </Disclosure>

      {selectedModule && selectedResult && (
        <Drawer
          title={selectedModule.name}
          subtitle={`可用度 ${percent(selectedResult.availability)} · ${usageText(gapOf(selectedModule.id))}`}
          onClose={() => setSelected(undefined)}
          footer={
            <button
              className="rw-button is-danger"
              disabled={model.modules.length <= 1}
              onClick={() => {
                if (
                  !window.confirm(
                    `删除模块“${selectedModule.name}”及其故障模式？引用它们的措施会同步清理。`,
                  )
                )
                  return;
                const id = selectedModule.id;
                setSelected(undefined);
                update((d) => void dropModule(d, id));
              }}
            >
              <Trash2 size={15} aria-hidden />
              删除模块
            </button>
          }
        >
          <ModuleEditor moduleId={selectedModule.id} />
        </Drawer>
      )}
      {tooltip.node}
    </div>
  );
}

function ModuleEditor({ moduleId }: { moduleId: string }) {
  const { model, analysis, update } = useWorkbench(),
    module = model.modules.find((m) => m.id === moduleId)!,
    result = analysis.baseline.modules.find((m) => m.id === moduleId)!,
    budget = analysis.allocation.modules.find((m) => m.id === moduleId)!,
    modes = model.modes.filter((m) => m.moduleId === moduleId);
  const patchModule = (patch: Partial<typeof module>) =>
    update((d) =>
      Object.assign(d.modules.find((m) => m.id === moduleId)!, patch),
    );
  const patchMode = (id: string, patch: Partial<FaultMode>) =>
    update((d) => Object.assign(d.modes.find((m) => m.id === id)!, patch));

  return (
    <div className="rw-editor">
      <section className="rw-editor-metrics">
        {[
          ["FIT / 卡", fit(result.fitPerCard)],
          ["故障频次", frequency(result.ratePerWeek)],
          ["单次等效损失", duration(result.mttrHours)],
          [
            "损失 / 预算",
            `${hours(result.lossHoursPerWeek)} / ${hours(budget.lossHoursPerWeek)}`,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <section className="rw-form">
        <label className="is-wide">
          <span>模块名称</span>
          <TextField
            label="模块名称"
            value={module.name}
            fallback="未命名模块"
            onCommit={(name) => patchModule({ name })}
          />
        </label>
        <label>
          <span>{module.scaling === "fixed" ? "全系统数量" : "每卡数量"}</span>
          <NumberField
            label="部件数量"
            value={module.unitsPerCard}
            min={0.0001}
            max={100000}
            digits={4}
            suffix="件"
            onCommit={(v) => patchModule({ unitsPerCard: v })}
          />
        </label>
        <label>
          <span>数量口径</span>
          <select
            aria-label="数量口径"
            value={module.scaling}
            onChange={(e) =>
              patchModule({ scaling: e.target.value as "per-card" | "fixed" })
            }
          >
            <option value="per-card">按卡计，随规模增长</option>
            <option value="fixed">固定数量，不随规模变化</option>
          </select>
        </label>
        <label>
          <span>所属分组</span>
          <select
            aria-label="所属分组"
            value={module.groupId}
            onChange={(e) => patchModule({ groupId: e.target.value })}
          >
            {model.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="is-wide">
          <span>架构图上的位置</span>
          <select
            aria-label="架构图上的位置"
            value={
              (diagramSlots as readonly string[]).includes(module.anchor)
                ? module.anchor
                : ""
            }
            onChange={(e) => patchModule({ anchor: e.target.value })}
          >
            <option value="">不画在图上（列在图下方）</option>
            {diagramSlots.map((slot) => (
              <option key={slot} value={slot}>
                {diagramSlotNames[slot]}
              </option>
            ))}
          </select>
        </label>
        <label className="is-wide">
          <span>说明</span>
          <TextField
            label="模块说明"
            value={module.note}
            maxLength={600}
            onCommit={(note) => patchModule({ note })}
          />
        </label>
      </section>

      <h3>故障模式</h3>
      {modes.length === 0 && (
        <p className="rw-empty">这个模块还没有故障模式，不会产生损失。</p>
      )}
      {modes.map((mode) => {
        const modeResult = result.modes.find((m) => m.id === mode.id)!;
        return (
          <section key={mode.id} className="rw-mode">
            <header>
              <TextField
                label="故障模式名称"
                value={mode.name}
                fallback="未命名故障"
                onCommit={(name) => patchMode(mode.id, { name })}
              />
              <select
                aria-label="故障类型"
                value={mode.kind}
                onChange={(e) =>
                  patchMode(mode.id, { kind: e.target.value as FaultKind })
                }
              >
                {faultKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {faultKindNames[kind]}
                  </option>
                ))}
              </select>
              <button
                className="rw-icon-button"
                aria-label={"删除故障模式 " + mode.name}
                title="删除故障模式"
                disabled={model.modes.length <= 1}
                onClick={() => update((d) => dropModes(d, new Set([mode.id])))}
              >
                <Trash2 size={15} />
              </button>
            </header>
            <div className="rw-form is-three">
              <label>
                <span>单件故障率</span>
                <NumberField
                  label={mode.name + " 的单件故障率"}
                  value={mode.fit}
                  min={0}
                  max={1e7}
                  digits={2}
                  suffix="FIT"
                  onCommit={(v) => patchMode(mode.id, { fit: v })}
                />
              </label>
              <label>
                <span>检出率</span>
                <NumberField
                  label={mode.name + " 的检出率"}
                  value={mode.coverage}
                  factor={100}
                  min={0}
                  max={1}
                  digits={3}
                  suffix="%"
                  onCommit={(v) => patchMode(mode.id, { coverage: v })}
                />
              </label>
              <label>
                <span>检出时的检测时间</span>
                <DurationField
                  label={mode.name + " 的检测时间"}
                  value={mode.detectHours}
                  onCommit={(v) => patchMode(mode.id, { detectHours: v })}
                />
              </label>
              <label>
                <span>漏检后多久被发现</span>
                <DurationField
                  label={mode.name + " 的漏检后发现时间"}
                  value={mode.lateDetectHours}
                  onCommit={(v) => patchMode(mode.id, { lateDetectHours: v })}
                />
              </label>
              <label>
                <span>回滚重算</span>
                <DurationField
                  label={mode.name + " 的回滚重算时间"}
                  value={mode.reworkHours}
                  onCommit={(v) => patchMode(mode.id, { reworkHours: v })}
                />
              </label>
              <label>
                <span>影响系数</span>
                <NumberField
                  label={mode.name + " 的影响系数"}
                  value={mode.impact}
                  factor={100}
                  min={0}
                  max={1}
                  digits={2}
                  suffix="%"
                  onCommit={(v) => patchMode(mode.id, { impact: v })}
                />
              </label>
            </div>
            <LadderEditor
              mode={mode}
              onChange={(level, change) =>
                update((d) => {
                  Object.assign(
                    d.modes.find((m) => m.id === mode.id)!.ladder[level],
                    change,
                  );
                })
              }
            />
            <p className="rw-mode-result">
              单次等效损失 <b>{duration(lossPerEvent(mode))}</b> ·{" "}
              <b>{frequency(modeResult.ratePerWeek)}</b> · 每周损失{" "}
              <b>{hours(modeResult.lossHoursPerWeek)}</b>
            </p>
            <label className="rw-mode-evidence">
              <span>数据来源</span>
              <TextField
                label={mode.name + " 的数据来源"}
                value={mode.evidence}
                maxLength={600}
                placeholder="例如：实测、厂商数据、工程假设"
                onCommit={(evidence) => patchMode(mode.id, { evidence })}
              />
            </label>
          </section>
        );
      })}
      <button
        className="rw-button"
        onClick={() => update((d) => void d.modes.push(blankMode(moduleId)))}
      >
        <Plus size={15} aria-hidden />
        添加故障模式
      </button>
    </div>
  );
}

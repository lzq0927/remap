import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  Lightbulb,
  Pencil,
  Plus,
  Timer,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  auditLibraryMeasures,
  correctLibraryMeasures,
  evidenceStateNames,
  measureParamNames,
  solveEffect,
  type Measure,
  type MeasureContribution,
  type MeasureDirection,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { usageText } from "./StepAssess";
import ArchitectureDiagram from "./ArchitectureDiagram";
import MeasureDialog from "./MeasureDialog";
import MeasureScaleCharts from "./MeasureScaleCharts";
import FaultChainComparison from "./FaultChainComparison";
import {
  applyEffect,
  baseValue,
  formatParam,
  isRatio,
  targetText,
} from "./helpers";
import { hours, percent, points } from "./format";
import {
  Disclosure,
  DurationField,
  Formula,
  NumberField,
  Status,
  Toggle,
  useTooltip,
  type Tone,
} from "./ui";

const directionInfo: Record<
  MeasureDirection,
  { title: string; hint: string; icon: typeof Timer }
> = {
  mtbf: {
    title: "提升 MTBF",
    hint: "让故障更少发生：降低器件失效率、筛除薄弱个体、增加纠错与冗余。",
    icon: TrendingUp,
  },
  mttr: {
    title: "降低 MTTR",
    hint: "让每次故障损失更小：更快检出、更快恢复、少回滚、缩小影响范围。",
    icon: Timer,
  },
};

export default function StepDesign() {
  const { model, analysis, update } = useWorkbench(),
    {
      recommendation,
      contributions,
      baseline,
      design,
      allocation,
      designGaps,
      baselineGaps,
    } = analysis,
    [adding, setAdding] = useState<MeasureDirection>(),
    [editing, setEditing] = useState<string>(),
    target = model.scenario.target,
    nameOf = (id: string) =>
      model.measures.find((m) => m.id === id)?.name ?? id,
    editingMeasure = model.measures.find((m) => m.id === editing);
  const legacyIssues = auditLibraryMeasures(model);
  const enable = (ids: string[]) =>
    update((d) => {
      for (const measure of d.measures)
        if (ids.includes(measure.id)) measure.enabled = true;
    });
  const scaleMax = Math.max(
    ...baseline.modules.map((m) => m.lossHours),
    ...allocation.modules.map((m) => m.lossHours),
    1e-9,
  );

  return (
    <div className="rw-stack">
      {legacyIssues.length > 0 && (
        <section className="rw-advice is-warn" aria-label="恢复参数口径待修正">
          <div>
            <strong>
              旧版措施库有 {legacyIssues.length} 项把阶段节省误写成恢复总时长。
            </strong>
            <p>
              在已校准现状下会高估收益。修正后仅减少相应阶段耗时，保留其余恢复段；旧验证需重新运行，历史快照保留。手动改过的参数不自动替换。
            </p>
          </div>
          <button
            className="rw-button"
            onClick={() =>
              update((d) => {
                d.measures = correctLibraryMeasures(d).measures;
              })
            }
          >
            修正阶段节省口径
          </button>
        </section>
      )}
      <section
        className={
          "rw-advice is-" +
          (recommendation.kind === "met"
            ? "good"
            : recommendation.kind === "add"
              ? "info"
              : "warn")
        }
        aria-label="推荐方案"
      >
        <Lightbulb size={20} aria-hidden />
        {recommendation.kind === "met" && (
          <div>
            <strong>
              当前设计已达标：设计后 {percent(design.system.availability)}，余量{" "}
              {points(design.system.availability - target)}。
            </strong>
            <p>
              {recommendation.removable.length
                ? `下面任意一项单独去掉后仍能达标，可作为余量或精简对象：${recommendation.removable.map(nameOf).join("、")}。`
                : "已启用的措施缺一不可，去掉任何一项都会低于目标。"}
              　下一步用独立仿真验证。
            </p>
          </div>
        )}
        {recommendation.kind === "add" && (
          <>
            <div>
              <strong>
                当前设计 {percent(design.system.availability)}，距目标还差{" "}
                {(
                  Math.max(0, target - design.system.availability) * 100
                ).toFixed(2)}{" "}
                pp。
              </strong>
              <p>
                在已启用措施的基础上，
                {recommendation.minimal ? "最少再启用" : "建议再启用"}{" "}
                <b>{recommendation.add.map(nameOf).join("、")}</b>
                （共 {recommendation.add.length} 项），可达到{" "}
                {percent(recommendation.availability)}。
                {!recommendation.minimal &&
                  "这组措施按提升大小逐步选出，每一项都不可少，但不保证数量最少。"}
              </p>
            </div>
            <button
              className="rw-button is-primary"
              onClick={() => enable(recommendation.add)}
            >
              采用建议
            </button>
          </>
        )}
        {recommendation.kind === "short" && (
          <>
            <div>
              <strong>
                当前搜索到的组合为 {percent(recommendation.ceiling)}，距目标还差{" "}
                {(recommendation.shortfall * 100).toFixed(2)} pp。
              </strong>
              <p>
                仅按系统均值估算，还需把所有故障率或所有单次损失再降低{" "}
                <b>{percent(recommendation.furtherReduction, 0)}</b>
                。可以加大现有措施的参数，或新增措施。
              </p>
            </div>
            {recommendation.add.length > 0 && (
              <button
                className="rw-button"
                onClick={() => enable(recommendation.add)}
              >
                启用这 {recommendation.add.length} 项
              </button>
            )}
          </>
        )}
      </section>

      {model.requirements && (
        <p className="rw-alert is-info">
          推荐同时检查整系统{percent(target)}及固定域目标。
          {analysis.requirements
            .filter((d) => !d.met)
            .map((d) => `${d.name}尚未达到${percent(d.target!, 5)}`)
            .join("；") || "固定域目标当前均满足。"}{" "}
          推荐依据解析均值；窗口波动、局部预算及工程条件需在第四步核验。
        </p>
      )}
      <MeasureScaleCharts />
      <FaultChainComparison />

      <div className="rw-grid is-design">
        <div className="rw-stack">
          {(["mtbf", "mttr"] as const).map((direction) => {
            const info = directionInfo[direction],
              Icon = info.icon,
              items = model.measures.filter((m) => m.direction === direction),
              gainOf = (m: Measure) =>
                contributions.items.find((c) => c.id === m.id)!,
              on = items.filter((m) => m.enabled),
              off = items
                .filter((m) => !m.enabled)
                .sort((a, b) => gainOf(b).marginal - gainOf(a).marginal);
            return (
              <section
                key={direction}
                className="rw-card"
                aria-label={info.title + "的措施"}
              >
                <div className="rw-card-head">
                  <h2 className={"rw-direction is-" + direction}>
                    <Icon size={18} aria-hidden />
                    {info.title}
                    <small>
                      已启用 {on.length} / {items.length}
                    </small>
                  </h2>
                  <button
                    className="rw-button"
                    onClick={() => setAdding(direction)}
                  >
                    <Plus size={15} aria-hidden />
                    添加措施
                  </button>
                </div>
                <p className="rw-hint">{info.hint}</p>
                {on.length === 0 && (
                  <p className="rw-empty">这个方向还没有启用措施。</p>
                )}
                <div className="rw-measures">
                  {on.map((measure) => (
                    <MeasureCard
                      key={measure.id}
                      measure={measure}
                      contribution={gainOf(measure)}
                      onEdit={() => setEditing(measure.id)}
                    />
                  ))}
                </div>
                <Candidates
                  items={off}
                  render={(measure) => (
                    <MeasureCard
                      key={measure.id}
                      measure={measure}
                      contribution={gainOf(measure)}
                      onEdit={() => setEditing(measure.id)}
                    />
                  )}
                />
              </section>
            );
          })}
        </div>

        <aside className="rw-stack rw-sticky">
          <section className="rw-card" aria-label="各措施的贡献">
            <h2>各措施的贡献</h2>
            <ContributionChart
              items={contributions.items.filter((c) => c.enabled)}
            />
            <p className="rw-hint">
              贡献按 Shapley 值分摊：各项相加恰好等于设计后相对现状的提升{" "}
              <b>
                {points(
                  design.system.availability - baseline.system.availability,
                )}
              </b>
              ，与措施的排列顺序无关。
              {!contributions.exact && "（措施较多，采用固定种子的抽样估计。）"}
            </p>
          </section>
        </aside>
      </div>

      <ArchitectureDiagram
        views={["design", "baseline"]}
        title="架构上的设计结果"
        hint="切换“设计后”与“现状”，对照每个模块离目标还有多远。"
      />

      <Disclosure title="各模块设计前后明细">
        <div className="rw-card-head">
          <span />
          <span className="rw-legend">
            <span className="rw-key is-before" />
            现状
            <span className="rw-key is-after" />
            设计后
            <span className="rw-key is-tick" />
            预算
          </span>
        </div>
        <div className="rw-table-wrap">
          <table className="rw-table">
            <thead>
              <tr>
                <th>模块</th>
                <th>损失时间</th>
                <th className="is-num">现状</th>
                <th className="is-num">设计后</th>
                <th className="is-num">预算</th>
                <th className="is-num">可用度</th>
                <th>设计后与预算</th>
              </tr>
            </thead>
            <tbody>
              {baseline.modules.map((before) => {
                const after = design.modules.find((m) => m.id === before.id)!,
                  budget = allocation.modules.find((m) => m.id === before.id)!,
                  gap = designGaps.find((g) => g.id === before.id)!,
                  was = baselineGaps.find((g) => g.id === before.id)!,
                  tone: Tone =
                    gap.status === "met"
                      ? "good"
                      : gap.status === "near"
                        ? "warn"
                        : "bad";
                return (
                  <tr key={before.id}>
                    <td>{before.name}</td>
                    <td>
                      <span
                        className="rw-twinbar"
                        role="img"
                        aria-label={`${before.name}：现状 ${hours(before.lossHours)}，设计后 ${hours(after.lossHours)}，预算 ${hours(budget.lossHours)}`}
                      >
                        <span
                          className="is-before"
                          style={{
                            width: (before.lossHours / scaleMax) * 100 + "%",
                          }}
                        />
                        <span
                          className="is-after"
                          style={{
                            width: (after.lossHours / scaleMax) * 100 + "%",
                          }}
                        />
                        <i
                          style={{
                            left: (budget.lossHours / scaleMax) * 100 + "%",
                          }}
                        />
                      </span>
                    </td>
                    <td className="is-num">{hours(before.lossHours)}</td>
                    <td className="is-num is-strong">
                      {hours(after.lossHours)}
                    </td>
                    <td className="is-num">{hours(budget.lossHours)}</td>
                    <td className="is-num">
                      {percent(before.availability)} →{" "}
                      <b>{percent(after.availability)}</b>
                    </td>
                    <td>
                      <Status tone={tone}>{usageText(gap)}</Status>
                      {was.status !== "met" && gap.status === "met" && (
                        <span className="rw-muted">　已补齐</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="rw-hint">
          没有加措施的模块，损失小时会略有增加：系统停机少了、运行时间变长，同样的故障率在窗口内发生的次数就更多。是否超预算按损失负荷判定，不受此影响。个别模块超出预算时，可以回到第
          1 步换一种分配方法，或继续针对该模块加措施。
        </p>
      </Disclosure>

      <Disclosure title="设计方法与依据">
        <div className="rw-explain">
          <ol>
            <li>
              <p>
                <strong>措施如何生效。</strong>
                每项措施只改动它所作用的故障模式的参数：提升 MTBF 的措施改故障率
                FIT；降低 MTTR
                的措施改检出率、检测时间、恢复时间、回滚重算、漏检损失或影响系数。措施不一定对所有故障都有效，所以每项措施有一个“适用比例”，参数按它在现值与目标值之间折算。同一个参数被多项措施“设为”新值时只取最好的一项，不叠加；“按比例降低”的则连乘。改完后用第
                2 步同一套公式重新评估，所以“设计后”与“现状”可以直接比较。
              </p>
            </li>
            <li>
              <p>
                <strong>贡献为什么用 Shapley 值。</strong>
                措施之间有重叠：故障率降低后，再缩短恢复时间能省下的损失也变少。逐个“去掉看看”得到的收益加起来不等于总提升。Shapley
                值对所有启用顺序求平均边际收益，满足“相加等于总提升”“作用相同的措施贡献相同”“没有作用的措施贡献为零”和可加性这四项公理。
              </p>
              <Formula>
                φᵢ = Σ_S |S|!·(n−|S|−1)! / n! · [ A(S ∪ {"{i}"}) − A(S) ]
              </Formula>
            </li>
            <li>
              <p>
                <strong>推荐方案怎么来的。</strong>
                在已启用措施的基础上，按数量从少到多穷举其余措施的组合，找到的第一组即数量最少；数量相同时优先证据更充分的，其次选可用度更高的。候选很多、穷举不完时，改为逐步加入提升最大的措施，达标后再剔除可以去掉的项：这时每一项都不可少，但不保证数量最少。措施库用尽仍不够时，按
                ρ 与目标 ρ* 的比值给出还需整体降低的比例。
              </p>
            </li>
            <li>
              <p>
                <strong>参数反推。</strong>
                展开任一措施可以看到“其余不变，这个参数要调到多少才刚好达标”。可用度对每个参数单调，用二分法求解；做到极限也不够时会如实说明。
              </p>
            </li>
          </ol>
        </div>
      </Disclosure>

      {adding && (
        <MeasureDialog
          direction={adding}
          onClose={() => setAdding(undefined)}
        />
      )}
      {editingMeasure && (
        <MeasureDialog
          measure={editingMeasure}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

/** 候选措施列表：先显示提升最大的几项，其余按需展开。 */
function Candidates({
  items,
  render,
}: {
  items: Measure[];
  render: (measure: Measure) => ReactNode;
}) {
  const [all, setAll] = useState(false),
    limit = 5;
  if (!items.length) return null;
  return (
    <>
      <h3 className="rw-subhead">
        候选措施 {items.length} 项<small>按启用后还能提升多少排序</small>
      </h3>
      <div className="rw-candidates">
        {(all ? items : items.slice(0, limit)).map(render)}
      </div>
      {items.length > limit && (
        <button className="rw-more" onClick={() => setAll(!all)}>
          <ChevronDown size={15} aria-hidden />
          {all
            ? "只显示前 " + limit + " 项"
            : `显示全部 ${items.length} 项候选`}
        </button>
      )}
    </>
  );
}

/** 措施卡片：已启用时显示参数；候选措施默认只显示一行，展开后可调参数。 */
function MeasureCard({
  measure,
  contribution,
  onEdit,
}: {
  measure: Measure;
  contribution: MeasureContribution;
  onEdit: () => void;
}) {
  const { model, analysis, update } = useWorkbench(),
    [open, setOpen] = useState(false);
  const patch = (mutate: (m: Measure) => void) =>
    update((d) => mutate(d.measures.find((m) => m.id === measure.id)!));
  const gain = measure.enabled ? contribution.shapley : contribution.marginal,
    showEffects = measure.enabled || open;

  return (
    <article
      className={
        "rw-measure" +
        (measure.enabled ? " is-on" : " is-candidate") +
        (open ? " is-open" : "")
      }
    >
      <header>
        <Toggle
          label={(measure.enabled ? "停用 " : "启用 ") + measure.name}
          checked={measure.enabled}
          onChange={(enabled) => patch((m) => void (m.enabled = enabled))}
        />
        <div className="rw-measure-title">
          <strong>{measure.name}</strong>
          <small>
            作用于：{targetText(model, measure)}
            {measure.applicability < 1 &&
              ` · 适用 ${percent(measure.applicability, 0)}`}
          </small>
        </div>
        <div className="rw-measure-gain">
          <strong className={gain < 0 ? "is-bad" : ""}>{points(gain)}</strong>
          <small>{measure.enabled ? "贡献" : "启用后可再提升"}</small>
        </div>
        <button
          className="rw-icon-button"
          aria-expanded={open}
          aria-label={(open ? "收起 " : "展开 ") + measure.name}
          title={open ? "收起" : "参数、依据与参数反推"}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={16} />
        </button>
      </header>
      {showEffects && (
        <div className="rw-effects">
          {measure.effects.map((effect, index) => {
            const base = baseValue(model, measure, effect.param),
              label = `${measure.name} · ${measureParamNames[effect.param]}`,
              commit = (value: number) =>
                patch((m) => void (m.effects[index].value = value));
            return (
              <div key={index} className="rw-effect">
                <span className="rw-effect-name">
                  {measureParamNames[effect.param]}
                </span>
                <span className="rw-effect-from">
                  {base === null
                    ? "各模式不同"
                    : formatParam(effect.param, base)}
                </span>
                <span className="rw-effect-arrow" aria-hidden>
                  →
                </span>
                {effect.op !== "set" && (
                  <span className="rw-effect-op">
                    {effect.op === "add"
                      ? "增加"
                      : effect.op === "subtract"
                        ? "从现状减少"
                        : effect.param === "coverage"
                          ? "漏检率降低"
                          : "降低"}
                  </span>
                )}
                {effect.op === "reduce" || isRatio(effect.param) ? (
                  <NumberField
                    label={label + (effect.op === "reduce" ? "的降低比例" : "")}
                    value={effect.value}
                    factor={100}
                    min={0}
                    max={1}
                    digits={3}
                    suffix="%"
                    width={100}
                    onCommit={commit}
                  />
                ) : effect.param === "fit" ? (
                  <NumberField
                    label={label}
                    value={effect.value}
                    min={0}
                    max={1e7}
                    digits={2}
                    suffix="FIT"
                    width={112}
                    onCommit={commit}
                  />
                ) : (
                  <DurationField
                    label={label}
                    value={effect.value}
                    onCommit={commit}
                  />
                )}
                {base !== null &&
                  (effect.op !== "set" || measure.applicability < 1) && (
                    <span className="rw-effect-to">
                      ={" "}
                      {formatParam(
                        effect.param,
                        applyEffect(effect, base, measure.applicability),
                      )}
                    </span>
                  )}
              </div>
            );
          })}
        </div>
      )}
      {open && (
        <div className="rw-measure-detail">
          <label>
            <span>适用比例</span>
            <NumberField
              label={measure.name + " 的适用比例"}
              value={measure.applicability}
              factor={100}
              min={0}
              max={1}
              digits={1}
              suffix="%"
              width={100}
              onCommit={(v) => patch((m) => void (m.applicability = v))}
            />
          </label>
          {measure.rationale && (
            <p className="rw-measure-why">{measure.rationale}</p>
          )}
          <dl className="rw-measure-numbers">
            <div>
              <dt>单独启用</dt>
              <dd>{points(contribution.standalone)}</dd>
            </div>
            <div>
              <dt>{measure.enabled ? "去掉后损失" : "加入后提升"}</dt>
              <dd>{points(contribution.marginal)}</dd>
            </div>
            <div>
              <dt>证据</dt>
              <dd>{evidenceStateNames[measure.evidence]}</dd>
            </div>
            {measure.source && (
              <div>
                <dt>出处</dt>
                <dd>{measure.source}</dd>
              </div>
            )}
          </dl>
          <Solver
            measure={measure}
            met={
              analysis.design.system.availability >= model.scenario.target &&
              measure.enabled
            }
          />
          <div className="rw-measure-actions">
            <button className="rw-button" onClick={onEdit}>
              <Pencil size={15} aria-hidden />
              编辑作用范围与依据
            </button>
            <button
              className="rw-button is-danger"
              onClick={() => {
                if (window.confirm(`删除措施“${measure.name}”？`))
                  update((d) => {
                    d.measures = d.measures.filter((m) => m.id !== measure.id);
                  });
              }}
            >
              <Trash2 size={15} aria-hidden />
              删除
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function Solver({ measure, met }: { measure: Measure; met: boolean }) {
  const { model, update } = useWorkbench();
  const solved = useMemo(
    () =>
      met
        ? []
        : measure.effects.map((_, index) =>
            solveEffect(model, measure.id, index),
          ),
    [model, measure.id, measure.effects, met],
  );
  if (met)
    return (
      <p className="rw-solver">
        <strong>参数反推：</strong>当前设计已达标，无需再调整这项措施。
      </p>
    );
  return (
    <div className="rw-solver">
      <strong>参数反推（其余措施保持不变）：</strong>
      {measure.effects.map((effect, index) => {
        const result = solved[index];
        if (!result) return null;
        const shown =
          effect.op === "reduce"
            ? "降低 " + percent(result.value)
            : effect.op === "subtract"
              ? "从现状减少 " + formatParam(effect.param, result.value)
              : formatParam(effect.param, result.value);
        return (
          <p key={index}>
            {measureParamNames[effect.param]}：
            {result.reachable ? (
              <>
                调到 <b>{shown}</b> 即可刚好达标。
                <button
                  className="rw-link"
                  onClick={() =>
                    update((d) => {
                      const target = d.measures.find(
                        (m) => m.id === measure.id,
                      )!;
                      target.enabled = true;
                      target.effects[index].value = result.value;
                    })
                  }
                >
                  采用此值
                </button>
              </>
            ) : (
              <>即使做到极限（{shown}）也不够，需要与其他措施组合。</>
            )}
          </p>
        );
      })}
    </div>
  );
}

function ContributionChart({ items }: { items: MeasureContribution[] }) {
  const tooltip = useTooltip();
  if (!items.length) return <p className="rw-empty">还没有启用任何措施。</p>;
  const sorted = [...items].sort((a, b) => b.shapley - a.shapley),
    low = Math.min(0, ...sorted.map((c) => c.shapley)),
    high = Math.max(1e-9, ...sorted.map((c) => c.shapley)),
    span = high - low,
    zero = (-low / span) * 100;
  return (
    <div className="rw-contrib">
      <div className="rw-legend">
        <span className="rw-key is-mtbf" />
        提升 MTBF
        <span className="rw-key is-mttr" />
        降低 MTTR
      </div>
      <ul>
        {sorted.map((item) => {
          const width = (Math.abs(item.shapley) / span) * 100;
          return (
            <li
              key={item.id}
              tabIndex={0}
              {...tooltip.bind(
                <>
                  <strong>{points(item.shapley)}</strong>
                  <span>{item.name} · Shapley 贡献</span>
                  <strong>{points(item.standalone)}</strong>
                  <span>单独启用时的提升</span>
                  <strong>{points(item.marginal)}</strong>
                  <span>去掉它会损失</span>
                </>,
              )}
            >
              <span className="rw-contrib-name">{item.name}</span>
              <em>{points(item.shapley)}</em>
              <span className="rw-contrib-track">
                <span
                  className={"rw-contrib-bar is-" + item.direction}
                  style={{
                    left: (item.shapley >= 0 ? zero : zero - width) + "%",
                    width: Math.max(width, 0.5) + "%",
                  }}
                />
              </span>
            </li>
          );
        })}
      </ul>
      {tooltip.node}
    </div>
  );
}

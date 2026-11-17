import { useMemo, useState } from "react";
import {
  ChevronDown,
  Lightbulb,
  Plus,
  Timer,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  evidenceStateNames,
  evidenceStates,
  faultKindNames,
  measureParamNames,
  measureParams,
  solveEffect,
  type CoreModel,
  type EvidenceState,
  type Measure,
  type MeasureContribution,
  type MeasureDirection,
  type MeasureEffect,
  type MeasureParam,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { usageText } from "./StepAssess";
import { duration, fit, hours, percent, points } from "./format";
import {
  Dialog,
  Disclosure,
  DurationField,
  Formula,
  NumberField,
  Status,
  TextField,
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
    hint: "让故障更少发生：降低器件失效率、筛除薄弱个体、增加纠错。",
    icon: TrendingUp,
  },
  mttr: {
    title: "降低 MTTR",
    hint: "让每次故障损失更小：更快检出、更快恢复、少回滚、缩小影响范围。",
    icon: Timer,
  },
};
const isRatio = (param: MeasureParam) =>
  param === "coverage" || param === "impact" || param === "overhead";
const formatParam = (param: MeasureParam, value: number) =>
  param === "fit"
    ? fit(value) + " FIT"
    : isRatio(param)
      ? percent(value)
      : duration(value);
const applyEffect = (effect: MeasureEffect, base: number) =>
  effect.op === "set"
    ? effect.value
    : effect.param === "coverage"
      ? 1 - (1 - base) * (1 - effect.value)
      : base * (1 - effect.value);

/** 措施作用对象的现状取值；各模式不同时返回 null。 */
function baseValue(model: CoreModel, measure: Measure, param: MeasureParam) {
  if (param === "overhead") return model.scenario.overhead;
  const values = model.modes
    .filter((mode) => measure.modeIds.includes(mode.id))
    .map((mode) => mode[param]);
  return values.length && values.every((v) => Math.abs(v - values[0]) < 1e-12)
    ? values[0]
    : null;
}

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
    target = model.scenario.target,
    nameOf = (id: string) =>
      model.measures.find((m) => m.id === id)?.name ?? id;
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
                {((target - design.system.availability) * 100).toFixed(2)} pp。
              </strong>
              <p>
                在已启用措施的基础上，最少再启用{" "}
                <b>{recommendation.add.map(nameOf).join("、")}</b>，可达到{" "}
                {percent(recommendation.availability)}。
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
                措施库全部启用也只能到 {percent(recommendation.ceiling)}
                ，距目标还差 {(recommendation.shortfall * 100).toFixed(2)} pp。
              </strong>
              <p>
                要补齐差距，需要在全部启用的基础上，把所有故障率或所有单次损失再降低{" "}
                <b>{percent(recommendation.furtherReduction, 0)}</b>
                。可以加大现有措施的参数，或新增措施。
              </p>
            </div>
            <button
              className="rw-button"
              onClick={() => enable(recommendation.add)}
            >
              全部启用
            </button>
          </>
        )}
      </section>

      <div className="rw-grid is-design">
        <div className="rw-stack">
          {(["mtbf", "mttr"] as const).map((direction) => {
            const info = directionInfo[direction],
              Icon = info.icon,
              items = model.measures.filter((m) => m.direction === direction);
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
                {items.length === 0 && (
                  <p className="rw-empty">还没有这个方向的措施。</p>
                )}
                <div className="rw-measures">
                  {items.map((measure) => (
                    <MeasureCard
                      key={measure.id}
                      measure={measure}
                      contribution={
                        contributions.items.find((c) => c.id === measure.id)!
                      }
                    />
                  ))}
                </div>
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

      <section className="rw-card" aria-label="各模块设计前后">
        <div className="rw-card-head">
          <h2>各模块设计前后</h2>
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
      </section>

      <Disclosure title="设计方法与依据">
        <div className="rw-explain">
          <ol>
            <li>
              <p>
                <strong>措施如何生效。</strong>
                每项措施只改动它所作用的故障模式的参数：提升 MTBF 的措施改故障率
                FIT；降低 MTTR
                的措施改检出率、检测时间、恢复时间、回滚重算、漏检损失或影响系数。改完后用第
                2 步同一套公式重新评估，所以“设计后”与“现状”可以直接比较。
              </p>
            </li>
            <li>
              <p>
                <strong>贡献为什么用 Shapley 值。</strong>
                措施之间有重叠：故障率降低后，再缩短恢复时间能省下的损失也变少。逐个“去掉看看”得到的收益加起来不等于总提升。Shapley
                值对所有启用顺序求平均边际收益，是唯一同时满足“相加等于总提升”“作用相同的措施贡献相同”“没有作用的措施贡献为零”的分摊方式。
              </p>
              <Formula>
                φᵢ = Σ_S |S|!·(n−|S|−1)! / n! · [ A(S ∪ {"{i}"}) − A(S) ]
              </Formula>
            </li>
            <li>
              <p>
                <strong>推荐方案怎么来的。</strong>
                在已启用措施的基础上，枚举其余措施的所有组合，找出能达标的最少一组；数量相同时优先证据更充分的，其次选可用度更高的。措施库全部启用仍不够时，按
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
        <AddMeasure direction={adding} onClose={() => setAdding(undefined)} />
      )}
    </div>
  );
}

function MeasureCard({
  measure,
  contribution,
}: {
  measure: Measure;
  contribution: MeasureContribution;
}) {
  const { model, analysis, update } = useWorkbench(),
    [open, setOpen] = useState(false);
  const patch = (mutate: (m: Measure) => void) =>
    update((d) => mutate(d.measures.find((m) => m.id === measure.id)!));
  const modules = [
    ...new Set(
      model.modes
        .filter((mode) => measure.modeIds.includes(mode.id))
        .map((mode) => model.modules.find((m) => m.id === mode.moduleId)!.name),
    ),
  ];
  const targetText = !measure.modeIds.length
    ? "公共开销"
    : measure.modeIds.length === model.modes.length
      ? "全部故障模式"
      : modules.length > 4
        ? `${modules.slice(0, 3).join("、")} 等 ${modules.length} 个模块`
        : modules.join("、");
  const gain = measure.enabled ? contribution.shapley : contribution.marginal;

  return (
    <article className={"rw-measure" + (measure.enabled ? " is-on" : "")}>
      <header>
        <Toggle
          label={(measure.enabled ? "停用 " : "启用 ") + measure.name}
          checked={measure.enabled}
          onChange={(enabled) => patch((m) => void (m.enabled = enabled))}
        />
        <div className="rw-measure-title">
          <strong>{measure.name}</strong>
          <small>作用于：{targetText}</small>
        </div>
        <div className="rw-measure-gain">
          <strong className={gain < 0 ? "is-bad" : ""}>{points(gain)}</strong>
          <small>{measure.enabled ? "贡献" : "启用后可再提升"}</small>
        </div>
      </header>
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
                {base === null ? "各模式不同" : formatParam(effect.param, base)}
              </span>
              <span className="rw-effect-arrow" aria-hidden>
                →
              </span>
              {effect.op === "reduce" ? (
                <>
                  <span className="rw-effect-op">降低</span>
                  <NumberField
                    label={label + "的降低比例"}
                    value={effect.value}
                    factor={100}
                    min={0}
                    max={1}
                    digits={2}
                    suffix="%"
                    width={92}
                    onCommit={commit}
                  />
                  {base !== null && (
                    <span className="rw-effect-to">
                      = {formatParam(effect.param, applyEffect(effect, base))}
                    </span>
                  )}
                </>
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
              ) : isRatio(effect.param) ? (
                <NumberField
                  label={label}
                  value={effect.value}
                  factor={100}
                  min={0}
                  max={1}
                  digits={3}
                  suffix="%"
                  width={104}
                  onCommit={commit}
                />
              ) : (
                <DurationField
                  label={label}
                  value={effect.value}
                  onCommit={commit}
                />
              )}
            </div>
          );
        })}
      </div>
      <button
        className="rw-measure-more"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={15} aria-hidden />
        {open ? "收起" : "依据、证据与参数反推"}
      </button>
      {open && (
        <div className="rw-measure-detail">
          <label>
            <span>名称</span>
            <TextField
              label={measure.name + " 的名称"}
              value={measure.name}
              fallback="未命名措施"
              onCommit={(name) => patch((m) => void (m.name = name))}
            />
          </label>
          <label>
            <span>工程依据</span>
            <TextField
              label={measure.name + " 的工程依据"}
              value={measure.rationale}
              maxLength={600}
              placeholder="这项措施为什么能达到上面的参数"
              onCommit={(rationale) =>
                patch((m) => void (m.rationale = rationale))
              }
            />
          </label>
          <label>
            <span>证据状态</span>
            <select
              aria-label={measure.name + " 的证据状态"}
              value={measure.evidence}
              onChange={(e) =>
                patch(
                  (m) => void (m.evidence = e.target.value as EvidenceState),
                )
              }
            >
              {evidenceStates.map((state) => (
                <option key={state} value={state}>
                  {evidenceStateNames[state]}
                </option>
              ))}
            </select>
          </label>
          <dl className="rw-measure-numbers">
            <div>
              <dt>单独启用</dt>
              <dd>{points(contribution.standalone)}</dd>
            </div>
            <div>
              <dt>{measure.enabled ? "去掉后损失" : "加入后提升"}</dt>
              <dd>{points(contribution.marginal)}</dd>
            </div>
          </dl>
          <Solver
            measure={measure}
            met={
              analysis.design.system.availability >= model.scenario.target &&
              measure.enabled
            }
          />
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
            删除措施
          </button>
        </div>
      )}
    </article>
  );
}

/** 参数反推：其余措施不变，这个参数要调到多少才刚好达标。 */
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

function AddMeasure({
  direction,
  onClose,
}: {
  direction: MeasureDirection;
  onClose: () => void;
}) {
  const { model, update } = useWorkbench();
  const params = measureParams.filter((p) =>
    direction === "mtbf" ? p === "fit" : p !== "fit",
  );
  const [name, setName] = useState(""),
    [param, setParam] = useState<MeasureParam>(params[0]),
    [op, setOp] = useState<"reduce" | "set">("reduce"),
    [value, setValue] = useState(0.5),
    [modeIds, setModeIds] = useState<string[]>([]);
  const needsModes = param !== "overhead",
    valid = name.trim().length > 0 && (!needsModes || modeIds.length > 0);
  const toggle = (ids: string[], on: boolean) =>
    setModeIds((current) =>
      on
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    );
  const choose = (nextParam: MeasureParam, nextOp: "reduce" | "set") => {
    setParam(nextParam);
    setOp(nextOp);
    setValue(
      nextOp === "reduce"
        ? 0.5
        : nextParam === "fit"
          ? 100
          : nextParam === "coverage"
            ? 0.99
            : nextParam === "impact"
              ? 0.1
              : nextParam === "overhead"
                ? 0.01
                : 60 / 3600,
    );
  };

  return (
    <Dialog
      title={"添加措施 · " + directionInfo[direction].title}
      onClose={onClose}
      footer={
        <>
          <button className="rw-button" onClick={onClose}>
            取消
          </button>
          <button
            className="rw-button is-primary"
            disabled={!valid}
            onClick={() => {
              update((d) => {
                d.measures.push({
                  id: "measure-" + Date.now().toString(36),
                  name: name.trim(),
                  direction,
                  modeIds: needsModes ? modeIds : [],
                  effects: [{ param, op, value }],
                  enabled: true,
                  evidence: "assumed",
                  rationale: "",
                });
              });
              onClose();
            }}
          >
            添加并启用
          </button>
        </>
      }
    >
      <div className="rw-form">
        <label className="is-wide">
          <span>措施名称</span>
          <input
            aria-label="措施名称"
            autoFocus
            value={name}
            maxLength={80}
            placeholder={
              direction === "mtbf"
                ? "例如：电源模块降额设计"
                : "例如：故障自动隔离"
            }
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span>改变的参数</span>
          <select
            aria-label="改变的参数"
            value={param}
            onChange={(e) => choose(e.target.value as MeasureParam, op)}
          >
            {params.map((p) => (
              <option key={p} value={p}>
                {measureParamNames[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>改变方式</span>
          <select
            aria-label="改变方式"
            value={op}
            onChange={(e) => choose(param, e.target.value as "reduce" | "set")}
          >
            <option value="reduce">
              {param === "coverage" ? "漏检率按比例降低" : "在现值上按比例降低"}
            </option>
            <option value="set">直接设为新值</option>
          </select>
        </label>
        <label>
          <span>{op === "reduce" ? "降低比例" : "新值"}</span>
          {op === "reduce" || isRatio(param) ? (
            <NumberField
              label="措施取值"
              value={value}
              factor={100}
              min={0}
              max={1}
              digits={3}
              suffix="%"
              onCommit={setValue}
            />
          ) : param === "fit" ? (
            <NumberField
              label="措施取值"
              value={value}
              min={0}
              max={1e7}
              digits={2}
              suffix="FIT"
              onCommit={setValue}
            />
          ) : (
            <DurationField label="措施取值" value={value} onCommit={setValue} />
          )}
        </label>
      </div>
      {needsModes && (
        <fieldset className="rw-mode-picker">
          <legend>
            作用于哪些故障模式
            <span>
              <button
                type="button"
                className="rw-link"
                onClick={() =>
                  toggle(
                    model.modes.map((m) => m.id),
                    true,
                  )
                }
              >
                全选
              </button>
              <button
                type="button"
                className="rw-link"
                onClick={() => setModeIds([])}
              >
                清空
              </button>
            </span>
          </legend>
          {model.modules.map((module) => {
            const modes = model.modes.filter((m) => m.moduleId === module.id);
            if (!modes.length) return null;
            return (
              <div key={module.id}>
                <strong>{module.name}</strong>
                {modes.map((mode) => (
                  <label key={mode.id}>
                    <input
                      type="checkbox"
                      checked={modeIds.includes(mode.id)}
                      onChange={(e) => toggle([mode.id], e.target.checked)}
                    />
                    {mode.name}
                    <small>{faultKindNames[mode.kind]}</small>
                  </label>
                ))}
              </div>
            );
          })}
        </fieldset>
      )}
    </Dialog>
  );
}

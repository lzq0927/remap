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
  createEvaluator,
  doseResponse,
  evidenceStateNames,
  higherIsBetter,
  layerOf,
  measureCategoryNames,
  measureLayerNames,
  measureParamNames,
  minimumDegrees,
  priorityPath,
  shapley,
  solveEffect,
  type DoseResponse,
  type Measure,
  type MeasureCategory,
  type MeasureContribution,
  type MeasureLayer,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { usageText } from "./StepAssess";
import ArchitectureDiagram from "./ArchitectureDiagram";
import MeasureDialog from "./MeasureDialog";
import { LineChart, seriesColors } from "./Charts";
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

const layers: MeasureLayer[] = ["component", "system"];
const layerInfo: Record<
  MeasureLayer,
  {
    goal: string;
    hint: string;
    icon: typeof Timer;
    tone: "mtbf" | "mttr";
    categories: MeasureCategory[];
  }
> = {
  component: {
    goal: "降低故障频次",
    hint: "让故障更少发生（提升 MTBF）：对着失效率高的器件，筛除薄弱个体、增加纠错与冗余、换用更可靠的器件。",
    icon: TrendingUp,
    tone: "mtbf",
    categories: ["prevent"],
  },
  system: {
    goal: "缩短单次损失",
    hint: "故障发生后让每次损失更小（降低 MTTR）：更快更全地检出，尽量用小粒度的恢复解决，把影响限制在故障域内，少回滚。按恢复链的先后分为四类。",
    icon: Timer,
    tone: "mttr",
    categories: ["detect", "recover", "contain", "checkpoint"],
  },
};
const categoryHints: Record<MeasureCategory, string> = {
  prevent: "按器件降低失效率",
  detect: "提高检出率、缩短检测时间、兜底发现漏检",
  recover: "就地恢复、进程重调度、CKPT 回滚、人工恢复，粒度从小到大",
  contain: "只恢复故障域，其余部分继续运行",
  checkpoint: "缩短回滚重算，降低保存开销",
};
const layerTone = (category: MeasureCategory) =>
  layerInfo[layerOf(category)].tone;

/** 措施主要参数某个取值的写法：按比例降低的写“降低 x%”，其余写参数值。 */
const valueText = (measure: Measure, value: number) => {
  const effect = measure.effects[0];
  return effect.op === "reduce"
    ? (effect.param === "coverage" ? "漏检率降低 " : "降低 ") +
        percent(value, 0)
    : formatParam(effect.param, value);
};

function LayerChip({ category }: { category: MeasureCategory }) {
  return (
    <span className={"rw-chip is-" + layerTone(category)}>
      {layerOf(category) === "component"
        ? "组件级"
        : "系统级 · " + measureCategoryNames[category]}
    </span>
  );
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
    [adding, setAdding] = useState<MeasureCategory>(),
    [editing, setEditing] = useState<string>(),
    target = model.scenario.target,
    nameOf = (id: string) =>
      model.measures.find((m) => m.id === id)?.name ?? id,
    editingMeasure = model.measures.find((m) => m.id === editing);
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
  const gainOf = (m: Measure) =>
    contributions.items.find((c) => c.id === m.id)!;

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
                把措施库里有提升的措施都启用，也只能到{" "}
                {percent(recommendation.ceiling)}，距目标还差{" "}
                {(recommendation.shortfall * 100).toFixed(2)} pp。
              </strong>
              <p>
                要补齐差距，还需要把所有故障率或所有单次损失再降低{" "}
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

      <div className="rw-grid is-design">
        <div className="rw-stack">
          {layers.map((layer) => {
            const info = layerInfo[layer],
              Icon = info.icon,
              items = model.measures.filter(
                (m) => layerOf(m.category) === layer,
              ),
              enabled = items.filter((m) => m.enabled).length;
            return (
              <section
                key={layer}
                className="rw-card"
                aria-label={measureLayerNames[layer]}
              >
                <div className="rw-card-head">
                  <h2 className={"rw-direction is-" + info.tone}>
                    <Icon size={18} aria-hidden />
                    {measureLayerNames[layer]}
                    <small>
                      {info.goal} · 已启用 {enabled} / {items.length}
                    </small>
                  </h2>
                  <button
                    className="rw-button"
                    onClick={() => setAdding(info.categories[0])}
                  >
                    <Plus size={15} aria-hidden />
                    添加措施
                  </button>
                </div>
                <p className="rw-hint">{info.hint}</p>
                {info.categories.map((category) => {
                  const group = items.filter((m) => m.category === category),
                    on = group.filter((m) => m.enabled),
                    off = group
                      .filter((m) => !m.enabled)
                      .sort((a, b) => gainOf(b).marginal - gainOf(a).marginal),
                    card = (measure: Measure) => (
                      <MeasureCard
                        key={measure.id}
                        measure={measure}
                        contribution={gainOf(measure)}
                        onEdit={() => setEditing(measure.id)}
                      />
                    );
                  return (
                    <div key={category} className="rw-measure-group">
                      {info.categories.length > 1 && (
                        <h3 className="rw-subhead">
                          {measureCategoryNames[category]}
                          <small>
                            {categoryHints[category]} · 已启用 {on.length} /{" "}
                            {group.length}
                          </small>
                        </h3>
                      )}
                      {group.length === 0 && (
                        <p className="rw-empty">这一类还没有措施。</p>
                      )}
                      {on.length > 0 && (
                        <div className="rw-measures">{on.map(card)}</div>
                      )}
                      <Candidates
                        items={off}
                        render={card}
                        limit={layer === "component" ? 5 : 3}
                      />
                    </div>
                  );
                })}
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

      <DoseSection />
      <PathSection />
      <FocusSection />

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
                <strong>措施为什么这样分层。</strong>
                每周损失 = 故障频次 × 单次等效损失，所以措施只有两个着力点。
                <b>组件级高可用</b>
                作用在第一个因子上：降低器件失效率，对所有后续环节都等比例受益，但只对它针对的器件有效。
                <b>系统级可靠性机制</b>
                作用在第二个因子上，按恢复链的先后分为四类：检测（多快、多全地发现）、恢复（就地恢复、进程重调度、CKPT
                回滚、人工恢复）、隔离与弹性（隔离并替换故障资源）、检查点（少回滚、低开销）。系统级机制对多种器件的故障同时有效，但受故障类型限制，比如重执行只对瞬时故障有用。
              </p>
            </li>
            <li>
              <p>
                <strong>措施如何生效。</strong>
                每项措施只改动它所作用的故障模式的参数：故障率、检出率、检测时间、恢复阶梯上某一级的成功率与耗时、回滚重算或影响系数。措施不一定对所有故障都有效，所以每项措施有一个“适用比例”，参数按它在现值与目标值之间折算。同一个参数被多项措施“设为”新值时只取最好的一项，不叠加；“按比例降低”的则连乘。改完后用第
                2 步同一套公式重新评估，所以“设计后”与“现状”可以直接比较。
              </p>
            </li>
            <li>
              <p>
                <strong>改进程度与收益。</strong>
                把一项措施从不做（0）逐步推到主要参数的理想极限（100%：故障率降到
                0、成功率或检出率到 100%、时间缩到
                0），其余措施保持不变，逐点重新评估系统可用度。计划点之前，这项措施的全部参数按同一比例打折；计划点之后，主要参数继续加码。曲线的高度回答“这项措施最多值多少”，计划点的位置回答“现在的计划拿到了其中多少”。
              </p>
            </li>
            <li>
              <p>
                <strong>组合收益。</strong>
                措施之间有重叠：故障率降低后，再缩短恢复时间能省下的损失也变少；两项都缩短同一段时间时只有更好的一项起作用。所以单项收益不能直接相加。组合路径从现状出发，每一步加入“在已选措施基础上提升最大”的一项，排在前面的就是扣除重叠之后最值得先做的。
              </p>
            </li>
            <li>
              <p>
                <strong>贡献为什么用 Shapley 值。</strong>
                逐个“去掉看看”得到的收益加起来不等于总提升。Shapley
                值对所有启用顺序求平均边际收益，是唯一同时满足“相加等于总提升”“作用相同的措施贡献相同”“没有作用的措施贡献为零”的分摊方式。
              </p>
              <Formula>
                φᵢ = Σ_S |S|!·(n−|S|−1)! / n! · [ A(S ∪ {"{i}"}) − A(S) ]
              </Formula>
            </li>
            <li>
              <p>
                <strong>推荐方案与最低要求。</strong>
                在已启用措施的基础上，按数量从少到多穷举其余措施的组合，找到的第一组即数量最少；数量相同时优先证据更充分的，其次选可用度更高的。候选很多、穷举不完时，改为逐步加入提升最大的措施，达标后再剔除可以去掉的项。“最低要求”是其余措施按计划兑现时，这一项的效果至少要兑现多少仍能达标，用二分法求得；它是单项的下限，几项同时打折时不能各自都取下限。
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
        <MeasureDialog category={adding} onClose={() => setAdding(undefined)} />
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

/** 改进程度—收益：每项措施从现状做到理想极限，系统可用度能提升多少。 */
function DoseSection() {
  const { model } = useWorkbench();
  const curves = useMemo(
    () =>
      model.measures
        .map((measure) => doseResponse(model, measure.id))
        .filter((curve): curve is DoseResponse => curve !== null)
        .sort(
          (a, b) =>
            b.points[b.points.length - 1].gain -
            a.points[a.points.length - 1].gain,
        ),
    [model],
  );
  const top = curves.slice(0, seriesColors.length),
    measureOf = (id: string) => model.measures.find((m) => m.id === id)!,
    pp = (value: number) => (value * 100).toFixed(1) + " pp";
  if (!top.length) return null;
  const rest = curves[top.length];
  return (
    <section className="rw-card" aria-label="改进程度与收益">
      <div className="rw-card-head">
        <h2>改进程度与收益：每项措施做到什么程度值多少</h2>
        <span className="rw-muted">
          极限收益最大的 {top.length} 项，其余措施保持当前启用状态
        </span>
      </div>
      <div className="rw-grid is-chart">
        <LineChart
          label="各措施的改进程度与系统可用度提升"
          xLabel="改进程度（0 = 不做，100% = 主要参数做到理想极限）"
          yLabel="系统可用度提升（百分点）"
          xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
          formatX={(v) => percent(v, 0)}
          formatY={pp}
          yMin={0}
          height={340}
          series={top.map((curve, index) => {
            const measure = measureOf(curve.id);
            return {
              name: curve.name,
              color: seriesColors[index],
              points: curve.points.map((p) => ({ x: p.degree, y: p.gain })),
              marks: [{ x: curve.planned, y: curve.plannedGain }],
              detail: (x: number) => {
                const point = curve.points.find((p) => p.degree === x);
                return point ? valueText(measure, point.value) : "";
              },
            };
          })}
        />
        <div className="rw-explain is-inline">
          <p>
            <strong>怎么读这张图。</strong>
            横轴是每项措施的“改进程度”：0 是不做，100%
            是主要参数做到理想极限（故障率降到 0、成功率或检出率到
            100%、时间缩到
            0）。纵轴是这项措施单独变化时系统可用度提升多少个百分点。
          </p>
          <p>
            线越高，这项措施的上限越大；圆点是当前计划的位置，圆点右边的那段就是把计划再加码还能拿到的收益。线向上弯，说明越做到后面收益越大（剩下的损失越少，同样一段损失折算成的可用度越多）；线平缓的措施，再加码意义不大。
          </p>
        </div>
      </div>
      <div className="rw-table-wrap">
        <table className="rw-table">
          <thead>
            <tr>
              <th>措施</th>
              <th>层级</th>
              <th>主要参数</th>
              <th className="is-num">现状</th>
              <th className="is-num">计划</th>
              <th className="is-num">计划的改进程度</th>
              <th className="is-num">计划收益</th>
              <th className="is-num">做到极限的收益</th>
              <th className="is-num">计划已拿到</th>
            </tr>
          </thead>
          <tbody>
            {top.map((curve, index) => {
              const measure = measureOf(curve.id),
                effect = measure.effects[0],
                full = curve.points[curve.points.length - 1].gain;
              return (
                <tr key={curve.id}>
                  <td>
                    <span className="rw-series-name">
                      <i style={{ background: seriesColors[index] }} />
                      {curve.name}
                      {!measure.enabled && (
                        <small className="rw-muted">候选</small>
                      )}
                    </span>
                  </td>
                  <td>
                    <LayerChip category={measure.category} />
                  </td>
                  <td>{measureParamNames[effect.param]}</td>
                  <td className="is-num">
                    {effect.op === "reduce"
                      ? "不降低"
                      : formatParam(effect.param, curve.points[0].value)}
                  </td>
                  <td className="is-num is-strong">
                    {valueText(measure, effect.value)}
                  </td>
                  <td className="is-num">{percent(curve.planned, 0)}</td>
                  <td className="is-num is-strong">
                    {points(curve.plannedGain)}
                  </td>
                  <td className="is-num">{points(full)}</td>
                  <td className="is-num">
                    {full > 1e-9 ? percent(curve.plannedGain / full, 0) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rw-hint">
        收益是在“其余措施保持当前启用状态”下算的：已启用的措施是去掉它会损失多少，候选措施是加上它还能提升多少。主要参数是措施的第一项参数变化。
        {rest &&
          `未列出的措施做到极限的收益都不超过 ${points(rest.points[rest.points.length - 1].gain)}。`}
      </p>
    </section>
  );
}

/** 组合收益路径：扣除相互重叠后，按收益从大到小逐项叠加。 */
function PathSection() {
  const { model, analysis, update } = useWorkbench(),
    [all, setAll] = useState(false);
  const path = useMemo(() => priorityPath(model), [model]);
  const target = model.scenario.target,
    standalone = (id: string) =>
      analysis.contributions.items.find((c) => c.id === id)?.standalone ?? 0,
    reached = path.reachedAt,
    visible = all
      ? path.steps
      : path.steps.slice(0, Math.min(path.steps.length, (reached ?? 8) + 2)),
    count = path.steps.length,
    step = count > 16 ? 4 : count > 8 ? 2 : 1,
    ticks = Array.from({ length: count + 1 }, (_, i) => i).filter(
      (i) => i % step === 0,
    ),
    last = path.steps[count - 1];
  if (!count) return null;
  const adopt = (n: number) =>
    update((d) => {
      const chosen = new Set(path.steps.slice(0, n).map((s) => s.id));
      for (const measure of d.measures)
        measure.enabled = chosen.has(measure.id);
    });
  return (
    <section className="rw-card" aria-label="组合收益路径">
      <div className="rw-card-head">
        <h2>组合收益：先做哪几项，做到第几项达标</h2>
        {reached !== null && (
          <button className="rw-button" onClick={() => adopt(reached)}>
            只启用前 {reached} 项
          </button>
        )}
      </div>
      <div className="rw-grid is-chart">
        <LineChart
          label="按优先顺序逐项叠加措施后的系统可用度"
          xLabel="按优先顺序累计启用的措施数量"
          yLabel="系统可用度"
          xTicks={ticks}
          formatX={(v) => (v === 0 ? "现状" : String(v))}
          formatY={(v) => percent(v, 0)}
          height={340}
          horizontal={[
            { y: target, label: "目标 " + percent(target), align: "start" },
          ]}
          vertical={
            reached === null
              ? undefined
              : [{ x: reached, label: `第 ${reached} 项达标` }]
          }
          series={[
            {
              name: "累计可用度",
              color: seriesColors[0],
              points: [
                { x: 0, y: path.base },
                ...path.steps.map((s, i) => ({ x: i + 1, y: s.availability })),
              ],
              marks:
                reached === null
                  ? undefined
                  : [{ x: reached, y: path.steps[reached - 1].availability }],
              detail: (x: number) =>
                x === 0
                  ? "不做任何措施"
                  : `加入 ${path.steps[x - 1].name}（${points(path.steps[x - 1].gain)}）`,
            },
          ]}
        />
        <div className="rw-explain is-inline">
          <p>
            <strong>怎么读这张图。</strong>
            从现状出发，每一步都加入“在已选措施基础上提升最大”的那一项。曲线前段陡、后段平：前几项拿走了大部分收益，后面的措施与前面重叠，再加收益越来越小。
          </p>
          <p>
            {reached === null ? (
              <>
                措施库里有提升的 {count} 项全部做完，可到{" "}
                <b>{percent(last.availability)}</b>
                ，仍低于目标，需要加码参数或新增措施。
              </>
            ) : (
              <>
                按这个顺序做到第 <b>{reached}</b> 项即可达标（
                {percent(path.steps[reached - 1].availability)}
                ）；全部 {count} 项做完的上限是{" "}
                <b>{percent(last.availability)}</b>。前 3 项合计{" "}
                <b>
                  {points(
                    path.steps[Math.min(2, count - 1)].availability - path.base,
                  )}
                </b>
                ，占达标所需提升的{" "}
                {percent(
                  (path.steps[Math.min(2, count - 1)].availability -
                    path.base) /
                    Math.max(target - path.base, 1e-9),
                  0,
                )}
                。
              </>
            )}
          </p>
        </div>
      </div>
      <div className="rw-table-wrap">
        <table className="rw-table">
          <thead>
            <tr>
              <th className="is-num">顺序</th>
              <th>措施</th>
              <th>层级</th>
              <th className="is-num">单独做</th>
              <th className="is-num">排在这一步再提升</th>
              <th className="is-num">累计可用度</th>
              <th>当前设计</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item, index) => (
              <tr
                key={item.id}
                className={
                  reached !== null && index >= reached ? "rw-row-muted" : ""
                }
              >
                <td className="is-num">{index + 1}</td>
                <td>{item.name}</td>
                <td>
                  <LayerChip category={item.category} />
                </td>
                <td className="is-num">{points(standalone(item.id))}</td>
                <td className="is-num is-strong">{points(item.gain)}</td>
                <td className="is-num">
                  {reached === index + 1 && (
                    <>
                      <Status tone="good">达标</Status>{" "}
                    </>
                  )}
                  {percent(item.availability)}
                </td>
                <td>
                  {item.enabled ? (
                    "已启用"
                  ) : (
                    <span className="rw-muted">未启用</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {path.steps.length > visible.length || all ? (
        <button className="rw-more" onClick={() => setAll(!all)}>
          <ChevronDown size={15} aria-hidden />
          {all ? "收起" : `显示全部 ${count} 步`}
        </button>
      ) : null}
      <p className="rw-hint">
        “单独做”是只启用这一项时的提升，“排在这一步再提升”是在前面各项已启用的基础上再加它的提升。两者的差来自措施之间的相互作用：多数是重叠，排得越靠后，被前面的措施抢走的收益越多；少数反而更大，因为现状损失很大时，同样一段损失在其他损失被削掉之后折算成的可用度更多。这条路径是逐步选取的结果，用来排优先级；数量最少的达标组合见页面顶部的建议。
      </p>
    </section>
  );
}

/** 结论：重点做哪几项、每项做到什么程度。 */
function FocusSection() {
  const { model, analysis } = useWorkbench(),
    { recommendation, baseline } = analysis;
  const ids = useMemo(() => {
    const add = new Set(
      recommendation.kind === "met" ? [] : recommendation.add,
    );
    return model.measures
      .filter((m) => m.enabled || add.has(m.id))
      .map((m) => m.id);
  }, [model, recommendation]);
  const result = useMemo(() => {
    const share = shapley(model, ids);
    return {
      share: share.values,
      exact: share.exact,
      minimum: minimumDegrees(model, ids),
      availability: createEvaluator(model)(new Set(ids)),
    };
  }, [model, ids]);
  if (!ids.length) return null;
  const target = model.scenario.target,
    met = result.availability >= target,
    rows = ids
      .map((id) => model.measures.find((m) => m.id === id)!)
      .sort((a, b) => result.share.get(b.id)! - result.share.get(a.id)!),
    total = result.availability - baseline.system.availability,
    layerGain = (layer: MeasureLayer) =>
      rows
        .filter((m) => layerOf(m.category) === layer)
        .reduce((sum, m) => sum + result.share.get(m.id)!, 0),
    layerCount = (layer: MeasureLayer) =>
      rows.filter((m) => layerOf(m.category) === layer).length,
    top = rows.slice(0, 3),
    topGain = top.reduce((sum, m) => sum + result.share.get(m.id)!, 0),
    pending = rows.filter((m) => !m.enabled).length;
  return (
    <section className="rw-card" aria-label="重点措施结论">
      <div className="rw-card-head">
        <h2>结论：重点做哪几项，做到什么程度</h2>
        <Status tone={met ? "good" : "bad"}>
          {met ? "这组措施可达 " : "这组措施只能到 "}
          {percent(result.availability)}
        </Status>
      </div>
      <p className="rw-lead">
        {pending > 0
          ? `已启用的 ${rows.length - pending} 项加上建议补充的 ${pending} 项，共 ${rows.length} 项`
          : `当前启用的 ${rows.length} 项`}
        ，把可用度从 {percent(baseline.system.availability)} 提到{" "}
        <b>{percent(result.availability)}</b>（目标 {percent(target)}
        ）。其中{measureLayerNames.component} {layerCount("component")} 项贡献{" "}
        <b>{points(layerGain("component"))}</b>，{measureLayerNames.system}{" "}
        {layerCount("system")} 项贡献 <b>{points(layerGain("system"))}</b>
        。贡献最大的 {top.length} 项是
        {top.map((m) => `“${m.name}”`).join("、")}，合计占总提升的{" "}
        {total > 1e-9 ? percent(topGain / total, 0) : "—"}。
      </p>
      <div className="rw-table-wrap">
        <table className="rw-table">
          <thead>
            <tr>
              <th className="is-num">优先级</th>
              <th>措施</th>
              <th>作用对象</th>
              <th>计划做到</th>
              <th>最低要求</th>
              <th className="is-num">贡献</th>
              <th>证据</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((measure, index) => {
              const effect = measure.effects[0],
                base = baseValue(model, measure, effect.param),
                minimum = result.minimum.get(measure.id),
                sign = higherIsBetter(effect.param) ? "≥" : "≤";
              return (
                <tr key={measure.id}>
                  <td className="is-num">{index + 1}</td>
                  <td>
                    <span className="rw-focus-name">
                      <b>{measure.name}</b>
                      <LayerChip category={measure.category} />
                    </span>
                  </td>
                  <td className="rw-cell-wrap">{targetText(model, measure)}</td>
                  <td className="rw-cell-wrap">
                    {measureParamNames[effect.param]}{" "}
                    {base === null || effect.op === "add" ? (
                      <b>{valueText(measure, effect.value)}</b>
                    ) : (
                      <>
                        {formatParam(effect.param, base)} →{" "}
                        <b>
                          {formatParam(
                            effect.param,
                            applyEffect(effect, base, measure.applicability),
                          )}
                        </b>
                      </>
                    )}
                    {measure.effects.length > 1 && (
                      <small className="rw-muted">
                        {" "}
                        等 {measure.effects.length} 项
                      </small>
                    )}
                  </td>
                  <td>
                    {minimum === null || minimum === undefined ? (
                      <span className="rw-muted">组合未达标，需全部做足</span>
                    ) : minimum <= 1e-6 ? (
                      <span className="rw-muted">可作为余量</span>
                    ) : (
                      <>
                        兑现 ≥ {percent(minimum, 0)}
                        {base !== null && effect.op !== "add" && (
                          <small className="rw-focus-min">
                            即 {sign}{" "}
                            {formatParam(
                              effect.param,
                              applyEffect(
                                effect,
                                base,
                                measure.applicability * minimum,
                              ),
                            )}
                          </small>
                        )}
                      </>
                    )}
                  </td>
                  <td className="is-num is-strong">
                    {points(result.share.get(measure.id)!)}
                  </td>
                  <td>{evidenceStateNames[measure.evidence]}</td>
                  <td>
                    {measure.enabled ? (
                      "已启用"
                    ) : (
                      <Status tone="warn">建议启用</Status>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rw-hint">
        优先级按 Shapley
        贡献从大到小排列，各项贡献相加等于这组措施的总提升。“最低要求”是其余各项按计划兑现时，这一项的效果至少兑现多少仍能达标：比例越接近
        100%，越没有打折的余地，越要重点保证；“可作为余量”表示去掉它仍达标。
        {!result.exact && "措施较多，贡献采用固定种子的抽样估计。"}
      </p>
    </section>
  );
}

/** 候选措施列表：先显示提升最大的几项，其余按需展开。 */
function Candidates({
  items,
  render,
  limit = 3,
}: {
  items: Measure[];
  render: (measure: Measure) => ReactNode;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  return (
    <>
      <h4 className="rw-candidate-head">
        候选 {items.length} 项<small>按启用后还能提升多少排序</small>
      </h4>
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
        {measureLayerNames.component}
        <span className="rw-key is-mttr" />
        {measureLayerNames.system}
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
                  className={"rw-contrib-bar is-" + layerTone(item.category)}
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

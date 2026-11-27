import { Fragment, useMemo, useState, type ReactNode } from "react";
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
  applyMeasures,
  assess,
  auditLibraryMeasures,
  correctLibraryMeasures,
  createEvaluator,
  doseResponse,
  effectSweep,
  evidenceStateNames,
  higherIsBetter,
  layerOf,
  loadByStage,
  measureCategoryNames,
  measureLayerNames,
  measureParamNames,
  minimumDegrees,
  priorityPath,
  readParam,
  shapley,
  solveEffect,
  type DoseResponse,
  type Measure,
  type MeasureCategory,
  type MeasureContribution,
  type MeasureEffect,
  type MeasureLayer,
  type MeasureParam,
  type PathOrder,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { usageText } from "./StepAssess";
import ArchitectureDiagram from "./ArchitectureDiagram";
import MeasureDialog from "./MeasureDialog";
import MeasureScaleCharts from "./MeasureScaleCharts";
import FaultChainComparison from "./FaultChainComparison";
import { LineChart, seriesColors } from "./Charts";
import {
  applyEffect,
  baseValue,
  formatParam,
  isRatio,
  targetText,
  writeBase,
} from "./helpers";
import { duration, hours, percent, points } from "./format";
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
    : effect.op === "subtract"
      ? "减少 " + formatParam(effect.param, value)
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
    editingMeasure = model.measures.find((m) => m.id === editing),
    // 早期措施库把阶段节省写成了整段恢复时间，需要显式修正
    legacyIssues = auditLibraryMeasures(model),
    [scalesOpen, setScalesOpen] = useState(false);
  // 推荐的组合做完之后，剩余故障损失花在了哪个环节：不达标时指出该从哪一级下手
  const residual = useMemo(() => {
    if (recommendation.kind !== "short") return [];
    const ids = new Set([
      ...model.measures.filter((m) => m.enabled).map((m) => m.id),
      ...recommendation.add,
    ]);
    return loadByStage(assess(model, applyMeasures(model, ids))).slice(0, 2);
  }, [model, recommendation]);
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
                <b>{percent(recommendation.furtherReduction, 0)}</b>。
                {residual.length > 0 && (
                  <>
                    这组措施做完之后，剩余故障损失主要花在{" "}
                    <b>
                      {residual
                        .map((s) => `${s.name}（${percent(s.share, 0)}）`)
                        .join("和")}
                    </b>
                    ，要达标得从这{residual.length > 1 ? "两" : "一"}
                    级的参数下手。
                  </>
                )}
                {recommendation.held.length > 0 && (
                  <>
                    {" "}
                    标为“暂不优化”的{" "}
                    <b>{recommendation.held.map(nameOf).join("、")}</b> 没有计入
                    {recommendation.heldGain > 0.0005
                      ? `，按它现在的参数也做，可再提升 ${points(recommendation.heldGain)}。`
                      : "；展开它可以看参数做到多少值多少。"}
                  </>
                )}
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
          推荐同时检查整系统 {percent(target)} 及固定域目标。
          {analysis.requirements
            .filter((d) => !d.met)
            .map((d) => `${d.name}尚未达到 ${percent(d.target!, 5)}`)
            .join("；") || "固定域目标当前均满足。"}{" "}
          推荐依据解析均值；窗口波动、局部预算及工程条件需在第四步核验。
        </p>
      )}

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
                      .filter((m) => !m.enabled && !m.hold)
                      .sort((a, b) => gainOf(b).marginal - gainOf(a).marginal),
                    held = group.filter((m) => !m.enabled && m.hold),
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
                      {held.length > 0 && (
                        <>
                          <h4 className="rw-candidate-head">
                            暂不优化 {held.length} 项
                            <small>保持现状，不进入推荐方案和组合排序</small>
                          </h4>
                          <div className="rw-candidates">{held.map(card)}</div>
                        </>
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
            <OrderNote />
          </section>
        </aside>
      </div>

      <BenefitSection />
      <PathSection />
      <FocusSection />

      {/* 五个规模下每项措施单独值多少：域级约束研究里默认展开，其余场景按需展开 */}
      {model.requirements ? (
        <MeasureScaleCharts />
      ) : (
        <details
          className="rw-disclosure"
          onToggle={(e) => setScalesOpen(e.currentTarget.open)}
        >
          <summary>
            <ChevronDown size={16} aria-hidden />
            逐措施跨规模收益：千卡到五十万卡，每项措施单独值多少
          </summary>
          <div className="rw-disclosure-body">
            {scalesOpen && <MeasureScaleCharts />}
          </div>
        </details>
      )}
      <FaultChainComparison />

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
                <strong>各措施值多少、参数做到多少值多少。</strong>
                一项措施的收益 =
                有它和没有它时系统可用度之差，其余措施保持当前的启用状态。“做到极限”是把它的主要参数推到理想极限（故障率降到
                0、成功率或检出率到 100%、时间缩到
                0）时的收益，回答“这项措施最多值多少”；计划收益占其中多少，就是现在的计划拿到了几成。展开任一措施，可以逐个参数看“取值—系统可用度”曲线：这一个参数从不改一路扫到理想极限，其余参数和其余措施都不动。
              </p>
            </li>
            <li>
              <p>
                <strong>组合收益。</strong>
                措施之间有重叠：故障率降低后，再缩短恢复时间能省下的损失也变少；两项都缩短同一段时间时只有更好的一项起作用。所以单项收益不能直接相加。组合路径从现状出发，每一步加入“在已选措施基础上提升最大”的一项，排在前面的就是扣除重叠之后最值得先做的。某一步的收益和“单独做”差得明显时，会指出是前面哪一项造成的：把那一项从前序措施里拿掉，看这一步的收益往回变多少，变得最多的就是它。标为“暂不优化”的措施不参与排序和推荐。
              </p>
            </li>
            <li>
              <p>
                <strong>贡献为什么用 Shapley 值。</strong>
                逐个“去掉看看”得到的收益加起来不等于总提升。Shapley
                值对所有启用顺序求平均边际收益，满足“相加等于总提升”“作用相同的措施贡献相同”“没有作用的措施贡献为零”和可加性这四项公理。所以同一项措施会有三个不同的数：单独做（只上它一项）、组合路径里的增量（前面的都做了再加它）、分摊值（总提升里算它多少，介于前两者之间）。三个数都对，回答的问题不同。
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

/** 主要参数的计划写法：按比例降低写“降低 x%”，设为新值写“现值 → 计划值”。 */
function planText(measure: Measure, start: number) {
  const effect = measure.effects[0],
    name = measureParamNames[effect.param];
  if (effect.op === "reduce" || effect.op === "subtract")
    return name + " " + valueText(measure, effect.value);
  const text = (value: number) =>
    isRatio(effect.param)
      ? Number((value * 100).toFixed(2)) + "%"
      : formatParam(effect.param, value);
  return Math.abs(effect.value - start) < 1e-12
    ? `${name} 保持 ${text(start)}`
    : `${name} ${text(start)} → ${text(effect.value)}`;
}

/** 各措施值多少：按计划做到的收益，以及主要参数做到理想极限的收益。 */
function BenefitSection() {
  const { model } = useWorkbench(),
    tooltip = useTooltip(),
    [all, setAll] = useState(false);
  const rows = useMemo(
    () =>
      model.measures
        .map((measure) => doseResponse(model, measure.id))
        .filter((curve): curve is DoseResponse => curve !== null)
        .map((curve) => ({
          curve,
          measure: model.measures.find((m) => m.id === curve.id)!,
          full: curve.points[curve.points.length - 1].gain,
        }))
        .sort(
          (a, b) =>
            Math.max(b.full, b.curve.plannedGain) -
            Math.max(a.full, a.curve.plannedGain),
        ),
    [model],
  );
  if (!rows.length) return null;
  const limit = 10,
    shown = all ? rows : rows.slice(0, limit),
    max = Math.max(
      ...rows.map((r) => Math.max(r.full, r.curve.plannedGain)),
      1e-9,
    ),
    width = (value: number) => (Math.max(0, value) / max) * 100 + "%",
    enabled = rows.filter((r) => r.measure.enabled),
    best = [...enabled].sort(
      (a, b) => b.curve.plannedGain - a.curve.plannedGain,
    )[0],
    // 计划之外还能多拿最多的一项：加码的首选
    headroom = [...rows].sort(
      (a, b) => b.full - b.curve.plannedGain - (a.full - a.curve.plannedGain),
    )[0];
  return (
    <section className="rw-card" aria-label="各措施值多少">
      <div className="rw-card-head">
        <h2>各措施值多少：按计划做到的收益，和做到极限的收益</h2>
        <span className="rw-legend">
          <span className="rw-key is-mtbf" />
          组件级
          <span className="rw-key is-mttr" />
          系统级
          <span className="rw-key is-headroom" />
          做到极限还能多拿
        </span>
      </div>
      <p className="rw-lead">
        实心条是按计划参数做到的收益：有这项措施和没有它，系统可用度差多少。后面的浅色条是把主要参数做到理想极限还能多拿的部分。
        {best && (
          <>
            {" "}
            已启用的措施里“{best.measure.name}”最值钱，去掉它会损失{" "}
            <b>{points(best.curve.plannedGain)}</b>。
          </>
        )}
        {headroom && headroom.full - headroom.curve.plannedGain > 0.005 && (
          <>
            {" "}
            加码空间最大的是“{
              headroom.measure.name
            }”，主要参数做到极限还能再拿{" "}
            <b>{points(headroom.full - headroom.curve.plannedGain)}</b>。
          </>
        )}
      </p>
      <div
        className="rw-benefit"
        role="table"
        aria-label="各措施的计划收益与极限收益"
      >
        <div className="rw-benefit-row is-head" role="row">
          <span role="columnheader">措施</span>
          <span role="columnheader">主要参数：现状 → 计划</span>
          <span role="columnheader">系统可用度提升</span>
          <span role="columnheader" className="is-num">
            计划
          </span>
          <span role="columnheader" className="is-num">
            做到极限
          </span>
        </div>
        {shown.map(({ curve, measure, full }) => {
          const tone = layerTone(measure.category),
            state = measure.enabled
              ? "已启用"
              : measure.hold
                ? "暂不优化"
                : "候选";
          return (
            <div
              key={curve.id}
              className={"rw-benefit-row" + (measure.enabled ? "" : " is-off")}
              role="row"
            >
              <span role="rowheader" className="rw-benefit-name">
                <b>{curve.name}</b>
                <small>
                  {layerOf(measure.category) === "component"
                    ? "组件级"
                    : "系统级 · " + measureCategoryNames[measure.category]}
                  {" · "}
                  {state}
                </small>
              </span>
              <span role="cell" className="rw-benefit-param">
                {planText(measure, curve.points[0].value)}
                {measure.effects.length > 1 && (
                  <small> 等 {measure.effects.length} 项</small>
                )}
              </span>
              <span
                role="cell"
                className="rw-benefit-track"
                tabIndex={0}
                aria-label={`${curve.name}：计划 ${points(curve.plannedGain)}，做到极限 ${points(full)}`}
                {...tooltip.bind(
                  <>
                    <strong>{points(curve.plannedGain)}</strong>
                    <span>
                      {curve.name} · 按计划（
                      {measure.enabled ? "去掉它会损失" : "启用后可再提升"}）
                    </span>
                    <strong>{points(full)}</strong>
                    <span>
                      主要参数做到极限（
                      {valueText(
                        measure,
                        curve.points[curve.points.length - 1].value,
                      )}
                      ）
                    </span>
                    <strong>
                      {full > 1e-9 ? percent(curve.plannedGain / full, 0) : "—"}
                    </strong>
                    <span>计划已拿到极限收益的比例</span>
                  </>,
                )}
              >
                <i className="is-full" style={{ width: width(full) }} />
                <i
                  className={"is-plan is-" + tone}
                  style={{ width: width(curve.plannedGain) }}
                />
              </span>
              <span
                role="cell"
                className={
                  "is-num is-strong" + (curve.plannedGain < 0 ? " is-bad" : "")
                }
              >
                {points(curve.plannedGain)}
              </span>
              <span role="cell" className="is-num">
                {points(full)}
              </span>
            </div>
          );
        })}
      </div>
      {rows.length > limit && (
        <button className="rw-more" onClick={() => setAll(!all)}>
          <ChevronDown size={15} aria-hidden />
          {all
            ? `只显示前 ${limit} 项`
            : `显示全部 ${rows.length} 项（其余每项做到极限不超过 ${points(rows[limit].full)}）`}
        </button>
      )}
      <p className="rw-hint">
        按“计划收益和极限收益里较大的一个”从大到小排列。收益是在其余措施保持当前启用状态下算的：已启用的措施是去掉它会损失多少，候选和暂不优化的措施是加上它还能提升多少，所以各项不能直接相加（相加的结果见下面的组合收益）。“做到极限”只把主要参数（第一项）推到理想极限：故障率降到
        0、成功率或检出率到 100%、时间缩到
        0。想看某个参数取不同值各值多少，展开上面对应的措施卡片。
      </p>
      {tooltip.node}
    </section>
  );
}

/** 组合收益路径：扣除相互重叠后，按收益从大到小逐项叠加，画成瀑布。 */
function PathSection() {
  const { model, analysis, update } = useWorkbench(),
    tooltip = useTooltip(),
    [all, setAll] = useState(false),
    // 默认先排组件级措施（升 MTBF），再排系统级措施（降 MTTR）
    [order, setOrder] = useState<PathOrder>("layer");
  const path = useMemo(
    () => priorityPath(model, 30, undefined, order),
    [model, order],
  );
  // 两段各自的起止：组件级措施做完时的 MTBF、单次损失和可用度，以及全部做完时的
  const stages = useMemo(() => {
    const state = (ids: string[]) =>
        assess(model, applyMeasures(model, new Set(ids))).system,
      component = path.steps
        .filter((s) => layerOf(s.category) === "component")
        .map((s) => s.id);
    return {
      base: state([]),
      component: state(component),
      all: state(path.steps.map((s) => s.id)),
      componentCount: component.length,
    };
  }, [model, path]);
  const target = model.scenario.target,
    reached = path.reachedAt,
    count = path.steps.length;
  if (!count) return null;
  const last = path.steps[count - 1],
    staged = order === "layer",
    // 主要步骤：达标之前的每一步、提升不小于 0.5 个百分点的步骤；分两段时组件级措施全部列出
    major = path.steps.filter(
      (step, index) =>
        all ||
        step.gain >= 0.005 ||
        (reached !== null && index < reached) ||
        (staged && layerOf(step.category) === "component"),
    ),
    minor = path.steps.filter((step) => !major.includes(step)),
    minorGain = minor.reduce((sum, step) => sum + step.gain, 0),
    top = path.steps.slice(0, Math.min(3, count)),
    topGain = top[top.length - 1].availability - path.base,
    total = last.availability - path.base,
    shares = new Map(
      analysis.contributions.items.map((c) => [c.id, c] as const),
    ),
    // 先后顺序影响最大的一项，用来说明这里的增量为什么和“各措施的贡献”不同
    example = [...path.steps]
      .filter((s) => s.partner?.kind === "overlap" && s.enabled)
      .sort((a, b) => b.standalone - b.gain - (a.standalone - a.gain))[0];
  const adopt = (n: number) =>
    update((d) => {
      const chosen = new Set(path.steps.slice(0, n).map((s) => s.id));
      for (const measure of d.measures)
        measure.enabled = chosen.has(measure.id);
    });
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const track = (bars: ReactNode, props: object = {}) => (
    <span
      className="rw-path-track"
      role="cell"
      style={{ ["--rw-target" as string]: target * 100 + "%" }}
      {...props}
    >
      {ticks.map((tick) => (
        <i
          key={tick}
          className="rw-path-grid"
          style={{ left: tick * 100 + "%" }}
        />
      ))}
      <i
        className="rw-path-grid is-target"
        style={{ left: target * 100 + "%" }}
      />
      {bars}
    </span>
  );
  return (
    <section className="rw-card" aria-label="组合收益路径">
      <div className="rw-card-head">
        <h2>组合收益：按什么顺序做，每加一项到多少</h2>
        <div className="rw-tabs" role="tablist" aria-label="排列顺序">
          {(
            [
              ["layer", "先组件级，后系统级"],
              ["gain", "按提升大小"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              role="tab"
              aria-selected={order === id}
              className={order === id ? "is-active" : ""}
              onClick={() => setOrder(id)}
            >
              {name}
            </button>
          ))}
        </div>
        {reached !== null && (
          <button className="rw-button" onClick={() => adopt(reached)}>
            只启用前 {reached} 项
          </button>
        )}
      </div>
      {staged && (
        <p className="rw-lead">
          <b>先做组件级措施（升 MTBF）</b>：{stages.componentCount} 项把 MTBF 从{" "}
          {duration(stages.base.mtbfHours)} 提到{" "}
          <b>{duration(stages.component.mtbfHours)}</b>，可用度{" "}
          {percent(stages.base.availability)} →{" "}
          <b>{percent(stages.component.availability)}</b>（
          {points(stages.component.availability - stages.base.availability)}）。
          <b>再做系统级措施（降 MTTR）</b>：{count - stages.componentCount}{" "}
          项把单次等效损失从 {duration(stages.component.mttrHours)} 缩到{" "}
          <b>{duration(stages.all.mttrHours)}</b>，可用度到{" "}
          <b>{percent(stages.all.availability)}</b>（
          {points(stages.all.availability - stages.component.availability)}）。
        </p>
      )}
      <p className="rw-lead">
        从现状 {percent(path.base)} 出发，
        {staged
          ? "每一段内每一步加入“在已选措施基础上提升最大”的一项。"
          : "每一步加入“在已选措施基础上提升最大”的一项。"}
        前 {top.length} 项（
        {top.map((s) => s.name).join("、")}）合计 <b>{points(topGain)}</b>
        ，占全部可得提升的 {percent(topGain / Math.max(total, 1e-9), 0)}
        ——这几项是必须做的。
        {reached === null ? (
          <>
            {" "}
            有提升的 {count} 项全部做完到 <b>{percent(last.availability)}</b>
            ，距目标 {percent(target)} 还差{" "}
            <b>{((target - last.availability) * 100).toFixed(2)} pp</b>
            ，需要加码参数或新增措施。
          </>
        ) : (
          <>
            {" "}
            做到第 <b>{reached}</b> 项达标（
            {percent(path.steps[reached - 1].availability)}），全部 {count}{" "}
            项做完的上限是 <b>{percent(last.availability)}</b>。
          </>
        )}
      </p>
      <div
        className="rw-path"
        role="table"
        aria-label="按优先顺序逐项叠加措施后的系统可用度"
      >
        <div className="rw-path-row is-head" role="row">
          <span role="columnheader" className="is-num">
            顺序
          </span>
          <span role="columnheader">加入的措施</span>
          <span className="rw-path-track is-axis" role="columnheader">
            {ticks.map((tick) => (
              <i key={tick} style={{ left: tick * 100 + "%" }}>
                {percent(tick, 0)}
              </i>
            ))}
            <i className="is-target" style={{ left: target * 100 + "%" }}>
              目标 {percent(target, 0)}
            </i>
          </span>
          <span role="columnheader" className="is-num">
            这一步
          </span>
          <span role="columnheader" className="is-num">
            累计可用度
          </span>
        </div>
        <div className="rw-path-row is-base" role="row">
          <span role="cell" className="is-num">
            0
          </span>
          <span role="rowheader" className="rw-path-name">
            <b>现状</b>
            <small>不做任何措施</small>
          </span>
          {track(
            <i
              className="rw-path-bar is-base"
              style={{ left: 0, width: path.base * 100 + "%" }}
            />,
          )}
          <span role="cell" className="is-num" />
          <span role="cell" className="is-num is-strong">
            {percent(path.base)}
          </span>
        </div>
        {major.map((step) => {
          const index = path.steps.indexOf(step),
            before = step.availability - step.gain,
            after = reached !== null && index >= reached,
            shifted =
              step.partner && Math.abs(step.gain - step.standalone) >= 0.005;
          // 分两段时，在每一段的第一项前面加一行小计
          const layer = layerOf(step.category),
            opens =
              staged &&
              (index === 0 ||
                layerOf(path.steps[index - 1].category) !== layer);
          return (
            <Fragment key={step.id}>
              {opens && (
                <div className="rw-path-row is-stage" role="row">
                  <span role="cell">
                    {layer === "component" ? (
                      <>
                        <b>第一段 · 组件级高可用（升 MTBF）</b>　MTBF{" "}
                        {duration(stages.base.mtbfHours)} →{" "}
                        {duration(stages.component.mtbfHours)}，可用度{" "}
                        {percent(stages.base.availability)} →{" "}
                        {percent(stages.component.availability)}（
                        {points(
                          stages.component.availability -
                            stages.base.availability,
                        )}
                        ）
                      </>
                    ) : (
                      <>
                        <b>第二段 · 系统级可靠性机制（降 MTTR）</b>
                        　单次等效损失 {duration(
                          stages.component.mttrHours,
                        )} → {duration(stages.all.mttrHours)}，可用度{" "}
                        {percent(stages.component.availability)} →{" "}
                        {percent(stages.all.availability)}（
                        {points(
                          stages.all.availability -
                            stages.component.availability,
                        )}
                        ）
                      </>
                    )}
                  </span>
                </div>
              )}
              <div
                className={"rw-path-row" + (after ? " is-after" : "")}
                role="row"
              >
                <span role="cell" className="is-num">
                  {index + 1}
                </span>
                <span role="rowheader" className="rw-path-name">
                  <b>{step.name}</b>
                  <small>
                    {layerOf(step.category) === "component"
                      ? "组件级"
                      : "系统级 · " + measureCategoryNames[step.category]}
                    {" · "}
                    {step.enabled ? "已启用" : "候选，未启用"}
                  </small>
                  {shifted && (
                    <small className="rw-path-note">
                      {step.partner!.kind === "overlap"
                        ? `单独做 ${points(step.standalone)}；排在“${step.partner!.name}”之后只剩 ${points(step.gain)}，两者省的是同一段损失`
                        : `单独做 ${points(step.standalone)}；有“${step.partner!.name}”在前，升到 ${points(step.gain)}`}
                    </small>
                  )}
                </span>
                {track(
                  <i
                    className={"rw-path-bar is-" + layerTone(step.category)}
                    style={{
                      left: before * 100 + "%",
                      width: `max(3px, ${step.gain * 100}%)`,
                    }}
                  />,
                  {
                    tabIndex: 0,
                    "aria-label": `第 ${index + 1} 步加入 ${step.name}：${percent(before)} 到 ${percent(step.availability)}`,
                    ...tooltip.bind(
                      <>
                        <strong>{points(step.gain)}</strong>
                        <span>
                          {step.name} · 排在第 {index + 1} 步的提升
                        </span>
                        <strong>{points(step.standalone)}</strong>
                        <span>单独做（其余都不做）</span>
                        {shares.get(step.id)?.enabled && (
                          <>
                            <strong>
                              {points(shares.get(step.id)!.shapley)}
                            </strong>
                            <span>当前设计里的分摊贡献</span>
                          </>
                        )}
                        <strong>
                          {percent(before)} → {percent(step.availability)}
                        </strong>
                        <span>累计可用度</span>
                      </>,
                    ),
                  },
                )}
                <span role="cell" className="is-num is-strong">
                  {points(step.gain)}
                </span>
                <span role="cell" className="is-num">
                  {percent(step.availability)}
                  {reached === index + 1 && (
                    <>
                      {" "}
                      <Status tone="good">达标</Status>
                    </>
                  )}
                </span>
              </div>
            </Fragment>
          );
        })}
        {minor.length > 0 && (
          <div className="rw-path-row is-rest" role="row">
            <span role="cell" className="is-num">
              {count - minor.length + 1}–{count}
            </span>
            <span role="rowheader" className="rw-path-name">
              <b>其余 {minor.length} 项</b>
              <small>
                每项不到 +0.50 pp：{minor.map((s) => s.name).join("、")}
              </small>
            </span>
            {track(
              <i
                className="rw-path-bar is-rest"
                style={{
                  left: (last.availability - minorGain) * 100 + "%",
                  width: `max(3px, ${minorGain * 100}%)`,
                }}
              />,
            )}
            <span role="cell" className="is-num is-strong">
              {points(minorGain)}
            </span>
            <span role="cell" className="is-num">
              {percent(last.availability)}
            </span>
          </div>
        )}
      </div>
      {(minor.length > 0 || all) && (
        <button className="rw-more" onClick={() => setAll(!all)}>
          <ChevronDown size={15} aria-hidden />
          {all ? "收起小项" : `逐项显示全部 ${count} 步`}
        </button>
      )}
      {path.held.length > 0 && (
        <p className="rw-hint">
          标为“暂不优化”的{" "}
          {path.held
            .map((id) => model.measures.find((m) => m.id === id)?.name ?? id)
            .join("、")}{" "}
          不参与排序。
        </p>
      )}
      <div className="rw-explain is-inline rw-path-explain">
        <p>
          <strong>为什么和右上“各措施的贡献”对不上。</strong>
          两边回答的问题不同。这里是<b>按最优顺序逐项加入的增量</b>
          ：前面的措施已经做了，再加这一项还值多少；右上是把已启用措施的总提升按
          Shapley 值<b>分摊</b>
          ，等于对所有先后顺序取平均。措施之间有重叠时，同一项排在前面值得多、排在后面值得少。
          {example && (
            <>
              {" "}
              例如“{example.name}”：单独做 <b>{points(example.standalone)}</b>
              ；排在“{example.partner!.name}”之后只剩{" "}
              <b>{points(example.gain)}</b>
              {shares.get(example.id)?.enabled && (
                <>
                  ；右上的分摊值{" "}
                  <b>{points(shares.get(example.id)!.shapley)}</b> 介于两者之间
                </>
              )}
              。
            </>
          )}
        </p>
        <p>
          排优先级看这里的顺序和增量；讲“这组措施里每一项功劳多大”看分摊值。这条路径是逐步选取的结果，数量最少的达标组合见页面顶部的建议。
        </p>
      </div>
      {tooltip.node}
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
      // 先做这组里的组件级措施（升 MTBF）时的状态，以及全部做完时的状态
      component: assess(
        model,
        applyMeasures(
          model,
          new Set(
            ids.filter(
              (id) =>
                layerOf(model.measures.find((m) => m.id === id)!.category) ===
                "component",
            ),
          ),
        ),
      ).system,
      all: assess(model, applyMeasures(model, new Set(ids))).system,
    };
  }, [model, ids]);
  if (!ids.length) return null;
  const target = model.scenario.target,
    met = result.availability >= target,
    rows = ids
      .map((id) => model.measures.find((m) => m.id === id)!)
      .sort((a, b) => result.share.get(b.id)! - result.share.get(a.id)!),
    total = result.availability - baseline.system.availability,
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
        ）。先做{measureLayerNames.component} {layerCount("component")} 项：MTBF{" "}
        {duration(baseline.system.mtbfHours)} →{" "}
        {duration(result.component.mtbfHours)}，可用度{" "}
        <b>
          {points(result.component.availability - baseline.system.availability)}
        </b>
        ；再做{measureLayerNames.system} {layerCount("system")} 项：单次等效损失{" "}
        {duration(result.component.mttrHours)} →{" "}
        {duration(result.all.mttrHours)}，可用度{" "}
        <b>{points(result.availability - result.component.availability)}</b>
        。按分摊贡献最大的 {top.length} 项是
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

/** 按参数类型选输入框：比例用百分数，故障率用 FIT，其余是时长。 */
function ParamField({
  param,
  label,
  value,
  onCommit,
}: {
  param: MeasureParam;
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  return isRatio(param) ? (
    <NumberField
      label={label}
      value={value}
      factor={100}
      min={0}
      max={param === "overhead" ? 0.5 : 1}
      digits={3}
      suffix="%"
      width={100}
      onCommit={onCommit}
    />
  ) : param === "fit" ? (
    <NumberField
      label={label}
      value={value}
      min={0}
      max={1e7}
      digits={2}
      suffix="FIT"
      width={112}
      onCommit={onCommit}
    />
  ) : (
    <DurationField label={label} value={value} onCommit={onCommit} />
  );
}

/** 措施卡片：已启用时显示参数；候选措施默认只显示一行，展开后可调参数、看参数—收益曲线。 */
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
    [open, setOpen] = useState(false),
    // 改进前各模式取值不同时，逐个模式修改的那一项参数
    [each, setEach] = useState<number | null>(null);
  const patch = (mutate: (m: Measure) => void) =>
    update((d) => mutate(d.measures.find((m) => m.id === measure.id)!));
  const gain = measure.enabled ? contribution.shapley : contribution.marginal,
    held = measure.hold && !measure.enabled,
    showEffects = measure.enabled || open,
    modes = model.modes.filter((mode) => measure.modeIds.includes(mode.id)),
    moduleName = (id: string) =>
      model.modules.find((m) => m.id === id)?.name ?? "";

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
          onChange={(enabled) =>
            patch((m) => {
              m.enabled = enabled;
              // 启用即纳入设计，不再算“暂不优化”
              if (enabled) m.hold = false;
            })
          }
        />
        <div className="rw-measure-title">
          <strong>
            {measure.name}
            {held && <span className="rw-tag">暂不优化</span>}
          </strong>
          <small>
            作用于：{targetText(model, measure)}
            {measure.applicability < 1 &&
              ` · 适用 ${percent(measure.applicability, 0)}`}
          </small>
        </div>
        <div className="rw-measure-gain">
          <strong className={gain < 0 ? "is-bad" : ""}>{points(gain)}</strong>
          <small>
            {measure.enabled
              ? "贡献"
              : held
                ? "按现在的参数"
                : "启用后可再提升"}
          </small>
        </div>
        <button
          className="rw-icon-button"
          aria-expanded={open}
          aria-label={(open ? "收起 " : "展开 ") + measure.name}
          title={open ? "收起" : "调参数、看参数—收益曲线"}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={16} />
        </button>
      </header>
      {showEffects && (
        <div className="rw-effects">
          <div className="rw-effect is-head" aria-hidden>
            <span className="rw-effect-name">参数</span>
            <span className="rw-effect-from">改进前</span>
            <span className="rw-effect-arrow" />
            <span>改进后</span>
          </div>
          {measure.effects.map((effect, index) => {
            const base = baseValue(model, measure, effect.param),
              label = `${measure.name} · ${measureParamNames[effect.param]}`,
              commit = (value: number) =>
                patch((m) => void (m.effects[index].value = value)),
              same =
                effect.op === "set" &&
                base !== null &&
                Math.abs(effect.value - base) < 1e-12;
            return (
              <div key={index} className="rw-effect-block">
                <div className="rw-effect">
                  <span className="rw-effect-name">
                    {measureParamNames[effect.param]}
                  </span>
                  <span className="rw-effect-from">
                    {base === null ? (
                      <button
                        className="rw-link"
                        aria-expanded={each === index}
                        onClick={() => setEach(each === index ? null : index)}
                        title="各故障模式的现状取值不同，逐个修改"
                      >
                        各模式不同 · {each === index ? "收起" : "逐项修改"}
                      </button>
                    ) : (
                      <ParamField
                        param={effect.param}
                        label={label + "（改进前）"}
                        value={base}
                        onCommit={(value) =>
                          update((d) =>
                            writeBase(d, measure.modeIds, effect.param, value),
                          )
                        }
                      />
                    )}
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
                  {effect.op === "reduce" ? (
                    <NumberField
                      label={label + "的降低比例"}
                      value={effect.value}
                      factor={100}
                      min={0}
                      max={1}
                      digits={3}
                      suffix="%"
                      width={100}
                      onCommit={commit}
                    />
                  ) : (
                    <ParamField
                      param={effect.param}
                      label={label}
                      value={effect.value}
                      onCommit={commit}
                    />
                  )}
                  {same ? (
                    <span className="rw-effect-to">与改进前一致</span>
                  ) : (
                    base !== null &&
                    (effect.op !== "set" || measure.applicability < 1) && (
                      <span className="rw-effect-to">
                        ={" "}
                        {formatParam(
                          effect.param,
                          applyEffect(effect, base, measure.applicability),
                        )}
                      </span>
                    )
                  )}
                </div>
                {each === index && base === null && (
                  <ul className="rw-effect-modes">
                    {modes.map((mode) => (
                      <li key={mode.id}>
                        <span>
                          {moduleName(mode.moduleId)} · {mode.name}
                        </span>
                        <ParamField
                          param={effect.param}
                          label={`${mode.name} · ${measureParamNames[effect.param]}（改进前）`}
                          value={readParam(mode, effect.param)}
                          onCommit={(value) =>
                            update((d) =>
                              writeBase(d, [mode.id], effect.param, value),
                            )
                          }
                        />
                        <span className="rw-effect-to">
                          →{" "}
                          {formatParam(
                            effect.param,
                            applyEffect(
                              effect,
                              readParam(mode, effect.param),
                              measure.applicability,
                            ),
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="rw-effect-hint">
            “改进前”就是第 2
            步的现状参数，在这里改会同步到现状评估；“改进后”是这项措施要做到的值。
          </p>
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
          {!measure.enabled && (
            <label className="rw-check">
              <input
                type="checkbox"
                checked={measure.hold}
                onChange={(e) => patch((m) => void (m.hold = e.target.checked))}
              />
              <span>
                暂不优化：保持现状，不进入推荐方案和组合排序（仍可在这里调参数看收益）
              </span>
            </label>
          )}
          {measure.rationale && (
            <p className="rw-measure-why">{measure.rationale}</p>
          )}
          <EffectCurve measure={measure} />
          <dl className="rw-measure-numbers">
            <div>
              <dt>单独启用</dt>
              <dd>{points(contribution.standalone)}</dd>
            </div>
            <div>
              <dt>{measure.enabled ? "去掉后损失" : "加入后提升"}</dt>
              <dd>{points(contribution.marginal)}</dd>
            </div>
            {measure.enabled && (
              <div>
                <dt>分摊贡献</dt>
                <dd>{points(contribution.shapley)}</dd>
              </div>
            )}
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

/** 一个参数取值的写法：按比例降低写百分数，其余按参数类型。 */
const effectValueText = (effect: MeasureEffect, value: number) =>
  effect.op === "reduce"
    ? percent(value, 0)
    : isRatio(effect.param)
      ? Number((value * 100).toFixed(1)) + "%"
      : formatParam(effect.param, value);

/**
 * 参数—收益曲线：措施的某一个参数从“不改”一路扫到理想极限，系统可用度怎么变。
 * 拖动滑块可以试算任意取值，满意后再采用。
 */
function EffectCurve({ measure }: { measure: Measure }) {
  const { model, update } = useWorkbench(),
    [picked, setPicked] = useState(0),
    [trial, setTrial] = useState<number | null>(null);
  const index = Math.min(picked, measure.effects.length - 1),
    effect = measure.effects[index],
    steps = 24;
  const sweep = useMemo(
    () => effectSweep(model, measure.id, index, steps),
    [model, measure.id, index],
  );
  const tabs = measure.effects.length > 1 && (
    <div className="rw-tabs" role="tablist" aria-label="选择参数">
      {measure.effects.map((e, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === index}
          className={i === index ? "is-active" : ""}
          onClick={() => {
            setPicked(i);
            setTrial(null);
          }}
        >
          {measureParamNames[e.param]}
        </button>
      ))}
    </div>
  );
  if (!sweep)
    return (
      <div className="rw-curve">
        <div className="rw-card-head">
          <h4>参数取多少值多少</h4>
          {tabs}
        </div>
        <p className="rw-muted">
          这个参数的现状已经在理想极限，没有可调的范围。
        </p>
      </div>
    );
  const { start, limit } = sweep,
    span = limit - start,
    inside = (value: number) =>
      (value - start) / span >= -1e-9 && (value - start) / span <= 1 + 1e-9,
    // 两个扫描点之间线性插值，拖动时不必重新评估
    at = (value: number) => {
      const position = Math.min(
          steps,
          Math.max(0, ((value - start) / span) * steps),
        ),
        low = Math.min(steps - 1, Math.floor(position)),
        share = position - low;
      return (
        sweep.points[low].availability * (1 - share) +
        sweep.points[low + 1].availability * share
      );
    },
    value = trial ?? sweep.planned,
    current = trial === null ? sweep.plannedAvailability : at(trial),
    target = model.scenario.target,
    name = measureParamNames[effect.param],
    text = (v: number) => effectValueText(effect, v),
    unit =
      effect.op === "reduce"
        ? "降低比例"
        : effect.op === "subtract"
          ? "减少量"
          : effect.op === "add"
            ? "增加量"
            : "取值",
    samePlan = Math.abs(sweep.planned - start) < Math.abs(span) * 1e-6,
    best = sweep.points[steps].availability;
  return (
    <div className="rw-curve">
      <div className="rw-card-head">
        <h4>参数取多少值多少</h4>
        {tabs}
      </div>
      <LineChart
        label={`${measure.name}：${name}取不同值时的系统可用度`}
        xLabel={`${name}的${unit}（其余参数和其余措施不变）`}
        yLabel="系统可用度"
        xTicks={[0, 0.25, 0.5, 0.75, 1].map((t) => start + t * span)}
        formatX={text}
        formatY={(v) => percent(v, 1)}
        height={250}
        horizontal={[
          {
            y: target,
            label: "目标 " + percent(target),
            // 目标标注放在“改进前”标注的另一侧，避免重叠
            align: start < limit ? "end" : "start",
          },
        ]}
        vertical={[
          ...(effect.op === "set" && !samePlan
            ? [{ x: start, label: "改进前" }]
            : []),
          ...(inside(sweep.planned)
            ? [{ x: sweep.planned, label: samePlan ? "改进前 = 计划" : "计划" }]
            : []),
          ...(trial !== null ? [{ x: trial, label: "试算" }] : []),
        ]}
        series={[
          {
            name: "系统可用度",
            color:
              seriesColors[layerOf(measure.category) === "component" ? 0 : 1],
            points: sweep.points.map((p) => ({
              x: p.value,
              y: p.availability,
            })),
            marks: inside(sweep.planned)
              ? [{ x: sweep.planned, y: sweep.plannedAvailability }]
              : undefined,
            detail: (x: number) => `${name} ${text(x)}`,
          },
        ]}
      />
      <div className="rw-curve-try">
        <label>
          <span>拖动试算</span>
          <input
            type="range"
            min={0}
            max={200}
            value={Math.round(
              Math.min(1, Math.max(0, (value - start) / span)) * 200,
            )}
            aria-label={`${measure.name} · ${name}试算取值`}
            aria-valuetext={text(value)}
            onChange={(e) =>
              setTrial(start + (Number(e.target.value) / 200) * span)
            }
          />
        </label>
        <p>
          {name}
          {unit === "取值" ? "取" : unit} <b>{text(value)}</b> 时，系统可用度{" "}
          <b>{percent(current)}</b>
          {trial !== null && (
            <>，比计划 {points(current - sweep.plannedAvailability)}</>
          )}
          ，比不做这项措施 {points(current - sweep.without)}
          {current >= target ? "，已达到目标" : ""}。
          {trial !== null && (
            <>
              <button
                className="rw-link"
                onClick={() => {
                  update((d) => {
                    d.measures.find((m) => m.id === measure.id)!.effects[
                      index
                    ].value = trial;
                  });
                  setTrial(null);
                }}
              >
                采用此值
              </button>
              <button className="rw-link" onClick={() => setTrial(null)}>
                回到计划
              </button>
            </>
          )}
        </p>
      </div>
      <p className="rw-hint">
        曲线是把这一个参数从
        {effect.op === "set" ? "改进前的现值" : " 0（不改）"}
        一路推到理想极限（{text(limit)}
        ），其余参数停在计划值、其余措施保持当前启用状态。做到极限是{" "}
        {percent(best)}
        {best < target ? "，单靠这一个参数到不了目标" : ""}
        。曲线越陡，这个参数越值得加码。
        {!measure.enabled && "这项措施现在没有启用，曲线按“启用它”来算。"}
      </p>
    </div>
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
              <small className="rw-contrib-range">
                单独做 {points(item.standalone)} · 最后加{" "}
                {points(item.marginal)}
              </small>
            </li>
          );
        })}
      </ul>
      {tooltip.node}
    </div>
  );
}

/** 说明分摊值和“单独做”“最后加”的关系，用先后顺序影响最大的一项举例。 */
function OrderNote() {
  const { analysis } = useWorkbench(),
    items = analysis.contributions.items.filter((c) => c.enabled),
    example = [...items].sort(
      (a, b) =>
        Math.abs(b.standalone - b.marginal) -
        Math.abs(a.standalone - a.marginal),
    )[0];
  if (!example || Math.abs(example.standalone - example.marginal) < 0.005)
    return null;
  return (
    <p className="rw-hint">
      每项下面的两个数是它的收益范围：<b>单独做</b>是只上这一项，<b>最后加</b>
      是其余都已启用后再加它。两者差得多，说明它和别的措施省的是同一段损失，先做后做差别大。例如“
      {example.name}”单独做 {points(example.standalone)}、最后加{" "}
      {points(example.marginal)}，分摊值 {points(example.shapley)}{" "}
      介于两者之间。下面“组合收益”按最优顺序逐项加入，那里的增量因此和分摊值不同。
    </p>
  );
}

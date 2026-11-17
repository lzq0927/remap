import { useState } from "react";
import { Plus, Timer, Trash2, TrendingUp } from "lucide-react";
import {
  faultKindNames,
  faultKinds,
  lossPerEvent,
  type FaultKind,
  type FaultMode,
  type ModuleGap,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import ArchitectureDiagram from "./ArchitectureDiagram";
import { blankMode, blankModule, dropModes, dropModule } from "./helpers";
import { count, duration, fit, hours, percent, times } from "./format";
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
export default function StepAssess() {
  const { model, analysis, update } = useWorkbench(),
    { baseline, allocation, baselineGaps } = analysis,
    [selected, setSelected] = useState<string>(),
    tooltip = useTooltip();
  const system = baseline.system,
    ranked = [...baseline.modules].sort((a, b) => b.lossHours - a.lossHours),
    scaleMax = Math.max(
      ...baseline.modules.map((m) => m.lossHours),
      ...allocation.modules.map((m) => m.lossHours),
      1e-9,
    ),
    gapOf = (id: string) => baselineGaps.find((g) => g.id === id)!,
    budgetOf = (id: string) => allocation.modules.find((m) => m.id === id)!;
  const selectedModule = model.modules.find((m) => m.id === selected),
    selectedResult = baseline.modules.find((m) => m.id === selected);

  return (
    <div className="rw-stack">
      <section className="rw-stats" aria-label="系统现状">
        {[
          [
            "每卡故障率",
            fit(system.fitPerCard) + " FIT",
            "各故障模式折算到每张卡后相加",
          ],
          [
            "系统 MTBF",
            duration(system.mtbfHours),
            "全系统平均多久发生一次故障",
          ],
          [
            "单次等效损失",
            duration(system.mttrHours),
            "平均每次故障损失的时间（等效 MTTR）",
          ],
          [
            "窗口内故障",
            count(system.events, 1) + " 次",
            `每 ${model.scenario.hours} 小时的期望次数`,
          ],
          [
            "窗口内损失",
            hours(system.lossHours),
            `允许 ${hours(allocation.lossHours)}`,
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
        title="架构图"
        hint="每个框是一个模块，标出可用度与目标、每卡 FIT、损失时间与预算。点击模块可查看并修改它的故障模式和恢复参数。"
        onSelect={setSelected}
        footer={(groupId) => (
          <button
            className="rw-tile-add"
            onClick={() => {
              const module = blankModule(groupId);
              update((d) => void d.modules.push(module));
              setSelected(module.id);
            }}
          >
            <Plus size={14} aria-hidden />
            添加模块
          </button>
        )}
      />

      <section className="rw-card" aria-label="差距明细">
        <div className="rw-card-head">
          <h2>差距明细</h2>
          <span className="rw-muted">按损失时间从大到小排列</span>
        </div>
        <div className="rw-table-wrap">
          <table className="rw-table">
            <thead>
              <tr>
                <th>模块</th>
                <th className="is-num">FIT / 卡</th>
                <th className="is-num">MTBF</th>
                <th className="is-num">单次等效损失</th>
                <th className="is-num">可用度</th>
                <th className="is-num">目标</th>
                <th>损失时间与预算</th>
                <th>差距</th>
                <th>优先方向</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((module) => {
                const gap = gapOf(module.id),
                  budget = budgetOf(module.id),
                  tone = gapTone(gap);
                return (
                  <tr key={module.id}>
                    <td>
                      <button
                        className="rw-link"
                        onClick={() => setSelected(module.id)}
                      >
                        {module.name}
                      </button>
                    </td>
                    <td className="is-num">{fit(module.fitPerCard)}</td>
                    <td className="is-num">{duration(module.mtbfHours)}</td>
                    <td className="is-num">{duration(module.mttrHours)}</td>
                    <td className="is-num is-strong">
                      {percent(module.availability)}
                    </td>
                    <td className="is-num">{percent(budget.availability)}</td>
                    <td>
                      <span
                        className="rw-lossbar"
                        tabIndex={0}
                        {...tooltip.bind(
                          <>
                            <strong>{hours(module.lossHours)}</strong>
                            <span>{module.name} 现状损失</span>
                            <strong>{hours(budget.lossHours)}</strong>
                            <span>分配预算</span>
                            <strong>{percent(module.share, 1)}</strong>
                            <span>占全部故障损失</span>
                          </>,
                        )}
                      >
                        <span className="rw-lossbar-track">
                          <span
                            className="rw-lossbar-fill"
                            style={{
                              width: (module.lossHours / scaleMax) * 100 + "%",
                            }}
                          />
                          <i
                            style={{
                              left: (budget.lossHours / scaleMax) * 100 + "%",
                            }}
                          />
                        </span>
                        <em>
                          {hours(module.lossHours)}
                          <small> / {hours(budget.lossHours)}</small>
                        </em>
                      </span>
                    </td>
                    <td>
                      <Status tone={tone}>{usageText(gap)}</Status>
                    </td>
                    <td>
                      {gap.suggestion === "none" ? (
                        <span className="rw-muted">—</span>
                      ) : gap.suggestion === "mtbf" ? (
                        <span className="rw-direction is-mtbf">
                          <TrendingUp size={14} aria-hidden />
                          提升 MTBF
                        </span>
                      ) : (
                        <span className="rw-direction is-mttr">
                          <Timer size={14} aria-hidden />
                          降低 MTTR
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="rw-row-muted">
                <td>公共开销</td>
                <td colSpan={5} className="rw-muted">
                  与故障无关的固定损耗，占运行时间的 {percent(system.overhead)}
                </td>
                <td>
                  <span className="rw-lossbar">
                    <span className="rw-lossbar-track" />
                    <em>
                      {hours(system.overheadLossHours)}
                      <small> / {hours(allocation.overheadLossHours)}</small>
                    </em>
                  </span>
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="rw-hint">
          竖线是该模块的损失预算。“优先方向”的判断：单次等效损失高于系统平均的模块，先缩短检测与恢复（降低
          MTTR）；否则故障次数是主因，先降低故障率（提升 MTBF）。
        </p>
      </section>

      <Disclosure title="评估方法与假设">
        <div className="rw-explain">
          <ol>
            <li>
              <p>
                <strong>事件率。</strong>每个故障模式的全系统事件率由单件
                FIT、每卡数量和卡数得到（1 FIT = 每 10⁹ 器件小时 1 次）。
              </p>
              <Formula>
                λᵢ = FITᵢ × 每卡数量 × 卡数 / 10⁹　（次 / 运行小时）
              </Formula>
            </li>
            <li>
              <p>
                <strong>单次等效损失。</strong>
                故障被检出时，损失为检测、恢复、回滚重算三段之和；漏检时按漏检分支的总损失计。两个分支按检出率
                c 加权，再乘以影响系数 κ。
              </p>
              <Formula>
                MTTRᵢ = κ · [ c · (检测 + 恢复 + 回滚) + (1 − c) · 漏检损失 ]
              </Formula>
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
            故障按恒定失效率到达；静默故障的漏检损失按等效停机时间计入；不考虑多个故障同时发生时共享一次恢复。第
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
          ["MTBF", duration(result.mtbfHours)],
          ["单次等效损失", duration(result.mttrHours)],
          [
            "损失 / 预算",
            `${hours(result.lossHours)} / ${hours(budget.lossHours)}`,
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
          <span>每卡数量</span>
          <NumberField
            label="每卡数量"
            value={module.unitsPerCard}
            min={0.0001}
            max={100000}
            digits={4}
            suffix="件"
            onCommit={(v) => patchModule({ unitsPerCard: v })}
          />
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
          <span>上级部件（架构图中归入同名的框，可留空）</span>
          <TextField
            label="上级部件"
            value={module.container}
            maxLength={40}
            placeholder="例如：NPU 模组"
            onCommit={(container) => patchModule({ container })}
          />
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
            <div className="rw-form">
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
                <span>检测时间</span>
                <DurationField
                  label={mode.name + " 的检测时间"}
                  value={mode.detectHours}
                  onCommit={(v) => patchMode(mode.id, { detectHours: v })}
                />
              </label>
              <label>
                <span>恢复时间</span>
                <DurationField
                  label={mode.name + " 的恢复时间"}
                  value={mode.recoverHours}
                  onCommit={(v) => patchMode(mode.id, { recoverHours: v })}
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
                <span>漏检时单次损失</span>
                <DurationField
                  label={mode.name + " 的漏检单次损失"}
                  value={mode.missedLossHours}
                  onCommit={(v) => patchMode(mode.id, { missedLossHours: v })}
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
            <p className="rw-mode-result">
              单次等效损失 <b>{duration(lossPerEvent(mode))}</b> · 窗口内{" "}
              <b>{count(modeResult.events, 1)} 次</b> · 损失{" "}
              <b>{hours(modeResult.lossHours)}</b>
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

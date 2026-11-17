import { useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  coreModelSchema,
  defaultMeasures,
  diagramSlotNames,
  diagramSlots,
  upgradeCoreModel,
  evidenceStateNames,
  evidenceStates,
  faultKindNames,
  faultKinds,
  lossPerEvent,
  type EvidenceState,
  type FaultKind,
  type FaultMode,
  type Measure,
  type MeasureDirection,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import MeasureDialog from "./MeasureDialog";
import {
  blankMode,
  blankModule,
  dropModes,
  dropModule,
  effectText,
  newId,
  targetText,
} from "./helpers";
import { duration, points, saveFile } from "./format";
import { DurationField, NumberField, TextField, Toggle } from "./ui";

type Tab = "modes" | "measures" | "modules";

/** 基础库配置：架构模块、故障模式库、可靠性措施库三张表，四步共用。 */
export default function Library({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const { model, update } = useWorkbench(),
    [tab, setTab] = useState<Tab>("modes"),
    [error, setError] = useState(""),
    fileInput = useRef<HTMLInputElement>(null);
  const tabs: [Tab, string, number][] = [
    ["modes", "故障模式库", model.modes.length],
    ["measures", "可靠性措施库", model.measures.length],
    ["modules", "架构模块", model.modules.length],
  ];
  const importFile = async (file: File) => {
    setError("");
    try {
      const data = JSON.parse(await file.text());
      // 兼容两种文件：只含基础库的文件，或完整的模型参数文件。
      const parsed = coreModelSchema.safeParse(
        upgradeCoreModel({
          ...model,
          groups: data.groups ?? model.groups,
          modules: data.modules ?? model.modules,
          modes: data.modes ?? model.modes,
          measures: data.measures ?? model.measures,
        }),
      );
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .slice(0, 4)
            .map((issue) => `${issue.path.join(".")}：${issue.message}`)
            .join("；"),
        );
      update((d) => {
        d.groups = parsed.data.groups;
        d.modules = parsed.data.modules;
        d.modes = parsed.data.modes;
        d.measures = parsed.data.measures;
        for (const id of Object.keys(d.allocation.customWeights))
          if (!d.modules.some((m) => m.id === id))
            delete d.allocation.customWeights[id];
      });
    } catch (e) {
      setError("导入失败：" + (e as Error).message);
    }
  };

  return (
    <div className="rw-stack">
      <header className="rw-library-head">
        <div>
          <h1>基础库配置</h1>
          <p>
            架构模块、故障模式和可靠性措施是四个步骤共用的三张表。这里的修改立即生效，并随任务保存。
          </p>
        </div>
        <div className="rw-library-actions">
          <button
            className="rw-button"
            onClick={() =>
              saveFile(
                title + "-基础库.json",
                JSON.stringify(
                  {
                    groups: model.groups,
                    modules: model.modules,
                    modes: model.modes,
                    measures: model.measures,
                  },
                  null,
                  2,
                ),
                "application/json",
              )
            }
          >
            <Download size={15} aria-hidden />
            导出基础库
          </button>
          <button
            className="rw-button"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} aria-hidden />
            导入基础库
          </button>
          <input
            ref={fileInput}
            hidden
            aria-label="导入基础库文件"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = "";
            }}
          />
          <button className="rw-button is-primary" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden />
            返回四步流程
          </button>
        </div>
      </header>
      {error && (
        <p className="rw-alert is-bad" role="alert">
          {error}
        </p>
      )}
      <div className="rw-tabs is-large" role="tablist" aria-label="基础库">
        {tabs.map(([id, name, count]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "is-active" : ""}
            onClick={() => setTab(id)}
          >
            {name}
            <small>{count}</small>
          </button>
        ))}
      </div>
      {tab === "modes" && <ModeLibrary />}
      {tab === "measures" && <MeasureLibrary />}
      {tab === "modules" && <ModuleLibrary />}
    </div>
  );
}

function ModeLibrary() {
  const { model, analysis, update } = useWorkbench();
  const patch = (id: string, change: Partial<FaultMode>) =>
    update((d) => Object.assign(d.modes.find((m) => m.id === id)!, change));
  const lossOf = (id: string) =>
    analysis.baseline.modules.flatMap((m) => m.modes).find((m) => m.id === id);
  return (
    <section className="rw-card" aria-label="故障模式库">
      <div className="rw-card-head">
        <h2>故障模式库</h2>
        <button
          className="rw-button"
          onClick={() =>
            update((d) => void d.modes.push(blankMode(d.modules[0].id)))
          }
        >
          <Plus size={15} aria-hidden />
          添加故障模式
        </button>
      </div>
      <p className="rw-hint">
        每一行是一种故障模式。故障率决定多久发生一次；检出率和四段时间决定每次损失多少。事件率
        = 单件 FIT × 模块的每卡数量 × 卡数。
      </p>
      <div className="rw-table-wrap">
        <table className="rw-table is-edit">
          <thead>
            <tr>
              <th>所属模块</th>
              <th>故障模式</th>
              <th>类型</th>
              <th className="is-num">单件故障率</th>
              <th className="is-num">检出率</th>
              <th>检测时间</th>
              <th>恢复时间</th>
              <th>回滚重算</th>
              <th>漏检单次损失</th>
              <th className="is-num">影响系数</th>
              <th className="is-num">单次等效损失</th>
              <th className="is-num">现状损失</th>
              <th>数据来源</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.modes.map((mode) => (
              <tr key={mode.id}>
                <td>
                  <select
                    aria-label={mode.name + " 所属模块"}
                    value={mode.moduleId}
                    onChange={(e) =>
                      patch(mode.id, { moduleId: e.target.value })
                    }
                  >
                    {model.modules.map((module) => (
                      <option key={module.id} value={module.id}>
                        {module.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <TextField
                    className="is-name"
                    label={mode.name + " 的名称"}
                    value={mode.name}
                    fallback="未命名故障"
                    onCommit={(name) => patch(mode.id, { name })}
                  />
                </td>
                <td>
                  <select
                    aria-label={mode.name + " 的类型"}
                    value={mode.kind}
                    onChange={(e) =>
                      patch(mode.id, { kind: e.target.value as FaultKind })
                    }
                  >
                    {faultKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {faultKindNames[kind]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <NumberField
                    label={mode.name + " 的单件故障率（FIT）"}
                    value={mode.fit}
                    min={0}
                    max={1e7}
                    digits={2}
                    suffix="FIT"
                    width={112}
                    onCommit={(fit) => patch(mode.id, { fit })}
                  />
                </td>
                <td>
                  <NumberField
                    label={mode.name + " 的检出率（%）"}
                    value={mode.coverage}
                    factor={100}
                    min={0}
                    max={1}
                    digits={3}
                    suffix="%"
                    width={92}
                    onCommit={(coverage) => patch(mode.id, { coverage })}
                  />
                </td>
                {(
                  [
                    ["detectHours", "检测时间"],
                    ["recoverHours", "恢复时间"],
                    ["reworkHours", "回滚重算"],
                    ["missedLossHours", "漏检单次损失"],
                  ] as const
                ).map(([key, name]) => (
                  <td key={key}>
                    <DurationField
                      label={`${mode.name} 的${name}`}
                      value={mode[key]}
                      onCommit={(value) => patch(mode.id, { [key]: value })}
                    />
                  </td>
                ))}
                <td>
                  <NumberField
                    label={mode.name + " 的影响系数（%）"}
                    value={mode.impact}
                    factor={100}
                    min={0}
                    max={1}
                    digits={2}
                    suffix="%"
                    width={88}
                    onCommit={(impact) => patch(mode.id, { impact })}
                  />
                </td>
                <td className="is-num is-strong">
                  {duration(lossPerEvent(mode))}
                </td>
                <td className="is-num">
                  {(lossOf(mode.id)?.lossHours ?? 0).toFixed(2)} h
                </td>
                <td>
                  <TextField
                    className="is-wide"
                    label={mode.name + " 的数据来源"}
                    value={mode.evidence}
                    maxLength={600}
                    placeholder="实测、厂商数据或工程假设"
                    onCommit={(evidence) => patch(mode.id, { evidence })}
                  />
                </td>
                <td>
                  <button
                    className="rw-icon-button"
                    aria-label={"删除故障模式 " + mode.name}
                    title="删除"
                    disabled={model.modes.length <= 1}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除故障模式“${mode.name}”？只作用于它的措施会一并删除。`,
                        )
                      )
                        update((d) => dropModes(d, new Set([mode.id])));
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rw-hint">
        单次等效损失 = 影响系数 × [ 检出率 × (检测 + 恢复 + 回滚重算) + (1 −
        检出率) × 漏检单次损失 ]。亚健康类故障请把降速比例折算进各段时间。
      </p>
    </section>
  );
}

function MeasureLibrary() {
  const { model, analysis, update } = useWorkbench(),
    [filter, setFilter] = useState<"all" | MeasureDirection>("all"),
    [adding, setAdding] = useState<MeasureDirection>(),
    [editing, setEditing] = useState<string>();
  const patch = (id: string, change: Partial<Measure>) =>
    update((d) => Object.assign(d.measures.find((m) => m.id === id)!, change));
  // 默认库中当前任务缺少、且作用对象仍存在的条目。
  const modeIds = new Set(model.modes.map((m) => m.id)),
    missing = defaultMeasures()
      .filter((m) => !model.measures.some((own) => own.id === m.id))
      .map((m) => ({
        ...m,
        enabled: false,
        modeIds: m.modeIds.filter((id) => modeIds.has(id)),
      }))
      .filter(
        (m) =>
          m.modeIds.length > 0 ||
          m.effects.every((e) => e.param === "overhead"),
      );
  const rows = model.measures.filter(
      (m) => filter === "all" || m.direction === filter,
    ),
    gainOf = (id: string) =>
      analysis.contributions.items.find((c) => c.id === id),
    editingMeasure = model.measures.find((m) => m.id === editing);

  return (
    <section className="rw-card" aria-label="可靠性措施库">
      <div className="rw-card-head">
        <h2>可靠性措施库</h2>
        <div className="rw-library-actions">
          {missing.length > 0 && (
            <button
              className="rw-button"
              onClick={() => update((d) => void d.measures.push(...missing))}
            >
              <RotateCcw size={15} aria-hidden />
              补回默认库中缺少的 {missing.length} 项
            </button>
          )}
          <button className="rw-button" onClick={() => setAdding("mtbf")}>
            <Plus size={15} aria-hidden />
            添加提升 MTBF 的措施
          </button>
          <button className="rw-button" onClick={() => setAdding("mttr")}>
            <Plus size={15} aria-hidden />
            添加降低 MTTR 的措施
          </button>
        </div>
      </div>
      <p className="rw-hint">
        每一行是一项措施：它作用于哪些故障模式、把哪个参数改成多少、对其中多大比例的故障有效。启用与否也可以在第
        3 步切换。
      </p>
      <div className="rw-tabs" role="tablist" aria-label="按方向筛选">
        {(
          [
            ["all", "全部"],
            ["mtbf", "提升 MTBF"],
            ["mttr", "降低 MTTR"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? "is-active" : ""}
            onClick={() => setFilter(id)}
          >
            {name}{" "}
            {
              model.measures.filter((m) => id === "all" || m.direction === id)
                .length
            }
          </button>
        ))}
      </div>
      <div className="rw-table-wrap">
        <table className="rw-table is-edit">
          <thead>
            <tr>
              <th>启用</th>
              <th>措施</th>
              <th>方向</th>
              <th>作用于</th>
              <th>参数变化</th>
              <th className="is-num">适用比例</th>
              <th className="is-num">提升</th>
              <th>证据</th>
              <th>出处</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((measure) => {
              const gain = gainOf(measure.id);
              return (
                <tr key={measure.id}>
                  <td>
                    <Toggle
                      label={
                        (measure.enabled ? "停用 " : "启用 ") + measure.name
                      }
                      checked={measure.enabled}
                      onChange={(enabled) => patch(measure.id, { enabled })}
                    />
                  </td>
                  <td>
                    <TextField
                      className="is-name"
                      label={measure.name + " 的名称"}
                      value={measure.name}
                      fallback="未命名措施"
                      onCommit={(name) => patch(measure.id, { name })}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={measure.name + " 的方向"}
                      value={measure.direction}
                      onChange={(e) =>
                        patch(measure.id, {
                          direction: e.target.value as MeasureDirection,
                        })
                      }
                    >
                      <option value="mtbf">提升 MTBF</option>
                      <option value="mttr">降低 MTTR</option>
                    </select>
                  </td>
                  <td className="rw-cell-wrap">{targetText(model, measure)}</td>
                  <td className="rw-cell-wrap">
                    {measure.effects.map((effect, index) => (
                      <span key={index}>{effectText(effect)}</span>
                    ))}
                  </td>
                  <td>
                    <NumberField
                      label={measure.name + " 的适用比例（%）"}
                      value={measure.applicability}
                      factor={100}
                      min={0}
                      max={1}
                      digits={1}
                      suffix="%"
                      width={88}
                      onCommit={(applicability) =>
                        patch(measure.id, { applicability })
                      }
                    />
                  </td>
                  <td className="is-num">
                    {gain
                      ? points(measure.enabled ? gain.shapley : gain.marginal)
                      : "—"}
                  </td>
                  <td>
                    <select
                      aria-label={measure.name + " 的证据状态"}
                      value={measure.evidence}
                      onChange={(e) =>
                        patch(measure.id, {
                          evidence: e.target.value as EvidenceState,
                        })
                      }
                    >
                      {evidenceStates.map((state) => (
                        <option key={state} value={state}>
                          {evidenceStateNames[state]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="rw-cell-wrap rw-muted">{measure.source}</td>
                  <td>
                    <span className="rw-row-actions">
                      <button
                        className="rw-icon-button"
                        aria-label={"编辑措施 " + measure.name}
                        title="编辑作用范围、参数与依据"
                        onClick={() => setEditing(measure.id)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="rw-icon-button"
                        aria-label={"删除措施 " + measure.name}
                        title="删除"
                        onClick={() => {
                          if (window.confirm(`删除措施“${measure.name}”？`))
                            update((d) => {
                              d.measures = d.measures.filter(
                                (m) => m.id !== measure.id,
                              );
                            });
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rw-hint">
        “提升”一列：已启用的措施为 Shapley
        贡献，未启用的为启用后还能再提升多少。参数变化和作用范围点右侧的编辑按钮修改。
      </p>
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
    </section>
  );
}

function ModuleLibrary() {
  const { model, analysis, update } = useWorkbench();
  const patch = (id: string, change: Partial<(typeof model.modules)[number]>) =>
    update((d) => Object.assign(d.modules.find((m) => m.id === id)!, change));
  return (
    <>
      <section className="rw-card" aria-label="分组">
        <div className="rw-card-head">
          <h2>分组</h2>
          <button
            className="rw-button"
            disabled={model.groups.length >= 24}
            onClick={() =>
              update(
                (d) =>
                  void d.groups.push({
                    id: newId("group"),
                    name: "新分组",
                  }),
              )
            }
          >
            <Plus size={15} aria-hidden />
            添加分组
          </button>
        </div>
        <p className="rw-hint">
          分组用于在表格里归类模块，例如计算、网络、存储。
        </p>
        <div className="rw-group-editor">
          {model.groups.map((group) => {
            const used = model.modules.some((m) => m.groupId === group.id);
            return (
              <div key={group.id}>
                <TextField
                  label={group.name + " 的名称"}
                  value={group.name}
                  fallback="未命名分组"
                  onCommit={(name) =>
                    update((d) => {
                      d.groups.find((g) => g.id === group.id)!.name = name;
                    })
                  }
                />
                <button
                  className="rw-icon-button"
                  aria-label={"删除分组 " + group.name}
                  title={used ? "分组内还有模块，不能删除" : "删除分组"}
                  disabled={used || model.groups.length <= 1}
                  onClick={() =>
                    update((d) => {
                      d.groups = d.groups.filter((g) => g.id !== group.id);
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
      <section className="rw-card" aria-label="架构模块">
        <div className="rw-card-head">
          <h2>架构模块</h2>
          <button
            className="rw-button"
            onClick={() =>
              update((d) => void d.modules.push(blankModule(d.groups[0].id)))
            }
          >
            <Plus size={15} aria-hidden />
            添加模块
          </button>
        </div>
        <p className="rw-hint">
          模块是分配目标和统计损失的单位。架构图按超节点的硬件拓扑绘制，每个模块标注在所选的硬件位置上；选“不画在图上”的模块列在图的下方。
        </p>
        <div className="rw-table-wrap">
          <table className="rw-table is-edit">
            <thead>
              <tr>
                <th>分组</th>
                <th>模块</th>
                <th>架构图上的位置</th>
                <th className="is-num">每卡数量</th>
                <th className="is-num">重要度 ω</th>
                <th className="is-num">故障模式</th>
                <th className="is-num">FIT / 卡</th>
                <th>说明</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.modules.map((module) => {
                const result = analysis.baseline.modules.find(
                  (m) => m.id === module.id,
                );
                return (
                  <tr key={module.id}>
                    <td>
                      <select
                        aria-label={module.name + " 的分组"}
                        value={module.groupId}
                        onChange={(e) =>
                          patch(module.id, { groupId: e.target.value })
                        }
                      >
                        {model.groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <TextField
                        className="is-name"
                        label={module.name + " 的名称"}
                        value={module.name}
                        fallback="未命名模块"
                        onCommit={(name) => patch(module.id, { name })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={module.name + " 在架构图上的位置"}
                        value={
                          (diagramSlots as readonly string[]).includes(
                            module.anchor,
                          )
                            ? module.anchor
                            : ""
                        }
                        onChange={(e) =>
                          patch(module.id, { anchor: e.target.value })
                        }
                      >
                        <option value="">不画在图上</option>
                        {diagramSlots.map((slot) => (
                          <option key={slot} value={slot}>
                            {diagramSlotNames[slot]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <NumberField
                        label={module.name + " 的每卡数量"}
                        value={module.unitsPerCard}
                        min={0.0001}
                        max={100000}
                        digits={4}
                        width={88}
                        onCommit={(unitsPerCard) =>
                          patch(module.id, { unitsPerCard })
                        }
                      />
                    </td>
                    <td>
                      <NumberField
                        label={module.name + " 的重要度"}
                        value={module.importance}
                        min={0.01}
                        max={1}
                        digits={2}
                        width={72}
                        onCommit={(importance) =>
                          patch(module.id, { importance })
                        }
                      />
                    </td>
                    <td className="is-num">{result?.modes.length ?? 0}</td>
                    <td className="is-num">
                      {(result?.fitPerCard ?? 0).toFixed(0)}
                    </td>
                    <td>
                      <TextField
                        className="is-wide"
                        label={module.name + " 的说明"}
                        value={module.note}
                        maxLength={600}
                        onCommit={(note) => patch(module.id, { note })}
                      />
                    </td>
                    <td>
                      <button
                        className="rw-icon-button"
                        aria-label={"删除模块 " + module.name}
                        title="删除模块及其故障模式"
                        disabled={model.modules.length <= 1}
                        onClick={() => {
                          if (
                            window.confirm(
                              `删除模块“${module.name}”及其故障模式？引用它们的措施会同步清理。`,
                            )
                          )
                            update((d) => void dropModule(d, module.id));
                        }}
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
      </section>
    </>
  );
}

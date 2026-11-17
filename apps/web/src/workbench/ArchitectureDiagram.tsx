import { useState, type ReactNode } from "react";
import type { ModuleGap } from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { duration, fit, hours, percent, scale, times } from "./format";
import { Meter, Status, type Tone } from "./ui";

export type DiagramView = "target" | "baseline" | "design";
const viewNames: Record<DiagramView, string> = {
  target: "目标",
  baseline: "现状",
  design: "设计后",
};
const toneOf = (usage: number): Tone =>
  usage <= 1 ? "good" : usage <= 1.2 ? "warn" : "bad";
const usageLabel = (usage: number) =>
  usage <= 1 ? "占用预算 " + percent(usage, 0) : "超预算 " + times(usage);

interface Metrics {
  availability: number;
  targetAvailability: number;
  fitPerCard: number;
  mtbfHours: number;
  mttrHours: number;
  lossHours: number;
  budgetHours: number;
  usage: number;
}

/** 一个部件的指标块：现状（或设计后）与目标可用度、FIT、损失时间与预算。 */
function Figures({
  view,
  metrics,
  compact,
}: {
  view: DiagramView;
  metrics: Metrics;
  compact?: boolean;
}) {
  if (view === "target")
    return (
      <>
        <strong className="rw-am-value">
          {percent(metrics.targetAvailability)}
        </strong>
        <dl className="rw-am-facts">
          <div>
            <dt>损失预算</dt>
            <dd>{hours(metrics.budgetHours)}</dd>
          </div>
          {!compact && (
            <div>
              <dt>现状</dt>
              <dd>{percent(metrics.availability)}</dd>
            </div>
          )}
        </dl>
      </>
    );
  return (
    <>
      <div className="rw-am-pair">
        <strong className="rw-am-value">{percent(metrics.availability)}</strong>
        <span>
          目标 <b>{percent(metrics.targetAvailability)}</b>
        </span>
      </div>
      <dl className="rw-am-facts">
        <div>
          <dt>FIT / 卡</dt>
          <dd>{fit(metrics.fitPerCard)}</dd>
        </div>
        {!compact && (
          <div>
            <dt>MTBF</dt>
            <dd>{duration(metrics.mtbfHours)}</dd>
          </div>
        )}
        <div>
          <dt>损失 / 预算</dt>
          <dd>
            {hours(metrics.lossHours)}
            <small> / {hours(metrics.budgetHours)}</small>
          </dd>
        </div>
      </dl>
    </>
  );
}

/**
 * 架构图：分组 → 上级部件 → 模块的嵌套框，网络等路径型分组按顺序串联。
 * 每个框上标出可用度（现状或设计后）与目标、每卡 FIT、损失时间与预算。
 */
export default function ArchitectureDiagram({
  views,
  title,
  hint,
  onSelect,
  footer,
}: {
  /** 可切换的视图；第一个为默认。 */
  views: DiagramView[];
  title: string;
  hint?: string;
  onSelect?: (moduleId: string) => void;
  footer?: (groupId: string) => ReactNode;
}) {
  const { model, analysis } = useWorkbench(),
    [view, setView] = useState<DiagramView>(views[0]);
  const active = views.includes(view) ? view : views[0],
    assessed = active === "design" ? analysis.design : analysis.baseline,
    gapList: ModuleGap[] =
      active === "design" ? analysis.designGaps : analysis.baselineGaps,
    { allocation } = analysis;
  const metricsOf = (ids: string[]): Metrics => {
    const parts = assessed.modules.filter((m) => ids.includes(m.id)),
      budgets = allocation.modules.filter((m) => ids.includes(m.id)),
      load = parts.reduce((sum, m) => sum + m.load, 0),
      rate = parts.reduce((sum, m) => sum + m.rate, 0),
      targetLoad = budgets.reduce((sum, m) => sum + m.load, 0);
    return {
      availability: 1 / (1 + load),
      targetAvailability: 1 / (1 + targetLoad),
      fitPerCard: parts.reduce((sum, m) => sum + m.fitPerCard, 0),
      mtbfHours: rate > 0 ? 1 / rate : Infinity,
      mttrHours: rate > 0 ? load / rate : 0,
      lossHours: parts.reduce((sum, m) => sum + m.lossHours, 0),
      budgetHours: budgets.reduce((sum, m) => sum + m.lossHours, 0),
      usage: targetLoad > 0 ? load / targetLoad : load > 0 ? Infinity : 0,
    };
  };
  const system = assessed.system,
    target = model.scenario.target;

  const moduleBox = (id: string) => {
    const module = model.modules.find((m) => m.id === id)!,
      metrics = metricsOf([id]),
      gap = gapList.find((g) => g.id === id)!,
      tone = active === "target" ? "idle" : toneOf(gap.usage),
      label =
        active === "target"
          ? `${module.name}，目标可用度 ${percent(metrics.targetAvailability)}，损失预算 ${hours(metrics.budgetHours)}`
          : `${module.name}，${viewNames[active]}可用度 ${percent(metrics.availability)}，目标 ${percent(metrics.targetAvailability)}，${usageLabel(gap.usage)}`;
    const body = (
      <>
        <span className="rw-am-name">
          {module.name}
          {module.unitsPerCard !== 1 && (
            <small>× {module.unitsPerCard} / 卡</small>
          )}
        </span>
        <Figures view={active} metrics={metrics} />
        {active !== "target" && (
          <>
            <Meter
              ratio={gap.usage}
              tone={tone}
              label={usageLabel(gap.usage)}
            />
            <Status tone={tone}>{usageLabel(gap.usage)}</Status>
          </>
        )}
      </>
    );
    return onSelect ? (
      <button
        key={id}
        className={"rw-am-module is-" + tone}
        aria-label={label}
        onClick={() => onSelect(id)}
      >
        {body}
      </button>
    ) : (
      <div
        key={id}
        className={"rw-am-module is-" + tone}
        role="group"
        aria-label={label}
      >
        {body}
      </div>
    );
  };

  return (
    <section className="rw-card rw-archmap" aria-label={title}>
      <div className="rw-card-head">
        <h2>{title}</h2>
        <div className="rw-am-tools">
          {active !== "target" && (
            <span className="rw-legend">
              <Status tone="good">预算内</Status>
              <Status tone="warn">略超</Status>
              <Status tone="bad">超预算</Status>
            </span>
          )}
          {views.length > 1 && (
            <div className="rw-tabs" role="tablist" aria-label="架构图显示">
              {views.map((item) => (
                <button
                  key={item}
                  role="tab"
                  aria-selected={item === active}
                  className={item === active ? "is-active" : ""}
                  onClick={() => setView(item)}
                >
                  {viewNames[item]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {hint && <p className="rw-hint">{hint}</p>}
      <div className="rw-am-system">
        <header>
          <div>
            <strong>训练集群 · {scale(model.scenario.cards)}</strong>
            <span>各分组串联：任何一个模块出故障都会打断任务</span>
          </div>
          <dl className="rw-am-facts is-row">
            <div>
              <dt>{active === "target" ? "现状" : viewNames[active]}可用度</dt>
              <dd>{percent(system.availability)}</dd>
            </div>
            <div>
              <dt>目标</dt>
              <dd>{percent(target)}</dd>
            </div>
            <div>
              <dt>FIT / 卡</dt>
              <dd>{fit(system.fitPerCard)}</dd>
            </div>
            <div>
              <dt>损失 / 预算</dt>
              <dd>
                {hours(system.lossHours)}
                <small> / {hours(allocation.lossHours)}</small>
              </dd>
            </div>
          </dl>
        </header>
        <div className="rw-am-groups">
          {model.groups.map((group) => {
            const members = model.modules.filter((m) => m.groupId === group.id),
              containers = [
                ...new Set(members.map((m) => m.container).filter(Boolean)),
              ],
              metrics = metricsOf(members.map((m) => m.id)),
              wide = containers.length > 0 || members.length > 3;
            return (
              <section
                key={group.id}
                className={
                  "rw-am-group is-" + group.layout + (wide ? " is-wide" : "")
                }
                aria-label={group.name + "分组"}
              >
                <header>
                  <strong>{group.name}</strong>
                  {members.length > 0 && (
                    <span>
                      {active === "target"
                        ? `${percent(metrics.targetAvailability)} · ${hours(metrics.budgetHours)}`
                        : `${percent(metrics.availability)} → ${percent(metrics.targetAvailability)} · ${hours(metrics.lossHours)}`}
                    </span>
                  )}
                </header>
                <div className="rw-am-body">
                  {containers.map((name) => {
                    const inner = members.filter((m) => m.container === name);
                    return (
                      <div key={name} className="rw-am-container">
                        <header>
                          <strong>{name}</strong>
                          <Figures
                            view={active}
                            metrics={metricsOf(inner.map((m) => m.id))}
                            compact
                          />
                        </header>
                        <div className="rw-am-body">
                          {inner.map((m) => moduleBox(m.id))}
                        </div>
                      </div>
                    );
                  })}
                  {members
                    .filter((m) => !m.container)
                    .map((m) => moduleBox(m.id))}
                </div>
                {footer?.(group.id)}
              </section>
            );
          })}
        </div>
        <div className="rw-am-overhead">
          <strong>公共开销</strong>
          <span>
            与故障无关的固定损耗（保存检查点、在线检测等），占运行时间{" "}
            {percent(system.overhead)}
          </span>
          <b>
            {hours(system.overheadLossHours)}
            <small> / 预算 {hours(allocation.overheadLossHours)}</small>
          </b>
        </div>
      </div>
    </section>
  );
}

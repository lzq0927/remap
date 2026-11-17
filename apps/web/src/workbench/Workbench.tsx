import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Database,
  FileDown,
  MoreHorizontal,
  ShieldCheck,
  Target,
  Wrench,
} from "lucide-react";
import { api } from "../api";
import {
  allocationMethodInfo,
  analyze,
  type Analysis,
  type CoreModel,
  type VerificationResult,
} from "../../../../packages/core/src/index";
import type { Task } from "./Home";
import { percent, points, saveFile } from "./format";
import { NumberField, Status, type Tone } from "./ui";
import StepAllocate from "./StepAllocate";
import StepAssess from "./StepAssess";
import StepDesign from "./StepDesign";
import StepVerify from "./StepVerify";
import Library from "./Library";
import { downloadReport } from "./report";

export type SavedVerification = VerificationResult & {
  id: string;
  sequence: number;
};
interface WorkbenchValue {
  model: CoreModel;
  analysis: Analysis;
  /** 在草稿上修改模型；修改后自动重算并保存。 */
  update: (mutate: (draft: CoreModel) => void) => void;
  verification: SavedVerification | null;
  /** 验证结果对应的参数已被修改。 */
  stale: boolean;
  verifying: boolean;
  runVerification: (options: {
    trials: number;
    seed?: number;
  }) => Promise<void>;
  goto: (step: number) => void;
}
const WorkbenchContext = createContext<WorkbenchValue | null>(null);
export function useWorkbench() {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("工作台尚未加载");
  return value;
}

const steps = [
  { id: "allocate", name: "目标分配", icon: Target },
  { id: "assess", name: "可用度评估", icon: Activity },
  { id: "design", name: "机制设计", icon: Wrench },
  { id: "verify", name: "机制验证", icon: ShieldCheck },
] as const;
const purposes = [
  "把系统可用度目标分到每个模块，得到各模块的损失预算。",
  "按现有架构、故障模式和恢复能力算出现状，找出超预算的模块。",
  "选择并调整可靠性措施，把差距补上。",
  "用独立的仿真方法检验所选设计，给出能否达标的结论。",
];

export default function Workbench({
  task,
  onHome,
  onRename,
}: {
  task: Task;
  onHome: () => void;
  onRename: (name: string) => void;
}) {
  const prefix = "/tasks/" + encodeURIComponent(task.id);
  const [model, setModel] = useState<CoreModel>(),
    [verification, setVerification] = useState<SavedVerification | null>(null),
    [error, setError] = useState(""),
    [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved"),
    [verifying, setVerifying] = useState(false),
    [menu, setMenu] = useState(false),
    [library, setLibrary] = useState(false),
    [step, setStep] = useState(() => {
      const saved = Number(sessionStorage.getItem("remap.step." + task.id));
      return Number.isInteger(saved) && saved >= 0 && saved < 4 ? saved : 0;
    });
  const latest = useRef<CoreModel | null>(null),
    pending = useRef<CoreModel | null>(null),
    timer = useRef<number | undefined>(undefined),
    saving = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void api(prefix + "/core")
      .then((state) => {
        latest.current = state.model;
        setModel(state.model);
        setVerification(state.verification);
      })
      .catch((e) => setError((e as Error).message));
  }, [prefix]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return saving.current;
    pending.current = null;
    setSaveState("saving");
    saving.current = saving.current
      .then(() => api(prefix + "/core", { model: next }, "PUT"))
      .then(() => {
        if (!pending.current) setSaveState("saved");
      })
      .catch((e) => {
        setSaveState("error");
        setError("保存失败：" + (e as Error).message);
      });
    return saving.current;
  }, [prefix]);
  useEffect(() => () => void flush(), [flush]);

  const update = useCallback(
    (mutate: (draft: CoreModel) => void) => {
      if (!latest.current) return;
      const draft = structuredClone(latest.current);
      mutate(draft);
      latest.current = draft;
      pending.current = draft;
      setModel(draft);
      setError("");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 500);
    },
    [flush],
  );
  const goto = useCallback(
    (next: number) => {
      const bounded = Math.max(0, Math.min(3, next));
      setLibrary(false);
      setStep(bounded);
      sessionStorage.setItem("remap.step." + task.id, String(bounded));
      window.scrollTo({ top: 0 });
    },
    [task.id],
  );
  const analysis = useMemo(() => (model ? analyze(model) : null), [model]);
  const runVerification = useCallback(
    async (options: { trials: number; seed?: number }) => {
      setVerifying(true);
      setError("");
      try {
        await flush();
        setVerification(await api(prefix + "/core/verify", options));
      } catch (e) {
        setError("验证失败：" + (e as Error).message);
      } finally {
        setVerifying(false);
      }
    },
    [flush, prefix],
  );

  if (!model || !analysis)
    return (
      <p className={"rw-loading" + (error ? " is-bad" : "")} role="status">
        {error || "正在加载工作台…"}
      </p>
    );

  const target = model.scenario.target,
    current = analysis.baseline.system.availability,
    designed = analysis.design.system.availability,
    stale = !!verification && verification.modelHash !== analysis.hash,
    overBudget = analysis.baselineGaps.filter((g) => g.status !== "met").length,
    enabled = model.measures.filter((m) => m.enabled).length;
  const verifyTone: Tone =
    !verification || stale
      ? "idle"
      : verification.verdict === "pass"
        ? "good"
        : verification.verdict === "warn"
          ? "warn"
          : "bad";
  const summaries: { text: string; tone: Tone }[] = [
    {
      text: `${allocationMethodInfo[model.allocation.method].name} · ${model.modules.length} 个模块`,
      tone: analysis.allocation.feasible ? "good" : "bad",
    },
    {
      text:
        current >= target
          ? `现状 ${percent(current)} · 已达标`
          : `现状 ${percent(current)} · ${overBudget} 个模块超预算`,
      tone: current >= target ? "good" : "bad",
    },
    {
      text:
        designed >= target
          ? `${enabled} 项措施 · 设计达标`
          : `${enabled} 项措施 · 还差 ${((target - designed) * 100).toFixed(2)} pp`,
      tone: designed >= target ? "good" : "warn",
    },
    {
      text: !verification
        ? "尚未验证"
        : stale
          ? "参数已变，需重新验证"
          : verification.verdict === "pass"
            ? "验证通过"
            : verification.verdict === "warn"
              ? "通过，有待确认项"
              : "未通过",
      tone: verifyTone,
    },
  ];
  const value: WorkbenchValue = {
    model,
    analysis,
    update,
    verification,
    stale,
    verifying,
    runVerification,
    goto,
  };
  const StepView = [StepAllocate, StepAssess, StepDesign, StepVerify][step];
  // 轨道从现状与目标中较低者下方留出余量起算，便于看清三个位置。
  const floor = Math.max(0, Math.min(current, designed, target) - 0.08),
    position = (v: number) =>
      Math.max(0, Math.min(100, ((v - floor) / (1 - floor)) * 100));

  return (
    <WorkbenchContext.Provider value={value}>
      <div className="rw-app">
        <header className="rw-topbar">
          <button className="rw-brand" onClick={onHome} title="返回任务主页">
            <span className="rw-logo" aria-hidden>
              R
            </span>
            <span>ReMAP</span>
          </button>
          <ChevronRight size={16} className="rw-crumb" aria-hidden />
          <input
            className="rw-task-name"
            aria-label="任务名称"
            defaultValue={task.name}
            maxLength={120}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (!name) e.target.value = task.name;
              else if (name !== task.name)
                void api(prefix, { name }, "PATCH")
                  .then(() => onRename(name))
                  .catch((err) => setError((err as Error).message));
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <span className="rw-save" role="status">
            {saveState === "saving"
              ? "正在保存…"
              : saveState === "error"
                ? "保存失败"
                : "已保存"}
          </span>
          <button
            className={"rw-button" + (library ? " is-active" : "")}
            aria-pressed={library}
            onClick={() => {
              setLibrary(!library);
              window.scrollTo({ top: 0 });
            }}
          >
            <Database size={16} aria-hidden />
            基础库配置
          </button>
          <button
            className="rw-button"
            onClick={() =>
              downloadReport(
                task.name,
                model,
                analysis,
                stale ? null : verification,
              )
            }
          >
            <FileDown size={16} aria-hidden />
            导出报告
          </button>
          <div className="rw-menu">
            <button
              className="rw-icon-button"
              aria-label="更多操作"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={18} />
            </button>
            {menu && (
              <div
                className="rw-menu-list"
                role="menu"
                onClick={() => setMenu(false)}
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    saveFile(
                      task.name + "-模型.json",
                      JSON.stringify(model, null, 2),
                      "application/json",
                    );
                  }}
                >
                  导出模型参数（JSON）
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    if (
                      window.confirm(
                        "恢复默认场景会覆盖当前任务的全部参数，验证记录保留。确定继续？",
                      )
                    )
                      void flush()
                        .then(() => api(prefix + "/core/reset", {}))
                        .then((state) => {
                          latest.current = state.model;
                          setModel(state.model);
                        })
                        .catch((e) => setError((e as Error).message));
                  }}
                >
                  恢复默认场景
                </button>
                <button
                  role="menuitem"
                  onClick={() =>
                    void flush().then(() =>
                      location.assign(
                        location.pathname +
                          "?task=" +
                          encodeURIComponent(task.id) +
                          "&ui=classic",
                      ),
                    )
                  }
                >
                  打开专家模式（经典工作台）
                </button>
              </div>
            )}
          </div>
        </header>

        <section className="rw-summary" aria-label="场景与结论">
          <div className="rw-scenario">
            <label>
              <span>规模</span>
              <NumberField
                label="集群规模（卡）"
                value={model.scenario.cards}
                min={1}
                max={10000000}
                digits={0}
                suffix="卡"
                width={132}
                onCommit={(v) =>
                  update((d) => void (d.scenario.cards = Math.round(v)))
                }
              />
            </label>
            <label>
              <span>评估窗口</span>
              <NumberField
                label="评估窗口（小时）"
                value={model.scenario.hours}
                min={1}
                max={8760}
                digits={1}
                suffix="小时"
                width={112}
                onCommit={(v) => update((d) => void (d.scenario.hours = v))}
              />
            </label>
            <label>
              <span>可用度目标</span>
              <NumberField
                label="可用度目标（%）"
                value={model.scenario.target}
                factor={100}
                min={0.01}
                max={0.99999}
                digits={3}
                suffix="%"
                width={104}
                onCommit={(v) => update((d) => void (d.scenario.target = v))}
              />
            </label>
          </div>
          <div className="rw-kpis">
            <div className="rw-kpi">
              <span>现状</span>
              <strong>{percent(current)}</strong>
              <small className={current >= target ? "is-good" : "is-bad"}>
                {current >= target
                  ? "已达标"
                  : "距目标 " + points(current - target)}
              </small>
            </div>
            <ArrowRight size={18} className="rw-kpi-arrow" aria-hidden />
            <div className="rw-kpi is-lead">
              <span>设计后</span>
              <strong>{percent(designed)}</strong>
              <small className={designed >= target ? "is-good" : "is-bad"}>
                {designed >= target
                  ? "达标，余量 " + points(designed - target)
                  : "距目标 " + points(designed - target)}
              </small>
            </div>
            <div
              className="rw-track"
              role="img"
              aria-label={`现状 ${percent(current)}，设计后 ${percent(designed)}，目标 ${percent(target)}`}
            >
              <div className="rw-track-bar">
                <span
                  className="rw-track-gain"
                  style={{
                    left: position(Math.min(current, designed)) + "%",
                    width:
                      Math.abs(position(designed) - position(current)) + "%",
                  }}
                />
                <i
                  className="is-current"
                  style={{ left: position(current) + "%" }}
                />
                <i
                  className="is-design"
                  style={{ left: position(designed) + "%" }}
                />
                <i
                  className="is-target"
                  style={{ left: position(target) + "%" }}
                >
                  <b>目标 {percent(target)}</b>
                </i>
              </div>
              <div className="rw-track-scale">
                <span>{percent(floor, 0)}</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </section>

        <nav className="rw-steps" aria-label="四步工作流">
          {steps.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={
                  "rw-step" + (index === step && !library ? " is-active" : "")
                }
                aria-current={index === step && !library ? "step" : undefined}
                onClick={() => goto(index)}
              >
                <span className="rw-step-index">
                  <Icon size={16} aria-hidden />
                </span>
                <span className="rw-step-text">
                  <strong>
                    {index + 1}　{item.name}
                  </strong>
                  <Status tone={summaries[index].tone}>
                    {summaries[index].text}
                  </Status>
                </span>
              </button>
            );
          })}
        </nav>

        {error && (
          <p className="rw-alert is-bad" role="alert">
            {error}
          </p>
        )}

        {library ? (
          <main className="rw-main">
            <Library title={task.name} onBack={() => setLibrary(false)} />
          </main>
        ) : (
          <main className="rw-main">
            <header className="rw-step-head">
              <h1>
                第 {step + 1} 步　{steps[step].name}
              </h1>
              <p>{purposes[step]}</p>
            </header>
            <StepView />
            <footer className="rw-step-nav">
              {step > 0 ? (
                <button className="rw-button" onClick={() => goto(step - 1)}>
                  <ArrowLeft size={16} aria-hidden />
                  上一步：{steps[step - 1].name}
                </button>
              ) : (
                <span />
              )}
              {step < 3 && (
                <button
                  className="rw-button is-primary"
                  onClick={() => goto(step + 1)}
                >
                  下一步：{steps[step + 1].name}
                  <ArrowRight size={16} aria-hidden />
                </button>
              )}
            </footer>
          </main>
        )}
      </div>
    </WorkbenchContext.Provider>
  );
}

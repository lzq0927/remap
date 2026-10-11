import { useEffect, useState, useRef, useMemo } from "react";
import {
  Activity,
  Boxes,
  Database,
  FileInput,
  FlaskConical,
  History,
  Settings,
  Play,
  ArrowRight,
  PanelRightClose,
  ChevronRight,
  Plus,
  RefreshCw,
  Square,
} from "lucide-react";
import {
  api as globalApi,
  createTaskApi,
  TaskApiContext,
  useTaskApi,
  pretty,
} from "./api";
import TaskHome, { type Task } from "./TaskHome";
import TaskHeader from "./TaskHeader";
import WorkflowTimeline, { type WorkflowState } from "./WorkflowTimeline";
import OpenCodePanel from "./OpenCodePanel";
import Result from "./ResultView";
import {
  workflowSteps,
  fitLabels,
  editUnboundModel,
  allocationExample,
  budgetIsCurrent,
} from "./design-state";
import TargetBudget from "./TargetBudget";
import StaticDiagram from "./StaticDiagram";
import AllocationEditor from "./AllocationEditor";
import FeedbackPanel from "./FeedbackPanel";
import CatalogFields from "./CatalogFields";
const pct = (n: number | undefined) =>
  n === undefined ? "—" : (n * 100).toFixed(3) + "%";
const states: Record<string, string> = {
  queued: "排队",
  running: "运行中",
  succeeded: "完成",
  failed: "失败",
  cancelled: "已取消",
  draft: "草稿",
  validated: "校验通过",
  published: "已冻结（历史版本）",
  deprecated: "已弃用",
};
const kinds = [
  ["failure-mode", "故障模式库"],
  ["mechanism", "机制库"],
  ["parameter-evidence", "参数证据库"],
  ["scenario-template", "场景模板库"],
  ["validation-case", "验证案例库"],
  ["incident", "故障事件台账"],
];
const navigation = [
  ["workbench", "可靠性设计工作台", Activity],
  ["inputs", "输入与来源", FileInput],
  ["catalogs", "资产库", Database],
  ["tools", "方法与工具", Boxes],
  ["runs", "实验与报告", History],
  ["settings", "连接与配置", Settings],
] as const;
const toolNames: Record<string, string> = {
  training: "训练仿真",
  allocate: "指标分配",
  rbd: "可靠性框图",
  fta: "故障树",
  bdd: "共享事件 BDD",
  ctmc: "马尔科夫",
  compare: "方案比较",
  search: "目标达成搜索",
  sensitivity: "敏感性",
  attribute: "Shapley 收益",
  estimateRate: "事件频率估计",
};
const methodGuidance: Record<string, string> = {
  rbd: "适合表达串联、并联与冗余成功路径。先确认各基本事件的成功概率；同一事件必须使用同一 ID。",
  fta: "从业务失败顶事件追溯原因。输入基本事件发生概率，重复 ID 表示共享原因；本原型采用共享事件 BDD 精确求解。",
  bdd: "适合存在共享基本事件的布尔结构。不同事件独立的假设仍需验证，相关性不会因为使用 BDD 自动消失。",
  ctmc: "适合故障和恢复的连续时间状态过程。输入转移率矩阵、初始状态和奖励，要求恒定率与指数停留时间；非指数过程应使用仿真。",
  compare:
    "基线与候选使用相同随机样本进行配对比较。收益区间表示采样精度，不能替代参数证据；候选可回写并再次正式计算。",
  search:
    "在显式参数网格内寻找达到目标的候选。搜索受预算限制，未找到方案不等于工程不可行；候选使用独立随机种子复核。",
  sensitivity:
    "改变一个有明确单位的参数，查看交付指标及其差值，识别值得优先补证据或优化的参数。",
  attribute:
    "按全部干预组合计算 Shapley 贡献，解释机制之间的相互作用；贡献可为负，不等同于损失账本的占比。",
  estimateRate:
    "输入事件数、暴露时长与暴露口径。零次事件仍有上界；设备 FIT 不能直接替代软件调用或任务发生率。",
};
function JsonEditor({
  value,
  onChange,
  label = "结构化数据",
  readOnly = false,
}: {
  value: string;
  onChange: (x: string) => void;
  label?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="json-label">
      {label}
      <textarea
        className="json"
        spellCheck={false}
        readOnly={readOnly}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function ModelEditor({
  value,
  onApply,
}: {
  value: string;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState("");
  useEffect(() => setDraft(value), [value]);
  return (
    <>
      <JsonEditor
        value={draft}
        onChange={setDraft}
        label="专家 V4 参数（所有参数均进入求解器）"
      />
      <button
        onClick={() => {
          try {
            const data = JSON.parse(draft);
            if (!data || !Array.isArray(data.fits) || data.fits.length !== 4)
              throw new Error("fits 需要四个非负 FIT 值");
            onApply(pretty(data));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        应用模型参数
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}
function DataTable({ rows }: { rows: Record<string, any>[] }) {
  if (!rows.length) return <p className="empty">暂无数据</p>;
  const columns = Object.keys(rows[0]);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>
                  {typeof r[c] === "object"
                    ? JSON.stringify(r[c])
                    : String(r[c] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function App() {
  const [task, setTask] = useState<Task>();
  const [opening, setOpening] = useState(() =>
    new URLSearchParams(location.search).has("task"),
  );
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("task");
    if (!id) return;
    void globalApi("/tasks/" + encodeURIComponent(id))
      .then((selected: Task) => {
        if (selected.status === "archived")
          history.replaceState(null, "", location.pathname);
        else setTask(selected);
      })
      .catch(() => {
        history.replaceState(null, "", location.pathname);
      })
      .finally(() => setOpening(false));
  }, []);
  const open = (selected?: Task) => {
    history.replaceState(
      null,
      "",
      location.pathname +
        (selected ? "?task=" + encodeURIComponent(selected.id) : ""),
    );
    setTask(selected);
  };
  const binding = useMemo(
    () => (task ? createTaskApi(task.id) : null),
    [task?.id],
  );
  if (opening) return <p role="status">正在打开任务…</p>;
  if (!task || !binding) return <TaskHome onOpen={open} />;
  return (
    <TaskApiContext.Provider value={binding}>
      <Workbench key={task.id} task={task} onHome={() => open()} />
    </TaskApiContext.Provider>
  );
}
function Workbench({ task, onHome }: { task: Task; onHome: () => void }) {
  const { api, url } = useTaskApi();
  const [lastComplete, setLastComplete] = useState<any>();
  const [page, setPage] = useState("workbench"),
    [defaults, setDefaults] = useState<any>(),
    [request, setRequest] = useState<any>(),
    [modelJson, setModelJson] = useState(""),
    [runs, setRuns] = useState<any[]>([]),
    [run, setRun] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [chatBottom, setChatBottom] = useState(false),
    [scenario, setScenario] = useState("training");
  const [kind, setKind] = useState("failure-mode"),
    [assets, setAssets] = useState<any[]>([]),
    [examples, setExamples] = useState<any[]>([]),
    [publicAssets, setPublicAssets] = useState<any[]>([]),
    [search, setSearch] = useState(""),
    [asset, setAsset] = useState<any>(),
    [assetJson, setAssetJson] = useState("{}"),
    [assetName, setAssetName] = useState(""),
    [issues, setIssues] = useState<any[]>([]),
    [inputs, setInputs] = useState<any[]>([]),
    [input, setInput] = useState<any>(),
    [inputJson, setInputJson] = useState("{}");
  const [operation, setOperation] = useState("allocate"),
    [toolJson, setToolJson] = useState(
      pretty({
        method: "equal",
        target: 0.99,
        hours: 720,
        items: [
          { id: "compute", name: "计算", baselineRate: 0.00001 },
          { id: "network", name: "网络", baselineRate: 0.00002 },
          { id: "storage", name: "存储", baselineRate: 0.00001 },
        ],
      }),
    ),
    [settings, setSettings] = useState<any>(),
    [session, setSession] = useState(""),
    [notice, setNotice] = useState("");
  const attempt = async (fn: () => Promise<any>) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };
  const loadAssets = () =>
    api(
      "/catalogs?kind=" + kind + "&search=" + encodeURIComponent(search),
    ).then(setAssets);
  const [stage, setStage] = useState(0),
    [hydrated, setHydrated] = useState(false),
    [savedAt, setSavedAt] = useState(""),
    [mapping, setMapping] = useState<any>(),
    [revisions, setRevisions] = useState<any[]>([]),
    [conditionAccepted, setConditionAccepted] = useState(false),
    [allocationRuns, setAllocationRuns] = useState<any[]>([]),
    [agentRunId, setAgentRunId] = useState("");
  const mappingRevision = useRef(0);
  const [workflow, setWorkflow] = useState<WorkflowState>();
  const workflowRef = useRef<WorkflowState | undefined>(undefined);
  workflowRef.current = workflow;
  const domainRun = useRef("");
  const designRevision = useRef(0);
  const saveQueue = useRef<Promise<any>>(Promise.resolve());
  const snapshot = useRef<any>(undefined);
  snapshot.current = request
    ? {
        request: { ...request, model: JSON.parse(modelJson || "{}") },
        scenario,
        stage,
        session,
        runId: run?.id,
      }
    : undefined;
  const flushDesign = () => {
    const content = snapshot.current;
    const pending = saveQueue.current
      .catch(() => {})
      .then(async () => {
        const saved = await api("/design", {
          ...content,
          expectedRevision: designRevision.current,
        });
        designRevision.current = saved.revision;
        setSavedAt(saved.savedAt);
        const state = await api("/workflow");
        workflowRef.current = state;
        setWorkflow((old) =>
          !old || state.revision >= old.revision ? state : old,
        );
        return saved;
      });
    saveQueue.current = pending;
    return pending;
  };
  useEffect(() => {
    let stopped = false,
      sequence = 0;
    const receive = (state: WorkflowState, focus = false) => {
      if (stopped || state.taskId !== task.id) return;
      const latest = workflowRef.current;
      if (
        latest &&
        (state.revision < latest.revision ||
          (state.revision === latest.revision && latest.stale && !state.stale))
      )
        return;
      workflowRef.current = state;
      setWorkflow((old) =>
        !old ||
        state.revision > old.revision ||
        (state.revision === old.revision && state.stale)
          ? state
          : old,
      );
      if (focus) {
        const index = state.steps.findIndex((s) =>
          ["running", "awaiting-review", "failed"].includes(s.status),
        );
        if (index >= 0) setStage(index);
      }
      if (state.runId) {
        setAgentRunId(state.runId);
        if (focus) {
          domainRun.current = state.runId;
          const id = state.runId;
          void api("/runs/" + id)
            .then((value) => {
              if (
                !stopped &&
                domainRun.current === id &&
                workflowRef.current?.executionId === state.executionId
              ) {
                setRun(value);
                setNotice("当前任务流程已更新，请核对阶段资产与关联评估。");
              }
            })
            .catch((e) => !stopped && setError(e.message));
        }
      }
    };
    void api("/workflow")
      .then((state) => receive(state))
      .catch((e) => !stopped && setError(e.message));
    const stream = new EventSource(url("/workflow/events"));
    stream.onmessage = (event) => {
      try {
        const item = JSON.parse(event.data);
        if (item.sequence <= sequence) return;
        sequence = item.sequence;
        if (item.state) receive(item.state, true);
      } catch {
        /* incomplete event is ignored */
      }
    };
    return () => {
      stopped = true;
      stream.close();
    };
  }, []);
  useEffect(() => {
    if (!hydrated || !request) return;
    const timer = setTimeout(() => {
      void flushDesign().catch((e) => setError(e.message));
    }, 900);
    return () => clearTimeout(timer);
  }, [hydrated, request, modelJson, scenario, stage, session, run?.id]);
  useEffect(() => {
    if (run?.status === "succeeded") setLastComplete(run);
  }, [run?.id, run?.status]);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const [d, design, history, config, files] = await Promise.all([
        api("/defaults"),
        api("/design"),
        api("/runs"),
        api("/settings"),
        api("/inputs"),
      ]);
      if (disposed) return;
      setDefaults(d);
      const restored = design?.request ?? d.training;
      setRequest({ ...restored, factors: restored.factors ?? [] });
      setModelJson(pretty({ ...d.training.model, ...restored.model }));
      setRuns(history);
      setSettings(config);
      setInputs(files);
      designRevision.current = design?.revision ?? 0;
      if (design) {
        setScenario(design.scenario ?? "training");
        setStage(design.stage ?? 0);

        setSession(design.session ?? "");
        setSavedAt(design.savedAt);
        if (design.runId) {
          const restoredRun = await api("/runs/" + design.runId);
          if (disposed) return;
          setRun((current: any) => current ?? restoredRun);
        }
      }
      setHydrated(true);
    })().catch((e) => {
      if (!disposed) setError(e.message);
    });
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    attempt(loadAssets);
    void api("/examples/catalogs?kind=" + kind)
      .then(setExamples)
      .catch((e) => setError(e.message));
    void api("/public/catalogs?kind=" + kind)
      .then(setPublicAssets)
      .catch((e) => setError(e.message));
  }, [kind, search]);
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    let disposed = false;
    const refresh = () =>
      api("/runs/" + run.id)
        .then((updated) => {
          if (!disposed)
            setRun((current: any) =>
              current?.id === run.id ? updated : current,
            );
        })
        .catch(() => {});
    const stream = new EventSource(url(`/runs/${run.id}/events`));
    stream.onmessage = refresh;
    stream.onerror = () => {};
    const interval = setInterval(refresh, 2000);
    return () => {
      disposed = true;
      stream.close();
      clearInterval(interval);
    };
  }, [run?.id, run?.status]);
  useEffect(() => {
    if (!allocationRuns.some((r) => ["queued", "running"].includes(r.status)))
      return;
    let stopped = false;
    const refresh = async () => {
      try {
        const values = await Promise.all(
          allocationRuns.map((r) => api("/runs/" + r.id)),
        );
        if (!stopped) setAllocationRuns(values);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    const timer = setInterval(refresh, 800);
    void refresh();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [allocationRuns.map((r) => r.id + ":" + r.status).join(",")]);
  const changed =
    run &&
    run.operation === "training" &&
    run.input &&
    request &&
    pretty({
      ...run.input,
      assetSnapshot: undefined,
      sourceSnapshot: undefined,
    }) !== pretty({ ...request, model: JSON.parse(modelJson || "{}") });
  async function solve(op: string, data: any) {
    setBusy(true);
    await attempt(async () => {
      const saved = await flushDesign();
      const state = await api("/workflow");
      const ready =
        state.status === "active" &&
        !state.stale &&
        state.inputRevision === saved.revision &&
        state.steps.slice(0, 4).every((s: any) => s.status === "confirmed");
      const formal = ready && scenario === "training" && op === "training";
      const r = await api("/runs", {
        operation: op,
        input: data,
        inputRevision: saved.revision,
        ...(formal ? { executionId: state.executionId } : {}),
      });
      if (!formal)
        setNotice(
          "本次为独立评估；正式流程需先人工确认前四个阶段，再计算并审核。",
        );
      setRun(r);
      setRuns(await api("/runs"));
    });
    setBusy(false);
  }
  function patch(key: string, value: any) {
    setRequest({
      ...request,
      [key]: value,
    });
  }
  async function selectAsset(a: any) {
    await attempt(async () => {
      const d = await api(
        "/catalogs/" + a.id + (a.revision ? "?revision=" + a.revision : ""),
      );
      setAsset(d.asset);
      setAssetName(d.asset.name);
      setAssetJson(pretty(d.asset.payload));
      setIssues([]);
      setRevisions(d.revisions);
      setConditionAccepted(false);
    });
  }
  async function transition(state: string) {
    await attempt(async () => {
      const a = await api(`/catalogs/${asset.id}/${asset.revision}/state`, {
        state,
      });
      setAsset(a);
      await loadAssets();
    });
  }
  const currentDesign = () => ({ ...request, model: JSON.parse(modelJson) });
  function applyModel(value: string) {
    const m = JSON.parse(value);
    if (request.assetRefs?.length) {
      setNotice("模型参数已手动修改，已解除资产绑定，避免旧版本覆盖本次编辑。");
    }
    setRequest(editUnboundModel(request, m));
    setModelJson(pretty(m));
  }
  function applyCandidate(value: any) {
    setRequest({ ...value, factors: value.factors ?? [], assetRefs: [] });
    setModelJson(pretty({ ...defaults.training.model, ...value.model }));
    setPage("workbench");
    setStage(4);
    setNotice("候选已回代当前设计，尚未重新计算；请检查参数后执行评估。");
  }
  async function confirmStep() {
    if (
      !Number.isFinite(request.target) ||
      request.target < 0 ||
      request.target > 1 ||
      !Number.isSafeInteger(request.cards) ||
      request.cards < 1 ||
      !Number.isFinite(request.hours) ||
      request.hours <= 0
    )
      throw new Error("请先修正目标、卡数与窗口。");
    if (stage === 2 && scenario === "training" && !request.lossBudget)
      throw new Error("请先确认训练损失预算，或选择已明确指标的子模型方法。");
    if (
      stage === 2 &&
      scenario === "training" &&
      !budgetIsCurrent(request.lossBudget, request.target, request.hours)
    )
      throw new Error("目标或窗口已变更，请重新确认预算。");
    if (stage >= 4 && (run?.status !== "succeeded" || changed))
      throw new Error("请先完成一次评估，再审视结果并交付。");
    if (stage >= 4 && scenario === "training" && run.operation !== "training")
      throw new Error(
        "训练设计交付需要当前设计的训练仿真结果；子模型或方案权衡结果不能替代正式评估。",
      );
    const saved = await flushDesign();
    let state = await api("/workflow");
    if (!state.executionId || state.stale || state.status !== "active") {
      state = await api("/workflow/start", {
        inputRevision: saved.revision,
        mode: "manual",
      });
      setWorkflow(state);
    }
    const first = state.steps.findIndex((s: any) => s.status !== "confirmed");
    if (stage !== first) {
      setStage(first);
      throw new Error("请按顺序确认阶段；输入变更后需要从目标重新确认。");
    }
    if (stage >= 4 && state.runId !== run?.id) {
      throw new Error("请在当前流程确认前四个阶段后重新执行正式评估。");
    }
    const step = workflowSteps[stage];
    const next = await api("/workflow", {
      executionId: state.executionId,
      expectedRevision: state.revision,
      inputRevision: saved.revision,
      stepId: step.id,
      status: "confirmed",
      artifacts: [
        {
          type: stage >= 4 ? "evaluation" : "design",
          data:
            stage >= 4
              ? { runId: run.id, inputHash: run.inputHash }
              : currentDesign(),
        },
      ],
      notes: "用户确认当前阶段；产品模型与参数证据需独立验证。",
    });
    setWorkflow(next);
    setStage(Math.min(5, stage + 1));
    setNotice(step.name + "已确认并记录。");
  }
  function openAllocation() {
    setOperation("allocate");
    setToolJson(pretty(allocationExample(request.target, request.hours)));
    setPage("tools");
    setNotice(
      "已同步当前目标和窗口作为子模型设计输入；训练交付到子模型目标的映射仍需确认。",
    );
  }
  function prepareTool(id: string) {
    const base = currentDesign();
    setOperation(id);
    setPage("tools");
    if (id === "allocate") {
      openAllocation();
      return;
    }
    if (["rbd", "fta", "bdd"].includes(id))
      setToolJson(
        pretty({
          tree: {
            type: id === "rbd" ? "series" : "or",
            children: [
              {
                type: "event",
                id: "A",
                probability: id === "rbd" ? 0.99 : 0.01,
              },
              {
                type: "event",
                id: "B",
                probability: id === "rbd" ? 0.98 : 0.02,
              },
            ],
          },
        }),
      );
    if (id === "ctmc")
      setToolJson(
        pretty({
          Q: [
            [-0.01, 0.01],
            [1, -1],
          ],
          rewards: [1, 0],
          p0: [1, 0],
          times: [request.hours],
        }),
      );
    if (id === "compare")
      setToolJson(
        pretty({
          base: { ...base, factors: [] },
          variants: [
            { id: "current", name: "当前机制方案", factors: base.factors },
          ],
        }),
      );
    if (id === "search")
      setToolJson(
        pretty({
          base,
          designSpace: {
            intervalSeconds: [300, 1800, 3600],
            saveSeconds: [1, 4],
          },
          verificationTrials: Math.max(128, base.trials),
        }),
      );
    if (id === "sensitivity")
      setToolJson(
        pretty({
          base,
          parameter: "intervalSeconds",
          values: [300, 1800, 3600, 7200],
        }),
      );
    if (id === "attribute")
      setToolJson(
        pretty({
          base: { ...base, factors: [] },
          factors: base.factors.length
            ? base.factors
            : defaults.factors.slice(0, 3).map((f: any) => f.id),
        }),
      );
    if (id === "estimateRate")
      setToolJson(pretty({ events: 2, exposureHours: 1000000 }));
  }
  if (!defaults || !request)
    return (
      <div className="boot">
        <FlaskConical /> 正在加载可靠性设计工作台…
        {error && <p className="error">{error}</p>}
      </div>
    );
  return (
    <div className={"shell " + (chatBottom ? "bottom-chat" : "")}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol">R</span>
          <div>
            <strong title="Reliability Modeling and Analysis Platform">
              ReMAP
            </strong>
            <span>可靠性设计工作台</span>
          </div>
        </div>
        <div className="sidebar-caption">WORKSPACE / 001</div>
        <nav>
          {navigation.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                if (id === "runs")
                  attempt(async () => setRuns(await api("/runs")));
                if (id === "settings")
                  attempt(async () => setSettings(await api("/settings")));
              }}
            >
              <Icon size={18} />
              {label}
              {page === id && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <span>PRODUCT SCENARIOS</span>
          {defaults.scenarios.map((s: any) => (
            <button
              key={s.id}
              disabled={
                s.state === "planned" ||
                !["training", "traditional"].includes(s.id)
              }
              onClick={() => {
                setScenario(s.id);
                setPage("workbench");
              }}
              className={scenario === s.id ? "selected" : ""}
            >
              <i />
              {s.name}
              <small>{s.state === "planned" ? "待扩展" : "可评估"}</small>
            </button>
          ))}
        </div>
        <div className="sidebar-foot">
          <span className="dot" /> 本地工作区
          <span>Prototype 0.1 · 科学计算</span>
        </div>
      </aside>
      <main>
        <TaskHeader
          name={task.name}
          scenario={scenario}
          runId={run?.id}
          onHome={() => {
            void attempt(async () => {
              try {
                await flushDesign();
              } catch (e) {
                if ((e as any).code !== "TASK_ARCHIVED") throw e;
              }
              onHome();
            });
          }}
        />
        <header>
          <div>
            <span className="eyebrow">
              RELIABILITY ENGINEERING / DESIGN REVIEW
            </span>
            <h1>{navigation.find((n) => n[0] === page)?.[1]}</h1>
          </div>
          <div className="header-right">
            <span className="badge">
              {defaults.scenarios.find((s: any) => s.id === scenario)?.name}
            </span>
            <button
              className="icon-button"
              aria-label="切换对话框位置"
              onClick={() => setChatBottom(!chatBottom)}
            >
              <PanelRightClose size={20} />
            </button>
          </div>
        </header>
        <div className="design-save-status">
          {savedAt
            ? `草稿已保存 · ${new Date(savedAt).toLocaleTimeString()}`
            : "当前设计自动保存"}
          <button
            onClick={() =>
              document
                .querySelector(".official-agent")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            打开 OpenCode 面板
          </button>
        </div>
        {notice && (
          <div className="notice-banner" role="status">
            {notice}
            {agentRunId && (
              <button
                onClick={() =>
                  attempt(async () => {
                    setRun(await api("/runs/" + agentRunId));
                    setPage("workbench");
                    setStage(5);
                  })
                }
              >
                打开 Agent 关联评估
              </button>
            )}
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              关闭
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button
              onClick={() =>
                void attempt(async () => {
                  await saveQueue.current.catch(() => {});
                  const design = await api("/design");
                  if (!design) return;
                  designRevision.current = design.revision;
                  setRequest({
                    ...design.request,
                    factors: design.request.factors ?? [],
                  });
                  setModelJson(
                    pretty({
                      ...defaults.training.model,
                      ...design.request.model,
                    }),
                  );
                  setScenario(design.scenario ?? "training");
                  setSession(design.session ?? "");
                  setSavedAt(design.savedAt);
                  setWorkflow(await api("/workflow"));
                  setNotice("已加载任务保存的最新设计。");
                })
              }
            >
              加载最新任务设计
            </button>
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {page === "workbench" && (
          <>
            <WorkflowTimeline
              state={workflow}
              stage={stage}
              onSelect={(i) => {
                setStage(i);
                requestAnimationFrame(() =>
                  document
                    .getElementById(workflowSteps[i].anchor)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
              }}
              onCancel={() =>
                void attempt(async () =>
                  setWorkflow(
                    await api("/workflow/cancel", {
                      executionId: workflow?.executionId,
                    }),
                  ),
                )
              }
            />
            <section className="workflow-guide" aria-label="当前流程阶段">
              <div>
                <span>第 {stage + 1} / 6 步</span>
                <h2>{workflowSteps[stage].name}</h2>
                <p>{workflowSteps[stage].hint}</p>
              </div>
              <div>
                <button
                  disabled={stage === 0}
                  onClick={() => setStage(Math.max(0, stage - 1))}
                >
                  上一步
                </button>
                <button
                  className="primary"
                  onClick={() => attempt(confirmStep)}
                >
                  {stage === 5 ? "记录交付确认" : "确认并进入下一步"}
                </button>
              </div>
            </section>
            {scenario === "training" ? (
              <>
                <section className="hero">
                  <div>
                    <span className="eyebrow">TRAINING / CORRECT DELIVERY</span>
                    <h2>从整体目标，走向可验证的设计。</h2>
                    <p>
                      故障、检测、恢复与污染共同决定最终交付。
                      <br />
                      比较方案时，始终回代相同口径的模型。
                    </p>
                  </div>
                  <div className="hero-number">
                    <span>整体目标</span>
                    <strong>{pct(request.target)}</strong>
                    <small>
                      {request.cards.toLocaleString()} 卡 · {request.hours}{" "}
                      小时窗口
                    </small>
                  </div>
                </section>
                <section className="paper" id="design-target">
                  <div className="section-head">
                    <h2>评估任务</h2>
                    <span className="badge amber">示例参数 · 待校准</span>
                  </div>
                  <div className="fields">
                    {[
                      ["cards", "集群卡数"],
                      ["target", "正确交付目标（0–1）"],
                      ["hours", "观察窗口（小时）"],
                      ["trials", "仿真轨迹数"],
                      ["seed", "随机种子"],
                    ].map(([k, label]) => (
                      <label key={k}>
                        {label}
                        <input
                          aria-label={label}
                          type="number"
                          step={k === "target" ? ".001" : "1"}
                          value={request[k]}
                          onChange={(e) => patch(k, Number(e.target.value))}
                        />
                      </label>
                    ))}
                    <label>
                      产品代际
                      <input
                        value={request.generation ?? "参考代际"}
                        onChange={(e) => patch("generation", e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="presets">
                    <button
                      onClick={() => {
                        setRequest({ ...request, cards: 10000, target: 0.99 });
                      }}
                    >
                      万卡 · 99%
                    </button>
                    <button
                      onClick={() => {
                        setRequest({
                          ...request,
                          cards: 100000,
                          target: 0.943,
                        });
                      }}
                    >
                      十万卡 · 94.3%
                    </button>
                    <span>MTBF 单独记录；不能直接换算成正确交付比例。</span>
                  </div>
                  <p className="note">
                    {request.cards === 10000 && request.target === 0.99
                      ? "产品目标表：万卡 99%，MTBF 参考目标 31.5 小时。"
                      : request.cards === 100000 && request.target === 0.943
                        ? "产品目标表：十万卡 94.3%，MTBF 参考目标约 3 小时。"
                        : "当前使用自定义规模或目标，请确认产品级要求。"}{" "}
                    同规模不同方案与代际沿用相同目标；更改目标或窗口后需要重新确认预算。
                  </p>
                  <label>
                    理想产出 / 小时（可选，用于记录产出量）
                    <input
                      aria-label="理想产出每小时"
                      type="number"
                      min="0.01"
                      value={request.idealWorkPerHour ?? ""}
                      placeholder="留空时使用卡数作为归一化理想能力"
                      onChange={(e) => {
                        if (e.target.value)
                          patch("idealWorkPerHour", Number(e.target.value));
                        else {
                          const { idealWorkPerHour: _ideal, ...rest } = request;
                          setRequest(rest);
                        }
                      }}
                    />
                  </label>
                </section>
                <section className="paper" id="design-system">
                  <div className="section-head">
                    <h2>系统结构与故障域</h2>
                    <span className="eyebrow">PARAMETER-DRIVEN VIEW</span>
                  </div>
                  <div className="architecture">
                    <div>
                      训练任务<small>完整窗口交付</small>
                    </div>
                    <ArrowRight />
                    <div>
                      恢复域
                      <small>{JSON.parse(modelJson).recoveryDomains} 个</small>
                    </div>
                    <ArrowRight />
                    <div>
                      机架 / 服务器
                      <small>
                        {JSON.parse(modelJson).serversPerRack} 台 /{" "}
                        {JSON.parse(modelJson).cardsPerServer} 卡
                      </small>
                    </div>
                  </div>
                  <div className="hardware">
                    {fitLabels.map((label, i) => (
                      <label key={label}>
                        {label}
                        <input
                          aria-label={label + " FIT"}
                          type="number"
                          value={JSON.parse(modelJson).fits?.[i] ?? 0}
                          onChange={(e) => {
                            const m = JSON.parse(modelJson);
                            m.fits[i] = Number(e.target.value);
                            applyModel(pretty(m));
                          }}
                        />
                        <small>
                          FIT / 卡 ·{" "}
                          {i < 2 ? "硬、慢、静默故障" : "事件影响域可配置"}
                        </small>
                      </label>
                    ))}
                  </div>
                  <p className="note">
                    专家 V4 的四个 FIT 索引依次是
                    HBM、GPU、网络、其他。存储等独立组件需要明确字段映射或扩展模型，不能通过更改标签替代建模。
                  </p>
                  {request.assetRefs?.length > 0 && (
                    <div className="bound-assets">
                      <strong>
                        已绑定 {request.assetRefs.length} 个冻结资产版本
                      </strong>
                      <p>
                        手动修改模型参数会解除绑定，保留本次输入和历史来源，避免旧资产覆盖编辑。
                      </p>
                      <button
                        onClick={() => {
                          setRequest(
                            editUnboundModel(request, JSON.parse(modelJson)),
                          );
                          setNotice("已解除冻结资产绑定；当前参数值保留。");
                        }}
                      >
                        解除绑定，转为手动设计
                      </button>
                    </div>
                  )}
                  <h3>常用检测、恢复与拓扑参数</h3>
                  <div className="fields model-fields">
                    {[
                      ["hardDetect", "硬故障检测覆盖率（%）"],
                      ["slowDetect", "亚健康检测覆盖率（%）"],
                      ["silentDetect", "静默故障检测覆盖率（%）"],
                      ["hardSeconds", "硬故障检测与停顿（秒）"],
                      ["intervalSeconds", "检查点间隔（秒）"],
                      ["saveSeconds", "保存检查点（秒）"],
                      ["recoveryDomains", "恢复域数量"],
                      ["cardsPerServer", "每服务器卡数"],
                      ["serversPerRack", "每机架服务器数"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          aria-label={label}
                          type="number"
                          min="0"
                          max={key.endsWith("Detect") ? 100 : undefined}
                          step="any"
                          value={JSON.parse(modelJson)[key] ?? ""}
                          onChange={(e) =>
                            applyModel(
                              pretty({
                                ...JSON.parse(modelJson),
                                [key]: Number(e.target.value),
                              }),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <details>
                    <summary>
                      编辑完整模型参数 · 拓扑、恢复、检查点与覆盖率
                    </summary>
                    <ModelEditor value={modelJson} onApply={applyModel} />
                    <p className="note">
                      检测字段为百分数 0–100；FIT
                      为每十亿设备小时；恢复单位由字段 Seconds / Minutes / Hours
                      明确指定。
                    </p>
                  </details>
                </section>
                <div id="design-budget">
                  <TargetBudget
                    confirmedBudget={request.lossBudget}
                    saveBudget={(budget) => {
                      patch("lossBudget", budget);
                      setNotice(
                        "训练损失预算已保存，选择方法阶段仍待人工确认。",
                      );
                    }}
                    target={request.target}
                    hours={request.hours}
                    openMethods={openAllocation}
                  />
                </div>
                <section className="paper" id="design-mechanisms">
                  <h2>可靠性机制方案</h2>
                  <p className="note">
                    选择后应用机制的参数补丁。组合收益经完整仿真计算，不能将单项收益直接相加。
                  </p>
                  <div className="factors">
                    {defaults.factors.map((f: any) => (
                      <label
                        key={f.id}
                        className={
                          request.factors.includes(f.id) ? "checked" : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={request.factors.includes(f.id)}
                          onChange={(e) =>
                            patch(
                              "factors",
                              e.target.checked
                                ? [...request.factors, f.id]
                                : request.factors.filter(
                                    (id: string) => id !== f.id,
                                  ),
                            )
                          }
                        />
                        <span>
                          {f.name}
                          <small>
                            {Object.entries(f.patch)
                              .map(
                                ([key, value]) =>
                                  `${key}: ${JSON.parse(modelJson)[key] ?? "—"} → ${value}`,
                              )
                              .join("；")}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="actions" id="design-evaluate">
                    <button
                      className="primary"
                      disabled={
                        busy || ["running", "queued"].includes(run?.status)
                      }
                      onClick={() =>
                        attempt(() =>
                          solve("training", {
                            ...request,
                            model: JSON.parse(modelJson),
                          }),
                        )
                      }
                    >
                      <Play size={16} /> 开始评估
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => prepareTool("compare")}
                    >
                      比较基线与当前方案
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => prepareTool("attribute")}
                    >
                      分析机制收益
                    </button>
                    {["running", "queued"].includes(run?.status) && (
                      <button
                        onClick={() =>
                          attempt(async () =>
                            setRun(await api(`/runs/${run.id}/cancel`, {})),
                          )
                        }
                      >
                        <Square size={14} /> 取消计算
                      </button>
                    )}
                    <span>
                      {run?.status === "running"
                        ? `正在计算 · ${Math.round(run.progress * 100)}%`
                        : changed
                          ? "输入已改变；已有结果需重算"
                          : "固定种子 · 输入快照 · 结果可重放"}
                    </span>
                  </div>
                </section>
              </>
            ) : (
              <section className="paper">
                <h2>
                  {defaults.scenarios.find((s: any) => s.id === scenario)?.name}
                </h2>
                <p>
                  {scenario === "traditional"
                    ? "使用 RBD、FTA/BDD 和 CTMC 分析任务可靠度与稳态可用度。"
                    : "已保留场景扩展入口；本原型尚未验证该产品的指标模型。"}
                </p>
                <button
                  onClick={() =>
                    prepareTool(scenario === "traditional" ? "rbd" : "allocate")
                  }
                >
                  进入专业方法工具 <ArrowRight size={16} />
                </button>
              </section>
            )}
            <div id="design-result">
              <Result run={run} onApplyCandidate={applyCandidate} />
            </div>
            {run &&
              ["cancelled", "failed"].includes(run.status) &&
              lastComplete &&
              lastComplete.id !== run.id && (
                <>
                  <h3>上次完整结果</h3>
                  <Result run={lastComplete} />
                </>
              )}
          </>
        )}
        {page === "catalogs" && (
          <>
            <section
              className="paper example-library"
              aria-label="只读示例与公共资产库"
            >
              <h2>只读示例与公共资产</h2>
              <p className="note">
                资产保留来源与版本；复制到当前任务后核对适用条件。公共发布需独立审核，当前可提交提案。
              </p>
              {[
                ...examples.map((asset) => ({ asset, source: "example" })),
                ...publicAssets
                  .filter((asset) => asset.state === "published")
                  .map((asset) => ({ asset, source: "public" })),
              ].map(({ asset: a, source }) => (
                <details key={source + ":" + a.id}>
                  <summary>
                    {source === "example" ? "示例" : "公共"} · {a.name} · r
                    {a.revision}
                  </summary>
                  <pre>{pretty(a.payload)}</pre>
                  <button
                    onClick={() =>
                      void attempt(async () => {
                        const copied = await api("/catalogs/copy-public", {
                          source,
                          id: a.id,
                          revision: a.revision,
                          contentHash: a.contentHash,
                        });
                        await loadAssets();
                        await selectAsset(
                          Array.isArray(copied)
                            ? copied.find((item) => item.id === a.id)
                            : copied,
                        );
                        setNotice("资产已复制到当前任务，请核对适用条件。");
                      })
                    }
                  >
                    复制到当前任务
                  </button>
                </details>
              ))}
            </section>
            <div className="tabs">
              {kinds.map(([id, name]) => (
                <button
                  key={id}
                  className={kind === id ? "active" : ""}
                  onClick={() => {
                    setKind(id);
                    setAsset(undefined);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <section className="paper">
              <div className="section-head">
                <input
                  className="search"
                  placeholder="搜索名称或参数…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  onClick={() => {
                    setAsset({ kind, state: "new", payload: {} });
                    setRevisions([]);
                    setConditionAccepted(false);
                    setAssetName("");
                    setAssetJson("{}");
                  }}
                >
                  <Plus size={16} /> 新建资产
                </button>
                <a
                  className="button"
                  download={`${kind}.json`}
                  href={
                    "data:application/json;charset=utf-8," +
                    encodeURIComponent(pretty(assets))
                  }
                >
                  导出库
                </a>
              </div>
              <div className="asset-layout">
                <div className="asset-list">
                  {assets.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => selectAsset(a)}
                      className={asset?.id === a.id ? "selected" : ""}
                    >
                      <strong>{a.name}</strong>
                      <small>
                        r{a.revision} · {states[a.state]}
                      </small>
                    </button>
                  ))}
                  {!assets.length && (
                    <p className="empty">暂无资产，可创建或从输入文件导入。</p>
                  )}
                </div>
                {asset ? (
                  <div className="asset-detail">
                    <span className="eyebrow">
                      {asset.id ?? "NEW ASSET"} ·{" "}
                      {states[asset.state] ?? "新建"}
                    </span>
                    <label>
                      名称
                      <input
                        value={assetName}
                        disabled={!["draft", "new"].includes(asset.state)}
                        onChange={(e) => setAssetName(e.target.value)}
                      />
                    </label>
                    <CatalogFields
                      kind={kind}
                      value={assetJson}
                      onChange={setAssetJson}
                      readOnly={!["draft", "new"].includes(asset.state)}
                    />
                    <details>
                      <summary>完整参数 JSON · 高级编辑</summary>
                      <JsonEditor
                        value={assetJson}
                        onChange={setAssetJson}
                        label="参数、适用条件、证据与引用"
                        readOnly={!["draft", "new"].includes(asset.state)}
                      />
                    </details>
                    {["validated", "published"].includes(asset.state) && (
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={conditionAccepted}
                          onChange={(e) =>
                            setConditionAccepted(e.target.checked)
                          }
                        />
                        我已核对资产的发生率口径、适用条件及模型字段映射
                      </label>
                    )}
                    <div className="actions">
                      {["draft", "new"].includes(asset.state) && (
                        <button
                          className="primary"
                          onClick={() =>
                            attempt(async () => {
                              const a = await api(
                                asset.id
                                  ? `/catalogs/${asset.id}/${asset.revision}`
                                  : "/catalogs",
                                {
                                  kind,
                                  name: assetName,
                                  payload: JSON.parse(assetJson),
                                },
                                asset.id ? "PATCH" : "POST",
                              );
                              setAsset(a);
                              await loadAssets();
                            })
                          }
                        >
                          保存草稿
                        </button>
                      )}
                      {asset.id && (
                        <>
                          <button
                            onClick={() =>
                              attempt(async () =>
                                setIssues(
                                  (
                                    await api(
                                      `/catalogs/${asset.id}/${asset.revision}/validate`,
                                      {},
                                    )
                                  ).issues,
                                ),
                              )
                            }
                          >
                            校验
                          </button>
                          {asset.state === "draft" && (
                            <button onClick={() => transition("validated")}>
                              校验并冻结版本
                            </button>
                          )}

                          {["validated", "published"].includes(asset.state) && (
                            <button
                              disabled={!conditionAccepted}
                              onClick={() =>
                                attempt(async () => {
                                  const p = asset.payload;
                                  if (!p.patch && !p.modelBinding)
                                    throw new Error(
                                      "该资产还未定义 modelBinding 或 patch；请先在新版本中配置模型字段映射。",
                                    );
                                  setRequest({
                                    ...request,
                                    assetRefs: [
                                      ...(request.assetRefs ?? []).filter(
                                        (r: any) => r.id !== asset.id,
                                      ),
                                      {
                                        id: asset.id,
                                        revision: asset.revision,
                                        contentHash: asset.contentHash,
                                      },
                                    ],
                                    applicabilityConfirmed: true,
                                  });
                                  const m = JSON.parse(modelJson);
                                  if (p.patch) Object.assign(m, p.patch);
                                  if (p.modelBinding?.array === "fits")
                                    m.fits[p.modelBinding.index] = p.fit;
                                  if (p.modelBinding?.field)
                                    m[p.modelBinding.field] =
                                      p.modelBinding.value ?? p.value;
                                  setModelJson(pretty(m));
                                  setPage("workbench");
                                })
                              }
                            >
                              将已校验版本应用到训练
                            </button>
                          )}
                          {asset.state === "published" && (
                            <button onClick={() => transition("deprecated")}>
                              弃用
                            </button>
                          )}
                          {["validated", "published"].includes(asset.state) && (
                            <button
                              onClick={() =>
                                void attempt(async () => {
                                  await api(
                                    `/catalogs/${asset.id}/${asset.revision}/submit`,
                                    { contentHash: asset.contentHash },
                                  );
                                  setNotice("已提交公共库提案，等待独立审核。");
                                })
                              }
                            >
                              提交公共库提案
                            </button>
                          )}
                          <button
                            onClick={() =>
                              attempt(async () => {
                                const a = await api(
                                  `/catalogs/${asset.id}/${asset.revision}/fork`,
                                  {},
                                );
                                setAsset(a);
                                setRevisions(
                                  (await api(`/catalogs/${a.id}`)).revisions,
                                );
                                await loadAssets();
                              })
                            }
                          >
                            复制为新版本
                          </button>
                        </>
                      )}
                    </div>
                    {issues.length ? (
                      <DataTable rows={issues} />
                    ) : (
                      <p className="note">
                        冻结后不可修改；新版本不会改变历史评估快照。payload.refs
                        支持 id、revision、contentHash 固定引用。
                      </p>
                    )}
                    {revisions.length > 0 && (
                      <label>
                        查看资产版本
                        <select
                          aria-label="查看资产版本"
                          value={asset.revision}
                          onChange={(e) =>
                            selectAsset({
                              id: asset.id,
                              revision: Number(e.target.value),
                            })
                          }
                        >
                          {revisions.map((a) => (
                            <option key={a.revision} value={a.revision}>
                              r{a.revision} · {states[a.state]} · {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <details>
                      <summary>来源、适用条件与模型映射</summary>
                      <pre>
                        {pretty({
                          source: asset.payload.source,
                          evidenceStatus: asset.payload.evidenceStatus,
                          conditions: asset.payload.conditions,
                          modelBinding: asset.payload.modelBinding,
                          patch: asset.payload.patch,
                          refs: asset.payload.refs,
                        })}
                      </pre>
                    </details>
                  </div>
                ) : (
                  <div className="empty">选择资产，查看来源、参数和版本。</div>
                )}
              </div>
            </section>
          </>
        )}
        {page === "inputs" && (
          <section className="paper">
            <div className="section-head">
              <h2>文件解析与确认</h2>
              <label className="button">
                <FileInput size={16} /> 导入文件
                <input
                  hidden
                  type="file"
                  accept=".json,.csv,.xlsx,.md,.txt,.pdf,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    attempt(async () => {
                      const bytes = new Uint8Array(await f.arrayBuffer());
                      let binary = "";
                      for (const b of bytes) binary += String.fromCharCode(b);
                      const d = await api("/inputs", {
                        name: f.name,
                        base64: btoa(binary),
                      });
                      ++mappingRevision.current;
                      setInput(d);
                      setInputJson(pretty(d.data));
                      setMapping(undefined);
                      setInputs(await api("/inputs"));
                    });
                  }}
                />
              </label>
            </div>
            <p>
              JSON / CSV / XLSX
              直接结构化读取；文本、架构图由配置的模型提取后确认。来源、内容摘要和每次确认都会保存。
            </p>
            <div className="template-links">
              <span>下载模板：</span>
              <a href="/api/templates/training-input.json">训练参数 JSON</a>
              <a href="/api/templates/catalog-import.json">资产库 JSON</a>
              <a href="/api/templates/fault-modes.csv">
                故障模式 CSV / XLSX 列格式
              </a>
            </div>
            <div className="asset-layout">
              <div className="asset-list">
                {inputs.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => {
                      const revision = ++mappingRevision.current;
                      setInput(i);
                      setInputJson(pretty(i.data));
                      setMapping(undefined);
                      if (i.status === "confirmed")
                        void api(`/inputs/${i.id}/mapping`)
                          .then((preview) => {
                            if (mappingRevision.current === revision)
                              setMapping({ ...preview, inputId: i.id });
                          })
                          .catch((e) => setError(e.message));
                    }}
                  >
                    <strong>{i.filename}</strong>
                    <small>
                      {i.status === "confirmed" ? "已确认" : "待确认"} ·{" "}
                      {i.id.slice(0, 8)}
                    </small>
                  </button>
                ))}
              </div>
              {input && (
                <div className="asset-detail">
                  <h3>{input.filename}</h3>
                  {input.issues?.map((i: any, n: number) => (
                    <p className="note" key={n}>
                      {i.code} · {i.message ?? pretty(i)}
                    </p>
                  ))}
                  <JsonEditor
                    value={inputJson}
                    onChange={setInputJson}
                    label="确认或修正结构化数据"
                  />
                  <div className="actions">
                    <button
                      className="primary"
                      onClick={() =>
                        attempt(async () => {
                          const revision = ++mappingRevision.current;
                          const d = await api(`/inputs/${input.id}/confirm`, {
                            data: JSON.parse(inputJson),
                          });
                          if (mappingRevision.current !== revision) return;
                          setInput(d);
                          setInputJson(pretty(d.data));
                          setMapping(undefined);
                          const preview = await api(`/inputs/${d.id}/mapping`);
                          if (mappingRevision.current !== revision) return;
                          setMapping({ ...preview, inputId: d.id });
                          setNotice(
                            "输入已确认，请核对映射预览与未映射字段再应用。",
                          );
                          setInputs(await api("/inputs"));
                        })
                      }
                    >
                      确认输入
                    </button>
                    <button
                      disabled={
                        input.status !== "confirmed" ||
                        mapping?.inputId !== input.id ||
                        inputJson !== pretty(input.data)
                      }
                      onClick={() =>
                        attempt(async () => {
                          const preview = mapping;
                          if (preview?.inputId !== input.id)
                            throw new Error("请先等待当前输入的映射预览。");
                          if (!preview.trainingPatch && !preview.assets.length)
                            throw new Error(
                              "暂无可应用字段，请根据未映射原因修正输入或补充显式字段映射。",
                            );
                          if (preview.assets.length)
                            await api("/catalogs/import", {
                              items: preview.assets,
                            });
                          if (preview.trainingPatch) {
                            const patch = preview.trainingPatch,
                              model = {
                                ...JSON.parse(modelJson),
                                ...patch.model,
                              };
                            setRequest({
                              ...editUnboundModel(request, model),
                              ...patch,
                              model,
                              inputId: input.id,
                            });
                            setModelJson(pretty(model));
                            setPage("workbench");
                            setStage(3);
                          } else {
                            setPage("catalogs");
                            await loadAssets();
                          }
                          setNotice(
                            `已应用明确的训练字段，创建 ${preview.assets.length} 个草稿资产；未映射字段未进入模型，其余当前设计参数保持。`,
                          );
                        })
                      }
                    >
                      应用到场景 / 资产库
                    </button>
                  </div>
                  {mapping && (
                    <section className="mapping-preview">
                      <h3>映射预览 · 不补缺失参数</h3>
                      {mapping.adapter && (
                        <p className="note">
                          企业适配：{mapping.adapter.id} /{" "}
                          {mapping.adapter.version}；模块摘要{" "}
                          <code title={mapping.adapter.moduleSHA256}>
                            {mapping.adapter.moduleSHA256.slice(0, 12)}
                          </code>
                          ；预览{" "}
                          <code title={mapping.previewId}>
                            {mapping.previewId.slice(0, 28)}…
                          </code>
                          。
                        </p>
                      )}
                      {mapping.trainingPatch && (
                        <details open>
                          <summary>将修改的训练字段</summary>
                          <pre>{pretty(mapping.trainingPatch)}</pre>
                        </details>
                      )}
                      <p>
                        候选草稿资产：{mapping.assets.length} 项；未映射：
                        {mapping.unmapped.length} 项。
                      </p>
                      {mapping.assets.length > 0 && (
                        <DataTable
                          rows={mapping.assets.map((a: any) => ({
                            类型: kinds.find((k) => k[0] === a.kind)?.[1],
                            名称: a.name,
                            证据状态: a.payload.evidenceStatus,
                          }))}
                        />
                      )}
                      <DataTable
                        rows={mapping.unmapped.map((i: any) => ({
                          字段: i.path,
                          未映射原因: i.reason,
                        }))}
                      />
                      {mapping.warnings.map((w: string, i: number) => (
                        <p className="note" key={i}>
                          {w}
                        </p>
                      ))}
                    </section>
                  )}
                  <details>
                    <summary>原始来源定位与文件摘要</summary>
                    <pre>
                      {pretty({
                        contentHash: input.contentHash,
                        sources: input.sources,
                      })}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </section>
        )}
        {page === "tools" && (
          <>
            <section className="paper">
              <div className="section-head">
                <h2>专业求解与方案权衡</h2>
                <span className="badge">独立工具 · MCP 可调用</span>
              </div>
              <div className="tool-grid">
                {[
                  ["allocate", "指标分配"],
                  ["rbd", "可靠性框图"],
                  ["fta", "故障树"],
                  ["bdd", "共享事件 BDD"],
                  ["ctmc", "马尔科夫"],
                  ["compare", "方案比较"],
                  ["search", "目标达成搜索"],
                  ["sensitivity", "敏感性"],
                  ["attribute", "Shapley 收益"],
                  ["estimateRate", "事件频率估计"],
                ].map(([id, label]) => (
                  <button
                    className={operation === id ? "selected" : ""}
                    key={id}
                    onClick={() => prepareTool(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {methodGuidance[operation] && (
                <p className="method-guidance">
                  {methodGuidance[operation]}{" "}
                  示例输入用于理解工具，请替换为已确认的真实数据。
                </p>
              )}
              {operation === "allocate" && (
                <>
                  <p className="note">
                    此处为子模型目标分配；训练正确交付目标不能按组件可靠度直接相乘。沿用当前目标/窗口作为设计输入，请确认子模型映射与口径。
                  </p>
                  <AllocationEditor value={toolJson} onChange={setToolJson} />
                  <div className="tabs">
                    {["equal", "arinc", "agree", "availability"].map(
                      (method) => (
                        <button
                          key={method}
                          onClick={() =>
                            attempt(async () => {
                              const d = JSON.parse(toolJson);
                              setToolJson(
                                pretty({
                                  ...d,
                                  method,
                                  metricId:
                                    method === "availability"
                                      ? "steady-state-availability"
                                      : "task-reliability",
                                  items: d.items.map((i: any) => {
                                    const {
                                      locked: _l,
                                      bounds: _b,
                                      ...rest
                                    } = i;
                                    return method === "availability" ? i : rest;
                                  }),
                                }),
                              );
                            })
                          }
                        >
                          {method === "agree"
                            ? "AGREE · NASA 2016"
                            : method.toUpperCase()}
                        </button>
                      ),
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        attempt(async () => {
                          const group = await api(
                            "/allocations/compare",
                            JSON.parse(toolJson),
                          );
                          setAllocationRuns(group.runs);
                          setNotice(
                            "已提交适用的同指标分配方法，结果将在下方对照显示。" +
                              (group.skipped?.length
                                ? " 未运行：" +
                                  group.skipped
                                    .map(
                                      (s: any) => `${s.method}（${s.reason}）`,
                                    )
                                    .join("；")
                                : ""),
                          );
                        })
                      }
                    >
                      比较适用分配方法
                    </button>
                  </div>
                  {!!allocationRuns.length && (
                    <section className="allocation-comparison">
                      <h3>同指标分配结果对照</h3>
                      <p className="note">
                        {allocationRuns[0]?.input?.metricId ===
                        "steady-state-availability"
                          ? "Availability 稳态可用度，不能与任务可靠度方法横向排名。"
                          : "相同目标、窗口与模块输入；各方法的权重及重要度假设需分别确认。"}
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>模块</th>
                              {allocationRuns.map((r) => (
                                <th key={r.id}>
                                  {r.input.method.toUpperCase()} ·{" "}
                                  {states[r.status]}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(allocationRuns[0]?.input?.items ?? []).map(
                              (item: any, index: number) => (
                                <tr key={item.id}>
                                  <td>{item.name ?? item.id}</td>
                                  {allocationRuns.map((r) => (
                                    <td key={r.id}>
                                      {r.error
                                        ? r.error.message
                                        : pct(r.result?.items?.[index]?.target)}
                                    </td>
                                  ))}
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}
              {["rbd", "fta", "bdd"].includes(operation) && (
                <StaticDiagram json={toolJson} method={operation} />
              )}
              <JsonEditor
                value={toolJson}
                onChange={setToolJson}
                label="工具输入 · 可保存为场景模板"
              />
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    attempt(() => solve(operation, JSON.parse(toolJson)))
                  }
                >
                  <Play size={16} /> 执行{toolNames[operation] ?? operation}
                </button>
                <button
                  onClick={() =>
                    attempt(async () => {
                      await api("/catalogs", {
                        kind: "scenario-template",
                        name: operation + " 自定义模板",
                        payload: JSON.parse(toolJson),
                      });
                      setPage("catalogs");
                      setKind("scenario-template");
                    })
                  }
                >
                  保存模板
                </button>
              </div>
            </section>
            <Result run={run} onApplyCandidate={applyCandidate} />
          </>
        )}
        {page === "runs" && (
          <>
            <section className="paper">
              <div className="section-head">
                <h2>实验历史</h2>
                <button
                  onClick={() =>
                    attempt(async () => setRuns(await api("/runs")))
                  }
                >
                  <RefreshCw size={16} /> 刷新
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>实验</th>
                      <th>方法</th>
                      <th>状态</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() =>
                              attempt(async () =>
                                setRun(await api("/runs/" + r.id)),
                              )
                            }
                          >
                            {r.id.slice(0, 8)}
                          </button>
                        </td>
                        <td>{toolNames[r.operation] ?? r.operation}</td>
                        <td>{states[r.status]}</td>
                        <td>{new Date(r.createdAt).toLocaleString()}</td>
                        <td>
                          <button
                            onClick={() =>
                              attempt(async () => {
                                setRun(await api(`/runs/${r.id}/replay`, {}));
                                setPage("workbench");
                              })
                            }
                          >
                            重放
                          </button>
                          <a href={url(`/runs/${r.id}/report?format=json`)}>
                            {" "}
                            JSON
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <Result run={run} onApplyCandidate={applyCandidate} />
            {run && <FeedbackPanel run={run} />}
          </>
        )}
        {page === "settings" && (
          <section className="paper">
            <h2>解耦组件与连接状态</h2>
            {settings?.runtime?.profile === "internal" && (
              <p className="note">
                内网模式：使用管理员批准的企业模型，关闭 Agent
                分享和自动更新。网络出口隔离需由公司环境验收。
              </p>
            )}
            <DataTable
              rows={[
                {
                  component: "运行环境",
                  state:
                    settings?.runtime?.profile === "internal"
                      ? "内网"
                      : "通用开发",
                  endpoint: settings?.runtime?.provider?.name ?? "本机配置",
                },
                {
                  component: "企业映射适配",
                  state: settings?.runtime?.adapter ? "已配置" : "核心标准映射",
                  endpoint: settings?.runtime?.adapter
                    ? `${settings.runtime.adapter.id} / ${settings.runtime.adapter.version}`
                    : "JSON / CSV / XLSX",
                },
                {
                  component: "Agent / OpenCode",
                  state: settings?.agent?.ready ? "服务已连接" : "未连接",
                  endpoint: settings?.agent?.url,
                },
                {
                  component: "文件提取模型",
                  state: settings?.modelConfigured ? "已配置" : "未配置",
                  endpoint: ".env MODEL_*",
                },
                {
                  component: "MCP",
                  state: "stdio / Streamable HTTP",
                  endpoint: "pnpm mcp / 4179",
                },
                {
                  component: "数据",
                  state: "SQLite + 版本快照",
                  endpoint: settings?.dataDir,
                },
              ]}
            />
            <p className="note">
              OpenCode 模型、Provider/API Key 与自定义 Base URL
              使用右侧官方设置，由本地 OpenCode 管理。MODEL_*
              仅用于独立文件提取组件。
            </p>
            <p>
              <a
                className="button"
                href={settings?.agent?.url ?? "http://127.0.0.1:4096"}
                target="_blank"
                rel="noreferrer"
              >
                打开本地官方 OpenCode 配置
              </a>
            </p>
            <h3>实时文件读取</h3>
            <p>
              当前任务的 inputs
              目录会实时读取文件变更并生成待确认输入。核对后再应用到设计，历史结果保留旧快照。
            </p>
            <pre>{task.workspacePath + "/inputs"}</pre>
            <h3>可信度边界</h3>
            <p>
              数学求解与专家回归已验证的部分可复现；产品参数、传播假设、共因模型仍需要实测或评审。OpenCode
              的可用模型以官方界面为准；未配置提取模型时，非结构化自动提取不可用。
            </p>
          </section>
        )}
        <footer>
          ReMAP / 可靠性建模评估验证{" "}
          <span>目标 → 模型 → 机制 → 证据 → 决策</span>
        </footer>
      </main>
      <OpenCodePanel
        session={session}
        taskName={task.name}
        onSession={setSession}
        context={{
          scenario,
          summary: {
            target: request.target,
            cards: request.cards,
            hours: request.hours,
            generation: request.generation,
            metric:
              scenario === "training"
                ? "correct-delivery"
                : "system-probability",
            inputRevision: designRevision.current,
          },
          step: workflowSteps[stage].id,
          runId: run?.id,
        }}
        onNotice={setNotice}
        onError={setError}
        onExpand={() => setChatBottom(!chatBottom)}
        beforeContext={flushDesign}
      />
    </div>
  );
}

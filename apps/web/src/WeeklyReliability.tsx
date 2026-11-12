import { useEffect, useMemo, useState } from "react";
import { useTaskApi } from "./api";
import {
  defaultWeeklyScenario,
  type WeeklyScenario,
  type WeeklyDisplay,
  type WeeklyStage,
  type WeeklyModeId,
} from "../../../packages/contracts/src/weekly-reliability";
import {
  evaluateWeeklyScenario,
  weeklyModeNames,
  type WeeklyEvaluation,
} from "../../../packages/analysis/src/weekly-reliability";
import "./weekly-reliability.css";

const n = (v: number, digits = 2) =>
  v.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const pct = (v: number) => n(v * 100) + "%";
const stageNames = { current: "现状", improved: "改进后" };
type Loss = WeeklyEvaluation["current"]["total"];
const lossText = (m: Pick<Loss, "knownLossHours" | "complete">) =>
  m.complete
    ? `${n(m.knownLossHours)}h`
    : m.knownLossHours > 0
      ? `已知${n(m.knownLossHours)}h＋待补`
      : "损失待补";
const availabilityText = (
  m: Pick<Loss, "knownLossHours" | "complete" | "budgetAvailabilityCeiling">,
) =>
  m.complete
    ? `A预算 ${pct(m.budgetAvailabilityCeiling)}`
    : m.knownLossHours > 0
      ? `A预算 ≤${pct(m.budgetAvailabilityCeiling)}`
      : "A 待评估";
// One fixed absolute weekly-loss scale for both stages. Unknown is visually distinct from zero.
function lossFill(hours: number) {
  const t = Math.min(1, Math.log1p(hours) / Math.log1p(67.2));
  const a = [230, 242, 252],
    b = [238, 136, 136];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}
function WeeklyTopology({
  result,
  display,
  profile,
}: {
  result: WeeklyEvaluation;
  display: WeeklyDisplay;
  profile: WeeklyScenario;
}) {
  const stages: WeeklyStage[] =
    display === "both" ? ["current", "improved"] : [display];
  const mode = (s: WeeklyStage, id: WeeklyModeId) =>
    result[s].modes.find((m) => m.id === id)!;
  const networkKnown = (s: WeeklyStage) => ({
    ...mode(s, "optical"),
    complete: false,
  });
  function module(
    id: string,
    name: string,
    x: number,
    y: number,
    w: number,
    get?: (
      s: WeeklyStage,
    ) => Pick<
      Loss,
      "knownLossHours" | "complete" | "budgetAvailabilityCeiling"
    >,
    subtitle?: string,
  ) {
    const compact = w < 260;
    return (
      <g key={id} data-weekly-module={id}>
        <rect
          x={x}
          y={y}
          width={w}
          height={140}
          rx="7"
          fill="#fff"
          stroke="#5482a1"
          strokeWidth="1.3"
        />
        <text x={x + 12} y={y + 24} className="wk-module-title">
          {name}
        </text>
        {stages.map((s, i) => {
          const m = get?.(s),
            row = y + 35 + i * 48;
          return (
            <g key={s} data-stage={s}>
              <rect
                x={x + 7}
                y={row}
                width={w - 14}
                height="43"
                rx="4"
                fill={m ? lossFill(m.knownLossHours) : "#eef5fb"}
                stroke={!m || !m.complete ? "#99b3c8" : "none"}
                strokeDasharray={!m || !m.complete ? "4 3" : undefined}
              />
              <text x={x + 13} y={row + 17} fontSize={compact ? 13 : 15}>
                {stageNames[s]} · {m ? lossText(m) : "损失待补"}
              </text>
              <text
                x={x + 13}
                y={row + 35}
                fontSize={compact ? 13 : 14}
                fontWeight="600"
              >
                {m ? availabilityText(m) : "A 待评估"}
              </text>
            </g>
          );
        })}
        {subtitle && stages.length === 1 && (
          <text x={x + 13} y={y + 116} fontSize="12">
            {subtitle}
          </text>
        )}
      </g>
    );
  }
  return (
    <div className="wk-topology">
      <svg
        viewBox="0 0 1200 830"
        role="img"
        aria-label="Atlas 950参考架构：各模块周度损失及预算可用度"
      >
        <defs>
          <marker
            id="wk-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0 0L8 4L0 8" fill="#206491" />
          </marker>
        </defs>
        <rect
          x="16"
          y="16"
          width="705"
          height="540"
          rx="10"
          fill="#f5f9fd"
          stroke="#4e7b9a"
        />
        <text x="32" y="44" fontSize="19" fontWeight="700">
          01 计算 · 代表计算柜 / 节点 / 计算板
        </text>
        <text x="32" y="68" fontSize="12">
          {stages
            .map(
              (s) =>
                `${stageNames[s]} ${lossText(result[s].compute)} · ${availabilityText(result[s].compute)}`,
            )
            .join("  →  ")}
        </text>
        <rect
          x="34"
          y="86"
          width="455"
          height="450"
          rx="7"
          fill="#fff"
          stroke="#759bb6"
        />
        <text x="48" y="111" fontSize="18" fontWeight="700">
          NPU（故障口径不含右侧HBM）
        </text>
        {stages.map((s, i) => (
          <text key={s} x="48" y={139 + i * 24} fontSize="14">
            {stageNames[s]} · {lossText(result[s].npu)} ·{" "}
            {availabilityText(result[s].npu)}
          </text>
        ))}
        {module(
          "aicore-sdc",
          "AICore · 静默数据污染",
          49,
          194,
          425,
          (s) => mode(s, "aicore-sdc"),
          "漏检分支已计入；检出分支仍需恢复链时长",
        )}
        {module("npu-other", "NPU其余模式 · 细分待补", 49, 350, 425, (s) =>
          mode(s, "npu-other"),
        )}
        <text x="49" y="517" fontSize="13">
          IOD物理位于芯片内，责任归02网络；本次未提供独立份额。
        </text>
        {module("hbm", "HBM", 506, 194, 198, (s) => mode(s, "hbm"))}
        <path d="M489 270H506" stroke="#206491" strokeWidth="3" />
        <text x="518" y="375" fontSize="14" fontWeight="650">
          纠错 → 故障消减
        </text>
        <text x="518" y="400" fontSize="14">
          {n(result.current.modes[0].events)} →{" "}
          {n(result.improved.modes[0].events)}
        </text>
        <text x="518" y="423" fontSize="13">
          次 / 周
        </text>
        <rect
          x="745"
          y="16"
          width="439"
          height="540"
          rx="10"
          fill="#f5f9fd"
          stroke="#4e7b9a"
        />
        <text x="762" y="44" fontSize="19" fontWeight="700">
          02 网络 · 互联路径
        </text>
        {stages.map((s, i) => (
          <text key={s} x="762" y={64 + i * 17} fontSize="12">
            {stageNames[s]} {lossText(networkKnown(s))} ·{" "}
            {availabilityText(networkKnown(s))}
          </text>
        ))}
        {module("iod-l1", "IOD / L1 · 子项参数待拆分", 763, 87, 403)}
        {module(
          "optical",
          `光模块 · 故障份额${pct(profile.shares.optical)}`,
          763,
          250,
          403,
          (s) => mode(s, "optical"),
        )}
        {module("l2-network", "L2 / Leaf / Spine · 子项待拆分", 763, 410, 403)}
        <path
          d="M721 156H761M963 229V248M963 392V408"
          fill="none"
          stroke="#206491"
          strokeWidth="2.5"
          markerEnd="url(#wk-arrow)"
        />
        <text x="20" y="589" fontSize="16" fontWeight="650">
          其余物理域与公共开销
        </text>
        {module("storage", "03 存储", 16, 606, 278)}
        {module("facility", "04 供电 / 冷却", 312, 606, 278)}
        {module("software", "05 软件 / 调度", 608, 606, 278)}
        {module("overhead", "06 检查点等公共开销", 904, 606, 280)}
        <text x="20" y="777" fontSize="14">
          未归属的
          {pct(
            1 -
              profile.shares.hbm -
              profile.shares.npu -
              profile.shares.optical,
          )}
          故障保留在“其余来源”，不按比例摊入存储、设施、软件或IOD。
        </text>
        <text x="20" y="803" fontSize="14">
          浅蓝 →
          红色：已知损失递增；虚线：参数不全。A预算只表示损失账折算，不是模块独立仿真可用度。
        </text>
      </svg>
    </div>
  );
}

export default function WeeklyReliability() {
  const { api, taskId } = useTaskApi();
  const [profile, setProfile] = useState<WeeklyScenario>(defaultWeeklyScenario);
  const [revision, setRevision] = useState(0),
    [history, setHistory] = useState<any[]>([]);
  const [display, setDisplay] = useState<WeeklyDisplay>("both");
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [saved, setSaved] = useState(""),
    [dirty, setDirty] = useState(false),
    [viewedRevision, setViewedRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setReady(false);
    api("/weekly-reliability")
      .then((data) => {
        if (!alive) return;
        setProfile(data.profile);
        setRevision(data.revision);
        setViewedRevision(data.revision);
        setHistory(data.history);
        setReady(true);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [api, taskId]);
  const calculation = useMemo(() => {
    try {
      return { result: evaluateWeeklyScenario(profile), issue: "" };
    } catch (e) {
      return { result: null, issue: (e as Error).message };
    }
  }, [profile]);
  const result = calculation.result;
  const edit = (next: WeeklyScenario) => {
    setProfile(next);
    setDirty(true);
    setSaved("");
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const snapshot = await api("/weekly-reliability", {
        baseRevision: revision,
        profile,
      });
      setRevision(snapshot.revision);
      setViewedRevision(snapshot.revision);
      setHistory((h) => [...h, snapshot]);
      setDirty(false);
      setSaved(
        `已保存r${snapshot.revision}，故障模式库5项、机制库5项及来源/场景已更新；旧版本保留。`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exportSnapshot = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              taskId,
              revision: dirty ? null : viewedRevision,
              profile,
              result,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "ReMAP-周度现状与改进.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const numeric = (
    label: string,
    value: number | null,
    update: (v: number | null) => void,
    allowNull = false,
    max?: number,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max={max}
        step="any"
        value={value !== null && Number.isFinite(value) ? value : ""}
        placeholder={allowNull ? "待补" : undefined}
        onChange={(e) =>
          update(
            e.target.value === "" && allowNull ? null : e.target.valueAsNumber,
          )
        }
      />
    </label>
  );
  if (!ready)
    return (
      <section className="paper">
        <p>{error || "正在读取周度场景…"}</p>
      </section>
    );
  return (
    <section className="paper weekly-reliability" aria-label="周度现状与改进">
      <div className="wk-heading">
        <div>
          <span className="wk-eyebrow">
            {n(profile.cards / 10000, 1)}万卡场景 · 168小时 / 周
          </span>
          <h2>现状与改进 · 故障、损失与机制</h2>
          <p>
            每卡HBM＋NPU合计{n(profile.hbmNpuFitPerCard, 0)}{" "}
            FIT；与下方600小时历史评估分别保存。
          </p>
        </div>
        <span className="wk-version">
          {dirty
            ? "未保存修改"
            : viewedRevision
              ? `场景 r${viewedRevision}`
              : "用户场景 · 待保存"}
        </span>
      </div>
      <div className="wk-toolbar">
        <label>
          架构图显示
          <select
            aria-label="周度架构图显示"
            value={display}
            onChange={(e) => setDisplay(e.target.value as WeeklyDisplay)}
          >
            <option value="current">现状</option>
            <option value="improved">改进后</option>
            <option value="both">现状与改进后对比</option>
          </select>
        </label>
        <button type="button" onClick={save} disabled={busy || !result}>
          {busy ? "正在保存…" : "保存场景并更新两库"}
        </button>
        <button type="button" onClick={exportSnapshot} disabled={!result}>
          导出计算记录
        </button>
        {history.length > 0 && (
          <label>
            历史版本
            <select
              aria-label="周度场景版本"
              value={viewedRevision}
              onChange={(e) => {
                const s = history.find(
                  (h) => h.revision === Number(e.target.value),
                );
                if (s) {
                  setProfile(s.profile);
                  setViewedRevision(s.revision);
                  setDirty(false);
                  setSaved("");
                }
              }}
            >
              {history.map((h) => (
                <option key={h.revision} value={h.revision}>
                  r{h.revision} · {new Date(h.savedAt).toLocaleString("zh-CN")}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {saved && (
        <p role="status" className="wk-success">
          {saved}
        </p>
      )}
      {(error || calculation.issue) && (
        <p role="alert">{error || calculation.issue}</p>
      )}
      {result && (
        <>
          <div className="wk-metrics">
            <article>
              <span>现状 · 用户参考</span>
              <strong>{pct(profile.currentAvailabilityReference)}</strong>
              <p>等效损失 {n(result.referenceLossHours)} h / 周</p>
            </article>
            <article>
              <span>改进后 · 目标</span>
              <strong>{pct(profile.improvedAvailabilityTarget)}</strong>
              <p>总损失预算 {n(result.targetLossHours)} h / 周</p>
            </article>
            <article>
              <span>AICore漏检 · 已知分支</span>
              <strong>
                {n(result.current.modes[2].missedLossHours)} →{" "}
                {n(result.improved.modes[2].missedLossHours)} h
              </strong>
              <p>含压测筛查；检出率仍为 {pct(profile.detection.improved)}</p>
            </article>
          </div>
          <p
            className={
              result.knownBudgetExcessHours > 0 ? "wk-gap" : "wk-caution"
            }
          >
            {result.knownBudgetExcessHours > 0
              ? `已知改进损失超过总预算 ${n(result.knownBudgetExcessHours)}h / 周。`
              : "已知分支暂未超预算，仍需完成其余损失与仿真验证。"}
            改进后的整网可用度尚未验证。仅把全部预算给AICore漏检分支，检出率也需至少{" "}
            {pct(result.minimumDetectionWithWholeBudget)}
            {result.maximumMissedHoursWithWholeBudget !== null
              ? `，或将漏检等效时长降至 ${n(result.maximumMissedHoursWithWholeBudget)}h 以内`
              : ""}
            ；其他故障还需预留预算。
          </p>
          <WeeklyTopology result={result} display={display} profile={profile} />
          <h3>故障模式库 · 互斥来源与损失</h3>
          <p>
            FIT为每张活动卡的等效值。NPU总频率 {n(result.current.npu.events, 4)}{" "}
            → {n(result.improved.npu.events, 4)}{" "}
            次/周，已包含AICore，不能再次相加。
          </p>
          <div className="table-scroll">
            <table className="wk-table">
              <thead>
                <tr>
                  <th>部件 / 故障模式</th>
                  <th>
                    FIT/卡
                    <br />
                    现状 → 改进
                  </th>
                  <th>
                    故障次数/周
                    <br />
                    现状 → 改进
                  </th>
                  <th>现状损失 h/周</th>
                  <th>改进损失 h/周</th>
                  <th>可计算减损 h/周</th>
                </tr>
              </thead>
              <tbody>
                {result.current.modes.map((m, i) => {
                  const after = result.improved.modes[i];
                  return (
                    <tr key={m.id}>
                      <th>{m.name}</th>
                      <td>
                        {n(m.fitPerCard, 3)} → {n(after.fitPerCard, 3)}
                      </td>
                      <td>
                        {n(m.events, 4)} → {n(after.events, 4)}
                      </td>
                      <td>{lossText(m)}</td>
                      <td>{lossText(after)}</td>
                      <td>
                        {m.complete && after.complete
                          ? n(m.knownLossHours - after.knownLossHours, 4)
                          : m.id === "aicore-sdc"
                            ? `${n(m.missedLossHours - after.missedLossHours, 4)}（仅漏检）`
                            : "待恢复参数"}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <th>系统互斥来源合计</th>
                  <td>
                    {n(result.current.totalFitPerCard, 3)} →{" "}
                    {n(result.improved.totalFitPerCard, 3)}
                  </td>
                  <td>
                    {n(result.current.total.events, 4)} →{" "}
                    {n(result.improved.total.events, 4)}
                  </td>
                  <td>{lossText(result.current.total)}</td>
                  <td>{lossText(result.improved.total)}</td>
                  <td>完整收益待核验</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3>可靠性机制库 · 参数与作用路径</h3>
          <div className="table-scroll">
            <table className="wk-table">
              <thead>
                <tr>
                  <th>分类 / 措施</th>
                  <th>参数名</th>
                  <th>现状 → 改进</th>
                  <th>作用范围与恢复链</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>增加MTBF · HBM纠错</th>
                  <td>reductions.hbm</td>
                  <td>0 → {pct(profile.reductions.hbm)}</td>
                  <td>降低HBM故障发生率；具体可纠正模式待核实。</td>
                </tr>
                <tr>
                  <th>增加MTBF · 静默故障压测</th>
                  <td>reductions.aiCoreSilent</td>
                  <td>0 → {pct(profile.reductions.aiCoreSilent)}</td>
                  <td>筛除AICore静默故障，不重复降低全部NPU故障。</td>
                </tr>
                <tr>
                  <th>增加MTBF · 光模块改进</th>
                  <td>reductions.optical</td>
                  <td>0 → {pct(profile.reductions.optical)}</td>
                  <td>降低光模块等效FIT；器件、组网或冗余实现待补。</td>
                </tr>
                <tr>
                  <th>降低MTTR · 静默故障检测</th>
                  <td>detection / missedRecoveryHours</td>
                  <td>
                    {pct(profile.detection.current)} →{" "}
                    {pct(profile.detection.improved)}
                    <br />
                    {n(profile.missedRecoveryHours.current)} →{" "}
                    {n(profile.missedRecoveryHours.improved)} h
                  </td>
                  <td>
                    已检出：检测→定位→可信恢复→重算；漏检：后续发现→恢复。漏检时长为该分支整体口径。
                  </td>
                </tr>
                <tr>
                  <th>降低MTTR · 系统级快恢</th>
                  <td>eventLossHours[模式]</td>
                  <td>在下方逐项补齐</td>
                  <td>
                    检测→Agent辅助诊断/人工等待→隔离/替换→加载CKPT→回滚；95%目标不自动换算成恢复参数。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      <details className="wk-inputs">
        <summary>参数与恢复链 · 编辑并重新计算</summary>
        <p>
          时长填整条恢复链的单次等效损失（小时），包含影响范围和回滚；空白表示未知，明确为零才填0。修改仅影响本周度场景，保存时同步生成两库新版本。
        </p>
        <div className="wk-input-grid">
          {numeric("活动卡数", profile.cards, (v) =>
            edit({ ...profile, cards: v! }),
          )}
          {numeric("每卡HBM＋NPU合计FIT", profile.hbmNpuFitPerCard, (v) =>
            edit({ ...profile, hbmNpuFitPerCard: v! }),
          )}
          {numeric(
            "现状参考可用度（%）",
            profile.currentAvailabilityReference * 100,
            (v) => edit({ ...profile, currentAvailabilityReference: v! / 100 }),
            false,
            100,
          )}
          {numeric(
            "改进目标可用度（%）",
            profile.improvedAvailabilityTarget * 100,
            (v) => edit({ ...profile, improvedAvailabilityTarget: v! / 100 }),
            false,
            100,
          )}
          {(["hbm", "npu", "optical"] as const).map((id) => (
            <div key={id}>
              {numeric(
                `${{ hbm: "HBM", npu: "NPU", optical: "光模块" }[id]}故障占比（%）`,
                profile.shares[id] * 100,
                (v) =>
                  edit({
                    ...profile,
                    shares: { ...profile.shares, [id]: v! / 100 },
                  }),
                false,
                100,
              )}
            </div>
          ))}
          {numeric(
            "全部静默故障占比（%）",
            profile.silentShare * 100,
            (v) => edit({ ...profile, silentShare: v! / 100 }),
            false,
            100,
          )}
          {numeric(
            "AICore占静默故障（%）",
            profile.aiCoreShareOfSilent * 100,
            (v) => edit({ ...profile, aiCoreShareOfSilent: v! / 100 }),
            false,
            100,
          )}
          {(["hbm", "aiCoreSilent", "optical"] as const).map((id) => (
            <div key={id}>
              {numeric(
                `${{ hbm: "HBM", aiCoreSilent: "AICore静默", optical: "光模块" }[id]}故障消减（%）`,
                profile.reductions[id] * 100,
                (v) =>
                  edit({
                    ...profile,
                    reductions: { ...profile.reductions, [id]: v! / 100 },
                  }),
                false,
                100,
              )}
            </div>
          ))}
        </div>
        <table className="wk-table">
          <thead>
            <tr>
              <th>恢复链参数</th>
              <th>现状</th>
              <th>改进后</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>静默检出率（%）</th>
              {(["current", "improved"] as const).map((s) => (
                <td key={s}>
                  {numeric(
                    `${stageNames[s]}静默检出率`,
                    profile.detection[s] * 100,
                    (v) =>
                      edit({
                        ...profile,
                        detection: { ...profile.detection, [s]: v! / 100 },
                      }),
                    false,
                    100,
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th>漏检分支总损失（h/次）</th>
              {(["current", "improved"] as const).map((s) => (
                <td key={s}>
                  {numeric(
                    `${stageNames[s]}漏检恢复小时`,
                    profile.missedRecoveryHours[s],
                    (v) =>
                      edit({
                        ...profile,
                        missedRecoveryHours: {
                          ...profile.missedRecoveryHours,
                          [s]: v!,
                        },
                      }),
                  )}
                </td>
              ))}
            </tr>
            {(Object.keys(weeklyModeNames) as WeeklyModeId[]).map((id) => (
              <tr key={id}>
                <th>
                  {weeklyModeNames[id]}
                  <br />
                  {id === "aicore-sdc" ? "仅已检出分支" : "整条恢复链"}（h/次）
                </th>
                {(["current", "improved"] as const).map((s) => (
                  <td key={s}>
                    {numeric(
                      `${stageNames[s]} ${weeklyModeNames[id]}单次损失`,
                      profile.eventLossHours[s][id],
                      (v) =>
                        edit({
                          ...profile,
                          eventLossHours: {
                            ...profile.eventLossHours,
                            [s]: { ...profile.eventLossHours[s], [id]: v },
                          },
                        }),
                      true,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <label>
          来源与适用条件
          <textarea
            value={profile.evidenceNote}
            onChange={(e) => edit({ ...profile, evidenceNote: e.target.value })}
          />
        </label>
      </details>
      {result && (
        <details className="wk-method">
          <summary>计算方法与边界</summary>
          <ol>
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
          <p>
            本分析用于核对输入和损失预算。完整的目标分配、故障域/冗余评估、机制归因和离散事件验证继续使用下方四步流程；本页不自动确认或完成这些步骤。
          </p>
        </details>
      )}
    </section>
  );
}

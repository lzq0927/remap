import type { ReactNode } from "react";
import { useState } from "react";
import { Download, ArrowRight } from "lucide-react";
import type {
  Run,
  TrainingRequest,
} from "../../../packages/contracts/src/types";
import { pretty, useTaskApi } from "./api";
import AuditResult from "./AuditResult";

export interface ResultViewProps {
  run: Run | null | undefined;
  onApplyCandidate?: (request: TrainingRequest) => void;
  onApplyAudit?: (request: any) => void;
}
const statusNames: Record<string, string> = {
  queued: "等待运行",
  running: "正在计算",
  succeeded: "计算完成",
  failed: "计算失败",
  cancelled: "已取消",
};
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, digits = 3) =>
  finite(v)
    ? v.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const pct = (v: unknown) => (finite(v) ? `${(v * 100).toFixed(3)}%` : "—");
const points = (v: unknown) =>
  finite(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(3)} 百分点` : "—";
const range = (s: any) => `${pct(s?.ciLow)} ～ ${pct(s?.ciHigh)}`;
const methodNames: Record<string, string> = {
  equal: "等分故障率预算",
  arinc: "按基线故障率分配",
  agree: "AGREE 近似分配",
  "agree.nasa2016-rate": "AGREE 近似分配",
  availability: "稳态可用度分配",
  rbd: "可靠性框图",
  fta: "故障树",
  bdd: "二叉决策图",
};
const parameterNames: Record<string, string> = {
  intervalSeconds: "检查点计算周期（秒）",
  saveSeconds: "保存阻塞（秒）",
  silentDetect: "静默即时检出率（%）",
  hardDetect: "中断检出率（%）",
  slowDetect: "亚健康检出率（%）",
  globalMinutes: "全局恢复（分钟）",
  localMinutes: "局部恢复（分钟）",
  fits: "四类 FIT",
  recoveryDomains: "恢复域数",
  silentMonitorPct: "监测开销（%）",
  mode: "恢复方式",
};
const lossLabels: Record<string, { name: string; description: string }> = {
  pause: {
    name: "停顿与恢复",
    description: "训练暂停、故障检测及恢复等待造成的时间损失。",
  },
  checkpointSave: {
    name: "检查点保存阻塞",
    description: "保存期间暂停训练的等效时间。",
  },
  unavailableCapacity: {
    name: "失效容量",
    description: "局部恢复时不可用卡数折算的产出损失。",
  },
  slowdown: {
    name: "亚健康降速",
    description: "设备仍运行但吞吐下降造成的损失。",
  },
  monitoring: { name: "监测开销", description: "错误监测消耗的训练吞吐。" },
  replaySlowdown: {
    name: "重放降速",
    description: "重放时吞吐低于正常训练造成的损失。",
  },
  rollback: {
    name: "回退与重算",
    description: "已计算进度被撤回，需重新计算的工作量。",
  },
  unrecoveredCorruptWork: {
    name: "未恢复污染工作",
    description: "窗口结束时尚未纠正的错误计算。",
  },
  terminalDiscard: {
    name: "终末污染连带丢弃",
    description: "末尾污染未解决时，污染前正确工作也不能交付。",
  },
};
/** Accounting rows intentionally exclude gross work, delivery and numerical residual. */
export function lossRows(result: any) {
  return Object.entries(lossLabels).flatMap(([key, label]) =>
    finite(result?.ledger?.[key])
      ? [{ key, ...label, hours: Math.max(0, result.ledger[key]) }]
      : [],
  );
}
const budgetGroups = [
  { id: "0", name: "检测与恢复停顿", keys: ["pause"] },
  { id: "1", name: "检查点与回滚", keys: ["checkpointSave", "rollback"] },
  {
    id: "2",
    name: "容量与亚健康",
    keys: ["unavailableCapacity", "slowdown", "monitoring", "replaySlowdown"],
  },
  {
    id: "3",
    name: "污染与交付清零",
    keys: ["unrecoveredCorruptWork", "terminalDiscard"],
  },
];
export function lossBudgetComparison(result: any) {
  const budget = result?.request?.lossBudget;
  if (!budget) return null;
  const items = Array.isArray(budget.items) ? budget.items : [];
  const complete =
    items.length === 4 &&
    new Set(items.map((i: any) => String(i.id))).size === 4 &&
    budgetGroups.every((group) =>
      items.some(
        (i: any) =>
          String(i.id) === group.id &&
          finite(i.lossHoursBudget) &&
          i.lossHoursBudget >= 0,
      ),
    );
  const total = items.reduce(
    (sum: number, i: any) =>
      sum + (finite(i.lossHoursBudget) ? i.lossHoursBudget : 0),
    0,
  );
  const valid =
    complete &&
    finite(budget.target) &&
    finite(budget.hours) &&
    budget.target === result.request.target &&
    budget.hours === result.request.hours &&
    Math.abs(total - (1 - budget.target) * budget.hours) < 1e-8;
  return {
    valid,
    target: budget.target,
    hours: budget.hours,
    items: budgetGroups.map((group) => {
      const item = items.find((i: any) => String(i.id) === group.id),
        actualHours = group.keys.reduce(
          (sum, key) =>
            sum + (finite(result.ledger?.[key]) ? result.ledger[key] : 0),
          0,
        ),
        budgetHours = finite(item?.lossHoursBudget)
          ? item.lossHoursBudget
          : null;
      return {
        ...group,
        actualHours,
        budgetHours,
        withinBudget:
          valid && budgetHours !== null
            ? actualHours <= budgetHours + 1e-10
            : null,
      };
    }),
  };
}
/** Apply the selection design, keeping its seed rather than the verification seed. */
export function candidateRequest(candidate: any): TrainingRequest {
  const request = candidate?.result?.request;
  if (!request || !finite(request.cards))
    throw new Error("候选缺少完整设计输入");
  return {
    ...request,
    model: { ...request.model, ...candidate.patch },
    factors: request.factors ? [...request.factors] : undefined,
  };
}
function evidence(s: any, target: unknown) {
  if (!finite(target) || !finite(s?.mean)) return "未设置可比较的目标";
  if (finite(s.ciLow) && s.ciLow >= target) return "采样区间下限达到目标";
  if (finite(s.ciHigh) && s.ciHigh < target) return "采样区间整体低于目标";
  return "采样区间跨越目标，尚不能确认";
}
function Table({
  heads,
  rows,
  caption,
}: {
  heads: string[];
  rows: ReactNode[][];
  caption?: string;
}) {
  return (
    <div className="table-wrap">
      <table>
        {caption && (
          <caption style={{ textAlign: "left", padding: "8px 0" }}>
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty">暂无可展示的数据。</p>}
    </div>
  );
}
function Metric({
  name,
  value,
  note,
}: {
  name: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div>
      <span>{name}</span>
      <strong>{value}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}
function SamplingNote({ statistics }: { statistics: any }) {
  return (
    <p className="note">
      样本 {num(statistics?.n, 0)} 条 · 95% 均值区间采用 Student-t
      近似，仅反映蒙特卡洛采样误差，不含参数和模型误差。
      {(statistics?.n < 30 || statistics?.variance === 0) &&
        " 当前样本量较少或未观察到样本差异；不能据此证明罕见故障不存在。"}
    </p>
  );
}
function Training({ result }: { result: any }) {
  const s = result.statistics,
    target = result.request?.target,
    losses = lossRows(result),
    gap = finite(target) ? s.mean - target : undefined;
  return (
    <>
      <div className="metrics">
        <Metric
          name="训练有效可用度（正确交付产出率）"
          value={pct(s.mean)}
          note={
            finite(target)
              ? `点估计${s.mean >= target ? "达到" : "低于"}场景目标 ${pct(target)}`
              : undefined
          }
        />
        <Metric
          name="距场景目标"
          value={points(gap)}
          note={evidence(s, target)}
        />
        <Metric
          name="95% 均值区间"
          value={range(s)}
          note="本次设定条件下的采样证据"
        />
      </div>
      <SamplingNote statistics={s} />
      <div className="metric-strip">
        <span>运行可用度 {pct(result.diagnostics?.uptime)}</span>
        <span>满足目标的轨迹比例 {pct(s.achievementProbability)}</span>
        <span>
          Wilson 95% 区间 {pct(s.achievementInterval?.low)} ～{" "}
          {pct(s.achievementInterval?.high)}
        </span>
      </div>
      <p className="note">
        轨迹比例衡量单个训练窗口是否达到目标，与均值达到目标分别判断。本结果评价当前场景，不能直接宣称产品达标。
      </p>
      <h3>
        损失账本 <small>等效训练小时</small>
      </h3>
      {losses.map((row) => (
        <div className="ledger" key={row.key} title={row.description}>
          <span>{row.name}</span>
          <div aria-hidden="true">
            <i
              style={{
                width: `${Math.min(100, (100 * row.hours) / (result.request?.hours || 1))}%`,
              }}
            />
          </div>
          <code>{num(row.hours)}</code>
        </div>
      ))}
      <p className="note">
        窗口末仍有未解决的静默污染时，整条轨迹的交付为零；“终末污染连带丢弃”包括污染前的正确工作。账本是损失核算，干预贡献请查看
        Shapley 分析。
      </p>
      <BudgetComparison result={result} />
      <details>
        <summary>分位数、账本核算与损失解释</summary>
        <Table
          heads={["统计量", "结果"]}
          rows={[
            [
              "P05 / P50 / P95",
              `${pct(s.p05)} / ${pct(s.p50)} / ${pct(s.p95)}`,
            ],
            ["平均已交付工作（等效小时）", num(result.ledger?.delivered)],
            ["平均总计算工作（等效小时）", num(result.ledger?.grossWork)],
            ["账本守恒残差", num(result.ledger?.residual, 10)],
          ]}
        />
        <Table
          heads={["损失项", "解释"]}
          rows={losses.map((row) => [row.name, row.description])}
        />
      </details>
    </>
  );
}
function BudgetComparison({ result }: { result: any }) {
  const comparison = lossBudgetComparison(result);
  if (!comparison) return null;
  return (
    <>
      <h3>实际损失与保存的预算</h3>
      <p className="note">
        {comparison.valid
          ? "预算目标与窗口匹配，以下只比较平均损失点估计，不代表工程能力已经验证。"
          : "预算已失效：保存的目标、窗口或预算结构与本次输入不匹配。请重新分配并保存预算，当前不作预算符合结论。"}
      </p>
      <Table
        heads={[
          "互斥损失组",
          "平均实际损失（小时）",
          "保存预算（小时）",
          "点估计对照",
          "工程落实",
        ]}
        rows={comparison.items.map((i) => [
          i.name,
          num(i.actualHours),
          num(i.budgetHours),
          i.withinBudget === null
            ? "不作判断"
            : i.withinBudget
              ? "平均点估计未超预算"
              : "平均点估计超出预算",
          "工程参数映射待确认",
        ])}
      />
      <p className="note">
        四组互斥汇总全部损失，不含总计算工作和已交付工作。预算仍需映射到
        FIT、检出率、恢复时间等可实施参数。
      </p>
    </>
  );
}
function Allocation({ result }: { result: any }) {
  const availability = result.method === "availability";
  return (
    <>
      <h3>{methodNames[result.method] ?? "可靠性分配"} · 子系统目标</h3>
      <p className="note">
        {availability
          ? "下表比较模块的稳态可用度目标。"
          : "下表比较共同任务定义下的模块可靠度与故障率目标。"}{" "}
        分配结果是设计预算，实施后仍需验证。
      </p>
      {result.method === "agree" && (
        <p className="note">
          AGREE 使用 NASA 2016 工程近似分配，按 ∏Rᵢ^Eᵢ
          合成加权任务可靠度；普通串联乘积不一定等于总体目标。
        </p>
      )}
      {result.recomposition && (
        <p className="note">
          目标回合成：{result.recomposition.formula} ={" "}
          {pct(result.recomposition.achieved)}；目标{" "}
          {pct(result.recomposition.target)}。分配先提出设计约束，再通过降低 FIT
          或检测、恢复、隔离等措施正向验证；Shapley 用于后续组合收益分摊。
        </p>
      )}
      <Table
        heads={[
          "模块",
          "当前估计",
          "分配目标",
          "目标与当前的差额",
          "目标故障率 / 小时",
          "约束",
        ]}
        rows={(result.items ?? []).map((i: any) => [
          i.name ?? i.id,
          pct(i.current),
          pct(i.target),
          points(i.gap),
          availability
            ? "不适用"
            : finite(i.targetRate)
              ? i.targetRate.toExponential(4)
              : "—",
          i.locked !== undefined
            ? `锁定 ${pct(i.locked)}`
            : i.bounds
              ? `${pct(i.bounds.min ?? 0)} ～ ${pct(i.bounds.max ?? 1)}`
              : "自由分配",
        ])}
      />
      {result.version && <p className="note">方法版本：{result.version}</p>}
    </>
  );
}
function Comparison({
  result,
  onApplyCandidate,
}: {
  result: any;
  onApplyCandidate?: ResultViewProps["onApplyCandidate"];
}) {
  const base = result.base?.statistics,
    target = result.base?.request?.target;
  return (
    <>
      <h3>{result.parameter ? "参数敏感性" : "方案比较"}</h3>
      <p>
        基线正确交付均值 <strong>{pct(base?.mean)}</strong> ·{" "}
        {result.parameter &&
          `${parameterNames[result.parameter] ?? result.parameter} · `}
        使用配对样本比较变化。
      </p>
      <Table
        heads={[
          "方案 / 参数取值",
          "交付均值",
          "95% 均值区间",
          "相对基线变化",
          "变化的 95% 区间",
          "目标证据",
          "下一步",
        ]}
        rows={(result.items ?? []).map((i: any) => [
          i.name ?? i.id,
          pct(i.result?.statistics?.mean),
          range(i.result?.statistics),
          points(i.delta?.mean),
          `${points(i.delta?.ciLow)} ～ ${points(i.delta?.ciHigh)}`,
          evidence(i.result?.statistics, target),
          <button
            type="button"
            disabled={!onApplyCandidate || !i.result?.request}
            onClick={() => onApplyCandidate?.(candidateRequest(i))}
          >
            应用到当前设计 <ArrowRight size={13} />
          </button>,
        ])}
      />
      <SamplingNote statistics={base} />
      <p className="note">
        变化以百分点表示，正值为交付改善。配对种子减少比较噪声；参数改变也可能改变故障事件的对齐。
      </p>
    </>
  );
}
const searchNames: Record<string, string> = {
  proven_infeasible: "有限设计范围内有不可行证据",
  no_candidate_found: "本次采样未找到候选",
  verified_candidate: "候选通过本次独立采样验证",
  candidate_unconfirmed: "候选仍需更多验证",
};
function Search({
  result,
  onApplyCandidate,
}: {
  result: any;
  onApplyCandidate?: ResultViewProps["onApplyCandidate"];
}) {
  const verification = result.verification,
    target =
      result.target ??
      verification?.request?.target ??
      result.items?.[0]?.result?.request?.target;
  const design = (patch: Record<string, any>) =>
    Object.entries(patch ?? {})
      .map(
        ([k, v]) =>
          `${parameterNames[k] ?? k}：${Array.isArray(v) ? v.map((n) => num(n)).join(" / ") : String(v)}`,
      )
      .join("；");
  return (
    <>
      <h3>{searchNames[result.status] ?? "设计搜索结果"}</h3>
      <p className="note">
        仅搜索给定的有限设计集合。未找到候选不等于不可行；独立验证通过也仅支持当前参数与模型条件。
      </p>
      <div className="metrics">
        <Metric name="候选设计数" value={num(result.candidateCount, 0)} />
        <Metric
          name="有限窗口上界"
          value={pct(result.upperBound)}
          note="仅在证书条件适用时具备约束意义"
        />
        <Metric
          name="连续计算 / 保存占空比"
          value={pct(result.checkpointDutyCycle)}
          note="与有限窗口上界分别展示"
        />
      </div>
      {result.proof && (
        <p className="note">
          不可行证据：给定候选即使无故障也受干净检查点保存预算限制，有限窗口上界低于目标{" "}
          {pct(target)}。该证书不适用于可以保留计算并重置保存周期的即时 step
          恢复策略。
        </p>
      )}
      {verification && (
        <>
          <h3>独立验证</h3>
          <p>
            交付均值 <strong>{pct(verification.statistics?.mean)}</strong> · 95%
            区间 {range(verification.statistics)} ·{" "}
            {evidence(verification.statistics, target)}
          </p>
          <SamplingNote statistics={verification.statistics} />
        </>
      )}
      <Table
        caption="候选按筛选阶段的交付均值排序，展示前 12 项。"
        heads={["候选设计", "筛选均值", "95% 均值区间", "目标证据", "下一步"]}
        rows={(result.items ?? []).slice(0, 12).map((i: any) => [
          design(i.patch),
          pct(i.result?.statistics?.mean),
          range(i.result?.statistics),
          evidence(i.result?.statistics, target),
          <button
            type="button"
            disabled={!onApplyCandidate || !i.result?.request}
            onClick={() => onApplyCandidate?.(candidateRequest(i))}
            title="将该候选的模型参数应用到当前设计，随后可重新评估"
          >
            应用到当前设计 <ArrowRight size={13} />
          </button>,
        ])}
      />
      <p className="note">
        回代只更新当前设计，不会自动发起新计算。验证使用与筛选不重叠的轨迹种子。
      </p>
    </>
  );
}
function Attribution({ result }: { result: any }) {
  const contributions = result.contributions ?? [],
    max = Math.max(
      ...contributions.map((i: any) => Math.abs(i.shapley)),
      1e-10,
    );
  return (
    <>
      <h3>干预贡献 · Shapley 分摊</h3>
      <p>
        组合总交付变化 <strong>{points(result.gain)}</strong>
        。负贡献表示该干预在当前组合与参数下平均降低交付。
      </p>
      <Table
        heads={["干预", "贡献（百分点）", "贡献大小", "95% 采样区间"]}
        rows={contributions.map((i: any) => [
          i.name ?? i.id,
          points(i.shapley),
          <div
            style={{ width: 120, height: 9, background: "var(--line)" }}
            aria-hidden="true"
          >
            <div
              style={{
                height: "100%",
                width: `${(Math.abs(i.shapley) / max) * 100}%`,
                background: i.shapley < 0 ? "#b36343" : "var(--teal)",
              }}
            />
          </div>,
          `${points(i.statistics?.ciLow)} ～ ${points(i.statistics?.ciHigh)}`,
        ])}
      />
      <p className="note">
        完整组合枚举；贡献保留正负，不等同于账本损失比例。贡献之和应等于组合总变化，守恒残差{" "}
        {num(result.residual, 10)} 百分比比例单位。
      </p>
      <details>
        <summary>
          全部组合与采样依据 · {result.coalitions?.length ?? 0} 项
        </summary>
        <Table
          heads={["干预组合", "交付均值", "95% 区间"]}
          rows={(result.coalitions ?? []).map((c: any) => [
            c.factors?.length
              ? c.factors
                  .map(
                    (id: string) =>
                      contributions.find((i: any) => i.id === id)?.name ?? id,
                  )
                  .join(" + ")
              : "基线",
            pct(c.result?.statistics?.mean),
            range(c.result?.statistics),
          ])}
        />
        <SamplingNote statistics={contributions[0]?.statistics} />
      </details>
    </>
  );
}
function Static({ result }: { result: any }) {
  const failure = result.details?.metric === "top-event probability";
  return (
    <>
      <div className="metrics">
        <Metric
          name={failure ? "顶事件发生概率" : "系统成功概率"}
          value={pct(result.probability)}
          note={
            failure
              ? "概率越低表示顶事件越少发生"
              : "当前事件概率与结构下的计算结果"
          }
        />
        <Metric
          name="求解方法"
          value={methodNames[result.method] ?? result.method}
        />
        <Metric
          name="独立基本事件数"
          value={num(result.details?.eventCount, 0)}
        />
      </div>
      <p className="note">
        重复事件 ID
        表示同一个事件，已共享处理；不同基本事件按独立假设计算。相关事件需建立联合模型。
      </p>
      <details>
        <summary>事件顺序与求解规模</summary>
        <Table
          heads={["事件顺序", "BDD 节点数"]}
          rows={[
            [
              result.details?.eventOrder?.join(" → "),
              num(result.details?.bddNodes, 0),
            ],
          ]}
        />
      </details>
    </>
  );
}
function Ctmc({ result }: { result: any }) {
  return (
    <>
      <h3>连续时间马尔可夫链 · 状态与奖励</h3>
      <div className="metrics">
        <Metric
          name="稳态期望奖励"
          value={num(result.stationaryReward, 6)}
          note="奖励为 0/1 状态指示时，可解释为状态可用度"
        />
        <Metric
          name="累计期望奖励"
          value={num(result.integratedReward, 6)}
          note="从时间零积分至最后请求时刻"
        />
        <Metric name="状态数" value={num(result.stationary?.length, 0)} />
      </div>
      <Table
        heads={["状态", "稳态概率"]}
        rows={(result.stationary ?? []).map((p: number, i: number) => [
          `状态 ${i}`,
          pct(p),
        ])}
      />
      <details open>
        <summary>瞬态分布 · {result.transient?.length ?? 0} 个时刻</summary>
        <Table
          heads={[
            "时间",
            "期望奖励",
            ...(result.stationary ?? []).map(
              (_: number, i: number) => `状态 ${i} 概率`,
            ),
          ]}
          rows={(result.transient ?? [])
            .slice(0, 50)
            .map((i: any) => [
              num(i.time, 6),
              num(i.reward, 6),
              ...i.probabilities.map(pct),
            ])}
        />
        {result.transient?.length > 50 && (
          <p className="note">
            展示前 50 个时刻；完整数据可查看计算详情或下载报告。
          </p>
        )}
      </details>
      <p className="note">
        使用指数停留时间与恒定转移率；稳态分布要求唯一。奖励与时间的单位由输入定义，不能自动解释为训练正确交付。
      </p>
    </>
  );
}
function ResultBody({
  result,
  onApplyAudit,
  onApplyCandidate,
}: {
  result: any;
  onApplyAudit?: ResultViewProps["onApplyAudit"];
  onApplyCandidate?: ResultViewProps["onApplyCandidate"];
}) {
  if (result?.kind === "expert-review-audit")
    return <AuditResult result={result} onApply={onApplyAudit} />;
  if (result?.statistics && result?.ledger) return <Training result={result} />;
  if (result?.contributions) return <Attribution result={result} />;
  if (result?.status && searchNames[result.status])
    return <Search result={result} onApplyCandidate={onApplyCandidate} />;
  if (result?.base?.statistics && result?.items)
    return <Comparison result={result} onApplyCandidate={onApplyCandidate} />;
  if (result?.stationary) return <Ctmc result={result} />;
  if (finite(result?.probability)) return <Static result={result} />;
  if (result?.items && result?.method) return <Allocation result={result} />;
  if (finite(result?.availability))
    return (
      <>
        <div className="metrics">
          <Metric name="稳态系统可用度" value={pct(result.availability)} />
          <Metric name="无中断任务可靠度" value={pct(result.taskReliability)} />
          <Metric name="任务时长（小时）" value={num(result.hours)} />
        </div>
        <Table
          heads={["模块", "稳态可用度", "任务可靠度", "平均修复时间（小时）"]}
          rows={(result.items ?? []).map((i: any) => [
            i.id,
            pct(i.availability),
            pct(i.taskReliability),
            num(i.mttr),
          ])}
        />
      </>
    );
  if (finite(result?.fit))
    return (
      <>
        <h3>故障率估计</h3>
        <div className="metrics">
          <Metric name="点估计（FIT）" value={num(result.fit)} />
          <Metric name="观察到的事件数" value={num(result.events, 0)} />
          <Metric name="实测暴露（小时）" value={num(result.exposureHours)} />
        </div>
        <p>
          零事件单侧上界：{num(result.upperFit)}{" "}
          FIT。零事件不等于零故障率；非零事件精确区间当前未提供。
        </p>
      </>
    );
  return (
    <p className="note">
      计算已完成。此工具的完整结构化结果可在下方计算详情中查看。
    </p>
  );
}
function Snapshot({
  run,
  result,
  warnings,
}: {
  run: Run;
  result: any;
  warnings: any[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>输入快照、模型版本、来源与详细计算</summary>
      <p className="note">
        运行输入是发起计算时的快照，后续设计编辑不会改变这次结果。
      </p>
      {open && (
        <pre>
          {pretty({
            inputHash: run.inputHash,
            input: run.input,
            modelVersion: result?.modelVersion,
            source: result?.config?.sourceCommit,
            assumptions: result?.assumptions ?? result?.details?.assumptions,
            warnings,
            result,
          })}
        </pre>
      )}
    </details>
  );
}
export default function ResultView({
  run,
  onApplyCandidate,
  onApplyAudit,
}: ResultViewProps) {
  const { url } = useTaskApi();
  if (!run) return null;
  const succeeded = run.status === "succeeded",
    result = succeeded ? run.result : undefined;
  const warnings = result?.warnings ?? [];
  return (
    <section className="paper result" aria-label="评估结果">
      <div className="section-head">
        <div>
          <span className="eyebrow">评估 / {run.id.slice(0, 8)}</span>
          <h2>
            计算结果 <small>{statusNames[run.status] ?? run.status}</small>
          </h2>
        </div>
        {succeeded ? (
          <a
            className="button"
            href={url(`/runs/${encodeURIComponent(run.id)}/report?format=html`)}
            download
          >
            <Download size={15} />
            下载报告
          </a>
        ) : (
          <button disabled type="button" title="成功完成计算后可下载报告">
            <Download size={15} />
            完成后下载报告
          </button>
        )}
      </div>
      {run.error && (
        <p className="error" role="alert">
          {run.error.message} <small>（{run.error.code}）</small>
        </p>
      )}
      {!succeeded && (
        <p className="note">
          {run.status === "running" || run.status === "queued"
            ? "结果将在计算成功完成后显示。"
            : run.status === "cancelled"
              ? "本次计算已取消，未形成可导出的完整结果。"
              : "本次计算未成功，请根据错误信息修改输入后重试。"}
        </p>
      )}
      {result && (
        <ResultBody
          result={result}
          onApplyCandidate={onApplyCandidate}
          onApplyAudit={onApplyAudit}
        />
      )}
      <Snapshot run={run} result={result} warnings={warnings} />
      <details>
        <summary>运行事件 · {run.events?.length ?? 0} 条</summary>
        <Table
          heads={["序号", "阶段 / 类型", "时间", "内容"]}
          rows={(run.events ?? []).map((e) => [
            e.sequence,
            `${e.stepId} / ${e.type}`,
            e.createdAt,
            pretty(e.payload),
          ])}
        />
      </details>
      {result?.diagnostics?.trace && (
        <details>
          <summary>
            示例训练轨迹 · {result.diagnostics.trace.length} 条
            {result.diagnostics.traceTruncated ? "（有限前缀）" : ""}
          </summary>
          <p className="note">
            样本种子 {result.diagnostics.traceSeed}；展示时间范围 0 ～{" "}
            {num(result.diagnostics.traceHours)} 小时。
          </p>
          <Table
            heads={[
              "时间（小时）",
              "事件",
              "计算进度",
              "正确进度",
              "活跃卡数",
              "污染状态",
            ]}
            rows={result.diagnostics.trace.map((t: any) => [
              num(t.t, 6),
              t.kind,
              num(t.progress),
              num(t.correct),
              num(t.activeCards, 0),
              t.corrupt ? "存在污染" : "干净",
            ])}
          />
        </details>
      )}
    </section>
  );
}

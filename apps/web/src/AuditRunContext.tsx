import AuditRanking from "./AuditRanking";
import {
  auditSelectedMechanisms,
  auditSamplingDescription,
} from "../../../packages/reports/src/audit-context";
export default function AuditRunContext({
  result: r,
  cards,
  open,
}: {
  result: any;
  cards: number;
  open: boolean;
}) {
  const selected = auditSelectedMechanisms(r),
    allocation = r.allocationPlan?.submodel;
  return (
    <details className="audit-run-context" open={open}>
      <summary>
        本次输入、组合与计算口径{" "}
        <small>冻结快照 · 范围、故障、分配、措施与采样</small>
      </summary>
      <div className="run-context-grid">
        <section className="run-context-card">
          <header>
            <span>01</span>
            <h4>评估范围</h4>
          </header>
          <dl>
            <div>
              <dt>主规模</dt>
              <dd>{r.request.cards.toLocaleString()} 卡</dd>
            </div>
            <div>
              <dt>评估窗口</dt>
              <dd>{r.request.hours} h</dd>
            </div>
            <div>
              <dt>可用度目标</dt>
              <dd>{(r.request.target * 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt>本次查看</dt>
              <dd>{cards.toLocaleString()} 卡</dd>
            </div>
          </dl>
          <p className="note">
            指标为窗口结束时保留的正确进度 / 评估窗口，计算口径不变。
          </p>
        </section>
        <section className="run-context-card">
          <header>
            <span>02</span>
            <h4>故障与基线</h4>
          </header>
          <p>
            {r.events.length} 个故障模式 ·{" "}
            {
              r.events.filter((e: any) => e.evidence === "internal-measured")
                .length
            }{" "}
            项观测数据
          </p>
          <p className="note">
            中断、亚健康、静默分别保留来源与 FIT；已解决条件固定用于每个方案。
          </p>
          {r.rankings && (
            <details>
              <summary>查看冻结条件与剩余机制排序</summary>
              <AuditRanking result={r} cards={cards} />
            </details>
          )}
        </section>
        <section className="run-context-card">
          <header>
            <span>03</span>
            <h4>目标分配</h4>
          </header>
          <p>
            {r.allocationPlan?.lossBudgets.find((b: any) => b.cards === cards)
              ?.basis ?? "未记录损失预算"}
          </p>
          <p className="note">
            {r.optimization
              ? "第一轮固定现状；第二轮按各规模贡献与缺口分配。实际预算、参数及复评见“两轮决策”。"
              : "预算在措施评估前冻结；实际损失在“结论概览”核对。"}
          </p>
          {r.optimization && (
            <p>
              第二轮：
              {r.optimization.status === "evaluated"
                ? r.optimization.chosenName
                : r.optimization.reason}
            </p>
          )}
          {allocation && (
            <details aria-label="本次目标分配产物">
              <summary>查看对象子目标 · {allocation.selected.method}</summary>
              <p className="note">{allocation.scope}</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>方法</th>
                      <th>对象</th>
                      <th>子目标</th>
                      <th>回合成</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocation.comparisons.flatMap((p: any) =>
                      p.items.map((item: any) => (
                        <tr key={p.method + item.id}>
                          <td>{p.method}</td>
                          <td>{item.name}</td>
                          <td>{(item.target * 100).toFixed(4)}%</td>
                          <td>
                            {(p.recomposition.achieved * 100).toFixed(4)}%
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </section>
        <section className="run-context-card">
          <header>
            <span>04</span>
            <h4>实际启用措施</h4>
          </header>
          <p>{selected.map((m) => m.name).join("、") || "仅基线"}</p>
          <details>
            <summary>查看 {selected.length} 项措施与参数</summary>
            <p className="note">
              推荐候选不会自动替换本次组合；常规检查点与人工兜底已在基线中。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>措施</th>
                    <th>名称</th>
                    <th>本次参数</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((m) => (
                    <tr key={m.id}>
                      <td>{m.code}</td>
                      <td>{m.name}</td>
                      <td>{m.parameters}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.referenceComparison?.differences.length > 0 && (
              <aside>
                <h5>与专家原始配置的差异</h5>
                <ul>
                  {r.referenceComparison.differences.map((d: string) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </aside>
            )}
          </details>
        </section>
        <section className="run-context-card run-context-sampling">
          <header>
            <span>05</span>
            <h4>计算与复核口径</h4>
          </header>
          <p role="note" className="note">
            {auditSamplingDescription(r)}
          </p>
          <p className="note">
            恢复顺序：
            {(r.config.recoveryOrder ?? [])
              .map(
                (id: string) =>
                  ({
                    replay: "重执行",
                    elastic: "弹性恢复",
                    process: "进程重调度",
                  })[id] ?? id,
              )
              .join(" → ")}
            。Shapley 使用组合加入顺序分摊收益。
          </p>
        </section>
      </div>
    </details>
  );
}

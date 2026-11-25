import { useState } from "react";
import {
  calibrateBaseline,
  novemberReferenceScenario,
  targetAtScale,
} from "../../../../packages/core/src/index";
import { useWorkbench } from "./Workbench";
import { NumberField, Disclosure } from "./ui";
import { duration, percent } from "./format";

export default function ReferenceRequirements() {
  const { model, analysis, update } = useWorkbench(),
    [error, setError] = useState("");
  const r = model.requirements;
  if (!r)
    return (
      <section className="rw-card" aria-label="已知现状与固定目标">
        <div className="rw-card-head">
          <h2>已知现状与固定目标：2026-11-19 约束研究场景</h2>
          <button
            className="rw-button"
            onClick={() => {
              if (
                window.confirm(
                  "载入后会用 2026-11-19 的约束研究场景替换当前任务的全部参数（故障模式、措施和目标）。继续？",
                )
              )
                update((d) => Object.assign(d, novemberReferenceScenario()));
            }}
          >
            载入本轮约束场景
          </button>
        </div>
        <p className="rw-hint">
          可选。那一轮研究的输入是域级的已知现状：50 万卡网络单独
          63%、非网络合计 60%；系统目标 95%、网络 98%、供电与冷却
          99.999%。载入后先冻结这些域级目标，再分配剩余预算，并按域现状反求未知的中断恢复时长。它使用当时的措施库和恢复参数，与当前默认场景是两套独立的输入。
        </p>
      </section>
    );
  return (
    <section className="rw-card" aria-label="已知现状与固定目标">
      <h2>先固定已知约束，再分配剩余预算</h2>
      <p>
        参考规模 {r.referenceCards.toLocaleString()}{" "}
        卡。网络与供电目标先冻结；剩余损失负荷按所选方法分配，网络内部再按同一方法分到部件。当前采用固定窗口损失负荷的AGREE工程适配。
      </p>
      <div className="rw-table-wrap">
        <table className="rw-table">
          <thead>
            <tr>
              <th>独立评估范围</th>
              <th>已知现状（参考规模）</th>
              <th>固定目标（参考规模）</th>
              <th>当前规模现状</th>
              <th>当前规模设计后</th>
            </tr>
          </thead>
          <tbody>
            {r.domains.map((domain, i) => {
              const result = analysis.requirements.find(
                (v) => v.id === domain.id,
              )!;
              return (
                <tr key={domain.id}>
                  <th>{domain.name}</th>
                  <td>
                    {domain.baselineAvailability === null ? (
                      "由部件模型评估"
                    ) : (
                      <NumberField
                        label={`${domain.name}参考现状（%）`}
                        factor={100}
                        value={domain.baselineAvailability}
                        min={0.001}
                        max={1}
                        digits={3}
                        onCommit={(v) =>
                          update((d) => {
                            d.requirements!.domains[i].baselineAvailability = v;
                          })
                        }
                      />
                    )}
                  </td>
                  <td>
                    {domain.targetAvailability === null ? (
                      "当前规模分配 " + percent(result.allocatedTarget, 5)
                    ) : (
                      <NumberField
                        label={`${domain.name}固定目标（%）`}
                        factor={100}
                        value={domain.targetAvailability}
                        min={0.001}
                        max={1}
                        digits={5}
                        onCommit={(v) =>
                          update((d) => {
                            d.requirements!.domains[i].targetAvailability = v;
                          })
                        }
                      />
                    )}
                  </td>
                  <td>{percent(result.baseline.availability, 5)}</td>
                  <td>
                    {percent(result.design.availability, 5)}{" "}
                    {result.target !== null
                      ? result.met
                        ? "达标"
                        : "未达标"
                      : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rw-hint">
        这些域级数字是已知输入。部件恢复段由域级约束反求，保留FIT、检出率、48小时漏检分支和检查点周期；域内拆分仍依赖现有故障库先验。63%与60%不能作为整系统60%再次使用。
      </p>
      <button
        className="rw-button"
        onClick={() => {
          try {
            const next = calibrateBaseline(model);
            update((d) => Object.assign(d, next));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        按已知现状重新校准恢复段
      </button>
      {error && (
        <p className="rw-alert is-bad" role="alert">
          {error}
        </p>
      )}
      <Disclosure title="规模折算与校准记录">
        <p>
          固定开销预算 o={percent(r.overheadBudget, 4)}；目标损失负荷ρ*=(1−o)/
          {percent(r.systemTarget)}−1。规模N目标为 A*(N)=(1−o)/(1+ρ*×N/
          {r.referenceCards}
          )。保留固定检查点成本，故障负荷随卡数线性变化；未增加重复代际倍率。
        </p>
        <label>
          固定公共开销预算{" "}
          <NumberField
            label="固定公共开销预算（%）"
            value={r.overheadBudget}
            factor={100}
            min={0}
            max={0.5}
            digits={5}
            onCommit={(v) =>
              update((d) => {
                d.requirements!.overheadBudget = v;
                d.scenario.target = targetAtScale(d, d.scenario.cards);
              })
            }
          />
        </label>
        <div className="rw-table-wrap">
          <table className="rw-table">
            <thead>
              <tr>
                <th>故障模式</th>
                <th>原恢复段</th>
                <th>校准恢复段</th>
                <th>依据</th>
              </tr>
            </thead>
            <tbody>
              {r.calibration.map((c) => (
                <tr key={c.modeId}>
                  <td>
                    {model.modes.find((m) => m.id === c.modeId)?.name} ·{" "}
                    {c.modeId}
                  </td>
                  <td>{duration(c.beforeRecoveryHours)}</td>
                  <td>{duration(c.afterRecoveryHours)}</td>
                  <td>{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </section>
  );
}

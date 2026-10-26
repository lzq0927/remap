import type { AuditRequest } from "../../../packages/analysis/src/audit";
import {
  auditScalePresets,
  auditSummaryScales,
} from "../../../packages/contracts/src/audit-presets";
import {
  trainingRecoveryBudget,
  type TrainingScenario,
} from "../../../packages/contracts/src/audit-training-scenario";
import {
  auditNumber as num,
  auditPercent as pct,
  recoveryBudget,
} from "../../../packages/contracts/src/audit-recovery-budget";

export default function AuditRecoveryBudget({
  request,
  scenario,
}: {
  request: AuditRequest;
  scenario?: TrainingScenario;
}) {
  const cards = auditSummaryScales(request, [
    request.cards,
    ...(request.scales ?? []),
  ]).filter(
    (c) =>
      c !== 1000 ||
      request.cards === 1000 ||
      request.targets?.[c] !== undefined,
  );
  return (
    <section aria-label="目标与等效MTTR核算" className="recovery-budget">
      <h4>目标 → MTBF → 等效 MTTR 预算</h4>
      <p>
        MTTR = MTBF × (1−A) / A。总损失预算 = {scenario ? 600 : request.hours}{" "}
        小时 × (1−A)。检测、恢复、回滚、静默、亚健康及公共开销共同占用损失预算。
      </p>
      <p>同一目标线对比各技术阶段的结果：技术增强后，小规模可用度可以高于98.5%，更大规模也需达到98.5%。实际结果不会封顶到目标值。</p>
      <p className="recovery-budget-scroll-hint">
        左右滑动表格，查看 MTTR 预算和参考值。
      </p>
      <div className="table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>规模</th>
              <th>参考 MTBF</th>
              <th>正式目标</th>
              <th>目标等效 MTTR / 秒</th>
              <th>损失预算 / 小时</th>
              {scenario && (
                <>
                  <th>场景参考可用度</th>
                  <th>参考值折算 MTTR / 秒</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => {
              const target =
                c === request.cards
                  ? request.target
                  : (request.targets?.[c] ?? request.target);
              const scenarioBudget = scenario
                ? trainingRecoveryBudget(scenario, c, target)
                : null;
              const b =
                scenarioBudget?.target ??
                recoveryBudget(
                  auditScalePresets.find((p) => p.cards === c)?.hardMtbfHours ??
                    null,
                  target,
                  request.hours,
                );
              return (
                <tr key={c}>
                  <th>{num(c, 0)} 卡</th>
                  <td>
                    {b.mtbfHours == null
                      ? "待提供"
                      : b.mtbfHours >= 1
                        ? `${num(b.mtbfHours)} 小时`
                        : `${num(b.mtbfHours * 60)} 分钟`}
                  </td>
                  <td>{pct(target)}</td>
                  <td>{num(b.equivalentMttrSeconds, 1)}</td>
                  <td>{num(b.lossHours)}</td>
                  {scenario && (
                    <>
                      <td>{pct(scenarioBudget?.reference?.availability)}</td>
                      <td>
                        {num(
                          scenarioBudget?.reference?.equivalentMttrSeconds,
                          1,
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        等效 MTTR
        是同口径运行/损失周期下的目标换算，不是某一恢复阶段的时限，也不直接替换仿真参数。
        {scenario
          ? "模板跨规模按同范围线性暴露折算；所选中断范围不一定覆盖全系统，真实数量缩放及其他故障由正向评估核算。场景参考值只用于对照，不是正式目标或计算结果。"
          : "万卡、十万卡、二十万卡、五十万卡默认采用共同最低目标98.5%。历史结果保留当时目标，修改后需要重新评估。"}
      </p>
    </section>
  );
}

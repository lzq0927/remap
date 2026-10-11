import { useEffect, useState } from "react";
import { allocateTrainingLoss } from "../../../packages/allocation/src/loss-budget";
export default function TargetBudget({
  target,
  hours,
  openMethods,
  saveBudget,
  confirmedBudget,
}: {
  target: number;
  hours: number;
  openMethods: () => void;
  saveBudget: (budget: any) => void;
  confirmedBudget?: any;
}) {
  const [weights, setWeights] = useState([1, 1, 1, 1]);
  useEffect(() => {
    const values = confirmedBudget?.items?.map((i: any) => i.weight);
    if (
      values?.length === 4 &&
      values.every((v: any) => Number.isFinite(v) && v >= 0) &&
      values.some((v: number) => v > 0)
    )
      setWeights(values);
  }, [confirmedBudget]);
  const names = [
    "检测与恢复停顿",
    "检查点与回滚",
    "容量与亚健康",
    "污染与交付清零",
  ];
  if (
    !Number.isFinite(target) ||
    target < 0 ||
    target > 1 ||
    !Number.isFinite(hours) ||
    hours <= 0
  )
    return (
      <section className="paper">
        <p className="note">请输入 0–1 的目标和正数窗口后分解预算。</p>
      </section>
    );
  const r = allocateTrainingLoss({
    target,
    hours,
    items: names.map((name, i) => ({
      id: String(i),
      name,
      weight: weights[i],
    })),
  });
  return (
    <section className="paper">
      <div className="section-head">
        <h2>目标分解 · 训练损失预算</h2>
        <button onClick={openMethods}>选择子模型分配方法</button>
      </div>
      <div className="budget-root">
        <span>
          整体正确交付目标 <strong>{(target * 100).toFixed(3)}%</strong>
        </span>
        <span>
          总允许损失 <strong>{r.totalLossHours.toFixed(2)} 等效小时</strong>
        </span>
      </div>
      <div className="budget-branches">
        {r.items.map((i, index) => (
          <label key={i.id}>
            <span>{i.name}</span>
            <b>{i.lossHoursBudget.toFixed(3)} h</b>
            <small>权重</small>
            <input
              aria-label={i.name + "分配权重"}
              type="number"
              min="0"
              step="1"
              value={weights[index]}
              onChange={(e) => {
                const next = [...weights];
                next[index] = Math.min(
                  1000000,
                  Math.max(0, Number(e.target.value) || 0),
                );
                if (next.some((v) => v > 0)) setWeights(next);
              }}
            />
            <small className="budget-mapping">工程参数映射待确认</small>
          </label>
        ))}
      </div>
      <p className="note">
        这是可调整的设计预算，不是已达成的组件可靠度。需要映射到
        FIT、覆盖率、恢复时间等参数，再用完整模型验证；终态污染可耗尽整个预算。传统方法用于适用子模型。
      </p>
      {confirmedBudget && (
        <p className="note">
          {confirmedBudget.target === target && confirmedBudget.hours === hours
            ? "已保存设计预算；结果将对照预测损失。"
            : "目标或窗口已改变，旧预算已失效，请重新确认。"}
        </p>
      )}
      <button onClick={() => saveBudget({ ...r, target, hours })}>
        保存预算并加入评估输入
      </button>
    </section>
  );
}

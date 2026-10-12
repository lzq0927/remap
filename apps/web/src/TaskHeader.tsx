export default function TaskHeader({
  name,
  scenario,
  runId,
  audit,
  onHome,
}: {
  name: string;
  scenario: string;
  runId?: string;
  audit?: boolean;
  onHome: () => void;
}) {
  return (
    <div className="task-header" aria-label="当前任务">
      <button onClick={onHome}>← 返回任务主页</button>
      <strong>{name}</strong>
      <span>
        {scenario === "training"
          ? audit
            ? "AI 训练 · 专家审核口径"
            : "AI 训练 · 历史模型 V4"
          : "传统硬件 · 结构模型 · 成功概率"}
      </span>
      <span>当前运行：{runId ? runId.slice(0, 8) : "尚未计算"}</span>
    </div>
  );
}

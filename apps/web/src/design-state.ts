export const workflowSteps = [
  {
    id: "clarify",
    name: "确认目标",
    hint: "确认产品、规模、代际、指标与观察窗口。",
    anchor: "design-target",
  },
  {
    id: "describe",
    name: "描述系统",
    hint: "核对结构、故障域、FIT 和影响范围。",
    anchor: "design-system",
  },
  {
    id: "select",
    name: "选择方法",
    hint: "训练先分解损失预算；按适用指标选择子模型方法。",
    anchor: "design-budget",
  },
  {
    id: "prepare",
    name: "准备参数",
    hint: "导入并确认数据，检查证据与机制参数。",
    anchor: "design-mechanisms",
  },
  {
    id: "evaluate",
    name: "求解权衡",
    hint: "执行当前方案，或与基线配对比较并分析收益。",
    anchor: "design-evaluate",
  },
  {
    id: "validate-deliver",
    name: "验证交付",
    hint: "审视采样区间、目标差距和模型限制，保存报告。",
    anchor: "design-result",
  },
];
export const fitLabels = ["HBM", "GPU", "网络", "其他"];
export function editUnboundModel(request: any, model: any) {
  const {
    assetRefs: _refs,
    applicabilityConfirmed: _confirmed,
    ...rest
  } = request;
  return { ...rest, model, assetRefs: [] };
}
export function allocationExample(
  target: number,
  hours: number,
  metric = "task-reliability",
) {
  return {
    method: metric === "steady-state-availability" ? "availability" : "equal",
    metricId: metric,
    target,
    hours,
    items: [
      { id: "compute", name: "计算子模型", baselineRate: 0.00001 },
      { id: "network", name: "网络子模型", baselineRate: 0.00002 },
      { id: "storage", name: "存储子模型", baselineRate: 0.00001 },
    ],
  };
}
export function budgetIsCurrent(budget: any, target: number, hours: number) {
  return !budget || (budget.target === target && budget.hours === hours);
}

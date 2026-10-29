/** One domain contract shared by workflow, native Agent, tools and presentation. */
export const reliabilityStages = [
  {
    id: "target-allocation",
    name: "可用度目标分解分配",
    skill: "remap-target-allocation",
    toolset: "目标分解分配工具集",
    methods: "AGREE / 重要度与复杂度 / 分层损失预算",
    hint: "在950架构上分解各规模目标；记录来源、分配依据及待补证据。",
    anchor: "audit-scope",
    tools: ["allocation_preview", "analysis_solve"],
  },
  {
    id: "availability-assessment",
    name: "可用度评估",
    skill: "remap-availability-assessment",
    toolset: "可用度评估工具集",
    methods: "RBD / FTA / BDD / 事件与损失评估",
    hint: "评估现状并在架构上标出目标差距；结构可用度与训练有效产出分别核算。",
    anchor: "audit-evidence",
    tools: [
      "assessment_run",
      "engineering_validate",
      "engineering_run",
      "engineering_tools",
    ],
  },
  {
    id: "mechanism-design",
    name: "可靠性机制设计",
    skill: "remap-mechanism-design",
    toolset: "可靠性机制设计工具集",
    methods: "Shapley / 机制组合 / 参数反推 / 三阶段损失热力图",
    hint: "根据现有、延长线、突破方案的损失与贡献，提出可验证的参数优化或新增机制。",
    anchor: "audit-mechanisms",
    tools: ["audit_plan", "audit_plan_scales", "audit_compare"],
  },
  {
    id: "mechanism-verification",
    name: "可靠性机制验证",
    skill: "remap-mechanism-verification",
    toolset: "可靠性机制验证工具集",
    methods: "离散事件仿真 / 独立种子 / 置信区间 / 参数与资源条件核验",
    hint: "冻结所选参数进行独立复核；输出达成情况、精确参数及仍待工程验证的条件。",
    anchor: "audit-run",
    tools: ["verification_run", "audit_evaluate", "report_export"],
  },
] as const;
export const reliabilityStepIds = reliabilityStages.map((s) => s.id);
export const isFourPart = (
  state: { steps?: { id: string }[] } | null | undefined,
) => state?.steps?.[0]?.id === "target-allocation";
export const reliabilityAgent = {
  name: "remap",
  description: "ReMAP可靠性设计与评估统一Agent",
  mode: "primary" as const,
  prompt:
    "你是ReMAP唯一的工作流Agent，统一负责可用度目标分解分配、可用度评估、可靠性机制设计、可靠性机制验证。按当前部分加载对应的remap-* Skill，使用本任务绑定的四个专业工具集及共享读写工具。先读task_current、design_get、workflow_state和reliability_capabilities。保留每轮输入/结果；不要创建子Agent，不伪造人工确认。结构可用度、训练可用度、规划预测与已仿真结果分别报告。",
  tools: { task: false },
};

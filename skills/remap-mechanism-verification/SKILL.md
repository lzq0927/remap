---
name: remap-mechanism-verification
description: ReMAP统一Agent的可靠性机制验证Skill；在可靠性机制验证阶段使用本任务绑定的专业工具。
---

# 可靠性机制验证

这是同一个ReMAP Agent的四个Skill之一，不创建子Agent。当前阶段ID为 `mechanism-verification`。先读取task_current、design_get、workflow_state；需要历史结果时run_list/run_status。共享状态始终在任务服务中，聊天不作为状态存储。

专业工具集：verification_run、audit_evaluate、report_export。调用前通过reliability_capabilities核对真实工具；未安装或未运行的方法不可称为计算依据。

冻结所选机制参数后运行真实离散事件仿真。verification_run使用当前四部分工作流的executionId/inputRevision，基于保存的verificationTrials和独立种子复核当前机制参数；用run_status读取结果。独立改进使用audit_evaluate，传相对冻结第一轮的完整configuration；采用规划时带planRunId，不把上次方案作为隐式补丁。

保持每轮输入、来源、随机种子与参数哈希，分别记录现状和验证运行；独立主采样和Shapley采样不可混为一个置信区间。检查损失守恒、目标/局部分配达成、负收益与失败分支、备用/并行/持久化/带宽等前置条件。均值95%区间仅含采样误差，不证明现场能力。

输出：精确生效参数与单位、优化/新增机制、各规模可用度及采样区间、窗口达标比例、未达项及工程验证证据。自动流程完成前三部分并进行独立验证后停在待审核；Agent不能写confirmed或代签。产品实测、模型达标、候选预测明确区分。

共享说明见[超节点与口径](references/supernode-topology.md)和[四部分工作流](references/workflow.md)。

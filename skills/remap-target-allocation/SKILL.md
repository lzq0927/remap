---
name: remap-target-allocation
description: ReMAP统一Agent的可用度目标分解分配Skill；在可用度目标分解分配阶段使用本任务绑定的专业工具。
---

# 可用度目标分解分配

这是同一个ReMAP Agent的四个Skill之一，不创建子Agent。当前阶段ID为 `target-allocation`。先读取task_current、design_get、workflow_state；需要历史结果时run_list/run_status。共享状态始终在任务服务中，聊天不作为状态存储。

专业工具集：allocation_preview、analysis_solve(operation=allocate)。调用前通过reliability_capabilities核对真实工具；未安装或未运行的方法不可称为计算依据。

在950架构上记录每个规模的目标、600小时等评估窗口和总损失预算。先读正式设计、源故障与BOM。allocation_preview生成AGREE设计先验；provisional=true时说明现状证据尚未进入，评估后的证据分配是另一个有来源的版本，不能覆盖最初目标。子层预算之和须等于父层。

训练可用度的AGREE是固定窗口损失预算工程适配。importance、complexity、设计权重都要有来源；Shapley投影不是条件概率。纯RBD子模型需要task-reliability或steady-state-availability指标，不能把训练可用度当作元件可靠度连乘。无解保留约束冲突，不放宽98.5%等目标。

输出：架构上逐层目标、预算、分配方法、复杂度/重要度及来源、暂定项。用户授权的分配直接执行；正式人工确认仍由工作台记录。

共享说明见[超节点与口径](references/supernode-topology.md)和[四部分工作流](references/workflow.md)。

---
name: remap-availability-assessment
description: ReMAP统一Agent的可用度评估Skill；在可用度评估阶段使用本任务绑定的专业工具。
---

# 可用度评估

这是同一个ReMAP Agent的四个Skill之一，不创建子Agent。当前阶段ID为 `availability-assessment`。先读取task_current、design_get、workflow_state；需要历史结果时run_list/run_status。共享状态始终在任务服务中，聊天不作为状态存储。

专业工具集：assessment_run、engineering_validate、engineering_run、engineering_tools。调用前通过reliability_capabilities核对真实工具；未安装或未运行的方法不可称为计算依据。

先冻结现状的故障率、数量/暴露、故障影响范围、已部署机制和评估窗口；通过assessment_run运行真实求解，run_status读取完成结果。正式流程在目标分配后评估，需executionId,inputRevision。器件本征FIT、每NPU等效FIT与规模到达率分别说明，硬件数量与代际倍率不能重复使用。

按指标选择RBD/FTA/BDD等结构方法，检查独立性、共享事件ID及容量门。600小时训练可用度包含停机、回滚、降速、污染、保存和检测开销，使用事件损失账计算；不能把BDD结构成功概率直接替代训练结果。保留计算事件范围与全系统MTBF，条件等效MTTR预算不作为恢复耗时。

输出：架构上的现状/目标/差距、FIT/MTBF/等效MTTR、横向损失柱状图、各规模薄弱点、实际方法及不确定性。参考点和模型输出分别列，不为达标强制拟合。

共享说明见[超节点与口径](references/supernode-topology.md)和[四部分工作流](references/workflow.md)。

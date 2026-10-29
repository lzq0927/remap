---
name: remap-mechanism-design
description: ReMAP统一Agent的可靠性机制设计Skill；在可靠性机制设计阶段使用本任务绑定的专业工具。
---

# 可靠性机制设计

这是同一个ReMAP Agent的四个Skill之一，不创建子Agent。当前阶段ID为 `mechanism-design`。先读取task_current、design_get、workflow_state；需要历史结果时run_list/run_status。共享状态始终在任务服务中，聊天不作为状态存储。

专业工具集：audit_plan、audit_plan_scales、audit_compare。调用前通过reliability_capabilities核对真实工具；未安装或未运行的方法不可称为计算依据。

读取冻结现状结果和适用机制，在同一基线内解释单项、组合与Shapley贡献。现有机制、延长线参数改进、突破新增机制分别建立完整独立配置；用三阶段分层损失热力图对应具体措施与参数，不能把累计组合减损称为单项贡献。

audit_plan以sourceRunId和实际目标生成可追溯建议；多规模分别规划，不拼接最严参数。规划prediction不是已验证可用度。为每个建议写明：作用事件、预防/传播抑制/检测/恢复/检查点/正确性分类、参数及单位、失败分支、正常态开销、资源条件和证据。

有限备用池须说明占用/耗尽/维修补回与拓扑兼容；DP副本不等于机柜；异步检查点同时核验持久化滞后与加载带宽；共因与SDC不能省略。提出确切参数候选后，按用户已授权范围进入验证；未选建议不擅自写回。输出优化或新增机制清单及待验证条件。

共享说明见[超节点与口径](references/supernode-topology.md)和[四部分工作流](references/workflow.md)。

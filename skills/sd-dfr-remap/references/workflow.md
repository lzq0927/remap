# 四部分工作流

同一ReMAP Agent使用四个Skill与四个专业工具集，共享任务、输入版本、运行和证据；不按部分创建子Agent。reliability_capabilities返回实际映射。

| 部分 / ID                               | Skill                         | 输入与专业工具                                                  | 产物                                             |
| --------------------------------------- | ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| 可用度目标分解分配 / target-allocation  | remap-target-allocation       | 目标、架构、BOM；allocation_preview、analysis_solve(allocate)   | AGREE设计分配、逐层预算和来源                    |
| 可用度评估 / availability-assessment    | remap-availability-assessment | 冻结现状；assessment_run、engineering_run                       | 可用度、架构差距、损失及事件证据                 |
| 可靠性机制设计 / mechanism-design       | remap-mechanism-design        | 冻结结果、Shapley；audit_plan、audit_plan_scales、audit_compare | 现有/延长线/突破的机制、收益、候选参数和资源条件 |
| 可靠性机制验证 / mechanism-verification | remap-mechanism-verification  | 所选完整参数；verification_run、audit_evaluate、report_export   | 独立DES快照、达成、区间、精确参数、未达项        |

workflow_start基于当前inputRevision启动；workflow_save带executionId、expectedRevision、inputRevision、stepId。Agent能保存running/awaiting-review/failed，不能confirmed；auto-to-review模式前三部分可completed，最终验证需人工审核。workflow_automatic先评估保存的配置，再从实际Shapley整理机制依据，然后以保存的verificationTrials和独立种子复核同一参数；不会暗中采纳尚未选择的新增建议。

RBD/BDD按结构指标求解；固定窗口训练可用度需要停机、回滚、降速、污染和正常态开销的逐事件账本。AGREE设计先验未包含运行证据时明确provisional；评估后的证据分配另存，不覆盖最初目标。后续优化方案用独立计划/运行，而非覆盖第一轮。

输入变化按最早受影响部分重新核验；原始六阶段执行保留原ID和历史事件，新建专家评估工作流使用四部分。旧任务不能通过映射状态伪造新部分已确认。

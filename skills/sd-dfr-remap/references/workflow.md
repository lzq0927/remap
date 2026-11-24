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

## 四步工作台（默认界面）

界面默认进入四步工作台，四步共用一份模型：架构模块 → 故障模式 → 可靠性措施。Agent 通过四个工具读写同一份模型，结果与界面一致：

| 步骤       | 工具                            | 说明                                                                                                                         |
| ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 目标分配   | core_model_get、core_model_save | 改 `scenario.targetCurve`（规模—目标）、模块的 `fixedTarget`（单独指定）、`allocation.method` 及复杂度、重要度               |
| 可用度评估 | core_analysis                   | `baseline` 为现状：各模块 FIT、每周故障次数、等效 MTTR、可用度、每周损失；`baselineGaps` 为差距；`consequences` 为高后果模块 |
| 机制设计   | core_model_save、core_analysis  | 改 `measures`；`contributions` 为 Shapley 贡献，`recommendation` 为推荐方案                                                  |
| 机制验证   | core_verify                     | 独立离散事件仿真；返回逐项判定 `checks` 与结论 `verdict`                                                                     |

口径：A = (1 − 公共开销) / (1 + ρ)，ρ = Σ λᵢ·MTTRᵢ，每周损失 = 故障频次 × 单次等效损失；分配、评估、设计都在 ρ 上进行，方法说明见 docs/2026-11-17-四步工作台重构.md。模型里的 `modes` 是故障模式库、`measures` 是可靠性措施库、`groups` 与 `modules` 是架构。模块的 `scaling` 取 per-card（数量随卡数增长）或 fixed（全系统固定，如机房供配电），`fixedTarget` 非空表示单独指定目标，`anchor` 是它在系统架构图上的位置（aicore / npu / hbm / node / l1 / l2 / optical / storage / power / site-power / management / software，留空表示不画在图上）。故障模式的 `ladder` 是恢复阶梯，从小到大五级 replay / process / elastic / restart / manual，每级有 `success`、`hours`、`failHours`、`impact`、`rollback`，`success` 为 0 表示不走这一级；`lateDetectHours` 是漏检后多久被发现。措施的 `category` 取 prevent（组件级高可用）或 detect / recover / contain / checkpoint（系统级可靠性机制），`applicability` 是适用比例（0–1），`effects[].op` 取 reduce / set / add，`effects[].param` 可以是基本参数或 `级别.字段`（如 `elastic.success`）。保存模型前先读取，再在原模型上修改；每个故障率和恢复参数写明来源，措施的 `evidence` 如实填写 verified / planned / assumed。仿真通过只说明“参数成立时可以达标”。上表四个工具不改变经典工作台（专家模式）的六阶段或四部分执行记录。

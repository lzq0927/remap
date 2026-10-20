# 系统分层目标、现状诊断与改进追溯

新任务默认硬件主视图；数量、传播与规模FIT见[hardware-architecture.md](hardware-architecture.md)。下文功能模板与没有新增字段的历史结果继续兼容。

## 架构输入

`assessment.input.architecture`保存version/name/basis/budgetMethod/nodes/dependencies。节点含id/name/parentId/kind/eventIds/weight/importance/source，可用scaleWeights按卡数覆盖权重。model_defaults.audit返回可编辑的功能分组模板；不是已核实的部署拓扑。仅一个system根节点和一个overhead叶节点；故障只能归属一个叶节点，父层汇总。未映射故障保留在“未归属故障”，禁止为消除缺口而删掉它们。

第二步保存架构结构与故障归属；第三步确认分层预算。budgetMethod=none/equal/weighted/agree；默认equal只是暂定参照。总预算B=(1-A目标)×窗口，沿每层同级分解，父子预算守恒。agree是AGREE的有限窗口损失预算适配，不是把主指标当任务可靠度串联相乘。不同规模目标与权重独立；参考规模无需求预算。修改结构从第二步复核，修改预算从第三步复核；保留前面未变的人工确认。

包含关系与共同依赖分别保存；dependencies不自动新增共因事件、串并联假设或收益。若要分析冗余/传播，需要确认故障域、冗余逻辑、暴露量及相应求解模型，不能从图中臆造。

## 第一轮读取

`run_status.result.architectureDiagnosis`含architecture/scales/notes。每个scale含目标、总损失、允许损失、residualHours、nodes、weaknesses和ranking。nodes父层仅汇总；核对叶层实际与预算总和，不能把全部层相加。保存阻塞与检测/机制常态开销在overhead独立计账。

types按hard/slow/sdc显示fit/rate/intervalHours。当前专家评估FIT以NPU等效业务影响事件为单位，λ=卡数×本规模等效FIT/10^9，只乘一次暴露量；显式数量模型先做参考配置外推，不能混入物理器件FIT再乘硬件数量。hard表示中断事件间隔，不能冒充已观测业务中断MTBF；其他是对应事件间隔。零FIT是输入假设，不是已证实无风险。

recoveryPauseSeconds=事件账停机/恢复次数，包含检测、失败回退、有限窗口截断；不是完整物理修复MTTR或所有局部修复时长。equivalentLossSeconds还含回滚、污染、降速及局部损失。未观察到事件/恢复时为null，不能报成0秒恢复。主可用度仍为保留的正确进度/窗口理想产出，不用两状态A公式替代完整仿真。

weaknesses按叶层预算差距排序，未分配时按实际损失排序；零损失样本不证明零风险。架构图、规模×子系统热力图、各规模贡献条形图用于解释不同薄弱点和排序。超预算比较样本均值，不能声称层级差异已有统计显著性。

## 分配与独立改进

`audit_plan`保留第一轮架构及原分层目标，输出`allocations[].layerLinks`。在每个故障且能改善对应损失项的机制内按正Shapley归一化分担实际损失责任；例如检查点不领取恢复停机责任。叶层参考预算按FIT份额及该故障类型内损失项均分细分，公共开销单列。无法覆盖的设计责任标记unaddressed，不冒充机制，不强行分给无关措施。responsibilityResidualHours核对工程责任总和。

AGREE再按重要度分配允许责任损失，条件响应与总可用度正向约束反推具体参数。现状贡献高不等于继续改善收益高：还需考虑改善空间、适用比例、失败升级和正常态成本。layerLinks的工程责任不是物理独立损失或新Shapley贡献，不与故障损失重复相加；分层预算也是设计参照，不要求每项独立硬达标。

用户另行执行audit_evaluate后，得到本轮新的architectureDiagnosis与增量Shapley。显式FIT方案或专家筛查改变的残余事件率仅影响本轮；第一轮不回写。比较报告保留各轮架构薄弱点、各规模曲线与独立排名。历史运行没有分层快照时说明未记录，不能伪造历史已确认架构。

跨规模展示顺序、目标/差距曲线、损失时间横柱、贡献排名及独立改进集合见[scale-summary.md](scale-summary.md)。

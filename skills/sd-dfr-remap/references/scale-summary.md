# 跨规模汇总与独立改进建议

所有汇总按需求规模从小到大展示；AI样例为万卡、十万卡、二十万卡、五十万卡。无需求目标的参考点另列，不抢占主趋势，也不参与达标判断。保持冻结输入的计算顺序和种子，展示排序不改变数值。

按以下链路解释结果：

1. 架构层级与目标分解：同级允许损失汇总到上级；允许损失=(1−目标)×窗口，不把某层损失预算冒充模块自身可用度。工作台可选择上级节点查看子层预算，并查看任一层的目标损失与实际损失趋势。
2. 总体趋势：同一图绘制各规模自己的目标和现状可用度，显示目标−本轮的百分点差距。总指标显示95%均值区间；分层数据没有轨迹方差时不捏造区间。
3. 细分故障差距：按故障模式库将叶层参考预算按本叶FIT份额进一步划分，仅作为诊断参照。逐规模独立按超预算排序，未分配时按实际损失排序；保存和检测开销单列，不重复算成根故障。
4. 损失时间横柱图：按损失环节、子系统或故障类型汇总，每规模一条，同一小时刻度，红线为允许损失。核对互斥分量之和等于本轮总损失；等效产出损失时间不是完整物理MTTR。
5. 贡献汇总：一张排名变化图对比各规模，另看带95%区间的贡献值曲线与数值矩阵。保留负贡献、并列和缺失证据；现状Shapley和改进增量有不同基准，分别解释。
6. 进一步分配：结合本规模薄弱点、机制适用故障及损失项、第一轮贡献形成重要度，再用AGREE与总目标条件响应反推改进要求。不能直接把高现状贡献视为更大的追加改善空间。

## 分别生成各规模方案

`audit_plan_scales({body:{sourceRunId,scales?,options?}})`：省略scales时选择全部有需求目标的已计算规模；可指定部分。options支持screeningTrials、importance（规模→机制→重要度）、parameterTargets等；不使用单一planningCards。返回runId，用run_status读取`kind=expert-audit-plan-set`，`plans`升序，每项保留prediction、allocations、factors和configuration。总工作量受限。

每个规模独立求解并汇总措施、现状值、要求值及来源，不合成最严共同参数。`scenarioEvaluated=false`，规划值不带正式复评置信区间，不能冒充已完成的第二轮或实测。曲线上的各规模改进点采用不同配置，也不能称为一个方案的跨规模曲线。

用户选定某规模且要求评估后，调用：

```text
audit_evaluate({body:{sourceRunId,name,planRunId:planSet.id,planCards:selected.prediction.cards,configuration:selected.configuration}})
```

planCards必填且必须属于该计划。使用同一第一轮冻结证据，独立评估会同时检查原任务中的其他规模，不能只取规划目标规模报喜。改进结果记录planningRunId/planningCards；迭代保留关联并使用本次完整configuration。各轮独立结果才能进入audit_compare，计划集合不能参与已评估结果比较。

如果本次MCP缺少audit_plan_scales，可对每个明确需求规模分别调用audit_plan(options.planningCards)，保留独立运行和来源；不要因此自动启动audit_evaluate。推荐使用MCP0.3.1与Skill0.3.3，保持计划选择和汇总报告一致。

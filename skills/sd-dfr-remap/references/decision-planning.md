# 有边界的分配与备选方案

MCP/Skill 0.4.0。先读取同任务的冻结第一轮和原参数。audit_plan / audit_plan_scales 的 options.planning 是本次规划设置，不写回现状。主指标仍为training.retained-clean-progress；经典任务可靠度与串联可用度是独立子模型。

## 规划输入

- method: agree / equal / arinc / feasibility / minimum-effort / cost，均指工程责任小时预算适配，不能宣称是传统模块故障率分配结果。默认agree；重要度是正Shapley映射到0.2～1的可编辑工程优先级，不是系统失效条件概率。complexity、feasibility按第一轮机制ID（如fast）设置；budgetBounds同样按机制ID，可含unaddressed。
- bounds: [{path,min?,max?,locked?,source}]，source必填。路径由冻结config派生：model.recoveryAttemptSeconds、policy.D-SDC.coverage、extension.D-ABFT.coverage等。概率使用0～1，时间沿用原字段秒/小时；锁定值不参与搜索松弛。扩展参数边界不会自动部署该措施。
- budgetBounds: {id:{min?,max?,locked?,source}}，单位为损失小时；固定及下限优先扣除。约束对每个需求规模分别检查；批量共用约束可能在小规模冲突，不得自动放宽。
- costs: {id:{a,b,source}}，每项责任成本资料完整才可使用cost。资料缺失时显示不可用，不能填默认真实价格。
- effort: 参数块或扩展ID→相对工作量评分（policy:D-SDC、model:recovery、D-ABFT等）。缺省每块1分，仅用于本次候选相对比较。
- objective: effort或margin；maxCandidates:8～64，缺省32。有限离散组合比较不保证连续参数全局最优。
- conservative: {enabled?,probabilityDelta?,timeFactor?,unknownOverhead?,require?,source?}。缺省启用探索压力情景，概率减0.005、时延与开销乘1.2；缺失来源的扩展零开销按0.001压力值。缺省require=false，不擅自增加用户达标条件；require=true时选方案同时检查保守情景。锁定参数保持不变。压力幅度是工程假设，不是概率分布或统计区间，必须按实际设置解释。

## 读取和选择

run_status返回decisionStudy，含settings、search、weightEvidence、constraints、leverDiagnostics、assumptionGaps、alternatives、pareto、baselineCurves及conservative。先解释冻结现状、各规模目标、现状损失与分配责任，再说明参数要求和剩余缺口。

alternatives[].configuration是相对第一轮的完整方案，含其factors、工作量、规划均值、保守情景、固定配置的跨规模曲线。推荐ID为recommendedId；每条曲线使用同一配置。每规模独立建议形成的点不能当作一套配置的曲线。保留负贡献与互补/替代，不把全选当作性能上界。necessary仅表示本次筛选样本、已评估离散组合中的交集，不代表所有可能方案的必需机制。

单类杠杆只检验列出的参数点；not-found不等于证明不可达。预算上界、故障归属和工程责任都是设计参照，不能相加重复算损失。

用户明确选择方案并要求评估后调用：

audit_evaluate({body:{sourceRunId,name,planRunId,planCards?,planAlternativeId:chosen.id,configuration:chosen.configuration}})

来自plan-set时planCards必填。自行修改参数后仍提交完整configuration，报告标明人工调整；不得替换原计划或第一轮。正式结果保存planningAlternativeId、独立增量Shapley和各规模结论，再用audit_compare比较已完成结果。生成计划、压力情景或规划曲线不会自动启动正式第二轮。

均值95%区间只包含采样误差；窗口达标比例及其Wilson区间、参数压力情景是三种不同证据，不能混为“95%达标”。导出报告保持同一数据口径，历史计划没有decisionStudy时按原结果解释。

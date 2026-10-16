# 独立轮次的工具调用与恢复

全部工具采用 `{id?,revision?,query?,body?}`，连接绑定当前任务。工具返回真实runId后轮询run_status；失败保留记录并解释诊断，不能伪造成功。操作只读或普通评估有用户明确指令即可执行；阶段签认仍在工作台完成。

## 查找并冻结第一轮

先读取task_current/design_get/workflow_state。已有第一轮用run_list({query:{operation:'audit',limit:'20'}})查找，再run_status核对已完成、kind=expert-review-audit、目标、证据和措施。不要一律取最新ID：用户可能指定历史第一轮，且当前草稿可能已改变。run_list支持sourceRunId筛选同一研究系列；run_status读取完整输入/结果，摘要不代替证据。

没有第一轮时按当前六阶段运行analysis_solve，或在用户明确授权全自动后workflow_automatic；使用完整assessment.input。现状使用已保存的措施与参数，不提前载入改进要求，也不启用旧自动双轮optimization。完成后先给本轮结论和报告。读取architectureDiagnosis.scales，按各规模解释nodes的actualHours/allowedHours/excessHours、types的中断MTBF与其他事件间隔、恢复停机及损失来源；不把父层与子层再次相加。

## 只生成分配建议

```json
{"body":{"sourceRunId":"<第一轮ID>","options":{"planningCards":500000}}}
```

调用audit_plan。用户未给具体规划选项时省略options，使用冻结第一轮的主规模/目标。先run_status读取计划，说明result.prediction是规划试算、result.scenarioEvaluated=false；查看architectureDiagnosis、allocations[].layerLinks、factors、decisions、configuration及来源。layerLinks追溯逐事件适用范围，responsibilityResidualHours核对设计责任守恒；unaddressed不是已存在措施。高现状Shapley不等于追加优化收益，须检查条件响应。计划配置未部署，不能拿计划prediction充当第二轮实测或正式复评。不得因为生成成功自动调用audit_evaluate。

第一轮没有Shapley时无法据其排序分配，解释缺失并按用户意图补充新的现状运行；不要编造贡献或覆盖旧运行。其他规模可独立指定planningCards。importance按规模和机制ID提供；维持target，不能为通过规划放宽目标。

## 用户决定后评估

通用参数试验：先run_status读取现状，选择要调整的对象、字段、单位与目标值，形成最小改动集合：

```text
audit_evaluate({body:{
  sourceRunId: first.id,
  name: 用户给出的方案名称,
  configuration: {policy: {[所选机制代码]: {[参数字段]: 数值目标}}}
}})
```

基础模型能力用configuration.model；扩展机制用extensions；检查点周期可用checkpointPeriods；有来源故障改造用fitTargets。每个字段遵循工具模型的单位与范围，不能把未启用机制的调参称为已部署新措施。单参数对照只携带这一项改动，其余继承第一轮；组合试验显式包含每一项要求。不要预填特定检出率或恢复时间。

采用分配建议：

```text
audit_evaluate({body:{sourceRunId:firstId,name:'AGREE分配后的方案',planRunId:plan.id,configuration:plan.result.configuration}})
```

用户在建议基础上修改时先复制完整configuration，再修改明确字段，保留planRunId方便追溯。plan必须属于同一第一轮且已完成。每次configuration是相对第一轮的完整改动集合；若用户说“在上次方案基础上”，先run_status读该方案configuration，再修改，不将仅有的新字段误当上次补丁。完全手动新建的对照不传计划关联。

新增机制从model_defaults.auditExtensionCatalog读取ID、完整parameters和source，保留适用比例、成功率、失败耗时、吞吐开销及具体机制参数。未给数值不能伪称已测；明确情景。FIT改造必须逐事件给source/evidence/rateBasis，可用configuration.fitTargets；不能自动消除故障。configuration.checkpointPeriods按卡数设置秒值，保存耗时与计算周期分开解释。

run_status读取正式结果：rows为各规模统计和账本，attribution为本次改动相对第一轮的增量，baseline与sourceRunId固定。检查actualMean/区间/目标与状态，以实际字段为准，不能将规划supported当正式达标。生成报告后单独给这一轮结论，用户可继续修改再评估。独立实验不写design_update、不替换第一轮runId，也不使原六阶段确认过期。

## 横向比较与交付

```json
{"body":{"runIds":["<第一轮ID>","<自定义参数方案ID>","<AGREE改进运行ID>"]}}
```

调用audit_compare，再report_export({id:runId,query:{format:'html'}})或format=manifest获取离线下载描述。可分别导出所有原运行。只能比较同一冻结第一轮的已完成评估；分配计划、失败或未完成运行不可混入。旧V4或不同目标/证据须分别解释。

报告按规模切换，记录每次参数、结论、曲线、区间、来源与贡献排名。第一轮排名相对原基线，改进排名相对第一轮，基准不同。先强调主需求规模，再列其他规模未满足项；没有设置需求目标的1000卡参考点不做达标承诺。

支持回看原运行、run_replay固定输入与种子、新建独立改进、取消run_cancel。重放不覆盖旧结果；工作台计划/运行历史可恢复。当前草稿与第一轮不同时先说明差异并按用户指定研究范围操作，不暗中更新历史证据。

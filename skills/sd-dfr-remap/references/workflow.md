# 六阶段控制与恢复

| 阶段 | 进入条件 | 工具 | 过程资产 / 输出 | 失败恢复 |
|---|---|---|---|---|
| clarify | 用户任务 | model_defaults | 任务书：product,metricId,cards,hours,target,generation,acceptance | 询问指标定义与窗口 |
| describe | 任务书 | input_import,input_mapping（用户确认后）,catalog_search | architecture、faultDomains、modeRefs、mechanismRefs；来源行/页/单元格 | 保留草稿、确认歧义 |
| select | 确认结构 | model_defaults | methodPlan：适用条件、粒度、假设、校验方法 | 方法不适用时换求解器 |
| prepare | methodPlan | catalog_create,catalog_validate（用户冻结）,catalog_submit（候选） | parameterTable：value,unit,rateBasis,evidenceRef,confidence；固定资产版本 | 缺失不补零，返回参数确认 |
| evaluate | 输入已确认 | analysis_solve,run_status,run_cancel | 分配、求解、方案比较、收益、风险、runId | 保留失败 run；重放或修正草稿 |
| validate-deliver | 计算完成 | run_replay,report_export,feedback_record | 报告、输入摘要、版本、复现包、采纳理由 | 验证不通过回到参数/模型；不发布虚假成功 |

训练调用 input 包含 cards,hours,trials,seed,target,model,config,factors。模型默认来自 model_defaults；不改动未知字段。方法工具有 allocate/rbd/fta/bdd/ctmc/compare/search/sensitivity/attribute/estimateRate。
库 payload.refs 格式为 `{id,revision,contentHash,taskId?}`；条件和来源必须核对。任务私有 validated 版本可用，公共 published 版本先复制并记录 upstream，再使用本地快照；其他资产先在草稿确认映射。

每次写阶段带 executionId、expectedRevision、inputRevision。awaiting-review 为 Agent 的确认边界，confirmed 仅由工作台用户执行。工作台订阅领域 workflow events；原生聊天事件不直接修改阶段状态。取消保留产物，失败可按当前输入重试；已取消或过期执行重新启动并重新确认，不从截断的仿真中冒充续算。

输入提取需用户确认后，可选调用 input_mapping 预览候选资产和明确训练补丁。内网适配由管理员固定本地模块配置，核对 adapter id/version/moduleSHA256、来源摘要与 unmapped/warnings；缺失参数不得补零，歧义不得跳过。Agent 不注册适配模块、不调用 input_confirm 代替用户，也不得把预览自动应用为已确认设计或冻结资产。

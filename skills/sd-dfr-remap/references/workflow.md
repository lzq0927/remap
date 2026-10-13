# 六阶段控制与恢复

| 阶段                   | 进入条件                       | 工具                                                    | 过程资产 / 输出                                                       | 失败恢复                                |
| ---------------------- | ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| clarify                | 用户任务                       | model_defaults                                          | 任务书：product,metricId,cards,hours,target,generation,acceptance     | 询问指标定义与窗口                      |
| describe               | 任务书                         | input_import,input_mapping（用户确认后）,catalog_search | architecture、faultDomains、modeRefs、mechanismRefs；来源行/页/单元格 | 保留草稿、确认歧义                      |
| select（可用度分配）   | 确认故障模式                   | model_defaults,analysis_solve(allocate)                 | methodPlan：按对象分配的子模型约束、互斥损失预算、回合成结果          | 来源或规模变化时刷新对象；明确 FIT 单位 |
| prepare（可靠性措施）  | 分配方案                       | catalog_search,catalog_validate                         | mechanism-plan：硬件降 FIT、已部署与新增措施、机制能力、恢复顺序      | 缺失不补零，返回措施确认                |
| evaluate（计算与权衡） | 前四步已确认；折叠核对采样参数 | analysis_solve,run_status,run_cancel                    | parameter-table、求解、方案比较、框图、收益、风险、runId              | 保留失败 run；重放或修正草稿            |
| validate-deliver       | 计算完成                       | run_replay,report_export,feedback_record                | 报告、输入摘要、版本、复现包、采纳理由                                | 验证不通过回到参数/模型；不发布虚假成功 |

统一入口为“可靠性设计与评估”，新任务默认专家口径。正式调用使用 design_get.assessment 的 operation 和 input；audit 输入包含事件、机制、预算与复核设置。仅用户在高级设置中选择的历史 V4 使用 training，input 包含 cards,hours,trials,seed,target,model,config,factors。模型默认来自相应的 model_defaults.audit 或 model_defaults.training；不改动未知字段。历史运行查看/导出/重放保留原模型和指标，不改变当前设计或其确认状态。方法工具有 allocate/rbd/fta/bdd/ctmc/compare/search/sensitivity/attribute/estimateRate。
库 payload.refs 格式为 `{id,revision,contentHash,taskId?}`；条件和来源必须核对。任务私有 validated 版本可用，公共 published 版本先复制并记录 upstream，再使用本地快照；其他资产先在草稿确认映射。

每次写阶段带 executionId、expectedRevision、inputRevision。awaiting-review 为 Agent 的确认边界，confirmed 仅由工作台用户执行。工作台订阅领域 workflow events；原生聊天事件不直接修改阶段状态。取消保留产物，失败可按当前输入重试；已取消或过期执行启动新的 executionId；用户可沿用最早受影响阶段之前连续的人工确认，计算与交付仍需重新完成。只改采样参数从第五步、只改措施从第四步、只改分配从第三步复核。Agent 不代替用户沿用确认，不从截断的仿真中冒充续算。

输入提取需用户确认后，可选调用 input_mapping 预览候选资产和明确训练补丁。内网适配由管理员固定本地模块配置，核对 adapter id/version/moduleSHA256、来源摘要与 unmapped/warnings；缺失参数不得补零，歧义不得跳过。Agent 不注册适配模块、不调用 input_confirm 代替用户，也不得把预览自动应用为已确认设计或冻结资产。

# Reliability MCP 0.3

独立 MCP 网关，标准 stdio 协议，不依赖 React 或 OpenCode。
计算和数据持久化仍由可靠性 API 服务负责；此包不是离线数值引擎。

从源码运行：`node --import tsx packages/mcp-runtime/src/stdio.ts`。
分发包运行：安装 package.json 依赖后 `node dist/stdio.mjs`。

在 Agent 的 MCP 配置中设置 `RELIABILITY_API_URL`、`RELIABILITY_TASK_ID`、
`RELIABILITY_TASK_TOKEN`。每条连接只绑定一个任务。令牌由任务服务生成，
不得写入共享 Skill、公共资产或任务导出。OpenCode 使用工作台生成的
`launch.ts` 读取本机凭据；其他 Agent 可从本地凭据文件加载环境变量。

工具发现通过 `tools/list`；参数为 `{id?,revision?,query?,body?}`。
Agent 可读取、准备草稿、运行实验、写阶段产物及提交公共候选；
输入确认、阶段签认、公共发布均不由 Agent 授权。

`input_mapping` 参数为 `{id}`，读取用户已确认输入的映射预览。未确认返回
`INPUT_UNCONFIRMED`。内网管理员适配预览可包含 `adapter`（标识、固定版本、
入口模块 SHA-256）和任务私有 `previewId`，资产草稿保留适配来源。工具不会
自动应用补丁、创建资产、冻结版本或确认流程；不得从 Agent 请求注册模块。

分轮工具：`audit_plan`只生成AGREE改进建议，`audit_evaluate`在用户请求后单独执行改进，`audit_compare`比较同一第一轮的已完成结果；`run_list`返回有界摘要，`run_status`读取完整快照。三个启动工具返回runId，不改变正式设计及人工确认。机制数量、类别和参数遵从当前场景与输入，默认样例不限定通用流程；手动改进只携带明确改动。使用说明见[分轮评估与Agent协作指南](../../docs/分轮评估与Agent协作指南.md)。

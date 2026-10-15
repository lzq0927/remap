# Agent 集成接口

`src/port.ts` 的 AgentPort 表达消息、命令、取消和事件；WorkspaceAgentPort 增加会话页面、提供商、元数据、上下文和待响应交互。OpenCodeAdapter 是当前默认实现，使用本地安装的原生服务，不实现仿制聊天 UI。

API 的组装点为 `apps/api/src/agent-integration.ts`，可在受控本机启动入口中调用：

```ts
const app = await buildApp({ agentIntegration: companyIntegration });
```

companyIntegration 实现 global、forTask(directory)、prepareTask(tasks, taskId, apiUrl)。全局实例只用于健康和元数据，任务实例必须按给定工作目录隔离会话。prepareTask 由管理员集成代码负责按企业平台规范准备 Skill 和绑定任务的 MCP 凭据。不得将凭据写入共享 Skill 或公共资产。

会话绑定、跨任务访问检查、人工创建/确认和当前设计摘要仍由核心 API 执行，集成实现不能自行跳过。默认 OpenCode 的命令包装和项目配置只存在于其具体适配实现中；替代实现不必生成 opencode.json。替代实现的模型网络访问与界面嵌入须由公司单独验收；这不是运行时上传插件入口。

现有工作台原生面板仍针对 OpenCode。只需要企业 Agent 使用求解器和流程时，直接安装 `skills/sd-dfr-remap` 并连接 `packages/mcp-runtime`，无需适配聊天 UI。MCP 网关需要运行可靠性 API。Skill 指令和 MCP 工具描述与模型无关；各平台的 Skill 发现与模型配置使用各自官方机制。

测试 `tests/integration/agent-integration.test.ts` 使用独立合成 Agent 验证替换、任务隔离、主会话复用及人工授权，不请求模型。

任务准备从`skills/sd-dfr-remap`递归同步Skill、manifest和references；内容改变会刷新当前任务原生实例，普通重连不重复刷新。开发启动、Agent启动、bootstrap及`pnpm skill:install`共用同一安装函数更新项目根目录发现副本，不作为另一份手工维护来源。MCP 0.3补齐audit_plan/audit_evaluate/audit_compare/run_list；同步当前设计包含最近各轮ID摘要，完整参数从run_status读取，不将分配建议当已完成改进。

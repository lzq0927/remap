# 已验证兼容性

2026-10-11 任务隔离更新：真实本地 OpenCode 1.18.35 已验证目录查询、具名会话、任务 Skill 发现、绑定 MCP connected、GLM-5.3 自定义提供商登记发现。真实 GLM 回答/账户权限尚未验证。独立编译 MCP 网关通过 SDK 握手与 RBD；本机新中文/空格目录干净依赖安装和任务迁移通过。第二实体电脑、另一 Agent 的 Skill 安装执行及其他操作系统仍待验收。

2026-10-10 Windows 11 本地环境：Node.js24.16.0、pnpm11.25.0、OpenCode1.18.35；前端 Vite7.3.7、React19.3.0；MCP SDK1.32.1。实际依赖以锁文件为准。

OpenCode 以本地安装的 `/doc` 为准。健康 `/global/health`；会话 `/session`；消息 POST `/session/{id}/message` 的 model 为 `{providerID,modelID}`；命令 POST `/session/{id}/command` 的 model 为 `provider/model` 字符串。命令 `/sd-dfr-remap` 实际发现，MCP reliability 状态 connected。

参考：[OpenCode Server](https://opencode.ai/docs/server/)、[Agent Skills](https://opencode.ai/docs/skills/)、[MCP](https://opencode.ai/docs/mcp-servers/)。仅支持已安装版本核验的接口，不假定未来版本事件结构一致；AgentPort 将供应商消息和事件归一化。

2026-10-11：本机已安装可执行文件为 `<项目目录>/node_modules/opencode-ai/bin/opencode.exe`，服务健康版本 1.18.35。其官方 Web 页面可被 iframe 嵌入，项目会话旧深链接会由官方页面重定向为 `/server/{base64url(origin)}/session/{id}`。浏览器实测原生模型菜单与自定义提供商的 Base URL、API Key、模型字段；上下文以 `noReply:true` 写入，不指定模型。官方 Web 设置显示的界面版本为 1.18.34，与服务版本分别记录。页面语言受浏览器环境和官方设置影响，浏览器检查兼容中英文标签。公司认证与完全离线 Web 资源可用性尚未验收。[官方 Web 文档](https://opencode.ai/docs/web/)、[提供商配置](https://opencode.ai/docs/providers/)。

MCP stdio 使用真实官方 Client/StdioClientTransport 自动测试发现、创建资产、求解与结果查询。Streamable HTTP 已用真实 SDK 客户端验证 initialize、listTools、callTool；实际协商协议版本为 2025-11-25，日志在 artifacts/mcp-handshake.json。

Python 科学求解依赖见 solvers/ctmc/requirements.txt，已使用本地 target 安装并运行5个 pytest。PYTHON_EXECUTABLE/RELIABILITY_PYTHON 可覆盖解释器；无依赖时报明确错误。Node SQL 使用内置 node:sqlite。

桌面开发环境的默认 sandbox helper 曾因另一个 node_repl.exe 被占用而初始化失败；本次通过自动审查允许的 exec_command 显式提升执行本地开发操作，文件/技能读取与全部检查已实际完成。未终止无归属进程、未修改全局安全设置。

# 自动流程可读性、Skill 分流与原生会话隔离

用户已明确要求直接改进以下行为。

- [x] 前四阶段保持两秒最小阅读时间，实际产物先记录再推进；求解完成也留阅读时间；取消和输入过期时停止推进。
- [x] 工作台跟随自动阶段滚动，展开该步所在折叠面板，保持导航固定；同一步更新不反复抢滚动。
- [x] 当前步骤展示实际说明、产物名称与详细记录入口。
- [x] Skill 使用 OpenCode 原生 question 工具展示“全自动设计与评估 / 辅助设计与评估”及解释，依据用户输入和保存状态推荐后续处理，等待选择，不重复启动已有执行。
- [x] 使用本机原生可执行文件，按任务隔离 OPENCODE_DB 和运行状态；继续使用本机凭据配置；校验原生数据库隔离能力，禁止静默回退。
- [x] 用官方 export/import 将已绑定且目录相符的历史会话迁入；保留原始记录；平台关闭时停止所属任务进程。
- [x] 原生双任务接口隔离、历史迁移、自动阶段停留和取消验证。
- [x] 浏览器逐步自动滚动、产物可见和官方模型/提供商设置验证。

实现边界：步骤停留只改善阅读，不改变求解参数。原生数据库隔离是任务会话隔离，不声称构成操作系统沙箱。缺少问题工具时其他 Agent 可降级文字交互。人工交付审核仍保留。

验收：全套 Vitest 46 文件、234 项通过；类型检查、ESLint、前端及 MCP 构建通过。使用本机已连接模型执行一次原生 Skill，实际生成包含两项解释的 question，浏览器确认两个选项可见；未点击自动或启动额外评估，测试对话与运行目录已清理。原生界面截图保存在本地 artifacts/native-mode-choice.png，不进入发布代码。

浏览器验收覆盖全部35个场景：首次32项通过；补齐CTMC测试环境、更新模拟主会话接口及说明文本定位后，相关15项全部通过（包含原失败3项与滚动、导航、任务和Agent流程）。本地工作台已重启，5173前端及4178 API访问均返回200。

官方实现依据：OpenCode 1.18.35 的 [Database.path](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/core/src/database/database.ts) 支持绝对 OPENCODE_DB；[Global.Path](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/core/src/global.ts) 区分 data/config/state；[import](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/opencode/src/cli/cmd/import.ts) 将原生导出会话重绑定到目标目录。该方案保留原生 UI 和标准 Skill/MCP，可替换 Agent 时不改可靠性工具。

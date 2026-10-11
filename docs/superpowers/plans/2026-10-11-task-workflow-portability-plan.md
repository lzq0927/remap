# 任务隔离、统一流程与可移植交付 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 用户已于本轮明确授权“实施”。本地工程实现与回归完成，真实 GLM、第二实体电脑、另一 Agent 的验收仍待进行。原详细清单保留作为验收基线，实际状态见下表和[实施记录](../../2026-10-11-任务系统实施与验收.md)。

**Goal:** 让用户从独立评估任务开始，通过手动操作或 Agent/Skill 共用流程完成评估，并可受控复用资产、切换模型、迁移到其他电脑。

**Architecture:** 任务服务负责范围与工作区，流程服务负责阶段和结构化事件；LUI 与任务范围内的 MCP 调用同一服务。数值引擎不依赖 Agent，保留本地 OpenCode 官方界面，通过适配器关联会话；公共发布采用独立审核边界。

**Tech Stack:** 沿用 TypeScript、React/Vite、Fastify、SQLite、官方 MCP SDK、现有 Node/Python 求解器与本地 OpenCode；不因这轮需求引入新的 Agent 框架。

---

日期：2026-10-11。开发基线：`4da4d11`。状态：**本地工程实施与验收完成，外部接入验收待完成**。不采用固定日期或旧计划截止时间。部分职责合并到 service/registry/store/portable 等模块，文件名以当前源码为准。

| 任务 | 实际状态与边界 |
|---|---|
| T1/T2 | 任务注册表、隔离存储、路径校验、并发预算、旧库快照迁移及两个进程中断点恢复已通过测试 |
| T3 | 任务主页、具名主会话、自动恢复、专题、目录绑定、每标签 URL、摘要同步已实现；本地 OpenCode 的 Skill/MCP 发现、嵌入模型菜单和提供商设置入口实测通过 |
| T4 | 智谱 URL 与 GLM-5.3 登记、原生发现、无密钥导出已验证；真实账户鉴权、流式回答和模型驱动工具调用未验证 |
| T5/T6 | 统一状态机、人工确认、领域事件、冲突校验、正式运行绑定、中央产物显示通过 SDK/API/浏览器验证；真实 LLM 执行整套 Skill 未验 |
| T7 | 私有冻结、公共快照复制、候选提交与独立审查领域规则已实现；公共发布 HTTP 入口关闭，等待明确审批与独立身份接入 |
| T8 | Skill manifest、独立 MCP 网关、软件清单、bootstrap/doctor、任务包往返、中文空格目录及任意 cwd 启动已通过 |
| T9 | 本机干净依赖目录验证及完整回归通过；第二实体电脑、另一 Agent、完全离线官方 Web/跨平台尚未验收 |

当前每任务一个活动设计及版本历史，多个方案通过复制任务和独立比较实验管理；尚未实现复杂 Scheme 管理实体。正式六阶段先覆盖 AI 训练，传统工具为独立实验，其他产品模型仍需扩展。

关联文档：[设计建议](../../2026-10-11-任务隔离与Agent联动建议.md)、[当前使用指南](../../2026-10-11-评估系统使用指南.md)。本计划补充已有数值与领域建模计划，不把工程重构视为模型可信性验证完成。

## 一、范围与决策基线

- 先完成本地单用户多任务和多窗口，保留公司身份/权限接口；不建设通用项目管理平台。
- 产品模板可扩展，首个验收实例仍为 AI 训练集群。任务关联方案、运行、输入、资产、流程与会话。
- 原生 OpenCode 保留模型和提供商设置。工作台显示任务关联和不含密钥的配置状态。
- 自动执行以“到确认点”为默认方式；数据歧义、关键假设和签认由用户处理。
- 公共库只有经过审核的发布版本。审核身份未接入时，禁止公共发布；私有任务仍可评估。
- 旧工作区迁移为历史任务，原运行内容与哈希不重写；原用户资产默认私有。
- 软件安装包、任务数据包、公共资产发布包分别管理，不混入凭据。

## 二、拟定契约

| 对象 | 核心字段与规则 |
|---|---|
| Task | id、name、productType、scope、metric/target、window、status、revision；目录由服务端生成 |
| Scheme | taskId、id、name、inputRevision、modelVersion；基线与候选显式标识 |
| Run 关联 | taskId、schemeId、workflowId、executionId、inputRevision；老 Run 使用关联表保持原哈希 |
| SessionBinding | taskId、agentAdapter、sessionId、workspace、purpose、primary、status；无密钥 |
| TaskAsset | 本地版本、upstreamId/revision/hash、证据、适用条件、派生关系 |
| Workflow | taskId、workflowId、executionId、revision、各阶段状态、产物、确认者与时间 |
| WorkflowEvent | eventId、sequence、taskId、workflowId、executionId、stepId、actor、inputRevision、runId、artifactRefs |
| Approval | submissionId、contentHash、reviewerIdentity、decision、reason、time；内容改变使审批失效 |

任务范围由服务端验证；不同浏览器标签不能共享一个全局当前任务。状态写入包含预期版本；幂等键覆盖任务、执行和输入版本。审批与用户确认不能由 Agent 自报身份替代。

新 API 使用 `/tasks/:taskId/...`；提供绑定任务的 `task_current`、`design_get`、`workflow_get/start/record/confirm/resume/cancel` 工具。具体状态转换集中在流程服务，禁止前端和 Skill 各实现一套。现有工具逐项适配任务范围，旧的无范围写入接口默认拒绝；迁移工具使用单独入口。

## 三、模块与文件职责

| 文件或目录 | 变更 | 职责 |
|---|---|---|
| `packages/contracts/src/types.ts`、`schemas.ts` | 修改 | 新对象、版本和事件契约 |
| `packages/tasks/src/service.ts`、`workspace.ts`、`migration.ts` | 新增 | 任务 CRUD、路径边界、数据迁移 |
| `packages/assets/src/store.ts` | 修改 | 任务存储上下文、公共/私有边界、谱系与审核关联 |
| `packages/workflow/src/service.ts`、`events.ts` | 新增 | 阶段状态机、确认、恢复和有序事件 |
| `packages/workflow/src/runs.ts` | 修改 | 任务归属、幂等、进度和取消关联；保持求解语义 |
| `packages/catalog-review/src/service.ts` | 新增 | 候选提交、审核、发布权限 |
| `apps/api/src/server.ts`、`routes/tasks.ts`、`routes/workflows.ts` | 修改/新增 | 校验范围后调用服务；新增职责提取到路由模块 |
| `apps/mcp/src/server.ts`、`stdio.ts`、`http.ts` | 修改 | 同契约工具、固定任务授权上下文、认证 |
| `packages/agents/src/port.ts`、`opencode-adapter.ts`、`task-binding.ts` | 修改/新增 | 任务会话绑定、原生能力兼容，不重做官方 UI |
| `apps/web/src/App.tsx`、`OpenCodePanel.tsx` | 修改 | 当前任务状态、会话绑定、原生 UI 与领域事件关联 |
| `apps/web/src/TaskHome.tsx`、`TaskHeader.tsx`、`WorkflowTimeline.tsx` | 新增 | 任务入口、上下文提示、阶段产物与确认 |
| `skills/sd-dfr-remap/SKILL.md` 与 `references/workflow.md` | 修改 | 先读取任务/版本、使用统一流程工具、公共提交边界 |
| `.opencode/commands/sd-dfr-remap.md` | 修改 | 本地命令入口适配任务上下文 |
| `scripts/doctor.mjs`、`agent.ts`、`build-release.ts` | 修改 | 冷安装检测、工作目录解耦、分发清单 |
| `scripts/bootstrap.ts`、`export-task.ts`、`import-task.ts` | 新增 | 本机配置生成、任务包校验与迁移 |
| `packages/mcp-runtime/`、`skills/sd-dfr-remap/manifest.json` | 新增 | 可分发工具运行入口与 Skill 版本/依赖清单 |

API 先采用服务端任务注册表与任务存储实例；每个任务使用自己的数据目录，公共库单独存储。计算并发预算统一管理，不能因任务多就绕过现有资源限制。物理去重、企业队列和多人协作后置。

## 四、实施任务与验收

以下保留原细粒度验收清单；测试与实现已按上述状态完成，未验项目继续保留。不要加入原始工作计划、真实数据或凭据。当前实际命令和证据见实施记录，不以勾完历史清单代替外部验收。

### T1：任务契约、工作区与范围边界

文件：contracts、tasks 服务/工作区、assets/store、API tasks 路由；新增 `tests/integration/task-isolation.test.ts`。

- [ ] 添加 A/B 任务夹具：相同文件名、不同参数和私有资产；验证跨任务读取、写入、取消、报告下载和重放均被拒绝。
- [ ] 运行 `pnpm exec vitest run tests/integration/task-isolation.test.ts`，确认隔离测试先失败。
- [ ] 实现任务创建/打开/复制/归档，服务端产生目录与任务身份，任务参数不允许直接指定任意目录。
- [ ] 为设计、输入、资产、运行、反馈及报告加入范围；stdio 连接绑定任务凭据，HTTP 验证连接身份与授权范围。
- [ ] 检查 `..`、符号链接、junction、伪造 taskId、旧全局接口和并发标签访问；明确进程文件权限与 API 范围的区别。
- [ ] 公共发布默认关闭；移除普通 MCP 的公共发布权限，防止审核完成前出现通道。
- [ ] 运行隔离测试并提交。验收：A 不能看到或改变 B，切换任务不会取消或污染原任务运行。

### T2：旧数据迁移与不可变运行保留

文件：tasks/migration、store、任务关联表、bootstrap；新增 `tests/integration/task-migration.test.ts`。

- [ ] 用当前 schema 的 SQLite、设计、输入、私有资产、已完成运行和未完成运行创建迁移夹具。
- [ ] 添加迁移预检、失败中断、重复迁移、回滚和历史哈希保持测试，先验证失败。
- [ ] 实现停止服务备份或一致性备份、迁移清单和 schema 版本，产生“历史任务”。
- [ ] 旧 Run 通过关联表获得任务身份，不改变旧输入/结果哈希；用户资产不自动进入公共库。
- [ ] 未完成运行按现有中断语义处理，明确状态，不宣称已自动续算；流程恢复可基于快照重试。
- [ ] 运行 `pnpm exec vitest run tests/integration/task-migration.test.ts`，核对数量、引用、哈希和回滚结果后提交。

### T3：任务首页与原生 OpenCode 绑定

文件：TaskHome、TaskHeader、App、OpenCodePanel、AgentPort/adapter/task-binding；新增 `tests/integration/agent-task.test.ts`、`tests/e2e/tasks.spec.ts`。

- [ ] 添加任务新建/复制/切换/重开测试，任务切换后确认设计、文件、资产、历史和会话恢复一致。
- [ ] 依据已安装 OpenCode 的 `/doc` 核验目录、会话创建和事件参数。验证同一服务支持任务工作目录的实际方式；若版本不支持，则采用可管理的任务服务实例，不假定现有 `/path` 全局目录能隔离任务。
- [ ] 为任务工作区安装 Skill 与命令适配，MCP 启动使用绝对可执行路径和固定任务授权上下文，禁止复用一个可随意切换任务的全局写工具。
- [ ] 自动创建具名主会话，普通选择器仅显示本任务会话；旧未绑定会话单独整理。
- [ ] 同步消息使用任务摘要、版本和产物引用，完整设计通过任务工具读取，避免大段 JSON 占满原生聊天；任务条同时显示当前方案与最近运行。
- [ ] 会话创建或绑定失败时保留可重试任务状态，不留下看似成功的错误关联；官方内部导航偏离时提供清楚提示和返回入口。
- [ ] 测试多窗口、快速切换、服务重启、旧会话失效、后台旧任务完成和跨任务绑定失败。
- [ ] 运行 `pnpm exec vitest run tests/integration/agent-task.test.ts` 与 `pnpm exec playwright test tests/e2e/tasks.spec.ts` 后提交。

验收：用户从任务名即可知道“正在评估什么、看哪个会话、结果属于谁”；手动数值评估在 OpenCode 离线时仍可使用。

### T4：模型配置与 GLM 接入验证

文件：OpenCodePanel、Agent adapter、连接配置展示、doctor、兼容性文档；新增 `tests/integration/model-profile.test.ts`。

- [ ] 验证原生自定义提供商登记流程，按设计建议合并 provider，不覆盖现有 MCP/权限设置。
- [ ] 模型配置仅保存逻辑名、端点、模型 ID、用途和已验证能力；凭据留在本地存储或环境中，导出时剔除。
- [ ] 用占位凭据测试密钥不进入任务、同步快照、报告、异常、事件或软件包；不使用用户本轮提供的真实值编写测试。
- [ ] 在获准实施并具备有效本地凭据后，人工验证指定 URL 与 `glm-5.3`：对话、流式、只读 MCP、小型求解、认证失败与重连。使用公开样例，记录模型版本和结果，不记录授权头。
- [ ] 聊天模型与提取模型分别显示用途；未验证视觉能力不能标为可解析架构图。
- [ ] 运行 `pnpm exec vitest run tests/integration/model-profile.test.ts`；记录真实服务验收成功或明确的账户/能力阻塞后提交。

验收：官方模型菜单可切换登记的模型，MCP 工具调用确实成功；失败信息区分认证、模型授权、协议和工具执行，不能仅凭模型出现在列表就验收通过。

### T5：统一流程服务、版本冲突与事件恢复

文件：workflow/service/events/runs、API workflow 路由、MCP；新增 `tests/integration/workflow-unified.test.ts`。

- [ ] 用一条六阶段夹具添加状态转换、幂等、确认身份、取消、失败重试、重启和事件重连测试，先验证失败。
- [ ] 实现阶段完整状态与产物引用，UI 与 Agent 同一服务写入；工具完成不自动产生人工确认。
- [ ] Agent 首先通过 task_current/design_get 读取当前任务和版本；拒绝无绑定或过期输入版本的写操作。
- [ ] 计算回调携带任务/执行关联，旧执行不能更新新方案；连续事件序号、快照和补读支持刷新恢复。
- [ ] 测试两个 Agent 或“人工编辑 + Agent 执行”并发，冲突暂停且保留已有结果。
- [ ] 实现确认、恢复、取消工具的身份限制，LLM 不能冒充用户批准关键事实或发布。
- [ ] 运行 `pnpm exec vitest run tests/integration/workflow-unified.test.ts` 后提交。

### T6：中间自动展示与 Skill 执行闭环

文件：WorkflowTimeline、App、Skill/reference、OpenCode command；新增 `tests/e2e/workflow-agent.spec.ts`。

- [ ] 添加模拟 Agent 工具调用的浏览器流程，验证各阶段产物显示、待确认阻断、修改参数后冲突和取消。
- [ ] 替换聊天输出猜测流程状态的逻辑，订阅领域事件；保留原生聊天与模型功能。
- [ ] 中间显示每一步目的、输入版本、结构/参数、方法理由、进度、结果和确认按钮；详情按需展开。
- [ ] 清楚区分“查看阶段”“待用户确认”“计算完成”，错误和缺失项给出下一步动作；桌面窄屏与移动布局可读，不只依靠颜色表示状态。
- [ ] Skill 使用同一阶段契约，选择人工、逐步辅助、自动到确认点模式，声明缺失参数和适用边界。
- [ ] 对公开万卡样例真实执行 Skill：用户确认后计算基线和一个候选，中间显示阶段产物，最终报告绑定实际运行。
- [ ] 测试“Agent 没调用工具只写文本”不能被标为已计算；重复事件、任务切换、刷新和错误重试不重复执行。
- [ ] 运行 `pnpm exec playwright test tests/e2e/workflow-agent.spec.ts`；记录真实 Agent 验收轨迹后提交。

验收：右侧启动 Skill 后，中间看到逐步执行与产物；人工也能接手同一阶段，无须复制另一套输入。自动运行不跳过关键确认。

### T7：公共资产审核、复制与升级

文件：catalog-review/service、assets/store、API/MCP 资产路由、资产库界面；新增 `tests/integration/public-review.test.ts`。

- [ ] 添加私有草稿、公共快照、提交、拒绝、自审、批准、内容变更及发布权限测试，先验证失败。
- [ ] 实现公共版本复制为任务快照、派生版本和谱系；公共更新不影响旧任务，用户主动预览并升级。
- [ ] 实现审核内容摘要锁定、证据与适用性清单、独立审查身份和审计记录。
- [ ] 发布仅使用审核服务与批准权限，普通 Agent 只允许私有编辑、验证与候选提交。
- [ ] 接入审核身份之前保持公共发布禁用；本地自查可用但标明不满足独立审核。
- [ ] 检查旧已发布资产不自动获得新制度下的审批资格；软件自带示例明确示例/待校准标签。
- [ ] 运行 `pnpm exec vitest run tests/integration/public-review.test.ts` 后提交。

验收：未经批准不可发布，改动会使批准失效；复制资产后公共库更新不会改变任务历史结果。

### T8：Skill/MCP 独立包与任务导入导出

文件：mcp-runtime、Skill manifest、bootstrap/doctor、export/import-task、build-release；新增 `tests/integration/portability.test.ts`。

- [ ] 明确两种工具启动方式：连接已部署评估 API；独立包附带必要领域服务与求解依赖。标注依赖，不把只含代理的包宣传为独立引擎。
- [ ] 生成 stdio/Streamable HTTP 适配样例、工具 schema、版本兼容清单、Skill 相对引用与不同 Agent 安装说明。
- [ ] 校验从任意当前目录启动，路径含空格/中文，端口改变、数据根目录变化、非管理员运行。
- [ ] 扩展 doctor：Python 导入 SciPy、原生 Agent 版本/API、MCP 握手、最小求解、资源与写权限检查；首次向导不静默覆盖用户配置。
- [ ] 实现任务包 schema/摘要校验、禁止越界压缩路径、冲突重命名、会话重绑与不含凭据；源任务保持不变。
- [ ] 为新机器生成配置，不复用开发机绝对路径或旧会话 ID；SQLite 数据使用一致性备份。
- [ ] 运行 `pnpm exec vitest run tests/integration/portability.test.ts` 和 `pnpm verify:release` 后提交。

### T9：冷安装与回归交付

文件：README、compatibility、使用指南、发布清单；实际验收不修改数值基准。

- [ ] 在第二台干净 Windows 电脑从交付物安装，不借用开发机 node_modules、Python target 目录或用户配置。
- [ ] 按向导接入当地已安装 OpenCode，新建任务、导入模板、运行 Skill/手动评估、下载报告、导出再导入任务。
- [ ] 在另一种支持 MCP 的 Agent 验证工具发现、参数校验、小型求解和状态查询；Skill 安装方式单独验证，不能只验证工具即宣称 Skill 全兼容。
- [ ] 本地求解在依赖已安装时验证无模型网络也能使用；官方 Web 完全离线、Linux/macOS 支持只记录实际测试范围。
- [ ] 全量运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:e2e`、`pnpm build`、`pnpm verify:release`；Python CTMC 按其 README 运行测试。
- [ ] 核对专家 V4 回归、传统解析案例、任务跨界拒绝、公共发布拒绝和真实模型工具链验收均通过。
- [ ] 更新文档和软件包清单，记录未支持场景；软件包不包含真实任务数据、凭据或开发机私有路径。

## 五、完成定义与实施边界

| 能力 | 必须可演示的结果 |
|---|---|
| 任务隔离 | 两任务同名文件/资产并存，多窗口互不覆盖；跨范围写入与报告读取被拒绝 |
| 会话关联 | 当前任务与主会话清楚显示，旧会话不误绑定，原生导航偏离有提示 |
| 模型切换 | 指定模型可在官方界面选择并成功完成公开 MCP 求解；凭据不进入资产 |
| 自动过程 | Skill 工具执行逐步出现在中间，确认/取消/恢复和版本冲突可控 |
| 资产回流 | 快照隔离、派生可追溯、独立批准后才能公开，变更后重新审核 |
| 移植 | 第二台电脑和另一 Agent 的实际验收记录，软件与任务分别迁移 |
| 科学结果 | 原指标语义、数值基准、输入哈希及适用边界保持；无未经验证的达标声明 |

T1/T2 是基础，T3/T4 改善当前使用，T5/T6 完成统一流程，T7 可与流程开发分支独立推进但公共发布始终受限，T8/T9 完成交付。这里描述模块依赖，不授权启动并行子 Agent。

本轮交付包括源码、可运行软件包、更新的使用指南、实施验收记录。后续补齐真实模型、第二电脑与其他 Agent 验收，再接入独立审核身份；不能绕过确认或将工程通路通过称为产品参数已经验证。

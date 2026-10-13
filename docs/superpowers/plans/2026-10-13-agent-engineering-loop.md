# ReMAP AI 集群工程闭环 Implementation Plan

> **For agentic workers:** Use executing-plans and project sr-build sequentially in this session. 用户已批准新版设计、计划后直接实施；不再请求执行方式选择，不委派其它 Agent。用下列复选框追踪实现和实际证据。

**Goal:** 从专家材料、Agent 建模草案、专家确认到系统设计、真实 RBD/FTA/TLC 分析验证、决策与资产复用形成前后端闭环。

**Architecture:** 任务级 EngineeringModel 统一身份/版本/来源，视图与方法专用模型分离。领域服务承接 UI 与 MCP，Agent 只能提出变更，用户接受后生成新修订。分析通过现有队列运行内置 BDD 与真实 TLC，工具适配契约支持企业 CLI/API/文件工具，原始输出和原生模型进入冻结快照。

**Tech Stack:** React 19 / React Flow、TypeScript / Zod、Fastify、SQLite JSON documents、JSZip / fast-xml-parser、Vitest / Playwright、TLA+ TLC 1.7.4 与项目内 Java 21。

## 任务记录

- taskId: remap-agent-engineering-loop-20261013
- revision: 1
- fromRole: user
- toRole: sr-build
- scope: synthetic/public；企业工具接口保留，企业真实资料不进入外网
- status: completed（首条工程闭环）
- 工作目录: D:/code/sys_reliability
- 基线: 43bc8b50b2e2f78bfbee52753fa468758e1ab469
- 分支: codex/agent-engineering-loop
- 输入: docs/superpowers/specs/2026-10-13-agent-assisted-engineering-design.md；2026-10-13 用户批准消息
- 可改: apps、packages、scripts、tests、skills/sd-dfr-remap、examples、docs、依赖与锁文件
- 非目标: 完整 SysML 标准实现、任意动态拓扑自动求解、内网真实工具/参数验收、自动公共发布
- 停止条件: 遇真实凭据/内网数据缺失，仅暂停依赖部分，继续合成案例及公开真实工具验证
- 输出: 本计划、使用/适配文档、artifacts/engineering-loop 中真实验证证据

## Task 1：领域模型、语义校验与合成案例

Files: 新增 packages/modeling/src/{schema,validate,sample,compile}.ts 和 packages/modeling/test/model.test.ts。

- [x] 编写并运行失败测试：共享故障不重复计率、失效率/恢复指标分离、悬空引用拒绝、布局不改语义摘要、分析维度不改变原模型。
- [x] 定义有版本的模型，字段为 sources/entities/relations/failureModes/mechanisms/requirements/behaviors/views/cases/decisions；所有模型内引用以稳定 ID 解析。方法模型分为 static、tlc、external，不将所有方法转换为 RBD。
- [x] 提供双协调器检查点合成专家材料与固定模板：共享网络/供电、两个协调器、训练节点、存储、恢复机制、正常/异常交互。模板清楚标记 synthetic 和来源。
- [x] 编译 static 案例到现有 solveStatic 输入；FTA 事件为失效概率，RBD 为成功概率。TLC 案例保留 .tla/.cfg 原文和性质清单。

行为断言：

```ts
expect(solveStatic({method:'rbd',tree:{type:'series',children:[
  {type:'event',id:'shared',probability:.9},
  {type:'event',id:'shared',probability:.9}
]}}).probability).toBeCloseTo(.9,12);
// 编译器测试另核对 lambda=0.001/h、t=100 时 R=exp(-0.1)，MTTR=2 时 A=1/1.002。
```

Run: `pnpm exec vitest run packages/modeling/test/model.test.ts`；应先因模块缺失失败，实现后全部通过。

## Task 2：任务持久化、变更草案与接口

Files: 新增 packages/modeling/src/service.ts、apps/api/src/modeling-routes.ts、tests/integration/modeling.test.ts；修改 server.ts、tasks/portable.ts。

- [x] 失败测试覆盖 409 修订冲突、跨任务访问、Agent 不可接受自己的草案、原生文件与快照导入往返。
- [x] GET/POST `/engineering/models`；GET/POST `/engineering/models/:id`；GET `/engineering/models/:id/revisions`；POST `/engineering/models/:id/proposals`；POST `/engineering/proposals/:id/resolve`；POST `/engineering/models/:id/validate`。
- [x] 保存使用 expectedRevision 和事务，同时生成不可变 revision 文档。草案记录 baseRevision、actor、reason 和完整候选模型；接受前再次校验基线，必须 user 身份。
- [x] GET `/engineering/models/:id/export` 和 POST `/engineering/import` 校验摘要/schema；任务包导入调用领域校验，防止绕过。
- [x] POST `/engineering/models/:id/assets` 将用户确认的模型/机制/案例沉淀为任务私有资产，保留模型修订和运行来源，不自动发布。

接口输入示例：

```json
{"expectedRevision":1,"reason":"补充共享供电故障域","model":{"schemaVersion":"1.0.0"}}
```

其中 model 需提供完整 schema；不接受任意 JSON Patch 路径或客户端自造 confirmedBy。Run: `pnpm exec vitest run tests/integration/modeling.test.ts`。

## Task 3：材料导入与 Agent 方法能力

Files: 新增 packages/modeling/src/materials.ts；修改 MCP registry、Agent 上下文和 skills/sd-dfr-remap/SKILL.md；新增 examples/engineering-loop 专家材料。

- [x] PPTX 合成夹具测试文本、连接器、备注及 shape/page 定位；拒绝过大解压内容、DTD 与无效格式。
- [x] POST `/engineering/materials` 保存原始字节摘要、材料页/段落/图元；支持 PPTX、Markdown/文本和 JSON 模型。
- [x] MCP 暴露 engineering_model_get、engineering_materials、engineering_propose、engineering_validate、engineering_run；决策同样通过工程草案提出；提供 schema/method resources，复用原生 OpenCode 任务绑定。Agent 提出完整候选模型，所有来源引用须存在。
- [x] UI 可将真实材料与当前模型交给 Agent，并查看返回草案/差异。固定示例导入与真实模型推理分开标识；实际模型调用使用用户现有提供商配置及合成材料。

Run: `pnpm exec vitest run packages/modeling/test/materials.test.ts tests/integration/mcp.test.ts`。

## Task 4：真实 TLC 与工具适配

Files: 新增 packages/modeling/src/{tool-contract,tools,tlc,execute}.ts、scripts/setup-tlc.ps1、scripts/verify-engineering-loop.ts；修改 workflow/worker.ts。

- [x] 定义 ToolAdapter：describeCapabilities、validateInputs、execute；execute 输入冻结原生文件/配置/预算，输出 engine、version、verdict、scope、metrics、trace、rawOutput、artifacts。
- [x] 内置静态 BDD 与 TLC 适配；外部适配由管理员注入/固定配置，支持 CLI/API 和文件结果导入。外部原始结果明确执行模式与工具身份，不冒充内置验证。
- [x] 便携 Java/TLC 下载安装到 .local-runtime（忽略目录）；验证官方摘要并记录安装来源，不自动修改系统 PATH。
- [x] TLC 受控进程、独立临时工作目录、固定入口文件、超时/输出/内存限制；输出区分反例、完成检查、语法错误、超时未知。取消须终止子进程树。
- [x] 建立未隔离旧主/增加 fencing 两个模型，检查同一 SingleWriter 性质；真实 TLC 必须分别返回反例/有限模型穷尽通过。保存完整轨迹与运行范围。
- [x] 集成现有 RunService：operation=engineering，快照含整个模型/案例/编译来源；直接通用 runs 接口不可伪造工程身份。

Run: `node --import tsx scripts/verify-engineering-loop.ts`；失败例必须为 violated，修复例必须为 satisfied 且 completed=true。不得靠删除不变量取得通过。

## Task 5：前端设计资产与编辑

Files: 新增 apps/web/src/modeling/{EngineeringWorkbench,ModelCanvas,ModelInspector,BehaviorView,ModelSources,ProposalReview}.tsx、modeling.css；修改 App.tsx、agent-routes.ts。

- [x] 新任务入口“系统建模”，材料/设计/分析验证/证据决策子视图；不取代现有专家训练流程。
- [x] 创建/打开/导入/保存模型，显式保存状态和冲突保留；图拖动、连线、属性、增删对象、自动排版、撤销/重做；表格方式提供相同操作。
- [x] 架构/组网、部署、功能关系视图与独立时序图；故障来源/影响双维过滤仅影响显示，跨图选择同一对象。
- [x] 侧栏编辑组件、故障率/恢复时间、机制、成功条件和来源；草案显示新增/修改/删除及假设差异，支持接受或拒绝。
- [x] SVG/PNG 与 JSON 导出含版本标识；小屏属性纵向排列/表格局部滚动可用，键盘可定位编辑。

Run: `pnpm typecheck`、`pnpm exec playwright test tests/e2e/engineering.spec.ts`。

## Task 6：前端分析、形式化模型、结果与沉淀

Files: 新增 apps/web/src/modeling/{AnalysisPanel,EvidencePanel,LogicDiagram,DecisionPanel}.tsx。

- [x] RBD 和 FTA 按各自逻辑图显示并可通过结构化属性编辑；形式化源码/配置可编辑，P/企业模型保留原生内容和接口状态。
- [x] 校验并运行，轮询真实任务状态、取消、错误诊断、范围/假设、反例逐步查看；历史快照只读可重放。
- [x] 修改语义后旧结果提示过期；移动节点和显示筛选不影响计算输入摘要。
- [x] 保存设计决策、链接运行/来源并沉淀任务资产；对话修复方案不隐式改变性质。

Run: 相关 E2E 覆盖完整材料→草案→确认→图→真实求解→反例→修订→重新验证→资产→导出往返。

## Task 7：回归、实际 Agent 与交付

Files: tests/e2e/engineering.spec.ts、docs/2026-10-13-Agent工程闭环使用与适配.md、scripts/build-release.ts、README.md。

- [x] 核对 API/MCP/浏览器使用同一模型服务；测试 Agent 越权、导入绕过、取消/失败、历史快照与并发修订。
- [x] 用已配置原生 OpenCode 和合成专家材料实际生成一次模型/变更草案，保留可复核的会话和来源证据；记录所用模型名称，不记录凭据。无可用提供商时如实报告并保留已完成真实工具验证。
- [x] TypeScript、ESLint、Vitest、完整 Playwright、前端/MCP 构建；新增资源纳入离线包/发布扫描。
- [x] 用户服务空闲时更新本地实例，检查入口；使用指南说明方法边界、工具安装、内网适配与实际/未执行验证。
- [x] 完成结果记录、更新本计划证据；不自动推送或发布。

## 验收证据

implementation: completed（本计划范围）；engineeringValidation: passed；scenarioValidation: synthetic_passed；adoption: unknown；effect: unknown。

2026-10-13 实施与实测记录：

- 前后端共同使用 `ModelService`。保存和接受草案使用修订冲突检查及 SQLite 事务；Agent 不可直接保存、接受、导入结果或沉淀资产。来源可只提交 ID，由服务补齐不可变原文，避免大段文本/base64 复写；MCP 提案响应只保留审阅引用。
- 真实 Agent：OpenCode 1.18.35、已配置的 GLM-5.3，任务 `c0dc573a-3788-42b6-a614-76675c6e490b`，会话 `ses_ecb7cba27ffe1EbztNS8Vaivza`。从导入材料与空白模型生成架构/故障/机制/时序草案，随后由合成验收驱动模拟用户接受并绑定专家编写的原生分析案例。最初 highspeed 订阅权限错误、来源复写错误均保留为诊断并修正。
- `node --import tsx scripts/verify-engineering-loop.ts --agent` 及最终无 Agent 工具重放通过。RBD 0.9998599998019424，FTA 0.00014000019805763135。未加 fencing：TLC violated，9 generated / 6 distinct，4状态反例；加入 fencing：同一 SingleWriter 性质 satisfied，5 generated / 4 distinct。TLC 发布包1.7.4，自报2.19；SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。
- 完整 Vitest：**283通过、1跳过**；明确配置本机 Python 3.12.14 + 项目 NumPy/SciPy 依赖和 `TEST_OPENCODE_URL=http://127.0.0.1:4096`。跳过项仍为既有长耗时专家4000/2000采样核对，不宣称本轮执行。首次无 Python 配置时5项旧 CTMC 用例失败，定位为运行环境后使用已安装依赖重跑通过。MCP 最后增加轻量响应断言后单独复验通过。
- 完整 Playwright：**55通过**，包含桌面/390px手机、材料→草案→审阅→多视图→真实 BDD/TLC→决策→资产复用。截图检查发现并修复 React Flow 节点测量状态未保留导致画布空白的问题，新增可见节点断言。原有训练审核、报告、任务隔离和原生 Agent 回归均保留。
- TypeScript、ESLint、前端构建、独立 MCP 构建通过。工程画布按需加载，独立前端 JS gzip约88KB。本地软件包327文件；包含中文和空格路径的迁移、离线依赖安装、启动和 MCP 检查通过。适配示例已去除开发机绝对根路径。
- 实施验收时使用 artifacts 下独立临时 Git 索引扫描342文件及提交历史：**无发现**。随后用户明确要求“提交并推送”，授权将本轮代码、测试和文档提交并推送至 `codex/agent-engineering-loop` 分支；本地数据、凭据、运行产物和工具运行时不纳入提交。
- 用户本地服务确认无计算和 Agent 运行后更新；`http://127.0.0.1:5173` / API4178可用。已导入真实 Agent 产出的合成工程包，任务 `346c3d9d-6755-4f78-9e26-b527e71af72a`，以历史导入证据标识来源；浏览器实测可见7个系统对象。

证据：`artifacts/engineering-loop/{verification-agent,verification-tools,agent-messages,agent-proposal,engineering-model,vitest-final,publication-scan,local-demo}.json`，浏览器截图与 `artifacts/portability-validation.json`。使用/适配指南为 `docs/2026-10-13-Agent工程闭环使用与适配.md`。

范围：这是通用框架与合成闭环的工程验收；未替代真实集群参数校准、专家签认、P或公司现有工具实机验收。系统原生方法模型仍需专业审阅，完整 SysML、复杂时序组合片段和逐字段材料锚点属于后续演进。

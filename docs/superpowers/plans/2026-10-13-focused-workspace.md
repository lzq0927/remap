# ReMAP 聚焦工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. 用户要求计划后继续实施，采用本会话内顺序执行。

**Goal:** 让用户清楚知道正在处理哪个任务、哪一步，以及该核对哪个结果。

**Architecture:** 现有任务/设计/执行状态与数值契约保持不变，增加 UI 视图层。配置分区保持挂载、按当前步骤展示；专家结果按目的切换，所有视图共享冻结结果与规模。原生 OpenCode 外围控制收敛，App 提供显示上下文，同步接口从任务保存的设计生成真实步骤/修订/运行关联。

**Tech Stack:** 现有 React、TypeScript、CSS、Vitest、Playwright；不引入外部字体或新 UI 依赖。

---

## Task 1：步骤聚焦与上下文

Files：修改 `apps/web/src/App.tsx`、`AuditWorkbench.tsx`；创建 `WorkspaceViewTabs.tsx`、`workspace.css`；测试 `tests/e2e/focused-workspace.spec.ts`。

- [x] 写桌面/手机失败测试：新任务只有目标区可见；点击参数阶段后卡数输入隐藏、参数区可见；全部配置可见所有参数；切换回来值保留。
- [x] 执行 `node node_modules/@playwright/test/cli.js test tests/e2e/focused-workspace.spec.ts`，先确认缺少视图控制的失败。
- [x] 实现 `stage?:number`、步骤/全部配置 UI 状态与 `hidden` 分区：`visible = view==='all' || stage===sectionStage`。保留组件和字段状态，视图偏好只保存于浏览器，不发 design_update。
- [x] App 自动步骤推进调用已有 selectStep，并恢复步骤视图；当前结果在计算/交付阶段优先呈现。
- [x] 统一上下文/标题，清理假工作区编号；检查当前内容在固定栏下方可见。
- [x] 运行新测试与既有 navigation/automatic-audit 回归。

## Task 2：结果视图

Files：修改 `apps/web/src/AuditResult.tsx`、`ResultView.tsx`；复用 `WorkspaceViewTabs.tsx`、`workspace.css`；测试 `tests/e2e/focused-workspace.spec.ts`、contribution-display、report-attachments。

- [x] 写失败测试：默认概览；收益表/贡献表通过对应视图进入；切换保持当前规模及冻结数值；键盘方向键可选择视图。
- [x] 实现五种视图：overview/gains/contributions/risks/all。使用 `hidden={view!=='all'&&view!==sectionView}`，不改 r、Shapley 计算、排序或统计区间。
- [x] 将预算/组合详细参数默认折叠；概览保留主要判断与正确有效产出指标。
- [x] 旧流程与数值测试显式使用“全部配置/全部分析”偏好，新 UX 测试使用新默认。补充真实自动步骤跟随，避免只测完整旧视图。
- [x] 执行新 UX、贡献显示与附件测试，核对 1万/50万卡、负值、历史/缺失检查。

## Task 3：Agent 操作收敛与任务检索

Files：修改 `apps/web/src/OpenCodePanel.tsx`、`App.tsx`、`TaskHome.tsx`、`apps/api/src/agent-routes.ts`；测试 focused-workspace、ux、tasks、agent-integration。

- [x] 写失败测试：右侧显示当前真实步骤；Skill 主动作可见，其余管理动作在展开区；iframe 在折叠/切换步骤后保留。
- [x] App 传 `step:workflowSteps[stage].id` 和 `assessment:designMode`；给 Panel 单独传 stageName/inputRevision，显示当前任务上下文，不在每次渲染自动调用模型。
- [x] 同步接口以保存设计推导真实 step/stage/runId/inputRevision；模块名称白名单验证，不采信客户端覆盖。使用可替换 Agent 的集成测试核对任务、步骤、模块与修订。
- [x] 分组外围会话/连接管理操作，保留原有处理函数、原生模型/API 配置与 task-scoped MCP。
- [x] TaskHome 增加 `query` 本地过滤：`tasks.filter(t=>t.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))`，匹配数和空结果提示。保留所有管理功能。
- [x] 运行任务隔离、原生 OpenCode 和任务管理回归。

## Task 4：统一视觉与最终验收

Files：`apps/web/src/workspace.css`、`main.tsx`；更新使用文档与本计划完成状态。

- [x] 新 CSS 使用现有语义类的限定选择器；桌面/中屏/390px 手机布局、表格局部滚动、focus-visible、prefers-reduced-motion。
- [x] 检查六个页签、全新和已有任务、Agent 开/关、导出按钮及异常状态，保存验收截图到忽略的 artifacts/test-results。
- [x] 执行 TypeScript、ESLint、Vitest、完整 Playwright、前端及独立 MCP 构建，修复有证据的问题。
- [x] 更新使用指南、发布包含文件与计划完成项；服务空闲时更新本地运行实例，给出访问地址和关键改变。
- [x] 用户随后明确要求本轮也提交并推送；完成通用代码/文档范围审查，发布目标为 `main`，不将私有任务、密钥或本地配置纳入索引。

验收标准：任务与步骤定位清楚，默认配置视图不展示其它步骤完整表单；UI 切换不改输入修订或计算值；自动流程当前步骤可见；Agent 和中间工作区使用同一任务/真实 step ID；桌面/手机无页面横向溢出；所有原有数值、权限、任务资产和报告附件回归通过。

## 本轮实施与验收记录

- 2026-10-13：TypeScript、ESLint、前端构建、独立 MCP 构建均通过；完整 Vitest 261 通过、1 项默认关闭的长耗时专家核对跳过；完整 Playwright 53 通过，含原生本地 OpenCode、手机/桌面六模块、自动流程、历史结果、报告与离线附件。
- 新视图、历史运行规模、Agent 保存阶段/模块同步、失败/取消后的旧结果隐藏均先复现失败，再确认修复通过。标签页补齐键盘操作与 tab/panel 关联。
- 独立只读复审发现旧结果绕过步骤隐藏的问题；修复后复审通过，无新增阻断问题。只改变展示及 Agent 上下文元数据，可靠性算法、统计与单位未改变。
- 使用指南与发布包文件清单同步更新。输入和完整运行资产继续保存；新文档、代码与测试独立于本地数据。

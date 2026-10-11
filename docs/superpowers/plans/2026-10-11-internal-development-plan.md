# 内网开发与单向迭代实施计划

> **For agentic workers:** 使用 subagent-driven-development 执行独立实现与审查；连续推进，无需重复请求已批准的方案确认。

**Goal:** 让通用系统能够在内网使用企业模型和本地适配资产持续迭代，并提供明确、可执行的开发与版本导入流程。

**Architecture:** 保留 Agent + Skill + MCP 分层，增加运行环境策略与可信本地映射扩展。通用核心单向发布，企业代码与资产独立存放。

**Tech Stack:** TypeScript、Node.js 24、pnpm 11、本地 OpenCode 1.18.35、Vitest；现有 Python 数值工具保持不变。

## 1. 内网运行策略

- [x] 增加 packages/runtime-policy：严格解析 internal 配置，校验批准 origin、模型、回环 API/Agent 地址，输出无密钥诊断。
- [x] 接入 buildApp、输入模型请求、OpenCode 请求和任务配置生成；内网不继承外网 provider/MCP/插件，关闭分享/更新。
- [x] scripts/runtime.mjs 支持 RELIABILITY_ENV_FILE；内网 bootstrap 强制离线；内网 export:release 阻止通用发布。
- [x] 测试：`pnpm exec vitest run packages/runtime-policy tests/integration/internal-mode.test.ts`，预期外网地址被拒绝，批准的合成内网模型被接受，无密钥写入配置。

## 2. 企业映射适配接口

- [x] 增加 packages/extensions 的固定版本本地适配契约和加载器；配置决定可信模块，Agent/HTTP 不提供注册能力。
- [x] 接入输入映射预览，适配输出仍经过核心校验和用户确认；记录 adapter id/version 与输入来源摘要。
- [x] 提供仅含合成字段的适配示例与自动化验收，不改变默认导入行为。
- [x] 测试：`pnpm exec vitest run packages/extensions tests/integration/internal-adapter.test.ts`，预期错误契约/版本失败，合成企业列映射成功且不能越过确认。

## 3. 离线依赖准备

- [x] 新增纯 Node 的 offline:prepare / offline:verify 命令；显式目标目录、独立 store、摘要清单及防覆盖检查。
- [x] 按锁文件预取，离线验证用独立临时源目录和该 store 安装，不能借用现有 node_modules。
- [x] 清单明确 npm 依赖与 Node/OpenCode/Python/浏览器运行时的供给边界。
- [x] 测试清单破坏、平台/锁不匹配拒绝；实际执行独立 store 的离线安装验收。

## 4. 开发文档与验收

- [x] 提供内网 .env / JSON 示例、企业适配示例、受约束的内部 AI 开发任务模板。
- [x] 编写 docs/内网开发指南.md：首次部署、仓库布局、核心版本单向导入、企业适配、小任务开发、合成问题回传审批、真实数据验收、升级与回滚。
- [x] README 与发布包包含上述指南与无密钥示例。
- [x] 执行规格与质量审查，再运行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 及现有端到端测试；记录实际结果和企业侧待验事项。

## 版本与完成定义

本轮保留现有未提交成果，不做推送、合并或隐式提交。计划中已实现且验证通过的项改为完成。第一批软件能力完成不代表公司网络/真实模型验收完成；后者必须在内网执行，结果留在内网。

## 本轮完成记录

2026-10-11：上述实施与审查完成。完整发布验收通过，195 项自动化测试、14 项浏览器测试通过，9 项发布检查全部通过。独立离线依赖安装完成，515 个依赖复用、0 个下载。证据见 docs/内网开发实施与验收.md 和 artifacts/internal-development-validation.json。公司真实模型、真实资产、网络出口与第二台物理电脑验收仍由内网执行。

# 统一可靠性建模评估验证系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. If the user explicitly chooses delegated execution, use superpowers:subagent-driven-development instead. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划本身不启动开发或创建子 Agent。

**Goal:** 构建通用可靠性设计决策原型，从产品目标分解到子系统、组件和机制要求，通过可信计算、权衡和验证指导设计；首期跑通 AI 训练集群。

**Architecture:** 通用领域核心、场景包、独立求解器、工作流与资产服务、Agent 适配层、Skill、MCP 和 LUI 解耦。采用模块化应用和独立计算进程；先复现专家 V4 指定 HTML 的交付口径，再建设目标分解与完整交互，最后以非训练案例验证通用性。

**Tech Stack:** TypeScript、Node.js、pnpm workspace、React/Vite、Fastify、JSON Schema/Ajv、SQLite、官方 MCP TypeScript SDK、OpenCode HTTP/事件适配；Python/NumPy/SciPy 提供独立 CTMC 求解插件；Vitest、pytest、Playwright 验证。依赖版本在环境任务中验证并写入锁文件，不假定当前机器已经安装完整环境。

---

日期：2026-10-10。状态：计划完成，任务尚未执行。工作区：`D:\code\sys_reliability`。需求依据：[总体设计](../specs/2026-10-10-reliability-platform-design.md)、[澄清记录](../../2026-10-10-需求澄清记录.md)和项目根目录《系统可靠性工作计划.md》。用户已确认需求，当前交付物是计划文档。

## 1. 不可改变的验收口径

1. 产品层可用度为训练正确交付产出率：单轨迹 `delivery = P_correct(T) × I_clean_end(T) / W_ideal(T)`，产品结果取样本均值估计其期望。期末存在未恢复静默污染时，该轨迹交付为零。
2. 专家基准为仓库提交 `683afe829313bfdcb249bc593e48df5b29813666` 的根目录 `正确有效产出改进分析.html`，版本 `4.0-domain-ledger`、指标 `delivery`、窗口 720 小时。不得用 `catalogs/review-2026-10-09` 的不同交付判据替代。
3. 万卡 99%、十万卡 94.3% 作为产品目标示例；31.5 小时、约 3 小时 MTBF 单独保存，不编造两者换算。专家自带参数属于独立参考配置。
4. 同规模同口径下，不同代际/方案使用共同目标；同时展示绝对正确产出、理想吞吐基准与资源代价。
5. 首期以均值达标为主，呈现采样精度、分位数、单次达标概率；概率要求可选。模型内达标不自动成为生产保证。
6. 故障模式库、机制库是可独立维护的正式功能；参数证据库、模型/场景库、验证案例库和真实事件台账一并纳入。
7. 目标分配、损失记账、收益归因是不同功能；分配方案必须通过正向评估检查。
8. 时间按依赖与验收推进，能够提前完成就提前，不按月底倒排等待。

## 2. 子计划及执行顺序

| 子计划 | 任务 | 独立可交付结果 |
|---|---|---|
| [01 领域契约、资产库与输入](2026-10-10-01-domain-assets-inputs.md) | T01—T07 | 可运行的资产/输入/实验 API 和独立契约测试 |
| [02 可靠性计算与目标分解](2026-10-10-02-modeling-allocation.md) | T08—T16 | 可脱离 Agent 和界面运行的基准、工具与推荐服务 |
| [03 Agent、LUI、验证与交付](2026-10-10-03-agent-lui-delivery.md) | T17—T24 | 可交互原型、Skill/MCP 包、报告与端到端验证 |

主依赖链：`T01 → T02 → T03 → T08 → T09 → T10 → T13 → T17 → T18 → T19 → T21 → T23 → T24`。

可重叠的模块工作：T04/T05 在契约稳定后推进；T11/T12 在工具协议稳定后推进；T20 在资产 API 稳定后推进；T22 在运行事件结构稳定后推进。这里描述模块依赖，不要求增加 Agent。

## 3. 工程目录与职责

以下均为拟创建路径，根目录固定为 `D:\code\sys_reliability`；已有设计和背景文件保留。

```text
apps/
  api/src/                 HTTP API、应用组合、事件流
  web/src/                 LUI，不包含可靠性求解公式
  mcp/src/                 MCP 协议适配，调用领域服务
packages/
  contracts/               JSON Schema、共享 TS 类型、错误与事件契约
  domain/src/              模型语义校验、适用性、指标、版本规则
  assets/src/              SQLite 仓储、内容存储、快照、资产库
  ingestion/src/           文件解析、来源定位、变更监听
  workflow/src/            步骤状态机、持久化运行、队列与恢复
  solvers/src/             RBD、BDD、FTA、专家适配及求解插件接口
  allocation/src/          Equal、ARINC、AGREE、可用度预算
  analysis/src/            统计、敏感性、Shapley、搜索与方案对比
  agents/src/              AgentPort、OpenCode 适配器
  reports/src/             报告模型、Markdown/HTML/JSON 输出
solvers/ctmc/              Python 科学计算插件及 pytest
scenarios/                训练和非训练场景包、目标示例、可验证样例
skills/sd-dfr-remap/       可移植 SKILL.md 与六阶段参考材料
.opencode/                平台 Skill 安装副本/入口、命令与项目配置
references/expert-v4/      锁定来源记录及获准使用的参考快照
tests/                    跨模块、端到端、迁移与兼容性验收
scripts/                  开发启动、环境检查、基准、打包命令
docs/                     用户指南、方法卡、验收与演进说明
data/                     本地数据库与内容文件，忽略真实数据的 Git 提交
```

依赖方向：界面/Agent/MCP → 应用服务 → 领域及工具接口；领域核心不得引用 OpenCode、React 或数据库驱动。计算插件接收不可变 JSON 输入快照，不读取 UI 全局状态或聊天记录。

原型默认本机部署：界面和 API 共用本地入口；OpenCode 默认仅监听回环地址；求解器在独立子进程运行。无用户配置的模型端点时，资产维护和数值工具仍可工作，Agent/图文理解明确显示未连接。

## 4. 统一契约

### 4.1 对象标识和版本

所有资产使用 `id`、`revision`、`schemaVersion`、`contentHash`、`createdAt`。引用格式固定为 `{id, revision, contentHash}`。内容摘要由规范化 JSON 字段排序与 SHA-256 计算，排除时间戳等非语义运行元数据；运行配置、策略和随机种子另外纳入实验摘要。

指标独立标识：

```json
{
  "id": "training.correct_delivery_ratio",
  "version": "1.0.0",
  "aggregation": "mean",
  "terminalPolicy": "strict-clean-end",
  "unit": "ratio",
  "denominator": "ideal-work-in-window"
}
```

目标对象含 `metricRef`、`scenarioScope`、`scale`、`threshold`、`direction`、`horizonHours`、`optionalChanceConstraint`。`horizonHours` 与理想产出不可隐含在图表标签中。

### 4.2 长任务接口

```ts
type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type RunEvent = {
  runId: string; sequence: number; stepId: string;
  type: 'started' | 'progress' | 'artifact' | 'failed' | 'cancelled' | 'completed';
  payload: Record<string, unknown>;
};
type ToolResult = {
  runId: string; status: RunStatus; artifactRefs: AssetRef[];
  warnings: { code: string; message: string; objectId?: string }[];
};
type AssetRef = { id: string; revision: number; contentHash: string };
```

调用返回 runId 后通过事件流和查询获取结果。序号持久化、重连去重；任务取消后不发布“成功”结果。状态迁移、结果和审计事件在事务边界内保持一致。

### 4.3 错误与无结果状态

统一错误码：`SCHEMA_INVALID`、`UNIT_MISMATCH`、`REFERENCE_MISSING`、`REVISION_CONFLICT`、`METHOD_INAPPLICABLE`、`UNSUPPORTED_SEMANTICS`、`INSUFFICIENT_EVIDENCE`、`RESOURCE_LIMIT`、`RUN_CANCELLED`、`AGENT_UNAVAILABLE`。搜索无解返回 `no_candidate_found`；只有解析上界等证明才标记 `infeasible_under_model`。

## 5. 工具与交互入口

以下工具名为本项目领域接口名，不假定任何现有外部平台已提供：

| 工具 | 输入 → 输出 |
|---|---|
| `catalog.search/get/create_draft/validate/publish/deprecate` | 类型、版本、过滤或草稿 → 条目/校验/不可变发布版本 |
| `input.import/parse/diff/confirm` | 文件快照与模板 → 带来源候选模型/确认模型 |
| `model.validate` | 模型引用 → 结构、单位、语义与证据问题 |
| `method.recommend` | 任务、指标、模型、数据条件 → 方法、粒度和适用性依据 |
| `target.allocate` | 目标、分配策略、基线及约束 → 子目标、参数要求与假设 |
| `analysis.solve/compare/search` | 模型、方案及运行配置 → runId，完成后结果引用 |
| `analysis.sensitivity/attribute` | 有效实验集合 → 敏感性或 Shapley 归因 |
| `run.status/cancel/events` | runId/事件序号 → 状态、取消或增量事件 |
| `validation.run` | 验证案例与模型 → 验证证据 |
| `report.export` | 已完成实验与证据 → Markdown/HTML/JSON 资产包 |

MCP 能力采用官方 SDK 暴露，传输先支持本地 stdio，再提供 Streamable HTTP 以便迁移。长计算统一使用项目 runId 模式，避免绑定某一版本可选的长任务扩展。协议版本由能力协商和兼容测试决定，锁定结果写入 `docs/compatibility.md`。

## 6. 里程碑与退出条件

| 里程碑 | 任务 | 必须看到的结果 |
|---|---|---|
| M0 可复现底座 | T01—T03、T08 | 环境与来源清楚；严格交付指标和专家基准可核验 |
| M1 可维护领域资产 | T04—T07 | 新增模式/机制、关联证据、发布、实例化，旧快照不变 |
| M2 目标到方案的计算闭环 | T09、T10、T13—T16 | 目标分配、方案回算、敏感性、收益与风险解释齐全 |
| M3 完整交互原型 | T17—T21 | `/sd-dfr-remap` 经真实 OpenCode 和 MCP 完成输入到报告 |
| M4 通用性与交付验收 | T11、T12、T22—T24 | 其他方法、非训练案例、迁移包和回归证据通过 |

能够独立演示的里程碑完成即交付，不等待全部阶段结束。完整原型验收需要 M4；训练首个闭环可在 M2/M3 展示。

## 7. 验证标准与命令契约

任务首次编写时先运行有业务意义的失败样例，再实现到通过；纯文案/样式不增加镜像测试。所有命令在项目根目录执行；这些命令由对应任务创建，当前文档完成不代表命令已经存在或测试已通过。

```powershell
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:expert
pnpm test:e2e
uv run --project solvers/ctmc --extra test pytest
pnpm verify:release
```

`verify:release` 汇总上述适用检查及来源/版本清单。真实 Agent 验收使用已配置的模型连接；替身测试可测故障路径，但不能替代 `/sd-dfr-remap` 实际加载和工具调用成功。缺少实测数据时，现实验证状态必须保留为未验证，不阻止演示模型内部一致性，也不得宣称达到生产准确度。

解析算法小型基准误差默认 `1e-10` 绝对值；概率归一误差 `1e-10`；专家原样适配同配置同种子轨迹按 `1e-9 × max(1,T)` 时间容差核对，不依靠随机置信区间掩盖适配误差。新仿真与解析式对照采用事先声明样本量及误差准则，不反复试种子直到通过。

性能基准记录机器、模型规模、轨迹数、计算时间、峰值内存和取消延迟。预览与正式评估分开配置；正式运行使用保存的固定样本量/独立复核样本，避免未经论证的自适应停止让置信区间失真。

## 8. 范围、证据和演进

首期支持单训练作业；多作业调度、全产品生产模型、3D 数字孪生、企业权限和任意模型形式化验证保留为后续能力。AI 系统、NTN、传统产品均有入口和模板状态，但只有通过案例验证的组合可标为可评估。

真实参数由内网用户输入，外网开发不等待敏感资料。参考和合成条目带明确标签；库发布代表通过约定结构与语义校验，不自动代表真实测量可信。

运行反馈记录完成率、失败率、人工修正率、采纳/修改/拒绝及原因。方法研究默认配置为每月一次可手动触发的研究任务；调度器开关默认关闭，部署时由用户启用。研究输出只形成候选更新，经回归和版本发布后生效。

## 9. 当前环境与实施前检查

当前只有需求/设计文档，无项目代码与 Git 仓库。已发现 Node、npm、pnpm 和 Git 命令；Python 路径是 WindowsApps 入口，不能据此认定可运行；未发现 uv 和 OpenCode 命令。T01 负责检查实际版本和准备缺项。

默认 Codex 沙箱此前因 `node_repl.exe` 文件占用导致启动失败；授权沙箱外执行和文档写入可用。该问题独立于目标产品。开始开发前先复测普通执行；若持续失败，保留日志并按允许的执行路径工作，不改写安全配置或强制终止归属不明的其他任务。

## 10. 计划完整性检查

- [x] 指定 HTML 指标、终态规则、参数版本与其他审核分支隔离。
- [x] 可维护资产库、真实事件台账、文件解析与变更监听均有任务。
- [x] Equal/ARINC/AGREE/Availability、模型搜索和正向回算均有任务。
- [x] RBD、FTA/BDD、CTMC、仿真与通用案例均有任务。
- [x] OpenCode、可迁移 Skill、MCP、LUI、报告与复现均有任务。
- [x] 数据/实现/交叉/现实四类验证、运行反馈与研究更新均有任务。
- [x] 未将当前计划写作、网页核对或参考结果当作已执行的软件测试。

参考依据：[OpenCode Server](https://opencode.ai/docs/server/)、[Skills](https://opencode.ai/docs/skills/)、[Commands](https://opencode.ai/docs/commands/)、[Agent Skills 规范](https://agentskills.io/specification)、[MCP 规范](https://modelcontextprotocol.io/specification/2026-07-28)、[SciPy 矩阵指数计算](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.expm_multiply.html)、[NASA 分配方法适用性](https://ntrs.nasa.gov/citations/20160013858)。版本兼容性以实施环境中的验证记录为准。

# 子计划 01：领域契约、资产库与输入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Follow T01—T07 with checkbox tracking; do not implement numerical methods inside storage or UI code.

**Goal:** 提供可独立运行和验证的领域契约、可维护资产库、文件输入与实验管理。

**Architecture:** JSON Schema 定义交换契约；领域规则与存储分离；SQLite 保存元数据与任务，文件内容按摘要存储。API 和 MCP 共用同一应用服务。

**Tech Stack:** TypeScript、Node.js、pnpm、Ajv、SQLite、Fastify、Vitest；解析库在 T06 用格式样例验证后固定版本。

---

依赖与总体验收见[总计划](2026-10-10-reliability-platform-plan.md)。所有文件路径相对项目根目录 `D:\code\sys_reliability`；均为拟创建文件，除非明确标注修改。步骤完成并检查差异后进行局部 Git 提交，不提交数据、凭据或依赖目录。

## T01 环境、工程骨架与可运行检查

**文件：** `package.json`、`pnpm-workspace.yaml`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`、`.env.example`、`scripts/doctor.mjs`、`scripts/dev.ts`、`docs/environment.md`。

- [ ] 运行 `node --version`、`pnpm --version`、`git --version`、`python --version`、`uv --version`、`opencode --version`，记录可执行位置、实际版本及缺项；Python WindowsApps 入口不能当安装成功。选定支持的 Node LTS 与 Python 版本，验证后固定到环境文档与锁文件。
- [ ] 按官方安装方式准备缺项；安装范围限开发环境，不改变默认沙箱安全策略。安装后重复版本检查。
- [ ] 初始化 Git，保留并提交现有需求与设计文档。创建 workspace，设置 `strict: true`，忽略 `node_modules/`、`.venv/`、`data/`、`.env`、运行日志和本地凭据。
- [ ] 配置下列根脚本；每个脚本指向实际文件或明确测试目录，禁止以空脚本返回成功。

```json
{
  "scripts": {
    "doctor": "node scripts/doctor.mjs",
    "dev": "tsx scripts/dev.ts",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run packages",
    "test:integration": "vitest run tests/integration",
    "test:expert": "vitest run tests/expert",
    "test:e2e": "playwright test",
    "verify:release": "tsx scripts/verify-release.ts"
  }
}
```

- [ ] `doctor.mjs` 检查运行时、可写 data 目录、端口和配置状态；只输出密钥是否已配置，不输出值。`dev.ts` 分别管理 API、Web 和可选 OpenCode 进程，退出时只清理它自己启动的进程。
- [ ] 创建 `tests/integration/health.test.ts`，启动 Fastify 测试实例并断言 `GET /health` 返回 `{status:'ok'}`；先确认接口缺失导致失败，再实现 `apps/api/src/server.ts` 与 `apps/api/src/routes/health.ts`。
- [ ] 执行 `pnpm doctor`、`pnpm exec vitest run tests/integration/health.test.ts`；预期健康接口通过，缺少模型配置仅报告 Agent 未连接。

## T02 交换契约与语义校验

**文件：** `packages/contracts/schema/{common,catalog,scenario,target,run,result}.schema.json`、`packages/contracts/src/{types,errors,events}.ts`、`packages/domain/src/{validate,units,compatibility}.ts`、`packages/domain/test/validate.test.ts`。

- [ ] 建立 JSON Schema，并生成/导出同一份 TS 类型。通用记录包含 AssetRef、版本、内容摘要、证据引用；场景必须声明指标、终态策略、窗口、工作负载、组件图、故障源、机制、参数和运行配置。
- [ ] 故障率结构使用 `basis` 区分 `device-hour`、`job-hour`、`call`、`task`，保留分母暴露量和单位；禁止无转换条件地混加。硬件 FIT 转换固定为 `ratePerHour = FIT / 1e9`。
- [ ] 增加条件化参数匹配规则：型号、代际、软件版本、负载、环境与证据等级；多个匹配值必须返回候选和冲突，不能静默选择最新数值。
- [ ] 按以下独立测试表先构造失败用例，再实现单位/引用/语义校验。

```ts
test.each([
  ['FIT_1000', 1000 / 1e9, 'device-hour', 'ok'],
  ['probability_negative', -0.1, 'task', 'SCHEMA_INVALID'],
  ['probability_over_one', 1.1, 'call', 'SCHEMA_INVALID'],
  ['missing_failure_reference', 0, 'task', 'REFERENCE_MISSING'],
  ['mix_device_and_job_exposure', 0, 'job-hour', 'UNIT_MISMATCH']
])('%s has an explicit validation outcome', (id, value, basis, expected) => {
  expect(validateFixture(id, {value, basis}).status).toBe(expected);
});
```

`validateFixture` 是本测试文件的样例构造器：按 id 生成最小完整场景并调用 `packages/domain/src/validate.ts` 导出的 `validateScenario`；各 id 的输入事实以上表为准，不用生产代码生成预期值。

- [ ] 将测试命令固定为 `pnpm exec vitest run packages/domain/test/validate.test.ts`；要求错误包含对象 ID、字段路径和可操作原因。

## T03 严格交付指标与目标契约

**文件：** `packages/domain/src/metrics/{delivery,registry}.ts`、`packages/domain/test/delivery.test.ts`、`scenarios/training/metrics.json`、`scenarios/training/targets.example.json`。

- [ ] 写失败测试，分别覆盖期末干净、仍有污染、零理想工作量和超界进度；下面两个核心断言必须保留。

```ts
expect(deliveryRatio({correctWork: 600, idealWork: 720, unresolvedPollution: true})).toBe(0);
expect(deliveryRatio({correctWork: 600, idealWork: 720, unresolvedPollution: false})).toBeCloseTo(5 / 6, 12);
```

- [ ] 指标的纯函数实现如下；仿真内部微小浮点误差先在有记录的数值容差层处理，不能在指标层静默裁剪重大错误。

```ts
export function deliveryRatio(x: {
  correctWork: number; idealWork: number; unresolvedPollution: boolean;
}): number {
  if (!Number.isFinite(x.idealWork) || x.idealWork <= 0 ||
      !Number.isFinite(x.correctWork) || x.correctWork < 0 || x.correctWork > x.idealWork) {
    throw new Error('INVALID_WORK_DENOMINATOR_OR_PROGRESS');
  }
  return x.unresolvedPollution ? 0 : x.correctWork / x.idealWork;
}
```

- [ ] 注册 `training.correct_delivery_ratio@1.0.0`、`strict-clean-end` 和 `mean`；运行可用度使用另一个指标 ID。目标表写入万卡 0.99、十万卡 0.943，并标记为用户目标示例；不写入隐式 MTBF 推导。
- [ ] 运行 `pnpm exec vitest run packages/domain/test/delivery.test.ts`；预期污染样例必须为零，不能返回最后干净检查点比率。

## T04 资产库持久化和不可变发布版本

**文件：** `packages/assets/migrations/001_assets.sql`、`packages/assets/src/{database,catalog-service,catalog-repository,content-store}.ts`、`packages/assets/test/catalog.test.ts`、`apps/api/src/routes/catalogs.ts`。

- [ ] 创建 asset_revision、asset_reference、evidence 和 audit_event 表。核心主键为 `(asset_id, revision)`，引用必须包含精确 revision；数据库启用外键和事务。

```sql
CREATE TABLE asset_revision (
  asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('draft','validated','published','deprecated')),
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(asset_id, revision)
);
CREATE TABLE asset_reference (
  owner_id TEXT NOT NULL, owner_revision INTEGER NOT NULL,
  target_id TEXT NOT NULL, target_revision INTEGER NOT NULL,
  relation TEXT NOT NULL,
  FOREIGN KEY(owner_id, owner_revision) REFERENCES asset_revision(asset_id, revision),
  FOREIGN KEY(target_id, target_revision) REFERENCES asset_revision(asset_id, revision)
);
```

- [ ] 先写服务测试：发布故障模式 v1 后修改 payload 返回 `REVISION_CONFLICT`；复制产生 v2；弃用 v1 后历史引用仍可解析；被引用记录物理删除被拒绝。然后实现状态流转与事务审计。
- [ ] API 提供 `/catalogs/:kind/items` 检索/新建、`/:id/revisions/:revision` 读取、`/validate`、`/publish`、`/deprecate`、`/fork`；发布动作校验调用者明确确认标记和验证结果。
- [ ] 为 failure-mode、mechanism、parameter-evidence、scenario-template、validation-case 五种类型提供同一生命周期；真实 incident 台账另建类型，支持根因去重关联，不复用模式记录作为事件。
- [ ] 运行 `pnpm exec vitest run packages/assets/test/catalog.test.ts`，重启 API 后再读取已发布样例，结果和摘要一致。

## T05 项目实例化、覆盖关系与证据快照

**文件：** `packages/assets/src/{instantiate,snapshot,impact}.ts`、`packages/domain/src/mechanism-coverage.ts`、`packages/assets/test/snapshot.test.ts`、`scenarios/training/catalogs/{failure-modes,mechanisms,parameters}.json`。

- [ ] 建立机制与故障模式多对多关系，区分触发、检测、隔离、恢复；约束引用存在、前置机制可满足、互斥组合不可同时启用。覆盖率随故障类型/范围记录，不能把一个组件内的覆盖率作为全系统覆盖率。
- [ ] 编写快照用例：项目引用机制 v1 的恢复时间 180 秒；发布 v2 为 120 秒后，旧项目快照仍为 180 秒，新项目显式升级后为 120 秒，并显示差异与覆盖原因。
- [ ] 组合快照包含完整目标、模型、引用库内容、参数证据和策略，不仅保存可失效的外部路径。内容摘要不同则产生新实验版本。
- [ ] 种子库采用专家条目与合成示例，逐条保留来源、条件和证据标签；不能给未知软件失败概率补零。
- [ ] 运行 `pnpm exec vitest run packages/assets/test/snapshot.test.ts`；断言库升级前后旧 run 的输入摘要和结果引用不变。

## T06 文件解析、模板、来源定位与更新

**文件：** `packages/ingestion/src/{parser-port,registry,import-service,watch-service,structured-review}.ts`、`packages/ingestion/src/parsers/{json,csv,xlsx,markdown,pdf,image}.ts`、`templates/{architecture,failure-modes,mechanisms,parameters}.json`、`tests/fixtures/input/`、`packages/ingestion/test/import.test.ts`。

- [ ] 为解析器定义固定接口；解析只输出候选资产，不能自行发布。

```ts
export interface ParseRequest {
  inputRef: {id: string; revision: number; contentHash: string};
  mediaType: string; templateId?: string;
}
export interface CandidateField {
  objectId: string; path: string; value: unknown;
  source: {inputId: string; page?: number; sheet?: string; row?: number; cell?: string; box?: number[]};
  status: 'extracted' | 'ambiguous' | 'missing';
}
export interface ParseResult { fields: CandidateField[]; issues: {code: string; message: string}[] }
export interface Parser { supports(mediaType: string): boolean; parse(x: ParseRequest): Promise<ParseResult> }
```

- [ ] 制作同一最小系统的 JSON/CSV/XLSX/Markdown/PDF/PNG 样例，已知两节点和一条依赖；XLSX 参数为 1000 FIT，CSV 引号内含逗号，PDF 有页号来源，图片含一个特意模糊的标签。
- [ ] 对结构化格式做确定性解析；PDF 优先文本/表格提取，扫描页走配置的视觉/OCR 能力；图片通过已配置多模态模型输出受 schema 约束的候选字段。模糊标签保留 ambiguous，禁止猜测后发布。
- [ ] 缺少模型连接时，PDF 可提取文本部分继续，图片理解返回 `AGENT_UNAVAILABLE` 并提供手工录入/确认入口；集成验收必须用配置好的真实模型完成一个图片样例。
- [ ] 实现扩展名/MIME、大小和引用路径检查，上传内容不可当作指令执行；监听仅针对用户配置目录，变化后生成新输入快照与差异，不覆盖运行中输入。
- [ ] 运行 `pnpm exec vitest run packages/ingestion/test/import.test.ts`；XLSX 的 1000 FIT 保留来源单元格，图片歧义阻止直接确认，文件修改后旧快照摘要不变。

## T07 持久化流程、长任务与错误恢复

**文件：** `packages/workflow/src/{state-machine,run-service,worker-host,event-store}.ts`、`packages/assets/migrations/002_runs.sql`、`apps/api/src/routes/{runs,events}.ts`、`packages/workflow/test/lifecycle.test.ts`。

- [ ] 建立六个步骤：clarify、describe、select、prepare、evaluate、validate-deliver；每步状态为 pending/running/needs-input/completed/failed，输入与输出绑定资产引用。改动上游后下游标记 stale，历史结果保留。
- [ ] 创建实验状态机 queued→running→succeeded/failed/cancelled；持久化输入快照、代码版本、种子、事件序号和结果引用。
- [ ] 写失败用例：同一个运行请求幂等键提交两次只创建一个 run；中断重启后 running 记录转为需要重跑，不伪装为完成；取消后完成回调不得发布成功结果。
- [ ] Worker 使用独立进程，JSON 输入来自快照、输出进入暂存区，校验通过才原子发布。错误与 stderr 限长保存；终止仅针对本 run 启动的子进程。
- [ ] 实现 `GET /runs/:id`、`POST /runs/:id/cancel` 和带 sequence 的 SSE；客户端重连从已确认序号续读，重复事件不能导致重复资产。
- [ ] 运行 `pnpm exec vitest run packages/workflow/test/lifecycle.test.ts`，预期失败/取消/重启三条路径均可解释且不污染最近完整结果。

## 本子计划退出条件

- [ ] 五类库和事件台账可以经 API 维护，发布、引用和快照规则通过测试。
- [ ] 六类输入均有实际解析路径、来源定位和缺失条件处理。
- [ ] 主指标严格遵循期末污染归零，目标和预测参数隔离。
- [ ] 运行状态、事件、取消、重启和上游变化可追溯。

# ReMAP：可靠性设计与评估

Reliability Modeling and Analysis Platform — 系统可靠性建模评估验证平台。

前端现状分析、官方资料调研及本轮工作台优化见[现状与调研](docs/2026-10-13-前端现状分析与业界调研.md)、[实施计划](docs/superpowers/plans/2026-10-13-focused-workspace.md)、[聚焦工作台指南](docs/2026-10-13-聚焦工作台使用指南.md)。报告正文与完整离线技术附件见[报告导出指南](docs/2026-10-13-报告摘要与离线技术附件.md)。

本轮完整数值复现、默认组合和报告变化见[专家原始配置复现验收](docs/2026-10-12-专家原始配置复现验收.md)。最新验收范围、逐环节证据和未完成项见 [目标达成审计](docs/2026-10-12-目标达成审计.md)。

工作台新增与专家 2026-10-09 审核对齐的事件/机制评估：独立事件库、内网中断数据替换、硬件目标 FIT、恢复链顺序、组合 Shapley、敏感性及完整 HTML 审核报告。方法和两种训练指标的区别见 [事件机制审核与指标分配](docs/事件机制审核与指标分配.md)。

新专家任务默认采用专家复现采样（主场景4000、Shapley每子集2000、敏感性每点2000），五规模曲线包含1000卡参考点；万卡、十万卡、二十万卡、五十万卡的正确有效产出目标分别为 99%、95%、90%、80%；专家参考中断 MTBF 约为 30、3、1.5、0.6 小时。目标与故障率独立给定，内网更新故障 FIT / 占比后重新计算 MTBF、损失及机制收益。报告按专家八个审核章节组织，事件库与逐机制对照可切换规模，默认复现50万卡的静默检出率、弹性协调暂停、step上限13点扫描；漏检时延可在扩展16点扫描中选择。快速试算为128 / 64 / 128条，报告明确标识低采样和与原始配置的差异，不能用作正式达标确认。

本地单用户多任务可靠性设计工作台，支持 AI 训练集群和传统系统。AI 系统与 NTN 扩展入口尚未实现。数值求解独立于 Agent，OpenCode 的模型和提供商由官方界面管理。

## 安装与启动

Linux 云端开发可按 [云端开发指南](docs/云端开发指南.md) 初始化依赖、浏览器与本地工具状态，并执行验收。

公司内网部署与持续开发请先阅读 [内网开发指南](docs/内网开发指南.md)。通用核心版本单向导入内网，企业代码、模型配置和真实资产留在内网；实现范围和验收见 [实施计划](docs/superpowers/plans/2026-10-11-internal-development-plan.md)。

从 GitHub 导入的新电脑请按 [Git 拉取与内网部署](docs/Git拉取与内网部署.md) 操作。功能范围、模块接口和待扩展能力见 [ReMAP 优化与发布审查](docs/2026-10-11-ReMAP优化与发布审查.md)。

需要 Node.js 24 或更新版本、pnpm 11。依赖版本由锁文件固定。Python/SciPy 仅供 CTMC；OpenCode 仅供 Agent 功能。

```powershell
pnpm install --frozen-lockfile
pnpm bootstrap
pnpm run doctor
pnpm dev
```

没有安装 Node 依赖时，也可运行 `node scripts/launch.mjs bootstrap --install`。使用已缓存依赖时可追加 `--offline`。

开发界面默认 [127.0.0.1:5173](http://127.0.0.1:5173)，API 默认 [127.0.0.1:4178](http://127.0.0.1:4178)。生产启动先运行 `pnpm build`，再运行 `pnpm start`，直接打开 API 地址。端口和数据目录由软件目录的 `.env` 配置；bootstrap 保留已有配置与 Skill。

也可从其他当前目录执行 `node "<软件目录>/scripts/launch.mjs" start`。启动器从自身位置定位依赖、静态资源、模板和数据根，不使用开发者目录。

## 新建任务并评估

1. 打开任务主页，明确新建或打开任务；首页不会自动选择上次任务。
2. 在任务内选择产品场景，调整目标、窗口、结构、机制和输入来源。
3. 默认审核工作台按“目标与口径 → 故障与证据 → 预算与措施 → 参数核对 → 计算与权衡 → 验证与交付”操作；分配六项损失预算并确认前四阶段。主入口统一为“可靠性设计与评估”；旧 V4 仅在“高级设置 → 历史模型”中选择，复用同一套确认流程，无需重复完成两套流程。
4. 执行评估并查看计算过程、采样区间和限制。未确认前序阶段时仍可做独立评估；正式交付需在当前流程中重新评估并人工确认。
5. 下载报告、记录方案反馈。任务输入、私有资产、运行、流程和关联会话分别保存。

任务可重命名、复制、归档和重新打开。任务包的导出/导入入口位于主页；历史运行和输入摘要保留，导入生成独立任务，新机器需要重新关联 OpenCode 会话。

## 本地 OpenCode

```powershell
pnpm agent
```

启动脚本检测项目内已安装 OpenCode、`OPENCODE_BIN` 或 PATH。已有服务时配置 `OPENCODE_URL`；脚本检测健康服务后保留它。可用 `START_AGENT=1` 同开发服务启动。Agent 离线时仍可做本地数值评估。

在工作台创建具名主会话或专题会话，列表仅显示当前任务绑定的会话。点击「同步当前设计」只写入摘要；完整设计由任务 MCP 工具读取。在官方输入框运行 `/sd-dfr-remap`。模型、API Key、自定义 Base URL 在官方设置中配置，工作台不会代替官方提供商选择。

非结构化提取模型使用 `.env` 中的 `MODEL_BASE_URL`、`MODEL_API_KEY` 和 `MODEL_ID`，与原生 OpenCode 提供商分开。doctor 不发起模型请求；指定 GLM 的真实对话、流式和工具调用尚未验收。

## 资产与数值边界

新任务默认专家审核口径：期末仍有污染时保留最后干净检查点。历史模型 V4 使用终态污染整任务清零，已有任务保留原口径。MTBF 单独记录。保留历史 V4、RBD/FTA/BDD 共享事件求解、CTMC、比较、搜索、敏感性、Shapley 和子模型分配。

私有资产校验并冻结后，可核对适用条件并应用到训练。示例和公共资产只读，复制到任务后保留来源/版本。可提交公共库候选；公共发布当前未启用，需要独立审核身份与发布批准。冻结版本与历史运行快照保持不变。

真实输入可使用 JSON/CSV/XLSX，模板见 [templates](templates)。文件监听限定在各任务的 `workspace/inputs`，实际目录见任务界面；文件变化追加到该任务的待确认输入。旧全局 `WATCH_ROOTS` 配置已弃用。数学求解可复现不等于产品参数已校准，达标结论仍受证据与模型假设限制。

CTMC 可选环境（全量数值测试和发布验收需要此依赖）：

```powershell
python -m pip install --target solvers/ctmc/.python-deps -r solvers/ctmc/requirements.txt
pnpm run doctor
```

可在本机 `.env` 指定 `PYTHON_EXECUTABLE`。Windows 也检测 `py -3`；缺少 Python/SciPy 会报告 CTMC 不可用，其他求解器仍可使用。

## 迁移与软件分发

先启动 API，再使用任务 CLI：

```powershell
pnpm task:export <taskId> <任务包.json>
pnpm task:import <任务包.json> "新的任务名"
pnpm task:migrate --dry-run
pnpm task:migrate --apply
pnpm bootstrap --task <taskId>
pnpm run doctor --task <taskId>
```

旧数据迁移默认只预检。实际迁移前停止旧服务，保留原数据库；新 API 生成备份和迁移清单，同一源重复迁移不会复制第二份。未完成旧运行按中断语义处理，不宣称自动续算。CLI 默认连接回环 API；`RELIABILITY_API_URL` 可调整端口。

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm export:release
pnpm verify:portable
pnpm verify:release
```

软件包输出到 `release/rem-prototype-0.1`，包含源代码、构建后界面、Skill、模板和清单，排除用户任务、凭据、本机配置和依赖目录。目标机器需安装锁定的 Node 依赖，可选择安装 Python 和 OpenCode。此包不是免安装可执行程序。

`verify:portable` 在本机含空格/中文的新目录中检查发布清单、启动与任务往返；它不等同于另一台物理电脑或另一 Agent 的验收。独立 MCP 网关需要连接评估 API；完整软件包才包含领域服务与求解器。依赖与边界见 [部署与迁移](docs/部署与迁移.md)，操作演示见[使用指南](docs/2026-10-11-评估系统使用指南.md)。数值方法见 [numerical-methods](docs/numerical-methods.md)。

专家数值复现验收：`node --import tsx scripts/verify-expert-reproduction.ts`。执行实际仿真并对照原报告55组场景、四规模Shapley和13个扫描点，产物写入 `artifacts/expert-reproduction`；这是完整采样检查，耗时明显高于常规单元测试。

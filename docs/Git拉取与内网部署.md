# 从 Git 拉取 ReMAP 并在内网部署

仓库：`https://github.com/lzq0927/remap.git`。其中包含通用代码、文档、公开参考和合成示例，不含公司数据、密钥或已安装依赖。按公司政策批准导入；禁止直连外网时，由批准渠道导入 Git bundle 或软件包。详细适配、版本升级和回滚见 [内网开发指南](内网开发指南.md)。

## 1. 导入代码

在公司允许只读访问 GitHub 的情况下：

```powershell
git clone https://github.com/lzq0927/remap.git D:/reliability/core
cd D:/reliability/core
git rev-parse HEAD
git remote remove origin
# 如需内网共同开发，使用公司管理员提供的仓库地址：
git remote add origin <公司内网Git地址>
```

不允许直接拉取时，按内网指南的批准分支 Git bundle 流程导入。内网代码与数据不向外推送。记录批准的提交 ID；企业适配代码放在独立内网仓库，真实数据放在核心源码之外。

## 2. 准备运行时与离线依赖

目标机器需要 Node.js 24+、锁文件指定的 pnpm 11.25.0、本地原生 OpenCode 1.18.35。Python/NumPy/SciPy 仅用于 CTMC；Playwright 浏览器仅用于界面回归测试。原生 Agent SDK/缓存也要按内网指南单独预置并验收。

在批准的外网准备机、相同 OS/架构、同一源码版本执行：

```powershell
pnpm install --frozen-lockfile
pnpm offline:prepare --output D:/delivery/remap-offline-deps
pnpm offline:verify --bundle D:/delivery/remap-offline-deps
```

将该依赖包和批准的运行时经合规渠道导入。依赖包不在 Git 中，不可仅 clone 后就假定能断网安装。原始依赖包保留不动，复制其 store 用于安装。

## 3. 配置企业模型和数据目录

在内网 PowerShell 执行：

```powershell
cd D:/reliability/core
New-Item -ItemType Directory -Force D:/reliability/local,D:/reliability/data,D:/reliability/runtime | Out-Null
Copy-Item config/internal.example.json D:/reliability/local/internal.json
Copy-Item config/internal.env.example D:/reliability/local/runtime.env
```

编辑这两个本机文件：JSON 填公司批准的 `allowedOrigins`、模型 Base URL、模型 ID；env 指定 JSON 绝对路径、外部 DATA_DIR、本机原生 OpenCode 路径和密钥环境值。JSON 只保存密钥变量名。第一次配置使用新的终端，避免遗留外网模型环境变量。公司模型接口实际对话、流式响应和工具调用需要本地合成任务验证。

## 4. 安装与启动

```powershell
$env:RELIABILITY_ENV_FILE = 'D:/reliability/local/runtime.env'
node scripts/offline-bundle.mjs verify --bundle D:/reliability/delivery/remap-offline-deps
Copy-Item D:/reliability/delivery/remap-offline-deps/store D:/reliability/runtime/pnpm-store -Recurse
node scripts/launch.mjs bootstrap --install --store-dir D:/reliability/runtime/pnpm-store
pnpm build
pnpm run doctor
pnpm agent
```

`pnpm agent` 保持运行；另开 PowerShell 启动工作台：

```powershell
cd D:/reliability/core
$env:RELIABILITY_ENV_FILE = 'D:/reliability/local/runtime.env'
pnpm start
```

浏览器打开 `http://127.0.0.1:4178`。开发调试可用 `pnpm dev` 和 `http://127.0.0.1:5173`。所有启动终端选择同一份内网配置，内网安装强制离线，缺少依赖会停止。

## 5. 第一次使用

1. 新建任务，选择 AI 训练集群或已支持的传统系统；示例值仅用于演示，替换并确认实际目标/窗口/参数。
2. 将架构、故障与机制文件放入界面显示的当前任务 inputs 目录，或上传文件；检查解析结果和来源，人工确认后查看映射预览。
3. 复用公共资产时先复制到任务私有库，校验并固定版本。企业适配模块由管理员按固定接口安装，不能由上传文件执行代码。
4. 右侧本地 OpenCode 使用当前任务主会话，选择公司模型，输入 `/sd-dfr-remap`。Agent 会把阶段产物写入中间流程，等待用户核对确认后继续。
5. 前四阶段确认后执行正式评估，检查指标口径、假设、区间、风险与方案收益，最后确认交付并下载报告。

完整演示见 [评估系统使用指南](2026-10-11-评估系统使用指南.md)。数值工具可独立运行；没有模型时也可在工作台操作。当前是本地单用户原型，不能直接当公司多人生产服务部署。公司数据、日志、模型配置、报告及内网补丁始终留在内网。

# 在 GitHub Codespaces 开发和测试 ReMAP

仓库为 `lzq0927/remap`。Codespaces 是独立开发环境；本机、当前 Codex 云端目录和 Codespace 通过 Git 同步已提交代码。任务数据库、运行记录、聊天及模型凭据不会随 Git 自动迁移。

## 新建

打开 [创建 ReMAP Codespace](https://codespaces.new/lzq0927/remap?ref=main)，登录你的 GitHub 账号，选择 `main` 和仓库提供的 **ReMAP cloud development** 配置，然后创建环境。配置要求至少2核、8GB内存；最终机器与计费设置以 GitHub 页面为准。

仓库 `.devcontainer` 提供 Python 3.12 / Debian Bookworm、Node.js 24、pnpm 11.25.0、GitHub CLI、Chromium 和中文字体。创建后自动运行 `scripts/setup-cloud.sh`：按锁文件安装Node/OpenCode依赖，安装CTMC的NumPy/SciPy/pytest，准备本机配置与Skill并执行doctor。初始化结束会显示 `ReMAP ready`。

如果你先前已经创建了没有此配置的Codespace，拉取最新代码后，在命令面板执行 **Codespaces: Rebuild Container**。初始化保留已有 `.env`，不会自动启动模型对话。

## 启动和预览

VS Code默认终端使用ReMAP配置，自动加载 `scripts/cloud-env.sh`。启动：

```bash
pnpm dev
```

在 **Ports** 中打开5173端口；Codespaces会提供HTTPS预览地址。端口默认保持 **Private**，不要将任务服务改为Public。Vite只额外允许当前Codespace及当前Web端口对应的预览主机名；其他主机仍受原有主机检查约束。

API在环境内部监听4178，由5173的同源 `/api` 代理访问，不需要另外公开API。右侧Agent按任务自动启动独立OpenCode，使用20000–55000端口中的一个。配置为该范围提供转发提示；浏览器面板把服务端回环URL转换为同一Codespace相应端口的HTTPS地址，后端SDK和MCP仍通过环境内回环地址访问。

如果任务Agent端口尚未自动转发，在Ports中添加当前任务使用的端口（面板“独立打开”链接的HTTPS主机名中可见端口号），保持Private。私有端口首次访问可能要求GitHub认证：先在新窗口打开该任务OpenCode，完成访问认证后刷新面板。不同任务的原生会话数据库和端口保持独立。

`pnpm agent`可启动共享OpenCode服务，但默认任务面板使用独立任务运行时，无须额外公开4096端口。

模型凭据需在该Codespace的原生OpenCode提供商设置中配置，或使用该环境的 **Codespaces Secrets**，例如原生智谱提供商支持的 `ZHIPU_API_KEY`。环境不会继承本机密钥。不要把密钥写进Git、任务包或聊天；修改环境Secrets后需按GitHub提示重启并重新启动服务。

## 测试

在默认ReMAP终端执行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Chromium从系统路径自动发现；截图和报告写入被Git忽略的 `artifacts`，浏览器测试使用独立的5174/4188端口和 `data/e2e` 目录。

完整发布验收：

```bash
RELIABILITY_REQUIRE_CTMC=1 pnpm verify:release
```

专家完整数值复现：

```bash
node --import tsx scripts/verify-expert-reproduction.ts
```

完整专家配置有数十万条轨迹，在2核环境中需要等待；日常交互先用“快速试算”，正式审核再用完整采样。样本数量不能替代实测参数校准。

SSH或非默认终端可手动执行 `source scripts/cloud-env.sh`。GitHub CLI连接命令需在有Codespaces管理权限和相应网络访问的客户端运行：

```bash
gh codespace list --repo lzq0927/remap
gh codespace ssh --codespace <Codespace名称>
```

GitHub仓库连接和Codespaces管理使用各自的权限。若Codespaces API返回Forbidden，应检查客户端Codespaces授权以及 `api.github.com` 的网络出口；不能仅凭Git拉取成功认定Codespaces已连接。当前Codex执行环境不因创建Codespace而自动切换，需要另外配置可用的连接。

## 当前验证边界

2026-10-13：配置通过Dev Container/Codespaces核心schema与Bash语法检查；浏览器地址适配的四项回归、项目类型检查、lint、构建以及238项单元/集成测试通过。真实Vite服务使用当前Codespace预览Host返回200，其他Codespace的Host返回403。

当前环境的Codespaces列表API返回Forbidden，尚未创建或SSH连接真实Codespace。容器内首次初始化、GitHub私有转发认证及真实模型请求需在实际Codespace中验证，不能将当前云端测试记录当成已经连接的证明。

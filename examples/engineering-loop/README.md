# 工程工具接口示例

`bdd-cli-adapter.mjs` 是实际可执行的 CLI 适配器，调用项目现有精确 BDD 求解器。需要 Node 24。它只用于验证通用适配协议，不是公司内部工具或 P 实现。

将 `tools.example.json` 的程序/脚本路径修改为部署机的绝对路径，另存为管理员本地配置，再设置 `REMAP_ENGINEERING_TOOLS` 指向该文件。不要在通用仓库保存企业凭据、配置或原始资料。

外部案例的原生输入文件名为 `Static.json`，例如：

```json
{"method":"rbd","tree":{"type":"series","children":[{"type":"event","id":"shared-power","probability":0.9},{"type":"event","id":"shared-power","probability":0.9}]}}
```

真实求解结果为0.9，同一事件 ID 不重复计率。配置中的 `p-file` 为文件交换入口；需要管理员在公司已有 P 工具中实际执行，结果回传原输入摘要并保留人工导入标记。

完整协议与验收脚本见[工程闭环指南](../../docs/2026-10-13-Agent工程闭环使用与适配.md)。`pnpm verify:engineering` 运行 AI 集群的单/双协调器及存储快恢复比较，模型与真实计算输出随工程 JSON 包保存；主流程与报告验收使用 `pnpm verify:ai-cluster`。

# 管理员本地映射扩展

当前仅实现输入映射适配。解析器执行扩展、求解器和报告插件尚未实现。

`src/index.ts` 提供固定契约 `LocalMappingAdapter`、加载器 `loadLocalMappingAdapter` 与校验管线 `mapWithLocalAdapter`。管理员在内网 runtime policy 指定绝对本地 ESM 文件、id 和固定 version。默认导出：

```js
export default {
  contractVersion: "1.0.0",
  id: "synthetic-enterprise",
  version: "1.0.0",
  map(data, source) {
    // source: inputId, contentHash, filename, sources；data/source 都是确认输入的副本。
    return {
      parameters: [{ modelField: "hardSeconds", value: 60, unit: "s" }],
    };
  },
};
```

返回核心结构化输入（例如 failureModes、mechanisms、parameters、architecture 或资产数组），不能返回 MappingPreview。训练模型参数必须走含单位的 parameters 行，直接 model/config 与预构建 trainingPatch 不允许；FIT 另需明确 device-hour 口径。原始或返回数据的未解决 ambiguities 会拒绝预览。未知字段、缺失数据、单位错误由核心 mapConfirmedData 显式处理，不猜测或自动补零。

模块是可信管理员代码，在 API 进程内运行，不是沙箱；不要把不可信上传文件当作代码。只接受本地普通文件；不提供 HTTP 或 Agent 注册模块接口。数据文件仍用核心解析器，用户确认后才运行适配，预览不应用设计或创建/冻结资产。

API 和绑定任务的 MCP `input_mapping` 返回 adapter {id,version,contractVersion,moduleSHA256} 与 previewId；任务私有 mapping-preview 文档保存来源/确认摘要、映射和时间。资产 payload.mappingAdapter 绑定相同元数据，便于用户保存后进入后续资产快照。绝对模块路径不出现在系统生成的预览元数据里。

入口模块按字节 SHA-256 加入 native ESM URL，固定路径内容变化不会复用旧入口；加载期间文件变化则拒绝。摘要只覆盖入口，依赖应在独立适配版本目录固定并审核，依赖升级后重启 API。生产不要在运行中修改模块。

可运行合成 CSV/JSON、安装配置片段与更多说明见 [合成示例](../../examples/internal-adapter/README.md)。测试：

```powershell
pnpm exec vitest run packages/extensions tests/integration/internal-adapter.test.ts
```

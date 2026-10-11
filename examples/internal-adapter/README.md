# 本地企业映射适配示例

本目录只含合成字段、合成 FIT 和合成参数。CSV/JSON 先由现有解析器提取，用户确认后，管理员配置的本地模块才参与映射预览。此例不是企业实际格式或数据。

管理员将独立审核的 `mapper.mjs` 安装到内网适配仓库，在 `RELIABILITY_INTERNAL_CONFIG` 指向的配置中增加：

```json
{
  "adapter": {
    "id": "synthetic-enterprise",
    "version": "1.0.0",
    "module": "D:\\enterprise-adapters\\synthetic\\mapper.mjs"
  }
}
```

此片段需合并到完整的内网配置（包含 `schemaVersion`、批准 origin 和 provider）。模块路径必须是绝对本地普通文件路径，不能是 HTTP、file URL 或网络共享路径。外网 profile 不执行适配器。

ESM 默认导出对象契约：`{ contractVersion: "1.0.0", id, version, map(data, source) }`。id/version 必须和固定配置完全匹配。`map` 可异步，接收确认数据副本以及 `{ inputId, contentHash, filename, sources }` 副本，返回核心可校验的结构化输入，如 `failureModes`、`mechanisms`、`parameters`、`architecture` 或资产数组。它不能返回 `MappingPreview`。训练模型参数必须返回明确 `modelField`、`value`、`unit` 的 `parameters` 行，FIT 另需 `device-hour` 口径；直接 `model`、`config`、`trainingPatch` 不允许。不得猜测缺失参数、单位、拓扑或发生率，不得删除未知信息与 ambiguities。

模块是管理员安装的可信代码，在 API 进程内运行，拥有进程权限；加载器不是沙箱。Agent/HTTP 没有模块注册能力。解析器、求解器和报告扩展尚未实现，不属于此契约。

核心再次执行 `mapConfirmedData`：原始/输出 ambiguities 拒绝；未知字段进入 unmapped；单位/发生率口径不匹配拒绝对应映射；缺失率保留缺失并警告。预览不创建资产、不写设计、不冻结版本，后续应用与确认仍由用户操作。

响应包含 `adapter`（id/version/contractVersion/moduleSHA256）与 `previewId`。任务私有 `mapping-preview` 文档记录相同元数据、来源文件摘要、确认数据摘要、映射与时间；相同内容重复读取复用同一记录。每个资产草稿的 `payload.mappingAdapter` 保留模块摘要，后续用户保存资产时可携带至快照/报告。不会把绝对模块路径写入响应和预览记录。

`moduleSHA256` 只覆盖入口模块字节。入口内容变化会使用新的 ESM URL 重新加载、形成新预览；依赖模块由 Node 的 ESM 缓存管理，修改依赖后必须升级固定适配版本并重启 API。生产模块应使用独立版本目录并记录整个适配仓库的批准版本；不要在运行中修改文件。加载期间入口变化会拒绝请求。

验收（不请求真实模型、不读取私有数据）：

```powershell
pnpm exec vitest run packages/extensions tests/integration/internal-adapter.test.ts
```

上传本目录 CSV/JSON → 确认结构化输入 → 请求映射预览。预期得到 FIT=42 的故障草稿；无发生率行保持缺失；JSON 的秒单位参数成为明确训练补丁。检查来源行/JSON pointer、适配摘要和 unmapped，再由用户决定保存资产或应用补丁。

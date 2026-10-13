# MCP 与 API 0.2 契约

核心 packages/mcp-runtime；官方 SDK stdio/无会话 Streamable HTTP 共用 registry，不依赖 UI 或 OpenCode。网关连接可靠性 API，不是独立离线数值引擎。

每条连接绑定 RELIABILITY_API_URL、RELIABILITY_TASK_ID、RELIABILITY_TASK_TOKEN，仅访问对应 /api/tasks/:taskId 范围。旧全局设计/输入/运行接口返回 TASK_REQUIRED；默认值、示例和公共发布版本为只读全局资源。

工具 envelope 为 {id?,revision?,query?,body?}，tools/list 提供当前 schema。task_current 读取 task/design/workflow；design_get 读取完整设计；design_update 必须带 expectedRevision。输入变化增加 revision，阶段/会话元数据不增加输入版本。

workflow_start 的 body 为 {inputRevision,mode}，返回 executionId/revision；workflow_save 包含 executionId、expectedRevision、inputRevision、stepId、status、artifacts、notes。Agent 可写 running/awaiting-review/failed，不能 confirmed。前序人工确认后推进，409 重新读取。事件有递增 sequence、持久历史和补读。

正式训练 analysis_solve body 为 {operation:'training',input:<完整design.request>,executionId,inputRevision}。当前执行须已确认前四阶段，输入必须一致；独立试算省略 executionId，不可作为正式交付。solve 返回 {runId,status,artifactRefs:[],warnings:[]}，run_status 查询，run_cancel 保留取消记录。

operation 支持 training/allocate/rbd/fta/bdd/ctmc/compare/search/sensitivity/attribute/estimateRate。CTMC 为 {Q,p0,times,rewards?}，假设指数驻留时间。报告正文显示结果与简短验证诊断摘要；完整输入、固化资产/来源快照、结构化结果和运行事件由独立 JSON 附件提供，原运行资产继续保留。

report_export 的 query.format=md/html 返回简洁正文，json 返回原始完整运行结构，manifest 返回正文/附件/离线包下载描述。query.format=zip 或 includeTechnical=true 在 MCP 中返回下载描述，API 对应请求才返回二进制 ZIP。离线包含 HTML、Markdown、完整 JSON、说明和 SHA-256 清单，使用相对附件链接。下载描述不包含任务令牌；鉴权不变。详见[报告摘要与离线技术附件](2026-10-13-报告摘要与离线技术附件.md)。

catalog_search/create/validate 管理任务草稿及验证；catalog_examples/public 只读检索；catalog_copy 指定来源、固定 revision 与 contentHash；catalog_submit 仅候选。用户冻结 validated 私有版本；公共发布独立审核且目前关闭。refs {id,revision,contentHash,taskId?} 始终在任务本地存储解析。

输入确认、资产冻结和关键阶段签认由用户操作，不能由 Agent 自报身份。HTTP MCP 要求绑定 Bearer 和回环 Origin 检查；默认本机服务。本版本是本机单用户任务隔离，不宣称企业多租户安全，公司平台仍需真实身份与独立审核接入。

input_mapping `{id}` 对应 GET /api/tasks/:taskId/inputs/:id/mapping；只接受用户已确认输入，未确认返回 INPUT_UNCONFIRMED。预览返回核心 trainingPatch/assets/unmapped/warnings。内网管理员适配启用时另含 adapter {id,version,contractVersion,moduleSHA256} 与任务私有 previewId；相同来源和映射复用预览记录，资产 payload.mappingAdapter 保留版本摘要。模块不能由 HTTP/Agent 注册，预览不写设计、不创建或冻结资产、不替用户确认。用户核对来源、单位、歧义、适配版本后才决定应用。

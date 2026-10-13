import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
} from "../../runtime-policy/src/index";
export const registry = [
  [
    "task_current",
    "读取本连接绑定的评估任务、设计与流程版本",
    "GET",
    "/current",
  ],
  ["design_get", "读取任务当前设计；写入阶段前核对输入版本", "GET", "/design"],
  [
    "design_update",
    "更新任务设计，必须提供 expectedRevision；变更后重新确认流程",
    "POST",
    "/design",
  ],
  [
    "catalog_examples",
    "读取只读示例库；示例并非产品验证",
    "GET",
    "/examples/catalogs",
  ],
  ["catalog_public", "读取审核发布的公共资产版本", "GET", "/public/catalogs"],
  [
    "catalog_copy",
    "复制公共或示例固定版本到当前任务，核对适用条件",
    "POST",
    "/catalogs/copy-public",
  ],
  [
    "workflow_start",
    "基于已读取设计版本启动流程，执行到用户确认点",
    "POST",
    "/workflow/start",
  ],
  ["workflow_state", "读取当前阶段和过程资产", "GET", "/workflow"],
  [
    "workflow_automatic",
    "用户选择自动执行后，按当前有效设计版本运行目标、结构、分配、参数、真实仿真和报告流水线。自动完成不表示人工确认，报告停在待审核。body.inputRevision 必填；用 workflow_state / run_status 查询进展",
    "POST",
    "/workflow/automatic",
  ],
  [
    "workflow_save",
    "保存阶段与过程资产；Agent 不能代替用户确认",
    "POST",
    "/workflow",
  ],
  ["catalog_search", "检索版本化资产库", "GET", "/catalogs"],
  ["catalog_create", "创建故障模式、机制或证据草稿", "POST", "/catalogs"],
  [
    "catalog_validate",
    "校验资产的参数和版本引用",
    "POST",
    "/catalogs/:id/:revision/validate",
  ],
  [
    "input_import",
    "解析 JSON/CSV/XLSX/文本/PDF/图片为待确认输入",
    "POST",
    "/inputs",
  ],
  [
    "input_confirm",
    "确认输入提取结果，保存来源摘要",
    "POST",
    "/inputs/:id/confirm",
  ],
  [
    "input_mapping",
    "预览用户已确认输入的核心映射；内网可附管理员适配元数据，不会自动应用或冻结",
    "GET",
    "/inputs/:id/mapping",
  ],
  ["model_defaults", "读取场景指标和参考模型参数", "GET", "/defaults"],
  [
    "analysis_solve",
    "执行专业求解。operation=audit 使用 model_defaults.audit 的事件/机制审核口径，支持有来源的事件 FIT 更新、物理恢复顺序、组合 Shapley 和报告。返回运行 ID，用 run_status 查询结果；不要自行心算替代结果",
    "POST",
    "/runs",
  ],
  ["run_status", "查询实验状态、结果、参数快照和诊断", "GET", "/runs/:id"],
  ["run_cancel", "取消指定实验，保留已有记录", "POST", "/runs/:id/cancel"],
  ["run_replay", "使用固化输入与种子重放实验", "POST", "/runs/:id/replay"],
  [
    "report_export",
    "获取简洁报告（md/html）、完整 JSON 附件。format=manifest/zip 或 includeTechnical=true 返回包含离线 ZIP 下载地址的描述，不向对话塞入二进制附件",
    "GET",
    "/runs/:id/report",
  ],
  ["feedback_record", "记录用户采纳情况和理由", "POST", "/feedback"],
  [
    "workflow_cancel",
    "取消当前任务执行并保留过程资产",
    "POST",
    "/workflow/cancel",
  ],
  ["workflow_resume", "读取可恢复执行；不得跳过用户确认", "GET", "/workflow"],
  [
    "catalog_submit",
    "将私有资产提交为公共候选，等待独立审核",
    "POST",
    "/catalogs/:id/:revision/submit",
  ],
] as const;
export function createMcpServer(
  baseUrl = process.env.RELIABILITY_API_URL ?? "http://127.0.0.1:4178",
  binding = {
    taskId: process.env.RELIABILITY_TASK_ID ?? "",
    token: process.env.RELIABILITY_TASK_TOKEN ?? "",
  },
) {
  const server = new McpServer({ name: "sd-dfr-remap", version: "0.2.0" });
  for (const [name, description, method, route] of registry) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: {
          id: z.string().optional(),
          revision: z.number().int().positive().optional(),
          query: z.record(z.string()).optional(),
          body: z.record(z.any()).optional(),
        },
      },
      async (args) => {
        try {
          if (name !== "model_defaults" && (!binding.taskId || !binding.token))
            throw new Error(
              "TASK_REQUIRED: 请由工作台为当前任务安装 MCP 连接，禁止使用全局写入连接",
            );
          let path = route as string;
          for (const p of ["id", "revision"] as const) {
            if (path.includes(":" + p)) {
              if (args[p] === undefined) throw new Error(p + " 必填");
              path = path.replace(":" + p, encodeURIComponent(String(args[p])));
            }
          }
          const query = { ...args.query };
          if (
            name === "report_export" &&
            (query.format === "zip" ||
              ["true", "1"].includes(query.includeTechnical))
          ) {
            query.format = "manifest";
            delete query.includeTechnical;
          }
          const q = new URLSearchParams(query).toString();
          const policy = readRuntimePolicy();
          const requestUrl = assertEndpointAllowed(
            baseUrl.replace(/\/$/, "") +
              ([
                "model_defaults",
                "catalog_examples",
                "catalog_public",
              ].includes(name)
                ? "/api"
                : "/api/tasks/" + encodeURIComponent(binding.taskId)) +
              path +
              (q ? "?" + q : ""),
            "api",
            policy,
          );
          const response = await fetch(requestUrl, {
            ...(policy.profile === "internal"
              ? { redirect: "error" as const }
              : {}),
            method,
            headers: {
              "Content-Type": "application/json",
              ...(binding.token
                ? { Authorization: "Bearer " + binding.token }
                : {}),
            },
            body:
              method === "POST" ? JSON.stringify(args.body ?? {}) : undefined,
            signal: AbortSignal.timeout(150000),
          });
          const raw = await response.text();
          let value: any;
          try {
            value = JSON.parse(raw);
          } catch {
            value = { text: raw };
          }
          if (name === "analysis_solve" && response.ok)
            value = {
              runId: value.id,
              status: value.status,
              artifactRefs: [],
              warnings: [],
            };
          if (name === "report_export" && response.ok && value.offlinePackage) {
            for (const file of [
              ...value.reports,
              value.attachment,
              value.offlinePackage,
            ])
              file.href = new URL(file.href, requestUrl).href;
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
            structuredContent:
              value && typeof value === "object" && !Array.isArray(value)
                ? value
                : { items: value },
            isError: !response.ok,
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: {
                    code: "TOOL_UNAVAILABLE",
                    message: (error as Error).message,
                  },
                }),
              },
            ],
          };
        }
      },
    );
  }
  return server;
}

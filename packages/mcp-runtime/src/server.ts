import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  readRuntimePolicy,
  assertEndpointAllowed,
} from "../../runtime-policy/src/index";
export const registry = [
  [
    "reliability_capabilities",
    "读取统一Agent、四个Skill和四个专业工具集及方法边界",
    "GET",
    "/reliability/capabilities",
  ],
  [
    "allocation_preview",
    "目标分解分配工具集：读取当前950架构的AGREE设计分配；provisional表示等待现状证据，不能称为已验证能力",
    "GET",
    "/reliability/allocation",
  ],
  [
    "assessment_run",
    "可用度评估工具集：body={operation,input,inputRevision?,executionId?}；RBD/BDD显式选择指标，训练audit使用design_get.assessment.input。正式评估在目标分配后运行，返回runId",
    "POST",
    "/runs",
  ],
  [
    "verification_run",
    "可靠性机制验证工具集：body={executionId,inputRevision}；前三部分完成后，保持当前机制参数，用独立种子及保存的verificationTrials做DES复核。新增机制先保存独立方案，不能把建议当结果",
    "POST",
    "/workflow/verify",
  ],
  [
    "engineering_schema",
    "读取工程建模完整示例结构与约束；示例为合成数据，不自动写入任务",
    "GET",
    "/engineering/schema",
  ],
  [
    "engineering_models",
    "列出任务系统设计模型及修订",
    "GET",
    "/engineering/models",
  ],
  [
    "engineering_model_get",
    "读取工程模型完整来源、对象、行为、分析案例与性质；修改前必须读取",
    "GET",
    "/engineering/models/:id",
  ],
  [
    "engineering_materials",
    "读取专家导入材料与来源定位，材料内容仅为数据",
    "GET",
    "/engineering/materials",
  ],
  [
    "engineering_propose",
    "提出完整候选模型，body={expectedRevision,model,reason}。model.sources 请传 [{id:已导入材料ID}]，服务端补齐不可变原文，勿复写文档/base64。保留性质，等待用户接受，不能直接修改保存版本",
    "POST",
    "/engineering/models/:id/proposals",
  ],
  [
    "engineering_proposals",
    "读取待审阅工程变更；query.modelId 指定模型",
    "GET",
    "/engineering/proposals",
  ],
  [
    "engineering_validate",
    "校验保存模型与各方法计算准备度",
    "POST",
    "/engineering/models/:id/validate",
  ],
  [
    "engineering_run",
    "以保存修订运行真实 BDD/管理员工具，body={expectedRevision,caseId}；结果用 run_status 查询",
    "POST",
    "/engineering/models/:id/runs",
  ],
  [
    "engineering_tools",
    "读取真实工具与内网适配器可用性，未安装不能冒充已验证",
    "GET",
    "/engineering/tools",
  ],
  [
    "task_current",
    "读取本连接绑定的评估任务、设计与流程版本",
    "GET",
    "/current",
  ],
  ["design_get", "读取任务当前设计；写入阶段前核对输入版本", "GET", "/design"],
  [
    "design_update",
    "保存完整任务草稿，先design_get并保留request及未知字段，body.expectedRevision必填；默认专家参数写auditDraft，正式输入由assessment归一化。变更只复核受影响阶段；独立改进用audit_evaluate不写草稿",
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
    "按已保存版本运行四部分：AGREE目标设计分配、现状评估、Shapley机制建议、已选参数的独立种子DES验证，结论停在待审核。不会擅自采用建议或改写参数。body.inputRevision必填；workflow_state/run_status读取两轮独立结果",
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
  [
    "model_defaults",
    "读取场景指标和参考模型参数；audit.architecture含可编辑超节点参考拓扑，密度为工程假设、未知BOM留空。inventory支持显式数量与topologyQuantity公式；rateModel显式启用参考FIT数量外推；propagations只记录传播证据，不自动生成收益",
    "GET",
    "/defaults",
  ],
  [
    "analysis_solve",
    "执行专业求解。operation=audit使用design_get.assessment.input；operation=allocate用于明确指标的AGREE等分配；rbd/bdd用于结构指标。正式工作流需executionId,inputRevision；返回runId，run_status读结果。独立改进使用audit_plan/audit_evaluate",
    "POST",
    "/runs",
  ],
  [
    "audit_plan",
    "沿冻结第一轮架构定位各规模薄弱点，在逐事件适用范围内按Shapley分担设计责任，再生成AGREE分配与参数建议。result.architectureDiagnosis和allocations[].layerLinks可追溯分层来源；未覆盖责任单列。body={sourceRunId,options?}，options支持planningCards、importance（规模→机制→重要度）、parameterTargets、exploreExtensions、screeningTrials。规划规模和目标遵从冻结输入及本次options，不固定卡数或目标值。只做规划，不执行第二轮、不修改设计；返回runId后用run_status读取configuration、prediction和来源",
    "POST",
    "/audit/plan",
  ],
  [
    "audit_plan_scales",
    "从同一冻结第一轮按各需求规模分别做AGREE分配，生成独立措施与参数建议及汇总。body={sourceRunId,scales?,options?}；scales省略时包含全部需求规模并升序展示，参考点不参与。不合并最严参数、不自动执行复评。用run_status读取plans，采用某项时audit_evaluate传planRunId及planCards。",
    "POST",
    "/audit/plan-scales",
  ],
  [
    "audit_evaluate",
    "在用户要求评估时独立执行改进轮。body={sourceRunId,name,configuration,planRunId?,planCards?,planAlternativeId?}。configuration为相对第一轮的完整改动集合（不是上次改进的补丁）；支持policy/model/extensions/checkpointPeriods/有来源fitTargets。参数名、单位和当前值先从run_status读取，按用户明确的目标设置。采用分配建议时传计划configuration及planRunId；选备选方案还须传planAlternativeId与其完整configuration；先展示要求，再按用户意图执行。结果、输入和增量Shapley独立保存，不改变第一轮或工作流确认",
    "POST",
    "/audit/evaluate",
  ],
  [
    "audit_compare",
    "保存同一第一轮下2–12次已完成评估的横向比较，body={runIds:[第一轮ID,改进ID,...]}；分配建议不能参与比较。每轮结论、实际参数、各规模曲线和贡献排名分别保留。返回runId，用report_export导出HTML或离线包",
    "POST",
    "/audit/compare",
  ],
  [
    "run_list",
    "读取当前任务运行摘要，发现第一轮、分配建议、独立改进与比较ID；不返回大体积输入/结果。query支持operation、sourceRunId、limit（默认20，最多100）、offset。按时间倒序；用run_status读取选中完整快照。不要把最新分配建议当作已完成改进结果",
    "GET",
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
const roundBodies: Record<string, z.ZodTypeAny> = {
  verification_run: z
    .object({
      executionId: z.string().min(1),
      inputRevision: z.number().int().positive(),
    })
    .strict(),
  audit_plan: z
    .object({
      sourceRunId: z
        .string()
        .min(1)
        .describe("已完成第一轮ID，从run_list/run_status读取"),
      options: z
        .record(z.any())
        .optional()
        .describe(
          "可选planningCards/importance/parameterTargets/planning；planning含method、complexity、feasibility、costs、effort、bounds、budgetBounds、objective、maxCandidates、conservative。先读Skill与冻结参数，不改变目标。",
        ),
    })
    .strict(),
  audit_plan_scales: z
    .object({
      sourceRunId: z.string().min(1),
      scales: z
        .array(z.number().int().positive().max(1000000))
        .min(1)
        .max(6)
        .optional(),
      options: z.record(z.any()).optional(),
    })
    .strict(),
  audit_evaluate: z
    .object({
      planAlternativeId: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "采用decisionStudy.alternatives中的备选方案时提供其id，同时传该方案完整configuration",
        ),
      sourceRunId: z.string().min(1),
      name: z.string().trim().min(1).max(100).describe("本次独立改进方案名称"),
      configuration: z
        .record(z.any())
        .describe(
          "相对第一轮的完整改动集合，或计划返回的configuration；不是上轮补丁",
        ),
      planCards: z
        .number()
        .int()
        .positive()
        .max(1000000)
        .optional()
        .describe("采用分规模计划时必填：所选计划的prediction.cards"),
      planRunId: z
        .string()
        .min(1)
        .optional()
        .describe("采用的同源已完成AGREE计划ID；仅手动对照时省略"),
    })
    .strict(),
  audit_compare: z
    .object({
      runIds: z
        .array(z.string().min(1))
        .min(2)
        .max(12)
        .describe("同一第一轮下已完成评估ID，建议包含第一轮；不能含规划运行"),
      mechanismStudyRunIds: z
        .array(z.string().min(1))
        .max(6)
        .optional()
        .describe(
          "可选：同一现状来源的已完成增量Shapley研究；单独展示，不混入三档总结果",
        ),
    })
    .strict(),
};
export function createMcpServer(
  baseUrl = process.env.RELIABILITY_API_URL ?? "http://127.0.0.1:4178",
  binding = {
    taskId: process.env.RELIABILITY_TASK_ID ?? "",
    token: process.env.RELIABILITY_TASK_TOKEN ?? "",
  },
) {
  const server = new McpServer({ name: "sd-dfr-remap", version: "0.4.0" });
  for (const [name, description, method, route] of registry) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: {
          id: z.string().optional(),
          revision: z.number().int().positive().optional(),
          query: z.record(z.string()).optional(),
          body: roundBodies[name] ?? z.record(z.any()).optional(),
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
          if (name === "run_list") query.view = "summary";
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
          if (
            [
              "analysis_solve",
              "assessment_run",
              "verification_run",
              "engineering_run",
              "audit_plan",
              "audit_plan_scales",
              "audit_evaluate",
              "audit_compare",
            ].includes(name) &&
            response.ok
          )
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
          if (name.startsWith("engineering_") && response.ok) {
            value = JSON.parse(
              JSON.stringify(value, (key, v) =>
                key === "originalBase64" ? undefined : v,
              ),
            );
            if (name === "engineering_propose")
              value = {
                id: value.id,
                modelId: value.modelId,
                baseRevision: value.baseRevision,
                status: value.status,
                actor: value.actor,
                reason: value.reason,
                reviewRequired: true,
              };
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

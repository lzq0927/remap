import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";
const [registryRoot, taskId, apiUrl] = process.argv.slice(2);
if (!registryRoot || !taskId || !apiUrl)
  throw new Error("TASK_REQUIRED: 使用工作台生成的任务 MCP 配置");
const credentials = JSON.parse(
  readFileSync(join(registryRoot, "agent-credentials.json"), "utf8"),
);
if (typeof credentials[taskId] !== "string")
  throw new Error("TASK_AUTH_REQUIRED");
await createMcpServer(apiUrl, { taskId, token: credentials[taskId] }).connect(
  new StdioServerTransport(),
);

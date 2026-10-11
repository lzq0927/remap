import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server";
createServer(async (req, res) => {
  const token = process.env.RELIABILITY_TASK_TOKEN;
  if (!token || req.headers.authorization !== "Bearer " + token) {
    res
      .writeHead(401, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "TASK_AUTH_REQUIRED" }));
    return;
  }
  if (req.headers.origin) {
    try {
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(req.headers.origin).hostname,
        )
      )
        throw new Error();
    } catch {
      res.writeHead(403).end();
      return;
    }
  }
  if (req.url !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const b of req) {
      length += b.length;
      if (length > 30 * 1024 * 1024) throw new Error("REQUEST_TOO_LARGE");
      chunks.push(b);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer();
    await server.connect(transport);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(req, res, body);
  } catch (e) {
    if (!res.headersSent)
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: String(e) }));
  }
}).listen(Number(process.env.MCP_PORT ?? 4179), "127.0.0.1", () =>
  console.error("Reliability MCP http://127.0.0.1:4179/mcp"),
);

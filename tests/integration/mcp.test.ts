import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildApp } from "../../apps/api/src/server";
test("official MCP client negotiates tools, creates assets, invokes solver, cancels and reads runs", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  const task = app.taskServices.create("MCP integration");
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as any;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "apps/mcp/src/stdio.ts"],
    env: {
      ...process.env,
      RELIABILITY_API_URL: `http://127.0.0.1:${address.port}`,
      RELIABILITY_TASK_ID: task.id,
      RELIABILITY_TASK_TOKEN: app.taskServices.getAgentCredential(task.id),
    } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "reliability-verifier", version: "0.1.0" });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    for (const name of [
      "analysis_solve",
      "audit_plan",
      "audit_evaluate",
      "audit_compare",
      "run_list",
    ])
      expect(list.tools.some((t) => t.name === name)).toBe(true);
    const evaluateSchema = list.tools.find(
      (t) => t.name === "audit_evaluate",
    )!.inputSchema;
    expect(evaluateSchema.required).toContain("body");
    expect((evaluateSchema.properties!.body as any).required).toEqual(
      expect.arrayContaining(["sourceRunId", "name", "configuration"]),
    );
    expect(list.tools.some((t) => t.name === "workflow_automatic")).toBe(true);
    expect(new Set(list.tools.map((t) => t.name)).size).toBe(list.tools.length);
    const engineering = (
      await app.inject({
        method: "POST",
        url: `/api/tasks/${task.id}/engineering/models`,
        payload: { template: "ai-cluster" },
      })
    ).json();
    const proposal: any = await client.callTool({
      name: "engineering_propose",
      arguments: {
        id: engineering.id,
        body: {
          expectedRevision: 1,
          model: {
            ...engineering.model,
            sources: engineering.model.sources.map((s: any) => ({ id: s.id })),
          },
          reason: "MCP engineering source-reference conformance",
        },
      },
    });
    expect(proposal.isError).toBe(false);
    expect(proposal.structuredContent.reviewRequired).toBe(true);
    expect(proposal.structuredContent.candidate).toBeUndefined();
    const asset: any = await client.callTool({
      name: "catalog_create",
      arguments: {
        body: {
          kind: "failure-mode",
          name: "MCP mode",
          payload: { fit: 1000 },
        },
      },
    });
    expect(asset.isError).toBe(false);
    const a = JSON.parse(asset.content[0].text);
    expect(a.state).toBe("draft");
    const solved: any = await client.callTool({
      name: "analysis_solve",
      arguments: {
        body: {
          operation: "rbd",
          input: {
            tree: {
              type: "series",
              children: [
                { type: "event", id: "A", probability: 0.9 },
                { type: "event", id: "B", probability: 0.8 },
              ],
            },
          },
        },
      },
    });
    const queued = JSON.parse(solved.content[0].text);
    expect(queued.status).toBe("queued");
    let run: any;
    for (let i = 0; i < 100; i++) {
      const response: any = await client.callTool({
        name: "run_status",
        arguments: { id: queued.runId },
      });
      run = JSON.parse(response.content[0].text);
      if (run.status === "succeeded") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(run.result.probability).toBeCloseTo(0.72);
    const exported: any = await client.callTool({
      name: "report_export",
      arguments: {
        id: queued.runId,
        query: { format: "html", includeTechnical: "true" },
      },
    });
    expect(exported.isError).toBe(false);
    const descriptor = JSON.parse(exported.content[0].text);
    expect(descriptor.offlinePackage.href).toBe(
      `http://127.0.0.1:${address.port}/api/tasks/${task.id}/runs/${queued.runId}/report?format=zip`,
    );
    expect(descriptor.attachment.filename).toContain(".results.json");
    expect(exported.content[0].text).not.toContain(
      app.taskServices.getAgentCredential(task.id),
    );
  } finally {
    await client.close();
    await app.close();
  }
});

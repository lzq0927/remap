import { expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildApp } from "../../apps/api/src/server";
import { createMcpServer } from "../../packages/mcp-runtime/src/server";
import { getAuditDefaults } from "../../packages/analysis/src/audit";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";

test("MCP executes separate rounds, preserves evidence and exports selected comparisons", async () => {
  const app = await buildApp({
    dataDir: ":memory:",
    seed: false,
    automaticStageDisplayMs: 0,
  });
  const task = app.taskServices.create("MCP separate rounds"),
    other = app.taskServices.create("Other task"),
    token = app.taskServices.getAgentCredential(task.id);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as any).port}`,
    server = createMcpServer(url, { taskId: task.id, token }),
    client = new Client({ name: "rounds-verifier", version: "0.3.0" }),
    [agentTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const call = async (name: string, args: any = {}) => {
    const response: any = await client.callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response.content)).toBe(false);
    return response.structuredContent;
  };
  const wait = async (id: string) => {
    let run: any;
    await vi.waitFor(
      async () => {
        run = await call("run_status", { id });
        expect(run.status, run.error?.message).toBe("succeeded");
      },
      { timeout: 15000, interval: 50 },
    );
    return run;
  };
  try {
    await server.connect(serverTransport);
    await client.connect(agentTransport);
    const input = {
      ...getAuditDefaults(),
      hours: 24,
      trials: 8,
      attributionTrials: 4,
      sensitivity: false,
      verificationTrials: 8,
      scales: [500000, 200000, 100000, 10000],
    };
    const design = await call("design_get");
    const saved = await call("design_update", {
      body: {
        expectedRevision: design.revision ?? 0,
        request: design.request ?? {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest(input),
      },
    });
    const started = await call("workflow_automatic", {
      body: { inputRevision: saved.revision },
    });
    expect(started.executionId).toBeTruthy();
    let state: any;
    await vi.waitFor(
      async () => {
        state = await call("workflow_state");
        expect(state.steps[5].status).toBe("awaiting-review");
      },
      { timeout: 15000, interval: 50 },
    );
    const first = await wait(state.runId),
      frozen = JSON.stringify(first);
    expect(first.result.config.policy["D-SDC"].coverage).toBe(0.95);
    expect(first.result.optimization).toBeNull();
    const discovery = await call("run_list", { query: { operation: "audit" } });
    expect(discovery.items.map((r: any) => r.id)).toEqual([first.id]);
    expect(discovery.items[0].input).toBeUndefined();
    expect(discovery.items[0].result).toBeUndefined();
    const planQueued = await call("audit_plan", {
      body: {
        sourceRunId: first.id,
        options: {
          planningCards: 500000,
          screeningTrials: 8,
          exploreExtensions: false,
        },
      },
    });
    expect(planQueued.runId).toBeTruthy();
    expect(planQueued.input).toBeUndefined();
    const plan = await wait(planQueued.runId);
    expect(plan.result.scenarioEvaluated).toBe(false);
    expect(
      (await call("run_list", { query: { operation: "audit-experiment" } }))
        .total,
    ).toBe(0);
    const perScaleQueued = await call("audit_plan_scales", {
      body: {
        sourceRunId: first.id,
        scales: [500000, 10000],
        options: { screeningTrials: 4, exploreExtensions: false },
      },
    });
    expect(perScaleQueued.runId).toBeTruthy();
    const perScale = await wait(perScaleQueued.runId);
    expect(perScale.result.plans.map((p: any) => p.prediction.cards)).toEqual([
      10000, 500000,
    ]);
    expect(perScale.result.scenarioEvaluated).toBe(false);
    expect(
      (await call("run_list", { query: { operation: "audit-experiment" } }))
        .total,
    ).toBe(0);
    const manualQueued = await call("audit_evaluate", {
      body: {
        sourceRunId: first.id,
        name: "仅检出率99.5%",
        configuration: {
          policy: { "D-SDC": { coverage: 0.995 } },
          attributionTrials: 4,
          permutations: 2,
        },
      },
    });
    const manual = await wait(manualQueued.runId);
    expect(manual.result.factors).toHaveLength(1);
    expect(manual.result.factors[0].value).toEqual({ coverage: 0.995 });
    const improved = await wait(
      (
        await call("audit_evaluate", {
          body: {
            sourceRunId: first.id,
            name: "载入分配后独立评估",
            planRunId: perScale.id,
            planCards: 10000,
            configuration: {
              ...perScale.result.plans[0].configuration,
              attributionTrials: 4,
              permutations: 2,
            },
          },
        })
      ).runId,
    );
    expect(improved.result.planningRunId).toBe(perScale.id);
    expect(improved.result.planningCards).toBe(10000);
    expect(improved.result.decision.cards).toBe(10000);
    expect(await call("design_get")).toEqual(saved);
    expect(await call("workflow_state")).toEqual(state);
    expect(JSON.stringify(await call("run_status", { id: first.id }))).toBe(
      frozen,
    );
    const invalid: any = await client.callTool({
      name: "audit_compare",
      arguments: {
        body: { runIds: [first.id, plan.id] },
      },
    });
    expect(invalid.isError).toBe(true);
    const comparison = await wait(
      (
        await call("audit_compare", {
          body: {
            runIds: [first.id, manual.id, improved.id],
          },
        })
      ).runId,
    );
    expect(comparison.result.entries).toHaveLength(3);
    const exported = await call("report_export", {
      id: comparison.id,
      query: { format: "zip" },
    });
    expect(exported.offlinePackage.href).toContain(
      `/runs/${comparison.id}/report?format=zip`,
    );
    const html = await call("report_export", {
      id: comparison.id,
      query: { format: "html" },
    });
    expect(html.text).toContain("参数横向比较");
    expect(html.text).toContain("独立结论");
    expect(html.text).toContain("仅检出率99.5%");
    expect(JSON.stringify(exported)).not.toContain(token);
    const history = await call("run_list", {
      query: { sourceRunId: first.id, limit: "2", offset: "1" },
    });
    expect(history.total).toBe(6);
    expect(history.items).toHaveLength(2);
    const invalidPage: any = await client.callTool({
      name: "run_list",
      arguments: { query: { limit: "101" } },
    });
    expect(invalidPage.isError).toBe(true);
    const foreign = app.taskServices
      .resolve(other.id)
      .runs.start("audit", input);
    const rejected: any = await client.callTool({
      name: "audit_plan",
      arguments: { body: { sourceRunId: foreign.id } },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(await call("run_list"))).not.toContain(foreign.id);
  } finally {
    await client.close();
    await server.close();
    await app.close();
  }
});

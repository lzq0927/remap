import { expect, test } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { getAuditDefaults } from "../../packages/analysis/src/audit";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";

const changes: [string, number, (draft: any) => void][] = [
  [
    "architecture structure",
    1,
    (d) => {
      d.request.architecture.nodes[1].name = "新分层名称";
    },
  ],
  [
    "architecture budget",
    2,
    (d) => {
      d.request.architecture.budgetMethod = "weighted";
      d.request.architecture.nodes[1].weight = 2;
    },
  ],
  [
    "sampling",
    4,
    (d) => {
      d.request.trials = 16;
    },
  ],
  [
    "mechanisms",
    3,
    (d) => {
      d.request.mechanisms = ["fast"];
    },
  ],
  [
    "mechanism capability",
    3,
    (d) => {
      const policy = JSON.parse(d.policy);
      policy["C-FAST"].saveSeconds = 0.6;
      d.policy = JSON.stringify(policy);
    },
  ],
  [
    "allocation",
    2,
    (d) => {
      d.request.lossBudgetMethod = "baseline-proportional";
      delete d.request.lossBudgetWeights;
    },
  ],
  [
    "event FIT",
    1,
    (d) => {
      d.overrides = JSON.stringify([
        {
          id: "CORE-hard",
          fit: 123,
          source: "synthetic regression",
          evidence: "scenario",
          rateBasis: "npu-equivalent-hour",
        },
      ]);
    },
  ],
  [
    "target",
    0,
    (d) => {
      d.request.target = 0.98;
    },
  ],
];
test.each(changes)(
  "%s changes preserve only earlier human confirmations",
  async (_name, earliest, change) => {
    const app = await buildApp({
      dataDir: ":memory:",
      seed: false,
      autoStartRuns: false,
    });
    try {
      const task = app.taskServices.create("resume regression"),
        base = `/api/tasks/${task.id}`;
      const post = async (path: string, payload: any, agent = false) =>
        app.inject({
          method: "POST",
          url: base + path,
          payload,
          headers: agent
            ? {
                authorization:
                  "Bearer " + app.taskServices.getAgentCredential(task.id),
              }
            : undefined,
        });
      const draft = draftFromAuditRequest({
        ...getAuditDefaults(),
        scales: [10000],
        trials: 8,
      });
      const save = async () => {
        const response = await post("/design", {
          scenario: "training",
          activeAssessment: "audit",
          request: {},
          auditDraft: draft,
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().assessment.valid).toBe(true);
        return response.json();
      };
      const original = await save();
      let flow = (
        await post("/workflow/start", {
          inputRevision: original.revision,
          mode: "manual",
          version: "legacy-six",
        })
      ).json();
      for (const stepId of ["clarify", "describe", "select", "prepare"]) {
        const response = await post("/workflow", {
          executionId: flow.executionId,
          expectedRevision: flow.revision,
          inputRevision: original.revision,
          stepId,
          status: "confirmed",
        });
        expect(response.statusCode, response.body).toBe(200);
        flow = response.json();
      }
      change(draft);
      const revised = await save();
      const stale = (await app.inject(base + "/workflow")).json();
      expect(stale.stale).toBe(true);
      expect(stale.changedFrom).toBe(earliest);
      const response = await post("/workflow/start", {
        inputRevision: revised.revision,
        mode: "manual",
        resume: true,
      });
      expect(response.statusCode, response.body).toBe(200);
      const resumed = response.json();
      expect(resumed.executionId).not.toBe(flow.executionId);
      expect(resumed.runId).toBeUndefined();
      expect(
        resumed.steps.filter((s: any) => s.status === "confirmed"),
      ).toHaveLength(earliest);
      expect(resumed.steps[earliest].status).toBe("ready");
      expect(
        resumed.steps
          .slice(earliest)
          .every((s: any) => !s.confirmedBy && s.artifacts.length === 0),
      ).toBe(true);
      // Old runs and confirmations cannot bind to a new execution or new input revision.
      expect(
        (
          await post("/workflow", {
            executionId: flow.executionId,
            expectedRevision: resumed.revision,
            inputRevision: revised.revision,
            stepId: "clarify",
            status: "confirmed",
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await post("/runs", {
            executionId: flow.executionId,
            inputRevision: original.revision,
            operation: "audit",
            input: original.assessment.input,
          })
        ).statusCode,
      ).toBe(409);
      // The agent cannot request that human approvals be carried into its own execution.
      const agent = (
        await post(
          "/workflow/start",
          {
            inputRevision: revised.revision,
            mode: "manual",
            version: "legacy-six",
            resume: true,
          },
          true,
        )
      ).json();
      expect(
        agent.steps.filter((s: any) => s.status === "confirmed"),
      ).toHaveLength(0);
    } finally {
      await app.close();
    }
  },
);

import { expect, test, vi } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { getAuditDefaults } from "../../packages/analysis/src/audit";
import { draftFromAuditRequest } from "../../packages/contracts/src/audit-draft";
import { parameterHash } from "../../apps/api/src/reliability-artifacts";

test("four-part manual workflow preserves the assessment, selected parameters and independent validation", async () => {
  const app = await buildApp({ dataDir: ":memory:", seed: false });
  try {
    const task = app.taskServices.create("Four-part workflow"),
      base = `/api/tasks/${task.id}`;
    const post = (path: string, payload: any) =>
      app.inject({ method: "POST", url: base + path, payload });
    const design = (
      await post("/design", {
        request: {},
        scenario: "training",
        activeAssessment: "audit",
        auditDraft: draftFromAuditRequest({
          ...getAuditDefaults(),
          cards: 10000,
          scales: [10000],
          target: 0.985,
          targets: { 10000: 0.985 },
          hours: 600,
          trials: 4,
          verificationTrials: 8,
          attributionTrials: 2,
          sensitivity: false,
          verifyRecommendation: false,
        }),
      })
    ).json();
    const allocation = (
      await app.inject(base + "/reliability/allocation")
    ).json();
    expect(allocation.scales[0].allowedHours).toBeCloseTo(9);
    let state = (
      await post("/workflow/start", {
        inputRevision: design.revision,
        mode: "manual",
      })
    ).json();
    const confirm = async (stepId: string, runId?: string) => {
      state = (await app.inject(base + "/workflow")).json();
      const response = await post("/workflow", {
        stepId,
        executionId: state.executionId,
        expectedRevision: state.revision,
        inputRevision: state.inputRevision,
        status: "confirmed",
        artifacts: runId ? [{ type: "evaluation", runId }] : [],
      });
      if (response.statusCode === 200) state = response.json();
      return response;
    };
    const waitRun = async (id: string) => {
      let run: any;
      await vi.waitFor(
        async () => {
          run = (await app.inject(base + "/runs/" + id)).json();
          expect(run.status).toBe("succeeded");
        },
        { timeout: 20000 },
      );
      return run;
    };
    expect(
      (
        await post("/workflow/verify", {
          executionId: state.executionId,
          inputRevision: state.inputRevision,
        })
      ).statusCode,
    ).toBe(409);
    expect((await confirm("target-allocation")).statusCode).toBe(200);
    expect(state.steps[0].artifacts[0].type).toBe("target-allocation");
    const assessed = await waitRun(
      (
        await post("/runs", {
          operation: "audit",
          input: design.assessment.input,
          executionId: state.executionId,
          inputRevision: design.revision,
        })
      ).json().id,
    );
    const frozen = JSON.stringify(assessed);
    expect(
      (await confirm("availability-assessment", assessed.id)).statusCode,
    ).toBe(200);
    expect((await confirm("mechanism-design")).statusCode).toBe(200);
    expect(state.steps[2].artifacts[0].data.sourceRunId).toBe(assessed.id);
    expect(
      (await confirm("mechanism-verification", assessed.id)).statusCode,
    ).toBe(409);
    const queued = await post("/workflow/verify", {
      executionId: state.executionId,
      inputRevision: state.inputRevision,
    });
    expect(queued.statusCode, queued.body).toBe(200);
    const verified = await waitRun(queued.json().id);
    expect(verified.id).not.toBe(assessed.id);
    expect(verified.input.seed).not.toBe(assessed.input.seed);
    expect(verified.input.trials).toBe(8);
    expect(parameterHash(verified.input)).toBe(parameterHash(assessed.input));
    for (const scale of assessed.result.topologyDecision.scales) {
      const validated = verified.result.topologyDecision.scales.find(
        (s: any) => s.cards === scale.cards,
      );
      expect(
        validated.scenarios[0].nodes.map((n: any) => [n.id, n.allowedHours]),
      ).toEqual(
        scale.scenarios[0].nodes.map((n: any) => [n.id, n.allowedHours]),
      );
    }
    expect(
      JSON.stringify((await app.inject(base + "/runs/" + assessed.id)).json()),
    ).toBe(frozen);
    expect(
      (await confirm("mechanism-verification", verified.id)).statusCode,
    ).toBe(200);
    expect(state.status).toBe("succeeded");
    expect(state.assessmentRunId).toBe(assessed.id);
    expect(state.steps.map((s: any) => s.status)).toEqual(
      Array(4).fill("confirmed"),
    );
  } finally {
    await app.close();
  }
});

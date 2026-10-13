import { describe, it, expect } from "vitest";
import { buildApp } from "../../apps/api/src/server";
import { clusterModel } from "../../packages/modeling/src/sample";
import { hash } from "../../packages/assets/src/hash";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tlcRuntime } from "../../packages/modeling/src/tlc";

describe("task engineering loop", () => {
  it("versions models, reviews agent proposals, preserves evidence and roundtrips bundles", async () => {
    const app = await buildApp({
      dataDir: ":memory:",
      seed: false,
      autoStartRuns: false,
    });
    try {
      const task = app.taskServices.create("engineering"),
        other = app.taskServices.create("other");
      const base = `/api/tasks/${task.id}/engineering`;
      const saved = (
        await app.inject({
          method: "POST",
          url: base + "/models",
          payload: { template: "ai-cluster" },
        })
      ).json();
      expect(saved.revision).toBe(1);
      const model = structuredClone(saved.model);
      model.entities[0].name = "A reviewed";
      const token = app.taskServices.getAgentCredential(task.id),
        headers = { authorization: "Bearer " + token };
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/models/" + saved.id,
            headers,
            payload: { expectedRevision: 1, model },
          })
        ).statusCode,
      ).toBe(403);
      const proposal = (
        await app.inject({
          method: "POST",
          url: base + "/models/" + saved.id + "/proposals",
          headers,
          payload: {
            expectedRevision: 1,
            model,
            reason: "Expert clarification",
          },
        })
      ).json();
      expect(proposal.actor).toBe("agent");
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/proposals/" + proposal.id + "/resolve",
            headers,
            payload: { accept: true },
          })
        ).statusCode,
      ).toBe(403);
      const accepted = (
        await app.inject({
          method: "POST",
          url: base + "/proposals/" + proposal.id + "/resolve",
          payload: { accept: true },
        })
      ).json();
      expect(accepted.saved.revision).toBe(2);
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/models/" + saved.id,
            payload: { expectedRevision: 1, model },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            url: `/api/tasks/${other.id}/engineering/models/${saved.id}`,
            headers,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: `/api/tasks/${other.id}/engineering/models/${saved.id}`,
          })
        ).statusCode,
      ).toBe(404);
      const bundle = (
        await app.inject(base + "/models/" + saved.id + "/export")
      ).json();
      const imported = (
        await app.inject({
          method: "POST",
          url: `/api/tasks/${other.id}/engineering/import`,
          payload: bundle,
        })
      ).json();
      expect(imported.model.cases[2].files[0].content).toBe(
        model.cases[2].files[0].content,
      );
      const revisions = (
        await app.inject(base + "/models/" + saved.id + "/revisions")
      ).json();
      expect(revisions).toHaveLength(2);
      expect(revisions[0].model.entities[0].name).not.toBe("A reviewed");
      const asset = (
        await app.inject({
          method: "POST",
          url: base + "/models/" + saved.id + "/assets",
          payload: { expectedRevision: 2 },
        })
      ).json();
      expect(asset.state).toBe("draft");
      expect(asset.payload.modelRef.revision).toBe(2);
    } finally {
      await app.close();
    }
  });
  it("rejects fabricated sources and bundle hash tampering", async () => {
    const app = await buildApp({
      dataDir: ":memory:",
      seed: false,
      autoStartRuns: false,
    });
    try {
      const task = app.taskServices.create("sources"),
        base = `/api/tasks/${task.id}/engineering`;
      const saved = (
        await app.inject({
          method: "POST",
          url: base + "/models",
          payload: { model: clusterModel() },
        })
      ).json();
      const model = structuredClone(saved.model);
      model.sources[0].text = "Invented evidence";
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/models/" + saved.id + "/proposals",
            payload: { expectedRevision: 1, model, reason: "invalid" },
          })
        ).statusCode,
      ).toBe(400);
      const bundle = (
        await app.inject(base + "/models/" + saved.id + "/export")
      ).json();
      bundle.model.entities = [];
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/import",
            payload: bundle,
          })
        ).statusCode,
      ).toBe(400);
      const { contentHash: _h, ...body } = bundle;
      bundle.contentHash = hash(body);
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/import",
            payload: bundle,
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it("executes real queued BDD and freezes the input model", async () => {
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    try {
      const task = app.taskServices.create("run"),
        base = `/api/tasks/${task.id}/engineering`;
      const saved = (
        await app.inject({
          method: "POST",
          url: base + "/models",
          payload: { template: "ai-cluster" },
        })
      ).json();
      const response = await app.inject({
        method: "POST",
        url: base + "/models/" + saved.id + "/runs",
        payload: { expectedRevision: 1, caseId: "coordination-rbd" },
      });
      expect(response.statusCode).toBe(200);
      const run = response.json();
      await expect
        .poll(() => app.taskServices.resolve(task.id).runs.get(run.id).status)
        .toBe("succeeded");
      const done = app.taskServices.resolve(task.id).runs.get(run.id);
      expect(done.result.executionMode).toBe("real");
      expect(done.result.metrics.probability).toBeGreaterThan(0.99);
      saved.model.entities[0].name = "changed";
      await app.inject({
        method: "POST",
        url: base + "/models/" + saved.id,
        payload: { expectedRevision: 1, model: saved.model },
      });
      expect(done.input.snapshot.model.entities[0].name).not.toBe("changed");
    } finally {
      await app.close();
    }
  });
  it("hydrates immutable source IDs and keeps decision evidence through reuse and cross-task imports", async () => {
    const app = await buildApp({ dataDir: ":memory:", seed: false });
    try {
      const task = app.taskServices.create("provenance"),
        other = app.taskServices.create("imported"),
        base = `/api/tasks/${task.id}/engineering`;
      const saved = (
        await app.inject({
          method: "POST",
          url: base + "/models",
          payload: { template: "ai-cluster" },
        })
      ).json();
      const material = (
        await app.inject({
          method: "POST",
          url: base + "/materials",
          payload: {
            name: "review.md",
            scope: "synthetic",
            base64: Buffer.from(
              "Shared power remains a common cause.",
            ).toString("base64"),
          },
        })
      ).json();
      const candidate = {
        ...saved.model,
        sources: [
          ...saved.model.sources.map((s: any) => ({ id: s.id })),
          { id: material.id },
        ],
      };
      candidate.entities[0].sourceRefs.push(material.id);
      const proposal = (
        await app.inject({
          method: "POST",
          url: base + "/models/" + saved.id + "/proposals",
          payload: {
            expectedRevision: 1,
            model: candidate,
            reason: "source references",
          },
        })
      ).json();
      expect(proposal.candidate.sources[1]).toEqual(material);
      const accepted = (
        await app.inject({
          method: "POST",
          url: base + "/proposals/" + proposal.id + "/resolve",
          payload: { accept: true },
        })
      ).json().saved;
      const run = (
        await app.inject({
          method: "POST",
          url: base + "/models/" + saved.id + "/runs",
          payload: { expectedRevision: 2, caseId: "coordination-rbd" },
        })
      ).json();
      await expect
        .poll(() => app.taskServices.resolve(task.id).runs.get(run.id).status)
        .toBe("succeeded");
      accepted.model.decisions.push({
        id: "d",
        statement: "record decision",
        alternatives: "",
        reason: "synthetic",
        status: "accepted",
        sourceRefs: [material.id],
        caseRefs: ["coordination-rbd"],
        runRefs: [run.id],
      });
      const revised = (
        await app.inject({
          method: "POST",
          url: base + "/models/" + saved.id,
          payload: { expectedRevision: 2, model: accepted.model },
        })
      ).json();
      expect(revised.semanticHash).toBe(accepted.semanticHash);
      const bundle = (
        await app.inject(base + "/models/" + saved.id + "/export")
      ).json();
      const imported = (
        await app.inject({
          method: "POST",
          url: `/api/tasks/${other.id}/engineering/import`,
          payload: bundle,
        })
      ).json();
      expect(imported.model.decisions[0].runRefs[0]).toMatch(/^imported-run-/);
      const evidence = (
        await app.inject(
          `/api/tasks/${other.id}/engineering/models/${imported.id}/runs`,
        )
      ).json();
      expect(evidence[0].result.executionMode).toBe("package-imported");
      expect(evidence[0].input.snapshot.model.sources[1].originalBase64).toBe(
        material.originalBase64,
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/models/" + saved.id,
            payload: { expectedRevision: 0, model: saved.model },
          })
        ).statusCode,
      ).toBe(409);
      const missing = structuredClone(bundle);
      missing.evidence = [];
      const { contentHash: _hash, ...body } = missing;
      missing.contentHash = hash(body);
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/import",
            payload: missing,
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it("binds manual results to exact exported input and blocks Agent import", async () => {
    const app = await buildApp({
      dataDir: ":memory:",
      seed: false,
      autoStartRuns: false,
    });
    try {
      const task = app.taskServices.create("manual"),
        base = `/api/tasks/${task.id}/engineering`,
        model = clusterModel();
      model.cases[0].method = "p";
      model.cases[0].metric = "verification";
      model.cases[0].files = [
        { name: "Main.p", content: "machine Main { start state Init {} }" },
      ];
      const saved = (
        await app.inject({
          method: "POST",
          url: base + "/models",
          payload: { model },
        })
      ).json();
      const input = (
        await app.inject(
          base + "/models/" + saved.id + "/cases/coordination-rbd/tool-input",
        )
      ).json();
      const payload = {
        caseId: "coordination-rbd",
        expectedRevision: 1,
        inputHash: input.metadata.inputHash,
        result: {
          engine: "P contract fixture",
          version: "test",
          verdict: "inconclusive",
          completed: false,
          scope: "no actual P execution",
          rawOutput: "Transport-only fixture",
        },
      };
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/models/" + saved.id + "/external-results",
            payload: { ...payload, inputHash: "different" },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/models/" + saved.id + "/external-results",
            headers: {
              authorization:
                "Bearer " + app.taskServices.getAgentCredential(task.id),
            },
            payload,
          })
        ).statusCode,
      ).toBe(403);
      const result = (
        await app.inject({
          method: "POST",
          url: base + "/models/" + saved.id + "/external-results",
          payload,
        })
      ).json();
      expect(result.executionMode).toBe("user-imported");
      expect(result.result.completed).toBe(false);
    } finally {
      await app.close();
    }
  });
  it.skipIf(!tlcRuntime().available)(
    "cancels an unbounded model and removes its Java state files",
    async () => {
      const before = new Set(readdirSync(tmpdir()));
      const app = await buildApp({ dataDir: ":memory:", seed: false });
      try {
        const task = app.taskServices.create("cancel"),
          base = `/api/tasks/${task.id}/engineering`,
          model = clusterModel();
        model.cases[2].files = [
          {
            name: "Counter.tla",
            content:
              "---- MODULE Counter ----\nEXTENDS Naturals\nVARIABLE x\nInit == x = 0\nNext == x' = x + 1\nSafe == x >= 0\n====",
          },
          {
            name: "Counter.cfg",
            content: "INIT Init\nNEXT Next\nINVARIANT Safe",
          },
        ];
        const saved = (
          await app.inject({
            method: "POST",
            url: base + "/models",
            payload: { model },
          })
        ).json();
        const run = (
          await app.inject({
            method: "POST",
            url: base + "/models/" + saved.id + "/runs",
            payload: { expectedRevision: 1, caseId: "unfenced-tlc" },
          })
        ).json();
        await expect
          .poll(() => app.taskServices.resolve(task.id).runs.get(run.id).status)
          .toBe("running");
        let directory: string | undefined;
        // Wait for the actual TLC child, not merely the queued worker's status.
        await expect
          .poll(
            () => {
              directory = readdirSync(tmpdir()).find(
                (name) =>
                  !before.has(name) &&
                  name.startsWith("remap-tlc-") &&
                  existsSync(join(tmpdir(), name, "states")),
              );
              return !!directory;
            },
            { timeout: 10000 },
          )
          .toBe(true);
        const cancelled = (
          await app.inject({
            method: "POST",
            url: `/api/tasks/${task.id}/runs/${run.id}/cancel`,
            payload: {},
          })
        ).json();
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.result).toBeUndefined();
        await expect
          .poll(() => existsSync(join(tmpdir(), directory!)), {
            timeout: 10000,
          })
          .toBe(false);
      } finally {
        await app.close();
      }
    },
  );
});

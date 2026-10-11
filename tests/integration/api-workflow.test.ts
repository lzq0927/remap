import { expect, test } from "vitest";
import { buildApp } from "./task-fixture";
test("real worker completes a training run; replay and report retain original inputs", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  try {
    const defaults = (await app.inject("/api/defaults")).json().training;
    const queued = (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          operation: "training",
          input: { ...defaults, hours: 24, trials: 8 },
        },
      })
    ).json();
    expect(queued.status).toBe("queued");
    let run: any;
    for (let i = 0; i < 100; i++) {
      run = (await app.inject("/api/runs/" + queued.id)).json();
      if (["succeeded", "failed"].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(run.error).toBeUndefined();
    expect(run.status).toBe("succeeded");
    expect(run.result.metricId).toBe("training.correct-delivery");
    expect(run.input.assetSnapshot.length).toBeGreaterThan(0);
    expect(run.events.some((e: any) => e.type === "progress")).toBe(true);
    const report = await app.inject(
      "/api/runs/" + run.id + "/report?format=md",
    );
    expect(report.body).toContain(run.inputHash);
    const replay = (
      await app.inject({
        method: "POST",
        url: "/api/runs/" + run.id + "/replay",
        payload: {},
      })
    ).json();
    expect(replay.inputHash).toBe(run.inputHash);
  } finally {
    await app.close();
  }
});
test("unconfirmed file cannot be evaluated; confirmed immutable source can", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  try {
    const input = (
      await app.inject({
        method: "POST",
        url: "/api/inputs",
        payload: {
          name: "m.json",
          base64: Buffer.from('{"cards":10000}').toString("base64"),
        },
      })
    ).json();
    expect(input.status).toBe("extracted");
    const d = (await app.inject("/api/defaults")).json().training;
    const blocked = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { operation: "training", input: { ...d, inputId: input.id } },
    });
    expect(blocked.json().error.code).toBe("INPUT_UNCONFIRMED");
    const confirmed = (
      await app.inject({
        method: "POST",
        url: "/api/inputs/" + input.id + "/confirm",
        payload: { data: input.data },
      })
    ).json();
    expect(confirmed.confirmedHash).toBeTruthy();
  } finally {
    await app.close();
  }
});
test("large IPC results drain before worker close and do not become false failures", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  try {
    const defaults = (await app.inject("/api/defaults")).json().training;
    const queued = (
      await app.inject({
        method: "POST",
        url: "/api/runs",
        payload: {
          operation: "training",
          input: {
            ...defaults,
            hours: 24,
            trials: 8,
            notes: "x".repeat(2000000),
          },
        },
      })
    ).json();
    let run: any;
    for (let i = 0; i < 200; i++) {
      run = (await app.inject("/api/runs/" + queued.id)).json();
      if (["failed", "succeeded"].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(run.error).toBeUndefined();
    expect(run.status).toBe("succeeded");
    expect(run.result.request.notes.length).toBe(2000000);
  } finally {
    await app.close();
  }
});

test("allocation comparison runs applicable methods and explains individual skips", async () => {
  const app = await buildApp({ dataDir: ":memory:" });
  try {
    const response = await app.inject({method:"POST",url:"/api/allocations/compare",payload:{target:.9,hours:10,metricId:"task-reliability",items:[{id:"A",importance:0},{id:"B"}]}});
    expect(response.statusCode).toBe(200);
    const comparison=response.json();
    expect(comparison.runs.map((r:any)=>r.input.method)).toEqual(["equal"]);
    expect(comparison.skipped).toEqual([{method:"arinc",reason:expect.stringMatching(/baseline rate/)},{method:"agree",reason:expect.stringMatching(/positive importance/)}]);
    let run:any;
    for(let i=0;i<100;i++) {
      run=(await app.inject("/api/runs/"+comparison.runs[0].id)).json();
      if(["succeeded","failed"].includes(run.status))break;
      await new Promise(r=>setTimeout(r,25));
    }
    expect(run.status).toBe("succeeded");
    expect(run.result.metricId).toBe("task-reliability");
    expect(run.result.items.reduce((p:number,i:any)=>p*i.target,1)).toBeCloseTo(.9,12);
    expect((await app.inject("/api/runs")).json()).toHaveLength(1);
  } finally {await app.close();}
});
test("allocation comparison retains ARINC when only AGREE is inapplicable", async () => {
  const app=await buildApp({dataDir:":memory:"});
  try {
    const response=await app.inject({method:"POST",url:"/api/allocations/compare",payload:{target:.9,hours:10,items:[{id:"A",baselineRate:.001,importance:0},{id:"B",baselineRate:.003}]}});
    expect(response.statusCode).toBe(200);
    expect(response.json().runs.map((r:any)=>r.input.method)).toEqual(["equal","arinc"]);
    expect(response.json().skipped).toEqual([{method:"agree",reason:expect.stringMatching(/positive importance/)}]);
  } finally {await app.close();}
});
test("allocation comparison rejects without creating runs when every method is inapplicable", async () => {
  const app=await buildApp({dataDir:":memory:"});
  try {
    const response=await app.inject({method:"POST",url:"/api/allocations/compare",payload:{target:0,hours:10,items:[{id:"A"}]}});
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("METHOD_INAPPLICABLE");
    for(const method of ["equal","arinc","agree"])expect(response.json().error.message).toContain(method+": Invalid allocation bounds");
    expect((await app.inject("/api/runs")).json()).toHaveLength(0);
  } finally {await app.close();}
});
test("availability comparison keeps its metric and returns an empty skip list", async () => {
  const app=await buildApp({dataDir:":memory:"});
  try {
    const response=await app.inject({method:"POST",url:"/api/allocations/compare",payload:{metricId:"steady-state-availability",target:.9,hours:10,items:[{id:"A",baselineAvailability:.95},{id:"B"}]}});
    expect(response.statusCode).toBe(200);
    expect(response.json().runs.map((r:any)=>[r.input.method,r.input.metricId])).toEqual([["availability","steady-state-availability"]]);
    expect(response.json().skipped).toEqual([]);
  } finally {await app.close();}
});

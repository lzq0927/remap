import { describe, it, expect } from 'vitest';
import { solveStatic } from '../src/static';
import { solveCtmc } from '../src/ctmc';
import { getTrainingDefaults, runTraining } from '../src/training';
import { solveRepairable } from '../src/repairable';

describe('static exact reliability', () => {
  const A={type:'event' as const,id:'A',probability:.9}, B={type:'event' as const,id:'B',probability:.8};
  it('computes series, parallel and 2 of 3', () => {
    expect(solveStatic({method:'rbd',tree:{type:'series',children:[A,B]}}).probability).toBeCloseTo(.72,12);
    expect(solveStatic({method:'rbd',tree:{type:'parallel',children:[A,B]}}).probability).toBeCloseTo(.98,12);
    expect(solveStatic({method:'rbd',tree:{type:'kofn',k:2,children:[A,{...A,id:'B'},{...A,id:'C'}]}}).probability).toBeCloseTo(.972,12);
  });
  it('deduplicates repeated fault event in Boolean expression', () => {
    const a={...A,probability:.1};
    expect(solveStatic({method:'fta',tree:{type:'or',children:[a,{type:'and',children:[a,B]}]}}).probability).toBeCloseTo(.1,12);
  });
  it('rejects conflicting probabilities and correlated-event input', () => {
    expect(()=>solveStatic({method:'bdd',tree:{type:'or',children:[A,{...A,probability:.2}]}})).toThrow(/conflict/i);
    expect(()=>solveStatic({method:'fta',tree:A,correlations:{A:'B'}} as any)).toThrow(/correlat/i);
  });
});
describe('training delivery', () => {
  it('uses baseline 7200/10 and deterministic zero-failure ledger', () => {
    expect(getTrainingDefaults().model.intervalSeconds).toBe(7200);
    const r=runTraining({cards:1000,hours:1,trials:4,seed:9137,target:.99,model:{fits:[0,0,0,0]}});
    expect(r.statistics.mean).toBe(1);
    expect(r.ledger.delivered).toBe(1);
    expect(r.ledger.residual).toBeCloseTo(0,10);
  });
  it('rejects unknown model fields and unbounded trial requests', () => {
    expect(()=>runTraining({cards:1000,hours:1,trials:4,seed:1,target:.9,model:{magic:1}})).toThrow(/unsupported/i);
    expect(()=>runTraining({cards:1000,hours:1,trials:999999,seed:1,target:.9})).toThrow();
    expect(()=>runTraining({cards:1000,hours:1,trials:4,seed:1,target:.9,model:[] as any})).toThrow(/object/i);
    expect(()=>runTraining({cards:1000,hours:1,trials:4,seed:1,target:.9,config:[] as any})).toThrow(/object/i);
    expect(()=>runTraining({cards:1000,hours:1,trials:4,seed:1,target:.9,model:{toString:1}})).toThrow(/unsupported/i);
    expect(()=>runTraining({cards:1000,hours:1,trials:4,seed:1,target:.9,config:{constructor:1}})).toThrow(/unsupported/i);
    expect(()=>runTraining({cards:1000,hours:1,trials:4,seed:1,target:.9,model:{retentionHours:1}})).toThrow(/retentionHours.*unsupported/i);
  });
});
describe('CTMC SciPy plugin', () => {
  it('matches two-state stationary and exact transient availability', async () => {
    const r=await solveCtmc({Q:[[-.01,.01],[1,-1]],p0:[1,0],times:[0,1,10],rewards:[1,0]});
    expect(r.stationary[0]).toBeCloseTo(1/1.01,12);
    expect(r.transient[1].reward).toBeCloseTo(1/1.01+(.01/1.01)*Math.exp(-1.01),12);
    expect(r.integratedReward).toBeGreaterThan(9.9);
  });
  it('rejects invalid generators and nonunique stationary classes', async () => {
    await expect(solveCtmc({Q:[[-1,2],[1,-1]],p0:[1,0],times:[1]})).rejects.toThrow(/generator/i);
    await expect(solveCtmc({Q:[[0,0],[0,0]],p0:[1,0],times:[1]})).rejects.toThrow(/unique/i);
  });
  it('rejects nonexponential distributions and unrecognized CTMC fields',async()=>{
    const base={Q:[[-.01,.01],[1,-1]],p0:[1,0],times:[1]};
    await expect(solveCtmc({...base,distribution:'weibull'} as any)).rejects.toThrow(/exponential/i);
    await expect(solveCtmc({...base,repairDistribution:'weibull'} as any)).rejects.toThrow(/unsupported/i);
    await expect(solveCtmc({...base,distribution:'exponential'} as any)).resolves.toHaveProperty('stationary');
  });
  it('recognizes a unique closed class despite an arbitrarily small transient rate',async()=>{
    const r=await solveCtmc({Q:[[-1e-18,1e-18,0],[0,-1,1],[0,1,-1]],p0:[1,0,0],times:[1]});
    expect(r.stationary).toEqual([0,.5,.5]);
  });
});
it('composes two repairable modules into series availability and task reliability',()=>{
  const r=solveRepairable({hours:10,topology:'series',modules:[{id:'A',failureRate:.01,repairRate:1},{id:'B',failureRate:.01,repairRate:1}]});
  expect(r.availability).toBeCloseTo((1/1.01)**2,12);expect(r.taskReliability).toBeCloseTo(Math.exp(-.2),12);
});
it('factor FIT patch respects overridden source FIT proportions',()=>{
  const r=runTraining({cards:1000,hours:1,trials:2,seed:1,target:.99,model:{fits:[100,0,0,0]},factors:['fit']});
  expect(r.config.model.fits[1]).toBe(0);expect(r.config.model.fits[0]).toBeCloseTo(1707.6502732240438,10);
});
it('bounds trace collection independently of large expected fault work',()=>{
  const r=runTraining({cards:1000,hours:10,trials:2,seed:1,target:.9,model:{fits:[1e8,0,0,0],slowPct:0,silentPct:100,silentDetect:100,silentHours:0,silentMinutes:0}});
  expect(r.diagnostics.traceTruncated).toBe(true);expect(r.diagnostics.traceHours).toBeLessThan(10);expect(r.diagnostics.trace.length).toBeLessThanOrEqual(2000);
});

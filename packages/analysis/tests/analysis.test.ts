import { it, expect } from 'vitest';
import { summarize, shapleyValues, estimateRate, search, compare, sensitivity, attribute } from '../src/index';
import { trialSeed } from '../../solvers/src/training';
it('quantile type 7, Wilson success interval and fixed-sample CI',()=>{
  const r=summarize([0,1,2,3],2);
  expect(r.p50).toBe(1.5); expect(r.achievementProbability).toBe(.5);
  expect(r.achievementInterval.low).toBeLessThan(.5);expect(r.ciHigh).toBeGreaterThan(r.mean);
});
it('Shapley efficiency including negative effects',()=>{
  expect(shapleyValues([0,1,2,5],2)).toEqual([2,3]);
  expect(shapleyValues([0,-1,2,0],2)).toEqual([-1.5,1.5]);
});
it('Poisson MLE and zero-event 95 percent evidence',()=>{
  expect(estimateRate({events:2,exposureHours:1e6}).fit).toBe(2000);
  expect(estimateRate({events:0,exposureHours:1e6}).upperFit).toBeCloseTo(2995.73227355,7);
  expect(()=>estimateRate({events:0,exposureHours:1e6,confidence:NaN})).toThrow();
});
it('search proves checkpoint overhead bound, otherwise distinguishes no candidate',()=>{
  const r=search({base:{cards:1000,hours:720,trials:4,seed:1,target:.99},designSpace:{intervalSeconds:[300],saveSeconds:[4]}});
  expect(r.status).toBe('proven_infeasible');expect(r.checkpointDutyCycle).toBeCloseTo(300/304,12);expect(r.upperBound).toBe(r.finiteHorizonUpperBound);
});
it('comparison and sensitivity preserve paired seeds and exact zero-failure change',()=>{
  const base={cards:1000,hours:3,trials:8,seed:1,target:.99,model:{fits:[0,0,0,0],saveSeconds:0}};
  expect(compare({base,variants:[{id:'same'}]}).items[0].delta.mean).toBe(0);
  const s=sensitivity({base,parameter:'saveSeconds',values:[0,60]});
  expect(s.items[0].delta.mean).toBe(0);expect(s.items[1].delta.mean).toBeLessThan(0);
});
it('attribution sums to gain and retains harmful monitoring capability assumptions',()=>{
  const base={cards:1000,hours:3,trials:8,seed:1,target:.99,model:{fits:[0,0,0,0]}};
  const r=attribute({base,factors:['checkpoint','save']});
  expect(r.residual).toBeCloseTo(0,12);expect(r.contributions[0].shapley).toBeLessThan(0);
});
it('selection uses distinct verification seeds and does not label MC failure infeasible',()=>{
  const base={cards:1000,hours:1,trials:4,seed:1,target:.99,model:{fits:[0,0,0,0]}};
  const r=search({base,designSpace:{saveSeconds:[0]},verificationTrials:8});
  expect(r.status).toBe('verified_candidate');expect(r.verification!.request.seed).not.toBe(base.seed);
  const no=search({base:{...base,model:{...base.model,slowPct:0,silentPct:100,fits:[1e9,0,0,0],silentFallbackHours:120}},designSpace:{saveSeconds:[0]}});
  expect(no.status).toBe('no_candidate_found');
});
it('does not use duty-cycle ceiling as proof when step recovery can reset checkpoint phase',()=>{
  const base={cards:1000,hours:20,trials:8,seed:9137,target:.99,model:{fits:[20e6,0,0,0],slowPct:0,silentPct:100,silentDetect:100,silentHours:0,silentMinutes:0}};
  const r=search({base,designSpace:{intervalSeconds:[300],saveSeconds:[4]},verificationTrials:16});
  expect(r.status).not.toBe('proven_infeasible');
});
it('reports finite mission ceiling separately from asymptotic duty cycle',()=>{
  const r=search({base:{cards:1,hours:1/3600,trials:8,seed:1,target:.99,model:{fits:[0,0,0,0]}},designSpace:{intervalSeconds:[300],saveSeconds:[4]},verificationTrials:8});
  expect(r.verification!.statistics.mean).toBe(1);expect(r.upperBound).toBe(1);expect(r.checkpointDutyCycle).toBeCloseTo(300/304,12);
});
it('rejects overlapping actual trial seeds and chooses disjoint defaults',()=>{
  const base={cards:1,hours:1,trials:8,seed:1,target:.99,model:{fits:[0,0,0,0]}};
  expect(()=>search({base,designSpace:{saveSeconds:[0]},verificationTrials:8,verificationSeed:(base.seed+2654435761)>>>0})).toThrow(/overlap/i);
  const r=search({base,designSpace:{saveSeconds:[0]},verificationTrials:8});
  const selection=new Set(Array.from({length:8},(_,i)=>trialSeed(base.seed,i,base.cards)));
  expect(Array.from({length:8},(_,i)=>selection.has(trialSeed(r.verification!.request.seed,i,base.cards))).some(Boolean)).toBe(false);
});
it('rejects aggregate analysis workloads before running individual simulations',()=>{
  const base={cards:1,hours:1,trials:2,seed:1,target:.99,model:{fits:[2e15,0,0,0],slowPct:0,silentPct:0}};
  expect(()=>compare({base,variants:Array.from({length:5},(_,i)=>({id:String(i)}))})).toThrow(/aggregate.*20 million/i);
  expect(()=>search({base,designSpace:{saveSeconds:[0,1,2,3,4,5]},verificationTrials:2})).toThrow(/aggregate.*20 million/i);
  expect(()=>attribute({base,factors:['checkpoint','save','hardDetection']})).toThrow(/aggregate.*20 million/i);
});

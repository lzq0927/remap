import { createRequire } from 'node:module';
import type { TrainingRequest } from '../../contracts/src/types';
import baseline from '../../../references/expert-v4/baseline.json';
import exactConfig from '../../../references/expert-v4/config.json';
import { summarize } from './statistics';
const require=createRequire(import.meta.url);
export const expertEngine=require('./vendor/monthly-engine.cjs')();
const analysis=require('./vendor/shapley.cjs')(expertEngine);
export const TRAINING_METRIC='training.correct-delivery';
export function getTrainingDefaults() {
  return {cards:10000,hours:720,trials:128,seed:9137,target:.99,metricId:TRAINING_METRIC,modelVersion:expertEngine.version,model:structuredClone(baseline),config:structuredClone(exactConfig),factors:[] as string[]};
}
export function getFactors(config:Record<string,any>={}) {return analysis.setup({...exactConfig,...config}).factors.map((f:any)=>({...f,description:f.target}));}
export function resolveTrainingConfig(request:TrainingRequest) {
  for(const key of ['model','config'] as const)if(request[key]!==undefined&&(!request[key]||typeof request[key]!=='object'||Array.isArray(request[key])))throw new Error(key+' must be a parameter object');
  if(request.factors!==undefined&&!Array.isArray(request.factors))throw new Error('factors must be an array');
  if(!Number.isInteger(request.cards)||request.cards<1||request.cards>1000000)throw new Error('cards must be integer 1..1000000');
  if(!Number.isFinite(request.hours)||request.hours<=0||request.hours>8760)throw new Error('hours must be in (0,8760]');
  if(!Number.isInteger(request.trials)||request.trials<2||request.trials>8192)throw new Error('trials must be integer 2..8192');
  if(!Number.isInteger(request.seed)||request.seed<0||request.seed>4294967295)throw new Error('seed must be uint32');
  if(!Number.isFinite(request.target)||request.target<0||request.target>1)throw new Error('target must be in [0,1]');
  if(request.idealWorkPerHour!==undefined&&(!Number.isFinite(request.idealWorkPerHour)||request.idealWorkPerHour<=0))throw new Error('idealWorkPerHour must be positive');
  for(const key of Object.keys(request.model??{}))if(!Object.prototype.hasOwnProperty.call(baseline,key))throw new Error('Unsupported model parameter: '+key);
  for(const key of Object.keys(request.config??{}))if(!Object.prototype.hasOwnProperty.call(exactConfig,key))throw new Error('Unsupported config parameter: '+key);
  const config={...exactConfig,...request.config,trials:request.trials};
  const directKeys=['mode','silentDetect','stepSeconds','silentHours','silentMinutes','silentFallbackHours','fallbackDistribution','retentionHours'];
  const setupConfig={...config,model:{...config.model,...Object.fromEntries(Object.entries(request.model??{}).filter(([key])=>!directKeys.includes(key)))}};
  const setup=analysis.setup(setupConfig), factors=getFactors(setupConfig);
  let params={...setup.baseline,...request.model};
  const applied=new Set<string>();
  for(const id of request.factors??[]) {const factor=factors.find((f:any)=>f.id===id);if(!factor)throw new Error('Unsupported factor: '+id);if(applied.has(id))throw new Error('Duplicate factor: '+id);params={...params,...factor.patch};applied.add(id);}
  expertEngine.validate(params,request.cards);
  if(params.retentionHours!==null)throw new Error('retentionHours is unsupported by the pinned expert engine; use null');
  const rate=expertEngine.summary(params,request.cards).componentRate+expertEngine.summary(params,request.cards).backgroundRate;
  if(rate*request.hours*request.trials>5000000)throw new Error('Expected event work exceeds 5 million; reduce hours/trials/rate');
  return {params,config,expectedEvents:rate*request.hours*request.trials};
}
export function trialSeed(seed:number,index:number,cards:number) {return (seed+Math.imul(index+1,2654435761)+cards)>>>0;}
export function runTraining(request:TrainingRequest,onProgress?:(done:number,total:number)=>void) {
  const {params,config}=resolveTrainingConfig(request),samples:number[]=[],ledger:Record<string,number>={},stats:Record<string,number>={};
  const secondary:Record<string,number>={effective:0,uptime:0,capacity:0,cleanEnd:0};let trace:any[]=[],traceTruncated=false;
  const rates=expertEngine.summary(params,request.cards),totalRate=rates.componentRate+rates.backgroundRate;
  const traceHours=totalRate>0?Math.min(request.hours,200/totalRate):request.hours;
  for(let i=0;i<request.trials;i++) {
    const r=expertEngine.simulate(request.cards,params,trialSeed(request.seed,i,request.cards),{hours:request.hours,trace:i===0&&traceHours===request.hours});
    samples.push(r.delivery);
    for(const [k,v] of Object.entries(r.ledger))ledger[k]=(ledger[k]??0)+(v as number)/request.trials;
    for(const [k,v] of Object.entries(r.stats))stats[k]=(stats[k]??0)+(v as number)/request.trials;
    for(const k of Object.keys(secondary))secondary[k]+=r[k]/request.trials;
    if(i===0){const traced=r.trace??expertEngine.simulate(request.cards,params,trialSeed(request.seed,0,request.cards),{hours:traceHours,trace:true}).trace;trace=traced.slice(0,2000);traceTruncated=traceHours<request.hours||traced.length>2000;}
    onProgress?.(i+1,request.trials);
  }
  const statistics=summarize(samples,request.target);
  const ideal=request.hours*(request.idealWorkPerHour??request.cards);
  return {metricId:TRAINING_METRIC,modelVersion:expertEngine.version,request:structuredClone(request),statistics,ledger,diagnostics:{...secondary,stats,rates,samples,trace,traceSeed:trialSeed(request.seed,0,request.cards),traceTruncated,traceHours,idealWork:ideal,deliveredWork:statistics.mean*ideal,ledgerUnits:'equivalent training hours'},warnings:['FIT decomposition, recovery success and topology are scenario assumptions pending calibration','Confidence intervals describe Monte Carlo error only; parameter/model uncertainty is separate','Unresolved terminal corruption invalidates all delivery, including pre-pollution clean work'],config:{model:params,analysis:config,sourceCommit:'683afe829313bfdcb249bc593e48df5b29813666',seedPolicy:'(seed + imul(trial+1,2654435761) + cards) uint32'}};
}

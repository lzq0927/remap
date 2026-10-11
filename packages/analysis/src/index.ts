import type { TrainingRequest } from '../../contracts/src/types';
import { runTraining, getFactors, resolveTrainingConfig, trialSeed } from '../../solvers/src/training';
import { summarize } from '../../solvers/src/statistics';
export { summarize };

export function shapleyValues(values:number[],m:number) {
  if(!Number.isInteger(m)||m<1||m>12||values.length!==2**m||values.some(v=>!Number.isFinite(v)))throw new Error('Shapley requires 2^m finite feasible coalition values (1..12 factors)');
  const choose=(n:number,k:number)=>{let r=1;for(let j=1;j<=k;j++)r=r*(n-j+1)/j;return r;};
  const pop=(x:number)=>{let c=0;while(x){x&=x-1;c++;}return c;};
  const out=Array(m).fill(0);
  for(let i=0;i<m;i++)for(let s=0;s<values.length;s++)if(!(s&(1<<i)))out[i]+=(values[s|(1<<i)]-values[s])/(m*choose(m-1,pop(s)));
  return out as number[];
}
export function estimateRate(req:{events:number;exposureHours:number;confidence?:number}) {
  const {events,exposureHours}=req,confidence=req.confidence??.95;
  if(!Number.isInteger(events)||events<0||!Number.isFinite(exposureHours)||exposureHours<=0||!Number.isFinite(confidence)||confidence<=0||confidence>=1)throw new Error('Invalid count/exposure/confidence');
  return {events,exposureHours,rate:events/exposureHours,fit:events/exposureHours*1e9,upperRate:events===0?-Math.log(1-confidence)/exposureHours:null,upperFit:events===0?-Math.log(1-confidence)/exposureHours*1e9:null,confidence,method:events===0?'Exact one-sided zero-event Poisson bound':'Poisson maximum likelihood; nonzero-count confidence interval not implemented',evidence:events===0?'Zero observed events does not imply zero failure rate':'Count divided by observed exposure; assumes homogeneous Poisson events'};
}
type CompareRequest={base:TrainingRequest;variants?:Array<{id:string;name?:string;model?:Record<string,any>;config?:Record<string,any>;factors?:string[]}>;candidates?:Array<{id:string;model?:Record<string,any>;factors?:string[]}>};
const ANALYSIS_EVENT_LIMIT=20000000;
function assertAnalysisBudget(requests:TrainingRequest[]) {
  const expected=requests.reduce((sum,request)=>sum+resolveTrainingConfig(request).expectedEvents,0);
  if(expected>ANALYSIS_EVENT_LIMIT)throw new Error('Aggregate expected event work exceeds 20 million; reduce analysis candidates/hours/trials/rate');
  return expected;
}
export function compare(req:CompareRequest,onProgress?:(done:number,total:number)=>void) {
  const variants:NonNullable<CompareRequest['variants']>=req.variants??req.candidates??[];if(variants.length>100)throw new Error('At most 100 comparison variants');
  const requests=variants.map(variant=>({...req.base,model:{...req.base.model,...variant.model},config:{...req.base.config,...variant.config},factors:variant.factors??req.base.factors}));
  const expectedEvents=assertAnalysisBudget([req.base,...requests]),base=runTraining(req.base);
  const items=variants.map((variant,i)=>{
    const result=runTraining(requests[i]);
    const paired=result.diagnostics.samples.map((v,j)=>v-base.diagnostics.samples[j]);onProgress?.(i+1,variants.length);
    return {...variant,result,delta:summarize(paired,0)};
  });
  return {metricId:base.metricId,base,items,expectedEvents,seedPolicy:'paired common random numbers',warnings:['Paired differences estimate sampling error; changed hazards can change event alignment']};
}
export interface SearchRequest {base:TrainingRequest;designSpace:Record<string,any[]>;maxCandidates?:number;verificationTrials?:number;verificationSeed?:number}
export function search(req:SearchRequest,onProgress?:(done:number,total:number)=>void) {
  for(const key of Object.keys(req))if(!['base','designSpace','maxCandidates','verificationTrials','verificationSeed'].includes(key))throw new Error('Unsupported search constraint or field: '+key);
  const keys=Object.keys(req.designSpace),limit=req.maxCandidates??256;
  if(!keys.length||keys.length>8||!Number.isInteger(limit)||limit<1||limit>1024)throw new Error('Search requires 1..8 finite dimensions and maxCandidates 1..1024');
  let count=1;
  for(const key of keys){const values=req.designSpace[key];if(!Array.isArray(values)||!values.length||values.length>100)throw new Error('Each design dimension must contain 1..100 values');count*=values.length;}
  if(count>limit)throw new Error('Finite design space exceeds candidate limit');
  const candidates:Record<string,any>[]=[];
  function enumerate(i:number,patch:Record<string,any>){if(i===keys.length){candidates.push({...patch});return;}for(const value of req.designSpace[keys[i]])enumerate(i+1,{...patch,[keys[i]]:value});}
  enumerate(0,{});
  const requests=candidates.map(patch=>({...req.base,model:{...req.base.model,...patch}}));
  const verificationTrials=req.verificationTrials??Math.min(8192,Math.max(128,req.base.trials));
  // Default starts immediately after the selection stream in the odd-increment uint32 sequence.
  const verificationSeed=req.verificationSeed??((req.base.seed+Math.imul(req.base.trials,2654435761))>>>0);
  const validationCosts=requests.map(request=>resolveTrainingConfig({...request,seed:verificationSeed,trials:verificationTrials}).expectedEvents);
  const worstVerification=requests[validationCosts.indexOf(Math.max(...validationCosts))];
  const expectedEvents=assertAnalysisBudget([...requests,{...worstVerification,seed:verificationSeed,trials:verificationTrials}]);
  const selectionSeeds=new Set(Array.from({length:req.base.trials},(_,i)=>trialSeed(req.base.seed,i,req.base.cards)));
  if(Array.from({length:verificationTrials},(_,i)=>trialSeed(verificationSeed,i,req.base.cards)).some(seed=>selectionSeeds.has(seed)))throw new Error('Verification trial seed sets overlap selection seeds');
  // Clean-checkpoint rollback cannot retain work while skipping saves. Step recovery can;
  // therefore certify this ceiling only when immediate silent step recovery is absent.
  const bound=(p:any)=>{const tau=p.intervalSeconds/3600,save=p.saveSeconds/3600,T=req.base.hours,L=tau+save,cycles=Math.floor(T/L);return (cycles*tau+Math.min(T-cycles*L,tau))/T;};
  const configs=requests.map(request=>resolveTrainingConfig(request).params);
  const upperBound=Math.max(...configs.map(bound));
  const boundApplicable=configs.every(p=>p.silentDetect===0||p.silentPct===0||p.fits.reduce((s:number,v:number)=>s+v,0)===0);
  // Finite horizon can end during compute; report the asymptotic duty cycle as additional evidence.
  const steadyBound=Math.max(...configs.map(p=>p.intervalSeconds/(p.intervalSeconds+p.saveSeconds)));
  if(boundApplicable&&upperBound<req.base.target)return {status:'proven_infeasible',upperBound,checkpointDutyCycle:steadyBound,finiteHorizonUpperBound:upperBound,target:req.base.target,proof:'All candidates fail the clean-checkpoint compute/save ceiling; immediate step recovery cannot skip saves',candidateCount:count,expectedEvents,items:[],verification:null};
  const items=candidates.map((patch,i)=>{const result=runTraining(requests[i]);onProgress?.(i+1,count);return {patch,result};}).sort((a,b)=>b.result.statistics.mean-a.result.statistics.mean);
  const selected=items.find(i=>i.result.statistics.mean>=req.base.target);
  if(!selected)return {status:'no_candidate_found',upperBound:boundApplicable?upperBound:1,checkpointDutyCycle:steadyBound,finiteHorizonUpperBound:boundApplicable?upperBound:1,target:req.base.target,candidateCount:count,expectedEvents,items,verification:null,warnings:['Monte Carlo failure to find a candidate is not a proof of infeasibility',...(boundApplicable?[]:['Checkpoint duty-cycle ceiling is conditional and not a proof when step recovery resets save phase'])]};
  const verification=runTraining({...req.base,model:{...req.base.model,...selected.patch},seed:verificationSeed,trials:verificationTrials});
  return {status:verification.statistics.ciLow>=req.base.target?'verified_candidate':'candidate_unconfirmed',selected,verification,upperBound:boundApplicable?upperBound:1,checkpointDutyCycle:steadyBound,finiteHorizonUpperBound:boundApplicable?upperBound:1,candidateCount:count,expectedEvents,items,warnings:['Selection and verification use disjoint actual trial seed sets; target checked against verification mean CI lower limit',...(boundApplicable?[]:['Checkpoint duty-cycle ceiling is conditional and not a proof when step recovery resets save phase'])]};
}
export function sensitivity(req:{base:TrainingRequest;parameter:string;values:any[]},onProgress?:(done:number,total:number)=>void) {
  if(!req.values.length||req.values.length>100)throw new Error('Sensitivity requires 1..100 values');
  return {parameter:req.parameter,...compare({base:req.base,variants:req.values.map((value,i)=>({id:String(i),name:String(value),model:{[req.parameter]:value}}))},onProgress)};
}
export function attribute(req:{base:TrainingRequest;factors?:string[];method?:string},onProgress?:(done:number,total:number)=>void) {
  if(req.method&&req.method!=='shapley')throw new Error('Only exact Shapley supported');
  const factors:string[]=req.factors??getFactors(req.base.config).map((f:any)=>f.id),m=factors.length;
  if(m<1||m>8||new Set(factors).size!==m)throw new Error('Exact Shapley requires 1..8 unique factors');
  if(2**m*req.base.trials>131072)throw new Error('Shapley coalition trial limit exceeded');
  const known=getFactors(req.base.config);for(const id of factors)if(!known.some((f:any)=>f.id===id))throw new Error('Unknown attribution factor '+id);
  const requests=Array.from({length:2**m},(_,mask)=>({...req.base,factors:[...(req.base.factors??[]).filter(f=>!factors.includes(f)),...factors.filter((_,i)=>mask&(1<<i))]}));
  const expectedEvents=assertAnalysisBudget(requests);
  const coalitions=requests.map((request,mask)=>{
    const result=runTraining(request);onProgress?.(mask+1,2**m);return {mask,factors:factors.filter((_,i)=>mask&(1<<i)),result};
  });
  const sampleContributions=Array.from({length:req.base.trials},(_,trial)=>shapleyValues(coalitions.map(c=>c.result.diagnostics.samples[trial]),m));
  const contributions=factors.map((id,i)=>({id,name:known.find((f:any)=>f.id===id).name,statistics:summarize(sampleContributions.map(c=>c[i]),0),shapley:sampleContributions.reduce((s,c)=>s+c[i],0)/req.base.trials}));
  const gain=coalitions.at(-1)!.result.statistics.mean-coalitions[0].result.statistics.mean,residual=contributions.reduce((s,c)=>s+c.shapley,0)-gain;
  return {method:'exact Shapley',metricId:coalitions[0].result.metricId,contributions,gain,residual,coalitions,expectedEvents,assumptions:['All feasible combinations enumerated with paired seeds','Negative contributions retained','Loss ledger is accounting; Shapley is causal comparison within specified interventions']};
}

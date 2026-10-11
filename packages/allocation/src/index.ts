export interface AllocationItem {id:string;name?:string;baselineRate?:number;baselineAvailability?:number;complexity?:number;importance?:number;operatingHours?:number;weight?:number;locked?:number;bounds?:{min?:number;max?:number}}
export interface AllocationRequest {method:'equal'|'arinc'|'agree'|'agree.nasa2016-rate'|'availability';target:number;hours:number;items:AllocationItem[];metricId?:string}
/** Bounded weighted allocation of series log-loss after deducting fixed modules. */
function availabilityTargets(items:AllocationItem[],target:number) {
  const total=-Math.log(target),targets=Array<number>(items.length).fill(0);
  let lockedBudget=0;
  const free:Array<{index:number;weight:number;low:number;high:number}>=[];
  items.forEach((item,index)=>{
    if(item.bounds!==undefined&&(!item.bounds||typeof item.bounds!=='object'||Array.isArray(item.bounds)||Object.keys(item.bounds).some(k=>!['min','max'].includes(k))))throw new Error('Availability constraint conflict: bounds must contain only min/max');
    const min=item.bounds?.min??0,max=item.bounds?.max??1;
    if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max>1||min>max||max<=0)throw new Error('Availability constraint conflict: invalid bounds');
    if(item.locked!==undefined) {
      if(!Number.isFinite(item.locked)||item.locked<=0||item.locked>1||item.locked<min||item.locked>max)throw new Error('Availability constraint conflict: locked value outside bounds');
      targets[index]=item.locked;lockedBudget-=Math.log(item.locked);
    } else {
      const weight=item.weight??1,low=-Math.log(max),high=min===0?Infinity:-Math.log(min);
      free.push({index,weight,low,high:weight===0?low:high});
    }
  });
  const remaining=total-lockedBudget,lower=free.reduce((s,i)=>s+i.low,0),upper=free.reduce((s,i)=>s+i.high,0),tolerance=1e-12;
  if(remaining<lower-tolerance||remaining>upper+tolerance)throw new Error('Availability constraint conflict: target outside feasible log-budget');
  if(!free.length) {if(Math.abs(remaining)>tolerance)throw new Error('Availability constraint conflict: locked values do not meet target');return targets;}
  // Scaling preserves the weighted solution while keeping bisection near its natural magnitude.
  const freeScale=Math.max(...free.map(item=>item.weight));
  if(freeScale>0)for(const item of free)item.weight/=freeScale;
  const clamp=(alpha:number,item:typeof free[number])=>Math.max(item.low,Math.min(item.high,alpha*item.weight));
  const loss=(alpha:number)=>free.reduce((s,item)=>s+clamp(alpha,item),0);
  let high=1;
  while(loss(high)<remaining-tolerance) {high*=2;if(!Number.isFinite(high))throw new Error('Availability constraint conflict: free weights cannot absorb budget');}
  let low=0;
  for(let i=0;i<100;i++){const mid=(low+high)/2;if(loss(mid)<remaining)low=mid;else high=mid;}
  for(const item of free)targets[item.index]=Math.exp(-clamp((low+high)/2,item));
  return targets;
}
export function allocate(req:AllocationRequest) {
  const {method,target,hours,items}=req;
  if(!['equal','arinc','agree','agree.nasa2016-rate','availability'].includes(method))throw new Error('Unsupported allocation method');
  if(!(target>0&&target<=1)||!Number.isFinite(hours)||hours<=0||!items.length||items.length>1000)throw new Error('Invalid allocation bounds');
  if(new Set(items.map(i=>i.id)).size!==items.length)throw new Error('Allocation item IDs must be unique');
  if(req.metricId?.includes('training'))throw new Error('Allocation applies to submodel task reliability or availability, not training delivery');
  const expectedMetric=method==='availability'?'steady-state-availability':'task-reliability';
  if(req.metricId!==undefined&&req.metricId!==expectedMetric)throw new Error('Unsupported metric for allocation method: expected '+expectedMetric);
  if((method==='equal'||method==='arinc')&&items.some(i=>i.operatingHours!==undefined&&i.operatingHours!==hours))throw new Error('Equal/ARINC operatingHours must equal common task hours');
  for(const i of items)for(const key of ['baselineRate','complexity','importance','operatingHours','weight'] as const)if(i[key]!==undefined&&(!Number.isFinite(i[key])||i[key]!<0))throw new Error('Invalid '+key);
  for(const i of items)if(i.baselineAvailability!==undefined&&(!Number.isFinite(i.baselineAvailability)||i.baselineAvailability<0||i.baselineAvailability>1))throw new Error('Invalid baselineAvailability: expected finite value in [0,1]');
  if(method!=='availability'&&items.some(i=>i.locked!==undefined||i.bounds!==undefined))throw new Error('Unsupported allocation constraints for '+method);
  const agree=method==='agree'||method==='agree.nasa2016-rate';
  if(agree&&items.some(i=>(i.importance??1)<=0||(i.operatingHours??hours)<=0))throw new Error('AGREE requires positive importance E_i and operating time t_i');
  const budget=-Math.log(target)/hours;
  let raw=items.map(()=>1), warnings:string[]=[],assumptions=['Series system; constant independent exponential task failure rates'];
  if(method==='arinc'){raw=items.map(i=>i.baselineRate??0);if(raw.reduce((a,b)=>a+b,0)<=0)throw new Error('ARINC requires positive aggregate baseline rate');}
  if(method==='availability'){raw=items.map(i=>i.weight??1);assumptions=['Independent steady-state series availability','Locked values deducted from log-budget; free targets use bounded weighted log allocation'];}
  if(agree){raw=items.map(i=>i.complexity??1);warnings=['NASA 2016 approximate rate formula: lambda_i=n_i*(-ln R)/(N*E_i*t_i), N=sum n_i; importance changes task-rate interpretation'];}
  const rawScale=Math.max(...raw);
  if(rawScale>0)raw=raw.map(value=>value/rawScale);
  const sum=raw.reduce((a,b)=>a+b,0);if(sum<=0&&method!=='availability')throw new Error('Weights must sum to a positive number');
  const targets=method==='availability'?availabilityTargets(items,target):null;
  return {method,version:agree?'agree.nasa2016-rate':method==='availability'?'availability.log-budget.v1':method+'.rate.v1',metricId:method==='availability'?'steady-state-availability':'task-reliability',items:items.map((i,j)=>{const weight=sum>0?raw[j]/sum:0,rate=agree?weight*(-Math.log(target))/(i.importance??1)/(i.operatingHours??hours):budget*weight;
    const itemTarget=targets?.[j]??Math.exp(-rate*(i.operatingHours??hours)),current=method==='availability'?(i.baselineAvailability??null):(i.baselineRate===undefined?null:Math.exp(-i.baselineRate*(i.operatingHours??hours)));
    return {...i,name:i.name??i.id,current,target:itemTarget,targetRate:method==='availability'?null:rate,weight,gap:current===null?null:itemTarget-current};}),assumptions,warnings};
}

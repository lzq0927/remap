import { solveStatic } from './static';
export interface RepairableRequest {hours:number;topology:'series'|'parallel';modules:Array<{id:string;failureRate:number;repairRate:number}>}
export function solveRepairable(req:RepairableRequest) {
  if(!Number.isFinite(req.hours)||req.hours<=0||!['series','parallel'].includes(req.topology)||!req.modules.length||req.modules.length>64)throw new Error('Invalid repairable system dimensions');
  if(new Set(req.modules.map(m=>m.id)).size!==req.modules.length)throw new Error('Module IDs must be unique');
  const items=req.modules.map(m=>{if(!Number.isFinite(m.failureRate)||!Number.isFinite(m.repairRate)||m.failureRate<0||m.repairRate<=0)throw new Error('Module failure rate must be nonnegative and repair rate positive');return {...m,availability:m.repairRate/(m.failureRate+m.repairRate),taskReliability:Math.exp(-m.failureRate*req.hours),mtbf:m.failureRate===0?null:1/m.failureRate,mttr:1/m.repairRate};});
  const evaluate=(key:'availability'|'taskReliability')=>solveStatic({method:'rbd',tree:{type:req.topology,children:items.map(i=>({type:'event',id:i.id,probability:i[key]}))}}).probability;
  return {availability:evaluate('availability'),taskReliability:evaluate('taskReliability'),hours:req.hours,items,metricIds:['steady-state-availability','task-reliability'],assumptions:['Independent two-state repairable modules','Constant exponential failure and repair rates','Task reliability requires uninterrupted success over mission hours']};
}

export interface StaticNode { type:'series'|'parallel'|'kofn'|'and'|'or'|'event'; children?:StaticNode[];k?:number;id?:string;probability?:number }
export interface StaticRequest {method:'rbd'|'fta'|'bdd';tree:StaticNode;events?:Record<string,number>;correlations?:unknown}
/** Reduced ordered binary decision diagram; repeated event IDs denote the same random variable. */
export function solveStatic(req:StaticRequest) {
  if(!['rbd','fta','bdd'].includes(req.method))throw new Error('Unsupported static method');
  if(req.correlations)throw new Error('Correlated events are unsupported: specify an explicit joint model');
  const probabilities=new Map<string,number>();let count=0;
  function collect(n:StaticNode,depth:number) {
    if(++count>2000||depth>100)throw new Error('Tree resource limit exceeded');
    if(n.type==='event') {
      if(!n.id)throw new Error('Event requires stable ID');
      const p=n.probability??req.events?.[n.id];
      if(p===undefined||!Number.isFinite(p)||p<0||p>1)throw new Error('Event probability must be in [0,1]');
      if(probabilities.has(n.id)&&probabilities.get(n.id)!==p)throw new Error('Conflicting probability for repeated event '+n.id);
      probabilities.set(n.id,p);return;
    }
    if(!['series','parallel','kofn','and','or'].includes(n.type)||!n.children?.length)throw new Error('Invalid gate or empty children');
    if(n.type==='kofn'&&(!Number.isInteger(n.k)||n.k!<1||n.k!>n.children.length))throw new Error('k must be integer in [1,n]');
    n.children.forEach(c=>collect(c,depth+1));
  }
  collect(req.tree,0);if(probabilities.size>64)throw new Error('At most 64 independent events supported');
  const ids=[...probabilities.keys()].sort(), order=new Map(ids.map((id,i)=>[id,i]));
  const nodes=[{v:Infinity,lo:0,hi:0},{v:Infinity,lo:1,hi:1}],unique=new Map<string,number>(),memo=new Map<string,number>();
  function make(v:number,lo:number,hi:number):number {if(lo===hi)return lo;const key=[v,lo,hi].join(',');const old=unique.get(key);if(old!==undefined)return old;if(nodes.length>=100000)throw new Error('BDD node limit exceeded');const i=nodes.length;nodes.push({v,lo,hi});unique.set(key,i);return i;}
  function apply(op:'and'|'or',a:number,b:number):number {
    if(a>b)[a,b]=[b,a];
    if(op==='and'){if(a===0)return 0;if(a===1)return b;}else{if(b===1||a===1)return 1;if(a===0)return b;}if(a===b)return a;
    const key=[op,a,b].join(',');const old=memo.get(key);if(old!==undefined)return old;
    if(memo.size>200000)throw new Error('BDD operation limit exceeded');
    const v=Math.min(nodes[a].v,nodes[b].v);
    const result=make(v,apply(op,nodes[a].v===v?nodes[a].lo:a,nodes[b].v===v?nodes[b].lo:b),apply(op,nodes[a].v===v?nodes[a].hi:a,nodes[b].v===v?nodes[b].hi:b));memo.set(key,result);return result;
  }
  function build(n:StaticNode):number {
    if(n.type==='event')return make(order.get(n.id!)!,0,1);
    const children=n.children!.map(build);
    if(n.type==='kofn') {const dp=Array(n.k!+1).fill(0);dp[0]=1;for(const c of children){for(let j=n.k!;j>=1;j--)dp[j]=apply('or',dp[j],apply('and',dp[j-1],c));}return dp[n.k!];}
    const op=(n.type==='series'||n.type==='and')?'and':'or';return children.reduce((a,b)=>apply(op,a,b),op==='and'?1:0);
  }
  const root=build(req.tree),cache=new Map<number,number>([[0,0],[1,1]]);
  function evaluate(i:number):number {if(cache.has(i))return cache.get(i)!;const node=nodes[i],p=probabilities.get(ids[node.v])!,r=(1-p)*evaluate(node.lo)+p*evaluate(node.hi);cache.set(i,r);return r;}
  return {method:req.method,probability:evaluate(root),details:{solver:'reduced ordered BDD',eventCount:ids.length,bddNodes:nodes.length,root,eventOrder:ids,assumptions:['Distinct basic events independent','Repeated event IDs shared across all gates'],metric:req.method==='fta'?'top-event probability':'success probability'}};
}

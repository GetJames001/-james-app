// Host-owned presentation fence. Identity is resolved by the existing lifecycle.
export function createIdentityObserver({lifecycle,root,isActive,onChanged,onUnavailable=()=>{}}){
 let generation=0,disposed=false;
 async function check(){
  if(disposed||!isActive())return {status:'skipped'};
  const ticket=++generation;root.hidden=true;
  let result;try{result=await lifecycle.verifyIdentity()}catch{result={status:'failed'}}
  if(disposed||generation!==ticket)return {status:'superseded'};
  if(result.status==='verified'&&result.isCurrent?.()&&isActive())root.hidden=false;
  else if(result.status==='changed'){onChanged();}
  else if(result.status==='failed')onUnavailable();
  return result;
 }
 return {check,dispose(){disposed=true;generation++}};
}

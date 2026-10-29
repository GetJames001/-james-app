'use strict';
function createResourceBudget({maxConcurrent=4,maxBytes=32000000}={}){
 if(!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>4||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32000000)throw Error('PUBLIC_FETCH_INVALID');
 let active=0,reserved=0,used=0;const queue=[];
 function drain(){while(queue.length&&active<maxConcurrent){const entry=queue[0];if(used+reserved+entry.limit>maxBytes){if(active)return;queue.shift();entry.cleanup();entry.reject(Error('RESOURCE_BUDGET_EXHAUSTED'));continue}queue.shift();entry.cleanup();active++;reserved+=entry.limit;entry.resolve()}}
 return {async run(limit,operation,{signal}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>maxBytes||typeof operation!=='function')throw Error('PUBLIC_FETCH_INVALID');if(signal?.aborted)throw Error('TASK_INTERRUPTED');
  await new Promise((resolve,reject)=>{const entry={limit,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)};function abort(){const i=queue.indexOf(entry);if(i>=0){queue.splice(i,1);entry.cleanup();reject(Error('TASK_INTERRUPTED'));drain()}}queue.push(entry);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();else drain()});
  let charged=limit;
  try{if(signal?.aborted)throw Error('TASK_INTERRUPTED');const result=await operation();const size=result?.body?.byteLength;if(!Number.isSafeInteger(size)||size<0||size>limit)throw Error('PUBLIC_RESPONSE_TOO_LARGE');charged=size;return result}
  finally{used+=charged;active--;reserved-=limit;drain()}
 }};
}
module.exports={createResourceBudget};

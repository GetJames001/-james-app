'use strict';
function schedulePlatformFixture(end,now){
 let state='active',available=true,bounded=true,stopWorks=true,stops=0;
 const inspect=async()=>available?{state,activeUntil:state==='active'&&bounded?end:null,bounded:state==='active'&&bounded&&now()<end,verifiedAt:now()}:{state:'unknown',activeUntil:null,bounded:false,verifiedAt:null};
 return {platform:{inspect,async stop(){stops++;if(available&&stopWorks)state='inactive';return inspect();}},stops:()=>stops,available:v=>{available=v;},bounded:v=>{bounded=v;},stopWorks:v=>{stopWorks=v;},state:v=>{state=v;}};
}
module.exports={schedulePlatformFixture};

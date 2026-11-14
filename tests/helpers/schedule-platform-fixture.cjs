'use strict';
function schedulePlatformFixture(end,now){
 let state='active',available=true,bounded=true,stopWorks=true,stops=0,enables=0,enableHook=null;
 const inspect=async()=>available?{state,activeUntil:state==='active'&&bounded?end:null,bounded:state==='active'&&bounded&&now()<end,verifiedAt:now()}:{state:'unknown',activeUntil:null,bounded:false,verifiedAt:null};
 return {platform:{inspect,async enableBounded(){enables++;if(enableHook)await enableHook();if(available&&state==='inactive'){state='active';bounded=true;}return inspect();},async stop(){stops++;if(available&&stopWorks)state='inactive';return inspect();}},stops:()=>stops,enables:()=>enables,enableHook:fn=>{enableHook=fn;},available:v=>{available=v;},bounded:v=>{bounded=v;},stopWorks:v=>{stopWorks=v;},state:v=>{state=v;}};
}
module.exports={schedulePlatformFixture};

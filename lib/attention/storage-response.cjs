'use strict';
// Bound the REST envelope before JSON parsing; snapshot validation remains 1 MiB.
const MAX_RESPONSE_BYTES=8*1024*1024;
async function boundedJson(response){
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_RESPONSE_BYTES)){
    await response.body?.cancel();throw new Error('STORAGE_RESPONSE_TOO_LARGE');
  }
  if(!response.body)throw new Error('EMPTY_STORAGE_RESPONSE');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let size=0,text='';
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>MAX_RESPONSE_BYTES)throw new Error('STORAGE_RESPONSE_TOO_LARGE');
    text+=decoder.decode(value,{stream:true});
  }text+=decoder.decode();return JSON.parse(text);}
  catch(error){try{await reader.cancel();}catch{}throw error;}
  finally{reader.releaseLock();}
}
module.exports={boundedJson};

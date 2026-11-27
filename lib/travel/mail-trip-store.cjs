'use strict';
const {createHash}=require('node:crypto');
const {merge,render,validateCandidate}=require('./mail-trip.cjs');
const {isDeepStrictEqual}=require('node:util');
// Optimistic atomic replacement of one existing logical booking only. The
// generic file ID is stable and content remains compatible with Files/Travel.
const COMMIT=`
 local current=redis.call('HGET',KEYS[1],ARGV[1])
 if (current or '')~=ARGV[2] then return -1 end
 if ARGV[5]~='' and (redis.call('HGET',KEYS[1],'bytes:'..ARGV[1]) or '')~=ARGV[5] then return -1 end
 if not current and redis.call('HLEN',KEYS[1])>=40 then return 0 end
 redis.call('HSET',KEYS[1],ARGV[1],ARGV[3],'bytes:'..ARGV[1],ARGV[4])
 return 1
`;
// A first confirmation may already contain newly added hotel/pickup details.
// Match the exact prior itinerary with either addition absent, while retaining
// exact title, dates, destination and every flight. Never discard an existing
// conflicting detail or choose between multiple legacy matches.
function legacyVersions(values){
 let versions=[values];
 for(const field of ['hotel','pickup'])if(values[field]){
  versions=versions.concat(versions.map(value=>{const prior={...value};delete prior[field];return prior;}));
 }
 return versions.map(render);
}
// A shared destination/date is never enough to associate two trips.
async function findExisting(command,key,candidate){
 const direct=await command(['HGET',key,candidate.id]);
 if(direct)return {id:candidate.id,old:direct};
 const ids=(await command(['HKEYS',key])).filter(id=>/^[a-f0-9]{64}$/.test(id));
 if(ids.length>20)throw Error('FILES_LIMIT_REACHED');
 const linked=[],legacy=[],priorVersions=legacyVersions(candidate.values);
 for(const id of ids){
  const old=await command(['HGET',key,id]);
  if(!old)continue;
  const metadata=JSON.parse(old);
  if(metadata.mailTrip?.bookingId===candidate.id){linked.push({id,old});continue;}
  if(metadata.mailTrip||!metadata.name?.endsWith('.james-trip.json')||!candidate.values.flights?.length)continue;
  const content=await command(['HGET',key,'bytes:'+id]);
  if(!content)continue;
  let trip;try{trip=JSON.parse(Buffer.from(content,'base64').toString('utf8'));}catch{continue;}
  if(priorVersions.some(prior=>isDeepStrictEqual(trip,prior)))legacy.push({id,old,content,legacy:true});
 }
 if(linked.length>1||(!linked.length&&legacy.length>1))throw Error('TRAVEL_IDENTITY_CONFLICT');
 return linked[0]||legacy[0]||{id:candidate.id,old:null};
}
function createStore({command,environment}){
 if(!['preview','production'].includes(environment))throw Error('INVALID_TRAVEL_ENVIRONMENT');
 return {async upsert(owner,candidate){
  validateCandidate(candidate);
  if(typeof owner!=='string'||!owner.trim())throw Error('TRAVEL_IDENTITY_REQUIRED');
  const key='james:files:v1:'+environment+':'+createHash('sha256').update(owner).digest('hex');
  for(let attempt=0;attempt<4;attempt++){
   const existing=await findExisting(command,key,candidate),{id,old}=existing;
   let metadata=old?JSON.parse(old):null;
   if(metadata&&!metadata.mailTrip&&!existing.legacy)throw Error('TRAVEL_ID_COLLISION');
   const merged=merge(metadata?.mailTrip,candidate),bytes=Buffer.from(JSON.stringify(merged.trip));
   const updated={id,name:metadata?.name||candidate.id+'.james-trip.json',type:'application/json',lastModified:Math.max(...Object.values(merged.fields).map(f=>f.at)),size:bytes.length,mailTrip:{bookingId:candidate.id,fields:merged.fields},revision:createHash('sha256').update(bytes).digest('hex')};
   const next=JSON.stringify(updated);if(next===old)return 'unchanged';
   const saved=await command(['EVAL',COMMIT,1,key,id,old||'',next,bytes.toString('base64'),existing.content||'']);
   if(saved===1)return metadata?'updated':'created';
   if(saved===0)throw Error('FILES_LIMIT_REACHED');
   if(saved!==-1)throw Error('TRAVEL_COMMIT_UNKNOWN');
  }
  throw Error('TRAVEL_CHANGED_RETRY');
 }};
}
async function sync(snapshot,owner,store,verify){
 if(typeof verify!=='function')throw Error('VERIFIED_TRAVEL_READER_REQUIRED');
 const counts={created:0,updated:0,unchanged:0};
 for(const candidate of await verify(snapshot))counts[await store.upsert(owner,candidate)]++;
 return counts;
}
module.exports={createStore,sync,COMMIT};

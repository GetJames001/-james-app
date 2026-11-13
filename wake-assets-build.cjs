'use strict';
// Build-time downloads only. Browser wake audio never goes to these hosts.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const unzipper=require('unzipper');
const MODEL='vosk-model-small-en-us-0.15';
const SOURCES=[
 {name:'vosk-browser-0.0.8.tgz',url:'https://registry.npmjs.org/vosk-browser/-/vosk-browser-0.0.8.tgz',algorithm:'sha512',hash:'df9MuChirUGKxP/+4k8tBV6hJOic8IRdJXv64+ET0Ue5CddOzLZINiHOWCka765gBzHJWNtQKgaYakS0FXZIJA==',encoding:'base64',limit:8000000},
 {name:MODEL+'.zip',url:'https://alphacephei.com/vosk/models/'+MODEL+'.zip',algorithm:'sha256',hash:'30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498',encoding:'hex',limit:42000000}
];
async function download(source){
 let data;
 if(process.env.JAMES_WAKE_BUILD_CACHE){try{data=await fs.readFile(path.join(process.env.JAMES_WAKE_BUILD_CACHE,source.name));}catch{}}
 if(!data){const response=await fetch(source.url,{signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('Wake asset download failed: '+source.name);let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>source.limit)throw Error('Wake asset too large');chunks.push(chunk);}data=Buffer.concat(chunks);}
 if(data.length>source.limit||createHash(source.algorithm).update(data).digest(source.encoding)!==source.hash)throw Error('Wake asset integrity mismatch: '+source.name);
 return data;
}
async function build(){
 const output=path.join(__dirname,'assets/wake/v1'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'james-wake-'));
 try{
  const [runtime,model]=await Promise.all(SOURCES.map(download));
  await fs.writeFile(path.join(temp,'runtime.tgz'),runtime);
  const archive=await unzipper.Open.buffer(model);
  for(const file of archive.files){if(file.type==='Directory')continue;if(!file.path.startsWith(MODEL+'/')||file.path.split('/').includes('..'))throw Error('Invalid model path');const target=path.join(temp,file.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,await file.buffer());}
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'vosk-0.0.8.js'),execFileSync('tar',['-xOf',path.join(temp,'runtime.tgz'),'package/dist/vosk.js'],{maxBuffer:8000000}));
  execFileSync('tar',['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','-czf',path.join(output,'english-0.15.tar.gz'),'-C',temp,MODEL]);
  const manifest={runtime:'vosk-browser@0.0.8',model:MODEL,files:[]};
  for(const name of ['vosk-0.0.8.js','english-0.15.tar.gz']){const data=await fs.readFile(path.join(output,name));manifest.files.push({name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify(manifest));
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
if(require.main===module)build().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={build,SOURCES};

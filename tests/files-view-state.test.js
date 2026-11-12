'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 const start=app.indexOf(" const filesStatus=document.getElementById('voiceAttachmentLibraryStatus');"),end=app.indexOf(" document.addEventListener('james:files-opened',loadSavedFiles);",start);
 const node=()=>({textContent:'',children:[],value:'',replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},setAttribute(){}});
 const nodes={voiceAttachmentLibraryStatus:node(),savedJamesFiles:node(),searchJamesFiles:node(),saveJamesFiles:node()};let response={files:[]},status=200;
 const context={document:{getElementById:id=>nodes[id],createElement:node},fetch:async(url,options)=>{assert.equal(url,'/api/james/files');assert.equal(options.method,'GET');return Response.json(response,{status});}};
 vm.runInNewContext(app.slice(start,end),context);
 return {context,nodes,reply(value,code=200){response=value;status=code;},text(){return nodes.savedJamesFiles.children.map(n=>n.textContent||n.children.map(x=>x.textContent).join('')).join('\n');}};
}
const files=[{id:'a'.repeat(64),name:'Wardrobe notes.pdf',size:1024},{id:'b'.repeat(64),name:'Travel ideas.txt',size:500}];
test('Files distinguishes unread, verified empty, matching search and no matches',async()=>{
 const f=fixture();f.context.renderSavedFiles();assert.equal(f.text(),'','an unread account must not be presented as empty');
 assert.equal(await f.context.loadSavedFiles(),true);assert.equal(f.text(),'No files available');
 f.reply({files});await f.context.loadSavedFiles();assert.match(f.text(),/Wardrobe notes/);assert.match(f.text(),/Travel ideas/);
 f.nodes.searchJamesFiles.value='WARDROBE';f.context.renderSavedFiles();assert.match(f.text(),/Wardrobe notes/);assert.doesNotMatch(f.text(),/Travel ideas/);
 f.nodes.searchJamesFiles.value='missing';f.context.renderSavedFiles();assert.equal(f.text(),'No files match your search.');
});
test('Files failure preserves known records, malformed reads cannot replace them, and retry clears stale errors',async()=>{
 const f=fixture();f.reply({error:'Unavailable'},503);assert.equal(await f.context.loadSavedFiles(),false);assert.equal(f.text(),'');assert.match(f.nodes.voiceAttachmentLibraryStatus.textContent,/unavailable/);
 f.reply({files});assert.equal(await f.context.loadSavedFiles(),true);assert.equal(f.nodes.voiceAttachmentLibraryStatus.textContent,'','a verified retry clears the old error');
 const previous=f.text();
 for(const value of [{},{files:null},{files:[{id:'bad',size:1}]},{files:Array(21).fill(files[0])}]){
  f.reply(value);assert.equal(await f.context.loadSavedFiles(),false);assert.equal(f.text(),previous);assert.match(f.nodes.voiceAttachmentLibraryStatus.textContent,/out of date/);
 }
 f.reply({files:[]});assert.equal(await f.context.loadSavedFiles(),true);assert.equal(f.text(),'No files available');assert.equal(f.nodes.voiceAttachmentLibraryStatus.textContent,'');
 f.reply({error:'Unavailable'},503);await f.context.loadSavedFiles();assert.equal(f.text(),'','a failed refresh must not keep claiming verified emptiness');
});

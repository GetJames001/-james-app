'use strict';
function mountMagazine({list,read,save}){
 const el=id=>document.getElementById(id);
 const tag=(name,text)=>{const node=document.createElement(name);node.textContent=text;return node;};
 const link=(title,url)=>{const a=tag('a',title);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const gumbo={title:'Cajun chicken & sausage gumbo',url:'https://www.seriouseats.com/cajun-gumbo-with-chicken-and-andouille-recipe',publisher:'Serious Eats'};
 const safeRecipe=row=>{try{return typeof row.title==='string'&&row.title.trim()&&row.title.length<=200&&typeof row.publisher==='string'&&row.publisher.length<=100&&new URL(row.url).protocol==='https:';}catch{return false;}};
 let pages=[gumbo],current=0,bookRequest=0;
 const suffix='.james-recipe.json';
 function drawBook(){
  const recipe=pages[current],isGumbo=recipe.url===gumbo.url,paper=el('bookPage');
  paper.replaceChildren(tag('small',recipe.publisher),tag('h3',recipe.title));
  if(isGumbo){
   paper.append(tag('h4','Ingredients'),tag('p','Chicken, andouille, roux, onion, celery, bell pepper and stock.'),tag('h4','Method'),tag('p','Build the dark roux, soften the vegetables, then simmer the meat in stock. Serve over rice.'));
  }else paper.append(tag('p','Open the publisher’s recipe for ingredients, quantities and directions.'));
  paper.append(link('Open full recipe',recipe.url));
  const photo=el('bookPhoto');
  let publisherPhoto=false;try{const u=new URL(recipe.photo);publisherPhoto=u.protocol==='https:'&&u.hostname==='www.budgetbytes.com';}catch{}
  photo.hidden=!isGumbo&&!publisherPhoto;photo.src=publisherPhoto?recipe.photo:'assets/lifestyle/recipe.jpg';photo.alt=isGumbo?'Chicken and sausage gumbo':recipe.title;
  paper.parentElement.classList.toggle('source-only',photo.hidden);
  el('bookPosition').textContent=(current+1)+' / '+pages.length;el('bookPrev').disabled=current===0;el('bookNext').disabled=current===pages.length-1;
 }
 async function loadBook(){
  const generation=++bookRequest;
  try{
   const {files}=await list();
   const rows=await Promise.all(files.filter(f=>f.name.endsWith(suffix)).map(async f=>JSON.parse(await (await read(f.id)).text())));
   if(generation!==bookRequest)return;
   const selected=pages[current]?.url;pages=[...new Map([gumbo,...rows.filter(safeRecipe)].map(row=>[row.url,row])).values()];
   current=Math.max(0,pages.findIndex(row=>row.url===selected));drawBook();el('bookNotice').textContent='';
  }catch{if(generation===bookRequest)el('bookNotice').textContent='Saved recipes could not be refreshed.';}
 }
 el('bookPrev').onclick=()=>{if(current>0){current--;drawBook();}};
 el('bookNext').onclick=()=>{if(current<pages.length-1){current++;drawBook();}};
 el('recipeAsk').onclick=()=>{page('insights');const q=el('jamesQuestion');q.value='Help me find a recipe using ';q.focus();q.setSelectionRange(q.value.length,q.value.length);};
 const feeds=new Map();
 async function refreshFeed(host){
  const key=host.dataset.feed;
  let entry=feeds.get(key);
  if(!entry||Date.now()-entry.time>900000){
   const promise=fetch('/api/lifestyle/feed?source='+key,{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error();return response.json();});
   entry={time:Date.now(),promise};feeds.set(key,entry);
  }
  host.textContent='Loading stories…';
  try{
   const data=await entry.promise;
   const nodes=data.items.map(item=>{
    const row=tag('div','');row.className='mag-story';row.append(link(item.title,item.url));
    if(key==='recipes'){
     if(item.photo){const image=document.createElement('img');image.src=item.photo;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';row.prepend(image);}
     const button=tag('button','Save to book');row.append(button);
     button.onclick=async()=>{
      button.disabled=true;
      try{
       const recipe={title:item.title,url:item.url,publisher:data.publisher,...(item.photo?{photo:item.photo}:{})};
       if(!safeRecipe(recipe))throw Error();
       await save(new File([JSON.stringify(recipe)],'saved'+suffix,{type:'application/json',lastModified:0}));
       await loadBook();const index=pages.findIndex(p=>p.url===item.url);
       if(index>=0){current=index;drawBook();}button.textContent='Saved';
      }catch{button.disabled=false;button.textContent='Retry save';}
     };
    }return row;
   });
   host.replaceChildren(tag('small',data.publisher),...nodes);
  }catch{if(feeds.get(key)===entry)feeds.delete(key);const retry=tag('button','Retry feed');retry.onclick=()=>refreshFeed(host);host.replaceChildren(tag('p','The publisher feed is unavailable.'),retry);}
 }
 for(const b of document.querySelectorAll('[data-career]'))b.onclick=()=>{
  page('files');const search=el('searchJamesFiles');search.value=b.dataset.career;search.dispatchEvent(new Event('input'));search.focus();
 };
 const workouts=[['Full-body strength','Explore muscle-strengthening activities for your major muscle groups.'],['Mobility reset','Choose a comfortable range of motion and move slowly through shoulders, hips and ankles.'],['Strength basics','Choose a familiar strength exercise and focus on a controlled movement.']];
 let workout=Math.floor(Date.now()/86400000)%workouts.length;
 function showWorkout(){el('dailyWorkout').textContent=workouts[workout][0];el('workoutDetail').replaceChildren(tag('span',workouts[workout][1]+' '),link('Activity guide · CDC','https://www.cdc.gov/physical-activity-basics/adding-adults/index.html'));}
 el('swapWorkout').onclick=()=>{workout=(workout+1)%workouts.length;showWorkout();};
 function showHealth(){
  const items=(window.liveEvents||[]).filter(e=>Date.parse(e.end)>=Date.now()&&/\b(dentist|doctor|physical exam|annual physical|checkup|medical|clinic|cardiolog\w*|dermatolog\w*)\b/i.test(e.title||'')).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(0,4);
  el('healthMeetings').replaceChildren(...(items.length?items.map(e=>tag('p',e.title+' · '+new Date(e.start).toLocaleDateString())):[tag('p','No upcoming health visits identified in the loaded calendar.')]));
 }
 function openMagazine(){
  const screen=document.querySelector('.page.active');if(!screen)return;
  screen.querySelectorAll('[data-feed]').forEach(refreshFeed);
  if(screen.id==='recipes')void loadBook();
  if(screen.id==='fitness'){showWorkout();showHealth();}
 }
 drawBook();showWorkout();openMagazine();
 window.addEventListener('james:page-changed',openMagazine);
 window.addEventListener('james:calendar-updated',()=>{if(el('fitness').classList.contains('active'))showHealth();});
}

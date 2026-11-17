'use strict';
function mountMagazine({list,read,save}){
 const el=id=>document.getElementById(id);
 const tag=(name,text)=>{const node=document.createElement(name);node.textContent=text;return node;};
 const link=(title,url)=>{const a=tag('a',title);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const gumbo={title:'Cajun chicken & sausage gumbo',url:'#james-gumbo',publisher:'James kitchen · Serves 4 · Recipe illustration'};
 const safeRecipe=row=>{try{return typeof row.title==='string'&&row.title.trim()&&row.title.length<=200&&typeof row.publisher==='string'&&row.publisher.length<=100&&new URL(row.url).protocol==='https:';}catch{return false;}};
 let pages=[gumbo],current=0,bookRequest=0;
 const suffix='.james-recipe.json';
 function drawBook(){
  const recipe=pages[current],isGumbo=recipe.url===gumbo.url,paper=el('bookPage');
  paper.replaceChildren(tag('h3',recipe.title),tag('small',recipe.publisher));
  if(isGumbo){
   const ingredients=tag('ul','');
   for(const line of ['⅓ cup neutral oil + ⅓ cup all-purpose flour','1 onion, 1 green pepper and 2 celery stalks, diced','3 cloves garlic, minced','8 oz smoked andouille, sliced','1 lb boneless chicken thighs, cut into chunks','4 cups low-sodium chicken stock','1 bay leaf, 1 tsp paprika and ½ tsp dried thyme','Salt and pepper to taste · 3 cups hot cooked rice'])ingredients.append(tag('li',line));
   const steps=tag('ol','');
   for(const line of ['In a heavy pot, whisk oil and flour over medium-low heat until deep brown, stirring constantly, about 20–30 minutes.','Stir in the diced vegetables for 5 minutes, then garlic for 1 minute. Slowly whisk in stock.','Add sausage, chicken, bay leaf, paprika and thyme. Simmer gently for about 30 minutes, until chicken reaches 165°F.','Remove bay leaf, season to taste and serve over rice.'])steps.append(tag('li',line));
   const columns=tag('div','');columns.className='recipe-columns';
   const left=tag('section',''),right=tag('section','');
   left.append(tag('h4','Ingredients'),ingredients);right.append(tag('h4','Method'),steps);
   columns.append(left,right);paper.append(columns);
  }else{
   paper.append(tag('p','Ingredients and directions from '+recipe.publisher+'.'),link('Open full recipe',recipe.url));
  }
  const photo=el('bookPhoto');
  let publisherPhoto=false;try{const u=new URL(recipe.photo);publisherPhoto=u.protocol==='https:'&&u.hostname==='www.budgetbytes.com';}catch{}
  photo.hidden=!isGumbo&&!publisherPhoto;photo.src=publisherPhoto?recipe.photo:'assets/lifestyle/recipe.jpg';photo.alt=isGumbo?'Illustration of chicken and sausage gumbo':recipe.title;
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
 for(const tab of document.querySelectorAll('[data-finance-view]')){
  tab.onclick=()=>{
   const investments=tab.dataset.financeView==='investments';
   el('financeOverview').hidden=investments;
   el('financeInvestments').hidden=!investments;
   el('financeToday').hidden=investments;
   document.querySelectorAll('[data-finance-view]').forEach(item=>item.setAttribute('aria-pressed',String(item===tab)));
  };
 }
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
   if(host.dataset.feed!==key)return;
   if(key==='business'){
    const cards=data.items.filter(item=>item.photo).slice(0,2).map(item=>{
     const card=link('',item.url);card.className='headline-card';
     const image=document.createElement('img');image.alt='';image.src=item.photo;image.referrerPolicy='no-referrer';
     const caption=tag('span','');caption.append(tag('small',data.publisher),tag('strong',item.title));
     card.append(image,caption);return card;
    });
    if(!cards.length)throw Error('No illustrated stories');
    host.replaceChildren(...cards);return;
   }
   if(key.endsWith('-books')){
    const practice={'sales-books':'Choose one question from your reading and try it in your next customer conversation.','life-books':'Pick one habit to try for five minutes today. Note what made it easier.','business-books':'Choose one idea and test it on a small decision at work.'}[key];
    const cards=data.items.map(book=>{
     const card=tag('article','');card.className='book-pick';
     const cover=link('',book.url),image=document.createElement('img');image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';image.src=book.photo||'assets/lifestyle/books.jpg';
     const caption=tag('span','');caption.append(tag('strong',book.title),tag('small',[book.author,book.year].filter(Boolean).join(' · ')));
     cover.append(image,caption);card.append(cover);
     const action=tag('details','');action.append(tag('summary','Put it into practice'),tag('p',practice));
     card.append(action);return card;
    });
    host.replaceChildren(...cards);return;
   }
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
  }catch{if(host.dataset.feed!==key)return;if(feeds.get(key)===entry)feeds.delete(key);const retry=tag('button','Retry feed');retry.onclick=()=>refreshFeed(host);const picks={
    'sales-books':['To Sell Is Human','Daniel Pink','https://www.danpink.com/books/to-sell-is-human/','Ask a customer what would make their decision easier. Summarize their answer before you pitch.'],
    'business-books':['The Mom Test','Rob Fitzpatrick','https://www.momtestbook.com/','Ask about the last time a customer faced the problem you want to solve.'],
    'life-books':['The 7 Habits of Highly Effective People','Stephen R. Covey','https://www.franklincovey.com/the-7-habits/','Choose a time today to renew one skill and set aside ten minutes to practice.']
   };
   if(picks[key]){
    const [title,author,url,practice]=picks[key],card=tag('article','');card.className='book-pick';
    const cover=link('',url),image=document.createElement('img');image.alt='';image.src='assets/lifestyle/books.jpg';
    const caption=tag('span','');caption.append(tag('strong',title),tag('small','James pick · '+author));cover.append(image,caption);
    const action=tag('details','');action.append(tag('summary','Put it into practice'),tag('p',practice));
    card.append(cover,action);host.replaceChildren(card,retry);
   }else host.replaceChildren(tag('p','The publisher feed is unavailable.'),retry);}
 }
 for(const b of document.querySelectorAll('[data-career]'))b.onclick=()=>{
  page('files');const search=el('searchJamesFiles');search.value=b.dataset.career;search.dispatchEvent(new Event('input'));search.focus();
 };
 for(const button of document.querySelectorAll('[data-scroll]')){
  button.onclick=()=>el(button.dataset.scroll)?.scrollIntoView({block:'start'});
 }
 for(const button of document.querySelectorAll('[data-topic]')){
  button.onclick=()=>{
   document.querySelectorAll('[data-topic]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
   const host=el('growthReading');
   host.dataset.feed=button.dataset.topic;refreshFeed(host);
  };
 }
 const savePractice=el('savePractice');
 savePractice.onclick=async()=>{
  savePractice.disabled=true;
  try{
   const body='Listen before responding\nhttps://ggia.berkeley.edu/practice/active_listening';
   await save(new File([body],'Listen before responding.txt',{type:'text/plain',lastModified:0}));
   savePractice.textContent='Saved to Files';
  }catch{savePractice.disabled=false;savePractice.textContent='Retry save';}
 };
 const schedule=el('serviceSchedule');
 for(const button of document.querySelectorAll('[data-service]')){
  button.onclick=()=>{
   schedule.reset();schedule.hidden=false;
   el('serviceVehicle').textContent=button.dataset.service;
   schedule.elements.service.focus();
  };
 }
 el('serviceCancel').onclick=()=>{schedule.hidden=true;};
 async function showServices(){
  const host=el('serviceDates');
  try{
   const {files}=await list();
   const entries=await Promise.all(files.filter(f=>f.name.endsWith('.james-service.json')).map(async f=>JSON.parse(await (await read(f.id)).text())));
   entries.sort((a,b)=>String(a.due).localeCompare(String(b.due)));
   host.replaceChildren(...entries.map(row=>tag('p',row.due+' · '+row.vehicle+' · '+row.service)));
  }catch{host.textContent='Service dates could not be loaded.';}
 }
 schedule.onsubmit=async event=>{
  event.preventDefault();
  const button=schedule.querySelector('button');
  const row={vehicle:el('serviceVehicle').textContent,service:schedule.elements.service.value.trim(),due:schedule.elements.due.value};
  if(!row.service||!row.due)return;
  button.disabled=true;
  try{
   await save(new File([JSON.stringify(row)],'maintenance.james-service.json',{type:'application/json',lastModified:0}));
   schedule.hidden=true;await showServices();
  }catch{el('serviceDates').textContent='Could not save. Try again.';}
  finally{button.disabled=false;}
 };
 const workouts=[
  {title:'Bodyweight cardio circuit',gear:'5 min 30 sec · Wall or bench',work:30,rest:0,photo:'health',moves:['Air squat','Wall push-up','Forward lunge','Plank hold','Jumping jack']},
  {title:'Core and strength circuit',gear:'9 min 45 sec · Bench and floor space',work:45,rest:15,photo:'mobility',moves:['Air squat','Incline push-up','Glute bridge','Plank hold','Bird dog']}
 ];
 function dayKey(){return new Date().toLocaleDateString('en-CA');}
 function dailyIndex(){
  const choice=sessionStorage.getItem('jamesCircuit:'+dayKey());
  const index=workouts.findIndex(item=>item.title===choice);
  const now=new Date();
  return index>=0?index:Math.floor(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/86400000)%workouts.length;
 }
 let selected=dailyIndex(),intervals=[],step=0,ticker=null,deadline=0,remaining=0;
 function stopTimer(){clearInterval(ticker);ticker=null;}
 function showWorkout(){
  const index=dailyIndex(),item=workouts[index];
  el('dailyWorkout').textContent=item.title;
  el('dailyWorkout').closest('.photo-panel').style.setProperty('--photo','url(assets/lifestyle/'+item.photo+'.jpg)');
  el('fitness').querySelector('[data-action-page="workout-detail"]').onclick=()=>{selected=index;page('workout-detail');};
 }
 function paintInterval(){
  if(step>=intervals.length){
   stopTimer();el('workoutStage').textContent='Workout complete';el('workoutClock').textContent='';
   el('workoutNext').hidden=true;el('workoutStart').textContent='Start again';return;
  }
  const interval=intervals[step];
  el('workoutStage').textContent='Round '+interval.round+' of 2 · '+interval.name;
  el('workoutClock').textContent=Math.ceil(remaining/1000)+' sec';
  el('workoutNext').textContent=step===intervals.length-1?'Finish workout':'Next interval';
 }
 function tick(){
  const now=Date.now();
  while(step<intervals.length && now>=deadline){
   step++;
   if(step<intervals.length)deadline+=intervals[step].seconds*1000;
  }
  remaining=Math.max(0,deadline-now);paintInterval();
 }
 function showWorkoutDetail(){
  stopTimer();
  const item=workouts[selected];
  el('workoutTitle').textContent=item.title;
  el('workoutCover').style.setProperty('--photo','url(assets/lifestyle/'+item.photo+'.jpg)');
  el('workoutEquipment').textContent=item.gear+' · 2 rounds. Warm up for 2–3 minutes before starting.';
  el('workoutMoves').replaceChildren(...item.moves.map(move=>tag('li',move+' · '+item.work+' sec')));
  intervals=[];
  for(let round=1;round<=2;round++){
   item.moves.forEach((name,index)=>{
    intervals.push({name,seconds:item.work,round});
    const last=index===item.moves.length-1;
    const rest=last && round===2?0:item.rest || (last?30:0);
    if(rest)intervals.push({name:'Rest',seconds:rest,round});
   });
  }
  step=0;remaining=intervals[0].seconds*1000;
  el('workoutStart').textContent='Start workout';el('workoutNext').hidden=true;el('workoutStage').textContent='';el('workoutClock').textContent='';
 }
 el('workoutStart').onclick=()=>{
  if(ticker!==null){tick();stopTimer();if(step<intervals.length)el('workoutStart').textContent='Resume';return;}
  if(step>=intervals.length){step=0;remaining=intervals[0].seconds*1000;}
  deadline=Date.now()+remaining;ticker=setInterval(tick,250);
  el('workoutStart').textContent='Pause';el('workoutNext').hidden=false;paintInterval();
 };
 el('workoutNext').onclick=()=>{
  step++;if(step<intervals.length){remaining=intervals[step].seconds*1000;deadline=Date.now()+remaining;}
  paintInterval();
 };
 workouts.forEach((item,index)=>{
  const button=tag('button','');button.className='workout-choice';
  button.style.setProperty('--photo','url(assets/lifestyle/'+item.photo+'.jpg)');
  button.append(tag('strong',item.title),tag('small',item.gear));
  button.onclick=()=>{selected=index;page('workout-detail');};
  el('workoutChoices').append(button);
 });
 el('chooseWorkout').onclick=()=>{
  sessionStorage.setItem('jamesCircuit:'+dayKey(),workouts[selected].title);page('fitness');
 };
 function showHealth(){
  const items=(window.liveEvents||[]).filter(e=>Date.parse(e.end)>=Date.now()&&/\b(dentist|doctor|physical exam|annual physical|checkup|medical|clinic|cardiolog\w*|dermatolog\w*)\b/i.test(e.title||'')).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(0,4);
  el('healthMeetings').replaceChildren(...(items.length?items.map(e=>tag('p',e.title+' · '+new Date(e.start).toLocaleDateString())):[tag('p','No upcoming health visits identified in the loaded calendar.')]));
 }
 function openMagazine(){
  const screen=document.querySelector('.page.active');if(!screen)return;
  screen.querySelectorAll('[data-feed]').forEach(refreshFeed);
  if(screen.id==='workout-detail')showWorkoutDetail();else stopTimer();
  if(screen.id==='garage')void showServices();
  if(screen.id==='recipes')void loadBook();
  if(screen.id==='fitness'){showWorkout();showHealth();}
 }
 drawBook();showWorkout();openMagazine();
 window.addEventListener('james:page-changed',openMagazine);
 window.addEventListener('james:calendar-updated',()=>{if(el('fitness').classList.contains('active'))showHealth();});
}

'use strict';
function mountMagazine({list,read,save}){
 const el=id=>document.getElementById(id);
 const tag=(name,text)=>{const node=document.createElement(name);node.textContent=text;return node;};
 const link=(title,url)=>{const a=tag('a',title);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const gumbo={title:'Cajun chicken & sausage gumbo · James original',url:'#james-gumbo',publisher:'James kitchen · Serves 4 · Recipe illustration',
  ingredients:['⅓ cup neutral oil + ⅓ cup all-purpose flour','1 onion, 1 green pepper and 2 celery stalks, diced','3 cloves garlic, minced','8 oz smoked andouille, sliced','1 lb boneless chicken thighs, cut into chunks','4 cups low-sodium chicken stock','1 bay leaf, 1 tsp paprika and ½ tsp dried thyme','Salt and pepper to taste · 3 cups hot cooked rice'],
  steps:['In a heavy pot, whisk oil and flour over medium-low heat until deep brown, stirring constantly, about 20–30 minutes.','Stir in the diced vegetables for 5 minutes, then garlic for 1 minute. Slowly whisk in stock.','Add sausage, chicken, bay leaf, paprika and thyme. Simmer gently for about 30 minutes, until chicken reaches 165°F.','Remove bay leaf, season to taste and serve over rice.']};
 const stuffingBites={
  pinUrl:'https://www.pinterest.com/pin/351773420878575874/',
  title:'Bacon-Wrapped Stuffing Bites',publisher:'Who Needs A Cape? · Makes 18',
  url:'https://whoneedsacape.com/2016/10/bacon-wrapped-stuffing-bites/',
  photo:'https://i0.wp.com/whoneedsacape.com/wp-content/uploads/2019/01/DSC_0140-2.jpg?fit=735,490&ssl=1',
  ingredients:['3 cups prepared stuffing','9 strips of bacon'],
  steps:['Heat the oven to 375°F. Line a baking sheet with foil and lightly grease it.',
   'Shape the stuffing into 18 balls. Halve the bacon strips crosswise and wrap one half around each ball. Secure each with a toothpick.',
   'Arrange on the baking sheet. Bake for about 20–25 minutes, until the bacon is cooked through. Drain briefly before serving.']
 };
 const safeRecipe=row=>{try{return typeof row.title==='string'&&row.title.trim()&&row.title.length<=200&&typeof row.publisher==='string'&&row.publisher.length<=100&&new URL(row.url).protocol==='https:';}catch{return false;}};
 let pages=[gumbo],current=0,bookRequest=0;
 const cookingSelection=window.JamesRecipeGuide.createSelection();
 const suffix='.james-recipe.json';
 function drawBook(){
  const recipe=pages[current],isGumbo=recipe.url===gumbo.url,paper=el('bookPage');
  paper.replaceChildren(tag('h3',recipe.title),tag('small',recipe.publisher));
  if(isGumbo||Array.isArray(recipe.ingredients)&&Array.isArray(recipe.steps)){
   const ingredients=tag('ul','');
   for(const line of recipe.ingredients)ingredients.append(tag('li',line));
   const steps=tag('ol','');
   for(const line of recipe.steps)steps.append(tag('li',line));
   const columns=tag('div','');columns.className='recipe-columns';
   const left=tag('section',''),right=tag('section','');
   left.append(tag('h4','Ingredients'),ingredients);right.append(tag('h4','Method'),steps);
   columns.append(left,right);paper.append(columns);if(!isGumbo)paper.append(link('Original recipe',recipe.url));
  }else if(recipe.kind==='saved-pin'){
   paper.append(link('Open saved Pin',recipe.pinUrl));
   if(recipe.url!==recipe.pinUrl)paper.append(link('Open recipe source',recipe.url));
  }else{
   paper.append(tag('p','Ingredients and directions from '+recipe.publisher+'.'),link('Open full recipe',recipe.url));
  }
  const photo=el('bookPhoto');
  let publisherPhoto=false;try{const u=new URL(recipe.photo);publisherPhoto=u.protocol==='https:'&&(Array.isArray(recipe.steps)||recipe.kind==='saved-pin'&&u.hostname==='i.pinimg.com'||u.hostname==='www.budgetbytes.com');}catch{}
  photo.hidden=!isGumbo&&!publisherPhoto;photo.src=publisherPhoto?recipe.photo:'assets/lifestyle/recipe.jpg';photo.alt=isGumbo?'Illustration of chicken and sausage gumbo':recipe.title;
  photo.alt=recipe.photoCredit?recipe.title+' — '+recipe.photoCredit:photo.alt;
  if(recipe.photoCredit)paper.append(tag('small',recipe.photoCredit));
  paper.parentElement.classList.toggle('source-only',photo.hidden);
  el('cookCount').textContent=pages.length+(pages.length===1?' recipe':' recipes');
  el('bookPosition').textContent=(current+1)+' / '+pages.length;el('bookPrev').disabled=current===0;el('bookNext').disabled=current===pages.length-1;
 }
 let repairing=false,repaired=false;
 async function repairLinks(items){
  repairing=true;
  try{
   for(const item of items){
    if(item.kind!=='saved-pin')continue;
    await importRecipe(item.url,false,{title:item.title,url:item.pinUrl,recipeSource:item.url,image:item.photo}).catch(()=>{});
   }
   await loadBook();
  }finally{repairing=false;}
 }
 function recipeKey(url){
  if(url===gumbo.url)return url;
  const canonical=new URL(url,location.href);
  canonical.hash='';
  for(const param of [...canonical.searchParams.keys()])if(/^utm_|^fbclid$|^epik$/.test(param))canonical.searchParams.delete(param);
  canonical.pathname=canonical.pathname.replace(/\/$/,'');
  return canonical.href;
 }
 function savedIdea(item){
  const keys=[item.url,item.pin].filter(Boolean).map(recipeKey);
  return pages.some(recipe=>[recipe.url,recipe.pinUrl].some(url=>url&&keys.includes(recipeKey(url))));
 }
 async function loadBook(){
  const generation=++bookRequest;
  try{
   const [{files},imports]=await Promise.all([list(),fetch('/api/lifestyle/cookbook',{cache:'no-store'}).then(r=>r.ok?r.json():{}).catch(()=>({}))]);
   const rows=await Promise.all(files.filter(f=>f.name.endsWith(suffix)).map(async f=>JSON.parse(await (await read(f.id)).text())));
   if(generation!==bookRequest)return;
   const selected=pages[current]?.url;
   const readable=new Map(),pins=new Map();
   for(const item of [gumbo,...rows.filter(safeRecipe),...(imports.items||[]).filter(safeRecipe),stuffingBites]){
    const key=recipeKey(item.url);
    if(item===gumbo||item.ingredients?.length&&item.steps?.length){if(item!==stuffingBites||!readable.has(key))readable.set(key,item);}
    else pins.set(key,item);
   }
   // Retire the starter page once the saved publisher recipe is readable.
   if(readable.has('https://mycoffeehasbutter.com/cajun-chicken-and-sausage-gumbo'))readable.delete(gumbo.url);
   pages=[...readable.values()];cookingSelection.reconcile(pages);
   if(ideasReady)renderIdeas();
   let savedPins=el('cookSavedPins');
   if(!savedPins){savedPins=tag('details','');savedPins.id='cookSavedPins';el('cookbookCover').after(savedPins);}
   const imported=new Set(pages.flatMap(row=>[row.url,row.pinUrl,row.sourceUrl].filter(Boolean).map(recipeKey)));
   const pending=[...pins.values()].filter(row=>![row.url,row.pinUrl].some(url=>url&&imported.has(recipeKey(url))));
   savedPins.hidden=!pending.length;
   savedPins.replaceChildren(tag('summary','Links awaiting a full recipe ('+pending.length+')'));
   for(const item of pending)savedPins.append(link(item.title,item.url));
   if(!repairing && !repaired && pending.some(item=>item.kind==='saved-pin')){
    repaired=true;void repairLinks(pending);
   }
   current=Math.max(0,pages.findIndex(row=>row.url===selected));drawBook();el('bookNotice').textContent='';
  }catch{if(generation===bookRequest){cookingSelection.choose(null);el('bookNotice').textContent='Saved recipes could not be refreshed.';}}
 }
 const boardOrigin='https://aaru-working-review.aglow-ox-8353.chatgpt.site';
 const boardUrl=boardOrigin+'/wardrobe/recipe-board';
 const boardButton=el('recipeBoardSync'),boardStatus=el('recipeBoardStatus');
 let boardFrame=null,boardPopup=null,boardTimeout=null,importing=false,lastScan=0;
 function resetReader(){
  clearTimeout(boardTimeout);boardFrame?.remove();boardFrame=null;boardPopup=null;
 }
 function boardScan(manual){
  if(importing)return;
  resetReader();
  if(manual){
   boardPopup=window.open(boardUrl,'jamesRecipeBoard','popup,width=560,height=650');
   if(!boardPopup){boardStatus.textContent='Allow this window to open your connected board.';return;}
  }else{
   boardFrame=document.createElement('iframe');boardFrame.hidden=true;boardFrame.title='Read Saved Pinterest Meals';
   boardFrame.src=boardUrl;document.body.append(boardFrame);
  }
  boardStatus.textContent='Checking Saved Pinterest Meals…';
  boardTimeout=setTimeout(()=>{boardStatus.textContent='Open Saved Pinterest Meals to finish checking your board.';boardButton.textContent='Open Saved Pinterest Meals';},20000);
 }
 async function importRecipe(url,discovery=false,pin=null){
  const r=await fetch('/api/lifestyle/cookbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,discovery,pin})});
  if(!r.ok)throw Error('import');
  return (await r.json()).status;
 }
 window.addEventListener('message',async event=>{
  if(importing||event.origin!==boardOrigin||!event.source||
     (event.source!==boardPopup&&event.source!==boardFrame?.contentWindow)||event.data?.type!=='james-recipe-board')return;
  resetReader();
  if(event.data.error){boardStatus.textContent=event.data.error;return;}
  if(!Array.isArray(event.data.links))return;
  localStorage.setItem('jamesRecipeBoardEnabled','1');boardButton.textContent='Check Saved Pinterest Meals';
  importing=true;boardButton.disabled=true;
  const pins=Array.isArray(event.data.pins)?event.data.pins:null;
  let added=0,linked=0,skipped=pins?0:Number(event.data.missing)||0,failed=0;
  try{
   for(const pin of pins||[...new Set(event.data.links)].map(recipeSource=>({recipeSource}))){
    try{const result=await importRecipe(pin.recipeSource,false,pin);if(result==='added')added++;else if(result==='linked')linked++;else if(result!=='existing')skipped++;}
    catch{failed++;}
   }
   await loadBook();lastScan=Date.now();
   await showPinterestIdeas(event.data.discovery);void discoverMatches();
   boardStatus.textContent=[added?added+(added===1?' full recipe added':' full recipes added'):'',linked?linked+' saved as recipe links':'',!added&&!linked&&!skipped&&!failed?'Book up to date':'',skipped?skipped+' without a supported recipe':'',failed?failed+' could not be checked. Try again.':''].filter(Boolean).join(' · ');
  }finally{importing=false;boardButton.disabled=false;}
 });
 boardButton.onclick=()=>boardScan(true);
 if(localStorage.getItem('jamesRecipeBoardEnabled')==='1')boardButton.textContent='Check Saved Pinterest Meals';
 let ideasReady=false,pinterestIdeas=[];
 const discoverMatches=()=>Promise.resolve();
 const reader=el('cookReader'),spread=reader.querySelector('.mag-book');
 function openCookbook(){
  reader.classList.add('fit');el('cookFit').textContent='Normal size';el('cookFit').setAttribute('aria-pressed','true');
  if(!reader.open)reader.showModal();
  reader.scrollTop=0;
 }
 el('cookbookCover').onclick=openCookbook;
 window.jamesRecipes=window.JamesRecipeGuide.create(()=>cookingSelection.read());
 el('cookWithJames').onclick=()=>{
  if(!cookingSelection.choose(pages[current]))return;
  reader.close();void window.jamesVoice?.start({prompt:'Walk me through the selected saved cookbook recipe. Use read_recipe start and read just the first step, then wait for me.'});
 };
 el('cookClose').onclick=()=>reader.close();
 el('cookFit').onclick=()=>{
  const fit=reader.classList.toggle('fit');el('cookFit').textContent=fit?'Normal size':'Fit to screen';
  el('cookFit').setAttribute('aria-pressed',String(fit));
 };
 function turnRecipe(direction){
  const next=current+direction;if(next<0||next>=pages.length)return;
  current=next;cookingSelection.choose(pages[current]);drawBook();
  spread.classList.remove('turn-forward','turn-back');void spread.offsetWidth;
  spread.classList.add(direction>0?'turn-forward':'turn-back');reader.scrollTop=0;
 }
 el('bookPrev').onclick=()=>turnRecipe(-1);el('bookNext').onclick=()=>turnRecipe(1);
 document.addEventListener('keydown',event=>{
  if(!reader.open)return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
   event.preventDefault();turnRecipe(event.key==='ArrowRight'?1:-1);
  }
 });
 let touch=null;
 spread.addEventListener('touchstart',event=>{touch=event.touches.length===1?event.touches[0]:null;},{passive:true});
 spread.addEventListener('touchcancel',()=>{touch=null;});
 spread.addEventListener('touchend',event=>{
  if(!touch||!event.changedTouches.length)return;
  const dx=event.changedTouches[0].clientX-touch.clientX,dy=event.changedTouches[0].clientY-touch.clientY;touch=null;
  if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.8)turnRecipe(dx<0?1:-1);
 },{passive:true});
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
 let discoveryLoading=false,discoveryChecked=0;
 async function showPinterestIdeas(){return loadDiscover();}
 async function loadDiscover(){
  if(discoveryLoading||Date.now()-discoveryChecked<60000)return;
  discoveryLoading=true;
  const host=el('pinterestPicks');
  try{
   const response=await fetch('/api/lifestyle/cookbook?view=discover',{cache:'no-store'});
   if(!response.ok)throw Error();
   const data=await response.json();
   if(!Array.isArray(data.items))throw Error();
   pinterestIdeas=data.items;ideasReady=true;
   if(data.status==='loading'||data.status==='unavailable')throw Error();
   discoveryChecked=Date.now();renderIdeas();
  }catch{
   const retry=tag('button','Retry discoveries');retry.onclick=()=>{discoveryChecked=0;void loadDiscover();};
   host.replaceChildren(tag('p','New recipes could not be loaded.'),retry);
  }finally{discoveryLoading=false;}
 }
 async function passIdea(item){
  const r=await fetch('/api/lifestyle/cookbook',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:item.url})});
  if(!r.ok)throw Error();
  pinterestIdeas=pinterestIdeas.filter(i=>i.url!==item.url);renderIdeas();
 }
 async function saveIdea(item){
  const status=await importRecipe(item.url,true);
  if(status!=='existing'&&status!=='added')throw Error();
  pinterestIdeas=pinterestIdeas.filter(i=>i.url!==item.url);renderIdeas();await loadBook();
  const next=Math.max(0,pages.findIndex(p=>recipeKey(p.url)===recipeKey(item.url)));
  if(next!==current)cookingSelection.choose(null);
  current=next;drawBook();
 }
 function previewIdea(item){
  const dialog=tag('dialog','');dialog.className='recipe-preview';dialog.setAttribute('aria-label',item.title);
  const close=tag('button','Close preview'),keep=tag('button','Save to book'),pass=tag('button','Pass');
  const paper=tag('div','');paper.className='recipe-preview-paper';
  const ingredients=tag('ul',''),steps=tag('ol','');
  (item.ingredients||[]).forEach(line=>ingredients.append(tag('li',line)));
  (item.steps||[]).forEach(line=>steps.append(tag('li',line)));
  paper.append(tag('h3',item.title),tag('small',item.publisher),tag('h4','Ingredients'),ingredients,tag('h4','Method'),steps,link('Original recipe',item.url));
  const photo=tag('img','');photo.src=item.photo;photo.alt=item.title;
  const actions=tag('div','');actions.className='mag-bar';actions.append(keep,pass,close);
  dialog.append(actions,paper,photo);document.body.append(dialog);
  close.onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  keep.onclick=async()=>{keep.disabled=true;try{await saveIdea(item);dialog.close();}catch{keep.disabled=false;keep.textContent='Retry save';}};
  pass.onclick=async()=>{pass.disabled=true;try{await passIdea(item);dialog.close();}catch{pass.disabled=false;pass.textContent='Retry pass';}};
  dialog.showModal();
 }
 function renderIdeas(){
  const host=el('pinterestPicks');
  pinterestIdeas=pinterestIdeas.filter(item=>!savedIdea(item));
  const cards=pinterestIdeas.map(item=>{
   const row=tag('div','');row.className='mag-story';
   const image=tag('img','');image.src=item.photo;image.alt='';image.referrerPolicy='no-referrer';
   const preview=tag('button',item.title),keep=tag('button','Save to book'),remove=tag('button','Pass');
   preview.className='recipe-preview-title';preview.onclick=()=>previewIdea(item);
   remove.setAttribute('aria-label','Pass '+item.title);
   row.append(image,tag('small',item.publisher),preview,keep,remove);
   keep.onclick=async()=>{keep.disabled=true;try{await saveIdea(item);}catch{keep.disabled=false;keep.textContent='Retry save';}};
   remove.onclick=async()=>{remove.disabled=true;try{await passIdea(item);}catch{remove.disabled=false;remove.textContent='Retry pass';}};
   return row;
  });
  if(cards.length)host.replaceChildren(...cards);else host.textContent='You’re up to date with this week’s recipes.';
 }
 const feeds=new Map();
 async function deletedRecipes(){
  const response=await fetch('/api/lifestyle/cookbook?view=deleted',{cache:'no-store'});
  if(!response.ok)throw Error('Recipe preferences unavailable');
  return new Set((await response.json()).urls||[]);
 }
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

   host.replaceChildren(tag('small',data.publisher),...data.items.map(item=>link(item.title,item.url)));
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
  if(screen.id==='recipes'){
   void loadBook().then(loadDiscover);
   if(localStorage.getItem('jamesRecipeBoardEnabled')==='1' && !boardFrame && !boardPopup && Date.now()-lastScan>900000)boardScan(false);
  }
  if(screen.id==='fitness'){showWorkout();showHealth();}
 }
 drawBook();showWorkout();openMagazine();
 window.addEventListener('james:page-changed',openMagazine);
 window.addEventListener('james:calendar-updated',()=>{if(el('fitness').classList.contains('active'))showHealth();});
}

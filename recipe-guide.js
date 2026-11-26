(function(root){
 'use strict';
 function snapshot(recipe){
  if(!recipe||typeof recipe.title!=='string'||!recipe.title.trim()||
    typeof recipe.url!=='string'||!recipe.url.trim()||typeof recipe.publisher!=='string'||
    ![recipe.ingredients,recipe.steps].every(lines=>Array.isArray(lines)&&lines.length>0&&
      Array.from(lines).every(line=>typeof line==='string'&&line.trim())))return null;
  return {title:recipe.title,url:recipe.url,publisher:recipe.publisher,
    ingredients:[...recipe.ingredients],steps:[...recipe.steps]};
 }
 const identity=recipe=>JSON.stringify(recipe);
 // Display order and visual fallbacks are independent from explicit cooking choice.
 function createSelection(){
  let selected=null,revision=0;
  function set(recipe){
   if(identity(selected)!==identity(recipe)){selected=recipe;revision++;}
   return !!selected;
  }
  return {
   choose(recipe){return set(snapshot(recipe));},
   reconcile(recipes){
    if(!selected)return;
    if(!recipes.some(recipe=>identity(snapshot(recipe))===identity(selected)))set(null);
   },
   read(){return selected?{recipe:snapshot(selected),revision}:null;}
  };
 }
 function create(getRecipe){
  let key=null,step=-1;
  return {read(action){
   const selection=getRecipe();
   const recipe=snapshot(selection?.recipe??selection);
   if(!recipe){key=null;step=-1;return {status:'unavailable',message:'Choose a complete recipe in the cookbook, then tap Cook with James or ask James to start.'};}
   const revision=JSON.stringify([selection?.revision??null,recipe]);
   if(revision!==key){key=revision;step=-1;}
   const base={title:recipe.title,source:recipe.url,publisher:recipe.publisher,totalSteps:recipe.steps.length};
   if(action==='ingredients')return {...base,status:'ready',ingredients:[...recipe.ingredients]};
   if(action==='current')return {...base,status:step<0?'not_started':'ready',step:step+1,instruction:step<0?null:recipe.steps[step]};
   if(action==='start')step=0;
   else if(action==='next'){
    if(step===recipe.steps.length-1)return {...base,status:'complete',step:step+1};
    step++;
   }else if(action==='previous')step=Math.max(0,step-1);
   else if(action!=='repeat')return {status:'invalid_action'};
   if(step<0)return {...base,status:'not_started'};
   return {...base,status:'ready',step:step+1,instruction:recipe.steps[step],waitForNext:true};
  }};
 }
 root.JamesRecipeGuide={create,createSelection};
 if(typeof module!=='undefined')module.exports={create,createSelection};
})(typeof window==='undefined'?globalThis:window);
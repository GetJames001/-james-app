(function(root){
 'use strict';
 function create(getRecipe){
  let key=null,step=-1;
  return {read(action){
   const recipe=getRecipe();
   if(!recipe?.ingredients?.length||!recipe?.steps?.length)return {status:'unavailable',message:'Open a complete saved recipe in the cookbook first.'};
   const revision=JSON.stringify([recipe.url,recipe.ingredients,recipe.steps]);
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
 root.JamesRecipeGuide={create};
 if(typeof module!=='undefined')module.exports={create};
})(typeof window==='undefined'?globalThis:window);

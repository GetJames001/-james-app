const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceUrl,article}=require('../lib/routes/recipe-book');
test('cookbook uses an exact publisher and groups information from the same recipe',()=>{
 assert.equal(sourceUrl('https://eatwell101.com.example.com/food'),null);
 assert.equal(sourceUrl('https://www.eatwell101.com/recipe?ref=pin').href,'https://www.eatwell101.com/recipe');
 const data={'@graph':[{'@type':'Recipe',name:'Sprouts',recipeIngredient:['1 lb sprouts'],recipeInstructions:[{'@type':'HowToSection',itemListElement:[{text:'Roast until golden.'}]}],image:{url:'https://www.eatwell101.com/sprouts.jpg'}}]};
 const recipe=article('<script type="application/ld+json">'+JSON.stringify(data)+'</script>',sourceUrl('https://www.eatwell101.com/recipe'));
 assert.deepEqual(recipe.steps,['Roast until golden.']);assert.equal(recipe.title,'Sprouts');assert.equal(recipe.ingredients.length,1);
});

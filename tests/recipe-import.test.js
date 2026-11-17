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

test('follows one explicit recipe destination and refuses ambiguous recipes',()=>{
 const {recipeDestination}=require('../lib/routes/recipe-book');
 const base=new URL('https://example.com/saved-yams');
 const button='<a href="/recipes/yams"><span>See recipe</span></a>';
 assert.equal(recipeDestination(button,base).href,'https://example.com/recipes/yams');
 assert.equal(recipeDestination(button+'<a href="/other">Get recipe</a>',base),null);
 const dish={ '@type':'Recipe',name:'Pinned gumbo',recipeIngredient:['6 cups chicken broth'],recipeInstructions:['Serve over rice.'] };
 const block=data=>'<script type="application/ld+json">'+JSON.stringify(data)+'</script>';
 assert.deepEqual(article(block(dish),base).ingredients,['6 cups chicken broth']);
 assert.equal(article(block([dish,{...dish,name:'Another gumbo'}]),base),null);
 assert.equal(article(block({'@type':'ItemList',itemListElement:[dish]}),base),null);
});

test('WP Recipe Maker print view follows its own publisher back to the illustrated recipe',()=>{
 const {recipeDestination}=require('../lib/routes/recipe-book');
 const print=new URL('https://mycoffeehasbutter.com/wprm_print/cajun-chicken-and-sausage-gumbo');
 const back='<a href="/cajun-chicken-and-sausage-gumbo/" id="wprm-print-button-back">Go Back</a>';
 assert.equal(recipeDestination(back,print).href,'https://mycoffeehasbutter.com/cajun-chicken-and-sausage-gumbo/');
 assert.equal(recipeDestination(back.replace('href="/','href="https://another.example/'),print),null);
});

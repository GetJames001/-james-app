'use strict';
// Synthetic DOM fixtures in real Chromium. All requests intercepted; no retailer/provider calls.
const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createTargetReader}=require('../j30/target-reader.cjs');
const url='https://www.target.com/p/fixture-lamp/-/A-89419019';
function html({price='$40.00',style='',canonical=url}={}){
 return '<link rel="canonical" href="'+canonical+'"><meta property="og:title" content="Fixture Lamp"><h1>Fixture Lamp</h1><div style="'+style+'" data-test="module-product-detail-price-v2"><div data-test="price-cdui-row">'+price+'</div></div><aside><h2>Other products</h2><p>$10.00</p></aside>';
}
async function fixture(run){const browser=await chromium.launch();try{const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false}),page=await context.newPage();let body=html();await context.route('**/*',route=>{assert.equal(route.request().url(),url);assert.equal(route.request().method(),'GET');return route.fulfill({contentType:'text/html',body})});await run(createTargetReader(page,{now:()=> '2026-10-29T00:00:00.000Z'}),value=>{body=value})}finally{await browser.close()}}
test('Target reader extracts real rendered selected price rather than recommendation price',async()=>fixture(async reader=>{const r=await reader.read(url);assert.equal(r.name,'Fixture Lamp');assert.equal(r.price,40);assert.equal(r.url,url);assert.equal(r.retailer,'Target');assert.equal(r.observedAt,'2026-10-29T00:00:00.000Z')}));
test('Target reader rejects rendered variant range and old-price mixtures',async()=>fixture(async(reader,set)=>{for(const price of ['$40.00 - $50.00','$40.00 reg $50.00']){set(html({price}));await assert.rejects(reader.read(url),/PRODUCT_NOT_VERIFIED/)}}));
test('Target reader rejects canonical product mismatch in real DOM',async()=>fixture(async(reader,set)=>{set(html({canonical:url.replace('89419019','17303197')}));await assert.rejects(reader.read(url),/PRODUCT_NOT_VERIFIED/)}));
test('Target reader ignores price hidden by ancestor opacity even when recommendation has matching price',async()=>fixture(async(reader,set)=>{set(html({style:'opacity:0'}));await assert.rejects(reader.read(url))}));

test('Target sale price excludes struck regular amount and nonprice explanation rows',async()=>fixture(async(reader,set)=>{set(html({price:'<span>$21.25</span><span> reg </span><span style="text-decoration:line-through">$25.00</span>'}).replace('</div></div><aside>','</div><div data-test="price-cdui-row">Clearance · 15% off</div><div data-test="price-cdui-row">When purchased online</div></div><aside>'));const result=await reader.read(url);assert.equal(result.price,21.25)}));

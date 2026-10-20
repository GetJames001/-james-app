const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'privacy-site/index.html'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const gateway = fs.readFileSync(path.join(root, 'api/gateway.js'), 'utf8');

test('review page is static and contains the verified privacy contact', () => {
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /privacy@getjames\.ai/);
  assert.match(html, /read-only Google Calendar access/);
  assert.match(html, /review draft/i);
  assert.doesNotMatch(html, /<script\b|<iframe\b|<form\b/i);
  assert.doesNotMatch(html, /access_token|client_secret|refresh_token|KV_REST_API_TOKEN/i);
});
test('review page is not accidentally published through existing James gateway', () => {
  assert.deepEqual(vercel.routes, [{src:'^/(.*)$', dest:'/api/gateway?path=$1'}]);
  assert.doesNotMatch(gateway, /privacy-site|route === ["']privacy["']/);
});
test('review page does not claim complete privacy compliance', () => {
  assert.match(html, /retention periods and deletion procedures are being verified/i);
  assert.match(html, /not effective or published/i);
});

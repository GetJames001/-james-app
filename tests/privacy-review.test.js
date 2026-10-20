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
  assert.match(html, /Last updated: October 20, 2026/);
  assert.doesNotMatch(html, /<script\b|<iframe\b|<form\b/i);
  assert.doesNotMatch(html, /access_token|client_secret|refresh_token|KV_REST_API_TOKEN/i);
});
test('review page is not accidentally published through existing James gateway', () => {
  assert.deepEqual(vercel.routes, [{src:'^/(.*)$', dest:'/api/gateway?path=$1'}]);
  assert.doesNotMatch(gateway, /privacy-site|route === ["']privacy["']/);
});
test('policy discloses retention uncertainty and a working privacy contact', () => {
  assert.match(html, /not currently a verified universal automatic deletion period/i);
  assert.match(html, /privacy@getjames\.ai/);
  assert.match(html, /OpenAI API/);
  assert.match(html, /Google API Services User Data Policy/);
});

test('isolated static hosting declares restrictive response headers', () => {
  const headers = fs.readFileSync(path.join(root, 'privacy-site/_headers'), 'utf8');
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /default-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.doesNotMatch(headers, /Access-Control-Allow-Origin: \*/);
});
test('Cloudflare Pages configuration points only to the privacy-site directory', () => {
  const config = fs.readFileSync(path.join(root, 'privacy-site/wrangler.toml'), 'utf8');
  assert.match(config, /pages_build_output_dir = "\."/);
  assert.match(config, /name = "james-privacy-review"/);
  assert.doesNotMatch(config, /getjames\.ai|api\/gateway|JAMES_SESSION_SECRET/);
});

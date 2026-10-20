const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const connect=fs.readFileSync(path.join(root,'api/google/connect.js'),'utf8');
const callback=fs.readFileSync(path.join(root,'api/google/callback.js'),'utf8');

test('Calendar reconnect is a hidden same-origin navigation in authenticated dashboard',()=>{
 assert.match(html,/<a id="googleCalendarConnectLink" href="\/api\/google\/connect" hidden>Connect Google Calendar<\/a>/);
 assert.doesNotMatch(html,/https:\/\/james-app-seven\.vercel\.app\/api\/google\/connect/);
 assert.match(css,/#googleCalendarConnectLink\[hidden\]\{display:none!important\}/);
});

test('Only an explicit token-refresh failure reveals the reconnect link; success hides it',()=>{
 assert.match(script,/function googleEventsFailed\(error\)/);
 assert.match(script,/error\?\.calendarCode==='GOOGLE_CALENDAR_READ_FAILED' && error\?\.calendarStage==='TOKEN_REFRESH'/);
 assert.match(script,/reconnectLink\.hidden=true/);
});

test('In-app link preserves OAuth state verification and canonical callback',()=>{
 assert.match(connect,/requireAuth\(req, res\)/);
 assert.match(connect,/google_oauth_state=\$\{state\}; HttpOnly; Secure; SameSite=Lax/);
 assert.match(callback,/state !== expectedState/);
 for(const content of [connect,callback])assert.match(content,/https:\/\/www\.getjames\.ai\/api\/google\/callback/);
});

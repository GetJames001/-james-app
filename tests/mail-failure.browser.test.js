const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

test('Mail keeps known messages through failed refresh and accepts a later verified empty page', async () => {
  let mode = 'populated';
  let reads = 0;
  let writes = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/microsoft/mail') {
        if (req.method !== 'GET') {
          writes++;
          res.statusCode = 405;
          return res.end('{}');
        }
        reads++;
        if (mode === 'failed') {
          res.statusCode = 502;
          return res.end(JSON.stringify({
            code: 'MAIL_MESSAGES_UNAVAILABLE', messagesStatus: 'unavailable',
            diagnostic:{stage:'inbox_messages',reason:'provider_error',upstreamStatus:503},
            error: 'Microsoft Mail messages could not be refreshed. Please retry.',
            coverage: { complete: false, mailboxScanComplete: false },
          }));
        }
        return res.end(JSON.stringify({
          connected: true, unreadCount: mode === 'empty' ? 0 : 7,
          messages: mode === 'empty' ? [] : [{
            id: 'synthetic-preserved', subject: 'Keep this known message',
            sender: 'Fixture sender', preview: 'Synthetic only', isRead: false,
          }],
        }));
      }
      if (url.pathname === '/api/tasks') return res.end('{"tasks":[]}');
      if (url.pathname === '/api/auth/session') return res.end('{"ok":true,"authenticated":true}');
      return res.end('{"connected":false}');
    }
    const filename = path.join(__dirname, '..', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    try {
      res.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(fs.readFileSync(filename));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('https://**', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelector('#personalEmailCount').textContent === '7 unread');
    const initialReads = reads;
    mode = 'failed';
    // Respect the real controller's five-second minimum refresh interval.
    await page.waitForTimeout(5100);
    await page.evaluate(() => loadPersonalMicrosoftMail());
    assert.ok(reads > initialReads, 'the failing refresh actually reached the server');
    assert.equal(await page.locator('#personalEmailCount').textContent(), 'Refresh unavailable');
    assert.match(await page.locator('#personalMailMessages').textContent(), /Keep this known message/);
    assert.equal(await page.evaluate(() => window.personalMicrosoftMessages[0].id), 'synthetic-preserved');
    assert.match(await page.locator('#microsoftMailHealth').textContent(),/unavailable/);
    assert.match(await page.locator('#microsoftMailDiagnostic').textContent(),/Inbox messages.*HTTP 503/);
    mode = 'empty';
    await page.waitForTimeout(5100);
    await page.evaluate(() => loadPersonalMicrosoftMail());
    assert.equal(await page.locator('#personalEmailCount').textContent(), '0 unread');
    assert.match(await page.locator('#personalMailMessages').textContent(), /No recent messages/);
    assert.equal(await page.evaluate(() => window.personalMicrosoftMessages.length), 0);
    assert.equal(await page.locator('#microsoftMailHealth').textContent(),'Hotmail Mail connected.');
    assert.equal(await page.locator('#microsoftMailDiagnostic').textContent(),'');
    await page.evaluate(()=>applyPersonalMicrosoftMail({connected:true,unreadCount:null,totalCount:null,countStatus:'unavailable',messages:[{id:'count-safe',subject:'Count unavailable, message confirmed',isRead:false}]}));
    assert.equal(await page.locator('#personalEmailCount').textContent(),'Mail connected');
    assert.match(await page.locator('#personalMailMessages').textContent(),/Count unavailable, message confirmed/);
    await page.locator('nav [data-page="personalMail"]').click();
    const refresh = page.getByRole('button', { name: 'Refresh inbox', exact: true });
    const status = page.locator('#personalMailRefreshStatus');
    const waitForStatus = text => page.waitForFunction(value =>
      document.querySelector('#personalMailRefreshStatus').textContent === value, text);
    await page.clock.install();
    await refresh.click();
    await waitForStatus('Inbox refreshed.');
    await page.clock.fastForward(2000);
    assert.equal(await status.textContent(), 'Inbox refreshed.');

    let holdRefresh;
    const nextRequest = new Promise(resolve => { holdRefresh = resolve; });
    await page.route('**/api/microsoft/mail?account=personal', route => holdRefresh(route), { times: 1 });
    await refresh.click();
    const pending = await nextRequest;
    await page.clock.fastForward(1100);
    assert.equal(await status.textContent(), 'Refreshing now…', 'an older timer cannot clear the next refresh');
    assert.equal(await refresh.isDisabled(), true);
    await pending.fulfill({ json: { connected: true, unreadCount: 0, messages: [] } });
    await waitForStatus('Inbox refreshed.');
    await page.clock.fastForward(3100);
    assert.equal(await status.textContent(), '');
    assert.equal(await refresh.isEnabled(), true);
    mode = 'failed';
    await refresh.click();
    await waitForStatus('Mail unavailable. See Settings → Connections.');
    await page.clock.fastForward(3100);
    assert.match(await status.textContent(), /Mail unavailable/);
    // A weather provider failure may recover while the owner is reading Mail.
    let weatherReady = false;
    await page.route('**/api/weather?**', route => route.fulfill(weatherReady
      ? { json: { current: { temperature_2m: 74, weather_code: 0 } } }
      : { status: 502, json: { error: 'Weather unavailable' } }));
    await page.evaluate(() => {
      localStorage.setItem('jamesWeatherLocation', JSON.stringify({ latitude: 36, longitude: -115, savedAt: Date.now() }));
      loadLiveWeather();
    });
    await page.waitForFunction(() => document.querySelector('#weatherDetail').textContent === 'Weather unavailable');
    weatherReady = true;
    await page.locator('nav [data-page="briefing"]').click();
    await page.waitForFunction(() => document.querySelector('#weatherTemp').textContent === '74°');
    assert.match(await page.locator('#weatherDetail').textContent(), /Last known location/);
    assert.equal(writes, 0, 'refresh never changes read state or sends mail');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

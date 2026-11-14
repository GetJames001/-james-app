const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');
const loginRoute = require('../lib/routes/login-page.js');

const root = path.join(__dirname, '..');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=', 'base64');
const newsletter = {
  id: 'newsletter', subject: 'Studio newsletter', isRead: true,
  body: '<img alt="Feature" src="https://pictures.test/cover.png"><img alt="Gallery" data-src="https://pictures.test/gallery.png">',
  outlookUrl: 'https://outlook.live.com/mail/example'
};
const letter = { id: 'letter', isRead: true, subject: 'Note', preview: 'Short preview', body: '' };
const letterText = 'Meet at the studio.\nBudget < 200.\nBring <samples>.';

for (const entry of ['after sign-in', 'returning session']) {
  test('Mail shows newsletter pictures and complete text in a ' + entry, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 820, height: 1180 } });
      const hits = [];
      await page.route('https://pictures.test/**', route => {
        hits.push(new URL(route.request().url()).pathname);
        return route.fulfill({ contentType: 'image/png', body: image });
      });
      await page.route('https://james.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/login') {
          const headers = {};
          const response = {
            setHeader(name, value) { headers[name] = String(value); }, status() { return this; },
            send(body) { return route.fulfill({ headers, body }); }
          };
          // Use the actual route header and HTML meta policy in this journey.
          const host = 'getjames.ai';
          return loginRoute({ method: 'GET', headers: { host } }, response);
        }
        if (url.pathname === '/api/auth/login') return route.fulfill({ json: { ok: true } });
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { ok: true, authenticated: true } });
        if (url.pathname === '/api/microsoft/mail') {
          if (url.searchParams.has('readMessageId')) return route.fulfill({ json: { message: { ...letter, body: letterText, bodyType: 'text' } } });
          if (url.searchParams.has('messageId')) return route.fulfill({ json: { attachments: [] } });
          return route.fulfill({ json: { connected: true, messages: [newsletter, letter], unreadCount: 0 } });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { connected: false, tasks: [] } });
        const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404 });
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
        return route.fulfill({ contentType: type[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      });
      if (entry === 'after sign-in') {
        await page.goto('https://james.test/login');
        await page.locator('input[type=email]').fill('reader@example.test');
        await page.locator('input[type=password]').fill('fictional-password');
        await page.locator('button[type=submit]').click();
      } else {
        await page.goto('https://james.test/');
      }
      await page.locator('nav [data-page=personalMail]').click();
      await page.locator('[data-message-id=newsletter]').click();
      const frame = page.frameLocator('#personalMailDetailBody iframe');
      const decodedWidth = locator => locator.evaluate(async img => { await img.decode(); return img.naturalWidth; });
      assert.equal(await decodedWidth(frame.getByAltText('Feature')), 1);
      assert.equal(hits.includes('/gallery.png'), false);
      await page.getByRole('button', { name: 'Show pictures' }).click();
      assert.equal(await decodedWidth(frame.locator('img[src$="gallery.png"]')), 1);
      assert.equal(await page.getByRole('link', { name: 'Open in Outlook' }).getAttribute('href'), newsletter.outlookUrl);
      assert.equal(await page.locator('#personalMailDetailBody iframe').getAttribute('sandbox'), '');
      await page.locator('#personalMailDetailBack').click();
      await page.locator('[data-message-id=letter]').click();
      await frame.getByText('Bring <samples>.', { exact: false }).waitFor();
      assert.equal(await frame.locator('body').innerText(), letterText);
      assert.equal(await page.getByRole('button', { name: 'Show pictures' }).count(), 0);
    } finally { await browser.close(); }
  });
}

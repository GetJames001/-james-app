const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const timeZone = 'America/Los_Angeles';

function localDateParts(date = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
}

function localEventTime(hour, minute) {
  const { year, month, day } = localDateParts();
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const localGuess = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(utcGuess)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
  const renderedAsUtc = Date.UTC(
    localGuess.year,
    localGuess.month - 1,
    localGuess.day,
    localGuess.hour,
    localGuess.minute
  );
  const offset = renderedAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offset).toISOString();
}

function json(response, body) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');

    if (url.pathname === '/api/google/events') {
      json(response, {
        connected: true,
        events: [
          {
            id: 'field-day',
            title: 'FIELD DAY',
            location: 'IN FIELD',
            start: localEventTime(7, 0),
            end: localEventTime(14, 0),
            allDay: false
          },
          {
            id: 'michael-1-1',
            title: 'Michael 1:1',
            location: 'Microsoft Teams Meeting',
            start: localEventTime(11, 30),
            end: localEventTime(12, 0),
            allDay: false
          }
        ]
      });
      return;
    }

    if (url.pathname === '/api/microsoft/mail') {
      json(response, {
        connected: true,
        unreadCount: 37,
        messages: [{
          id: 'mail-1',
          subject: 'Mobile mail test',
          sender: 'test@example.com',
          preview: 'Synthetic browser fixture',
          receivedDateTime: new Date().toISOString(),
          isRead: false
        }]
      });
      return;
    }

    if (url.pathname === '/api/tasks') {
      json(response, { tasks: [] });
      return;
    }

    const relativePath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = path.join(root, relativePath);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    const extension = path.extname(filePath);
    const contentTypes = {
      '.css': 'text/css',
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.png': 'image/png'
    };
    response.writeHead(200, {
      'content-type': contentTypes[extension] || 'application/octet-stream'
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

async function calendarMetrics(page) {
  return page.evaluate(() => {
    const calendar = document.querySelector('#calendar');
    const findEvent = title => [...calendar.querySelectorAll('.event')]
      .find(event => event.querySelector('b')?.textContent === title);
    const metric = event => {
      const rect = event.getBoundingClientRect();
      const labelRect = event.querySelector('b').getBoundingClientRect();
      return {
        top: Number.parseFloat(event.style.top),
        height: Number.parseFloat(event.style.height),
        left: rect.left,
        right: rect.right,
        labelOffset: labelRect.top - rect.top
      };
    };
    const pixelsPerMinute = document.querySelector('.hour').getBoundingClientRect().height / 60;
    const now = new Date();
    const nowMinutes = (now.getHours() - 7) * 60 + now.getMinutes();
    const marker = calendar.querySelector('.now');

    return {
      width: window.innerWidth,
      hourHeight: pixelsPerMinute * 60,
      fieldDay: metric(findEvent('FIELD DAY')),
      michael: metric(findEvent('Michael 1:1')),
      markerTop: Number.parseFloat(marker.style.top),
      expectedMarkerTop: Math.max(0, Math.min(720 * pixelsPerMinute, nowMinutes * pixelsPerMinute))
    };
  });
}

async function waitForGeometry(page, viewportWidth, hourHeight, michaelTop) {
  await page.waitForFunction(
    ({ expectedViewportWidth, expectedHourHeight, expectedMichaelTop }) => {
      const hour = document.querySelector('.hour');
      const fieldDay = [...document.querySelectorAll('.event')]
        .find(event => event.querySelector('b')?.textContent === 'FIELD DAY');
      const michael = [...document.querySelectorAll('.event')]
        .find(event => event.querySelector('b')?.textContent === 'Michael 1:1');
      return hour && fieldDay && michael &&
        window.innerWidth === expectedViewportWidth &&
        Math.abs(hour.getBoundingClientRect().height - expectedHourHeight) < 0.1 &&
        Math.abs(Number.parseFloat(michael.style.top) - expectedMichaelTop) < 0.1 &&
        fieldDay.getBoundingClientRect().right <= michael.getBoundingClientRect().left;
    },
    {
      expectedViewportWidth: viewportWidth,
      expectedHourHeight: hourHeight,
      expectedMichaelTop: michaelTop
    }
  );
}

async function mailMetrics(page) {
  return page.evaluate(() => {
    const personalRow = document.querySelector('#personalMailRow');
    const count = document.querySelector('#personalEmailCount');
    const mailCard = personalRow.closest('.intel-card');
    const callbacksCard = [...document.querySelectorAll('.intel-card')]
      .find(card => card.querySelector(':scope > span')?.textContent.trim() === 'CALLBACKS');
    const rect = element => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height
      };
    };
    const textRange = document.createRange();
    textRange.selectNodeContents(count);
    const textRects = [...textRange.getClientRects()].map(bounds => ({
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      width: bounds.width,
      height: bounds.height
    }));
    const labels = [...mailCard.querySelectorAll(':scope > span, .mail-row > span:first-child')]
      .map(element => ({
        text: element.textContent.trim(),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        bounds: rect(element)
      }));
    const icons = [...mailCard.querySelectorAll('svg')].map(rect);
    const countStyle = getComputedStyle(count);
    const stripStyle = getComputedStyle(mailCard.parentElement);

    return {
      viewportWidth: window.innerWidth,
      value: count.textContent,
      count: rect(count),
      textRects,
      countFontSize: Number.parseFloat(countStyle.fontSize),
      countLineHeight: Number.parseFloat(countStyle.lineHeight),
      countOverflow: countStyle.overflow,
      textSizeAdjust: countStyle.webkitTextSizeAdjust || countStyle.textSizeAdjust,
      mailCard: rect(mailCard),
      callbacksCard: rect(callbacksCard),
      labels,
      icons,
      gridColumns: stripStyle.gridTemplateColumns
    };
  });
}

function assertMailContained(metrics) {
  const tolerance = 0.5;
  assert.equal(metrics.value, '37 unread');
  assert.ok(metrics.countFontSize >= 12, `count font is ${metrics.countFontSize}px`);
  assert.ok(metrics.countLineHeight >= 14, `count line-height is ${metrics.countLineHeight}px`);
  assert.equal(metrics.countOverflow, 'visible');
  assert.ok(metrics.textRects.length > 0);
  for (const bounds of metrics.textRects) {
    assert.ok(bounds.left >= metrics.mailCard.left - tolerance);
    assert.ok(bounds.right <= metrics.mailCard.right + tolerance);
    assert.ok(bounds.top >= metrics.mailCard.top - tolerance);
    assert.ok(bounds.bottom <= metrics.mailCard.bottom + tolerance);
  }
  assert.ok(metrics.mailCard.right <= metrics.callbacksCard.left + tolerance);
  for (const label of metrics.labels) {
    assert.ok(label.text.length > 0);
    assert.ok(label.fontSize >= 10, `${label.text} font is ${label.fontSize}px`);
    assert.ok(label.bounds.width > 0 && label.bounds.height > 0);
  }
  assert.ok(metrics.icons.length >= 3);
  for (const icon of metrics.icons) {
    assert.ok(icon.width >= 15 && icon.height >= 15);
    assert.ok(icon.left >= metrics.mailCard.left - tolerance);
    assert.ok(icon.right <= metrics.mailCard.right + tolerance);
  }
}

test('responsive calendar and mail layout survive live viewport changes', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      timezoneId: timeZone,
      viewport: { width: 390, height: 844 }
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('jamesIntroDate', new Date().toDateString());
    });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
    await page.getByText('Michael 1:1', { exact: true }).first().waitFor();

    await waitForGeometry(page, 390, 52, 234);
    const portrait = await calendarMetrics(page);
    assert.equal(portrait.fieldDay.top, 0);
    assert.equal(portrait.fieldDay.height, 364);
    assert.equal(portrait.michael.top, 234);
    assert.equal(portrait.michael.height, 26);
    assert.ok(portrait.fieldDay.right <= portrait.michael.left);
    assert.ok(portrait.fieldDay.labelOffset < 12);
    assert.ok(Math.abs(portrait.markerTop - portrait.expectedMarkerTop) < 0.1);

    await page.locator('.event').filter({ hasText: 'FIELD DAY' }).click();
    await page.locator('#backdrop.open').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#panelTitle').innerText(), 'FIELD DAY');
    await page.locator('#close').click();
    await page.locator('.event').filter({ hasText: 'Michael 1:1' }).click();
    await page.locator('#backdrop.open').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#panelTitle').innerText(), 'Michael 1:1');
    await page.locator('#close').click();

    await page.setViewportSize({ width: 844, height: 390 });
    await waitForGeometry(page, 844, 60, 270);
    const landscape = await calendarMetrics(page);
    assert.equal(landscape.fieldDay.height, 420);
    assert.equal(landscape.michael.height, 30);
    assert.ok(landscape.fieldDay.right <= landscape.michael.left);
    assert.ok(Math.abs(landscape.markerTop - landscape.expectedMarkerTop) < 0.1);

    await page.setViewportSize({ width: 390, height: 844 });
    await waitForGeometry(page, 390, 52, 234);
    const portraitAgain = await calendarMetrics(page);
    assert.equal(portraitAgain.fieldDay.height, portrait.fieldDay.height);
    assert.equal(portraitAgain.michael.top, portrait.michael.top);

    await page.setViewportSize({ width: 768, height: 1024 });
    await waitForGeometry(page, 768, 60, 270);
    const ipadNarrow = await calendarMetrics(page);
    await page.setViewportSize({ width: 834, height: 1112 });
    await waitForGeometry(page, 834, 60, 270);
    const ipadWide = await calendarMetrics(page);
    assert.notEqual(ipadNarrow.fieldDay.right, ipadWide.fieldDay.right);
    assert.equal(ipadNarrow.michael.top, ipadWide.michael.top);
    assert.ok(ipadWide.fieldDay.right <= ipadWide.michael.left);

    await page.getByRole('button', { name: 'Appointments' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Briefing' }).click();
    await waitForGeometry(page, 390, 52, 234);
    const reopened = await calendarMetrics(page);
    assert.equal(reopened.fieldDay.height, 364);
    assert.equal(reopened.michael.top, 234);

    const mail = await mailMetrics(page);
    assertMailContained(mail);
    await page.locator('#personalMailRow').click();
    assert.equal(await page.locator('.page.active').getAttribute('id'), 'personalMail');
    await page.locator('#personalMailBack').click();
    assert.equal(await page.locator('.page.active').getAttribute('id'), 'briefing');

    console.log('BROWSER_EVIDENCE', JSON.stringify({
      portrait,
      landscape,
      portraitAgain,
      ipadNarrow,
      ipadWide,
      reopened,
      mail
    }));

    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('live Personal Mail value stays readable across Android phone widths', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      timezoneId: timeZone,
      viewport: { width: 320, height: 800 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36'
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('jamesIntroDate', new Date().toDateString());
    });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
    await page.locator('#personalEmailCount').filter({ hasText: '37 unread' }).waitFor();

    const phoneEvidence = [];
    for (const width of [320, 360, 390, 412, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(expectedWidth => window.innerWidth === expectedWidth, width);
      const metrics = await mailMetrics(page);
      assert.equal(metrics.viewportWidth, width);
      assertMailContained(metrics);
      phoneEvidence.push(metrics);
    }

    await page.locator('#personalMailRow').click();
    assert.equal(await page.locator('.page.active').getAttribute('id'), 'personalMail');
    await page.locator('#personalMailBack').click();
    assert.equal(await page.locator('.page.active').getAttribute('id'), 'briefing');

    console.log('ANDROID_MAIL_EVIDENCE', JSON.stringify(phoneEvidence));
    await context.close();

    const layoutContext = await browser.newContext({
      timezoneId: timeZone,
      viewport: { width: 768, height: 1024 }
    });
    const layoutPage = await layoutContext.newPage();
    await layoutPage.addInitScript(() => {
      sessionStorage.setItem('jamesIntroDate', new Date().toDateString());
    });
    await layoutPage.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
    await layoutPage.locator('#personalEmailCount').filter({ hasText: '37 unread' }).waitFor();

    const ipad = await mailMetrics(layoutPage);
    assertMailContained(ipad);
    assert.equal(ipad.mailCard.top, ipad.callbacksCard.top);
    assert.equal(ipad.mailCard.width, ipad.callbacksCard.width);

    await layoutPage.setViewportSize({ width: 1440, height: 900 });
    await layoutPage.waitForFunction(() => window.innerWidth === 1440);
    const desktop = await mailMetrics(layoutPage);
    assertMailContained(desktop);
    assert.equal(desktop.mailCard.top, desktop.callbacksCard.top);
    assert.equal(desktop.mailCard.width, desktop.callbacksCard.width);
    assert.notEqual(ipad.gridColumns, desktop.gridColumns);

    console.log('WIDE_MAIL_EVIDENCE', JSON.stringify({ ipad, desktop }));
    await layoutContext.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPersonalMailRefreshController
} = require('../mail-refresh.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    },
    dispatch(name) { listeners.get(name)?.(); },
    has(name) { return listeners.has(name); }
  };
}

function harness(overrides = {}) {
  let currentTime = 10_000;
  let visible = true;
  let mailOpen = false;
  let intervalCallback = null;
  let intervalStarts = 0;
  let intervalStops = 0;
  const documentTarget = eventTarget();
  const windowTarget = eventTarget();
  const successes = [];
  const failures = [];
  const requests = [];

  const controller = createPersonalMailRefreshController({
    fetchMail: overrides.fetchMail || (() => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    }),
    onSuccess: (data, reason) => successes.push({ data, reason }),
    onError: (error, reason) => failures.push({ error, reason }),
    isVisible: () => visible,
    isMailOpen: () => mailOpen,
    documentTarget,
    windowTarget,
    now: () => currentTime,
    setIntervalFn: callback => {
      intervalStarts += 1;
      intervalCallback = callback;
      return intervalStarts;
    },
    clearIntervalFn: () => {
      intervalStops += 1;
      intervalCallback = null;
    },
    pollIntervalMs: 60_000,
    minimumRefreshMs: 5_000
  });

  return {
    controller,
    documentTarget,
    windowTarget,
    requests,
    successes,
    failures,
    setTime(value) { currentTime = value; },
    setVisible(value) { visible = value; },
    setMailOpen(value) { mailOpen = value; },
    tick() { return intervalCallback?.(); },
    intervalStarts: () => intervalStarts,
    intervalStops: () => intervalStops
  };
}

test('refreshes initially, on mail open, and on foreground return', async () => {
  const h = harness();
  h.controller.start();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ unreadCount: 5 });
  await flushPromises();

  h.setTime(16_000);
  h.setMailOpen(true);
  h.controller.pageChanged();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ unreadCount: 4 });
  await flushPromises();

  h.setVisible(false);
  h.documentTarget.dispatch('visibilitychange');
  h.setTime(22_000);
  h.setVisible(true);
  h.documentTarget.dispatch('visibilitychange');
  assert.equal(h.requests.length, 3);
});

test('deduplicates concurrent triggers and enforces the minimum interval', async () => {
  const h = harness();
  h.controller.start();
  const initial = h.requests[0];
  h.controller.refresh('manual');
  h.windowTarget.dispatch('pageshow');
  assert.equal(h.requests.length, 1);

  initial.resolve({ unreadCount: 5 });
  await flushPromises();
  await h.controller.refresh('manual');
  assert.equal(h.requests.length, 1);

  h.setTime(15_001);
  h.controller.refresh('manuap¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹ÉÅÕÍÑÌ¹±¹Ñ °È¤ì)ô¤ì()ÑÍÐ Á½±±Ì½¹±äÝ¡¥±AÉÍ½¹°5¥°¥Ì½Á¸¹Ñ¡½Õµ¹Ð¥ÌÙ¥Í¥±°Íå¹ ¤ôøì(½¹ÍÐ ô¡É¹ÍÌ¡ìÑ¡5¥°èÍå¹ ¤ôø¡ìÕ¹É
½Õ¹ÐèÔô¤ô¤ì( ¹½¹ÑÉ½±±È¹ÍÑÉÐ ¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½¹ÑÉ½±±È¹¥ÍA½±±¥¹ ¤°±Í¤ì(( ¹ÍÑQ¥µ ÄÙ|ÀÀÀ¤ì( ¹ÍÑ5¥±=Á¸¡ÑÉÕ¤ì( ¹½¹ÑÉ½±±È¹Á
¡¹ ¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½¹ÑÉ½±±È¹¥ÍA½±±¥¹ ¤°ÑÉÕ¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹¥¹ÑÉÙ±MÑÉÑÌ ¤°Ä¤ì(( ¹ÍÑQ¥µ ÜÙ|ÀÀÀ¤ì( ¹Ñ¥¬ ¤ì(Ý¥ÐAÉ½µ¥Í¹ÉÍ½±Ù ¤ì(( ¹ÍÑY¥Í¥±¡±Í¤ì( ¹½Õµ¹ÑQÉÐ¹¥ÍÁÑ  Ù¥Í¥¥±¥Ñå¡¹¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½¹ÑÉ½±±È¹¥ÍA½±±¥¹ ¤°±Í¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹¥¹ÑÉÙ±MÑ½ÁÌ ¤°Ä¤ì(( ¹ÍÑQ¥µ àÉ|ÀÀÀ¤ì( ¹ÍÑY¥Í¥±¡ÑÉÕ¤ì( ¹½Õµ¹ÑQÉÐ¹¥ÍÁÑ  Ù¥Í¥¥±¥Ñå¡¹¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½¹ÑÉ½±±È¹¥ÍA½±±¥¹ ¤°ÑÉÕ¤ì(( ¹ÍÑ5¥±=Á¸¡±Í¤ì( ¹½¹ÑÉ½±±È¹Á
¡¹ ¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½¹ÑÉ½±±È¹¥ÍA½±±¥¹ ¤°±Í¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹¥¹ÑÉÙ±MÑ½ÁÌ ¤°È¤ì)ô¤ì()ÑÍÐ ÍÑ½ÁÌÑ¥µÉÌ¹±¥ÍÑ¹ÉÌÝ¡¸ÍÑ½ÁÁ° ¤ôøì(½¹ÍÐ ô¡É¹ÍÌ¡ìÑ¡5¥°èÍå¹ ¤ôø¡ìÕ¹É
½Õ¹ÐèÔô¤ô¤ì( ¹ÍÑ5¥±=Á¸¡ÑÉÕ¤ì( ¹½¹ÑÉ½±±È¹ÍÑÉÐ ¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½Õµ¹ÑQÉÐ¹¡Ì Ù¥Í¥¥±¥Ñå¡¹¤°ÑÉÕ¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹Ý¥¹½ÝQÉÐ¹¡Ì ÁÍ¡½Ü¤°ÑÉÕ¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½¹ÑÉ½±±È¹¥ÍA½±±¥¹ ¤°ÑÉÕ¤ì(( ¹½¹ÑÉ½±±È¹ÍÑ½À ¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½Õµ¹ÑQÉÐ¹¡Ì Ù¥Í¥¥±¥Ñå¡¹¤°±Í¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹Ý¥¹½ÝQÉÐ¹¡Ì ÁÍ¡½Ü¤°±Í¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹½¹ÑÉ½±±È¹¥ÍA½±±¥¹ ¤°±Í¤ì)ô¤ì()ÑÍÐ ÉÁ½ÉÑÌÑÉ¹Í¥¹Ð¥±ÕÉÌÝ¥Ñ¡½ÕÐÉÁ±¥¹Ñ¡±ÍÐÍÕÍÍÕ°ÍÑÑ°Íå¹ ¤ôøì(½¹ÍÐ ô¡É¹ÍÌ ¤ì( ¹½¹ÑÉ½±±È¹ÍÑÉÐ ¤ì( ¹ÉÅÕÍÑÍlÁt¹ÉÍ½±Ù¡ìÕ¹É
½Õ¹ÐèÔô¤ì(Ý¥Ð±ÕÍ¡AÉ½µ¥ÍÌ ¤ì(ÍÍÉÐ¹ÁÅÕ°¡ ¹ÍÕÍÍÌ°mìÑèìÕ¹É
½Õ¹ÐèÔô°ÉÍ½¸è¥¹¥Ñ¥°õt¤ì(( ¹ÍÑQ¥µ ÄÙ|ÀÀÀ¤ì( ¹½¹ÑÉ½±±È¹ÉÉÍ  Á½±°¤ì( ¹ÉÅÕÍÑÍlÅt¹É©Ð¡¹ÜÉÉ½È ÑµÁ½ÉÉäÁÉ½Ù¥È¥±ÕÉ¤¤ì(Ý¥Ð±ÕÍ¡AÉ½µ¥ÍÌ ¤ì((ÍÍÉÐ¹ÅÕ°¡ ¹ÍÕÍÍÌ¹±¹Ñ °Ä¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹¥±ÕÉÌ¹±¹Ñ °Ä¤ì(ÍÍÉÐ¹ÅÕ°¡ ¹¥±ÕÉÍlÁt¹ÉÍ½¸°Á½±°¤ì)ô¤ì

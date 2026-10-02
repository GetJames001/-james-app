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
  h.controller.refresh('manual');
  assert.equal(h.requests.length, 2);
});

test('polls only while Personal Mail is open and the document is visible', async () => {
  const h = harness({ fetchMail: async () => ({ unreadCount: 5 }) });
  h.controller.start();
  assert.equal(h.controller.isPolling(), false);

  h.setTime(16_000);
  h.setMailOpen(true);
  h.controller.pageChanged();
  assert.equal(h.controller.isPolling(), true);
  assert.equal(h.intervalStarts(), 1);

  h.setTime(76_000);
  h.tick();
  await Promise.resolve();

  h.setVisible(false);
  h.documentTarget.dispatch('visibilitychange');
  assert.equal(h.controller.isPolling(), false);
  assert.equal(h.intervalStops(), 1);

  h.setTime(82_000);
  h.setVisible(true);
  h.documentTarget.dispatch('visibilitychange');
  assert.equal(h.controller.isPolling(), true);

  h.setMailOpen(false);
  h.controller.pageChanged();
  assert.equal(h.controller.isPolling(), false);
  assert.equal(h.intervalStops(), 2);
});

test('stops timers and listeners when stopped', () => {
  const h = harness({ fetchMail: async () => ({ unreadCount: 5 }) });
  h.setMailOpen(true);
  h.controller.start();
  assert.equal(h.documentTarget.has('visibilitychange'), true);
  assert.equal(h.windowTarget.has('pageshow'), true);
  assert.equal(h.controller.isPolling(), true);

  h.controller.stop();
  assert.equal(h.documentTarget.has('visibilitychange'), false);
  assert.equal(h.windowTarget.has('pageshow'), false);
  assert.equal(h.controller.isPolling(), false);
});

test('reports transient failures without replacing the last successful state', async () => {
  const h = harness();
  h.controller.start();
  h.requests[0].resolve({ unreadCount: 5 });
  await flushPromises();
  assert.deepEqual(h.successes, [{ data: { unreadCount: 5 }, reason: 'initial' }]);

  h.setTime(16_000);
  h.controller.refresh('poll');
  h.requests[1].reject(new Error('temporary provider failure'));
  await flushPromises();

  assert.equal(h.successes.length, 1);
  assert.equal(h.failures.length, 1);
  assert.equal(h.failures[0].reason, 'poll');
});

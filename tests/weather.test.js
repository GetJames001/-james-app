const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function createHarness({ geolocation, response }) {
  const elements = {
    '#weatherTemp': { textContent: '—' },
    '#weatherDetail': { textContent: '—' }
  };
  const fetchCalls = [];

  const context = vm.createContext({
    console: { error() {}, log() {}, warn() {} },
    document: {
      readyState: 'loading',
      addEventListener() {},
      querySelector(selector) {
        return elements[selector] || null;
      },
      querySelectorAll() {
        return [];
      }
    },
    fetch: async (url) => {
      fetchCalls.push(url);
      return response;
    },
    navigator: geolocation ? { geolocation } : {},
    window: {}
  });

  vm.runInContext(appSource, context);

  return {
    elements,
    fetchCalls,
    loadWeather() {
      vm.runInContext('loadLiveWeather()', context);
    }
  };
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('loads live weather from the device location with a bounded lookup', async () => {
  let receivedOptions;
  const harness = createHarness({
    geolocation: {
      getCurrentPosition(success, _error, options) {
        receivedOptions = options;
        success({ coords: { latitude: 35.9, longitude: -115.2 } });
      }
    },
    response: {
      ok: true,
      async json() {
        return { current: { temperature_2m: 87.6, weather_code: 0 } };
      }
    }
  });

  harness.loadWeather();
  await flushPromises();

  assert.equal(receivedOptions.timeout, 8000);
  assert.equal(receivedOptions.maximumAge, 15 * 60 * 1000);
  assert.equal(receivedOptions.enableHighAccuracy, false);
  assert.match(harness.fetchCalls[0], /latitude=35\.9/);
  assert.equal(harness.elements['#weatherTemp'].textContent, '88°');
  assert.equal(harness.elements['#weatherDetail'].textContent, 'Clear');
});

test('shows location unavailable when the device location cannot be resolved', async () => {
  const harness = createHarness({
    geolocation: {
      getCurrentPosition(_success, error) {
        error({ code: 2, message: 'Position unavailable' });
      }
    }
  });

  harness.loadWeather();
  await flushPromises();

  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.elements['#weatherTemp'].textContent, '—');
  assert.equal(harness.elements['#weatherDetail'].textContent, 'Location unavailable');
});

test('shows location unavailable when geolocation is unavailable', async () => {
  const harness = createHarness({});

  harness.loadWeather();
  await flushPromises();

  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.elements['#weatherTemp'].textContent, '—');
  assert.equal(harness.elements['#weatherDetail'].textContent, 'Location unavailable');
});

test('reports API failures after obtaining a device location', async () => {
  const harness = createHarness({
    geolocation: {
      getCurrentPosition(success) {
        success({ coords: { latitude: 35.9, longitude: -115.2 } });
      }
    },
    response: {
      ok: false,
      async json() {
        return {};
      }
    }
  });

  harness.loadWeather();
  await flushPromises();

  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.elements['#weatherTemp'].textContent, '—');
  assert.equal(harness.elements['#weatherDetail'].textContent, 'Weather unavailable');
});

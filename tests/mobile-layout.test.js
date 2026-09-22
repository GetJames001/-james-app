const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function createContext() {
  const context = vm.createContext({
    console: { error() {}, log() {}, warn() {} },
    document: {
      readyState: 'loading',
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    fetch: async () => ({ ok: false, async json() { return {}; } }),
    getComputedStyle() {
      return { getPropertyValue() { return ''; } };
    },
    navigator: {},
    window: {}
  });

  vm.runInContext(appSource, context);
  return context;
}

test('reads mobile calendar scale even when the calendar is not visible', () => {
  const context = createContext();
  context.getComputedStyle = () => ({
    getPropertyValue(property) {
      return property === '--calendar-hour-height' ? '52px' : '';
    }
  });
  context.hiddenCalendar = {
    querySelector() {
      return { getBoundingClientRect() { return { height: 0 }; } };
    }
  };

  const pixelsPerMinute = vm.runInContext(
    'calendarPixelsPerMinute(hiddenCalendar)',
    context
  );

  assert.equal(pixelsPerMinute, 52 / 60);
});

test('positions overlapping mobile events using the rendered 52px hour rows', () => {
  const context = createContext();
  const layouts = vm.runInContext(`calendarEventLayouts([
    ['07:00', '14:00', 'FIELD DAY', 'IN FIELD'],
    ['11:30', '12:00', 'Michael 1:1', 'Microsoft Teams Meeting']
  ], 52 / 60)`, context);

  assert.equal(layouts[0].top, 0);
  assert.equal(layouts[0].height, 364);
  assert.equal(layouts[1].top, 234);
  assert.equal(layouts[1].height, 26);
  assert.equal(layouts[0].lane, 0);
  assert.equal(layouts[1].lane, 1);
  assert.equal(layouts[0].laneCount, 2);
  assert.equal(layouts[1].laneCount, 2);
});

test('preserves desktop calendar geometry at 60px per hour', () => {
  const context = createContext();
  const layout = vm.runInContext(
    `calendarEventLayouts([['11:30', '12:00', 'Michael 1:1', 'Microsoft Teams Meeting']], 1)[0]`,
    context
  );

  assert.equal(layout.top, 270);
  assert.equal(layout.height, 30);
  assert.equal(layout.laneCount, 1);
});

test('uses the browser timezone when converting Google event timestamps', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';

  try {
    const context = createContext();
    const event = vm.runInContext(`toBriefingEvent({
      start: '2026-09-21T11:30:00-07:00',
      end: '2026-09-21T12:00:00-07:00',
      title: 'Michael 1:1',
      location: 'Microsoft Teams Meeting'
    })`, context);

    assert.equal(event[0], '11:30');
    assert.equal(event[1], '12:00');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('anchors event labels at the top and stacks mail counts on narrow screens', () => {
  assert.match(
    styles,
    /\.event\{\s*display:flex;[\s\S]*justify-content:flex-start;[\s\S]*align-items:stretch;/
  );
  assert.match(
    styles,
    /@media\(max-width:650px\)[\s\S]*\.mail-row\{[\s\S]*display:grid;[\s\S]*grid-template-columns:auto minmax\(0,1fr\);/
  );
  assert.match(
    styles,
    /\.intel-card \.mail-row > strong\{[\s\S]*grid-column:1 \/ -1;[\s\S]*width:100%;[\s\S]*font-size:\.8rem;[\s\S]*overflow-wrap:normal;/
  );
  assert.match(
    styles,
    /\.mail-split\{[\s\S]*-webkit-text-size-adjust:100%;[\s\S]*text-size-adjust:100%;/
  );
});

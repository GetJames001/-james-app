const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('conversation and file views contain honest empty states', () => {
  assert.match(index, /No conversations available/);
  assert.match(index, /not connected to a conversation source/);
  assert.match(index, /id="savedJamesFiles"/);
  assert.match(app, /No files available/);
  assert.match(app, /James Files is unavailable/);
});

test('confirmed sample cards and drawer records are absent from the application shell', () => {
  const deployedShell = `${index}\n${app}`;
  const removedSamples = [
    'Scott Schuster',
    'David Kim',
    'Sunset Ridge Post Acute',
    'Central Transport Proposal v4',
    'Galleria Bid Package',
    'Generator Photos — Fort Apache',
    'Mission Pines',
    'Ron Jeet',
    'Maria Lopez'
  ];

  for (const sample of removedSamples) {
    assert.doesNotMatch(deployedShell, new RegExp(sample));
  }
  assert.doesNotMatch(deployedShell, />TJ</);
});

test('briefing omits unused integration shortcuts and focus placeholders', () => {
  assert.doesNotMatch(index, /data-panel="(?:callbacks|emails|proposals)"/);
  assert.doesNotMatch(index, /No focus items loaded/);
});

test('header and spoken briefing do not present fixed weather, traffic, or deadline claims', () => {
  const deployedShell = `${index}\n${app}`;

  assert.doesNotMatch(index, /Weather details below|Traffic not connected/);
  assert.match(index, /id="weatherTemp">—/);
  assert.match(index, /id="traffic">—/);
  assert.doesNotMatch(deployedShell, /82°\s*·\s*Sunny/i);
  assert.doesNotMatch(deployedShell, /Light traffic/i);
  assert.doesNotMatch(deployedShell, /Galleria bid is due tomorrow/i);
});

test('task storage remains persistent and is not seeded or cleared by this cleanup', () => {
  const tasksApi = fs.readFileSync(path.join(root, 'api', 'tasks.js'), 'utf8');

  assert.match(tasksApi, /const TASKS_KEY = "james:tasks"/);
  assert.match(tasksApi, /\["GET", TASKS_KEY\]/);
  assert.match(tasksApi, /"SET",\s*TASKS_KEY/);
  assert.doesNotMatch(`${index}\n${app}\n${tasksApi}`, /Fix James weather card|Water the plants/);
});

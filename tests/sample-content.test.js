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
  assert.match(index, /No files available/);
  assert.match(index, /not connected to a file source/);
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

test('briefing drawers expose empty integration states instead of sample actions', () => {
  assert.match(app, /No callbacks available/);
  assert.match(app, /No email shortcuts available/);
  assert.match(app, /Use Personal Mail for live messages/);
  assert.match(app, /No proposals available/);
  assert.doesNotMatch(app, /data\.map\(/);
});

test('task storage remains persistent and is not seeded or cleared by this cleanup', () => {
  const tasksApi = fs.readFileSync(path.join(root, 'api', 'tasks.js'), 'utf8');

  assert.match(tasksApi, /const TASKS_KEY = "james:tasks"/);
  assert.match(tasksApi, /\["GET", TASKS_KEY\]/);
  assert.match(tasksApi, /"SET",\s*TASKS_KEY/);
  assert.doesNotMatch(`${index}\n${app}\n${tasksApi}`, /Fix James weather card|Water the plants/);
});

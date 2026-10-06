const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const capturePath = path.resolve(__dirname, '../capture.js');
const { localInstant } = require(capturePath);

// Isolate TZ in a fresh process so these tests cannot change any other test's
// timezone or rely on the CI worker's timezone.
function convert(value, timeZone = 'America/Los_Angeles') {
  const script = `const {localInstant}=require(process.argv[1]);try{process.stdout.write(JSON.stringify({value:localInstant(JSON.parse(process.argv[2]))}));}catch(error){process.stdout.write(JSON.stringify({error:error.message}));}`;
  return JSON.parse(execFileSync(process.execPath, ['-e', script, capturePath, JSON.stringify(value)], { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' }));
}

test('capture localInstant is exported and converts ordinary Los Angeles local time into an explicit UTC instant', () => {
  assert.equal(typeof localInstant, 'function');
  assert.deepEqual(convert('2026-10-06T09:30'), { value: '2026-10-06T16:30:00.000Z' });
  assert.deepEqual(convert('2026-01-06T09:30'), { value: '2026-01-06T17:30:00.000Z' });
});

test('capture refuses incomplete, malformed and normalized nonexistent calendar dates', () => {
  for (const value of ['', '2026-10-06', '2026-10-06T09:', '10/06/2026 09:30', '2026-10-06T09:30Z', '2026-02-30T09:30', '2026-13-01T09:30', '2026-00-01T09:30', '2026-10-06T24:30', '2026-10-06T09:60']) {
    const result = convert(value);
    assert.ok(result.error, value);
    assert.equal(result.value, undefined, 'invalid input must not become a different date or time');
  }
});

test('capture rejects skipped spring DST times and ambiguous autumn repeated times in Los Angeles', () => {
  assert.match(convert('2026-03-08T02:30').error, /does not exist/i);
  assert.match(convert('2026-11-01T01:30').error, /repeats|unambiguous/i);
  assert.deepEqual(convert('2026-03-08T03:30'), { value: '2026-03-08T10:30:00.000Z' });
  assert.deepEqual(convert('2026-11-01T02:30'), { value: '2026-11-01T10:30:00.000Z' });
});

test('capture uses the device timezone rather than hardcoding Los Angeles', () => {
  assert.deepEqual(convert('2026-10-06T09:30', 'UTC'), { value: '2026-10-06T09:30:00.000Z' });
  assert.deepEqual(convert('2026-10-06T09:30', 'America/New_York'), { value: '2026-10-06T13:30:00.000Z' });
  assert.deepEqual(convert('2026-10-06T09:30', 'Asia/Tokyo'), { value: '2026-10-06T00:30:00.000Z' });
});

test('capture asset loads before app and clearly distinguishes drafts from external calendar writes', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const script = fs.readFileSync(capturePath, 'utf8');
  const captureTag = html.match(/<script\b[^>]*\bsrc=["']capture\.js["'][^>]*>/i);
  const appTag = html.match(/<script\b[^>]*\bsrc=["']app\.js["'][^>]*>/i);
  assert.ok(captureTag, 'capture.js must be included');
  assert.ok(appTag, 'app.js must be included');
  assert.ok(captureTag.index < appTag.index, 'capture coordinator must exist before app initialization');
  assert.match(script, /Not added to Google Calendar/);
  assert.match(script, /Nothing was sent or added to Google Calendar/);
  assert.doesNotMatch(script, /\blocalStorage\b/, 'capture persistence belongs in authenticated server storage');
  assert.doesNotMatch(script, /https?:\/\/|googleapis\.com|graph\.microsoft\.com/, 'capture UI must not directly contact providers');
  assert.match(script, /request\('\/api\/capture'/);
});
test('non-hour daylight-saving folds are rejected rather than guessed',()=>{
 const {execFileSync}=require('node:child_process');
 const result=execFileSync(process.execPath,['-e',"try{require('./capture.js').localInstant('2026-04-05T01:45');process.exit(1)}catch(e){if(!e.message.includes('repeats'))process.exit(2)}"],{cwd:path.join(__dirname,'..'),env:{...process.env,TZ:'Australia/Lord_Howe'}});assert.equal(result.length,0);
});

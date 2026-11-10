import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCallbackUrl, checkMeetingUrl, parseOrigins, validateJob } from '../lib/validate.js';

test('meeting URL: accepts only meet.google.com codes', () => {
  assert.equal(checkMeetingUrl('https://meet.google.com/abc-defg-hij', 'meet'), 'https://meet.google.com/abc-defg-hij');
  assert.ok(checkMeetingUrl('https://meet.google.com/abc-defg-hij?authuser=0', 'meet'));
  for (const bad of [
    'http://meet.google.com/abc-defg-hij',
    'https://meet.google.com:8443/abc-defg-hij',
    'https://meet.google.com.evil.com/abc-defg-hij',
    'https://evil.com/abc-defg-hij',
    'https://user:pw@meet.google.com/abc-defg-hij',
    'https://meet.google.com/abc-defg-hij#x',
    'https://meet.google.com/abc-defg-hij/extra',
    'https://meet.google.com/ABC-DEFG-HIJ',
    'https://meet.google.com/lookup/abc',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://127.0.0.1/abc-defg-hij',
    'https://169.254.169.254/latest/meta-data',
    '',
    42,
    null,
  ]) {
    assert.equal(checkMeetingUrl(bad, 'meet'), null, String(bad));
  }
  assert.equal(checkMeetingUrl('https://meet.google.com/abc-defg-hij', 'zoom'), null);
});

test('meeting URL: fake meeting only on our own origin when enabled', () => {
  const fakeOrigin = 'http://127.0.0.1:8080';
  assert.ok(checkMeetingUrl('http://127.0.0.1:8080/fake-meet/selftest-1?ends=20', 'meet', { fakeOrigin }));
  assert.equal(checkMeetingUrl('http://127.0.0.1:8080/fake-meet/selftest-1', 'meet'), null);
  assert.equal(checkMeetingUrl('http://127.0.0.1:9999/fake-meet/selftest-1', 'meet', { fakeOrigin }), null);
  assert.equal(checkMeetingUrl('http://127.0.0.1:8080/v1/health', 'meet', { fakeOrigin }), null);
  assert.equal(checkMeetingUrl('http://127.0.0.1:8080/fake-meet/../v1/health', 'meet', { fakeOrigin }), null);
});

test('origins: exact https origins only', () => {
  const o = parseOrigins(' https://zerosoft.ai, https://www.zerosoft.ai/ ,http://insecure.com,https://x.com/path, nonsense ,');
  assert.deepEqual([...o].sort(), ['https://www.zerosoft.ai', 'https://zerosoft.ai']);
});

test('callback URL: exact origin match', () => {
  const o = parseOrigins('https://zerosoft.ai');
  assert.equal(checkCallbackUrl('https://zerosoft.ai/api/calls/bot', o), 'https://zerosoft.ai/api/calls/bot');
  assert.equal(checkCallbackUrl('https://zerosoft.ai/api/calls/bot/', o), 'https://zerosoft.ai/api/calls/bot');
  for (const bad of [
    'https://zerosoft.ai.evil.com/api',
    'https://evil.com/https://zerosoft.ai',
    'http://zerosoft.ai/api',
    'https://zerosoft.ai:444/api',
    'https://a@zerosoft.ai/api',
    'https://zerosoft.ai/api?x=1',
    'https://zerosoft.ai/api#x',
    'https://www.zerosoft.ai/api',
    'http://127.0.0.1:3000/api',
  ]) {
    assert.equal(checkCallbackUrl(bad, o), null, bad);
  }
  assert.ok(checkCallbackUrl('http://127.0.0.1:3000/api', o, { fakeMode: true }));
  assert.equal(checkCallbackUrl('http://10.0.0.1:3000/api', o, { fakeMode: true }), null);
});

const ctx = { origins: parseOrigins('https://zerosoft.ai') };
const good = {
  jobId: 'c_7f3a01',
  platform: 'meet',
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
  botName: 'zerosoft Notetaker',
  consentMessage: 'This call is being recorded.',
  callbackUrl: 'https://zerosoft.ai/api/calls/bot',
  callbackToken: 'x'.repeat(20),
  maxDurationSec: 10800,
  lobbyTimeoutSec: 600,
  aloneTimeoutSec: 120,
};

test('validateJob: happy path and error codes', () => {
  const r = validateJob(good, ctx);
  assert.equal(r.ok, true);
  const err = (/** @type {any} */ patch) => {
    const v = validateJob({ ...good, ...patch }, ctx);
    return v.ok ? 'ok' : v.error;
  };
  assert.equal(err({ platform: 'zoom' }), 'unsupported_platform');
  assert.equal(err({ meetingUrl: 'https://evil.com/x' }), 'invalid_meeting_url');
  assert.equal(err({ callbackUrl: 'https://evil.com/api' }), 'callback_not_allowed');
  assert.equal(err({ jobId: '../etc' }), 'invalid_input');
  assert.equal(err({ jobId: 'x'.repeat(65) }), 'invalid_input');
  assert.equal(err({ callbackToken: 'short' }), 'invalid_input');
  assert.equal(err({ callbackToken: 'has space in it 12345' }), 'invalid_input');
  assert.equal(err({ botName: '' }), 'invalid_input');
  assert.equal(err({ maxDurationSec: 'big' }), 'invalid_input');
  assert.equal(err({ maxDurationSec: 1e9 }), 'invalid_input');
  assert.equal(err({ lobbyTimeoutSec: 1.5 }), 'invalid_input');
  assert.equal(err({ maxDurationSec: undefined }), 'ok');
  assert.equal(validateJob(null, ctx).ok, false);
  assert.equal(validateJob([], ctx).ok, false);
});

test('validateJob strips control characters from text fields', () => {
  const r = validateJob({ ...good, botName: 'zero\u0007soft\u0000', consentMessage: 'line1\nline2\u001b' }, ctx);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.spec.botName, 'zerosoft');
    assert.equal(r.spec.consentMessage, 'line1\nline2');
  }
});

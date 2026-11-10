import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RevokedError, createCallbackClient } from '../lib/callback.js';
import { ReplayCache } from '../lib/hmac.js';
import { allowRequest, isPrivateHost } from '../lib/netpolicy.js';
import { childEnv } from '../lib/proc.js';

test('isPrivateHost', () => {
  for (const h of ['localhost', 'a.localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', 'svc.railway.internal', 'printer.local', '2130706433', '0x7f000001', '']) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ['meet.google.com', '8.8.8.8', '172.32.0.1', '[2607:f8b0::1]', 'www.gstatic.com']) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test('allowRequest: navigation only to Google hosts over https', () => {
  const nav = { isNavigation: true };
  assert.equal(allowRequest('https://meet.google.com/abc-defg-hij', nav), true);
  assert.equal(allowRequest('https://accounts.google.com/x', nav), true);
  assert.equal(allowRequest('https://www.youtube.com/embed/x', nav), true);
  assert.equal(allowRequest('https://evil.com/', nav), false);
  assert.equal(allowRequest('https://google.com.evil.com/', nav), false);
  assert.equal(allowRequest('http://meet.google.com/', nav), false);
  assert.equal(allowRequest('file:///etc/passwd', nav), false);
  assert.equal(allowRequest('data:text/html,hi', nav), false);
  assert.equal(allowRequest('chrome://settings', nav), false);
});

test('allowRequest: subresources https to public hosts only', () => {
  const sub = { isNavigation: false };
  assert.equal(allowRequest('https://www.gstatic.com/x.js', sub), true);
  assert.equal(allowRequest('https://lh3.googleusercontent.com/a.png', sub), true);
  assert.equal(allowRequest('https://cdn.example.com/a.png', sub), true);
  assert.equal(allowRequest('data:image/png;base64,AA', sub), true);
  assert.equal(allowRequest('http://example.com/a', sub), false);
  assert.equal(allowRequest('https://169.254.169.254/latest', sub), false);
  assert.equal(allowRequest('https://127.0.0.1:8080/v1/health', sub), false);
  assert.equal(allowRequest('https://localhost/x', sub), false);
  assert.equal(allowRequest('https://u:p@www.gstatic.com/x', sub), false);
  assert.equal(allowRequest('ftp://x.com/a', sub), false);
});

test('allowRequest: fake origin only when given', () => {
  const fakeOrigin = 'http://127.0.0.1:8080';
  assert.equal(allowRequest('http://127.0.0.1:8080/fake-meet/x', { isNavigation: true, fakeOrigin }), true);
  assert.equal(allowRequest('http://127.0.0.1:8080/fake-meet/x', { isNavigation: true }), false);
  assert.equal(allowRequest('http://127.0.0.1:9999/', { isNavigation: false, fakeOrigin }), false);
});

test('ReplayCache: a signature is accepted once within the TTL', () => {
  const c = new ReplayCache(600_000);
  assert.equal(c.firstUse('sig-a', 0), true);
  assert.equal(c.firstUse('sig-a', 1000), false);
  assert.equal(c.firstUse('sig-b', 1000), true);
  assert.equal(c.firstUse('sig-a', 600_001), true); // expired
  const small = new ReplayCache(600_000, 2);
  small.firstUse('1', 0);
  small.firstUse('2', 0);
  small.firstUse('3', 0);
  assert.equal(small.map.size, 2);
});

test('childEnv never passes secrets', () => {
  process.env.CALLS_BOT_SECRET = 'should-not-leak';
  process.env.SOME_TOKEN = 'nope';
  try {
    const env = childEnv({ DISPLAY: ':99', XAUTHORITY: '/tmp/x', EMPTY: undefined });
    assert.equal(env.CALLS_BOT_SECRET, undefined);
    assert.equal(env.SOME_TOKEN, undefined);
    assert.equal(env.DISPLAY, ':99');
    assert.equal(env.XAUTHORITY, '/tmp/x');
    assert.ok(env.PATH);
    assert.equal('EMPTY' in env, false);
  } finally {
    delete process.env.CALLS_BOT_SECRET;
    delete process.env.SOME_TOKEN;
  }
});

/** @param {number[]} statuses */
function fakeFetch(statuses) {
  /** @type {{ url: string, auth: string }[]} */
  const calls = [];
  const impl = /** @type {typeof fetch} */ (
    /** @type {unknown} */ (
      async (/** @type {string} */ url, /** @type {any} */ init) => {
        calls.push({ url, auth: init.headers.authorization });
        const status = statuses.length ? /** @type {number} */ (statuses.shift()) : 200;
        return new Response(null, { status });
      }
    )
  );
  return { impl, calls };
}

for (const status of [401, 403, 404, 409]) {
  test(`callback ${status} revokes the job without retrying`, async () => {
    const { impl, calls } = fakeFetch([status]);
    let revokedWith = 0;
    const cb = createCallbackClient('https://zerosoft.ai/api/calls/bot', 'tok_aaaaaaaaaaaaaaaa', 'j1', {
      fetchImpl: impl,
      sleep: async () => {},
      onRevoked: (s) => (revokedWith = s),
    });
    await assert.rejects(cb.putPart('video', 0, Buffer.from('x'), { 'content-type': 'video/mp4' }), RevokedError);
    assert.equal(revokedWith, status);
    assert.equal(calls.length, 1);
    assert.equal(cb.revoked, status);
    // Nothing else is sent afterwards.
    await assert.rejects(cb.complete({}), RevokedError);
    assert.equal(calls.length, 1);
  });
}

test('callback 500 retries, 400 does not revoke; token can be replaced', async () => {
  const { impl, calls } = fakeFetch([500, 502, 200, 400]);
  let revoked = false;
  const cb = createCallbackClient('https://zerosoft.ai/api/calls/bot', 'tok_old_aaaaaaaaaaaa', 'j1', {
    fetchImpl: impl,
    sleep: async () => {},
    onRevoked: () => (revoked = true),
  });
  await cb.complete({});
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://zerosoft.ai/api/calls/bot/jobs/j1/complete');
  cb.setToken('tok_new_bbbbbbbbbbbb');
  await assert.rejects(cb.event('joining'));
  assert.equal(calls[3].auth, 'Bearer tok_new_bbbbbbbbbbbb');
  assert.equal(revoked, false);
});

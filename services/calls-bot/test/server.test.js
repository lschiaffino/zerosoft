// HTTP surface without launching browsers: auth, limits, validation, capacity.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { signedHeaders } from '../lib/hmac.js';
import { createBot, loadConfig } from '../server.js';

const secret = 's'.repeat(64);
/** @type {ReturnType<typeof createBot>} */
let bot;
let base = '';

before(async () => {
  const config = loadConfig({
    CALLS_BOT_SECRET: secret,
    CALLS_ALLOWED_CALLBACK_ORIGINS: 'https://zerosoft.ai',
    CALLS_BOT_MAX_JOBS: '1',
    PORT: '1',
  });
  bot = createBot(config);
  await new Promise((r) => bot.server.listen(0, '127.0.0.1', () => r(undefined)));
  const addr = /** @type {import('node:net').AddressInfo} */ (bot.server.address());
  base = `http://127.0.0.1:${addr.port}`;
});
after(() => bot.server.close());

/** @param {string} method @param {string} path @param {string} [body] @param {boolean} [sign] */
function req(method, path, body = '', sign = true) {
  return fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(sign ? signedHeaders(secret, method, path.split('?')[0], body) : {}) },
    body: method === 'GET' || method === 'DELETE' ? undefined : body,
  });
}

test('health is public and minimal', async () => {
  const r = await fetch(`${base}/v1/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, version: '1', activeJobs: 0, maxJobs: 1 });
});

test('unsigned or badly signed requests get 401', async () => {
  assert.equal((await req('POST', '/v1/jobs', '{}', false)).status, 401);
  const r = await fetch(`${base}/v1/jobs`, {
    method: 'POST',
    headers: { ...signedHeaders('other'.repeat(10), 'POST', '/v1/jobs', '{}') },
    body: '{}',
  });
  assert.equal(r.status, 401);
  // A signature for another method or path is rejected.
  const getSig = signedHeaders(secret, 'GET', '/v1/jobs/abc', '');
  assert.equal((await fetch(`${base}/v1/jobs/abc`, { method: 'DELETE', headers: getSig })).status, 401);
  assert.equal((await fetch(`${base}/v1/jobs/xyz`, { method: 'GET', headers: getSig })).status, 401);
  assert.equal((await fetch(`${base}/v1/jobs/abc?x=1`, { method: 'GET', headers: getSig })).status, 404);
  assert.equal((await req('GET', '/v1/jobs/abc', '', false)).status, 401);
  assert.equal((await req('DELETE', '/v1/jobs/abc', '', false)).status, 401);
});

test('a replayed signature is rejected', async () => {
  const path = '/v1/jobs/replayme';
  const h = signedHeaders(secret, 'GET', path, '');
  assert.equal((await fetch(base + path, { headers: h })).status, 404);
  assert.equal((await fetch(base + path, { headers: h })).status, 401);
});

test('secret can come from CALLS_BOT_SECRET_FILE', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const p = await import('node:path');
  const dir = await fs.mkdtemp(p.join(os.tmpdir(), 'zs-secret-'));
  const f = p.join(dir, 's');
  await fs.writeFile(f, 'f'.repeat(64) + '\n', { mode: 0o600 });
  assert.equal(loadConfig({ CALLS_BOT_SECRET_FILE: f, CALLS_BOT_SECRET: 'env-secret' }).secret, 'f'.repeat(64));
  assert.equal(loadConfig({ CALLS_BOT_SECRET: 'env-secret' }).secret, 'env-secret');
  assert.equal(loadConfig({ CALLS_BOT_SECRET_FILE: p.join(dir, 'missing') }).secret, '');
  await fs.rm(dir, { recursive: true, force: true });
});

test('server limits', () => {
  assert.equal(bot.server.requestTimeout, 30000);
  assert.equal(bot.server.maxConnections, 64);
});

test('validation errors use the documented codes', async () => {
  const job = {
    jobId: 'c_test1',
    platform: 'meet',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    botName: 'zerosoft Notetaker',
    consentMessage: 'Recording',
    callbackUrl: 'https://zerosoft.ai/api/calls/bot',
    callbackToken: 'x'.repeat(20),
  };
  const send = async (/** @type {any} */ patch) => {
    const r = await req('POST', '/v1/jobs', JSON.stringify({ ...job, ...patch }));
    return [r.status, (await r.json()).error];
  };
  assert.deepEqual(await send({ platform: 'teams' }), [400, 'unsupported_platform']);
  assert.deepEqual(await send({ meetingUrl: 'http://169.254.169.254/' }), [400, 'invalid_meeting_url']);
  assert.deepEqual(await send({ callbackUrl: 'https://evil.example/api' }), [400, 'callback_not_allowed']);
  assert.deepEqual(await send({ jobId: 'bad id' }), [400, 'invalid_input']);
  const bad = await req('POST', '/v1/jobs', '{not json');
  assert.equal(bad.status, 400);
});

test('body limit returns 413', async () => {
  const body = JSON.stringify({ pad: 'x'.repeat(20000) });
  const r = await req('POST', '/v1/jobs', body);
  assert.equal(r.status, 413);
});

test('unknown job is 404, selftest and fake meet are off by default', async () => {
  assert.equal((await req('GET', '/v1/jobs/nope')).status, 404);
  assert.equal((await req('DELETE', '/v1/jobs/nope')).status, 404);
  assert.equal((await req('POST', '/v1/selftest', '{}')).status, 404);
  assert.equal((await fetch(`${base}/fake-meet/abc`)).status, 404);
});

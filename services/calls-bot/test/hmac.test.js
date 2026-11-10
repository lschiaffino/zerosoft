import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { rawPath, safeEqual, sign, signedHeaders, verify } from '../lib/hmac.js';

const secret = 'x'.repeat(64);
const now = 1_800_000_000_000;
const V = (/** @type {Record<string,string>} */ h, method, path, body, at = now) =>
  verify(secret, h['x-zs-timestamp'], h['x-zs-signature'], method, path, body, at);

test('sign matches the documented format', () => {
  const body = '{"a":1}';
  const expected = crypto.createHmac('sha256', secret).update(`1800000000.POST /v1/jobs.${body}`).digest('hex');
  assert.equal(sign(secret, 1800000000, 'POST', '/v1/jobs', body), `sha256=${expected}`);
  assert.equal(sign(secret, 1800000000, 'post', '/v1/jobs', body), `sha256=${expected}`);
});

test('verify accepts a fresh valid signature', () => {
  const h = signedHeaders(secret, 'POST', '/v1/jobs', 'hello', now);
  assert.deepEqual(V(h, 'POST', '/v1/jobs', 'hello'), { ok: true });
  assert.equal(V(h, 'POST', '/v1/jobs', Buffer.from('hello')).ok, true);
});

test('signature is bound to method and path (GET/DELETE with empty body)', () => {
  const h = signedHeaders(secret, 'GET', '/v1/jobs/A', '', now);
  assert.equal(V(h, 'GET', '/v1/jobs/A', '').ok, true);
  assert.equal(V(h, 'DELETE', '/v1/jobs/A', '').ok, false);
  assert.equal(V(h, 'GET', '/v1/jobs/B', '').ok, false);
});

test('old format (ts.body only) is rejected', () => {
  const ts = String(Math.floor(now / 1000));
  const old = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.hello`).digest('hex');
  assert.equal(verify(secret, ts, old, 'POST', '/v1/jobs', 'hello', now).ok, false);
});

test('verify rejects tampered body, wrong secret, bad formats', () => {
  const h = signedHeaders(secret, 'POST', '/v1/jobs', 'hello', now);
  const ts = h['x-zs-timestamp'];
  const sig = h['x-zs-signature'];
  assert.equal(V(h, 'POST', '/v1/jobs', 'hellO').ok, false);
  assert.equal(verify('y'.repeat(64), ts, sig, 'POST', '/v1/jobs', 'hello', now).ok, false);
  assert.equal(verify(secret, undefined, sig, 'POST', '/v1/jobs', 'hello', now).ok, false);
  assert.equal(verify(secret, ts, undefined, 'POST', '/v1/jobs', 'hello', now).ok, false);
  assert.equal(verify(secret, '12a', sig, 'POST', '/v1/jobs', 'hello', now).ok, false);
  assert.equal(verify(secret, ts, 'sha256=abc', 'POST', '/v1/jobs', 'hello', now).ok, false);
  assert.equal(verify(secret, ts, sig.replace('sha256=', 'sha1='), 'POST', '/v1/jobs', 'hello', now).ok, false);
  assert.equal(verify('', ts, sig, 'POST', '/v1/jobs', 'hello', now).ok, false);
});

test('verify enforces the 5 minute window both ways', () => {
  const old = signedHeaders(secret, 'POST', '/p', 'b', now - 301_000);
  assert.deepEqual(V(old, 'POST', '/p', 'b'), { ok: false, reason: 'stale' });
  const future = signedHeaders(secret, 'POST', '/p', 'b', now + 301_000);
  assert.equal(V(future, 'POST', '/p', 'b').ok, false);
  const edge = signedHeaders(secret, 'POST', '/p', 'b', now - 299_000);
  assert.equal(V(edge, 'POST', '/p', 'b').ok, true);
});

test('rawPath drops the query and keeps the path as sent', () => {
  assert.equal(rawPath('/v1/jobs?x=1'), '/v1/jobs');
  assert.equal(rawPath('/v1/jobs/call_abc'), '/v1/jobs/call_abc');
  assert.equal(rawPath('/v1/jobs/a%20b?z'), '/v1/jobs/a%20b');
  assert.equal(rawPath(undefined), '/');
});

test('safeEqual', () => {
  assert.equal(safeEqual('Bearer abc', 'Bearer abc'), true);
  assert.equal(safeEqual('Bearer abc', 'Bearer abd'), false);
  assert.equal(safeEqual('Bearer abc', 'Bearer abcd'), false);
});

// HMAC signing for app -> bot requests (see docs/calls-bot.md).
//   x-zs-timestamp: <unix seconds>
//   x-zs-signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<METHOD> <path>.<raw body>")>
// <path> is the request pathname without query; METHOD in upper case. A
// captured signature is useless for another method, path or job.
import crypto from 'node:crypto';

export const SKEW_SEC = 300;
export const TS_HEADER = 'x-zs-timestamp';
export const SIG_HEADER = 'x-zs-signature';

/**
 * @param {string} secret
 * @param {string|number} ts
 * @param {string} method
 * @param {string} path pathname without query
 * @param {string|Buffer} body
 */
export function sign(secret, ts, method, path, body) {
  const h = crypto.createHmac('sha256', secret);
  h.update(`${ts}.${String(method).toUpperCase()} ${path}.`);
  h.update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body);
  return 'sha256=' + h.digest('hex');
}

/**
 * Headers for a signed request.
 * @param {string} secret
 * @param {string} method
 * @param {string} path pathname without query
 * @param {string|Buffer} body
 * @param {number} [nowMs]
 */
export function signedHeaders(secret, method, path, body, nowMs = Date.now()) {
  const ts = Math.floor(nowMs / 1000);
  return { [TS_HEADER]: String(ts), [SIG_HEADER]: sign(secret, ts, method, path, body) };
}

/**
 * Raw pathname of a request URL (no query, not decoded).
 * @param {string|undefined} rawUrl
 */
export function rawPath(rawUrl) {
  const s = String(rawUrl || '/');
  const q = s.indexOf('?');
  return q >= 0 ? s.slice(0, q) : s;
}

/**
 * Timing-safe verification with a +-5 minute window.
 * @param {string} secret
 * @param {string|undefined|string[]} tsHeader
 * @param {string|undefined|string[]} sigHeader
 * @param {string} method
 * @param {string} path
 * @param {string|Buffer} body
 * @param {number} [nowMs]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verify(secret, tsHeader, sigHeader, method, path, body, nowMs = Date.now()) {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (typeof tsHeader !== 'string' || typeof sigHeader !== 'string') return { ok: false, reason: 'missing' };
  if (!/^\d{1,12}$/.test(tsHeader)) return { ok: false, reason: 'bad_timestamp' };
  const ts = Number(tsHeader);
  if (Math.abs(nowMs / 1000 - ts) > SKEW_SEC) return { ok: false, reason: 'stale' };
  if (!/^sha256=[0-9a-f]{64}$/i.test(sigHeader)) return { ok: false, reason: 'bad_signature' };
  const expected = Buffer.from(sign(secret, tsHeader, method, path, body).slice(7), 'hex');
  const given = Buffer.from(sigHeader.slice(7).toLowerCase(), 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

/**
 * Remembers valid signatures for `ttlMs` (longer than the timestamp window),
 * so a captured request can't be replayed. Bounded in size.
 */
export class ReplayCache {
  /** @param {number} ttlMs @param {number} [max] */
  constructor(ttlMs, max = 50000) {
    this.ttlMs = ttlMs;
    this.max = max;
    /** @type {Map<string, number>} signature -> expiry */
    this.map = new Map();
  }

  /**
   * True the first time a signature is seen, false on a repeat.
   * @param {string} sig
   * @param {number} [nowMs]
   */
  firstUse(sig, nowMs = Date.now()) {
    for (const [k, exp] of this.map) {
      if (exp > nowMs) break; // insertion order = expiry order
      this.map.delete(k);
    }
    const exp = this.map.get(sig);
    if (exp !== undefined && exp > nowMs) return false;
    if (this.map.size >= this.max) this.map.delete(/** @type {string} */ (this.map.keys().next().value));
    this.map.set(sig, nowMs + this.ttlMs);
    return true;
  }
}

/**
 * Timing-safe string compare (for bearer tokens).
 * @param {string} a
 * @param {string} b
 */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a).length === String(b).length;
}

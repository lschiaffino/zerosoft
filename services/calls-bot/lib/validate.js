// Input validation for jobs: meeting URLs, callback origins and fields.
import { SUPPORTED_PLATFORMS } from '../platforms/index.js';

const MEET_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const FAKE_PATH = /^\/fake-meet\/[a-z0-9-]{1,40}$/;
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Parses CALLS_ALLOWED_CALLBACK_ORIGINS into a set of exact https origins.
 * Entries that are not plain https origins are dropped.
 * @param {string} str
 * @returns {Set<string>}
 */
export function parseOrigins(str) {
  const out = new Set();
  for (const raw of String(str || '').split(',')) {
    const s = raw.trim();
    if (!s) continue;
    let u;
    try {
      u = new URL(s);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || u.username || u.password) continue;
    if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) continue;
    out.add(u.origin);
  }
  return out;
}

/** @param {string} host */
export function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

/**
 * The callback base URL must be on an allowlisted origin (exact match), https,
 * without credentials, query or fragment. In fake mode, plain http loopback
 * origins are also accepted (the self-test receiver).
 * @param {unknown} str
 * @param {Set<string>} origins
 * @param {{ fakeMode?: boolean }} [opts]
 * @returns {string|null} normalized base URL without trailing slash
 */
export function checkCallbackUrl(str, origins, opts = {}) {
  if (typeof str !== 'string' || str.length > 512) return null;
  let u;
  try {
    u = new URL(str);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  const loopbackHttp = opts.fakeMode && u.protocol === 'http:' && isLoopbackHost(u.hostname);
  if (!loopbackHttp) {
    if (u.protocol !== 'https:') return null;
    if (!origins.has(u.origin)) return null;
  }
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/**
 * Strict meeting URL allowlist. Only https://meet.google.com/xxx-xxxx-xxx
 * (optional query). In fake mode also this server's own /fake-meet/<code>.
 * @param {unknown} str
 * @param {string} platform
 * @param {{ fakeOrigin?: string|null }} [opts]
 * @returns {string|null} normalized URL
 */
export function checkMeetingUrl(str, platform, opts = {}) {
  if (typeof str !== 'string' || str.length > 1024) return null;
  let u;
  try {
    u = new URL(str);
  } catch {
    return null;
  }
  if (u.username || u.password || u.hash) return null;
  if (opts.fakeOrigin && u.origin === opts.fakeOrigin && FAKE_PATH.test(u.pathname)) return u.href;
  if (platform !== 'meet') return null;
  if (u.protocol !== 'https:' || u.hostname !== 'meet.google.com' || u.port !== '') return null;
  if (!MEET_PATH.test(u.pathname)) return null;
  return u.href;
}

/** @param {unknown} v @param {number} min @param {number} max @param {number} def */
function intIn(v, min, max, def) {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return NaN;
  return v;
}

/** @param {string} s */
function clean(s) {
  // Drop control characters; keep normal text and newlines in messages.
  return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
}

/** @param {unknown} id */
export function isJobId(id) {
  return typeof id === 'string' && JOB_ID.test(id);
}

/**
 * @typedef {{
 *   jobId: string, platform: string, meetingUrl: string, botName: string,
 *   consentMessage: string, callbackUrl: string, callbackToken: string,
 *   maxDurationSec: number, lobbyTimeoutSec: number, aloneTimeoutSec: number
 * }} JobSpec
 */

/**
 * @param {any} body
 * @param {{ origins: Set<string>, fakeMode?: boolean, fakeOrigin?: string|null }} ctx
 * @returns {{ ok: true, spec: JobSpec } | { ok: false, error: string }}
 */
export function validateJob(body, ctx) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_input' };
  if (!isJobId(body.jobId)) return { ok: false, error: 'invalid_input' };
  if (typeof body.platform !== 'string' || body.platform.length > 32) return { ok: false, error: 'invalid_input' };
  if (!SUPPORTED_PLATFORMS.includes(body.platform)) return { ok: false, error: 'unsupported_platform' };
  const botName = typeof body.botName === 'string' ? clean(body.botName).slice(0, 64) : '';
  const consentMessage =
    typeof body.consentMessage === 'string' ? clean(body.consentMessage).slice(0, 1000) : '';
  if (!botName || !consentMessage) return { ok: false, error: 'invalid_input' };
  const tok = body.callbackToken;
  if (typeof tok !== 'string' || tok.length < 16 || tok.length > 512 || /[\s\u0000-\u001f]/.test(tok)) {
    return { ok: false, error: 'invalid_input' };
  }
  const maxDurationSec = intIn(body.maxDurationSec, 10, 6 * 3600, 10800);
  const lobbyTimeoutSec = intIn(body.lobbyTimeoutSec, 10, 3600, 600);
  const aloneTimeoutSec = intIn(body.aloneTimeoutSec, 10, 3600, 120);
  if ([maxDurationSec, lobbyTimeoutSec, aloneTimeoutSec].some(Number.isNaN)) {
    return { ok: false, error: 'invalid_input' };
  }
  const meetingUrl = checkMeetingUrl(body.meetingUrl, body.platform, { fakeOrigin: ctx.fakeOrigin });
  if (!meetingUrl) return { ok: false, error: 'invalid_meeting_url' };
  const callbackUrl = checkCallbackUrl(body.callbackUrl, ctx.origins, { fakeMode: ctx.fakeMode });
  if (!callbackUrl) return { ok: false, error: 'callback_not_allowed' };
  return {
    ok: true,
    spec: {
      jobId: body.jobId,
      platform: body.platform,
      meetingUrl,
      botName,
      consentMessage,
      callbackUrl,
      callbackToken: tok,
      maxDurationSec,
      lobbyTimeoutSec,
      aloneTimeoutSec,
    },
  };
}

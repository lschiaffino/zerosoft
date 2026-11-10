// Bot -> app client: events, parts and complete. The token lives only in this
// object's closure and is never logged. Redirects are refused so the token
// can't be forwarded to another origin.
//
// 401/403/404/409 from the app mean the job was cut or deleted on its side:
// `onRevoked` fires so the job stops at once and discards what it has.
import { HttpError, withRetry } from './retry.js';

export const REVOKED_STATUSES = new Set([401, 403, 404, 409]);

/** Error thrown once the app has revoked the job. */
export class RevokedError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`revoked_${status}`);
    this.name = 'RevokedError';
    this.status = status;
    this.retryable = false;
  }
}

/**
 * @param {string} baseUrl validated callback base (no trailing slash)
 * @param {string} token
 * @param {string} jobId
 * @param {{ retries?: number, baseMs?: number, onRevoked?: (status: number) => void, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void> }} [opts]
 */
export function createCallbackClient(baseUrl, token, jobId, opts = {}) {
  const root = `${baseUrl}/jobs/${encodeURIComponent(jobId)}`;
  let auth = `Bearer ${token}`;
  let revoked = 0;
  const doFetch = opts.fetchImpl ?? fetch;

  /**
   * @param {string} method
   * @param {string} path
   * @param {Buffer|string} body
   * @param {Record<string, string>} headers
   * @param {number} timeoutMs
   */
  async function send(method, path, body, headers, timeoutMs) {
    if (revoked) throw new RevokedError(revoked);
    const res = await doFetch(root + path, {
      method,
      body,
      headers: { authorization: auth, ...headers },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Drain the body so the connection can be reused.
    await res.arrayBuffer().catch(() => {});
    if (REVOKED_STATUSES.has(res.status)) {
      if (!revoked) {
        revoked = res.status;
        opts.onRevoked?.(res.status);
      }
      throw new RevokedError(res.status);
    }
    if (!res.ok) throw new HttpError(res.status);
  }

  const retryOpts = { retries: opts.retries ?? 5, baseMs: opts.baseMs ?? 1000, sleep: opts.sleep };

  return {
    get revoked() {
      return revoked;
    },
    /** Replaces the bearer token (same job re-posted with a new token). @param {string} t */
    setToken(t) {
      auth = `Bearer ${t}`;
    },
    /**
     * @param {string} type
     * @param {{ at?: string, detail?: object, participants?: { name: string }[] }} [extra]
     */
    event(type, extra = {}) {
      const payload = { type, at: extra.at ?? new Date().toISOString() };
      if (extra.detail) Object.assign(payload, { detail: extra.detail });
      if (extra.participants) Object.assign(payload, { participants: extra.participants });
      const body = JSON.stringify(payload);
      return withRetry(
        () => send('POST', '/events', body, { 'content-type': 'application/json' }, 15000),
        { ...retryOpts, retries: Math.min(3, retryOpts.retries) },
      );
    },
    /**
     * @param {'video'|'audio'} kind
     * @param {number} n
     * @param {Buffer} buf
     * @param {Record<string, string>} headers must include content-type
     */
    putPart(kind, n, buf, headers) {
      return withRetry(() => send('PUT', `/parts/${kind}/${n}`, buf, headers, 120000), retryOpts);
    },
    /** @param {object} payload */
    complete(payload) {
      const body = JSON.stringify(payload);
      return withRetry(
        () => send('POST', '/complete', body, { 'content-type': 'application/json' }, 30000),
        retryOpts,
      );
    },
  };
}

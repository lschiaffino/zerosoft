// Retries with exponential backoff. 4xx is final; 5xx and network errors retry.

export class HttpError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`http_${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** @param {unknown} err */
export function isRetryable(err) {
  if (err instanceof HttpError) return err.status >= 500;
  if (err && typeof err === 'object' && /** @type {any} */ (err).retryable === false) return false;
  return true; // network errors, timeouts
}

/**
 * Delay before retry number `attempt` (0-based): base * 2^attempt, capped,
 * with up to 25% jitter.
 * @param {number} attempt
 * @param {{ baseMs?: number, maxMs?: number, random?: () => number }} [opts]
 */
export function backoffDelay(attempt, opts = {}) {
  const base = opts.baseMs ?? 1000;
  const max = opts.maxMs ?? 30000;
  const rnd = opts.random ?? Math.random;
  const d = Math.min(max, base * 2 ** attempt);
  return Math.round(d * (0.75 + 0.25 * rnd()));
}

/**
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{ retries?: number, baseMs?: number, maxMs?: number, sleep?: (ms: number) => Promise<void>, random?: () => number }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 5;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      await sleep(backoffDelay(attempt, opts));
    }
  }
}

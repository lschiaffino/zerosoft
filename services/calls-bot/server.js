// zerosoft calls bot: HTTP API (see docs/calls-bot.md).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleFakeMeet } from './fake-meet/handler.js';
import { Job } from './job.js';
import { ReplayCache, SIG_HEADER, TS_HEADER, rawPath, verify } from './lib/hmac.js';
import { errInfo, log } from './lib/log.js';
import { isJobId, parseOrigins, validateJob } from './lib/validate.js';

const VERSION = '1';
const BODY_LIMIT = 16 * 1024;
const KEEP_FINISHED_MS = 24 * 3600 * 1000;

/** @param {string|undefined} v @param {number} min @param {number} max @param {number} def */
function intEnv(v, min, max, def) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

/**
 * The secret comes from CALLS_BOT_SECRET_FILE when set, else CALLS_BOT_SECRET.
 * @param {NodeJS.ProcessEnv} env
 */
export function readSecret(env) {
  if (env.CALLS_BOT_SECRET_FILE) {
    try {
      return fs.readFileSync(env.CALLS_BOT_SECRET_FILE, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return (env.CALLS_BOT_SECRET || '').trim();
}

export function loadConfig(env = process.env) {
  return {
    port: intEnv(env.PORT, 1, 65535, 8080),
    secret: readSecret(env),
    origins: parseOrigins(env.CALLS_ALLOWED_CALLBACK_ORIGINS || ''),
    maxJobs: intEnv(env.CALLS_BOT_MAX_JOBS, 1, 16, 2),
    fakeMeet: env.CALLS_BOT_FAKE_MEET === '1',
    dev: env.CALLS_BOT_DEV_HEADLESS === '1',
    segmentSec: intEnv(env.CALLS_BOT_SEGMENT_SEC, 5, 600, 600),
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
    ffprobe: env.FFPROBE_PATH || 'ffprobe',
    chromiumSandbox: env.CALLS_BOT_CHROMIUM_SANDBOX === '1',
    tmpRoot: env.CALLS_BOT_TMP || path.join(os.tmpdir(), 'zs-calls-bot'),
  };
}

class BodyTooLarge extends Error {}

/**
 * @param {http.IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      reject(new BodyTooLarge());
      req.resume();
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(s),
  });
  res.end(s);
}

/**
 * @param {ReturnType<typeof loadConfig>} config
 */
export function createBot(config) {
  /** @type {Map<string, Job>} */
  const jobs = new Map();
  let selftestRunning = false;
  const fakeOrigin = config.fakeMeet ? `http://127.0.0.1:${config.port}` : null;

  const activeCount = () => [...jobs.values()].filter((j) => j.active).length;

  const prune = () => {
    const now = Date.now();
    for (const [id, j] of jobs) if (!j.active && j.endedAt && now - j.endedAt > KEEP_FINISHED_MS) jobs.delete(id);
  };
  const pruneTimer = setInterval(prune, 10 * 60 * 1000);
  pruneTimer.unref();

  /**
   * @param {http.IncomingMessage} req
   * @param {Buffer} body
   */
  const seen = new ReplayCache(10 * 60 * 1000);
  const signed = (req, body) =>
    verify(
      config.secret,
      req.headers[TS_HEADER],
      req.headers[SIG_HEADER],
      String(req.method || ''),
      rawPath(req.url),
      body,
    ).ok && seen.firstUse(String(req.headers[SIG_HEADER]));

  /** @type {http.RequestListener} */
  async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return json(res, 400, { error: 'invalid_input' });
    }
    const p = url.pathname;
    try {
      if (p === '/v1/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, version: VERSION, activeJobs: activeCount(), maxJobs: config.maxJobs });
      }

      if (p === '/v1/jobs' && req.method === 'POST') {
        const body = await readBody(req, BODY_LIMIT);
        if (!signed(req, body)) return json(res, 401, { error: 'unauthorized' });
        let parsed;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          return json(res, 400, { error: 'invalid_input' });
        }
        const v = validateJob(parsed, { origins: config.origins, fakeMode: config.fakeMeet, fakeOrigin });
        // Idempotent: a known jobId (running or finished) is acknowledged as is;
        // a running one adopts the new callback token if it changed.
        const existing = parsed && isJobId(parsed.jobId) ? jobs.get(parsed.jobId) : undefined;
        if (existing) {
          if (v.ok) existing.replaceToken(v.spec.callbackToken);
          return json(res, 202, { accepted: true });
        }
        if (!v.ok) {
          log('warn', 'job_rejected', { error: v.error });
          return json(res, 400, { error: v.error });
        }
        if (activeCount() >= config.maxJobs) return json(res, 503, { error: 'at_capacity' });
        const job = new Job(v.spec, {
          ffmpeg: config.ffmpeg,
          dev: config.dev,
          segmentSec: config.segmentSec,
          tmpRoot: config.tmpRoot,
          chromiumSandbox: config.chromiumSandbox,
          fakeOrigin,
        });
        jobs.set(job.jobId, job);
        log('info', 'job_accepted', { jobId: job.jobId, platform: v.spec.platform });
        job.start();
        return json(res, 202, { accepted: true });
      }

      const m = /^\/v1\/jobs\/([^/]+)$/.exec(p);
      if (m && (req.method === 'GET' || req.method === 'DELETE')) {
        const body = await readBody(req, BODY_LIMIT);
        if (!signed(req, body)) return json(res, 401, { error: 'unauthorized' });
        const id = decodeURIComponent(m[1]);
        const job = isJobId(id) ? jobs.get(id) : undefined;
        if (!job) return json(res, 404, { error: 'not_found' });
        if (req.method === 'GET') return json(res, 200, job.publicView());
        job.stop('stopped');
        log('info', 'job_stop_requested', { jobId: job.jobId });
        return json(res, 200, { ok: true });
      }

      if (p === '/v1/selftest' && req.method === 'POST') {
        // Only with the fake meeting on AND a valid signature.
        if (!config.fakeMeet) return json(res, 404, { error: 'not_found' });
        const body = await readBody(req, BODY_LIMIT);
        if (!signed(req, body)) return json(res, 401, { error: 'unauthorized' });
        if (selftestRunning) return json(res, 409, { error: 'selftest_running' });
        let endsSec = 25;
        try {
          const b = JSON.parse(body.toString('utf8') || '{}');
          if (Number.isInteger(b.endsSec) && b.endsSec >= 12 && b.endsSec <= 300) endsSec = b.endsSec;
        } catch {}
        selftestRunning = true;
        try {
          const { runSelftest } = await import('./lib/selftest-run.js');
          const result = await runSelftest({
            botBase: /** @type {string} */ (fakeOrigin),
            secret: config.secret,
            ffmpeg: config.ffmpeg,
            ffprobe: config.ffprobe,
            endsSec,
          });
          return json(res, 200, result);
        } finally {
          selftestRunning = false;
        }
      }

      if (config.fakeMeet && p.startsWith('/fake-meet/')) {
        if (await handleFakeMeet(req, res, url, readBody)) return;
      }

      return json(res, 404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof BodyTooLarge) return json(res, 413, { error: 'too_large' });
      log('error', 'request_failed', { path: p.startsWith('/v1/jobs/') ? '/v1/jobs/:id' : p, ...errInfo(e) });
      if (!res.headersSent) return json(res, 500, { error: 'internal' });
      res.end();
    }
  }

  const server = http.createServer(handler);
  // requestTimeout bounds receiving the request (headers + body), not the
  // response, so the long-running /v1/selftest response is unaffected.
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 100;
  return { server, jobs, activeCount };
}

async function main() {
  const config = loadConfig();
  // Keep the secret only in memory: children get a minimal env anyway.
  delete process.env.CALLS_BOT_SECRET;
  delete process.env.CALLS_BOT_SECRET_FILE;
  if (config.secret.length < 32) {
    log('error', 'CALLS_BOT_SECRET missing or shorter than 32 characters');
    process.exit(1);
  }
  if (!config.origins.size && !config.fakeMeet) log('warn', 'no_callback_origins_allowed');
  const { server, jobs } = createBot(config);
  server.listen(config.port, () => {
    log('info', 'listening', {
      port: config.port,
      maxJobs: config.maxJobs,
      origins: config.origins.size,
      fakeMeet: config.fakeMeet,
      dev: config.dev,
    });
  });
  let shuttingDown = false;
  const shutdown = async (/** @type {string} */ sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown', { signal: sig });
    server.close();
    const running = [...jobs.values()].filter((j) => j.active);
    for (const j of running) j.stop('stopped');
    await Promise.race([Promise.all(running.map((j) => j.done)), new Promise((r) => setTimeout(r, 120000))]);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

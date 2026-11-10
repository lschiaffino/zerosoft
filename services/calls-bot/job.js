// Lifecycle of one recording job (see docs/calls-bot.md, "Ciclo de un trabajo").
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { RevokedError, createCallbackClient } from './lib/callback.js';
import { errInfo, log } from './lib/log.js';
import { allowRequest } from './lib/netpolicy.js';
import { planParts, readPart } from './lib/parts.js';
import { childEnv } from './lib/proc.js';
import { Recorder, createSink, startXvfb } from './lib/recorder.js';
import { CaptionLog, coalesceSpeakers } from './lib/timeline.js';
import { getAdapter } from './platforms/index.js';

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const MAX_CONSENT_REPEATS = 10;

/** 1 second of 16-bit mono silence, used as the fake microphone. */
function silenceWav() {
  const rate = 16000;
  const data = Buffer.alloc(rate * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Error with a `failed` reason. */
class JobError extends Error {
  /** @param {string} reason @param {string} [msg] */
  constructor(reason, msg) {
    super(msg || reason);
    this.reason = reason;
  }
}

/** The app revoked the job (401/403/404/409 on a callback): discard everything. */
class CancelledError extends Error {}

/**
 * @typedef {{
 *   ffmpeg: string, dev: boolean, segmentSec: number, tmpRoot: string,
 *   chromiumSandbox: boolean, fakeOrigin: string|null,
 * }} JobContext
 */

export class Job {
  /**
   * @param {import('./lib/validate.js').JobSpec} spec
   * @param {JobContext} ctx
   */
  constructor(spec, ctx) {
    this.jobId = spec.jobId;
    this.ctx = ctx;
    this.state = 'queued';
    this.startedAt = new Date().toISOString();
    /** @type {string|null} */
    this.error = null;
    /** @type {string|null} */
    this.stopReason = null;
    this.revoked = false;
    this.endedAt = 0;
    // The token is captured by the client closure only; the spec copy is dropped.
    this.cb = createCallbackClient(spec.callbackUrl, spec.callbackToken, spec.jobId, {
      onRevoked: (status) => {
        this.revoked = true;
        this.stop('revoked');
        log('warn', 'job_revoked_by_app', { jobId: this.jobId, status });
      },
    });
    this.spec = { ...spec, callbackToken: '', callbackUrl: '' };
    /** @type {Promise<void>} */
    this.done = Promise.resolve();
  }

  get active() {
    return !TERMINAL.has(this.state);
  }

  publicView() {
    return { jobId: this.jobId, state: this.state, startedAt: this.startedAt, error: this.error };
  }

  /** @param {string} [reason] */
  stop(reason = 'stopped') {
    if (!this.stopReason) this.stopReason = reason;
  }

  /** Same job posted again with another token: use the new one. @param {string} token */
  replaceToken(token) {
    if (this.cb && this.active) this.cb.setToken(token);
  }

  start() {
    this.done = this.run().catch((e) => log('error', 'job_crashed', { jobId: this.jobId, ...errInfo(e) }));
    return this;
  }

  /** @param {string} s */
  setState(s) {
    this.state = s;
    log('info', 'job_state', { jobId: this.jobId, state: s });
  }

  /**
   * Sends an event; failures are logged, never fatal (a revocation stops the job).
   * @param {string} type
   * @param {Parameters<ReturnType<typeof createCallbackClient>['event']>[1]} [extra]
   */
  async emit(type, extra) {
    if (this.revoked || !this.cb) return;
    try {
      await this.cb.event(type, extra);
    } catch (e) {
      if (!(e instanceof RevokedError)) log('warn', 'event_failed', { jobId: this.jobId, type, ...errInfo(e) });
    }
  }

  checkRevoked() {
    if (this.revoked) throw new CancelledError('revoked');
  }

  async run() {
    const { spec, ctx } = this;
    const adapter = getAdapter(spec.platform);
    /** @type {(() => Promise<unknown>)[]} */
    const cleanup = [];
    /** @type {string|null} */
    let failReason = null;
    let cancelled = false;
    /** @type {Recorder|null} */
    let recorder = null;
    let dir = '';
    try {
      await fsp.mkdir(ctx.tmpRoot, { recursive: true, mode: 0o700 });
      dir = await fsp.mkdtemp(path.join(ctx.tmpRoot, `${this.jobId}-`));
      await fsp.chmod(dir, 0o700);
      cleanup.push(() => fsp.rm(dir, { recursive: true, force: true }));

      this.setState('joining');
      await this.emit('joining');
      this.checkRevoked();

      /** @type {string|null} */
      let display = null;
      /** @type {string|null} */
      let xauthority = null;
      /** @type {string|null} */
      let sink = null;
      if (!ctx.dev) {
        const x = await startXvfb(dir);
        cleanup.push(x.stop);
        display = x.display;
        xauthority = x.xauthority;
        const s = await createSink(`zs_${crypto.randomBytes(6).toString('hex')}`);
        cleanup.push(s.stop);
        sink = s.sink;
      }

      const fakeMic = path.join(dir, 'silence.wav');
      await fsp.writeFile(fakeMic, silenceWav(), { mode: 0o600 });

      const { chromium } = await import('playwright-core');
      const args = [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${fakeMic}`,
        '--autoplay-policy=no-user-gesture-required',
        '--disable-dev-shm-usage',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=Translate,MediaRouter,OptimizationHints',
        '--no-first-run',
        '--no-default-browser-check',
        '--password-store=basic',
        '--lang=en-US',
      ];
      if (!ctx.dev) args.push('--kiosk', '--window-position=0,0', '--window-size=1280,720');
      const browser = await chromium.launch({
        headless: ctx.dev,
        chromiumSandbox: ctx.chromiumSandbox,
        args,
        // Minimal env: no secrets reach the browser.
        env: childEnv({
          DISPLAY: display || undefined,
          XAUTHORITY: xauthority || undefined,
          PULSE_SINK: sink || undefined,
        }),
        timeout: 60000,
      });
      cleanup.push(() => browser.close().catch(() => {}));
      const context = await browser.newContext({
        locale: 'en-US',
        viewport: ctx.dev ? { width: 1280, height: 720 } : null,
        acceptDownloads: false,
        // Service workers would bypass request routing below.
        serviceWorkers: 'block',
      });

      // Network policy: frames only navigate to Google hosts Meet needs; other
      // requests only https to public hosts (fake meeting origin in fake mode).
      let navViolation = false;
      /** @type {import('playwright-core').Page|null} */
      let mainPage = null;
      await context.route('**/*', (route) => {
        const req = route.request();
        const isNavigation = req.isNavigationRequest();
        if (allowRequest(req.url(), { isNavigation, fakeOrigin: ctx.fakeOrigin })) return route.continue();
        try {
          if (isNavigation && mainPage && req.frame() === mainPage.mainFrame()) navViolation = true;
        } catch {}
        log('warn', 'request_blocked', { jobId: this.jobId, navigation: isNavigation });
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      mainPage = page;
      // Popups and new tabs are closed right away.
      context.on('page', (p) => {
        if (p !== page) p.close().catch(() => {});
      });
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        const url = frame.url();
        if (url === 'about:blank') return;
        if (!allowRequest(url, { isNavigation: true, fakeOrigin: ctx.fakeOrigin })) {
          navViolation = true;
          log('warn', 'navigation_blocked', { jobId: this.jobId });
          page.close().catch(() => {});
        }
      });
      const guard = () => {
        this.checkRevoked();
        if (navViolation) throw new JobError('join_error', 'navigation_blocked');
      };

      try {
        await page.goto(spec.meetingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (e) {
        guard();
        throw new JobError('join_error', 'goto_failed');
      }
      guard();

      const shouldStop = () => !!this.stopReason;
      const joinRes = await adapter.join(page, { botName: spec.botName, timeoutMs: 90000, shouldStop });
      guard();
      if (joinRes === 'stopped') {
        await this.emit('left', { detail: { reason: 'stopped' } });
        this.setState('done');
        return;
      }
      if (joinRes === 'asked') {
        this.setState('waiting_room');
        await this.emit('waiting_room');
      }
      const adm = await adapter.waitAdmitted(page, spec.lobbyTimeoutSec * 1000, { shouldStop });
      guard();
      if (adm === 'stopped') {
        await adapter.leave(page).catch(() => {});
        await this.emit('left', { detail: { reason: 'stopped' } });
        this.setState('done');
        return;
      }
      if (adm === 'denied') throw new JobError('denied');
      if (adm === 'timeout') throw new JobError('lobby_timeout');
      if (adm === 'ended') throw new JobError('invalid_meeting', 'ended_before_admission');

      this.setState('in_call');
      await this.emit('in_call');
      guard();

      // No consent notice in the chat, no recording.
      let consentSent = false;
      for (let i = 0; i < 3 && !consentSent; i++) {
        try {
          await adapter.sendChat(page, spec.consentMessage);
          consentSent = true;
        } catch (e) {
          log('warn', 'consent_chat_failed', { jobId: this.jobId, attempt: i + 1, ...errInfo(e) });
          await sleep(1500);
        }
      }
      if (!consentSent) {
        await adapter.leave(page).catch(() => {});
        throw new JobError('consent_not_sent');
      }
      guard();
      const captionsOn = await adapter.enableCaptions(page).catch(() => false);

      recorder = new Recorder({
        dir,
        ffmpeg: ctx.ffmpeg,
        display,
        xauthority,
        sink,
        dev: ctx.dev,
        segmentSec: ctx.segmentSec,
      });
      cleanup.push(() => /** @type {Recorder} */ (recorder).kill());
      try {
        await recorder.start();
      } catch (e) {
        throw new JobError('record_error', /** @type {Error} */ (e).message);
      }
      const t0 = recorder.t0;
      this.setState('recording');
      await this.emit('recording', { at: new Date(t0).toISOString(), detail: { consentSent, captions: captionsOn } });

      const captions = new CaptionLog();
      /** @type {{ name: string, t: number }[]} */
      const samples = [];
      /** @type {Map<string, string>} */
      const everyone = new Map();
      /** Names already told about the recording (null until the first read). */
      /** @type {Set<string>|null} */
      let notified = null;
      let consentRepeats = 0;
      let lastParticipants = '';
      const uploaded = new Set();
      /** @type {unknown} */
      let audioUploadError = null;
      let uploadChain = Promise.resolve();
      const uploadSegments = () => {
        uploadChain = uploadChain.then(async () => {
          if (audioUploadError || !recorder || this.revoked) return;
          for (const seg of await recorder.completedSegments()) {
            if (uploaded.has(seg.n)) continue;
            try {
              await this.uploadSegment(seg);
              uploaded.add(seg.n);
            } catch (e) {
              audioUploadError = e;
              if (!(e instanceof RevokedError)) {
                log('error', 'audio_upload_failed', { jobId: this.jobId, n: seg.n, ...errInfo(e) });
              }
              return;
            }
          }
        });
        return uploadChain;
      };

      /** @type {string|null} */
      let leftReason = null;
      let aloneSince = 0;
      let notInCall = 0;
      let lastSegCheck = Date.now();
      const maxEnd = t0 + spec.maxDurationSec * 1000;
      while (!leftReason) {
        if (this.stopReason) {
          leftReason = this.stopReason;
          break;
        }
        if (Date.now() >= maxEnd) {
          leftReason = 'max_duration';
          break;
        }
        if (navViolation || page.isClosed()) {
          leftReason = 'meeting_ended';
          break;
        }
        let st;
        try {
          st = await adapter.readState(page, { botName: spec.botName });
        } catch (e) {
          if (page.isClosed()) {
            leftReason = 'meeting_ended';
            break;
          }
          log('warn', 'read_state_failed', { jobId: this.jobId, ...errInfo(e) });
          await sleep(1000);
          continue;
        }
        for (const c of st.captions) captions.add({ ...c, t: c.t - t0 });
        for (const s of st.samples) if (samples.length < 200000) samples.push({ name: s.name, t: s.t - t0 });
        for (const p of st.participants) everyone.set(p.name, p.name);

        // Repeat the notice once for each newcomer (capped).
        const names = st.participants.map((p) => p.name);
        if (!notified) notified = new Set(names);
        else {
          const fresh = names.filter((n) => !notified?.has(n));
          if (fresh.length) {
            for (const n of fresh) notified.add(n);
            if (consentRepeats < MAX_CONSENT_REPEATS) {
              consentRepeats++;
              await adapter
                .sendChat(page, spec.consentMessage)
                .catch((e) => log('warn', 'consent_repeat_failed', { jobId: this.jobId, ...errInfo(e) }));
            }
          }
        }

        const key = [...names].sort().join('\u0001');
        if (key !== lastParticipants && names.length) {
          lastParticipants = key;
          this.emit('participants', { participants: st.participants });
        }
        if (st.removed) leftReason = 'removed';
        else if (st.ended) leftReason = 'meeting_ended';
        else if (!st.inCall) {
          // Leave button gone for ~10 s without a recognizable message.
          if (++notInCall >= 10) leftReason = 'meeting_ended';
        } else notInCall = 0;
        if (leftReason) break;
        if (st.alone) {
          aloneSince ||= Date.now();
          if (Date.now() - aloneSince >= spec.aloneTimeoutSec * 1000) {
            leftReason = 'alone';
            break;
          }
        } else aloneSince = 0;
        if (!recorder.audioAlive()) throw new JobError('record_error', 'audio_encoder_died');
        if (Date.now() - lastSegCheck > 5000) {
          lastSegCheck = Date.now();
          uploadSegments();
        }
        await sleep(1000);
      }

      if (leftReason !== 'meeting_ended' && leftReason !== 'removed') await adapter.leave(page).catch(() => {});
      if (this.revoked) {
        await recorder.kill();
        throw new CancelledError('revoked');
      }
      const rec = await recorder.stop();
      if (rec.videoError) log('warn', 'video_unavailable', { jobId: this.jobId, detail: rec.videoError.slice(0, 300) });
      await this.emit('left', { detail: { reason: leftReason } });
      // Free memory before uploading.
      await browser.close().catch(() => {});

      this.setState('uploading');
      await uploadSegments();
      this.checkRevoked();
      if (audioUploadError) throw new JobError('upload_error', 'audio');
      let videoInfo = null;
      if (rec.video) {
        try {
          const parts = await this.uploadVideo(rec.video.file, rec.video.bytes);
          videoInfo = { parts, bytes: rec.video.bytes, mime: 'video/mp4' };
        } catch (e) {
          this.checkRevoked();
          log('error', 'video_upload_failed', { jobId: this.jobId, ...errInfo(e) });
          throw new JobError('upload_error', 'video');
        }
      }
      if (uploaded.size === 0 && !videoInfo) throw new JobError('record_error', 'nothing_recorded');

      const payload = {
        endReason: leftReason,
        durationMs: rec.durationMs,
        video: videoInfo,
        audio: { segments: uploaded.size, mime: 'audio/ogg' },
        speakers: coalesceSpeakers(samples),
        captions: captions.list(),
        participants: [...everyone.keys()].map((name) => ({ name })),
      };
      try {
        await this.cb.complete(payload);
      } catch (e) {
        this.checkRevoked();
        log('error', 'complete_failed', { jobId: this.jobId, ...errInfo(e) });
        throw new JobError('upload_error', 'complete');
      }
      this.setState('done');
      log('info', 'job_done', {
        jobId: this.jobId,
        endReason: leftReason,
        durationMs: rec.durationMs,
        videoParts: videoInfo?.parts ?? 0,
        audioSegments: uploaded.size,
        speakers: payload.speakers.length,
        captions: payload.captions.length,
        consentRepeats,
      });
    } catch (e) {
      if (this.revoked || e instanceof CancelledError || e instanceof RevokedError) {
        cancelled = true;
      } else {
        const reason = /** @type {any} */ (e)?.reason;
        failReason =
          typeof reason === 'string' && reason !== 'unsupported_platform' && reason !== 'chat_not_sent'
            ? reason
            : 'join_error';
        log('error', 'job_failed', { jobId: this.jobId, reason: failReason, ...errInfo(e) });
      }
    } finally {
      // Kills processes, closes the browser, removes the sink and display,
      // and deletes every local file of the job.
      for (const fn of cleanup.reverse()) {
        try {
          await fn();
        } catch (e) {
          log('warn', 'cleanup_failed', { jobId: this.jobId, ...errInfo(e) });
        }
      }
      if (cancelled) {
        this.error = 'revoked';
        this.setState('cancelled');
      } else if (failReason) {
        this.error = failReason;
        this.setState('failed');
        await this.emit('failed', { detail: { reason: failReason } });
      }
      this.endedAt = Date.now();
      // Drop the callback client (and with it the token) once finished.
      this.cb = /** @type {any} */ (null);
    }
  }

  /** @param {import('./lib/recorder.js').Segment} seg */
  async uploadSegment(seg) {
    const buf = await fsp.readFile(seg.file);
    await this.cb.putPart('audio', seg.n, buf, {
      'content-type': 'audio/ogg',
      'x-segment-start-ms': String(seg.startMs),
    });
    await fsp.rm(seg.file, { force: true });
  }

  /**
   * @param {string} file
   * @param {number} bytes
   * @returns {Promise<number>} number of parts
   */
  async uploadVideo(file, bytes) {
    const parts = planParts(bytes);
    const fh = await fsp.open(file, 'r');
    try {
      for (const p of parts) {
        this.checkRevoked();
        const buf = await readPart(fh, p);
        await this.cb.putPart('video', p.n, buf, { 'content-type': 'video/mp4' });
      }
    } finally {
      await fh.close();
    }
    return parts.length;
  }
}

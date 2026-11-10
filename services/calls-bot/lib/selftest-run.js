// End-to-end self-test: a local receiver that implements the app's callback
// endpoints, a signed job against the fake meeting, and ffprobe checks on what
// arrives. Used by `npm run selftest` and by POST /v1/selftest (fake mode only).
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { safeEqual, signedHeaders } from './hmac.js';
import { decodes, lumaStats, probe, volume } from './media.js';
import { PART_SIZE } from './parts.js';

/**
 * @param {string} token
 * @param {{ revokeOn?: string }} [opts] answer 404 from this event type on
 */
function startReceiver(token, opts = {}) {
  let revoked = false;
  /** @type {{ type: string, at: string, detail?: any, participants?: any }[]} */
  const events = [];
  /** @type {Map<number, Buffer>} */
  const video = new Map();
  /** @type {Map<number, { buf: Buffer, startMs: number, contentType: string }>} */
  const audio = new Map();
  let unauthorized = 0;
  /** @type {any} */
  let complete = null;
  /** @type {(v?: unknown) => void} */
  let settle = () => {};
  const finished = new Promise((r) => (settle = r));

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > PART_SIZE + 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(c);
    }
    const body = Buffer.concat(chunks);
    const auth = String(req.headers.authorization || '');
    if (!safeEqual(auth, `Bearer ${token}`)) {
      unauthorized++;
      res.writeHead(401).end();
      return;
    }
    const url = new URL(req.url || '/', 'http://x');
    const m = /^\/api\/calls\/bot\/jobs\/([^/]+)\/(events|complete|parts\/(video|audio)\/(\d+))$/.exec(url.pathname);
    if (!m) {
      res.writeHead(404).end();
      return;
    }
    if (revoked) {
      res.writeHead(404).end();
      return;
    }
    if (m[2] === 'events' && req.method === 'POST') {
      const ev = JSON.parse(body.toString('utf8'));
      if (opts.revokeOn && ev.type === opts.revokeOn) {
        revoked = true;
        res.writeHead(404).end();
        return;
      }
      events.push(ev);
      if (ev.type === 'failed') settle();
    } else if (m[2] === 'complete' && req.method === 'POST') {
      complete = JSON.parse(body.toString('utf8'));
      settle();
    } else if (m[3] && req.method === 'PUT') {
      const n = Number(m[4]);
      if (m[3] === 'video') video.set(n, body);
      else {
        audio.set(n, {
          buf: body,
          startMs: Number(req.headers['x-segment-start-ms']),
          contentType: String(req.headers['content-type'] || ''),
        });
      }
    } else {
      res.writeHead(405).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        events,
        video,
        audio,
        get complete() {
          return complete;
        },
        get unauthorized() {
          return unauthorized;
        },
        finished,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}

/**
 * @param {{ botBase: string, secret: string, ffmpeg?: string, ffprobe?: string, endsSec?: number, timeoutMs?: number }} opts
 */
export async function runSelftest(opts) {
  const ffmpeg = opts.ffmpeg || 'ffmpeg';
  const ffprobe = opts.ffprobe || 'ffprobe';
  const endsSec = opts.endsSec ?? 25;
  const token = crypto.randomBytes(24).toString('hex');
  const rnd = crypto.randomBytes(4).toString('hex');
  const code = `selftest-${rnd}`;
  const jobId = `selftest_${rnd}`;
  const consent = `Hi! I'm zerosoft Notetaker. This call is being recorded and transcribed (selftest ${rnd}).`;
  const receiver = /** @type {any} */ (await startReceiver(token));
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'zs-selftest-'));
  /** @type {{ name: string, ok: boolean, detail?: unknown }[]} */
  const checks = [];
  const check = (/** @type {string} */ name, /** @type {boolean} */ ok, /** @type {unknown} */ detail) =>
    checks.push({ name, ok: !!ok, ...(detail !== undefined ? { detail } : {}) });
  /** @type {Record<string, unknown>} */
  const summary = { jobId };
  const started = Date.now();
  try {
    const body = JSON.stringify({
      jobId,
      platform: 'meet',
      meetingUrl: `${opts.botBase}/fake-meet/${code}?admit=3&ends=${endsSec}&late=${Math.min(10, endsSec - 6)}`,
      botName: 'zerosoft Notetaker',
      consentMessage: consent,
      callbackUrl: `${receiver.origin}/api/calls/bot`,
      callbackToken: token,
      maxDurationSec: endsSec + 120,
      lobbyTimeoutSec: 60,
      aloneTimeoutSec: 120,
    });
    const r = await fetch(`${opts.botBase}/v1/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signedHeaders(opts.secret, 'POST', '/v1/jobs', body) },
      body,
    });
    check('job_accepted', r.status === 202, r.status);
    if (r.status !== 202) return { ok: false, checks, summary };

    const timeoutMs = opts.timeoutMs ?? (endsSec + 150) * 1000;
    const timedOut = await Promise.race([
      receiver.finished.then(() => false),
      new Promise((res) => setTimeout(() => res(true), timeoutMs)),
    ]);
    summary.elapsedSec = Math.round((Date.now() - started) / 1000);
    check('finished_in_time', !timedOut);
    const types = receiver.events.map((/** @type {any} */ e) => e.type);
    summary.events = types;
    const failed = receiver.events.find((/** @type {any} */ e) => e.type === 'failed');
    check('no_failed_event', !failed, failed?.detail);
    for (const t of ['joining', 'waiting_room', 'in_call', 'recording', 'left']) check(`event_${t}`, types.includes(t));
    const left = receiver.events.find((/** @type {any} */ e) => e.type === 'left');
    check('left_meeting_ended', left?.detail?.reason === 'meeting_ended', left?.detail);
    check('callbacks_authorized', receiver.unauthorized === 0, receiver.unauthorized);
    const c = receiver.complete;
    check('complete_received', !!c);
    if (!c) return { ok: false, checks, summary };
    summary.complete = {
      endReason: c.endReason,
      durationMs: c.durationMs,
      video: c.video,
      audio: c.audio,
      speakers: c.speakers?.length,
      captions: c.captions?.length,
      participants: c.participants,
    };
    check('end_reason', c.endReason === 'meeting_ended', c.endReason);

    // Video: contiguous parts, 4 MB exact except the last, reassembles to a playable MP4.
    if (c.video) {
      const n = c.video.parts;
      const sizes = [];
      const bufs = [];
      let contiguous = receiver.video.size === n;
      for (let i = 0; i < n; i++) {
        const b = receiver.video.get(i);
        if (!b) {
          contiguous = false;
          break;
        }
        sizes.push(b.length);
        bufs.push(b);
      }
      check('video_parts_contiguous', contiguous, { parts: n, received: receiver.video.size });
      check('video_part_sizes', sizes.slice(0, -1).every((s) => s === PART_SIZE) && sizes.length > 0 && sizes[sizes.length - 1] <= PART_SIZE, sizes);
      const total = sizes.reduce((a, b) => a + b, 0);
      check('video_bytes_match', total === c.video.bytes, { total, declared: c.video.bytes });
      const file = path.join(tmp, 'video.mp4');
      await fsp.writeFile(file, Buffer.concat(bufs));
      const p = await probe(ffprobe, file);
      const v = p?.streams.find((s) => s.type === 'video');
      const a = p?.streams.find((s) => s.type === 'audio');
      const vol = await volume(ffmpeg, file);
      const luma = await lumaStats(ffmpeg, file);
      summary.videoProbe = { ...p, volume: vol, luma };
      check('video_has_h264', v?.codec === 'h264', v);
      check('video_has_aac', a?.codec === 'aac', a);
      check('video_duration_gt_10s', (p?.durationSec ?? 0) > 10, p?.durationSec);
      check('video_decodes', await decodes(ffmpeg, file));
      check('video_audio_not_silent', vol.maxDb !== null && vol.maxDb > -50, vol);
    } else {
      check('video_present', false, 'video is null');
    }

    // Audio segments: each one decodes on its own and carries its start offset.
    const segs = [...receiver.audio.entries()].sort((x, y) => x[0] - y[0]);
    check('audio_segment_count', segs.length === c.audio?.segments && segs.length > 0, {
      received: segs.length,
      declared: c.audio?.segments,
    });
    /** @type {any[]} */
    const segInfo = [];
    let allDecode = segs.length > 0;
    for (const [n, s] of segs) {
      const f = path.join(tmp, `seg_${n}.ogg`);
      await fsp.writeFile(f, s.buf);
      const p = await probe(ffprobe, f);
      const ok = await decodes(ffmpeg, f);
      const vol = await volume(ffmpeg, f);
      if (!ok || !p || p.streams[0]?.codec !== 'opus') allDecode = false;
      segInfo.push({
        n,
        startMs: s.startMs,
        bytes: s.buf.length,
        contentType: s.contentType,
        durationSec: p?.durationSec,
        codec: p?.streams[0]?.codec,
        sampleRate: p?.streams[0]?.sampleRate,
        channels: p?.streams[0]?.channels,
        maxDb: vol.maxDb,
      });
    }
    summary.audioSegments = segInfo;
    check('audio_segments_decode', allDecode);
    check('audio_segment_headers', segInfo.every((s) => Number.isFinite(s.startMs) && s.contentType === 'audio/ogg'));
    // ffprobe reports Opus at its 48 kHz decode rate; the encoder input is 16 kHz.
    check('audio_opus_mono', segInfo.every((s) => s.channels === 1), segInfo.map((s) => s.channels));
    check('audio_segments_not_silent', segInfo.some((s) => s.maxDb !== null && s.maxDb > -50), segInfo.map((s) => s.maxDb));

    // Fake meeting saw the bot's name and the consent message.
    const st = await fetch(`${opts.botBase}/fake-meet/${code}/state`).then((r) => r.json()).catch(() => null);
    summary.fakeMeet = st && { join: st.join, chat: st.chat?.length, ended: st.ended };
    check('joined_with_bot_name', st?.join?.name === 'zerosoft Notetaker', st?.join);
    check('mic_cam_off', !!st?.join?.micOff && !!st?.join?.camOff, st?.join);
    check('consent_chat_received', !!st?.chat?.some((/** @type {any} */ m) => m.text === consent));
    check(
      'consent_repeated_for_newcomer',
      (st?.chat?.filter((/** @type {any} */ m) => m.text === consent).length ?? 0) === 2,
      st?.chat?.length,
    );
    check('speakers_non_empty', Array.isArray(c.speakers) && c.speakers.length > 0, c.speakers?.slice(0, 4));
    check('captions_non_empty', Array.isArray(c.captions) && c.captions.length > 0, c.captions?.slice(0, 3));
    check(
      'participants_named',
      Array.isArray(c.participants) && c.participants.some((/** @type {any} */ p) => p.name === 'Ana Pérez'),
      c.participants,
    );
    await receiver.close();

    // Scenario 2: chat disabled -> no consent -> failed consent_not_sent, nothing recorded.
    {
      const r2 = await runShortJob(opts, { query: 'admit=2&ends=40&nochat=1' });
      const ev = r2.events.find((/** @type {any} */ e) => e.type === 'failed');
      check('no_chat_fails_consent_not_sent', ev?.detail?.reason === 'consent_not_sent', ev?.detail);
      check('no_chat_never_records', !r2.events.some((/** @type {any} */ e) => e.type === 'recording') && !r2.complete && r2.parts === 0, r2.events.map((/** @type {any} */ e) => e.type));
    }
    // Scenario 3: the app answers 404 to "recording" -> the bot leaves at once and discards.
    {
      const r3 = await runShortJob(opts, { query: 'admit=2&ends=60', revokeOn: 'recording' });
      check('revoked_job_cancelled', r3.state === 'cancelled', r3.state);
      check('revoked_job_quiet', !r3.complete && r3.parts === 0 && !r3.events.some((/** @type {any} */ e) => e.type === 'left' || e.type === 'failed'), r3.events.map((/** @type {any} */ e) => e.type));
      check('revoked_job_left_meeting', r3.fakeEnded === 'left', r3.fakeEnded);
    }
    return { ok: checks.every((x) => x.ok), checks, summary };
  } finally {
    await receiver.close().catch(() => {});
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Runs a short job and waits until it is no longer active.
 * @param {{ botBase: string, secret: string }} opts
 * @param {{ query: string, revokeOn?: string }} sc
 */
async function runShortJob(opts, sc) {
  const token = crypto.randomBytes(24).toString('hex');
  const rnd = crypto.randomBytes(4).toString('hex');
  const code = `selftest-${rnd}`;
  const jobId = `selftest_${rnd}`;
  const receiver = /** @type {any} */ (await startReceiver(token, { revokeOn: sc.revokeOn }));
  try {
    const body = JSON.stringify({
      jobId,
      platform: 'meet',
      meetingUrl: `${opts.botBase}/fake-meet/${code}?${sc.query}`,
      botName: 'zerosoft Notetaker',
      consentMessage: `Recording notice (selftest ${rnd}).`,
      callbackUrl: `${receiver.origin}/api/calls/bot`,
      callbackToken: token,
      maxDurationSec: 120,
      lobbyTimeoutSec: 30,
      aloneTimeoutSec: 120,
    });
    // The previous job may still be cleaning up (capacity 1): retry on 503.
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`${opts.botBase}/v1/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signedHeaders(opts.secret, 'POST', '/v1/jobs', body) },
        body,
      });
      if (r.status !== 503) break;
      await new Promise((res) => setTimeout(res, 1000));
    }
    let state = '';
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const path = `/v1/jobs/${jobId}`;
      const j = await fetch(opts.botBase + path, { headers: signedHeaders(opts.secret, 'GET', path, '') })
        .then((r) => r.json())
        .catch(() => null);
      state = j?.state || '';
      if (['done', 'failed', 'cancelled'].includes(state)) break;
    }
    await new Promise((r) => setTimeout(r, 1500));
    const st = await fetch(`${opts.botBase}/fake-meet/${code}/state`).then((r) => r.json()).catch(() => null);
    return {
      state,
      events: receiver.events,
      complete: receiver.complete,
      parts: receiver.video.size + receiver.audio.size,
      fakeEnded: st?.ended,
    };
  } finally {
    await receiver.close();
  }
}

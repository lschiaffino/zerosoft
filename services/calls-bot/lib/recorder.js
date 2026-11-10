// Capture environment per job: Xvfb display, PulseAudio null-sink, ffmpeg.
//
// Linux (production): Chromium draws on its own Xvfb display and plays audio
// into its own null-sink. One ffmpeg grabs the display + the sink monitor into
// an MKV (crash-safe), remuxed at the end into MP4 +faststart. A second ffmpeg
// reads the same monitor and writes Ogg/Opus mono 16 kHz segments.
//
// Dev mode (macOS, CALLS_BOT_DEV_HEADLESS=1): no Xvfb/Pulse; ffmpeg records a
// synthetic test signal so the protocol can be exercised end to end.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { childEnv, run, spawnTracked, stopProc, waitExit } from './proc.js';

const W = 1280;
const H = 720;
const FPS = 15;

/** @type {Set<number>} */
const usedDisplays = new Set();

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts Xvfb on a free display number, with X authorization: a random
 * MIT-MAGIC-COOKIE per job in `<dir>/Xauthority` (0600). Only processes given
 * that file (this job's Chromium and ffmpeg) can connect to the display.
 * @param {string} dir per-job directory (0700)
 * @returns {Promise<{ display: string, xauthority: string, stop: () => Promise<void> }>}
 */
export async function startXvfb(dir) {
  let num = -1;
  for (let n = 99; n < 160; n++) {
    if (usedDisplays.has(n)) continue;
    if (fs.existsSync(`/tmp/.X${n}-lock`) || fs.existsSync(`/tmp/.X11-unix/X${n}`)) continue;
    num = n;
    break;
  }
  if (num < 0) throw Object.assign(new Error('no_display'), { reason: 'join_error' });
  usedDisplays.add(num);
  const xauthority = path.join(dir, 'Xauthority');
  await fsp.writeFile(xauthority, '', { mode: 0o600 });
  const cookie = crypto.randomBytes(16).toString('hex');
  const xa = await run('xauth', ['-f', xauthority, 'add', `:${num}`, '.', cookie], { timeoutMs: 5000 });
  if (xa.code !== 0) {
    usedDisplays.delete(num);
    throw Object.assign(new Error('xauth_failed: ' + xa.stderr.slice(-200)), { reason: 'join_error' });
  }
  const { proc, stderrTail } = spawnTracked('Xvfb', [
    `:${num}`,
    '-auth',
    xauthority,
    '-screen',
    '0',
    `${W}x${H}x24`,
    '-nolisten',
    'tcp',
    '-noreset',
  ]);
  const stop = async () => {
    await stopProc(proc, 'SIGTERM', 3000);
    usedDisplays.delete(num);
  };
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    if (fs.existsSync(`/tmp/.X11-unix/X${num}`)) return { display: `:${num}`, xauthority, stop };
    await sleep(100);
  }
  await stop();
  throw Object.assign(new Error('xvfb_failed: ' + stderrTail().slice(-200)), { reason: 'join_error' });
}

/**
 * Creates a PulseAudio null sink for one job.
 * @param {string} name only [a-z0-9_]
 * @returns {Promise<{ sink: string, stop: () => Promise<void> }>}
 */
export async function createSink(name) {
  if (!/^[a-z0-9_]{1,40}$/.test(name)) throw new Error('bad_sink_name');
  const r = await run('pactl', [
    'load-module',
    'module-null-sink',
    `sink_name=${name}`,
    'rate=48000',
    `sink_properties=device.description=${name}`,
  ]);
  const id = r.stdout.trim();
  if (r.code !== 0 || !/^\d+$/.test(id)) {
    throw Object.assign(new Error('pulse_failed: ' + r.stderr.slice(-200)), { reason: 'join_error' });
  }
  return {
    sink: name,
    stop: async () => {
      await run('pactl', ['unload-module', id], { timeoutMs: 5000 });
    },
  };
}

/**
 * @typedef {{ n: number, file: string, startMs: number }} Segment
 */

export class Recorder {
  /**
   * @param {{ dir: string, ffmpeg: string, display?: string|null, xauthority?: string|null, sink?: string|null, dev: boolean, segmentSec: number }} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.t0 = 0;
    this.stoppedAt = 0;
    /** @type {ReturnType<typeof spawnTracked>|null} */
    this.video = null;
    /** @type {ReturnType<typeof spawnTracked>|null} */
    this.audio = null;
    this.mkv = path.join(opts.dir, 'video.mkv');
    this.mp4 = path.join(opts.dir, 'video.mp4');
    this.segDir = path.join(opts.dir, 'audio');
    this.segList = path.join(this.segDir, 'segments.csv');
  }

  /** Input args for audio (pulse monitor or synthetic). */
  audioInput() {
    if (this.opts.dev) {
      return ['-re', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000'];
    }
    return ['-thread_queue_size', '1024', '-f', 'pulse', '-i', `${this.opts.sink}.monitor`];
  }

  videoInput() {
    if (this.opts.dev) {
      return ['-re', '-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}`];
    }
    return [
      '-thread_queue_size',
      '512',
      '-f',
      'x11grab',
      '-draw_mouse',
      '0',
      '-framerate',
      String(FPS),
      '-video_size',
      `${W}x${H}`,
      '-i',
      `${this.opts.display}.0+0,0`,
    ];
  }

  async start() {
    await fsp.mkdir(this.segDir, { recursive: true, mode: 0o700 });
    const ff = this.opts.ffmpeg;
    const base = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y'];
    const videoArgs = [
      ...base,
      ...this.videoInput(),
      ...this.audioInput(),
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-g',
      String(FPS * 4),
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-f',
      'matroska',
      this.mkv,
    ];
    const audioArgs = [
      ...base,
      ...this.audioInput(),
      '-map',
      '0:a',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libopus',
      '-b:a',
      '24k',
      '-application',
      'voip',
      '-f',
      'segment',
      '-segment_time',
      String(this.opts.segmentSec),
      '-segment_format',
      'ogg',
      '-reset_timestamps',
      '1',
      '-segment_list',
      this.segList,
      '-segment_list_type',
      'csv',
      path.join(this.segDir, 'seg_%04d.ogg'),
    ];
    const env = childEnv({ XAUTHORITY: this.opts.xauthority || undefined });
    this.t0 = Date.now();
    this.audio = spawnTracked(ff, audioArgs, { env });
    this.video = spawnTracked(ff, videoArgs, { env });
    // Fail fast if ffmpeg dies right away (missing device, bad args).
    await sleep(1500);
    if (!this.audioAlive()) {
      throw Object.assign(new Error('audio_ffmpeg_exited: ' + this.audio.stderrTail().slice(-300)), {
        reason: 'record_error',
      });
    }
  }

  audioAlive() {
    return !!this.audio && this.audio.proc.exitCode === null && this.audio.proc.signalCode === null;
  }

  videoAlive() {
    return !!this.video && this.video.proc.exitCode === null && this.video.proc.signalCode === null;
  }

  /**
   * Segments that ffmpeg has finished (listed in the CSV).
   * @returns {Promise<Segment[]>}
   */
  async completedSegments() {
    let text = '';
    try {
      text = await fsp.readFile(this.segList, 'utf8');
    } catch {
      return [];
    }
    /** @type {Segment[]} */
    const out = [];
    for (const line of text.split('\n')) {
      const m = /^seg_(\d{4})\.ogg,([\d.]+),([\d.]+)/.exec(line.trim());
      if (!m) continue;
      const n = Number(m[1]);
      out.push({
        n,
        file: path.join(this.segDir, `seg_${m[1]}.ogg`),
        startMs: Math.round(Number(m[2]) * 1000),
      });
    }
    return out;
  }

  /**
   * Stops both encoders gracefully and finalizes the MP4.
   * @returns {Promise<{ video: { file: string, bytes: number }|null, durationMs: number, videoError?: string }>}
   */
  async stop() {
    this.stoppedAt = Date.now();
    // SIGINT makes ffmpeg flush and write trailers.
    await Promise.all([
      this.audio ? stopProc(this.audio.proc, 'SIGINT', 20000) : null,
      this.video ? stopProc(this.video.proc, 'SIGINT', 20000) : null,
    ]);
    const durationMs = this.stoppedAt - this.t0;
    let video = null;
    let videoError;
    try {
      const st = await fsp.stat(this.mkv);
      if (st.size > 0) {
        const r = await run(
          this.opts.ffmpeg,
          ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', this.mkv, '-c', 'copy', '-movflags', '+faststart', this.mp4],
          { timeoutMs: 10 * 60 * 1000 },
        );
        if (r.code === 0) {
          const s2 = await fsp.stat(this.mp4);
          if (s2.size > 0) video = { file: this.mp4, bytes: s2.size };
        } else {
          videoError = 'remux_failed: ' + r.stderr.slice(-300);
        }
      } else {
        videoError = 'empty_video';
      }
    } catch (e) {
      videoError = 'no_video: ' + (this.video ? this.video.stderrTail().slice(-300) : '');
    }
    return { video, durationMs, videoError };
  }

  /** Kills anything still running (used in finally). */
  async kill() {
    await Promise.all([
      this.audio ? stopProc(this.audio.proc, 'SIGKILL', 1000) : null,
      this.video ? stopProc(this.video.proc, 'SIGKILL', 1000) : null,
    ]);
  }
}

export { waitExit };

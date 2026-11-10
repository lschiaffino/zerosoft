'use client';

/**
 * Voice en el navegador: grabación con MediaRecorder, nivel del micrófono y
 * grabación por trozos para reuniones. Cada trozo es un archivo completo (se
 * reinicia el MediaRecorder), así el servidor lo transcribe solo, y los
 * trozos en silencio no se suben.
 */

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* noop */
    }
  }
  return '';
}

import type { DesktopBridge } from '@/lib/desktop-bridge';

export function recordingSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function tabAudioSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

/** Código de error del navegador → clave de mensaje. */
export function mediaErrorCode(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'mic_missing';
  if (err instanceof Error && err.message === 'no_tab_audio') return 'no_tab_audio';
  if (err instanceof Error && err.message === 'screen_denied') return 'screen_denied';
  return 'mic_failed';
}

export async function getMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
}

/** Audio de una pestaña o ventana compartida (hay que tildar "compartir audio"). */
export async function getTabAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Chrome: sumar el audio del sistema cuando se comparte la pantalla entera.
    ...({ systemAudio: 'include', preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include' } as Record<string, unknown>),
  } as DisplayMediaStreamOptions);
  const audio = display.getAudioTracks();
  if (!audio.length) {
    display.getTracks().forEach((t) => t.stop());
    throw new Error('no_tab_audio');
  }
  return display;
}

/** Rate del PCM que entrega la app de escritorio (system_audio.rs). */
const DESKTOP_RATE = 16_000;
const DESKTOP_POLL_MS = 250;

/** Pasa el PCM de 16 bits little endian (base64) a muestras float. */
export function pcm16Base64ToFloat(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const n = Math.floor(bin.length / 2);
  const out = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 32768;
  }
  return out;
}

/**
 * Audio del sistema desde la app de escritorio: pide la captura nativa, lee el PCM cada 250 ms y lo
 * reproduce en un destino de WebAudio sin salida, así que el grabador lo toma como cualquier otro
 * MediaStream. Al cortar la pista (stopStream) se corta la captura nativa.
 */
export async function getDesktopSystemAudio(bridge: DesktopBridge): Promise<MediaStream> {
  if (!bridge.systemAudioStart || !bridge.systemAudioRead) throw new Error('no_tab_audio');
  const res = await bridge.systemAudioStart();
  if (res !== 'ok') throw new Error(res === 'denied' ? 'screen_denied' : 'no_tab_audio');
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  let next = 0;
  let closed = false;
  const timer = setInterval(async () => {
    if (closed) return;
    try {
      const b64 = await bridge.systemAudioRead!();
      if (!b64 || closed) return;
      const samples = pcm16Base64ToFloat(b64);
      if (!samples.length) return;
      const buf = ctx.createBuffer(1, samples.length, DESKTOP_RATE);
      buf.copyToChannel(samples, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      next = Math.max(next, ctx.currentTime + 0.05);
      src.start(next);
      next += buf.duration;
    } catch {
      // Una lectura que falla se salta: la siguiente retoma.
    }
  }, DESKTOP_POLL_MS);
  const track = dest.stream.getAudioTracks()[0];
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    void Promise.resolve(bridge.systemAudioStop?.()).catch(() => undefined);
    void ctx.close().catch(() => undefined);
  };
  const origStop = track.stop.bind(track);
  track.stop = () => {
    origStop();
    close();
  };
  return dest.stream;
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Nivel (0..1) del audio de un stream, leído con un AnalyserNode. */
export class LevelMeter {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Uint8Array<ArrayBuffer> | null = null;

  constructor(stream: MediaStream) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.buf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    } catch {
      this.ctx = null;
    }
  }

  level(): number {
    if (!this.analyser || !this.buf) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }

  close() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

/** Grabación simple (dictado): start → stop devuelve el Blob y la duración. */
export class SimpleRecorder {
  private rec: MediaRecorder | null = null;
  private parts: Blob[] = [];
  private t0 = 0;
  readonly mime: string;

  constructor(private stream: MediaStream) {
    this.mime = pickMimeType();
  }

  start() {
    this.parts = [];
    this.rec = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: 48_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.parts.push(e.data);
    };
    this.t0 = performance.now();
    this.rec.start(1000);
  }

  stop(): Promise<{ blob: Blob; durationMs: number }> {
    return new Promise((resolve) => {
      const rec = this.rec;
      const durationMs = Math.round(performance.now() - this.t0);
      if (!rec || rec.state === 'inactive') {
        resolve({ blob: new Blob(this.parts, { type: this.mime || 'audio/webm' }), durationMs });
        return;
      }
      rec.onstop = () => resolve({ blob: new Blob(this.parts, { type: rec.mimeType || this.mime || 'audio/webm' }), durationMs });
      rec.stop();
    });
  }
}

export interface AudioChunk {
  blob: Blob;
  /** Desde el inicio de esta grabación. */
  startMs: number;
  durationMs: number;
  /** Pico de nivel del trozo (0..1): los trozos en silencio no se suben. */
  peak: number;
}

/**
 * Grabación por trozos de `chunkMs`: al cumplirse, para el MediaRecorder
 * (cierra un archivo completo) y arranca otro sobre el mismo stream.
 */
export class ChunkRecorder {
  private rec: MediaRecorder | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sampler: ReturnType<typeof setInterval> | null = null;
  private meter: LevelMeter;
  private t0 = 0;
  private peak = 0;
  private done: Promise<void> = Promise.resolve();
  readonly mime: string;

  constructor(
    private stream: MediaStream,
    private chunkMs: number,
    private onChunk: (c: AudioChunk) => void,
  ) {
    this.mime = pickMimeType();
    this.meter = new LevelMeter(stream);
  }

  level(): number {
    return this.meter.level();
  }

  start() {
    this.running = true;
    this.t0 = performance.now();
    this.sampler = setInterval(() => {
      this.peak = Math.max(this.peak, this.meter.level());
    }, 150);
    this.segment();
  }

  private segment() {
    const audio = new MediaStream(this.stream.getAudioTracks());
    if (!audio.getAudioTracks().some((t) => t.readyState === 'live')) {
      this.running = false;
      return;
    }
    const rec = new MediaRecorder(audio, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: 32_000 });
    const parts: Blob[] = [];
    const started = performance.now();
    this.peak = 0;
    rec.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data);
    };
    this.done = new Promise((resolve) => {
      rec.onstop = () => {
        const durationMs = Math.round(performance.now() - started);
        const peak = this.peak;
        if (parts.length) {
          this.onChunk({ blob: new Blob(parts, { type: rec.mimeType || this.mime || 'audio/webm' }), startMs: Math.round(started - this.t0), durationMs, peak });
        }
        if (this.running) this.segment();
        resolve();
      };
    });
    rec.start();
    this.rec = rec;
    this.timer = setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop();
    }, this.chunkMs);
  }

  /** Para y espera el último trozo. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.sampler) clearInterval(this.sampler);
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    await this.done;
    this.meter.close();
  }
}

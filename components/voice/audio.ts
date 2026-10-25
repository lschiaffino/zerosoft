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
    ...({ systemAudio: 'include', preferCurrentTab: false } as Record<string, unknown>),
  } as DisplayMediaStreamOptions);
  const audio = display.getAudioTracks();
  if (!audio.length) {
    display.getTracks().forEach((t) => t.stop());
    throw new Error('no_tab_audio');
  }
  return display;
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

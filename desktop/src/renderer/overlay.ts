/**
 * Overlay de dictado: graba el micrófono mientras main dice 'recording' y,
 * al pasar a 'working', devuelve el audio (webm/opus). 'hidden' descarta.
 * Muestra el nivel del micrófono y el reloj (ámbar los últimos 10 s).
 *
 * Cada grabación es una sesión propia: un toque corto (cancelado) seguido de
 * otro (manos libres) no comparten micrófono ni grabador.
 */
import type { OverlayAudio, OverlayState } from '../shared/ipc';
import { formatClock } from '../shared/retry';

declare global {
  interface Window {
    zsOverlay: { onState: (cb: (s: OverlayState) => void) => void; sendAudio: (a: OverlayAudio) => void };
  }
}

const label = document.getElementById('label')!;
const clock = document.getElementById('clock')!;
const hint = document.getElementById('hint')!;
const bars = Array.from(document.querySelectorAll<HTMLSpanElement>('.meter span'));

interface Rec {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  startedAt: number;
  ctx: AudioContext | null;
  error: OverlayAudio['error'] | null;
  ready: Promise<void>;
  done: boolean;
}

let current: Rec | null = null;
let raf = 0;
let clockTimer = 0;

function stopMeter() {
  cancelAnimationFrame(raf);
  bars.forEach((b) => (b.style.height = '3px'));
}

function release(r: Rec) {
  if (current === r) stopMeter();
  r.stream?.getTracks().forEach((t) => t.stop());
  r.stream = null;
  void r.ctx?.close().catch(() => undefined);
  r.ctx = null;
}

function meter(r: Rec) {
  if (!r.stream) return;
  try {
    r.ctx = new AudioContext();
    const analyser = r.ctx.createAnalyser();
    analyser.fftSize = 256;
    r.ctx.createMediaStreamSource(r.stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (current !== r || r.done) return;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      bars.forEach((b, i) => {
        const wave = 0.55 + 0.45 * Math.sin(Date.now() / 120 + i * 1.3);
        b.style.height = `${Math.max(3, Math.min(18, 3 + peak * 44 * wave))}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    /* sin medidor: se graba igual */
  }
}

function begin(): Rec {
  const r: Rec = { stream: null, recorder: null, chunks: [], startedAt: performance.now(), ctx: null, error: null, ready: Promise.resolve(), done: false };
  r.ready = (async () => {
    try {
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      r.error = denied ? 'mic_denied' : 'mic_failed';
      return;
    }
    if (r.done) {
      // Ya se canceló mientras abría el micrófono.
      release(r);
      return;
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    r.recorder = new MediaRecorder(r.stream, { mimeType: mime, audioBitsPerSecond: 48_000 });
    r.recorder.ondataavailable = (e) => {
      if (e.data.size) r.chunks.push(e.data);
    };
    r.recorder.start(250);
    r.startedAt = performance.now();
    meter(r);
  })();
  return r;
}

async function finish(r: Rec, send: boolean) {
  await r.ready;
  r.done = true;
  const rec = r.recorder;
  r.recorder = null;
  if (!rec) {
    release(r);
    if (send) window.zsOverlay.sendAudio({ audio: null, mime: '', durationMs: 0, error: r.error ?? 'mic_failed' });
    return;
  }
  const durationMs = performance.now() - r.startedAt;
  await new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
    if (rec.state !== 'inactive') rec.stop();
    else resolve();
  });
  release(r);
  if (!send) return;
  const blob = new Blob(r.chunks, { type: rec.mimeType || 'audio/webm' });
  r.chunks = [];
  window.zsOverlay.sendAudio({ audio: blob.size ? await blob.arrayBuffer() : null, mime: blob.type, durationMs });
}

function runClock(startedAtMain: number | undefined, maxMs: number | undefined) {
  window.clearInterval(clockTimer);
  if (!startedAtMain) {
    clock.textContent = '';
    return;
  }
  // El reloj de main y el del overlay son el mismo (Date.now en la misma máquina).
  const paint = () => {
    const ms = Date.now() - startedAtMain;
    clock.textContent = formatClock(ms);
    clock.classList.toggle('ending', !!maxMs && maxMs - ms <= 10_000);
  };
  paint();
  clockTimer = window.setInterval(paint, 250);
}

let phase = 'hidden';
window.zsOverlay.onState((s) => {
  document.body.dataset.phase = s.phase;
  document.documentElement.lang = s.locale;
  label.textContent = s.label;
  hint.textContent = s.phase === 'recording' ? (s.hint ?? '') : '';
  const prev = phase;
  phase = s.phase;
  if (s.phase === 'recording') {
    if (s.startedAt) runClock(s.startedAt, s.maxMs);
    if (prev !== 'recording') current = begin();
    return;
  }
  runClock(undefined, undefined);
  if (prev === 'recording' && current) {
    const r = current;
    current = null;
    stopMeter();
    void finish(r, s.phase === 'working');
  }
});

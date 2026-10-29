/**
 * Overlay de dictado: graba el micrófono mientras main dice 'recording' y,
 * al pasar a 'working', devuelve el audio (webm/opus). 'hidden' descarta.
 */
import type { OverlayAudio, OverlayState } from '../shared/ipc';

declare global {
  interface Window {
    zsOverlay: { onState: (cb: (s: OverlayState) => void) => void; sendAudio: (a: OverlayAudio) => void };
  }
}

const label = document.getElementById('label')!;
const bars = Array.from(document.querySelectorAll<HTMLSpanElement>('.meter span'));

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let ctx: AudioContext | null = null;
let raf = 0;
let starting: Promise<void> | null = null;
let micError: OverlayAudio['error'] | null = null;

function stopAll() {
  cancelAnimationFrame(raf);
  bars.forEach((b) => (b.style.height = '3px'));
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  void ctx?.close().catch(() => undefined);
  ctx = null;
}

function meter(s: MediaStream) {
  try {
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(s).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      bars.forEach((b, i) => {
        const wave = 0.55 + 0.45 * Math.sin(Date.now() / 120 + i * 1.3);
        b.style.height = `${Math.max(3, Math.min(16, 3 + peak * 40 * wave))}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    /* sin medidor: se graba igual */
  }
}

async function start() {
  chunks = [];
  micError = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    stream = null;
    const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    micError = denied ? 'mic_denied' : 'mic_failed';
    return;
  }
  // Aunque ya hayan soltado (el micrófono tardó en abrir), se arma el grabador: finish() lo corta.
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48_000 });
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.start(250);
  startedAt = performance.now();
  meter(stream);
}

async function finish(send: boolean) {
  if (starting) await starting;
  const rec = recorder;
  recorder = null;
  if (!rec) {
    stopAll();
    if (send) window.zsOverlay.sendAudio({ audio: null, mime: '', durationMs: 0, error: micError ?? 'mic_failed' });
    return;
  }
  const durationMs = performance.now() - startedAt;
  await new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
    if (rec.state !== 'inactive') rec.stop();
    else resolve();
  });
  stopAll();
  if (!send) return;
  const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  chunks = [];
  window.zsOverlay.sendAudio({ audio: blob.size ? await blob.arrayBuffer() : null, mime: blob.type, durationMs });
}

let current = 'hidden';
window.zsOverlay.onState((s) => {
  document.body.dataset.phase = s.phase;
  document.documentElement.lang = s.locale;
  label.textContent = s.label;
  const prev = current;
  current = s.phase;
  if (s.phase === 'recording' && prev !== 'recording') {
    starting = start().finally(() => (starting = null));
  } else if (s.phase === 'working' && prev === 'recording') {
    void finish(true);
  } else if (s.phase === 'hidden' && prev === 'recording') {
    void finish(false);
  }
});

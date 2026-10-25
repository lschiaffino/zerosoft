'use client';

/**
 * Piezas del grabador que no son React: tipos de archivo, el reloj en un
 * Worker (los timers de una pestaña en segundo plano se frenan a 1 por
 * segundo y la composición del canvas se congelaría mientras grabás otra
 * pestaña o ventana), la mezcla de audio y las capturas de miniatura y GIF.
 */

export function pickVideoMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

export function pickAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

export function recorderSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!pickVideoMime();
}

export function screenSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
}

/** Tick de ~30 fps desde un Worker: sigue andando con la pestaña en segundo plano. */
export function createTicker(fps: number, onTick: () => void): () => void {
  const interval = Math.round(1000 / fps);
  try {
    const src = `let t=setInterval(()=>postMessage(0),${interval});onmessage=()=>{clearInterval(t)}`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = () => onTick();
    return () => {
      w.postMessage('stop');
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(onTick, interval);
    return () => window.clearInterval(id);
  }
}

/** Mezcla micrófono y audio de la pantalla en una sola pista (null si no hay ninguno). */
export function mixAudio(streams: Array<MediaStream | null>): { track: MediaStreamTrack | null; ctx: AudioContext | null; analyser: AnalyserNode | null } {
  const withAudio = streams.filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
  if (withAudio.length === 0) return { track: null, ctx: null, analyser: null };
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return { track: withAudio[0].getAudioTracks()[0], ctx: null, analyser: null };
  const ctx = new Ctx();
  const dest = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  for (const s of withAudio) {
    const src = ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks()));
    src.connect(dest);
    src.connect(analyser);
  }
  return { track: dest.stream.getAudioTracks()[0] ?? null, ctx, analyser };
}

/** Nivel 0–1 del micrófono (para el medidor). */
export function audioLevel(analyser: AnalyserNode | null, buf: Uint8Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
  return Math.min(1, peak / 100);
}

type Drawable = HTMLCanvasElement | HTMLVideoElement;

function sourceSize(src: Drawable): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  return { w: src.width, h: src.height };
}

/** Frame actual reducido a `width` px de ancho (alto par, mismo aspecto). */
export function snapshot(src: Drawable, width: number): HTMLCanvasElement | null {
  const { w, h } = sourceSize(src);
  if (!w || !h) return null;
  const outW = Math.min(width, w);
  const outH = Math.max(2, Math.round((h / w) * outW / 2) * 2);
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = outH;
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(src, 0, 0, outW, outH);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      c.toBlob((b) => resolve(b), type, quality);
    } catch {
      // Canvas "manchado" por un video de otro origen sin CORS.
      resolve(null);
    }
  });
}

/** Cámara dentro del círculo de la burbuja, recortada al centro (cover). */
export function drawBubble(g: CanvasRenderingContext2D, cam: HTMLVideoElement, cx: number, cy: number, d: number) {
  const vw = cam.videoWidth;
  const vh = cam.videoHeight;
  if (!vw || !vh) return;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  g.save();
  g.beginPath();
  g.arc(cx, cy, d / 2, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  // Espejo, como se ve uno mismo en Loom.
  g.translate(cx + d / 2, cy - d / 2);
  g.scale(-1, 1);
  g.drawImage(cam, sx, sy, side, side, 0, 0, d, d);
  g.restore();
  g.beginPath();
  g.arc(cx, cy, d / 2, 0, Math.PI * 2);
  g.lineWidth = Math.max(2, d / 60);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.stroke();
}

export const QUALITY = {
  '720': { width: 1280, height: 720, bitrate: 2_500_000 },
  '1080': { width: 1920, height: 1080, bitrate: 5_000_000 },
  '2160': { width: 3840, height: 2160, bitrate: 16_000_000 },
} as const;
export type QualityKey = keyof typeof QUALITY;

/**
 * Miniatura y GIF desde un tramo de un video ya subido (al recortar el
 * inicio, los del grabador mostraban la parte cortada). Se busca cada cuadro
 * con seek en un <video> fuera de pantalla.
 */
export async function assetsFromVideo(url: string, startSec: number, endSec: number | null): Promise<{ thumb: Blob | null; gif: Blob | null; thumbAt: number }> {
  const { encodeGif } = await import('@/lib/rec-gif');
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => reject(new Error('cut_failed'));
  });
  const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
  const last = Math.min(endSec ?? Infinity, duration) - 0.05;
  const seek = (t: number) =>
    new Promise<void>((resolve) => {
      const target = Math.max(startSec, Math.min(t, last));
      if (Math.abs(v.currentTime - target) < 0.01 && v.readyState >= 2) return resolve();
      const done = () => {
        v.removeEventListener('seeked', done);
        resolve();
      };
      v.addEventListener('seeked', done);
      v.currentTime = target;
      setTimeout(done, 3000);
    });
  const thumbAt = Math.max(startSec, Math.min(startSec + 0.5, last));
  await seek(thumbAt);
  const shot = snapshot(v, 960);
  const thumb = shot ? await canvasToBlob(shot, 'image/jpeg', 0.82) : null;
  const frames: Array<{ width: number; height: number; rgba: Uint8ClampedArray }> = [];
  for (let i = 0; i < 12; i++) {
    const t = startSec + 0.5 + i * 0.25;
    if (t > last && frames.length >= 2) break;
    await seek(t);
    const c = snapshot(v, 320);
    const g = c?.getContext('2d');
    if (c && g && (!frames[0] || (frames[0].width === c.width && frames[0].height === c.height))) {
      try {
        frames.push({ width: c.width, height: c.height, rgba: g.getImageData(0, 0, c.width, c.height).data });
      } catch {
        break;
      }
    }
  }
  v.removeAttribute('src');
  v.load();
  let gif: Blob | null = null;
  if (frames.length >= 2) {
    try {
      gif = new Blob([encodeGif(frames, 25) as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
    } catch {
      gif = null;
    }
  }
  return { thumb, gif, thumbAt };
}

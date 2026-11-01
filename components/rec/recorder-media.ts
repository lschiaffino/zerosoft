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

export type BubbleShape = 'circle' | 'square';
export type BubbleFrame = 'white' | 'dark' | 'accent' | 'none';

export interface BubbleLook {
  shape: BubbleShape;
  frame: BubbleFrame;
  /** Más luz para lugares oscuros. */
  lowLight: boolean;
}

export const DEFAULT_LOOK: BubbleLook = { shape: 'circle', frame: 'white', lowLight: false };

const FRAME_COLOR: Record<Exclude<BubbleFrame, 'none'>, string> = {
  white: 'rgba(255,255,255,0.9)',
  dark: 'rgba(17,17,17,0.9)',
  accent: '#e11d48',
};

/** El lienzo sabe aplicar filtros (Safari no). */
export function canvasFilterSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const g = document.createElement('canvas').getContext('2d');
  return !!g && 'filter' in g;
}

export const LOW_LIGHT_FILTER = 'brightness(1.35) contrast(1.05)';

/** Cámara dentro de la burbuja, recortada al centro (cover). */
export function drawBubble(g: CanvasRenderingContext2D, cam: HTMLVideoElement, cx: number, cy: number, d: number, look: BubbleLook = DEFAULT_LOOK) {
  const vw = cam.videoWidth;
  const vh = cam.videoHeight;
  if (!vw || !vh) return;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  const path = () => {
    g.beginPath();
    if (look.shape === 'square') g.rect(cx - d / 2, cy - d / 2, d, d);
    else g.arc(cx, cy, d / 2, 0, Math.PI * 2);
    g.closePath();
  };
  g.save();
  path();
  g.clip();
  // Espejo, como se ve uno mismo en Loom.
  g.translate(cx + d / 2, cy - d / 2);
  g.scale(-1, 1);
  if (look.lowLight && 'filter' in g) g.filter = LOW_LIGHT_FILTER;
  g.drawImage(cam, sx, sy, side, side, 0, 0, d, d);
  g.restore();
  if (look.frame === 'none') return;
  path();
  g.lineWidth = Math.max(2, d / 60);
  g.strokeStyle = FRAME_COLOR[look.frame];
  g.stroke();
}

/** Un trazo del lápiz, en fracción del cuadro. */
export interface InkStroke {
  points: Array<{ x: number; y: number }>;
  color: string;
  /** Cuándo se levantó el lápiz (null: se está dibujando). */
  doneAt: number | null;
}

export const INK_COLORS = ['#e11d48', '#f59e0b', '#2563eb', '#ffffff'] as const;
/** Lo dibujado queda este tiempo y después se desvanece. */
export const INK_HOLD_MS = 3000;
export const INK_FADE_MS = 800;

/** Opacidad de un trazo según el tiempo; 0 = ya se puede borrar. */
export function inkAlpha(stroke: Pick<InkStroke, 'doneAt'>, now: number): number {
  if (stroke.doneAt === null) return 1;
  const age = now - stroke.doneAt;
  if (age <= INK_HOLD_MS) return 1;
  return Math.max(0, 1 - (age - INK_HOLD_MS) / INK_FADE_MS);
}

export function drawInk(g: CanvasRenderingContext2D, strokes: InkStroke[], w: number, h: number, now: number) {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(3, h / 180);
  for (const s of strokes) {
    if (s.points.length < 2) continue;
    g.globalAlpha = inkAlpha(s, now);
    g.strokeStyle = s.color;
    g.beginPath();
    g.moveTo(s.points[0].x * w, s.points[0].y * h);
    for (const p of s.points.slice(1)) g.lineTo(p.x * w, p.y * h);
    g.stroke();
  }
  g.restore();
}

/** Círculo que marca el puntero sobre la vista previa. */
export function drawPointer(g: CanvasRenderingContext2D, x: number, y: number, h: number) {
  const r = Math.max(14, h / 28);
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = 'rgba(245,158,11,0.35)';
  g.fill();
  g.lineWidth = Math.max(2, h / 360);
  g.strokeStyle = 'rgba(245,158,11,0.9)';
  g.stroke();
  g.restore();
}

/** Desenfoque de fondo de la cámara que ofrece el navegador (hoy, Chrome en algunos sistemas). */
export function cameraBlurSupported(track: MediaStreamTrack | undefined | null): boolean {
  const caps = (track?.getCapabilities?.() ?? {}) as Record<string, unknown>;
  return Array.isArray(caps.backgroundBlur) && (caps.backgroundBlur as unknown[]).includes(true);
}

export async function setCameraBlur(track: MediaStreamTrack | undefined | null, on: boolean): Promise<boolean> {
  if (!track || !cameraBlurSupported(track)) return false;
  try {
    await track.applyConstraints({ advanced: [{ backgroundBlur: on } as unknown as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** Ventana flotante del navegador (Document Picture-in-Picture): queda arriba de cualquier app. */
export function floatingWindowSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

export async function openFloatingWindow(width: number, height: number): Promise<Window | null> {
  const api = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
  if (!api) return null;
  const win = await api.requestWindow({ width, height });
  // Mismos estilos y tema que la página.
  for (const node of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) win.document.head.appendChild(node.cloneNode(true));
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme) win.document.documentElement.setAttribute('data-theme', theme);
  win.document.body.className = 'rec-float-body';
  return win;
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

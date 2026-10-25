/**
 * Rec (como Loom): tipos y lógica pura que comparten el servidor, el
 * reproductor, la página pública y los tests.
 */

export type RecMode = 'screen_camera' | 'screen' | 'camera';
export const REC_MODES: readonly RecMode[] = ['screen_camera', 'screen', 'camera'];
export type RecSpace = 'personal' | 'workspace';
export type RecPrivacy = 'link' | 'workspace';
export type RecCtaMode = 'always' | 'end';
export type RecTranscriptStatus = 'none' | 'pending' | 'processing' | 'done' | 'failed' | 'disabled';

export interface RecChapter {
  start: number;
  title: string;
}

export interface RecSegment {
  start: number;
  end: number;
  text: string;
}

/** Reacciones del reproductor (como Loom: un toque, con el segundo del video). */
export const REC_REACTIONS = ['👍', '❤️', '😂', '😮', '🎉', '👏'] as const;

/** Partes de la subida: Blob exige 5 MB mínimo salvo la última; al disco local van de a 3 MB. */
export const BLOB_PART_BYTES = 8 * 1024 * 1024;
export const LOCAL_PART_BYTES = 3 * 1024 * 1024;
/** Tope de un video: 4 GB en Blob; 1 GB en disco local. */
export const MAX_REC_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_REC_BYTES_LOCAL = 1024 * 1024 * 1024;
export const MAX_REC_PARTS = 2000;
export const REC_VIDEO_TYPES = ['video/webm', 'video/mp4', 'video/quicktime'] as const;
export const REC_AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;

/** 65 → "1:05"; 3723 → "1:02:03". */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** "1:05" / "01:02:03" / "75" → segundos; null si no se entiende. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  if (parts.slice(1).some((n) => n > 59)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Capítulos como en Loom: una línea por capítulo, "0:00 Intro". Tienen que
 * empezar en 0:00 y durar al menos 5 s; se ordenan y se descartan los que no.
 */
export function normalizeChapters(input: RecChapter[], duration = Infinity): RecChapter[] {
  const sorted = input
    .map((c) => ({ start: Math.max(0, Math.round(Number(c.start) || 0)), title: String(c.title ?? '').trim().slice(0, 120) }))
    .filter((c) => c.title && c.start < duration)
    .sort((a, b) => a.start - b.start);
  const out: RecChapter[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.start - prev.start < 5) continue;
    out.push(c);
  }
  if (out.length && out[0].start !== 0) out[0] = { ...out[0], start: 0 };
  return out.slice(0, 60);
}

export function parseChapters(text: string, duration = Infinity): RecChapter[] {
  const rows: RecChapter[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d{1,3}(?::\d{1,2}){1,2})\s*[-–:]?\s+(.+)$/.exec(line);
    if (!m) continue;
    const start = parseClock(m[1]);
    if (start === null) continue;
    rows.push({ start, title: m[2] });
  }
  return normalizeChapters(rows, duration);
}

export function chaptersToText(chapters: RecChapter[]): string {
  return chapters.map((c) => `${fmtClock(c.start)} ${c.title}`).join('\n');
}

/** Capítulo que contiene el segundo `t` (índice), o -1. */
export function chapterAt(chapters: RecChapter[], t: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= t) idx = i;
  return idx;
}

/** Recorte no destructivo: inicio y fin válidos dentro de la duración (fin null = hasta el final). */
export function clampTrim(start: number, end: number | null, duration: number): { start: number; end: number | null } {
  const d = duration > 0 ? duration : Infinity;
  let s = Math.max(0, Number(start) || 0);
  if (Number.isFinite(d)) s = Math.min(s, Math.max(0, d - 1));
  let e: number | null = end === null || end === undefined || !Number.isFinite(Number(end)) ? null : Number(end);
  if (e !== null) {
    e = Math.min(Math.max(e, s + 1), d);
    if (e >= d - 0.05) e = null;
  }
  return { start: Math.round(s * 10) / 10, end: e === null ? null : Math.round(e * 10) / 10 };
}

/** Duración que ve el espectador (después del recorte). */
export function trimmedDuration(duration: number, trimStart: number, trimEnd: number | null): number {
  const end = trimEnd ?? duration;
  return Math.max(0, end - trimStart);
}

/** URL de la llamada a la acción: solo web (http/https), sin IPs ni localhost, como Loom. */
export function cleanCtaUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return null;
  if (u.username || u.password) return null;
  return u.toString().slice(0, 2000);
}

/** Subtítulos WebVTT desde la transcripción, corridos por el recorte. */
export function segmentsToVtt(segments: RecSegment[], offset = 0): string {
  const ts = (sec: number) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  const cues = segments
    .filter((s) => s.text.trim() && s.end > s.start)
    .map((s, i) => `${i + 1}\n${ts(s.start - offset)} --> ${ts(s.end - offset)}\n${s.text.trim().replace(/-->/g, '→')}`);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function transcriptText(segments: RecSegment[]): string {
  return segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
}

/** Segmentos que vuelve un proveedor, saneados (orden, límites, texto). */
export function cleanSegments(input: Array<{ start?: number; end?: number; text?: string }>): RecSegment[] {
  return input
    .map((s) => ({ start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: String(s.text ?? '').trim().slice(0, 2000) }))
    .filter((s) => s.text)
    .map((s) => ({ ...s, end: Math.max(s.end, s.start + 0.1), start: Math.round(s.start * 100) / 100 }))
    .sort((a, b) => a.start - b.start)
    .slice(0, 5000);
}

export interface RecViewStat {
  viewer_key: string;
  watched_sec: number;
  max_position: number;
  duration_sec: number;
  cta_clicks: number;
}

/** Totales de la analítica: vistas, espectadores únicos, % visto promedio (por espectador, su mejor vista) y clics. */
export function viewStats(views: RecViewStat[], duration: number): { views: number; unique: number; avgPct: number; completed: number; ctaClicks: number } {
  const best = new Map<string, number>();
  let ctaClicks = 0;
  for (const v of views) {
    const d = v.duration_sec > 0 ? v.duration_sec : duration;
    const pct = d > 0 ? Math.min(100, (v.max_position / d) * 100) : 0;
    best.set(v.viewer_key, Math.max(best.get(v.viewer_key) ?? 0, pct));
    ctaClicks += v.cta_clicks;
  }
  const pcts = [...best.values()];
  const avgPct = pcts.length ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length) : 0;
  return { views: views.length, unique: best.size, avgPct, completed: pcts.filter((p) => p >= 95).length, ctaClicks };
}

/** Porcentaje visto de una vista (0–100), relativo a lo que ve el espectador después del recorte. */
export function viewPct(maxPosition: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((maxPosition / duration) * 100)));
}

export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  // Fórmulas en planillas: se neutralizan con un apóstrofo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function isRecVideoType(type: string): boolean {
  const base = type.split(';')[0].trim().toLowerCase();
  return (REC_VIDEO_TYPES as readonly string[]).includes(base);
}

export function isRecAudioType(type: string): boolean {
  const base = type.split(';')[0].trim().toLowerCase();
  return (REC_AUDIO_TYPES as readonly string[]).includes(base);
}

/** Título por defecto mientras no hay uno de la IA: "Video del 25 oct, 14:05". */
export function defaultTitle(prefix: string, date: Date, locale: string, timeZone?: string): string {
  try {
    const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(date);
    return `${prefix} ${when}`.slice(0, 200);
  } catch {
    return prefix;
  }
}

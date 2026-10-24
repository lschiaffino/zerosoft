/**
 * Documentos con seguimiento y videos 1:1 del CRM: lógica pura (la usan el
 * visor público, la UI y lib/crm-media.ts).
 */

/** PDF de hasta 25 MB; video de hasta 200 MB (subida directa a Blob) o 100 MB (disco local). */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_VIDEO_BYTES_LOCAL = 100 * 1024 * 1024;
export const VIDEO_TYPES = ['video/webm', 'video/mp4', 'video/quicktime'] as const;

/** Tope por ping: un visor no suma más de 60 s por página entre dos pings (pestañas colgadas, relojes raros). */
const MAX_PING_SECONDS = 60;

/** Segundos por página: une lo guardado con lo nuevo (se queda con el mayor; los pings mandan acumulados). */
export function mergePages(saved: Record<string, number>, incoming: Record<string, number>, pageCount: number): Record<string, number> {
  const out: Record<string, number> = { ...saved };
  for (const [k, v] of Object.entries(incoming)) {
    const page = Number(k);
    if (!Number.isInteger(page) || page < 1 || page > Math.max(pageCount, 1) || page > 2000) continue;
    const secs = Math.max(0, Math.min(Number(v) || 0, 24 * 3600));
    out[String(page)] = Math.max(out[String(page)] ?? 0, Math.round(secs));
  }
  return out;
}

/** Total razonable de una vista: lo que mandó el visor, sin saltos mayores a MAX_PING_SECONDS desde el último ping. */
export function clampSeconds(prev: number, incoming: number, elapsedSinceLastPing: number): number {
  const target = Math.max(prev, Math.round(Number(incoming) || 0));
  const cap = prev + Math.max(MAX_PING_SECONDS, Math.ceil(elapsedSinceLastPing) + 5);
  return Math.min(target, cap);
}

/** 75 → "1m 15s"; 3700 → "1h 1m". */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}h ${m}m` : `${m}m${r ? ` ${r}s` : ''}`;
}

/** Las páginas más leídas primero: [[page, seconds], …]. */
export function topPages(pages: Record<string, number>, limit = 5): Array<[number, number]> {
  return Object.entries(pages)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit);
}

/** Porcentaje visto de un video (0–100). */
export function watchedPct(maxPosition: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((maxPosition / duration) * 100)));
}

export function isAllowedVideoType(type: string): boolean {
  const base = type.split(';')[0].trim().toLowerCase();
  return (VIDEO_TYPES as readonly string[]).includes(base);
}

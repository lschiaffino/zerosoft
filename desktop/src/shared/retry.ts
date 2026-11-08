/**
 * Qué pasó con un dictado enviado al servidor y qué se hace con el audio
 * (puro). Si falló por la red, el servidor o la sesión, el audio queda en la
 * compu para mandarlo de nuevo (bandeja o historial de Ajustes); si el audio
 * no sirve (vacío, demasiado largo), no se guarda.
 */

export type DictationFailure = 'offline' | 'signed_out' | 'rate_limited' | 'server' | 'too_large' | 'empty' | 'rejected';

export type DictationOutcome = { ok: true; text: string } | { ok: false; failure: DictationFailure };

/** status null = no hubo respuesta (sin conexión, DNS, timeout). */
export function classifyResponse(status: number | null, body: { text?: unknown; error?: unknown } | null): DictationOutcome {
  if (status === null || status === 0) return { ok: false, failure: 'offline' };
  if (status === 401) return { ok: false, failure: 'signed_out' };
  if (status === 429) return { ok: false, failure: 'rate_limited' };
  if (status === 413 || body?.error === 'audio_too_large') return { ok: false, failure: 'too_large' };
  if (body?.error === 'empty_audio') return { ok: false, failure: 'empty' };
  if (status >= 500) return { ok: false, failure: 'server' };
  if (status >= 200 && status < 300) {
    if (!body) return { ok: false, failure: 'server' };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    return text ? { ok: true, text } : { ok: false, failure: 'empty' };
  }
  return { ok: false, failure: 'rejected' };
}

/** Se guarda el audio para reintentar: el problema no era el audio. */
export function keepForRetry(f: DictationFailure): boolean {
  return f === 'offline' || f === 'signed_out' || f === 'rate_limited' || f === 'server';
}

export interface PendingMeta {
  id: string;
  /** ms desde epoch. */
  createdAt: number;
  mime: string;
  durationMs: number;
  sourceApp: string;
  context: string;
  failure: DictationFailure;
  attempts: number;
}

export const PENDING_MAX = 20;
export const PENDING_MAX_AGE_MS = 7 * 86_400_000;

export function isPendingId(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9]{6,40}$/.test(v);
}

export function newPendingId(now: number, rand: () => number = Math.random): string {
  return `${now.toString(36)}${Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`;
}

/** meta.json leído del disco → PendingMeta válido o null. */
export function parsePendingMeta(raw: unknown): PendingMeta | null {
  const v = (raw && typeof raw === 'object' ? raw : null) as Partial<PendingMeta> | null;
  if (!v || !isPendingId(v.id) || typeof v.createdAt !== 'number' || !Number.isFinite(v.createdAt)) return null;
  return {
    id: v.id,
    createdAt: v.createdAt,
    mime: typeof v.mime === 'string' && /^audio\/[a-z0-9.+-]+$/.test(v.mime) ? v.mime : 'audio/webm',
    durationMs: typeof v.durationMs === 'number' && v.durationMs > 0 ? Math.round(v.durationMs) : 0,
    sourceApp: typeof v.sourceApp === 'string' ? v.sourceApp.slice(0, 100) : '',
    context: typeof v.context === 'string' ? v.context.slice(0, 20) : 'other',
    failure: typeof v.failure === 'string' ? (v.failure as DictationFailure) : 'offline',
    attempts: typeof v.attempts === 'number' && v.attempts >= 0 ? Math.floor(v.attempts) : 0,
  };
}

/** Los más nuevos primero; afuera los que pasan del tope o de la semana. */
export function prunePending(list: PendingMeta[], now: number): { keep: PendingMeta[]; drop: PendingMeta[] } {
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const keep: PendingMeta[] = [];
  const drop: PendingMeta[] = [];
  for (const m of sorted) {
    if (keep.length < PENDING_MAX && now - m.createdAt <= PENDING_MAX_AGE_MS) keep.push(m);
    else drop.push(m);
  }
  return { keep, drop };
}

/** "0:07", "1:30": el reloj del overlay. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

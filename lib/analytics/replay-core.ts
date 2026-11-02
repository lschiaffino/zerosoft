/**
 * Session replay, la parte pura: topes, validar que un chunk del navegador
 * sean eventos de rrweb de verdad y sacar la metadata de cada grabación (clics,
 * segundos activos, páginas) de los eventos, no de lo que diga el cliente.
 * Sin base ni red: lo prueban los tests unitarios.
 */
import { cleanUrl } from './ingest-core';
import type { ProjectRow } from './projects';
import { scrubReplayEvent } from './replay-scrub';

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const REPLAY_LIMITS = {
  /** Cuerpo de un pedido (gzip o plano): el mismo tope de la ingesta, muy debajo de los 4,5 MB de Vercel. */
  maxBodyBytes: 512 * 1024,
  /** Lo que puede inflar un cuerpo gzip (frena una bomba de compresión). */
  maxInflatedBytes: 6 * 1024 * 1024,
  maxEventsPerChunk: 5000,
  maxSeq: 1_000_000,
  /** Lo guardado (gzip) e inflado por sesión. */
  maxSessionBytes: num('ANALYTICS_REPLAY_SESSION_BYTES', 20 * 1024 * 1024),
  maxSessionRawBytes: num('ANALYTICS_REPLAY_SESSION_RAW_BYTES', 150 * 1024 * 1024),
  maxSessionChunks: 2000,
  maxSessionMs: 6 * 3_600_000,
  /** Por proyecto y por día UTC. */
  maxSessionsPerDay: num('ANALYTICS_REPLAY_SESSIONS_PER_DAY', 2000),
  maxBytesPerDay: num('ANALYTICS_REPLAY_BYTES_PER_DAY', 1024 * 1024 * 1024),
  /** Días que se guarda una grabación (también limitado por la retención del proyecto). */
  retentionDays: num('ANALYTICS_REPLAY_RETENTION_DAYS', 30),
  /** Una hora del cliente fuera de esto (ya corregido su reloj) no se acepta. */
  maxEventAgeMs: 24 * 3_600_000,
  maxEventFutureMs: 3_600_000,
  maxPages: 50,
} as const;

/** Tipos de evento de rrweb que acepta la ingesta (6, plugin, no lo usa el snippet ni lo reproduce el player). */
const EVENT_DOM_LOADED = 0;
const EVENT_LOAD = 1;
const EVENT_FULL_SNAPSHOT = 2;
const EVENT_INCREMENTAL = 3;
const EVENT_META = 4;
const EVENT_CUSTOM = 5;

/** Fuentes de un IncrementalSnapshot (rrweb IncrementalSource). */
const MAX_INCREMENTAL_SOURCE = 16;
const SOURCE_MOUSE_INTERACTION = 2;
/** Lo que cuenta como "la persona está haciendo algo": mouse, clics, scroll, teclado, táctil, medios y arrastre. */
const ACTIVE_SOURCES = new Set([1, 2, 3, 5, 6, 7, 12]);
/** MouseInteraction.Click en rrweb. */
const INTERACTION_CLICK = 2;

export interface ReplayEvent {
  type: number;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface ReplayChunk {
  sessionId: string;
  windowId: string;
  seq: number;
  distinctId: string;
  events: ReplayEvent[];
  /** Hora del servidor menos hora del cliente al mandar (ms). */
  skewMs: number;
}

export interface ChunkSummary {
  /** En reloj del servidor. */
  startTs: number;
  endTs: number;
  clicks: number;
  activeSeconds: number;
  hasSnapshot: boolean;
  /** Páginas en orden de aparición, ya limpias (solo http/https). */
  pages: string[];
}

export type ChunkParse = { ok: true; chunk: ReplayChunk; summary: ChunkSummary } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_RE = /^[A-Za-z0-9_-]{8,100}$/;

/** Una página válida: http(s) y sin nada raro; la URL viene del cliente. */
export function cleanPageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const url = cleanUrl(raw);
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Un evento con la forma de rrweb, solo con sus tres campos. null si no la tiene. */
export function cleanEvent(v: unknown): ReplayEvent | null {
  if (!isObject(v)) return null;
  const { type, data, timestamp } = v;
  if (!Number.isInteger(type) || !Number.isFinite(timestamp) || !isObject(data)) return null;
  const t = type as number;
  if (t < EVENT_DOM_LOADED || t > EVENT_CUSTOM) return null;
  if (t === EVENT_FULL_SNAPSHOT) {
    const node = data.node;
    if (!isObject(node) || !Number.isInteger(node.type) || !Number.isInteger(node.id)) return null;
  }
  if (t === EVENT_INCREMENTAL) {
    const source = data.source;
    if (!Number.isInteger(source) || (source as number) < 0 || (source as number) > MAX_INCREMENTAL_SOURCE) return null;
  }
  if (t === EVENT_META) {
    if (typeof data.href !== 'string' || !Number.isFinite(data.width) || !Number.isFinite(data.height)) return null;
  }
  if (t === EVENT_CUSTOM && typeof data.tag !== 'string') return null;
  scrubReplayEvent(t, data);
  return { type: t, data, timestamp: timestamp as number };
}

/** Clics, segundos con actividad y páginas de un chunk, calculados acá. */
export function summarize(events: ReplayEvent[], skewMs: number): ChunkSummary {
  let startTs = Infinity;
  let endTs = -Infinity;
  let clicks = 0;
  let hasSnapshot = false;
  const activeSeconds = new Set<number>();
  const pages: string[] = [];
  for (const e of events) {
    const ts = e.timestamp + skewMs;
    if (ts < startTs) startTs = ts;
    if (ts > endTs) endTs = ts;
    if (e.type === EVENT_FULL_SNAPSHOT) hasSnapshot = true;
    if (e.type === EVENT_META) {
      const url = cleanPageUrl(e.data.href);
      if (url && !pages.includes(url) && pages.length < REPLAY_LIMITS.maxPages) pages.push(url);
    }
    if (e.type === EVENT_INCREMENTAL) {
      const source = e.data.source as number;
      if (ACTIVE_SOURCES.has(source)) activeSeconds.add(Math.floor(ts / 1000));
      if (source === SOURCE_MOUSE_INTERACTION && e.data.type === INTERACTION_CLICK) clicks++;
    }
  }
  return { startTs: Math.round(startTs), endTs: Math.round(endTs), clicks, activeSeconds: activeSeconds.size, hasSnapshot, pages };
}

/**
 * Valida el sobre ya parseado: ids, número de chunk y eventos de rrweb. Un solo
 * evento con mala forma rechaza el chunk entero; así lo que se guarda es lo que
 * se validó y nada más.
 */
export function parseChunk(body: unknown, now = Date.now()): ChunkParse {
  if (!isObject(body)) return { ok: false, error: 'invalid_payload' };
  const sessionId = body.session_id;
  if (typeof sessionId !== 'string' || !ID_RE.test(sessionId)) return { ok: false, error: 'invalid_session_id' };
  const windowId = body.window_id ?? '';
  if (typeof windowId !== 'string' || (windowId !== '' && !ID_RE.test(windowId))) return { ok: false, error: 'invalid_window_id' };
  const seq = body.seq;
  if (!Number.isInteger(seq) || (seq as number) < 0 || (seq as number) > REPLAY_LIMITS.maxSeq) return { ok: false, error: 'invalid_seq' };
  const distinctId = typeof body.distinct_id === 'string' ? body.distinct_id.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) : '';
  if (!distinctId) return { ok: false, error: 'invalid_distinct_id' };
  const raw = body.events;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'invalid_events' };
  if (raw.length > REPLAY_LIMITS.maxEventsPerChunk) return { ok: false, error: 'too_many_events' };
  const events: ReplayEvent[] = [];
  for (const v of raw) {
    const e = cleanEvent(v);
    if (!e) return { ok: false, error: 'invalid_events' };
    events.push(e);
  }
  // El reloj del cliente puede estar corrido: como en los eventos, se corrige con sent_at.
  const sentAt = body.sent_at;
  const skewMs = typeof sentAt === 'number' && Number.isFinite(sentAt) && sentAt > 0 ? Math.round(now - sentAt) : 0;
  const summary = summarize(events, skewMs);
  if (!Number.isFinite(summary.startTs) || !Number.isFinite(summary.endTs)) return { ok: false, error: 'invalid_timestamp' };
  if (summary.startTs < now - REPLAY_LIMITS.maxEventAgeMs || summary.endTs > now + REPLAY_LIMITS.maxEventFutureMs) return { ok: false, error: 'invalid_timestamp' };
  if (summary.endTs - summary.startTs > REPLAY_LIMITS.maxSessionMs) return { ok: false, error: 'invalid_timestamp' };
  return { ok: true, chunk: { sessionId, windowId, seq: seq as number, distinctId, events, skewMs }, summary };
}

/** Une las páginas de un chunk con las que ya había, sin repetir y con tope. */
export function mergePages(existing: readonly string[], incoming: readonly string[]): string[] {
  const out = [...existing];
  for (const url of incoming) {
    if (out.length >= REPLAY_LIMITS.maxPages) break;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** Misma cuenta que el snippet (public/zs.js): una sesión entra entera o no entra. */
export function sampleBucket(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) | 0;
  return Math.abs(h) % 100;
}

export function sampledIn(sessionId: string, rate: number): boolean {
  return sampleBucket(sessionId) < Math.min(100, Math.max(1, Number(rate) || 100));
}

/** Días que dura una grabación en este proyecto: el tope de replay, sin pasar la retención del proyecto. */
export function recordingRetentionDays(retentionDays: number | null | undefined): number {
  const project = Number(retentionDays);
  return Math.min(REPLAY_LIMITS.retentionDays, Number.isFinite(project) && project > 0 ? project : REPLAY_LIMITS.retentionDays);
}

/** Lo que /api/ingest/decide le dice al snippet. Heatmaps salen de los clics de autocapture: sin él, no hay. */
export function replayConfig(
  project: Pick<ProjectRow, 'replay_enabled' | 'replay_sample_rate' | 'replay_mask_text' | 'heatmaps_enabled' | 'autocapture'>,
  dnt: boolean,
): { replay: false | { enabled: true; sampleRate: number; maskAllText: boolean }; heatmaps: boolean } {
  if (dnt) return { replay: false, heatmaps: false };
  return {
    replay: project.replay_enabled === 1 ? { enabled: true, sampleRate: Number(project.replay_sample_rate) || 100, maskAllText: project.replay_mask_text !== 0 } : false,
    heatmaps: project.heatmaps_enabled === 1 && project.autocapture === 1,
  };
}

/**
 * ¿El sitio deja que lo enmarquen? Con los headers de la página: X-Frame-Options
 * y frame-ancestors de la CSP. `appOrigin` es desde dónde se va a mostrar.
 */
export function framingAllowed(headers: { get(name: string): string | null }, appOrigin: string): boolean {
  const xfo = headers.get('x-frame-options')?.trim().toLowerCase();
  if (xfo && (xfo === 'deny' || xfo === 'sameorigin' || xfo.startsWith('allow-from'))) return false;
  const csp = headers.get('content-security-policy');
  if (!csp) return true;
  const directive = csp
    .split(',')
    .flatMap((p) => p.split(';'))
    .map((d) => d.trim().toLowerCase())
    .find((d) => d.startsWith('frame-ancestors'));
  if (!directive) return true;
  const sources = directive.split(/\s+/).slice(1);
  if (!sources.length || sources.includes("'none'")) return false;
  if (sources.includes('*')) return true;
  let app: URL;
  try {
    app = new URL(appOrigin);
  } catch {
    return false;
  }
  return sources.some((s) => {
    if (s === `${app.protocol}`) return true;
    try {
      const m = /^(?:(https?):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/.exec(s);
      if (!m) return false;
      if (m[1] && `${m[1]}:` !== app.protocol) return false;
      if (m[4] && m[4] !== '*' && m[4] !== (app.port || (app.protocol === 'https:' ? '443' : '80'))) return false;
      return m[2] ? app.hostname.endsWith(`.${m[3]}`) : app.hostname === m[3];
    } catch {
      return false;
    }
  });
}

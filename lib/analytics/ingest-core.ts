/**
 * Ingesta de Analytics, la parte pura: validar el cuerpo (un evento o un
 * lote), corregir el reloj del cliente, sacar las columnas que usan las
 * consultas web y resolver personas (identify, alias, $set). Sin base ni
 * red: lo prueban los tests unitarios y lo usa lib/analytics/ingest.ts.
 */
import { createHash } from 'crypto';

export const INGEST_LIMITS = {
  /** Tope del cuerpo de un pedido (bytes). */
  maxBodyBytes: 512 * 1024,
  /** Eventos por lote. */
  maxBatch: 200,
  maxEventName: 200,
  maxDistinctId: 200,
  /** Propiedades de un evento serializadas (bytes). */
  maxPropsBytes: 32 * 1024,
  /** Un timestamp del cliente más de esto en el futuro se toma como "ahora". */
  maxFutureMs: 60 * 60 * 1000,
  maxUrl: 2000,
  /** Lo más viejo que se acepta (5 años); el proyecto puede pedir menos con su retención. */
  maxPastMs: 5 * 365 * 86_400_000,
  /** Propiedades de una persona después de juntar $set y $set_once. */
  maxPersonKeys: 500,
  maxPersonBytes: 64 * 1024,
} as const;

export interface CleanEvent {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
  ts: number;
  uuid: string | null;
  set: Record<string, unknown> | null;
  setOnce: Record<string, unknown> | null;
}

export type ParseResult =
  | { ok: true; apiKey: string | null; events: CleanEvent[]; dropped: number }
  | { ok: false; error: 'invalid_json' | 'invalid_payload' | 'empty_batch' | 'batch_too_large' };

const CONTROL = /[\u0000-\u001f\u007f]/g;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  const s = v.replace(CONTROL, '').trim();
  if (!s || s.length > max) return null;
  return s;
}

/** Fechas razonables: entre 2000 y 2200 (en ms). Lo demás no se toma como fecha. */
const MIN_TIME = Date.UTC(2000, 0, 1);
const MAX_TIME = Date.UTC(2200, 0, 1);

function parseTime(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === 'number' && Number.isFinite(v)) n = v > 1e11 ? v : v * 1000;
  else if (typeof v === 'string' && v) {
    const p = Date.parse(v);
    n = Number.isFinite(p) ? p : null;
  }
  if (n === null || !Number.isFinite(n) || n < MIN_TIME || n > MAX_TIME) return null;
  return Math.round(n);
}

/**
 * Hora del evento en el reloj del servidor. Si el cliente manda `sent_at`,
 * se corrige el desfase de su reloj (como PostHog): ts = ahora - (sent_at - timestamp).
 * Un timestamp en el futuro (más de una hora) se toma como ahora.
 */
export function eventTime(timestamp: number | null, sentAt: number | null, now: number): number | null {
  let ts = timestamp ?? now;
  if (timestamp != null && sentAt != null) ts = now - (sentAt - timestamp);
  if (!Number.isFinite(ts)) return null;
  if (ts > now + INGEST_LIMITS.maxFutureMs) ts = now;
  // Más viejo que el tope: se descarta (nunca se guarda un número fuera de rango).
  if (ts < now - INGEST_LIMITS.maxPastMs) return null;
  return Math.round(ts);
}

/** ¿El ts es un instante válido para guardar? (lo usa la ingesta antes de escribir). */
export function validTs(ts: number, now: number, maxAgeMs: number = INGEST_LIMITS.maxPastMs): boolean {
  return Number.isSafeInteger(ts) && ts >= now - maxAgeMs && ts <= now + INGEST_LIMITS.maxFutureMs;
}

function cleanEvent(raw: unknown, sentAt: number | null, now: number): CleanEvent | null {
  if (!isPlainObject(raw)) return null;
  const event = cleanString(raw.event, INGEST_LIMITS.maxEventName);
  if (!event) return null;
  const props = isPlainObject(raw.properties) ? { ...raw.properties } : {};
  const distinctId = cleanString(raw.distinct_id ?? props.distinct_id ?? props.$distinct_id, INGEST_LIMITS.maxDistinctId);
  if (!distinctId) return null;
  delete props.distinct_id;
  delete props.token;
  delete props.api_key;
  let serialized: string;
  try {
    // $set y $set_once (en el evento o en sus propiedades) cuentan dentro del mismo tope.
    serialized = JSON.stringify([props, raw.$set ?? null, raw.$set_once ?? null]);
  } catch {
    return null;
  }
  if (serialized.length > INGEST_LIMITS.maxPropsBytes) return null;
  const ts = eventTime(parseTime(raw.timestamp), sentAt, now);
  if (ts === null) return null;
  const uuidRaw = typeof raw.uuid === 'string' ? raw.uuid : typeof props.$insert_id === 'string' ? props.$insert_id : null;
  const uuid = uuidRaw && /^[0-9A-Za-z-]{8,64}$/.test(uuidRaw) ? uuidRaw : null;
  const set = isPlainObject(raw.$set) ? raw.$set : isPlainObject(props.$set) ? (props.$set as Record<string, unknown>) : null;
  const setOnce = isPlainObject(raw.$set_once)
    ? raw.$set_once
    : isPlainObject(props.$set_once)
      ? (props.$set_once as Record<string, unknown>)
      : null;
  delete props.$set;
  delete props.$set_once;
  return {
    event,
    distinctId,
    properties: props,
    ts,
    uuid,
    set,
    setOnce,
  };
}

/**
 * Cuerpo de /api/ingest/e: un evento `{api_key, event, distinct_id, properties}`
 * o un lote `{api_key, batch: [...], sent_at}`. La key también puede venir en
 * `token` (compatibilidad con los SDK de PostHog). Los eventos inválidos se
 * descartan y se cuentan; el pedido falla solo si no queda forma de leerlo.
 */
export function parseIngestBody(text: string, now = Date.now()): ParseResult {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (Array.isArray(body)) body = { batch: body };
  if (!isPlainObject(body)) return { ok: false, error: 'invalid_payload' };
  const apiKey = cleanString(body.api_key ?? body.token, 100);
  const sentAt = parseTime(body.sent_at);
  const list = Array.isArray(body.batch) ? body.batch : 'event' in body ? [body] : null;
  if (!list) return { ok: false, error: 'invalid_payload' };
  if (list.length === 0) return { ok: false, error: 'empty_batch' };
  if (list.length > INGEST_LIMITS.maxBatch) return { ok: false, error: 'batch_too_large' };
  const events: CleanEvent[] = [];
  let dropped = 0;
  for (const raw of list) {
    // La key de cada evento (lotes de PostHog la repiten) no cambia la del pedido.
    const ev = cleanEvent(raw, sentAt, now);
    if (ev) events.push(ev);
    else dropped++;
  }
  return { ok: true, apiKey, events, dropped };
}

// ---------- Columnas ----------

export interface RequestContext {
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  ip: string | null;
}

export interface EventColumns {
  url: string | null;
  pathname: string | null;
  host: string | null;
  referrer: string | null;
  referring_domain: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  session_id: string | null;
}

function str(v: unknown, max = 500): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/** Parámetros de una URL que pueden traer secretos: no se guardan. */
const SECRET_PARAM = /token|secret|password|passwd|auth|session|signature|sig$|code|key|otp|jwt|email/i;

/** URL sin fragmento ni parámetros que parezcan secretos (tokens de login, links mágicos). */
export function cleanUrl(raw: string | null): string | null {
  const u = safeUrl(raw);
  if (!u) return raw ? null : raw;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k) && !/^utm_/i.test(k)) u.searchParams.delete(k);
  return u.toString().slice(0, INGEST_LIMITS.maxUrl);
}

function safeUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** Dominio de un referrer ('$direct' si no hay). */
export function referringDomain(referrer: string | null): string {
  const u = safeUrl(referrer);
  return u ? u.hostname.replace(/^www\./, '') : '$direct';
}

/**
 * Columnas del evento. Lo que manda el snippet ($current_url, $referrer,
 * utm_*) gana; si falta, se deriva de la URL. Navegador, sistema, dispositivo
 * y país salen del pedido (user agent y headers de la infraestructura); un
 * evento de servidor (sin navegador) puede traerlos en sus propiedades.
 */
export function eventColumns(props: Record<string, unknown>, ctx: RequestContext | null): EventColumns {
  const url = cleanUrl(str(props.$current_url, INGEST_LIMITS.maxUrl));
  const parsed = safeUrl(url);
  const rawRef = str(props.$referrer, INGEST_LIMITS.maxUrl);
  const referrer = rawRef === '$direct' ? rawRef : cleanUrl(rawRef);
  const q = parsed?.searchParams;
  const fromCtx = (k: keyof Omit<RequestContext, 'ip'>, prop: string) => {
    const own = str(props[prop], 100);
    // Sin user agent de navegador (evento de servidor): lo que diga el evento.
    if (own && (!ctx || !ctx[k] || ctx[k] === 'Other')) return own;
    return ctx?.[k] ?? own;
  };
  return {
    url: parsed ? parsed.toString().slice(0, INGEST_LIMITS.maxUrl) : url,
    pathname: str(props.$pathname, 1000) ?? parsed?.pathname ?? null,
    host: str(props.$host, 255) ?? parsed?.host ?? null,
    referrer: referrer ?? (url ? '$direct' : null),
    referring_domain: str(props.$referring_domain, 255) ?? (url || referrer ? referringDomain(referrer) : null),
    utm_source: str(props.utm_source, 200) ?? (q?.get('utm_source') || null),
    utm_medium: str(props.utm_medium, 200) ?? (q?.get('utm_medium') || null),
    utm_campaign: str(props.utm_campaign, 200) ?? (q?.get('utm_campaign') || null),
    browser: fromCtx('browser', '$browser'),
    os: fromCtx('os', '$os'),
    device: fromCtx('device', '$device_type'),
    country: ctx?.country ?? str(props.$geoip_country_code, 8),
    session_id: str(props.$session_id, 100),
  };
}

/** IP anonimizada: el último octeto en 0 (IPv4) o solo los primeros 48 bits (IPv6). */
export function maskIp(ip: string | null): string | null {
  if (!ip || ip === 'unknown') return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  // IPv4 (también la mapeada en IPv6, ::ffff:a.b.c.d): el último octeto en 0.
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  const groups = expandIpv6(ip);
  if (groups) return `${groups.slice(0, 3).join(':')}::`;
  return null;
}

/** '2001:db8::1' → los 8 grupos (sin ceros a la izquierda). null si no es IPv6. */
export function expandIpv6(ip: string): string[] | null {
  const clean = ip.split('%')[0].toLowerCase();
  if (!/^[0-9a-f:]+$/.test(clean) || !clean.includes(':')) return null;
  const parts = clean.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : missing < 1) return null;
  const all = [...head, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...tail];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => g.replace(/^0+(?=.)/, ''));
}

// ---------- Dominios permitidos ----------

/** 'https://www.Example.com/x' o 'example.com:3000' → 'www.example.com'. */
export function hostOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  try {
    return new URL(v.includes('://') ? v : `https://${v}`).hostname || null;
  } catch {
    return null;
  }
}

/** Normaliza la lista de dominios permitidos ('*.example.com' o 'example.com'). */
export function normalizeDomains(list: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    const wildcard = v.startsWith('*.');
    const host = hostOf(wildcard ? v.slice(2) : v);
    if (!host || !/^[a-z0-9.-]+$/.test(host)) continue;
    out.add(wildcard ? `*.${host}` : host);
  }
  return [...out].slice(0, 50);
}

/**
 * ¿El origen del pedido está en la lista? Lista vacía: cualquiera. Sin
 * Origin ni Referer (un servidor con la key pública) y con lista: no.
 * '*.example.com' acepta los subdominios y el dominio mismo.
 */
export function originAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (!allowed.length) return true;
  const host = hostOf(origin);
  if (!host) return false;
  return allowed.some((d) => {
    if (d.startsWith('*.')) {
      const base = d.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    return host === d;
  });
}

// ---------- Personas ----------

/** Id de persona estable para el primer distinct_id de un proyecto (dos pedidos a la vez llegan al mismo). */
export function personIdFor(projectId: string, distinctId: string): string {
  return `p_${createHash('sha1').update(`${projectId}:${distinctId}`).digest('hex').slice(0, 24)}`;
}

export interface PersonState {
  personId: string;
  identified: boolean;
}

export interface PersonWrite {
  personId: string;
  set: Record<string, unknown>;
  setOnce: Record<string, unknown>;
  identified: boolean;
  firstSeen: number;
  lastSeen: number;
  created: boolean;
}

export interface PersonPlan {
  /** distinct_id → persona nuevos (INSERT OR IGNORE). */
  mappings: Array<{ distinctId: string; personId: string }>;
  /** Personas que se funden en otra (todos sus distinct_ids pasan a `into`). */
  merges: Array<{ from: string; into: string }>;
  writes: PersonWrite[];
}

/** Propiedades "iniciales" que se guardan una vez por persona (como $initial_* de PostHog). */
export function initialProps(cols: Pick<EventColumns, 'referring_domain' | 'utm_source' | 'pathname' | 'browser' | 'os' | 'country'>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (cols.referring_domain) out.$initial_referring_domain = cols.referring_domain;
  if (cols.utm_source) out.$initial_utm_source = cols.utm_source;
  if (cols.pathname) out.$initial_pathname = cols.pathname;
  if (cols.browser) out.$initial_browser = cols.browser;
  if (cols.os) out.$initial_os = cols.os;
  if (cols.country) out.$initial_country = cols.country;
  return out;
}

/**
 * Plan de personas para un lote, en orden:
 * - cada distinct_id sin persona estrena una (id estable);
 * - `$identify` con `$anon_distinct_id`: el id nuevo pasa a la persona
 *   anónima; si el id nuevo ya tenía otra persona y la anónima no estaba
 *   identificada, la anónima se funde en ella;
 * - `$create_alias` hace lo mismo con `properties.alias`;
 * - `$set` / `$set_once` (y las iniciales) se acumulan por persona.
 */
export function planPersons(
  projectId: string,
  events: Array<Pick<CleanEvent, 'event' | 'distinctId' | 'properties' | 'ts' | 'set' | 'setOnce'> & { initial?: Record<string, unknown> }>,
  existing: Map<string, PersonState>,
): PersonPlan {
  const state = new Map(existing);
  const mappings: PersonPlan['mappings'] = [];
  const merges: PersonPlan['merges'] = [];
  const writes = new Map<string, PersonWrite>();
  const created = new Set<string>();

  const write = (personId: string, ts: number): PersonWrite => {
    let w = writes.get(personId);
    if (!w) {
      w = { personId, set: {}, setOnce: {}, identified: false, firstSeen: ts, lastSeen: ts, created: created.has(personId) };
      writes.set(personId, w);
    }
    w.firstSeen = Math.min(w.firstSeen, ts);
    w.lastSeen = Math.max(w.lastSeen, ts);
    return w;
  };

  const ensure = (distinctId: string): PersonState => {
    const known = state.get(distinctId);
    if (known) return known;
    const s = { personId: personIdFor(projectId, distinctId), identified: false };
    state.set(distinctId, s);
    created.add(s.personId);
    mappings.push({ distinctId, personId: s.personId });
    return s;
  };

  /** `other` (anónimo o alias) pasa a la persona de `main`. */
  const link = (main: string, other: string, ts: number) => {
    if (!other || other === main) return;
    const otherState = state.get(other);
    const mainState = state.get(main);
    // Un id que ya es de una persona identificada nunca se suma a otra (como PostHog).
    if (otherState?.identified) return;
    if (!mainState && otherState) {
      // El id nuevo no tenía persona: se suma a la del anónimo.
      state.set(main, otherState);
      mappings.push({ distinctId: main, personId: otherState.personId });
      return;
    }
    const target = mainState ?? ensure(main);
    if (!otherState) {
      state.set(other, target);
      mappings.push({ distinctId: other, personId: target.personId });
      return;
    }
    if (otherState.personId === target.personId || otherState.identified) return;
    // Fusión: todo lo de la persona anónima pasa a la identificada.
    merges.push({ from: otherState.personId, into: target.personId });
    for (const [did, s] of state) if (s.personId === otherState.personId) state.set(did, target);
    const from = writes.get(otherState.personId);
    if (from) {
      const into = write(target.personId, ts);
      Object.assign(into.setOnce, from.setOnce, into.setOnce);
      Object.assign(into.set, from.set, into.set);
      writes.delete(otherState.personId);
    }
  };

  for (const ev of events) {
    if (ev.event === '$identify') {
      const anon = typeof ev.properties.$anon_distinct_id === 'string' ? ev.properties.$anon_distinct_id : '';
      if (anon && anon !== ev.distinctId) {
        if (!state.has(anon) && !state.has(ev.distinctId)) ensure(anon);
        link(ev.distinctId, anon, ev.ts);
      }
    } else if (ev.event === '$create_alias') {
      const alias = typeof ev.properties.alias === 'string' ? ev.properties.alias.slice(0, INGEST_LIMITS.maxDistinctId) : '';
      if (alias && alias !== ev.distinctId) {
        ensure(ev.distinctId);
        link(ev.distinctId, alias, ev.ts);
      }
    }
    const s = ensure(ev.distinctId);
    const w = write(s.personId, ev.ts);
    if (ev.event === '$identify') {
      s.identified = true;
      w.identified = true;
    }
    // Tope de claves por persona y lote (el tope total lo aplica el UPDATE).
    const room = (o: Record<string, unknown>) => Object.keys(o).length < INGEST_LIMITS.maxPersonKeys;
    if (ev.initial) for (const [k, v] of Object.entries(ev.initial)) if (!(k in w.setOnce) && room(w.setOnce)) w.setOnce[k] = v;
    if (ev.setOnce) for (const [k, v] of Object.entries(ev.setOnce)) if (!(k in w.setOnce) && room(w.setOnce)) w.setOnce[k] = v;
    if (ev.set) for (const [k, v] of Object.entries(ev.set)) if (k in w.set || room(w.set)) w.set[k] = v;
  }
  for (const w of writes.values()) w.created = created.has(w.personId);
  return { mappings, merges, writes: [...writes.values()] };
}

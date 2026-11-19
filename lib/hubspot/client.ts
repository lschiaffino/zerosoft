/**
 * HubSpot: el cliente HTTP que comparten el importador del CRM, el vínculo de
 * Lines y (después) el sync. Server-only, sin DB.
 *
 * - Presupuesto: HubSpot limita por ráfaga (pedidos cada 10 s, por clave) y
 *   por día (por cuenta). El cliente lleva las dos cuentas en memoria: la de
 *   ráfaga por clave y la diaria por cuenta, así dos funciones que usan la
 *   misma clave (o dos claves de la misma cuenta) no gastan dos veces. Los
 *   números salen de los headers X-HubSpot-RateLimit-* de cada respuesta; sin
 *   headers (la búsqueda no los manda) vale el piso de 100 cada 10 s.
 * - Reintentos: 429 y 423 esperan lo que diga Retry-After (o 1 s, 2 s, 4 s…);
 *   el límite diario no se reintenta.
 * - Errores: HubspotApiError solo lleva un código, el status y la ruta sin
 *   query y sin segmentos que parezcan datos. Nunca el token ni el contenido
 *   de un registro.
 *
 * La memoria es por proceso: en serverless cada instancia lleva su cuenta,
 * pero como los números vienen de HubSpot (lo que queda en la ventana), todas
 * frenan cuando la cuenta real se acerca al tope.
 */
import { createHash } from 'crypto';
import { backoffMs, realSleep, type FetchLike, type SleepFn } from './retry';

export const HUBSPOT_API_BASE = 'https://api.hubapi.com';

/** `blocked`: el pedido iba a otro host que el de HubSpot y no se hizo. */
export type HubspotApiErrorCode = 'auth' | 'scope' | 'not_found' | 'rate_limited' | 'locked' | 'http' | 'network' | 'blocked';
/** Qué límite cortó: la ráfaga de 10 s, el diario o el de la búsqueda. */
export type HubspotRatePolicy = '' | 'burst' | 'daily' | 'search';

export class HubspotApiError extends Error {
  constructor(
    readonly code: HubspotApiErrorCode,
    readonly status = 0,
    readonly path = '',
    readonly policy: HubspotRatePolicy = '',
  ) {
    super(`hubspot ${code}${status ? ` ${status}` : ''}${path ? ` ${path}` : ''}`);
    this.name = 'HubspotApiError';
  }
}

/**
 * Ruta para un error o un log: sin host ni query, y con los segmentos que
 * pueden ser un dato (un email, un token, un valor largo) tapados.
 */
export function safeHubspotPath(url: string): string {
  let path = '';
  try {
    path = new URL(url, HUBSPOT_API_BASE).pathname;
  } catch {
    return '';
  }
  return path
    .split('/')
    .map((seg) => {
      let s = seg;
      try {
        s = decodeURIComponent(seg);
      } catch {
        // Un segmento mal codificado se evalúa tal cual.
      }
      return s.length > 40 || /[@\s]/.test(s) || /^pat-/i.test(s) ? ':redacted' : seg;
    })
    .join('/');
}

/** Huella de un token para usar de clave en memoria. Nunca se guarda ni se loguea. */
export function hubspotTokenFingerprint(token: string): string {
  return createHash('sha256').update(`hubspot:${token}`).digest('hex').slice(0, 32);
}

// ======================================================================
// Presupuesto
// ======================================================================

interface BurstState {
  stamps: number[];
  searchStamps: number[];
  max: number;
  windowMs: number;
  /** HubSpot dijo que queda poco (o respondió 429): nadie pide hasta acá. */
  pausedUntil: number;
}

interface DailyState {
  limit: number;
  remaining: number;
  seenAt: number;
  /** Se llegó a la reserva (o HubSpot respondió con el límite diario): no se pide hasta acá. */
  blockedUntil: number;
}

interface BudgetRegistry {
  burst: Map<string, BurstState>;
  daily: Map<string, DailyState>;
  /** Huella del token → cuenta de HubSpot (se aprende al validar el token). */
  portalOf: Map<string, string>;
}

const MAX_KEYS = 500;
const DEFAULT_MAX = 100;
const DEFAULT_WINDOW_MS = 10_000;
/** La búsqueda tiene su propio tope por segundo y no manda headers. */
const SEARCH_MAX = 4;
const SEARCH_WINDOW_MS = 1_000;
/** Cuando se toca la reserva diaria, se vuelve a mirar pasado este rato. */
const DAILY_RECHECK_MS = 15 * 60_000;

export function newHubspotBudgetRegistry(): BudgetRegistry {
  return { burst: new Map(), daily: new Map(), portalOf: new Map() };
}

const shared = globalThis as unknown as { __hubspotBudgets?: BudgetRegistry };
const defaultRegistry = (): BudgetRegistry => (shared.__hubspotBudgets ??= newHubspotBudgetRegistry());

/** Solo tests: olvida las cuentas en memoria. */
export function resetHubspotBudgets(): void {
  shared.__hubspotBudgets = newHubspotBudgetRegistry();
}

function capped<T>(map: Map<string, T>, key: string, make: () => T): T {
  let v = map.get(key);
  if (!v) {
    v = make();
    map.set(key, v);
    if (map.size > MAX_KEYS) map.delete(map.keys().next().value as string);
  }
  return v;
}

/** Lo que el cliente necesita de un presupuesto. `RateLimiter` del importador también lo cumple. */
export interface HubspotBudgetLike {
  take(path?: string): Promise<void>;
  observe?(headers: Headers, path: string): void;
  limited?(policy: HubspotRatePolicy, waitMs: number): void;
}

export interface HubspotBudgetOptions {
  token: string;
  /** Cuenta de HubSpot, si ya se sabe. Si no, se usa la que se aprendió al validar el token. */
  portalId?: string;
  now?: () => number;
  sleep?: SleepFn;
  /** Cuánto se espera como mucho por un lugar en la ventana; pasado eso corta con rate_limited. Sin tope por defecto. */
  maxWaitMs?: number;
  /** Parte de la ráfaga que se deja libre para otros usos de la misma clave (0 a 0.9). */
  burstReserve?: number;
  /** Parte del cupo diario que no se toca (0 a 0.9). */
  dailyReserve?: number;
  registry?: BudgetRegistry;
}

const isSearch = (path: string) => /\/search$/.test(path);

export class HubspotBudget implements HubspotBudgetLike {
  private readonly fp: string;
  private readonly now: () => number;
  private readonly sleep: SleepFn;
  private readonly reg: BudgetRegistry;
  private readonly burstReserve: number;
  private readonly dailyReserve: number;

  constructor(private readonly opts: HubspotBudgetOptions) {
    this.fp = hubspotTokenFingerprint(opts.token);
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
    this.reg = opts.registry ?? defaultRegistry();
    this.burstReserve = Math.min(0.9, Math.max(0, opts.burstReserve ?? 0.1));
    this.dailyReserve = Math.min(0.9, Math.max(0, opts.dailyReserve ?? 0.02));
    if (opts.portalId) bindHubspotTokenPortal(opts.token, opts.portalId, this.reg);
  }

  private burst(): BurstState {
    return capped(this.reg.burst, this.fp, () => ({ stamps: [], searchStamps: [], max: DEFAULT_MAX, windowMs: DEFAULT_WINDOW_MS, pausedUntil: 0 }));
  }

  private daily(): DailyState {
    const key = this.reg.portalOf.get(this.fp) ?? `t:${this.fp}`;
    return capped(this.reg.daily, key, () => ({ limit: 0, remaining: Number.MAX_SAFE_INTEGER, seenAt: 0, blockedUntil: 0 }));
  }

  /** Lo que se sabe hoy del presupuesto (para tests y para mostrarlo). */
  snapshot(): { max: number; windowMs: number; inWindow: number; dailyLimit: number; dailyRemaining: number | null; dailyBlocked: boolean } {
    const b = this.burst();
    const d = this.daily();
    const t = this.now();
    return {
      max: b.max,
      windowMs: b.windowMs,
      inWindow: b.stamps.filter((s) => t - s < b.windowMs).length,
      dailyLimit: d.limit,
      dailyRemaining: d.limit ? d.remaining : null,
      dailyBlocked: d.blockedUntil > t,
    };
  }

  async take(path = ''): Promise<void> {
    const safe = safeHubspotPath(path);
    let waited = 0;
    const wait = async (ms: number, policy: HubspotRatePolicy) => {
      const step = Math.max(1, Math.ceil(ms));
      if (this.opts.maxWaitMs !== undefined && waited + step > this.opts.maxWaitMs) throw new HubspotApiError('rate_limited', 429, safe, policy);
      waited += step;
      await this.sleep(step);
    };
    for (;;) {
      const t = this.now();
      if (this.daily().blockedUntil > t) throw new HubspotApiError('rate_limited', 429, safe, 'daily');
      const b = this.burst();
      if (b.pausedUntil > t) {
        await wait(b.pausedUntil - t, 'burst');
        continue;
      }
      b.stamps = b.stamps.filter((s) => t - s < b.windowMs);
      const room = Math.max(1, Math.floor(b.max * (1 - this.burstReserve)));
      if (b.stamps.length >= room) {
        await wait(b.stamps[0] + b.windowMs - t, 'burst');
        continue;
      }
      if (isSearch(safe)) {
        b.searchStamps = b.searchStamps.filter((s) => t - s < SEARCH_WINDOW_MS);
        if (b.searchStamps.length >= SEARCH_MAX) {
          await wait(b.searchStamps[0] + SEARCH_WINDOW_MS - t, 'search');
          continue;
        }
        b.searchStamps.push(t);
      }
      b.stamps.push(t);
      return;
    }
  }

  /** Lee los headers de límite de una respuesta y ajusta las dos cuentas. */
  observe(headers: Headers): void {
    const n = (name: string) => {
      const raw = headers.get(name);
      const v = raw === null || raw === '' ? NaN : Number(raw);
      return Number.isFinite(v) ? v : null;
    };
    const t = this.now();
    const b = this.burst();
    const max = n('x-hubspot-ratelimit-max');
    const interval = n('x-hubspot-ratelimit-interval-milliseconds');
    const remaining = n('x-hubspot-ratelimit-remaining');
    if (max !== null && max >= 1 && max <= 10_000) b.max = Math.floor(max);
    if (interval !== null && interval >= 1_000 && interval <= 60_000) b.windowMs = Math.floor(interval);
    // Queda menos que la reserva en la ventana real (otra instancia u otra función también gastan): se frena un rato.
    if (remaining !== null && remaining <= Math.ceil(b.max * this.burstReserve)) b.pausedUntil = Math.max(b.pausedUntil, t + Math.ceil(b.windowMs / 4));
    const daily = n('x-hubspot-ratelimit-daily');
    const dailyRemaining = n('x-hubspot-ratelimit-daily-remaining');
    if (daily !== null && dailyRemaining !== null && daily > 0) {
      const d = this.daily();
      d.limit = daily;
      d.remaining = dailyRemaining;
      d.seenAt = t;
      d.blockedUntil = dailyRemaining <= Math.ceil(daily * this.dailyReserve) ? t + DAILY_RECHECK_MS : 0;
    }
  }

  /** HubSpot respondió con un límite: los demás usos de la misma clave (o cuenta) también esperan. */
  limited(policy: HubspotRatePolicy, waitMs: number): void {
    const t = this.now();
    if (policy === 'daily') {
      const d = this.daily();
      d.blockedUntil = Math.max(d.blockedUntil, t + DAILY_RECHECK_MS);
      return;
    }
    const b = this.burst();
    b.pausedUntil = Math.max(b.pausedUntil, t + Math.max(0, waitMs));
  }
}

/** Anota de qué cuenta es un token: desde ahí su cupo diario es el de la cuenta. */
export function bindHubspotTokenPortal(token: string, portalId: string, registry: BudgetRegistry = defaultRegistry()): void {
  if (!/^\d{1,20}$/.test(portalId)) return;
  const fp = hubspotTokenFingerprint(token);
  const key = `p:${portalId}`;
  if (registry.portalOf.get(fp) === key) return;
  // Lo que ya se sabía del token pasa a la cuenta (si la cuenta no tiene un dato más nuevo).
  const own = registry.daily.get(`t:${fp}`);
  const portal = registry.daily.get(key);
  if (own && (!portal || portal.seenAt < own.seenAt)) registry.daily.set(key, own);
  registry.daily.delete(`t:${fp}`);
  registry.portalOf.set(fp, key);
  if (registry.portalOf.size > MAX_KEYS) registry.portalOf.delete(registry.portalOf.keys().next().value as string);
}

/** El presupuesto compartido de un token (y de su cuenta). */
export function hubspotBudget(opts: HubspotBudgetOptions): HubspotBudget {
  return new HubspotBudget(opts);
}

// ======================================================================
// Cliente
// ======================================================================

export interface HubspotClientOptions {
  token: string;
  fetch?: FetchLike;
  sleep?: SleepFn;
  /** null: sin presupuesto (tests con el HubSpot falso). Sin pasar: el compartido del token. */
  budget?: HubspotBudgetLike | null;
  base?: string;
  /** Solo con el fetch por defecto. */
  timeoutMs?: number;
}

export interface HubspotSendOptions {
  method?: string;
  body?: unknown;
  /** false: sin Authorization (la consulta de info del token lo lleva en el cuerpo). */
  auth?: boolean;
  /** Reintentos ante 429, 423 y errores de red (y 5xx con `retry5xx`). 0 por defecto. */
  retries?: number;
  retry5xx?: boolean;
  /** false: un error de red no se reintenta (corta con `network`). */
  retryNetwork?: boolean;
  /** Tope de espera total entre reintentos. */
  maxWaitMs?: number;
}

export interface HubspotResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  /** Ruta ya segura para errores y logs. */
  path: string;
  text: string;
  /** El cuerpo como objeto ({} si no es JSON). */
  json(): Record<string, unknown>;
}

export interface HubspotClient {
  /**
   * Hace el pedido con presupuesto y reintentos. Devuelve la respuesta aunque
   * no sea 2xx (cada función decide qué significa un 400 o un 404); tira
   * HubspotApiError solo si no hubo respuesta o si el límite no aflojó.
   */
  send(path: string, opts?: HubspotSendOptions): Promise<HubspotResponse>;
  /** Como `send`, pero devuelve el JSON y tira ante cualquier respuesta que no sea 2xx. */
  request<T = Record<string, unknown>>(path: string, opts?: HubspotSendOptions): Promise<T>;
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return '';
  }
}

function parse(text: string): Record<string, unknown> {
  try {
    const v = text ? (JSON.parse(text) as unknown) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** El error de una respuesta que no es 2xx (sin su cuerpo). */
export function hubspotStatusError(status: number, path: string): HubspotApiError {
  if (status === 401) return new HubspotApiError('auth', 401, path);
  if (status === 403) return new HubspotApiError('scope', 403, path);
  if (status === 404) return new HubspotApiError('not_found', 404, path);
  if (status === 423) return new HubspotApiError('locked', 423, path);
  if (status === 429) return new HubspotApiError('rate_limited', 429, path, 'burst');
  return new HubspotApiError('http', status, path);
}

export function createHubspotClient(opts: HubspotClientOptions): HubspotClient {
  const base = opts.base ?? HUBSPOT_API_BASE;
  const timeout = opts.timeoutMs ?? 30_000;
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }));
  const sleep = opts.sleep ?? realSleep;
  const budget = opts.budget === null ? null : (opts.budget ?? hubspotBudget({ token: opts.token, sleep }));

  async function send(path: string, o: HubspotSendOptions = {}): Promise<HubspotResponse> {
    const url = /^https?:\/\//.test(path) ? path : `${base}${path}`;
    const safe = safeHubspotPath(url);
    // La clave solo viaja al host configurado: una URL absoluta a otro lado no se pide.
    if (hostOf(url) !== hostOf(base)) throw new HubspotApiError('blocked', 0, safe);
    const retries = o.retries ?? 0;
    let waited = 0;
    const canWait = (ms: number) => o.maxWaitMs === undefined || waited + ms <= o.maxWaitMs;
    for (let attempt = 0; ; attempt++) {
      if (budget) await budget.take(safe);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: o.method ?? 'GET',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(o.auth === false ? {} : { authorization: `Bearer ${opts.token}` }),
          },
          ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
        });
      } catch {
        const wait = backoffMs(attempt, null);
        if (o.retryNetwork === false || attempt >= retries || !canWait(wait)) throw new HubspotApiError('network', 0, safe);
        await sleep(wait);
        waited += wait;
        continue;
      }
      const text = await res.text().catch(() => '');
      budget?.observe?.(res.headers, safe);
      if (res.status === 429 || res.status === 423) {
        const daily = res.status === 429 && /"policyName"\s*:\s*"DAILY"|daily limit/i.test(text);
        const policy: HubspotRatePolicy = daily ? 'daily' : isSearch(safe) ? 'search' : 'burst';
        // 423: HubSpot pide esperar al menos 2 s.
        const wait = Math.max(res.status === 423 ? 2_000 : 0, backoffMs(attempt, res.headers.get('retry-after')));
        budget?.limited?.(policy, wait);
        if (daily || attempt >= retries || !canWait(wait)) {
          throw res.status === 423 ? new HubspotApiError('locked', 423, safe) : new HubspotApiError('rate_limited', 429, safe, policy);
        }
        await sleep(wait);
        waited += wait;
        continue;
      }
      if (res.status >= 500 && o.retry5xx) {
        const wait = backoffMs(attempt, res.headers.get('retry-after'));
        if (attempt < retries && canWait(wait)) {
          await sleep(wait);
          waited += wait;
          continue;
        }
      }
      return { status: res.status, ok: res.ok, headers: res.headers, path: safe, text, json: () => parse(text) };
    }
  }

  async function request<T>(path: string, o: HubspotSendOptions = {}): Promise<T> {
    const res = await send(path, o);
    if (!res.ok) throw hubspotStatusError(res.status, res.path);
    return res.json() as T;
  }

  return { send, request };
}

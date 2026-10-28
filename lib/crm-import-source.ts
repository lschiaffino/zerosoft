/**
 * CRM — migración por API: tipos comunes de las fuentes (HubSpot, Pipedrive)
 * y el cliente HTTP con límite de ritmo y reintentos. Server-only, sin DB.
 *
 * Cada fuente traduce su API a registros normalizados (SrcCompany, SrcContact,
 * SrcDeal, SrcActivity) que escribe lib/crm-import-jobs.ts. Los valores de los
 * campos propios llegan crudos (texto) junto a la definición del campo, que
 * dice cómo convertirlos.
 *
 * El token nunca va en la URL ni en los mensajes de error: los errores solo
 * llevan el código HTTP y la ruta sin query.
 */
import type { CrmCustomFieldType } from './schema/types';

export type ImportProvider = 'hubspot' | 'pipedrive';
export const IMPORT_PROVIDERS: readonly ImportProvider[] = ['hubspot', 'pipedrive'];

/**
 * Grupos que la persona elige importar. `activities` = notas, llamadas,
 * reuniones, tareas y emails; `lists` = listas de HubSpot (pasan a etiquetas
 * en los contactos y empresas que ya se importaron).
 */
export type ImportGroup = 'companies' | 'contacts' | 'deals' | 'activities' | 'lists';
export const IMPORT_GROUPS: readonly ImportGroup[] = ['companies', 'contacts', 'deals', 'activities', 'lists'];

/** Fases de lectura, en orden: las empresas antes que los contactos, los deals antes que la actividad y las listas al final. */
export type ImportPhase = 'companies' | 'contacts' | 'deals' | 'notes' | 'calls' | 'meetings' | 'tasks' | 'emails' | 'activities' | 'lists';

export function phaseGroup(phase: ImportPhase): ImportGroup {
  if (phase === 'companies' || phase === 'contacts' || phase === 'deals' || phase === 'lists') return phase;
  return 'activities';
}

export type FieldEntity = 'contacts' | 'companies' | 'deals';

export interface SrcOwner {
  id: string;
  email: string;
  name: string;
}

/** Campo propio del otro CRM, ya con nuestro tipo. `optionMap`: valor interno → etiqueta. */
export interface SrcField {
  entity: FieldEntity;
  key: string;
  label: string;
  type: CrmCustomFieldType;
  options: string[];
  optionMap?: Record<string, string>;
  /** Separador de multiselección en el valor crudo (HubSpot ';', Pipedrive ','). */
  separator?: string;
}

export interface SrcStage {
  id: string;
  name: string;
  /** 0-100. */
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface SrcPipeline {
  id: string;
  name: string;
  stages: SrcStage[];
}

export interface SrcCompany {
  kind: 'company';
  id: string;
  name: string;
  domain: string;
  industry: string;
  employees: number | null;
  phone: string;
  website: string;
  city: string;
  country: string;
  lifecycleStage: string;
  ownerId: string;
  parentId: string;
  custom: Record<string, string>;
}

export interface SrcContact {
  kind: 'contact';
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  website: string;
  city: string;
  country: string;
  lifecycleStage: string;
  leadStatus: string;
  source: string;
  ownerId: string;
  /** La primaria primero (o marcada). */
  companies: Array<{ id: string; primary: boolean }>;
  custom: Record<string, string>;
}

export interface SrcDeal {
  kind: 'deal';
  id: string;
  name: string;
  pipelineId: string;
  stageId: string;
  amount: number | null;
  currency: string;
  /** 'YYYY-MM-DD' o ''. */
  closeDate: string;
  ownerId: string;
  description: string;
  lostReason: string;
  contactIds: string[];
  companies: Array<{ id: string; primary: boolean }>;
  custom: Record<string, string>;
}

export type SrcActivityType = 'note' | 'call' | 'meeting' | 'task' | 'email';

export interface SrcActivity {
  kind: 'activity';
  id: string;
  type: SrcActivityType;
  subject: string;
  body: string;
  /** Cuándo pasó (ISO). Queda como fecha de la actividad en el timeline. */
  at: string;
  /** Tareas y reuniones: vencimiento o inicio (ISO) o ''. */
  dueAt: string;
  done: boolean;
  ownerId: string;
  direction: '' | 'inbound' | 'outbound';
  durationMin: number | null;
  outcome: string;
  contactIds: string[];
  companyIds: string[];
  dealIds: string[];
}

/** Lista (estática o activa) de contactos o empresas, con sus miembros al momento del import. */
export interface SrcList {
  kind: 'list';
  id: string;
  name: string;
  entity: 'contact' | 'company';
  memberIds: string[];
}

export type SrcRecord = SrcCompany | SrcContact | SrcDeal | SrcActivity | SrcList;

export interface SourcePage {
  items: SrcRecord[];
  /** Cursor de la página siguiente; null = fin de la fase. */
  next: string | null;
}

export interface CrmSource {
  provider: ImportProvider;
  phases(): ImportPhase[];
  owners(): Promise<SrcOwner[]>;
  fields(): Promise<SrcField[]>;
  pipelines(): Promise<SrcPipeline[]>;
  /** Total de registros de la fase (null si la API no lo da barato). */
  count(phase: ImportPhase): Promise<number | null>;
  page(phase: ImportPhase, cursor: string | null, fields: SrcField[], limit?: number): Promise<SourcePage>;
}

// ---------- Errores ----------

/** auth: token inválido; scope: falta un permiso; http: otro error; network: sin respuesta. */
export type SourceErrorCode = 'auth' | 'scope' | 'http' | 'network' | 'rate_limited';

export class SourceError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    readonly status = 0,
    readonly path = '',
  ) {
    super(`${code}${status ? ` ${status}` : ''}${path ? ` ${path}` : ''}`);
    this.name = 'SourceError';
  }
}

/** auth y scope no se arreglan reintentando: cortan el job. */
export function isFatalSourceError(e: unknown): boolean {
  return e instanceof SourceError && (e.code === 'auth' || e.code === 'scope');
}

// ---------- Ritmo y reintentos ----------

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export const realSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ventana deslizante: como mucho `max` pedidos cada `windowMs` (HubSpot: 100
 * cada 10 s para apps privadas). Si la ventana está llena, espera a que salga
 * el más viejo.
 */
export class RateLimiter {
  private stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: SleepFn = realSleep,
  ) {}

  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
      if (this.stamps.length < this.max) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(Math.max(1, this.stamps[0] + this.windowMs - t));
    }
  }
}

export interface HttpClientOptions {
  fetch?: FetchLike;
  sleep?: SleepFn;
  limiter?: RateLimiter;
  /** Reintentos ante 429, 5xx o error de red. */
  maxRetries?: number;
  headers: Record<string, string>;
}

/** Espera de un reintento: Retry-After (segundos) si viene, si no 1 s, 2 s, 4 s… con tope de 30 s. */
export function backoffMs(attempt: number, retryAfter: string | null): number {
  const secs = Number(retryAfter);
  if (retryAfter && Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 60_000);
  return Math.min(1000 * 2 ** attempt, 30_000);
}

export function createHttpClient(opts: HttpClientOptions) {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? realSleep;
  const limiter = opts.limiter ?? new RateLimiter(100, 10_000, Date.now, sleep);
  const maxRetries = opts.maxRetries ?? 5;

  return async function request<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const path = safePath(url);
    for (let attempt = 0; ; attempt++) {
      await limiter.take();
      let res: Response;
      try {
        res = await doFetch(url, {
          method: init.method ?? 'GET',
          headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...opts.headers },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt >= maxRetries) throw new SourceError('network', 0, path);
        await sleep(backoffMs(attempt, null));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxRetries) throw new SourceError(res.status === 429 ? 'rate_limited' : 'http', res.status, path);
        await sleep(backoffMs(attempt, res.headers.get('retry-after')));
        continue;
      }
      if (res.status === 401) throw new SourceError('auth', 401, path);
      if (res.status === 403) throw new SourceError('scope', 403, path);
      if (!res.ok) throw new SourceError('http', res.status, path);
      return (await res.json()) as T;
    }
  };
}

export type HttpRequest = ReturnType<typeof createHttpClient>;

/** Ruta sin query ni host (para errores: la query puede traer datos). */
function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

// ---------- Utilidades de normalización ----------

/** HTML simple → texto (notas de HubSpot y Pipedrive vienen en HTML). */
export function htmlToText(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Nombre de campo nuestro (/^[a-z][a-z0-9_]*$/, 64) desde una clave o etiqueta ajena. */
export function fieldNameFrom(raw: string): string {
  let s = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(s)) s = `f_${s}`;
  return s.slice(0, 64).replace(/_+$/, '') || 'field';
}

/** Dominio desde un website o email ('' si no hay). */
export function domainFromUrl(raw: string | null | undefined): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#:].*$/, '');
}

/** Fecha ISO o 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DD' ('' si no se entiende). */
export function ymd(raw: string | null | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((raw ?? '').trim());
  return m ? m[1] : '';
}

/** Timestamp (ISO, ms epoch o 'YYYY-MM-DD HH:MM:SS' UTC) → 'YYYY-MM-DD HH:MM:SS' de la base ('' si no). */
export function dbTimestamp(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '';
  let d: Date;
  if (typeof raw === 'number' || /^\d{10,}$/.test(String(raw))) d = new Date(Number(raw));
  else {
    const s = String(raw).trim();
    d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  }
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

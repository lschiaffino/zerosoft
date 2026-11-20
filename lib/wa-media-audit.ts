/**
 * Trabajo de mantenimiento `wa-media-audit` (lib/maintenance-jobs.ts), solo `dry`: cuenta, por línea de WhatsApp
 * de Inbox y Lines, cuántos archivos recibidos dependen todavía del servidor de WhatsApp (Evolution) y lista las
 * instancias del servidor con cuántas filas guarda cada una. No escribe nada ni llama a ninguna ruta que cambie algo
 * (solo GET /instance/fetchInstances). Es el paso previo a podar la tabla `Message` de Evolution o a borrar una
 * instancia vieja (docs/design/evolution-disk-retention.md).
 *
 * Por archivo, una de tres:
 *   stored  zerosoft ya tiene su copia (Inbox: inbox_media_files; Lines: media_url guardada, no "evo:").
 *   wire    no hay copia, pero zerosoft guardó la clave del archivo (media_ref.wire / meta.mediaWire): se puede bajar
 *           de WhatsApp sin que Evolution tenga el mensaje (lib/wa-media-wire.ts).
 *   bare    ni copia ni clave: la única forma de bajarlo es que la instancia actual de la línea tenga la fila en
 *           `Message`. Podar esa fila lo pierde.
 * Cada cuenta va por antigüedad del mensaje: recent (menos de 30 días), mid (30 a 90), old (más de 90).
 *
 * El informe tiene solo cuentas, ids internos de línea y el principio del nombre de la instancia ("zs-a1c79", lo que
 * se ve en Railway). Nada de teléfonos, nombres, tokens ni contenido: de la respuesta de fetchInstances se leen solo
 * nombre, estado y `_count`. Server-only.
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import { open } from './secret-box';

export interface AgeCounts {
  recent: number;
  mid: number;
  old: number;
}

export interface MediaCounts {
  total: AgeCounts;
  stored: AgeCounts;
  wire: AgeCounts;
  bare: AgeCounts;
}

export interface LineMedia extends MediaCounts {
  app: 'inbox' | 'lines';
  id: string;
  provider: string;
  status: string;
  /** Principio del nombre de la instancia (8 caracteres), o '' si la línea no tiene. */
  instance: string;
}

export interface InstanceInfo {
  server: string;
  /** Principio del nombre (8 caracteres). */
  name: string;
  status: string;
  messages: number;
  contacts: number;
  chats: number;
  /** Qué línea de zerosoft la usa hoy; '' si ninguna (huérfana: zerosoft no le pide nada). */
  usedBy: '' | 'inbox' | 'lines';
}

export interface MediaAuditState {
  phase: 'inbox' | 'lines' | 'instances' | 'done';
  cursor: string;
  /** Una fila por línea (hasta MAX_LINES; las demás solo suman a los totales). */
  lines: LineMedia[];
  truncated: number;
  totals: { inbox: MediaCounts; lines: MediaCounts };
  instances: InstanceInfo[];
  /** Hash corto de cada instancia en uso → app (para marcar las huérfanas sin guardar el nombre entero). */
  used: Record<string, 'inbox' | 'lines'>;
  /** Por qué no se pudo listar instancias (código), si pasó. */
  instancesError: string;
}

/** Una instancia como la devuelve el servidor, ya reducida a lo que se puede guardar (más el nombre entero para cruzar). */
export interface RawInstance {
  server: string;
  name: string;
  status: string;
  messages: number;
  contacts: number;
  chats: number;
}

export interface MediaAuditDeps {
  /** Instancias de los servidores de zerosoft; por defecto GET /instance/fetchInstances con la clave global. */
  instances?: () => Promise<RawInstance[]>;
  /** Nombre de la instancia de una línea (descifra su config); por defecto lee la config guardada. */
  sessionOf?: (app: 'inbox' | 'lines', config: string) => string;
  /** Solo estas líneas (tests: la base es compartida). */
  only?: string[];
}

const MAX_LINES = 200;
const BATCH = 10;
const DAY = 86_400_000;

const ages = (): AgeCounts => ({ recent: 0, mid: 0, old: 0 });
const counts = (): MediaCounts => ({ total: ages(), stored: ages(), wire: ages(), bare: ages() });

export function newMediaAuditState(): MediaAuditState {
  return { phase: 'inbox', cursor: '', lines: [], truncated: 0, totals: { inbox: counts(), lines: counts() }, instances: [], used: {}, instancesError: '' };
}

const shortName = (name: string) => name.slice(0, 8);
const hashName = (name: string) => createHash('sha256').update(name).digest('hex').slice(0, 16);

function addInto(into: MediaCounts, from: MediaCounts): void {
  for (const k of ['total', 'stored', 'wire', 'bare'] as const) for (const a of ['recent', 'mid', 'old'] as const) into[k][a] += from[k][a];
}

/** Las fechas de corte como día (YYYY-MM-DD): comparan igual con "2026-11-19T…" y con "2026-11-19 12:00:00". */
function cutoffs(now: number): { d30: string; d90: string } {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { d30: day(now - 30 * DAY), d90: day(now - 90 * DAY) };
}

/**
 * SUM por categoría y antigüedad. `t` es la columna de fecha; `stored` y `wire`, condiciones SQL. Las fechas de corte
 * van en el texto (son días armados acá, YYYY-MM-DD); el id de la línea va como parámetro.
 */
function countSql(t: string, stored: string, wire: string, d30: string, d90: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d30) || !/^\d{4}-\d{2}-\d{2}$/.test(d90)) throw new Error('bad_cutoff');
  const age = (a: 'recent' | 'mid' | 'old') => (a === 'recent' ? `${t} >= '${d30}'` : a === 'mid' ? `${t} < '${d30}' AND ${t} >= '${d90}'` : `${t} < '${d90}'`);
  const cols: string[] = [];
  for (const a of ['recent', 'mid', 'old'] as const) {
    cols.push(`SUM(CASE WHEN ${age(a)} THEN 1 ELSE 0 END) AS total_${a}`);
    cols.push(`SUM(CASE WHEN ${age(a)} AND (${stored}) THEN 1 ELSE 0 END) AS stored_${a}`);
    cols.push(`SUM(CASE WHEN ${age(a)} AND NOT (${stored}) AND (${wire}) THEN 1 ELSE 0 END) AS wire_${a}`);
    cols.push(`SUM(CASE WHEN ${age(a)} AND NOT (${stored}) AND NOT (${wire}) THEN 1 ELSE 0 END) AS bare_${a}`);
  }
  return cols.join(', ');
}

function readCounts(r: Record<string, unknown> | undefined): MediaCounts {
  const out = counts();
  for (const k of ['total', 'stored', 'wire', 'bare'] as const) for (const a of ['recent', 'mid', 'old'] as const) out[k][a] = Number(r?.[`${k}_${a}`] ?? 0) || 0;
  return out;
}

const inboxSql = (d30: string, d90: string) =>
  `SELECT ${countSql('m.sent_at', 'EXISTS (SELECT 1 FROM inbox_media_files f WHERE f.message_id = m.id)', `m.media_ref LIKE '%"wire"%'`, d30, d90)}
   FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
   WHERE t.account_id = ? AND m.media_type <> '' AND m.media_ref <> '' AND m.revoked_at IS NULL`;

const linesSql = (d30: string, d90: string) =>
  `SELECT ${countSql('m.created_at', `m.media_url <> '' AND m.media_url NOT LIKE 'evo:%'`, `COALESCE(m.meta, '') LIKE '%"mediaWire"%'`, d30, d90)}
   FROM groups_messages m
   WHERE m.number_id = ? AND m.media_type <> '' AND m.provider_message_id IS NOT NULL AND m.deleted_at IS NULL`;

function defaultSessionOf(_app: 'inbox' | 'lines', config: string): string {
  try {
    const plain = open(config);
    const cfg = plain ? (JSON.parse(plain) as { session?: unknown }) : {};
    return typeof cfg.session === 'string' ? cfg.session : '';
  } catch {
    return '';
  }
}

async function defaultInstances(): Promise<RawInstance[]> {
  const { managedEnv } = await import('./groups-provider-managed');
  const { inboxBridgeEnv } = await import('./inbox/whatsapp');
  const { bridgeRequest, defaultBridgeFetch } = await import('./groups-provider-bridge');
  const servers: Array<{ server: string; baseUrl: string; globalKey: string }> = [];
  for (const [server, env] of [
    ['lines', managedEnv()],
    ['inbox', inboxBridgeEnv()],
  ] as const) {
    if (env && !servers.some((s) => s.baseUrl === env.baseUrl)) servers.push({ server, ...env });
  }
  if (!servers.length) throw new Error('no_server');
  const out: RawInstance[] = [];
  for (const s of servers) {
    const rows = await bridgeRequest(defaultBridgeFetch, `${s.baseUrl}/instance/fetchInstances`, { apikey: s.globalKey }, 'GET', undefined, { maxBytes: 16 * 1024 * 1024 });
    out.push(...parseInstances(s.server, rows));
  }
  return out;
}

/** La respuesta de fetchInstances → solo nombre, estado y cuentas (el resto trae token, teléfono y nombre del perfil). */
export function parseInstances(server: string, rows: unknown): RawInstance[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r): RawInstance[] => {
    if (!r || typeof r !== 'object') return [];
    const o = r as Record<string, unknown>;
    const inner = (o.instance && typeof o.instance === 'object' ? o.instance : {}) as Record<string, unknown>;
    const name = String(o.name ?? inner.instanceName ?? '');
    if (!name) return [];
    const c = (o._count && typeof o._count === 'object' ? o._count : {}) as Record<string, unknown>;
    const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const status = String(o.connectionStatus ?? inner.status ?? '');
    return [{ server, name, status: /^[a-z_]{1,20}$/.test(status) ? status : 'other', messages: n(c.Message), contacts: n(c.Contact), chats: n(c.Chat) }];
  });
}

/**
 * Una tanda: avanza hasta `deadline` y devuelve true al terminar. Primero las cuentas de WhatsApp de Inbox, después
 * los números de Lines con Evolution, al final las instancias de los servidores.
 */
export async function mediaAuditStep(state: MediaAuditState, opts: { deadline: number; now?: number; deps?: MediaAuditDeps }): Promise<boolean> {
  const db = getDb();
  const { d30, d90 } = cutoffs(opts.now ?? Date.now());
  const sessionOf = opts.deps?.sessionOf ?? defaultSessionOf;
  while ((state.phase === 'inbox' || state.phase === 'lines') && Date.now() < opts.deadline) {
    const app = state.phase;
    const only = opts.deps?.only;
    const scope = only ? ` AND id IN (${only.map(() => '?').join(', ') || "''"})` : '';
    const sql =
      app === 'inbox'
        ? `SELECT id, provider, status, config FROM inbox_accounts WHERE kind = 'whatsapp'${scope} AND id > ? ORDER BY id LIMIT ?`
        : `SELECT id, provider, status, config FROM groups_numbers WHERE provider IN ('managed', 'evolution')${scope} AND id > ? ORDER BY id LIMIT ?`;
    const rows = (await db.prepare(sql).all(...(only ?? []), state.cursor, BATCH)) as Array<{ id: string; provider: string; status: string; config: string }>;
    if (!rows.length) {
      state.phase = app === 'inbox' ? 'lines' : 'instances';
      state.cursor = '';
      continue;
    }
    for (const r of rows) {
      if (Date.now() >= opts.deadline) return false;
      const c = readCounts((await db.prepare(app === 'inbox' ? inboxSql(d30, d90) : linesSql(d30, d90)).get(r.id)) as Record<string, unknown> | undefined);
      const session = r.config ? sessionOf(app, r.config) : '';
      if (session) state.used[hashName(session)] = app;
      addInto(state.totals[app], c);
      if (state.lines.length < MAX_LINES) {
        state.lines.push({ app, id: r.id, provider: String(r.provider ?? '').slice(0, 20), status: String(r.status ?? '').slice(0, 20), instance: shortName(session), ...c });
      } else state.truncated++;
      state.cursor = r.id;
    }
  }
  if (state.phase === 'instances' && Date.now() < opts.deadline) {
    try {
      const list = await (opts.deps?.instances ?? defaultInstances)();
      state.instances = list.slice(0, MAX_LINES).map((i) => ({
        server: i.server,
        name: shortName(i.name),
        status: i.status,
        messages: i.messages,
        contacts: i.contacts,
        chats: i.chats,
        usedBy: state.used[hashName(i.name)] ?? '',
      }));
    } catch (err) {
      const code = err instanceof Error && /^[a-z_]{1,40}$/.test(err.message) ? err.message : err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code).slice(0, 40) : 'error';
      state.instancesError = code;
    }
    state.phase = 'done';
  }
  return state.phase === 'done';
}

const sum = (a: AgeCounts) => a.recent + a.mid + a.old;

/** La línea de log: totales por app y las instancias huérfanas (solo cuentas y principios de nombre). */
export function mediaAuditLine(s: MediaAuditState): string {
  const side = (name: string, c: MediaCounts) =>
    `${name} ${sum(c.total)} files: stored ${sum(c.stored)}, wire ${sum(c.wire)}, bare ${sum(c.bare)} (bare older than 30 days ${c.bare.mid + c.bare.old})`;
  const parts = [side('inbox', s.totals.inbox), side('lines', s.totals.lines)];
  if (s.phase === 'done') {
    if (s.instancesError) parts.push(`instances not listed (${s.instancesError})`);
    else {
      const orphans = s.instances.filter((i) => !i.usedBy);
      parts.push(`${s.instances.length} instances, ${orphans.length} not used by any line${orphans.length ? `: ${orphans.map((i) => `${i.name} ${i.status} ${i.messages} msgs`).join(', ')}` : ''}`);
    }
  }
  return `${parts.join('; ')}, phase ${s.phase}`;
}

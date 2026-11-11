/**
 * Privacidad (GDPR arts. 15, 17 y 20): exportar los datos de una cuenta y borrarla de verdad,
 * con el workspace propio, sus archivos y sus números de WhatsApp. Server-only.
 *
 * Cómo encuentra los datos sin una lista a mano de cientos de tablas: recorre el esquema.
 *
 * 1. Raíces (scopeWhere): filas cuyo workspace es el de esta persona: user_id / workspace_id
 *    del dueño, team_id que apunta (FK) a una de sus fichas, owner_id en tablas sin user_id.
 *    Una fila con user_id = la persona pero colgada de un registro de OTRO workspace (un
 *    comentario en un issue ajeno, la membresía de un board ajeno) no es raíz: es del
 *    workspace ajeno, responsable de esos datos, y queda (con la persona anonimizada).
 * 2. Hijas: lo que cuelga de una fila alcanzada, por FK declarada (CASCADE se recorre, las
 *    demás se desenganchan) o inferida por nombre (`page_id` en docs_* → docs_pages) en tablas
 *    sin columna de workspace propia.
 * 3. La fila de users no se borra: se anonimiza (email, nombre, foto, secretos). Borrarla
 *    arrastraría por CASCADE lo que la persona creó en workspaces ajenos.
 * 4. Archivos: los privados (formato exacto de cada almacenamiento, nombres aleatorios) se
 *    borran; los públicos solo si ninguna otra fila de la base los sigue usando. Van a una
 *    cola (privacy_file_queue) antes de borrar las filas, así un corte no los pierde.
 *
 * Borrar es en dos tiempos: se pide (privacy_erasures, 30 días para arrepentirse; se puede
 * exportar mientras tanto) y el cron (/api/cron/tick) lo ejecuta reclamando la fila con
 * compare-and-set; si falla, se reintenta. Las copias en backups vencen con su retención.
 */
import type { Client, InValue } from '@libsql/client';
import { getClient, getDb, type UserRow } from './db';
import { buildZip } from './zip-writer';

export const ERASURE_GRACE_DAYS = 30;
const MAX_ATTEMPTS = 5;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** Tablas internas que no son datos de nadie, o que se manejan aparte. */
const SKIP_TABLES = new Set(['schema_migrations', 'rate_limits', 'privacy_erasures', 'privacy_file_queue', 'users']);
/** Tablas de la cuenta (no del workspace): borrar el workspace no las toca. */
const ACCOUNT_TABLES = new Set(['user_sessions', 'user_mfa_recovery', 'security_events', 'team_members', 'desktop_login_codes', 'email_login_codes']);

interface Fk {
  table: string;
  from: string;
  parent: string;
  to: string;
  /** CASCADE se borra; el resto (SET NULL, NO ACTION) se desengancha. Las inferidas cuentan como CASCADE. */
  onDelete: string;
  inferred?: boolean;
}

interface Schema {
  tables: Map<string, string[]>;
  /** Hijas de cada tabla. */
  children: Map<string, Fk[]>;
  /** Padres de cada tabla (las mismas aristas al revés). */
  parents: Map<string, Fk[]>;
  withoutRowid: Set<string>;
}

const SCOPE_COLS = ['user_id', 'owner_id', 'workspace_id', 'team_id'];

/** `page_id` en una tabla docs_* → docs_pages; `link_id` → links. Solo si esa tabla existe y tiene id. */
function inferParent(table: string, col: string, tables: Map<string, string[]>): string | null {
  const m = /^([a-z0-9_]+)_id$/.exec(col);
  if (!m || col === 'user_id' || col === 'owner_id' || col === 'workspace_id' || col === 'team_id') return null;
  const stem = m[1];
  const prefix = table.split('_')[0];
  for (const cand of [`${prefix}_${stem}s`, `${prefix}_${stem}es`, `${stem}s`, `${stem}es`]) {
    if (cand !== table && tables.get(cand)?.includes('id')) return cand;
  }
  return null;
}

async function readSchema(client: Client): Promise<Schema> {
  const rows = (await client.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")).rows;
  const virtual = rows.filter((r) => /^CREATE VIRTUAL TABLE/i.test(String(r.sql ?? ''))).map((r) => String(r.name));
  const all = rows.filter((r) => !virtual.includes(String(r.name)) && !virtual.some((v) => String(r.name).startsWith(`${v}_`)));
  const tables = new Map<string, string[]>();
  const withoutRowid = new Set<string>();
  for (const r of all) {
    const name = String(r.name);
    tables.set(name, (await client.execute({ sql: 'SELECT name FROM pragma_table_info(?)', args: [name] })).rows.map((c) => String(c.name)));
    if (/WITHOUT\s+ROWID\s*$/i.test(String(r.sql ?? '').trim())) withoutRowid.add(name);
  }
  const children = new Map<string, Fk[]>();
  const parents = new Map<string, Fk[]>();
  const add = (fk: Fk) => {
    children.set(fk.parent, [...(children.get(fk.parent) ?? []), fk]);
    parents.set(fk.table, [...(parents.get(fk.table) ?? []), fk]);
  };
  for (const [name, cols] of tables) {
    const declared = (await client.execute({ sql: 'SELECT "table" AS parent, "from" AS col, "to" AS pcol, on_delete FROM pragma_foreign_key_list(?)', args: [name] })).rows;
    const seen = new Set<string>();
    for (const fk of declared) {
      const parent = String(fk.parent);
      if (!tables.has(parent)) continue;
      seen.add(String(fk.col));
      add({ table: name, from: String(fk.col), parent, to: fk.pcol === null ? 'id' : String(fk.pcol), onDelete: String(fk.on_delete ?? '').toUpperCase() });
    }
    // Sin FK declarada: solo en tablas que no tienen columna de workspace propia (hijas puras).
    if (cols.some((c) => SCOPE_COLS.includes(c))) continue;
    for (const col of cols) {
      if (seen.has(col)) continue;
      const parent = inferParent(name, col, tables);
      if (parent && !SKIP_TABLES.has(parent)) add({ table: name, from: col, parent, to: 'id', onDelete: 'CASCADE', inferred: true });
    }
  }
  return { tables, children, parents, withoutRowid };
}

export interface Scope {
  userId: string;
  /** Fichas de workspace del dueño (teams.owner_id = userId). */
  teamIds: string[];
  /** 'account': todo lo de la persona y su workspace. 'workspace': solo el workspace. */
  kind: 'account' | 'workspace';
}

async function scopeFor(userId: string, kind: Scope['kind']): Promise<Scope> {
  const teams = (await getDb().prepare('SELECT id FROM teams WHERE owner_id = ?').all(userId)) as Array<{ id: string }>;
  return { userId, teamIds: teams.map((t) => t.id), kind };
}

type Where = { sql: string; args: InValue[] };
const marks = (list: unknown[]) => list.map(() => '?').join(', ');

/** Alcance de una tabla por sus propias columnas (sin mirar padres). */
function ownScope(table: string, cols: string[], scope: Scope, fks: Fk[]): { ws: Where | null; person: Where | null } {
  const ids = [scope.userId, ...scope.teamIds];
  const teamFk = fks.some((f) => f.from === 'team_id' && f.parent === 'teams');
  const wsParts: string[] = [];
  const wsArgs: InValue[] = [];
  const wsCols: string[] = [];
  if (cols.includes('workspace_id')) {
    wsParts.push(`workspace_id IN (${marks(ids)})`);
    wsArgs.push(...ids);
    wsCols.push('workspace_id');
  }
  if (cols.includes('team_id') && teamFk) {
    if (scope.teamIds.length) {
      wsParts.push(`team_id IN (${marks(scope.teamIds)})`);
      wsArgs.push(...scope.teamIds);
    }
    wsCols.push('team_id');
  }
  if (!cols.includes('user_id') && cols.includes('owner_id')) {
    // Con columna de workspace, owner_id es la persona que lo creó (Send, Notes): solo decide sin workspace.
    const free = wsCols.map((c) => `${quote(c)} IS NULL`);
    wsParts.push(free.length ? `owner_id IN (${marks(ids)}) AND ${free.join(' AND ')}` : `owner_id IN (${marks(ids)})`);
    wsArgs.push(...ids);
  }
  const ws = wsParts.length ? { sql: wsParts.map((p) => `(${p})`).join(' OR '), args: wsArgs } : null;
  let person: Where | null = null;
  if (cols.includes('user_id')) {
    const free = wsCols.map((c) => `${quote(c)} IS NULL`);
    person = { sql: free.length ? `user_id = ? AND ${free.join(' AND ')}` : 'user_id = ?', args: [scope.userId] };
  }
  return { ws, person };
}

/**
 * WHERE de las filas raíz de `table`, o null. Una fila por user_id solo es raíz si cada padre
 * al que apunta (salvo users/teams) es también de este workspace, o no tiene.
 */
export function scopeWhere(table: string, cols: string[], scope: Scope, schema?: Pick<Schema, 'tables' | 'parents'>): Where | null {
  if (SKIP_TABLES.has(table)) return null;
  if (scope.kind === 'workspace' && ACCOUNT_TABLES.has(table)) return null;
  if (table === 'teams') return { sql: 'owner_id = ?', args: [scope.userId] };
  // Lo que hizo en workspaces ajenos queda en su registro (interés legítimo de ese workspace).
  if (table === 'security_events') {
    const t = scope.teamIds;
    return { sql: `(user_id = ? AND team_id IS NULL)${t.length ? ` OR team_id IN (${marks(t)})` : ''}`, args: [scope.userId, ...t] };
  }
  const fks = schema?.parents.get(table) ?? [];
  const { ws, person } = ownScope(table, cols, scope, fks);
  const parts: string[] = [];
  const args: InValue[] = [];
  if (ws) {
    parts.push(`(${ws.sql})`);
    args.push(...ws.args);
  }
  if (person) {
    const checks: string[] = [];
    const checkArgs: InValue[] = [];
    for (const fk of fks) {
      if (fk.parent === 'users' || fk.parent === 'teams' || !schema) continue;
      const pcols = schema.tables.get(fk.parent) ?? [];
      const p = ownScope(fk.parent, pcols, scope, schema.parents.get(fk.parent) ?? []);
      const pw = [p.ws, p.person].filter(Boolean) as Where[];
      if (!pw.length) {
        // Padre sin forma de saber de quién es: la fila no es raíz (si es nuestra, llega por el padre).
        checks.push(`${quote(fk.from)} IS NULL`);
        continue;
      }
      checks.push(`(${quote(fk.from)} IS NULL OR ${quote(fk.from)} IN (SELECT ${quote(fk.to)} FROM ${quote(fk.parent)} WHERE ${pw.map((w) => `(${w.sql})`).join(' OR ')}))`);
      for (const w of pw) checkArgs.push(...w.args);
    }
    parts.push(`(${[person.sql, ...checks].join(' AND ')})`);
    args.push(...person.args, ...checkArgs);
  }
  return parts.length ? { sql: parts.join(' OR '), args } : null;
}

// ---------- Archivos ----------

function ownBlobHost(): string | null {
  const explicit = process.env.SHOP_BLOB_HOST?.trim().toLowerCase();
  if (explicit) return explicit;
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? '');
  return m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

const PRIVATE_APPS = ['hiring', 'sign', 'send', 'calls', 'books', 'assistant'] as const;
type PrivateApp = (typeof PRIVATE_APPS)[number];
const UUID_BIN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.bin';

/** Referencia exacta de un archivo privado (lib/private-files.ts): nombres aleatorios, nunca públicos. */
function privateRef(app: PrivateApp, value: string): boolean {
  const folder = app === 'books' ? 'books-private' : app;
  return (
    new RegExp(`^local:${UUID_BIN}$`).test(value) ||
    new RegExp(`^blobp:${folder}/${UUID_BIN}$`).test(value) ||
    new RegExp(`^blobe:https://[a-z0-9]+\\.public\\.blob\\.vercel-storage\\.com/${folder}/${UUID_BIN}$`).test(value)
  );
}

function uploadPattern(): RegExp {
  const host = ownBlobHost();
  return host ? new RegExp(`https://${host.replace(/\./g, '\\.')}/[A-Za-z0-9._/-]+|/uploads/[a-z]+/[A-Za-z0-9._-]+`, 'g') : /\/uploads\/[a-z]+\/[A-Za-z0-9._-]+/g;
}

function collectFiles(table: string, row: Record<string, unknown>, out: Map<string, string>): void {
  const app = table.split('_')[0] as PrivateApp;
  const re = uploadPattern();
  for (const v of Object.values(row)) {
    if (typeof v !== 'string' || v.length < 8) continue;
    if (PRIVATE_APPS.includes(app) && privateRef(app, v)) {
      out.set(v, app);
      continue;
    }
    for (const m of v.match(re) ?? []) out.set(m, 'public');
  }
}

async function privateRemover(app: string): Promise<((refs: string[]) => Promise<void>) | null> {
  switch (app) {
    case 'hiring':
      return (await import('./hiring/files')).deleteHiringFiles;
    case 'sign':
      return (await import('./sign/files')).deleteSignFiles;
    case 'send':
      return (await import('./send/files')).deleteSendFiles;
    case 'calls':
      return (await import('./calls/files')).deleteCallFiles;
    case 'books':
      return (await import('./books-files')).deleteBooksFiles;
    case 'assistant':
      return (await import('./assistant/files')).deleteAssistantFiles;
    default:
      return null;
  }
}

/** URLs públicas de la cola que alguna fila de la base todavía usa (copiadas a otro registro o workspace). */
async function stillReferenced(client: Client, schema: Schema, urls: Set<string>): Promise<Set<string>> {
  const found = new Set<string>();
  if (!urls.size) return found;
  const host = ownBlobHost();
  const re = uploadPattern();
  for (const [table, cols] of schema.tables) {
    // La cola misma (y las tablas internas) no cuentan como uso.
    if (SKIP_TABLES.has(table)) continue;
    for (const col of cols) {
      let last: unknown = null;
      for (;;) {
        const page = schema.withoutRowid.has(table)
          ? null
          : (
              await client
                .execute({
                  sql: `SELECT rowid AS rid, ${quote(col)} AS v FROM ${quote(table)} WHERE ${last === null ? '1' : 'rowid > ?'} AND typeof(${quote(col)}) = 'text'
                          AND (${quote(col)} LIKE '%/uploads/%'${host ? ` OR ${quote(col)} LIKE ?` : ''}) ORDER BY rowid LIMIT 500`,
                  args: [...(last === null ? [] : [last as InValue]), ...(host ? [`%${host}%`] : [])],
                })
                .catch(() => null)
            )?.rows;
        if (!page?.length) break;
        for (const r of page) {
          last = r.rid;
          for (const m of String(r.v).match(re) ?? []) if (urls.has(m)) found.add(m);
        }
        if (page.length < 500) break;
      }
    }
  }
  return found;
}

/** Procesa la cola de archivos del borrado. true si quedó vacía. */
async function drainFiles(client: Client, schema: Schema, erasureId: string): Promise<{ deleted: number; kept: number }> {
  const db = getDb();
  const queued = (await db.prepare('SELECT ref, app FROM privacy_file_queue WHERE erasure_id = ?').all(erasureId)) as Array<{ ref: string; app: string }>;
  const publicRefs = new Set(queued.filter((q) => q.app === 'public').map((q) => q.ref));
  const keep = await stillReferenced(client, schema, publicRefs);
  let deleted = 0;
  const toDelete = queued.filter((q) => !keep.has(q.ref));
  const publics = toDelete.filter((q) => q.app === 'public').map((q) => q.ref);
  if (publics.length) {
    const { deleteUploads } = await import('./uploads');
    for (let i = 0; i < publics.length; i += 200) await deleteUploads(publics.slice(i, i + 200));
    deleted += publics.length;
  }
  for (const app of PRIVATE_APPS) {
    const refs = toDelete.filter((q) => q.app === app).map((q) => q.ref);
    if (!refs.length) continue;
    const remove = await privateRemover(app);
    if (remove) await remove(refs);
    deleted += refs.length;
  }
  await db.prepare('DELETE FROM privacy_file_queue WHERE erasure_id = ?').run(erasureId);
  return { deleted, kept: keep.size };
}

// ---------- Recorrido ----------

const PAGE = 500;

async function readRows(client: Client, schema: Schema, table: string, where: Where, each: (rows: Array<Record<string, unknown>>) => void | Promise<void>): Promise<void> {
  if (schema.withoutRowid.has(table)) {
    let offset = 0;
    for (;;) {
      const rows = (await client.execute({ sql: `SELECT * FROM ${quote(table)} WHERE ${where.sql} LIMIT ${PAGE} OFFSET ${offset}`, args: where.args })).rows as unknown as Array<Record<string, unknown>>;
      await each(rows);
      if (rows.length < PAGE) return;
      offset += PAGE;
    }
  }
  let last: InValue = -1;
  for (;;) {
    const rows = (await client.execute({ sql: `SELECT rowid AS __rid, * FROM ${quote(table)} WHERE rowid > ? AND (${where.sql}) ORDER BY rowid LIMIT ${PAGE}`, args: [last, ...where.args] })).rows as unknown as Array<Record<string, unknown>>;
    await each(rows);
    if (rows.length < PAGE) return;
    last = rows[rows.length - 1].__rid as InValue;
  }
}

/** Recorre `table` (filas que cumplen `where`) y, antes, sus hijas. */
async function walk(
  client: Client,
  schema: Schema,
  table: string,
  where: Where,
  mode: 'erase' | 'export',
  visit: (table: string, where: Where) => Promise<void>,
  path: string[],
  narrow?: (table: string, where: Where) => Where,
): Promise<void> {
  if (path.includes(table) || path.length > 6 || SKIP_TABLES.has(table)) return;
  // El export acota cada tabla antes de bajar a sus hijas: lo que no sale tampoco arrastra lo suyo.
  if (narrow) where = narrow(table, where);
  for (const fk of schema.children.get(table) ?? []) {
    if (fk.table === table || SKIP_TABLES.has(fk.table)) continue;
    const childWhere = { sql: `${quote(fk.from)} IN (SELECT ${quote(fk.to)} FROM ${quote(table)} WHERE ${where.sql})`, args: where.args };
    if (fk.onDelete !== 'CASCADE') {
      // Como haría la base con las FK prendidas: la fila hija (de quien sea) queda, sin la referencia.
      if (mode === 'erase') await client.execute({ sql: `UPDATE ${quote(fk.table)} SET ${quote(fk.from)} = NULL WHERE ${childWhere.sql}`, args: childWhere.args }).catch(() => undefined);
      continue;
    }
    await walk(client, schema, fk.table, childWhere, mode, visit, [...path, table], narrow);
  }
  await visit(table, where);
}

function rootOrder(schema: Schema): string[] {
  // La ficha del workspace al final: muchas tablas cuelgan de ella.
  return [...schema.tables.keys()].sort((a, b) => Number(a === 'teams') - Number(b === 'teams'));
}

// ---------- Borrado ----------

export interface ErasureStats {
  rows: number;
  files: number;
  filesKept: number;
  tables: number;
  whatsapp: number;
}

/** Cierra lo que vive fuera de la base: números de WhatsApp (Evolution) y cuentas de Inbox. */
async function disconnectExternal(ownerId: string, stats: ErasureStats): Promise<void> {
  const db = getDb();
  const numbers = (await db.prepare('SELECT id FROM groups_numbers WHERE user_id = ?').all(ownerId).catch(() => [])) as Array<{ id: string }>;
  if (numbers.length) {
    const { deleteNumber } = await import('./groups');
    // deleteNumber borra la instancia (o la deja en la cola de borrado si el bridge no responde).
    for (const n of numbers) if (await deleteNumber(ownerId, n.id)) stats.whatsapp++;
  }
  const accounts = (await db.prepare('SELECT id FROM inbox_accounts WHERE owner_id = ?').all(ownerId).catch(() => [])) as Array<{ id: string }>;
  if (accounts.length) {
    const { getAccount } = await import('./inbox/core');
    const { disconnectWhatsapp } = await import('./inbox/whatsapp');
    const { disconnectGmail } = await import('./inbox/gmail');
    for (const a of accounts) {
      const account = await getAccount(ownerId, a.id);
      if (account.kind === 'whatsapp') {
        await disconnectWhatsapp(account);
        stats.whatsapp++;
      } else await disconnectGmail(account);
    }
  }
}

/** La fila de la cuenta queda sin nada que identifique a la persona (lo que creó en workspaces ajenos la sigue nombrando así). */
async function anonymizeUser(client: Client, userId: string): Promise<void> {
  const cols = (await client.execute({ sql: 'SELECT name FROM pragma_table_info(?)', args: ['users'] })).rows.map((c) => String(c.name));
  const ghost = `deleted-${userId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}@deleted.invalid`;
  const sets: string[] = ['email = ?'];
  const args: InValue[] = [ghost];
  if (cols.includes('email_norm')) {
    sets.push('email_norm = ?');
    args.push(ghost);
  }
  for (const c of cols) {
    if (['id', 'email', 'email_norm', 'created_at'].includes(c)) continue;
    sets.push(`${quote(c)} = NULL`);
  }
  await client.execute({ sql: `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, args: [...args, userId] }).catch(async () => {
    // Alguna columna NOT NULL: al menos los datos personales.
    await client.execute({ sql: 'UPDATE users SET email = ?, name = NULL, image = NULL WHERE id = ?', args: [ghost, userId] });
  });
}

/**
 * Borra de verdad. 'account': sale de los workspaces ajenos, cierra sesiones, cierra números y
 * cuentas conectadas, borra todo lo suyo y de su workspace (filas, hijas, archivos) y anonimiza
 * la cuenta. 'workspace': lo mismo pero deja la cuenta y sus membresías en workspaces ajenos.
 * Es idempotente: si se corta, se vuelve a correr y sigue.
 */
export async function eraseNow(userId: string, kind: Scope['kind'], erasureId: string = `adhoc_${userId}`, client: Client = getClient()): Promise<ErasureStats> {
  const stats: ErasureStats = { rows: 0, files: 0, filesKept: 0, tables: 0, whatsapp: 0 };
  const db = getDb();
  const email = ((await db.prepare('SELECT email FROM users WHERE id = ?').get(userId)) as { email: string } | undefined)?.email ?? null;
  if (kind === 'account') {
    const elsewhere = (await db
      .prepare('SELECT m.team_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? AND t.owner_id != ?')
      .all(userId, userId)) as Array<{ team_id: string }>;
    const { removeMember } = await import('./teams');
    for (const m of elsewhere) await removeMember(m.team_id, userId);
    const { revokeOtherSessions } = await import('./account-security');
    await revokeOtherSessions(userId, null);
  }
  await disconnectExternal(userId, stats);
  const scope = await scopeFor(userId, kind);
  const schema = await readSchema(client);
  for (const table of rootOrder(schema)) {
    const where = scopeWhere(table, schema.tables.get(table)!, scope, schema);
    if (!where) continue;
    await walk(client, schema, table, where, 'erase', async (t, w) => {
      // Primero a la cola los archivos de estas filas, después se borran las filas.
      const files = new Map<string, string>();
      await readRows(client, schema, t, w, (rows) => rows.forEach((r) => collectFiles(t, r, files)));
      for (const [ref, app] of files) {
        await client.execute({ sql: 'INSERT OR IGNORE INTO privacy_file_queue (erasure_id, ref, app) VALUES (?, ?, ?)', args: [erasureId, ref, app] });
      }
      const res = await client.execute({ sql: `DELETE FROM ${quote(t)} WHERE ${w.sql}`, args: w.args });
      if (res.rowsAffected) {
        stats.rows += res.rowsAffected;
        stats.tables++;
      }
    }, []);
  }
  if (kind === 'account') {
    if (email) await client.execute({ sql: 'DELETE FROM email_login_codes WHERE email = ?', args: [email.toLowerCase()] }).catch(() => undefined);
    await anonymizeUser(client, userId);
  }
  const files = await drainFiles(client, schema, erasureId);
  stats.files = files.deleted;
  stats.filesKept = files.kept;
  return stats;
}

// ---------- Pedidos de borrado (30 días) ----------

export interface ErasureRow {
  id: string;
  kind: 'account' | 'workspace';
  user_id: string;
  requested_by: string;
  requested_at: string;
  due_at: string;
  claimed_at: string | null;
  done_at: string | null;
  cancelled_at: string | null;
  stats: string | null;
  attempts?: number | null;
}

export async function pendingErasure(userId: string): Promise<ErasureRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM privacy_erasures WHERE user_id = ? AND done_at IS NULL AND cancelled_at IS NULL ORDER BY requested_at DESC LIMIT 1')
    .get(userId)) as ErasureRow | undefined) ?? null;
}

export async function requestErasure(userId: string, kind: Scope['kind'], requestedBy: string, now = Date.now()): Promise<ErasureRow> {
  const existing = await pendingErasure(userId);
  // Pedir borrar la cuenta cuando ya estaba pedido el workspace la amplía (y mantiene la fecha).
  if (existing && (existing.kind === kind || existing.kind === 'account')) return existing;
  const db = getDb();
  if (existing) await db.prepare('UPDATE privacy_erasures SET cancelled_at = ? WHERE id = ? AND claimed_at IS NULL').run(new Date(now).toISOString(), existing.id);
  const id = `er_${crypto.randomUUID()}`;
  const due = existing ? existing.due_at : new Date(now + ERASURE_GRACE_DAYS * 86_400_000).toISOString();
  await db
    .prepare('INSERT INTO privacy_erasures (id, kind, user_id, requested_by, requested_at, due_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, kind, userId, requestedBy, new Date(now).toISOString(), due);
  return (await pendingErasure(userId))!;
}

/** Cancela mientras no esté corriendo (o si el reclamo quedó colgado). */
export async function cancelErasure(userId: string, now = Date.now()): Promise<ErasureRow | null> {
  const pending = await pendingErasure(userId);
  if (!pending) return null;
  const res = await getDb()
    .prepare('UPDATE privacy_erasures SET cancelled_at = ? WHERE id = ? AND done_at IS NULL AND cancelled_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?)')
    .run(new Date(now).toISOString(), pending.id, new Date(now - CLAIM_STALE_MS).toISOString());
  return res.changes > 0 ? pending : null;
}

const CLAIM_STALE_MS = 30 * 60_000;

/** Cron: ejecuta un borrado vencido por corrida (reclamado con compare-and-set; si falla, se reintenta). */
export async function runDueErasures(now = Date.now(), limit = 1): Promise<number> {
  const db = getDb();
  const due = (await db
    .prepare(
      `SELECT * FROM privacy_erasures WHERE done_at IS NULL AND cancelled_at IS NULL AND due_at <= ?
         AND (claimed_at IS NULL OR claimed_at < ?) AND COALESCE(attempts, 0) < ? ORDER BY due_at LIMIT ?`,
    )
    .all(new Date(now).toISOString(), new Date(now - CLAIM_STALE_MS).toISOString(), MAX_ATTEMPTS, limit)) as ErasureRow[];
  let done = 0;
  for (const row of due) {
    const claimedAt = new Date(now).toISOString();
    const claim = await db
      .prepare(
        `UPDATE privacy_erasures SET claimed_at = ?, attempts = COALESCE(attempts, 0) + 1
         WHERE id = ? AND done_at IS NULL AND cancelled_at IS NULL AND (claimed_at IS NULL OR claimed_at = ?)`,
      )
      .run(claimedAt, row.id, row.claimed_at);
    if (claim.changes !== 1) continue;
    try {
      const stats = await eraseNow(row.user_id, row.kind, row.id);
      await db.prepare('UPDATE privacy_erasures SET done_at = ?, stats = ? WHERE id = ?').run(new Date().toISOString(), JSON.stringify(stats), row.id);
      const { recordSecurityEvent } = await import('./account-security');
      // Sin datos de la persona: queda que hubo un borrado y cuánto se borró.
      await recordSecurityEvent({ userId: null, action: row.kind === 'account' ? 'account.deleted' : 'workspace.deleted', meta: { erasure: row.id, ...stats }, ip: null, userAgent: null });
      done++;
    } catch (err) {
      // Se suelta el reclamo para reintentar en la próxima corrida (hasta MAX_ATTEMPTS).
      const message = err instanceof Error ? err.message.slice(0, 300) : 'error';
      console.error('[privacy] erasure failed', row.id, message);
      await db.prepare('UPDATE privacy_erasures SET claimed_at = NULL, last_error = ? WHERE id = ? AND claimed_at = ?').run(message, row.id, claimedAt);
    }
  }
  return done;
}

// ---------- Exportar ----------

/** Columnas que nunca salen en un export (secretos, hashes, tokens, claves). */
export function secretColumn(col: string): boolean {
  return /(secret|token|password|hash|_key$|^key$|^auth$|^p256dh$|^config$|^secrets$|^mfa_|salt$|verifier$)/i.test(col);
}

function exportValue(col: string, v: unknown): unknown {
  if (secretColumn(col)) return v === null || v === undefined ? v : '[omitted]';
  if (typeof v === 'string' && /enc:v[12]:|cred:v[12]:/.test(v)) return '[encrypted secret omitted]';
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return '[binary]';
  return v;
}

/** Comentarios y mensajes con su columna de autor (la persona, no el workspace). */
const OWN_CONTENT: Record<string, string> = {
  docs_comments: 'user_id',
  track_issue_comments: 'user_id',
  track_plan_update_comments: 'user_id',
  talk_messages: 'user_id',
  talk_list_comments: 'user_id',
  rec_comments: 'user_id',
  roadmap_comments: 'user_id',
  link_comments: 'author_id',
  board_comments: 'author_id',
  design_comments: 'author_id',
  groups_messages: 'author_id',
};

/**
 * Contenido de cada persona del workspace que el dueño no ve en la app (Notes, Voice, el
 * asistente, los videos de Rec en el espacio personal, DMs y canales privados de Talk de los
 * que no es parte, equipos privados de Track, teamspaces cerrados o privados de Docs): en el
 * export de una cuenta sale solo lo que esa persona ve. El borrado del workspace sí lo alcanza
 * entero (no usa esto). `cols`: columnas que la regla necesita en la tabla.
 */
const PERSONAL_EXPORT: Record<string, { cols: string[]; where: (me: string) => Where }> = {
  notes: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  note_notebooks: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  note_reminders: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  note_saved_searches: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  note_templates: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  note_versions: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  note_prefs: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  note_shares: { cols: ['owner_id', 'person_id'], where: (me) => ({ sql: '(owner_id = ? OR person_id = ?)', args: [me, me] }) },
  note_access_requests: { cols: ['requester_id'], where: (me) => ({ sql: 'requester_id = ?', args: [me] }) },
  voice_sessions: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  voice_folders: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  voice_settings: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  voice_templates: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  voice_shares: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  voice_dictionary: { cols: ['person_id', 'shared'], where: (me) => ({ sql: '(person_id = ? OR shared = 1)', args: [me] }) },
  voice_prompts: { cols: ['person_id', 'shared'], where: (me) => ({ sql: '(person_id = ? OR shared = 1)', args: [me] }) },
  assistant_conversations: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  assistant_actions: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  assistant_audit: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  assistant_files: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  calls_prefs: { cols: ['person_id'], where: (me) => ({ sql: 'person_id = ?', args: [me] }) },
  rec_videos: { cols: ['space', 'created_by'], where: (me) => ({ sql: "(space != 'personal' OR created_by = ?)", args: [me] }) },
  rec_folders: { cols: ['space', 'created_by'], where: (me) => ({ sql: "(space != 'personal' OR created_by = ?)", args: [me] }) },
  // Talk: lo de cada persona (borradores, programados, guardados, recordatorios, resúmenes de IA, secciones).
  ...Object.fromEntries(
    [
      'talk_agent_runs',
      'talk_ai_summaries',
      'talk_drafts',
      'talk_scheduled',
      'talk_saved',
      'talk_reminders',
      'talk_sections',
      'talk_section_items',
      'talk_prefs',
      'talk_thread_follows',
      'talk_email_queue',
    ].map((t) => [t, { cols: ['user_id'], where: (me: string) => ({ sql: 'user_id = ?', args: [me] }) }]),
  ),
  talk_channels: {
    cols: ['id', 'kind'],
    where: (me) => ({ sql: "(kind = 'public' OR id IN (SELECT channel_id FROM talk_members WHERE user_id = ?))", args: [me] }),
  },
  track_projects: {
    cols: ['id', 'visibility'],
    where: (me) => ({
      sql: "(COALESCE(visibility, 'workspace') <> 'private' OR id IN (SELECT project_id FROM track_project_access WHERE user_id = ?))",
      args: [me],
    }),
  },
  // Track: el audit log de equipos privados, como en Ajustes › Audit log.
  track_audit_log: {
    cols: ['project_id'],
    where: (me) => ({
      sql: `(project_id IS NULL OR project_id IN (SELECT id FROM track_projects WHERE COALESCE(visibility, 'workspace') <> 'private'
        OR id IN (SELECT project_id FROM track_project_access WHERE user_id = ?)))`,
      args: [me],
    }),
  },
  // Board: las notas del modo privado son de quien las escribió hasta que se revelan.
  board_private_drafts: { cols: ['author'], where: (me) => ({ sql: 'author = ?', args: [me] }) },
  // Flow y webhooks: los datos de una corrida o entrega se armaron con el acceso de quien la creó.
  flow_runs: { cols: ['captured_by'], where: (me) => ({ sql: '(captured_by IS NULL OR captured_by = ?)', args: [me] }) },
  webhook_deliveries: { cols: ['captured_by'], where: (me) => ({ sql: '(captured_by IS NULL OR captured_by = ?)', args: [me] }) },
  docs_pages: {
    cols: ['teamspace_id'],
    where: (me) => ({
      sql: `(teamspace_id IS NULL OR teamspace_id NOT IN (SELECT t.id FROM docs_teamspaces t WHERE t.access IN ('closed', 'private') AND t.is_default = 0
        AND NOT EXISTS (SELECT 1 FROM docs_teamspace_members m WHERE m.teamspace_id = t.id AND m.user_id = ?)))`,
      args: [me],
    }),
  },
};

/**
 * La condición de `table`: su regla propia y, para lo que cuelga (FK) de una tabla con regla
 * (archivos de una nota, mensajes de un canal, comentarios de un issue), la de sus padres.
 */
function personalRule(table: string, schema: Pick<Schema, 'tables' | 'parents'>, me: string, visiting: Set<string> = new Set()): Where | null {
  if (visiting.has(table)) return null;
  visiting.add(table);
  const parts: string[] = [];
  const args: InValue[] = [];
  const cols = schema.tables.get(table) ?? [];
  const own = PERSONAL_EXPORT[table];
  if (own && own.cols.every((c) => cols.includes(c))) {
    const w = own.where(me);
    parts.push(w.sql);
    args.push(...w.args);
  }
  for (const fk of schema.parents.get(table) ?? []) {
    if (fk.parent === table || fk.parent === 'users' || fk.parent === 'teams') continue;
    const rule = personalRule(fk.parent, schema, me, visiting);
    if (!rule) continue;
    parts.push(`(${quote(fk.from)} IS NULL OR ${quote(fk.from)} IN (SELECT ${quote(fk.to)} FROM ${quote(fk.parent)} WHERE ${rule.sql}))`);
    args.push(...rule.args);
  }
  visiting.delete(table);
  return parts.length ? { sql: parts.join(' AND '), args } : null;
}

/** `where` de una tabla del export, acotado a lo que la persona ve (ver PERSONAL_EXPORT). */
export function personalExportWhere(
  table: string,
  schema: Pick<Schema, 'tables' | 'parents'>,
  where: Where,
  me: string,
  cache: Map<string, Where | null> = new Map(),
): Where {
  if (!cache.has(table)) cache.set(table, personalRule(table, schema, me));
  const rule = cache.get(table) ?? null;
  return rule ? { sql: `(${where.sql}) AND ${rule.sql}`, args: [...where.args, ...rule.args] } : where;
}

export interface ExportResult {
  zip: Buffer;
  tables: number;
  rows: number;
}

/**
 * Todo lo de la cuenta y su workspace en un zip: un JSON por tabla (las filas raíz y lo que
 * cuelga de ellas, sin secretos), más un README. Es el mismo recorrido que el borrado.
 */
export async function exportAccountData(user: UserRow, client: Client = getClient()): Promise<ExportResult> {
  const scope = await scopeFor(user.id, 'account');
  const schema = await readSchema(client);
  const out = new Map<string, Map<string, Record<string, unknown>>>();
  const keep = (table: string, rows: Array<Record<string, unknown>>) => {
    const cols = schema.tables.get(table) ?? [];
    const bucket = out.get(table) ?? new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const key = String(r.__rid ?? JSON.stringify(cols.map((c) => r[c])));
      bucket.set(key, Object.fromEntries(cols.map((c) => [c, exportValue(c, r[c])])));
    }
    out.set(table, bucket);
  };
  const me = (await client.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [user.id] })).rows as unknown as Array<Record<string, unknown>>;
  keep('users', me);
  const rules = new Map<string, Where | null>();
  for (const table of rootOrder(schema)) {
    const where = scopeWhere(table, schema.tables.get(table)!, scope, schema);
    if (!where) continue;
    await walk(
      client,
      schema,
      table,
      where,
      'export',
      async (t, w) => readRows(client, schema, t, w, (rows) => keep(t, rows)),
      [],
      (t, w) => personalExportWhere(t, schema, w, user.id, rules),
    );
  }
  const files: Array<{ name: string; data: string; deflate: boolean }> = [];
  let rows = 0;
  for (const [table, bucket] of out) {
    if (!bucket.size) continue;
    rows += bucket.size;
    files.push({ name: `tables/${table}.json`, data: JSON.stringify([...bucket.values()], null, 1), deflate: true });
  }
  // Lo que la persona escribió en workspaces ajenos (art. 15): solo sus propios comentarios y
  // mensajes, sin la página, el issue o el canal de ese workspace.
  for (const [table, col] of Object.entries(OWN_CONTENT)) {
    const cols = schema.tables.get(table);
    if (!cols?.includes(col)) continue;
    const already = out.get(table);
    const mine: Array<Record<string, unknown>> = [];
    await readRows(client, schema, table, { sql: `${quote(col)} = ?`, args: [user.id] }, (list) => {
      for (const r of list) {
        if (already?.has(String(r.__rid))) continue;
        mine.push(Object.fromEntries(cols.map((c) => [c, exportValue(c, r[c])])));
      }
    });
    if (!mine.length) continue;
    rows += mine.length;
    files.push({ name: `other-workspaces/${table}.json`, data: JSON.stringify(mine, null, 1), deflate: true });
  }
  const readme = [
    'zerosoft data export',
    `Account: ${user.email}`,
    `Created: ${new Date().toISOString()}`,
    '',
    'One JSON file per table with the rows of your account, of the workspace you own and what hangs from them.',
    'other-workspaces/ has the comments and messages you wrote in workspaces owned by someone else.',
    'Secrets (tokens, keys, password hashes) are omitted. Files you uploaded are linked by URL in the rows;',
    'each app also has its own export (CSV, Markdown, ZIP) in its settings.',
    '',
  ].join('\n');
  const zip = buildZip([{ name: 'README.txt', data: readme }, ...files]);
  return { zip, tables: files.length, rows };
}

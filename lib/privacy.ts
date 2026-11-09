/**
 * Privacidad (GDPR arts. 15, 17 y 20): exportar los datos de una cuenta y borrarla de verdad,
 * con el workspace propio, sus archivos y sus números de WhatsApp. Server-only.
 *
 * Cómo encuentra los datos sin una lista a mano de 300 tablas: recorre el esquema.
 * - Filas con user_id / workspace_id del dueño o team_id de su ficha (ver scopeWhere): así
 *   se guarda todo en la suite ("workspace" = user_id del dueño, ver lib/ai.ts).
 * - Hijas por clave foránea: lo que cuelga de una fila borrada (clicks de un link, mensajes
 *   de un chat) se borra antes, aunque la base no tenga activadas las FK.
 * - Archivos: antes de borrar, las filas se recorren buscando URLs de nuestro Blob, rutas de
 *   /uploads y referencias de archivos privados, y se borran del almacenamiento.
 *
 * Borrar es en dos tiempos: se pide (privacy_erasures, 30 días para arrepentirse; la persona
 * puede exportar mientras tanto) y el cron (/api/cron/tick) lo ejecuta reclamando la fila con
 * compare-and-set. Las copias en backups del proveedor vencen con su ventana de retención.
 */
import type { Client } from '@libsql/client';
import { getClient, getDb, type UserRow } from './db';
import { buildZip } from './zip-writer';

export const ERASURE_GRACE_DAYS = 30;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** Tablas internas que no son datos de nadie (o que se manejan aparte). */
const SKIP_TABLES = new Set(['schema_migrations', 'rate_limits', 'privacy_erasures']);
/** Tablas de la cuenta (no del workspace): borrar el workspace no las toca. */
const ACCOUNT_TABLES = new Set(['users', 'user_sessions', 'user_mfa_recovery', 'security_events', 'team_members', 'desktop_login_codes', 'email_login_codes']);

interface Fk {
  table: string;
  from: string;
  parent: string;
  to: string;
  /** Lo que declara la FK: CASCADE se borra; el resto (SET NULL, NO ACTION) se desengancha. */
  onDelete: string;
}

interface Schema {
  tables: Map<string, string[]>;
  /** Hijas de cada tabla (por clave foránea declarada). */
  children: Map<string, Fk[]>;
}

async function readSchema(client: Client): Promise<Schema> {
  const rows = (await client.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")).rows;
  const virtual = rows.filter((r) => /^CREATE VIRTUAL TABLE/i.test(String(r.sql ?? ''))).map((r) => String(r.name));
  const names = rows
    .map((r) => String(r.name))
    .filter((n) => !SKIP_TABLES.has(n) && !virtual.includes(n) && !virtual.some((v) => n.startsWith(`${v}_`)));
  const tables = new Map<string, string[]>();
  const children = new Map<string, Fk[]>();
  for (const name of names) {
    const cols = (await client.execute({ sql: 'SELECT name FROM pragma_table_info(?)', args: [name] })).rows.map((c) => String(c.name));
    tables.set(name, cols);
    const fks = (await client.execute({ sql: 'SELECT "table" AS parent, "from" AS col, "to" AS pcol, on_delete FROM pragma_foreign_key_list(?)', args: [name] })).rows;
    for (const fk of fks) {
      const parent = String(fk.parent);
      const list = children.get(parent) ?? [];
      list.push({ table: name, from: String(fk.col), parent, to: fk.pcol === null ? 'rowid' : String(fk.pcol), onDelete: String(fk.on_delete ?? '').toUpperCase() });
      children.set(parent, list);
    }
  }
  return { tables, children };
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

/**
 * WHERE de las filas de `table` que caen en el alcance, o null si la tabla no tiene cómo.
 *
 * - user_id es la clave del workspace en casi toda la suite (el id del dueño); en tablas de
 *   personas (miembros, preferencias) es la persona: en los dos casos, si es esta persona, es
 *   suyo o de su workspace.
 * - workspace_id manda cuando está: una fila de otro workspace no se toca aunque su user_id
 *   sea esta persona (es del workspace ajeno, responsable de esos datos).
 * - team_id solo cuenta si es una ficha de este dueño (equipos de antes de 128).
 * - owner_id solo cuenta en tablas sin user_id (inbox_accounts): en el CRM es "dueño del
 *   registro", una persona, y no dice de qué workspace es la fila.
 */
export function scopeWhere(table: string, cols: string[], scope: Scope): { sql: string; args: string[] } | null {
  if (scope.kind === 'workspace' && ACCOUNT_TABLES.has(table)) return null;
  if (table === 'users') return scope.kind === 'account' ? { sql: 'id = ?', args: [scope.userId] } : null;
  if (table === 'teams') return { sql: 'owner_id = ?', args: [scope.userId] };
  // Lo que hizo en workspaces ajenos queda en su registro (interés legítimo de ese workspace).
  if (table === 'security_events') {
    const t = scope.teamIds;
    return { sql: `(user_id = ? AND team_id IS NULL)${t.length ? ` OR team_id IN (${t.map(() => '?').join(', ')})` : ''}`, args: [scope.userId, ...t] };
  }
  const ids = [scope.userId, ...scope.teamIds];
  const marks = (list: string[]) => list.map(() => '?').join(', ');
  const parts: string[] = [];
  const args: string[] = [];
  const hasWs = cols.includes('workspace_id');
  if (hasWs) {
    parts.push(`workspace_id IN (${marks(ids)})`);
    args.push(...ids);
  }
  if (cols.includes('user_id')) {
    parts.push(hasWs ? `(user_id = ? AND workspace_id IS NULL)` : 'user_id = ?');
    args.push(scope.userId);
  } else if (cols.includes('owner_id')) {
    parts.push(`owner_id IN (${marks(ids)})`);
    args.push(...ids);
  }
  if (cols.includes('team_id') && scope.teamIds.length) {
    parts.push(`team_id IN (${marks(scope.teamIds)})`);
    args.push(...scope.teamIds);
  }
  return parts.length ? { sql: parts.map((p) => `(${p})`).join(' OR '), args } : null;
}

// ---------- Archivos ----------

const PRIVATE_REF = /^(blobp|blobe|local):/;

function ownBlobHost(): string | null {
  const explicit = process.env.SHOP_BLOB_HOST?.trim().toLowerCase();
  if (explicit) return explicit;
  const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? '');
  return m ? `${m[1].toLowerCase()}.public.blob.vercel-storage.com` : null;
}

interface FileRefs {
  uploads: Set<string>;
  /** Por app (prefijo de la tabla): referencias de su almacenamiento privado. */
  privateRefs: Map<string, Set<string>>;
}

function collectFiles(table: string, row: Record<string, unknown>, out: FileRefs, host: string | null): void {
  const uploadRe = host
    ? new RegExp(`https://${host.replace(/\./g, '\\.')}/[^"'\\s)<>]+|/uploads/[a-z]+/[A-Za-z0-9._-]+`, 'g')
    : /\/uploads\/[a-z]+\/[A-Za-z0-9._-]+/g;
  for (const v of Object.values(row)) {
    if (typeof v !== 'string' || v.length < 8) continue;
    if (PRIVATE_REF.test(v)) {
      const app = table.split('_')[0];
      const set = out.privateRefs.get(app) ?? new Set<string>();
      set.add(v);
      out.privateRefs.set(app, set);
      continue;
    }
    for (const m of v.match(uploadRe) ?? []) out.uploads.add(m);
  }
}

async function deleteFiles(files: FileRefs): Promise<number> {
  let n = 0;
  if (files.uploads.size) {
    const { deleteUploads } = await import('./uploads');
    const list = [...files.uploads];
    for (let i = 0; i < list.length; i += 500) await deleteUploads(list.slice(i, i + 500)).catch(() => undefined);
    n += list.length;
  }
  for (const [app, refs] of files.privateRefs) {
    const list = [...refs];
    const remover = await privateRemover(app);
    if (!remover) continue;
    await remover(list).catch(() => undefined);
    n += list.length;
  }
  return n;
}

async function privateRemover(app: string): Promise<((refs: string[]) => Promise<void>) | null> {
  switch (app) {
    case 'hiring':
      return (await import('./hiring/files')).deleteHiringFiles;
    case 'sign':
      return (await import('./sign/files')).deleteSignFiles;
    case 'send':
      return (await import('./send/files')).deleteSendFiles;
    case 'books':
      return (await import('./books-files')).deleteBooksFiles;
    case 'assistant':
      return (await import('./assistant/files')).deleteAssistantFiles;
    default:
      return null;
  }
}

// ---------- Borrado ----------

export interface ErasureStats {
  rows: number;
  files: number;
  tables: number;
  whatsapp: number;
}

const PAGE = 500;

/** Borra las filas de `table` que cumplen `where` y, antes, sus hijas por FK y sus archivos. */
async function eraseRows(
  client: Client,
  schema: Schema,
  table: string,
  where: { sql: string; args: string[] },
  files: FileRefs,
  stats: ErasureStats,
  path: string[],
): Promise<void> {
  if (path.includes(table) || path.length > 6) return;
  for (const fk of schema.children.get(table) ?? []) {
    if (!schema.tables.has(fk.table) || fk.table === table) continue;
    const childWhere = `${quote(fk.from)} IN (SELECT ${quote(fk.to)} FROM ${quote(table)} WHERE ${where.sql})`;
    if (fk.onDelete !== 'CASCADE') {
      // Como haría la base con las FK prendidas: la fila hija (de quien sea) queda, sin la referencia.
      await client.execute({ sql: `UPDATE ${quote(fk.table)} SET ${quote(fk.from)} = NULL WHERE ${childWhere}`, args: where.args }).catch(() => undefined);
      continue;
    }
    await eraseRows(
      client,
      schema,
      fk.table,
      { sql: childWhere, args: where.args },
      files,
      stats,
      [...path, table],
    );
  }
  const host = ownBlobHost();
  let offset = 0;
  for (;;) {
    const rows = (await client.execute({ sql: `SELECT * FROM ${quote(table)} WHERE ${where.sql} LIMIT ${PAGE} OFFSET ${offset}`, args: where.args })).rows as unknown as Array<Record<string, unknown>>;
    for (const r of rows) collectFiles(table, r, files, host);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  const res = await client.execute({ sql: `DELETE FROM ${quote(table)} WHERE ${where.sql}`, args: where.args });
  if (res.rowsAffected) {
    stats.rows += res.rowsAffected;
    stats.tables++;
  }
}

/** Cierra lo que vive fuera de la base: números de WhatsApp (Evolution) y cuentas de Inbox. */
async function disconnectExternal(ownerId: string, stats: ErasureStats): Promise<void> {
  const db = getDb();
  const numbers = (await db.prepare('SELECT id FROM groups_numbers WHERE user_id = ?').all(ownerId).catch(() => [])) as Array<{ id: string }>;
  if (numbers.length) {
    const { deleteNumber } = await import('./groups');
    for (const n of numbers) {
      // deleteNumber borra la instancia (o la deja en la cola de borrado si el bridge no responde).
      if (await deleteNumber(ownerId, n.id).catch(() => false)) stats.whatsapp++;
    }
  }
  const accounts = (await db.prepare('SELECT id FROM inbox_accounts WHERE owner_id = ?').all(ownerId).catch(() => [])) as Array<{ id: string }>;
  if (accounts.length) {
    const { getAccount } = await import('./inbox/core');
    const { disconnectWhatsapp } = await import('./inbox/whatsapp');
    const { disconnectGmail } = await import('./inbox/gmail');
    for (const a of accounts) {
      try {
        const account = await getAccount(ownerId, a.id);
        if (account.kind === 'whatsapp') await disconnectWhatsapp(account);
        else await disconnectGmail(account);
        stats.whatsapp += account.kind === 'whatsapp' ? 1 : 0;
      } catch {
        // Se borra igual: la fila se va con el resto.
      }
    }
  }
}

/**
 * Borra de verdad. 'account': sale de los workspaces ajenos, cierra sesiones, cierra sus números
 * y cuentas conectadas, y borra todo lo suyo y de su workspace (filas, hijas, archivos) y la
 * cuenta. 'workspace': lo mismo pero deja la cuenta (y sus membresías en workspaces ajenos).
 */
export async function eraseNow(userId: string, kind: Scope['kind'], client: Client = getClient()): Promise<ErasureStats> {
  const stats: ErasureStats = { rows: 0, files: 0, tables: 0, whatsapp: 0 };
  const db = getDb();
  if (kind === 'account') {
    const elsewhere = (await db
      .prepare('SELECT m.team_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? AND t.owner_id != ?')
      .all(userId, userId)) as Array<{ team_id: string }>;
    const { removeMember } = await import('./teams');
    for (const m of elsewhere) await removeMember(m.team_id, userId).catch(() => undefined);
    const { revokeOtherSessions } = await import('./account-security');
    await revokeOtherSessions(userId, null);
  }
  await disconnectExternal(userId, stats);
  const scope = await scopeFor(userId, kind);
  const schema = await readSchema(client);
  const files: FileRefs = { uploads: new Set(), privateRefs: new Map() };
  // La ficha del workspace y la cuenta al final: muchas tablas cuelgan de ellas.
  const order = [...schema.tables.keys()].sort((a, b) => Number(a === 'users' || a === 'teams') - Number(b === 'users' || b === 'teams') || Number(a === 'users') - Number(b === 'users'));
  for (const table of order) {
    const where = scopeWhere(table, schema.tables.get(table)!, scope);
    if (!where) continue;
    await eraseRows(client, schema, table, where, files, stats, []);
  }
  stats.files = await deleteFiles(files);
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

export async function cancelErasure(userId: string, now = Date.now()): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE privacy_erasures SET cancelled_at = ? WHERE user_id = ? AND done_at IS NULL AND cancelled_at IS NULL AND claimed_at IS NULL')
    .run(new Date(now).toISOString(), userId);
  return res.changes > 0;
}

const CLAIM_STALE_MS = 30 * 60_000;

/** Cron: ejecuta los borrados vencidos (cada fila reclamada con compare-and-set). */
export async function runDueErasures(now = Date.now(), limit = 3): Promise<number> {
  const db = getDb();
  const due = (await db
    .prepare(
      `SELECT * FROM privacy_erasures WHERE done_at IS NULL AND cancelled_at IS NULL AND due_at <= ?
         AND (claimed_at IS NULL OR claimed_at < ?) ORDER BY due_at LIMIT ?`,
    )
    .all(new Date(now).toISOString(), new Date(now - CLAIM_STALE_MS).toISOString(), limit)) as ErasureRow[];
  let done = 0;
  for (const row of due) {
    const claimedAt = new Date(now).toISOString();
    const claim = await db
      .prepare('UPDATE privacy_erasures SET claimed_at = ? WHERE id = ? AND done_at IS NULL AND cancelled_at IS NULL AND (claimed_at IS NULL OR claimed_at = ?)')
      .run(claimedAt, row.id, row.claimed_at);
    if (claim.changes !== 1) continue;
    const stats = await eraseNow(row.user_id, row.kind);
    await db.prepare('UPDATE privacy_erasures SET done_at = ?, stats = ? WHERE id = ?').run(new Date().toISOString(), JSON.stringify(stats), row.id);
    const { recordSecurityEvent } = await import('./account-security');
    // Sin datos de la persona: queda que hubo un borrado y cuánto se borró.
    await recordSecurityEvent({ userId: null, action: row.kind === 'account' ? 'account.deleted' : 'workspace.deleted', meta: { erasure: row.id, ...stats }, ip: null, userAgent: null });
    done++;
  }
  return done;
}

// ---------- Exportar ----------

/** Columnas que nunca salen en un export (secretos, hashes, tokens). */
function secretColumn(col: string): boolean {
  return /(^|_)(hash|secret|token|password|key_hash|code_hash)s?$|^mfa_|(_|^)(access|refresh)_token/.test(col) || col === 'config' || col === 'secrets' || col === 'http_secrets';
}

function exportValue(col: string, v: unknown): unknown {
  if (secretColumn(col)) return v === null || v === undefined ? v : '[omitted]';
  if (typeof v === 'string' && /enc:v[12]:|cred:v[12]:/.test(v)) return '[encrypted secret omitted]';
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return '[binary]';
  return v;
}

export interface ExportResult {
  zip: Buffer;
  tables: number;
  rows: number;
}

/**
 * Todo lo de la cuenta y su workspace en un zip: un JSON por tabla (filas tal como están en
 * la base, sin secretos), más un README. Lo mismo que se borraría con 'account'.
 */
export async function exportAccountData(user: UserRow, client: Client = getClient()): Promise<ExportResult> {
  const scope = await scopeFor(user.id, 'account');
  const schema = await readSchema(client);
  const files: Array<{ name: string; data: string; deflate: boolean }> = [];
  let rows = 0;
  for (const [table, cols] of schema.tables) {
    const where = scopeWhere(table, cols, scope);
    if (!where) continue;
    const out: Array<Record<string, unknown>> = [];
    let offset = 0;
    for (;;) {
      const page = (await client.execute({ sql: `SELECT * FROM ${quote(table)} WHERE ${where.sql} LIMIT ${PAGE} OFFSET ${offset}`, args: where.args })).rows as unknown as Array<Record<string, unknown>>;
      for (const r of page) out.push(Object.fromEntries(cols.map((c) => [c, exportValue(c, r[c])])));
      if (page.length < PAGE) break;
      offset += PAGE;
    }
    if (!out.length) continue;
    rows += out.length;
    files.push({ name: `tables/${table}.json`, data: JSON.stringify(out, null, 1), deflate: true });
  }
  const readme = [
    'zerosoft data export',
    `Account: ${user.email}`,
    `Created: ${new Date().toISOString()}`,
    '',
    'One JSON file per table with every row of your account and of the workspace you own.',
    'Secrets (tokens, keys, password hashes) are omitted. Files you uploaded are linked by URL in the rows;',
    'each app also has its own export (CSV, Markdown, ZIP) in its settings.',
    '',
  ].join('\n');
  const zip = buildZip([{ name: 'README.txt', data: readme }, ...files]);
  return { zip, tables: files.length, rows };
}

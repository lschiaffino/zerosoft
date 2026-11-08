/**
 * Colecciones, preguntas, tableros, bases, links y suscripciones de
 * Analytics. Todo filtrado por workspace; lo de una colección personal ajena
 * no se ve (salvo admins, como en Metabase). Server-only.
 */
import { createHash, randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { getDb } from '../db';
import { open, seal } from '../secret-box';
import { canEditItem, isBiAdmin, type BiViewer } from './access';
import type { DbConfig } from './external';
import {
  cardMappingSchema,
  dashFilterSchema,
  querySchema,
  vizSchema,
  ZS_SOURCE,
  type BiQuery,
  type CardMapping,
  type DashFilter,
  type Engine,
  type SchemaTable,
  type Viz,
} from './types';
import { z } from 'zod';

export class BiStoreError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

const now = () => new Date().toISOString();
const db = () => getDb();

// ---------- Colecciones ----------

export interface CollectionDto {
  id: string;
  parentId: string | null;
  name: string;
  personal: boolean;
  mine: boolean;
  createdBy: string;
  updatedAt: string;
}

type CollectionRow = { id: string; parent_id: string | null; name: string; personal_owner: string | null; created_by: string; updated_at: string };

function collectionDto(r: CollectionRow, viewer: BiViewer): CollectionDto {
  return { id: r.id, parentId: r.parent_id, name: r.name, personal: !!r.personal_owner, mine: r.personal_owner === viewer.personId, createdBy: r.created_by, updatedAt: r.updated_at };
}

/** SQL: la colección `alias` se ve (compartida o personal propia; admins ven todas). */
function collectionVisibleSql(viewer: BiViewer, col: string): { sql: string; args: string[] } {
  if (isBiAdmin(viewer)) return { sql: '1', args: [] };
  return {
    sql: `(${col} IS NULL OR NOT EXISTS (SELECT 1 FROM bi_collections zc WHERE zc.id = ${col} AND zc.personal_owner IS NOT NULL AND zc.personal_owner <> ?))`,
    args: [viewer.personId],
  };
}

export async function listCollections(viewer: BiViewer): Promise<CollectionDto[]> {
  const rows = (await db()
    .prepare(
      `SELECT id, parent_id, name, personal_owner, created_by, updated_at FROM bi_collections
       WHERE workspace_id = ? AND (personal_owner IS NULL OR personal_owner = ? OR ? = 1) ORDER BY personal_owner IS NULL, lower(name)`,
    )
    .all(viewer.workspaceId, viewer.personId, isBiAdmin(viewer) ? 1 : 0)) as CollectionRow[];
  return rows.map((r) => collectionDto(r, viewer));
}

async function collectionRow(viewer: BiViewer, id: string): Promise<CollectionRow | null> {
  const r = (await db()
    .prepare('SELECT id, parent_id, name, personal_owner, created_by, updated_at FROM bi_collections WHERE workspace_id = ? AND id = ?')
    .get(viewer.workspaceId, id)) as CollectionRow | undefined;
  if (!r) return null;
  if (r.personal_owner && r.personal_owner !== viewer.personId && !isBiAdmin(viewer)) return null;
  return r;
}

/** Colección personal de quien mira (se crea la primera vez). */
export async function personalCollection(viewer: BiViewer, name: string): Promise<CollectionDto> {
  const found = (await db()
    .prepare('SELECT id, parent_id, name, personal_owner, created_by, updated_at FROM bi_collections WHERE workspace_id = ? AND personal_owner = ?')
    .get(viewer.workspaceId, viewer.personId)) as CollectionRow | undefined;
  if (found) return collectionDto(found, viewer);
  const id = `bic_${nanoid(12)}`;
  const t = now();
  await db()
    .prepare('INSERT INTO bi_collections (id, workspace_id, parent_id, name, personal_owner, created_by, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
    .run(id, viewer.workspaceId, name.slice(0, 120), viewer.personId, viewer.personId, t, t);
  return { id, parentId: null, name, personal: true, mine: true, createdBy: viewer.personId, updatedAt: t };
}

const nameSchema = z.string().trim().min(1).max(120);

export async function createCollection(viewer: BiViewer, input: { name: unknown; parentId?: unknown }): Promise<CollectionDto> {
  const name = nameSchema.parse(input.name);
  let parentId: string | null = null;
  if (typeof input.parentId === 'string' && input.parentId) {
    const parent = await collectionRow(viewer, input.parentId);
    if (!parent) throw new BiStoreError('collection_not_found', 404);
    parentId = parent.id;
  }
  const id = `bic_${nanoid(12)}`;
  const t = now();
  await db()
    .prepare('INSERT INTO bi_collections (id, workspace_id, parent_id, name, personal_owner, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)')
    .run(id, viewer.workspaceId, parentId, name, viewer.personId, t, t);
  return { id, parentId, name, personal: false, mine: false, createdBy: viewer.personId, updatedAt: t };
}

export async function updateCollection(viewer: BiViewer, id: string, input: { name?: unknown }): Promise<CollectionDto> {
  const r = await collectionRow(viewer, id);
  if (!r) throw new BiStoreError('not_found', 404);
  if (!r.personal_owner && !canEditItem(viewer, r.created_by)) throw new BiStoreError('forbidden', 403);
  const name = input.name === undefined ? r.name : nameSchema.parse(input.name);
  const t = now();
  await db().prepare('UPDATE bi_collections SET name = ?, updated_at = ? WHERE id = ?').run(name, t, id);
  return collectionDto({ ...r, name, updated_at: t }, viewer);
}

/** Borra la colección: lo que tenía pasa a la raíz (nada se pierde). */
export async function deleteCollection(viewer: BiViewer, id: string): Promise<void> {
  const r = await collectionRow(viewer, id);
  if (!r) throw new BiStoreError('not_found', 404);
  if (r.personal_owner) throw new BiStoreError('personal_collection', 400);
  if (!canEditItem(viewer, r.created_by)) throw new BiStoreError('forbidden', 403);
  await db().prepare('UPDATE bi_questions SET collection_id = ? WHERE workspace_id = ? AND collection_id = ?').run(r.parent_id, viewer.workspaceId, id);
  await db().prepare('UPDATE bi_dashboards SET collection_id = ? WHERE workspace_id = ? AND collection_id = ?').run(r.parent_id, viewer.workspaceId, id);
  await db().prepare('UPDATE bi_collections SET parent_id = ? WHERE workspace_id = ? AND parent_id = ?').run(r.parent_id, viewer.workspaceId, id);
  await db().prepare('DELETE FROM bi_collections WHERE id = ?').run(id);
}

async function checkCollection(viewer: BiViewer, raw: unknown): Promise<string | null> {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw new BiStoreError('collection_not_found', 404);
  const c = await collectionRow(viewer, raw);
  if (!c) throw new BiStoreError('collection_not_found', 404);
  return c.id;
}

// ---------- Bases externas ----------

export interface DatabaseDto {
  id: string;
  name: string;
  engine: Engine;
  host: string;
  port: number;
  dbname: string;
  username: string;
  ssl: DbConfig['ssl'];
  /** Quién puede escribir SQL sobre esta base: admins o todo el equipo (el constructor lo usa cualquiera). */
  sqlAccess: 'admins' | 'members';
  syncedAt: string | null;
  tables: number;
}

type DbRow = {
  id: string;
  name: string;
  engine: Engine;
  host: string;
  port: number;
  dbname: string;
  username: string;
  secret: string;
  ssl: DbConfig['ssl'];
  schema_json: string | null;
  synced_at: string | null;
  created_by: string;
};

function sqlAccessOf(r: Pick<DbRow, 'schema_json'>): 'admins' | 'members' {
  try {
    return (JSON.parse(r.schema_json ?? '{}') as { sqlAccess?: string }).sqlAccess === 'members' ? 'members' : 'admins';
  } catch {
    return 'admins';
  }
}

function databaseDto(r: DbRow): DatabaseDto {
  let tables = 0;
  try {
    tables = ((JSON.parse(r.schema_json ?? '{}') as { tables?: unknown[] }).tables ?? []).length;
  } catch {
    tables = 0;
  }
  return { id: r.id, name: r.name, engine: r.engine, host: r.host, port: Number(r.port), dbname: r.dbname, username: r.username, ssl: r.ssl, sqlAccess: sqlAccessOf(r), syncedAt: r.synced_at, tables };
}

export async function listDatabases(viewer: BiViewer): Promise<DatabaseDto[]> {
  const rows = (await db().prepare('SELECT * FROM bi_databases WHERE workspace_id = ? ORDER BY lower(name)').all(viewer.workspaceId)) as DbRow[];
  return rows.map(databaseDto);
}

async function dbRow(workspaceId: string, id: string): Promise<DbRow | null> {
  return ((await db().prepare('SELECT * FROM bi_databases WHERE workspace_id = ? AND id = ?').get(workspaceId, id)) as DbRow | undefined) ?? null;
}

export async function getDatabase(viewer: BiViewer, id: string): Promise<DatabaseDto | null> {
  const r = await dbRow(viewer.workspaceId, id);
  return r ? databaseDto(r) : null;
}

/** Config para conectarse (con la contraseña descifrada). Nunca sale al cliente. */
export async function databaseConfig(workspaceId: string, id: string): Promise<(DbConfig & { sqlAccess: 'admins' | 'members' }) | null> {
  const r = await dbRow(workspaceId, id);
  if (!r) return null;
  return { engine: r.engine, host: r.host, port: Number(r.port), dbname: r.dbname, username: r.username, password: open(r.secret), ssl: r.ssl, sqlAccess: sqlAccessOf(r) };
}

export const databaseInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  engine: z.enum(['postgres', 'mysql']),
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().min(1).max(65535),
  dbname: z.string().trim().min(1).max(128),
  username: z.string().trim().min(1).max(128),
  password: z.string().max(1024).optional(),
  ssl: z.enum(['require', 'verify', 'disable']).default('require'),
  sqlAccess: z.enum(['admins', 'members']).default('admins'),
});
export type DatabaseInput = z.infer<typeof databaseInputSchema>;

export async function createDatabase(viewer: BiViewer, input: DatabaseInput, schema: SchemaTable[]): Promise<DatabaseDto> {
  if (!isBiAdmin(viewer)) throw new BiStoreError('admin_only', 403);
  const id = `bid_${nanoid(12)}`;
  const t = now();
  await db()
    .prepare(
      `INSERT INTO bi_databases (id, workspace_id, name, engine, host, port, dbname, username, secret, ssl, schema_json, synced_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, viewer.workspaceId, input.name, input.engine, input.host, input.port, input.dbname, input.username, seal(input.password ?? ''), input.ssl, JSON.stringify({ tables: schema, sqlAccess: input.sqlAccess }), t, viewer.personId, t, t);
  return databaseDto((await dbRow(viewer.workspaceId, id))!);
}

/** Cambia datos de conexión; sin `password` queda la guardada. */
export async function updateDatabase(viewer: BiViewer, id: string, input: DatabaseInput, schema: SchemaTable[] | null): Promise<DatabaseDto> {
  if (!isBiAdmin(viewer)) throw new BiStoreError('admin_only', 403);
  const r = await dbRow(viewer.workspaceId, id);
  if (!r) throw new BiStoreError('not_found', 404);
  const t = now();
  const tables = schema ?? (JSON.parse(r.schema_json ?? '{}') as { tables?: SchemaTable[] }).tables ?? [];
  await db()
    .prepare(
      `UPDATE bi_databases SET name = ?, engine = ?, host = ?, port = ?, dbname = ?, username = ?, secret = ?, ssl = ?, schema_json = ?, synced_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(
      input.name,
      input.engine,
      input.host,
      input.port,
      input.dbname,
      input.username,
      input.password ? seal(input.password) : r.secret,
      input.ssl,
      JSON.stringify({ tables, sqlAccess: input.sqlAccess }),
      schema ? t : r.synced_at,
      t,
      id,
      viewer.workspaceId,
    );
  return databaseDto((await dbRow(viewer.workspaceId, id))!);
}

export async function saveDatabaseSchema(workspaceId: string, id: string, tables: SchemaTable[]): Promise<void> {
  const r = await dbRow(workspaceId, id);
  if (!r) return;
  await db()
    .prepare('UPDATE bi_databases SET schema_json = ?, synced_at = ? WHERE id = ? AND workspace_id = ?')
    .run(JSON.stringify({ tables, sqlAccess: sqlAccessOf(r) }), now(), id, workspaceId);
}

export async function databaseSchema(workspaceId: string, id: string): Promise<SchemaTable[] | null> {
  const r = await dbRow(workspaceId, id);
  if (!r) return null;
  try {
    return (JSON.parse(r.schema_json ?? '{}') as { tables?: SchemaTable[] }).tables ?? [];
  } catch {
    return [];
  }
}

export async function deleteDatabase(viewer: BiViewer, id: string): Promise<void> {
  if (!isBiAdmin(viewer)) throw new BiStoreError('admin_only', 403);
  const r = await dbRow(viewer.workspaceId, id);
  if (!r) throw new BiStoreError('not_found', 404);
  await db().prepare('DELETE FROM bi_databases WHERE id = ? AND workspace_id = ?').run(id, viewer.workspaceId);
}

// ---------- Preguntas ----------

export interface QuestionDto {
  id: string;
  collectionId: string | null;
  name: string;
  description: string;
  source: string;
  query: BiQuery;
  viz: Viz;
  createdBy: string;
  canEdit: boolean;
  updatedAt: string;
}

type QuestionRow = {
  id: string;
  collection_id: string | null;
  name: string;
  description: string;
  source: string;
  query_json: string;
  viz_json: string;
  created_by: string;
  updated_at: string;
};

function questionDto(r: QuestionRow, viewer: BiViewer): QuestionDto {
  return {
    id: r.id,
    collectionId: r.collection_id,
    name: r.name,
    description: r.description,
    source: r.source,
    query: querySchema.parse(JSON.parse(r.query_json)),
    viz: vizSchema.parse(JSON.parse(r.viz_json || '{}')),
    createdBy: r.created_by,
    canEdit: canEditItem(viewer, r.created_by),
    updatedAt: r.updated_at,
  };
}

export interface ListItem {
  id: string;
  kind: 'question' | 'dashboard';
  name: string;
  description: string;
  collectionId: string | null;
  updatedAt: string;
  viz?: string;
}

/** Preguntas y tableros visibles, más nuevos primero (lista y sidebar). */
export async function listItems(viewer: BiViewer, opts: { collectionId?: string | null; q?: string; limit?: number } = {}): Promise<ListItem[]> {
  const vq = collectionVisibleSql(viewer, 'collection_id');
  const where: string[] = ['workspace_id = ?', vq.sql];
  const args: Array<string | null> = [viewer.workspaceId, ...vq.args];
  if (opts.collectionId !== undefined) {
    if (opts.collectionId === null) where.push('collection_id IS NULL');
    else {
      where.push('collection_id = ?');
      args.push(opts.collectionId);
    }
  }
  if (opts.q) {
    where.push('instr(lower(name), ?) > 0');
    args.push(opts.q.toLowerCase());
  }
  const limit = Math.min(opts.limit ?? 500, 1000);
  const w = where.join(' AND ');
  const rows = (await db()
    .prepare(
      `SELECT id, 'question' AS kind, name, description, collection_id, updated_at, viz_json FROM bi_questions WHERE ${w}
       UNION ALL
       SELECT id, 'dashboard' AS kind, name, description, collection_id, updated_at, NULL FROM bi_dashboards WHERE ${w}
       ORDER BY updated_at DESC LIMIT ${limit}`,
    )
    .all(...args, ...args)) as Array<{ id: string; kind: 'question' | 'dashboard'; name: string; description: string; collection_id: string | null; updated_at: string; viz_json: string | null }>;
  return rows.map((r) => {
    let viz: string | undefined;
    try {
      viz = r.viz_json ? (JSON.parse(r.viz_json) as { type?: string }).type : undefined;
    } catch {
      viz = undefined;
    }
    return { id: r.id, kind: r.kind, name: r.name, description: r.description, collectionId: r.collection_id, updatedAt: r.updated_at, viz };
  });
}

async function questionRow(viewer: BiViewer, id: string): Promise<QuestionRow | null> {
  const vq = collectionVisibleSql(viewer, 'collection_id');
  return (
    ((await db()
      .prepare(`SELECT * FROM bi_questions WHERE workspace_id = ? AND id = ? AND ${vq.sql}`)
      .get(viewer.workspaceId, id, ...vq.args)) as QuestionRow | undefined) ?? null
  );
}

export async function getQuestion(viewer: BiViewer, id: string): Promise<QuestionDto | null> {
  const r = await questionRow(viewer, id);
  return r ? questionDto(r, viewer) : null;
}

/** Pregunta sin chequear colección (links públicos y suscripciones: ya se validó el acceso). */
export async function questionById(workspaceId: string, id: string): Promise<(QuestionDto & { createdBy: string }) | null> {
  const r = (await db().prepare('SELECT * FROM bi_questions WHERE workspace_id = ? AND id = ?').get(workspaceId, id)) as QuestionRow | undefined;
  if (!r) return null;
  return questionDto(r, { workspaceId, personId: r.created_by, role: 'member', apps: '*' });
}

export const questionInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  source: z.string().max(40).default(ZS_SOURCE),
  collectionId: z.string().max(40).nullable().optional(),
  query: querySchema,
  viz: vizSchema.default({ type: 'auto' }),
});

async function checkSource(viewer: BiViewer, source: string): Promise<void> {
  if (source === ZS_SOURCE) return;
  if (!(await dbRow(viewer.workspaceId, source))) throw new BiStoreError('database_not_found', 404);
}

export async function createQuestion(viewer: BiViewer, raw: unknown): Promise<QuestionDto> {
  const input = questionInputSchema.parse(raw);
  await checkSource(viewer, input.source);
  const collectionId = await checkCollection(viewer, input.collectionId);
  const id = `biq_${nanoid(12)}`;
  const t = now();
  await db()
    .prepare(
      `INSERT INTO bi_questions (id, workspace_id, collection_id, name, description, source, mode, query_json, viz_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, viewer.workspaceId, collectionId, input.name, input.description, input.source, input.query.kind, JSON.stringify(input.query), JSON.stringify(input.viz), viewer.personId, t, t);
  return (await getQuestion(viewer, id))!;
}

export async function updateQuestion(viewer: BiViewer, id: string, raw: unknown): Promise<QuestionDto> {
  const r = await questionRow(viewer, id);
  if (!r) throw new BiStoreError('not_found', 404);
  if (!canEditItem(viewer, r.created_by)) throw new BiStoreError('forbidden', 403);
  const cur = questionDto(r, viewer);
  const input = questionInputSchema.partial().parse(raw);
  const source = input.source ?? cur.source;
  await checkSource(viewer, source);
  const collectionId = input.collectionId === undefined ? cur.collectionId : await checkCollection(viewer, input.collectionId);
  const query = input.query ?? cur.query;
  await db()
    .prepare('UPDATE bi_questions SET name = ?, description = ?, source = ?, collection_id = ?, mode = ?, query_json = ?, viz_json = ?, updated_at = ? WHERE id = ?')
    .run(input.name ?? cur.name, input.description ?? cur.description, source, collectionId, query.kind, JSON.stringify(query), JSON.stringify(input.viz ?? cur.viz), now(), id);
  return (await getQuestion(viewer, id))!;
}

export async function deleteQuestion(viewer: BiViewer, id: string): Promise<void> {
  const r = await questionRow(viewer, id);
  if (!r) throw new BiStoreError('not_found', 404);
  if (!canEditItem(viewer, r.created_by)) throw new BiStoreError('forbidden', 403);
  await db().prepare('DELETE FROM bi_cards WHERE question_id = ?').run(id);
  await db().prepare("DELETE FROM bi_shares WHERE kind = 'question' AND target_id = ?").run(id);
  await db().prepare('DELETE FROM bi_questions WHERE id = ?').run(id);
}

// ---------- Tableros ----------

export interface CardDto {
  id: string;
  questionId: string | null;
  kind: 'question' | 'text';
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mapping: CardMapping;
}

export interface DashboardDto {
  id: string;
  collectionId: string | null;
  name: string;
  description: string;
  filters: DashFilter[];
  refreshSec: number;
  createdBy: string;
  canEdit: boolean;
  updatedAt: string;
  cards: CardDto[];
}

type DashRow = { id: string; collection_id: string | null; name: string; description: string; filters_json: string; refresh_sec: number; created_by: string; updated_at: string };
type CardRow = { id: string; question_id: string | null; kind: string; text: string; x: number; y: number; w: number; h: number; mapping_json: string };

async function dashRow(viewer: BiViewer, id: string): Promise<DashRow | null> {
  const vq = collectionVisibleSql(viewer, 'collection_id');
  return ((await db().prepare(`SELECT * FROM bi_dashboards WHERE workspace_id = ? AND id = ? AND ${vq.sql}`).get(viewer.workspaceId, id, ...vq.args)) as DashRow | undefined) ?? null;
}

async function dashDto(r: DashRow, viewer: BiViewer): Promise<DashboardDto> {
  const cards = (await db().prepare('SELECT * FROM bi_cards WHERE dashboard_id = ? ORDER BY y, x').all(r.id)) as CardRow[];
  let filters: DashFilter[] = [];
  try {
    filters = z.array(dashFilterSchema).parse(JSON.parse(r.filters_json || '[]'));
  } catch {
    filters = [];
  }
  return {
    id: r.id,
    collectionId: r.collection_id,
    name: r.name,
    description: r.description,
    filters,
    refreshSec: Number(r.refresh_sec) || 0,
    createdBy: r.created_by,
    canEdit: canEditItem(viewer, r.created_by),
    updatedAt: r.updated_at,
    cards: cards.map((c) => {
      let mapping: CardMapping = {};
      try {
        mapping = cardMappingSchema.parse(JSON.parse(c.mapping_json || '{}'));
      } catch {
        mapping = {};
      }
      return { id: c.id, questionId: c.question_id, kind: c.kind === 'text' ? 'text' : 'question', text: c.text, x: Number(c.x), y: Number(c.y), w: Number(c.w), h: Number(c.h), mapping };
    }),
  };
}

export async function getDashboard(viewer: BiViewer, id: string): Promise<DashboardDto | null> {
  const r = await dashRow(viewer, id);
  return r ? dashDto(r, viewer) : null;
}

export async function dashboardById(workspaceId: string, id: string): Promise<DashboardDto | null> {
  const r = (await db().prepare('SELECT * FROM bi_dashboards WHERE workspace_id = ? AND id = ?').get(workspaceId, id)) as DashRow | undefined;
  return r ? dashDto(r, { workspaceId, personId: r.created_by, role: 'member', apps: '*' }) : null;
}

const cardInput = z.object({
  id: z.string().max(40).optional(),
  questionId: z.string().max(40).nullable().optional(),
  kind: z.enum(['question', 'text']).default('question'),
  text: z.string().max(4000).default(''),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(500),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
  mapping: cardMappingSchema.default({}),
});

export const dashboardInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  collectionId: z.string().max(40).nullable().optional(),
  filters: z.array(dashFilterSchema).max(8).default([]),
  refreshSec: z.number().int().refine((n) => [0, 60, 300, 900, 1800, 3600].includes(n)).default(0),
  cards: z.array(cardInput).max(40).optional(),
});

export async function createDashboard(viewer: BiViewer, raw: unknown): Promise<DashboardDto> {
  const input = dashboardInputSchema.parse(raw);
  const collectionId = await checkCollection(viewer, input.collectionId);
  const id = `bidb_${nanoid(12)}`;
  const t = now();
  await db()
    .prepare(
      `INSERT INTO bi_dashboards (id, workspace_id, collection_id, name, description, filters_json, refresh_sec, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, viewer.workspaceId, collectionId, input.name, input.description, JSON.stringify(input.filters), input.refreshSec, viewer.personId, t, t);
  if (input.cards) await replaceCards(viewer, id, input.cards);
  return (await getDashboard(viewer, id))!;
}

async function replaceCards(viewer: BiViewer, dashboardId: string, cards: z.infer<typeof cardInput>[]): Promise<void> {
  for (const c of cards) {
    if (c.kind === 'question') {
      if (!c.questionId || !(await questionRow(viewer, c.questionId))) throw new BiStoreError('question_not_found', 404);
    }
  }
  const t = now();
  await db().prepare('DELETE FROM bi_cards WHERE dashboard_id = ?').run(dashboardId);
  for (const c of cards) {
    await db()
      .prepare('INSERT INTO bi_cards (id, dashboard_id, question_id, kind, text, x, y, w, h, mapping_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`bicd_${nanoid(12)}`, dashboardId, c.kind === 'question' ? (c.questionId ?? null) : null, c.kind, c.text, c.x, c.y, Math.min(c.w, 12 - c.x), c.h, JSON.stringify(c.mapping), t);
  }
}

export async function updateDashboard(viewer: BiViewer, id: string, raw: unknown): Promise<DashboardDto> {
  const r = await dashRow(viewer, id);
  if (!r) throw new BiStoreError('not_found', 404);
  if (!canEditItem(viewer, r.created_by)) throw new BiStoreError('forbidden', 403);
  const input = dashboardInputSchema.partial().parse(raw);
  const collectionId = input.collectionId === undefined ? r.collection_id : await checkCollection(viewer, input.collectionId);
  await db()
    .prepare('UPDATE bi_dashboards SET name = ?, description = ?, collection_id = ?, filters_json = ?, refresh_sec = ?, updated_at = ? WHERE id = ?')
    .run(
      input.name ?? r.name,
      input.description ?? r.description,
      collectionId,
      input.filters ? JSON.stringify(input.filters) : r.filters_json,
      input.refreshSec ?? r.refresh_sec,
      now(),
      id,
    );
  if (input.cards) await replaceCards(viewer, id, input.cards);
  return (await getDashboard(viewer, id))!;
}

/** Suma una pregunta al final del tablero. */
export async function addCard(viewer: BiViewer, dashboardId: string, questionId: string): Promise<DashboardDto> {
  const d = await getDashboard(viewer, dashboardId);
  if (!d) throw new BiStoreError('not_found', 404);
  if (!d.canEdit) throw new BiStoreError('forbidden', 403);
  if (d.cards.length >= 40) throw new BiStoreError('too_many_cards');
  const y = d.cards.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  return updateDashboard(viewer, dashboardId, { cards: [...d.cards, { questionId, kind: 'question', text: '', x: 0, y, w: 6, h: 4, mapping: {} }] });
}

export async function deleteDashboard(viewer: BiViewer, id: string): Promise<void> {
  const r = await dashRow(viewer, id);
  if (!r) throw new BiStoreError('not_found', 404);
  if (!canEditItem(viewer, r.created_by)) throw new BiStoreError('forbidden', 403);
  await db().prepare('DELETE FROM bi_cards WHERE dashboard_id = ?').run(id);
  await db().prepare('DELETE FROM bi_subscriptions WHERE dashboard_id = ?').run(id);
  await db().prepare("DELETE FROM bi_shares WHERE kind = 'dashboard' AND target_id = ?").run(id);
  await db().prepare('DELETE FROM bi_dashboards WHERE id = ?').run(id);
}

// ---------- Links públicos ----------

export interface ShareDto {
  id: string;
  kind: 'question' | 'dashboard';
  targetId: string;
  createdAt: string;
  /** Solo al crear: después no se puede volver a leer. */
  token?: string;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const isShareToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);

async function targetExists(viewer: BiViewer, kind: 'question' | 'dashboard', targetId: string): Promise<{ createdBy: string } | null> {
  if (kind === 'question') {
    const q = await questionRow(viewer, targetId);
    return q ? { createdBy: q.created_by } : null;
  }
  const d = await dashRow(viewer, targetId);
  return d ? { createdBy: d.created_by } : null;
}

export async function listShares(viewer: BiViewer, kind: 'question' | 'dashboard', targetId: string): Promise<ShareDto[]> {
  if (!(await targetExists(viewer, kind, targetId))) throw new BiStoreError('not_found', 404);
  const rows = (await db()
    .prepare('SELECT id, kind, target_id, created_at FROM bi_shares WHERE workspace_id = ? AND kind = ? AND target_id = ? AND revoked_at IS NULL ORDER BY created_at')
    .all(viewer.workspaceId, kind, targetId)) as Array<{ id: string; kind: 'question' | 'dashboard'; target_id: string; created_at: string }>;
  return rows.map((r) => ({ id: r.id, kind: r.kind, targetId: r.target_id, createdAt: r.created_at }));
}

/** Link público: lo crea un admin; el resultado se calcula con los permisos de quien lo creó. */
export async function createShare(viewer: BiViewer, kind: 'question' | 'dashboard', targetId: string): Promise<ShareDto> {
  if (!isBiAdmin(viewer)) throw new BiStoreError('admin_only', 403);
  if (!(await targetExists(viewer, kind, targetId))) throw new BiStoreError('not_found', 404);
  const n = (await db().prepare('SELECT COUNT(*) AS n FROM bi_shares WHERE kind = ? AND target_id = ? AND revoked_at IS NULL').get(kind, targetId)) as { n: number };
  if (Number(n.n) >= 5) throw new BiStoreError('too_many_shares');
  const token = randomBytes(32).toString('base64url');
  const id = `bis_${nanoid(12)}`;
  const t = now();
  await db()
    .prepare('INSERT INTO bi_shares (id, workspace_id, kind, target_id, token_hash, params_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, viewer.workspaceId, kind, targetId, hashToken(token), '{}', viewer.personId, t);
  return { id, kind, targetId, createdAt: t, token };
}

export async function revokeShare(viewer: BiViewer, id: string): Promise<void> {
  if (!isBiAdmin(viewer)) throw new BiStoreError('admin_only', 403);
  const res = await db().prepare('UPDATE bi_shares SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL').run(now(), id, viewer.workspaceId);
  if (!res.changes) throw new BiStoreError('not_found', 404);
}

export async function shareByToken(token: string): Promise<{ id: string; workspaceId: string; kind: 'question' | 'dashboard'; targetId: string; createdBy: string } | null> {
  if (!isShareToken(token)) return null;
  const r = (await db()
    .prepare('SELECT id, workspace_id, kind, target_id, created_by FROM bi_shares WHERE token_hash = ? AND revoked_at IS NULL')
    .get(hashToken(token))) as { id: string; workspace_id: string; kind: 'question' | 'dashboard'; target_id: string; created_by: string } | undefined;
  return r ? { id: r.id, workspaceId: r.workspace_id, kind: r.kind, targetId: r.target_id, createdBy: r.created_by } : null;
}

// ---------- Caché de resultados ----------

export async function cacheGet(key: string): Promise<string | null> {
  const r = (await db().prepare('SELECT result_json, expires_at FROM bi_cache WHERE key = ?').get(key)) as { result_json: string; expires_at: string } | undefined;
  if (!r || r.expires_at < now()) return null;
  return r.result_json;
}

export async function cachePut(workspaceId: string, key: string, value: string, ttlSec: number): Promise<void> {
  if (value.length > 2 * 1024 * 1024) return;
  const t = new Date();
  await db()
    .prepare(
      `INSERT INTO bi_cache (key, workspace_id, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    )
    .run(key, workspaceId, value, t.toISOString(), new Date(t.getTime() + ttlSec * 1000).toISOString());
}

export async function pruneCache(): Promise<number> {
  const res = await db().prepare('DELETE FROM bi_cache WHERE expires_at < ?').run(now());
  return res.changes ?? 0;
}

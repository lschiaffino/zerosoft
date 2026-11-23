/**
 * CRM — comentarios en las actividades del timeline (bloque C1), como "Add
 * comment" de HubSpot: un hilo por nota, email, llamada, reunión o tarea.
 * Server-only.
 *
 * Privacidad: el hilo es tan visible como la actividad. Quien no ve la
 * actividad (activityScopeSql / canSeeActivity: alguno de sus registros queda
 * fuera de su alcance, o es de otro workspace) ni la lee ni comenta, y una
 * tarea de un chat de Lines que la persona no ve (lib/crm-chat-privacy.ts)
 * tampoco muestra su hilo, que podría citar el chat. Lo decide
 * `canUseThread`; las rutas lo llaman siempre antes de leer o escribir.
 *
 * Cada comentario es de quien lo escribió: solo esa persona lo edita o lo
 * borra. El texto es markdown saneado al guardar (lib/crm-note-format.ts).
 */
import { getDb, type Db } from './db';
import { activityScopeSql, canSeeActivity, type OwnerScope } from './crm-visibility';
import { isChatHidden, type ChatReader } from './crm-chat-privacy';
import { COMMENT_MAX, sanitizeNoteMarkdown } from './crm-note-format';

export interface ActivityComment {
  id: string;
  activity_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  edited: 0 | 1;
  created_at: string;
  updated_at: string;
}

/** Tope de comentarios por hilo (uno más devuelve 400). */
export const MAX_COMMENTS_PER_ACTIVITY = 500;

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** ¿La persona puede leer y escribir el hilo de esta actividad del workspace? */
export async function canUseThread(
  workspaceId: string,
  activityId: string,
  scope: OwnerScope | undefined,
  reader: ChatReader | null,
  db: Db = getDb(),
): Promise<boolean> {
  if (!(await canSeeActivity(workspaceId, activityId, scope, db))) return false;
  return !(await isChatHidden(workspaceId, activityId, reader));
}

const SELECT = `
  SELECT k.id, k.activity_id, k.author_id, k.body, k.edited, k.created_at, k.updated_at,
    COALESCE(NULLIF(trim(u.name), ''), u.email) AS author_name
  FROM crm_activity_comments k
  LEFT JOIN users u ON u.id = k.author_id
`;

/** El hilo de una actividad, del más viejo al más nuevo. La ruta ya comprobó canUseThread. */
export async function listComments(workspaceId: string, activityId: string, db: Db = getDb()): Promise<ActivityComment[]> {
  return (await db
    .prepare(`${SELECT} WHERE k.user_id = ? AND k.activity_id = ? ORDER BY k.created_at, k.rowid LIMIT ?`)
    .all(workspaceId, activityId, MAX_COMMENTS_PER_ACTIVITY)) as ActivityComment[];
}

export async function getComment(workspaceId: string, id: string, db: Db = getDb()): Promise<ActivityComment | null> {
  return ((await db.prepare(`${SELECT} WHERE k.user_id = ? AND k.id = ?`).get(workspaceId, id)) as ActivityComment | undefined) ?? null;
}

/** Cantidad de comentarios por actividad (las que no tienen no aparecen). */
export async function countComments(workspaceId: string, activityIds: string[], db: Db = getDb()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(activityIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400);
    const rows = (await db
      .prepare(
        `SELECT activity_id, COUNT(*) AS n FROM crm_activity_comments
         WHERE user_id = ? AND activity_id IN (${placeholders(part.length)}) GROUP BY activity_id`,
      )
      .all(workspaceId, ...part)) as Array<{ activity_id: string; n: number }>;
    for (const r of rows) out.set(r.activity_id, Number(r.n));
  }
  return out;
}

export class CommentError extends Error {
  constructor(public readonly code: 'empty' | 'too_many' | 'not_found' | 'forbidden') {
    super(code);
    this.name = 'CommentError';
  }
}

function cleanBody(body: string): string {
  const clean = sanitizeNoteMarkdown(body, COMMENT_MAX);
  if (!clean) throw new CommentError('empty');
  return clean;
}

/** Comentario nuevo de `authorId` (la persona real) en una actividad del workspace. */
export async function createComment(
  workspaceId: string,
  activityId: string,
  authorId: string,
  body: string,
  db: Db = getDb(),
): Promise<ActivityComment> {
  const clean = cleanBody(body);
  const owned = await db.prepare('SELECT 1 FROM crm_activities WHERE id = ? AND user_id = ?').get(activityId, workspaceId);
  if (!owned) throw new CommentError('not_found');
  const n = (await db
    .prepare('SELECT COUNT(*) AS n FROM crm_activity_comments WHERE user_id = ? AND activity_id = ?')
    .get(workspaceId, activityId)) as { n: number };
  if (Number(n.n) >= MAX_COMMENTS_PER_ACTIVITY) throw new CommentError('too_many');
  const id = crypto.randomUUID();
  const ts = nowDb();
  await db
    .prepare(
      `INSERT INTO crm_activity_comments (id, user_id, activity_id, author_id, body, edited, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, workspaceId, activityId, authorId, clean, ts, ts);
  return (await getComment(workspaceId, id, db))!;
}

/** Edita un comentario propio. CommentError('forbidden') si es de otra persona. */
export async function updateComment(
  workspaceId: string,
  activityId: string,
  id: string,
  authorId: string,
  body: string,
  db: Db = getDb(),
): Promise<{ before: ActivityComment; after: ActivityComment }> {
  const before = await getComment(workspaceId, id, db);
  if (!before || before.activity_id !== activityId) throw new CommentError('not_found');
  if (before.author_id !== authorId) throw new CommentError('forbidden');
  const clean = cleanBody(body);
  await db
    .prepare('UPDATE crm_activity_comments SET body = ?, edited = 1, updated_at = ? WHERE id = ? AND user_id = ? AND author_id = ?')
    .run(clean, nowDb(), id, workspaceId, authorId);
  return { before, after: (await getComment(workspaceId, id, db))! };
}

/** Borra un comentario propio. CommentError('forbidden') si es de otra persona. */
export async function deleteComment(workspaceId: string, activityId: string, id: string, authorId: string, db: Db = getDb()): Promise<void> {
  const row = await getComment(workspaceId, id, db);
  if (!row || row.activity_id !== activityId) throw new CommentError('not_found');
  if (row.author_id !== authorId) throw new CommentError('forbidden');
  await db.prepare('DELETE FROM crm_activity_comments WHERE id = ? AND user_id = ? AND author_id = ?').run(id, workspaceId, authorId);
}

/**
 * Suma `comment_count` a los ítems del timeline que son actividades (y a los
 * threads de email, por la actividad que los registra: `comment_activity_id`).
 * Los ítems ya pasaron por la visibilidad de quien mira.
 */
export async function withCommentCounts<T extends { id: string; external?: boolean; chat_private?: 1; thread?: { activityId?: string | null } }>(
  workspaceId: string,
  items: T[],
  scope: OwnerScope | undefined,
): Promise<Array<T & { comment_count?: number; comment_activity_id?: string }>> {
  // Un thread se ve por sus contactos; su actividad puede nombrar un registro que la persona no ve: sin hilo.
  const threadActs = items.map((i) => i.thread?.activityId).filter((v): v is string => Boolean(v));
  const okThreads = new Set<string>();
  for (let i = 0; i < threadActs.length; i += 400) {
    const part = threadActs.slice(i, i + 400);
    const vis = activityScopeSql('a', scope);
    const rows = (await getDb()
      .prepare(`SELECT a.id FROM crm_activities a WHERE a.user_id = ? AND a.id IN (${placeholders(part.length)})${vis.sql ? ` AND ${vis.sql}` : ''}`)
      .all(workspaceId, ...part, ...vis.args)) as Array<{ id: string }>;
    for (const r of rows) okThreads.add(r.id);
  }
  const target = (i: T): string | null => {
    if (i.thread) return i.thread.activityId && okThreads.has(i.thread.activityId) ? i.thread.activityId : null;
    // Tarea de un chat de Lines que no ve: ni el hilo ni cuántos comentarios tiene.
    return i.external || i.chat_private ? null : i.id;
  };
  const ids = items.map(target).filter((v): v is string => Boolean(v));
  if (!ids.length) return items;
  const counts = await countComments(workspaceId, ids);
  return items.map((i) => {
    const id = target(i);
    return id ? { ...i, comment_activity_id: id, comment_count: counts.get(id) ?? 0 } : i;
  });
}

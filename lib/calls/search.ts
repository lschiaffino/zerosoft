/** Calls en Cmd+K: llamadas por título o por lo que se dijo, solo las que la persona ve. */
import { getDb } from '../db';
import { getSettings } from './settings';
import { LIBRARY_STATUSES, type CallsActor } from './types';

export interface CallsSearchHit {
  id: string;
  label: string;
  meta: string;
  href: string;
}

export async function searchCalls(actor: CallsActor, q: string, limit = 8): Promise<CallsSearchHit[]> {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const settings = await getSettings(actor.ws);
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, c.title, COALESCE(c.started_at, c.created_at) AS at, (c.title LIKE ? ESCAPE '\\') AS in_title
       FROM calls c WHERE c.workspace_id = ? AND c.deleted_at IS NULL AND c.status IN (${LIBRARY_STATUSES.map(() => '?').join(',')})
         AND (? = 1 OR c.owner_id = ? OR ? = 'team')
         AND (c.title LIKE ? ESCAPE '\\' OR c.transcript_text LIKE ? ESCAPE '\\')
       ORDER BY in_title DESC, at DESC LIMIT ?`,
    )
    .all(like, actor.ws, ...LIBRARY_STATUSES, actor.admin ? 1 : 0, actor.person, settings.visibility, like, like, limit)) as Array<{ id: string; title: string; at: string }>;
  return rows.map((r) => ({ id: r.id, label: r.title || 'Call', meta: `Calls · ${r.at.slice(0, 10)}`, href: `/app/calls/call/${r.id}` }));
}

/** Send en Cmd+K: documentos y espacios por título, solo los que la persona ve. */
import { getDb } from '../db';
import type { SendActor } from './types';

export interface SendSearchHit {
  id: string;
  label: string;
  meta: string;
  href: string;
}

export async function searchSend(actor: SendActor, q: string, limit = 8): Promise<SendSearchHit[]> {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const db = getDb();
  const vis = `(? = 1 OR x.owner_id = ? OR x.sharing = 'workspace')`;
  const docs = (await db
    .prepare(`SELECT x.id, x.title FROM send_documents x WHERE x.workspace_id = ? AND x.deleted_at IS NULL AND ${vis} AND x.title LIKE ? ESCAPE '\\' ORDER BY x.updated_at DESC LIMIT ?`)
    .all(actor.ws, actor.admin ? 1 : 0, actor.person, like, limit)) as Array<{ id: string; title: string }>;
  const spaces = (await db
    .prepare(`SELECT x.id, x.title FROM send_spaces x WHERE x.workspace_id = ? AND x.deleted_at IS NULL AND ${vis} AND x.title LIKE ? ESCAPE '\\' ORDER BY x.updated_at DESC LIMIT ?`)
    .all(actor.ws, actor.admin ? 1 : 0, actor.person, like, limit)) as Array<{ id: string; title: string }>;
  return [
    ...docs.map((d) => ({ id: d.id, label: d.title, meta: 'Send', href: `/app/send/documents/${d.id}` })),
    ...spaces.map((s) => ({ id: s.id, label: s.title, meta: 'Send', href: `/app/send/spaces/${s.id}` })),
  ].slice(0, limit);
}

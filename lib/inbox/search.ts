/** Inbox en Cmd+K: carpetas, chats y correos de la persona por nombre, teléfono, email o último mensaje, y los mensajes que coinciden. Nunca de otra persona. */
import { getDb } from '../db';
import { HIT_END, HIT_START, searchMessages } from './message-search';

export interface InboxSearchHit {
  id: string;
  label: string;
  meta: string;
  href: string;
}

export async function searchInbox(owner: string, q: string, limit = 8): Promise<InboxSearchHit[]> {
  const term = q.trim().slice(0, 200);
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = (await getDb()
    .prepare(
      `SELECT id, title, handle, channel FROM inbox_threads WHERE owner_id = ?
         AND (title LIKE ? ESCAPE '\\' OR handle LIKE ? ESCAPE '\\' OR preview LIKE ? ESCAPE '\\')
       ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT ?`,
    )
    .all(owner, like, like, like, limit)) as Array<{ id: string; title: string; handle: string; channel: string }>;
  const folders = (await getDb()
    .prepare(`SELECT id, name FROM inbox_folders WHERE owner_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY position LIMIT ?`)
    .all(owner, like, limit)) as Array<{ id: string; name: string }>;
  // Mensajes: los más nuevos que coinciden, con el texto encontrado; abren el chat en ese mensaje.
  const msgs = await searchMessages(owner, term, { limit: 4 }).catch(() => ({ hits: [] }));
  const clean = (s: string) => s.replaceAll(HIT_START, '').replaceAll(HIT_END, '');
  return [
    ...folders.map((f) => ({ id: f.id, label: f.name, meta: 'Inbox', href: `/app/inbox/f/${f.id}` })),
    ...rows.map((r) => ({
      id: r.id,
      label: r.title || r.handle,
      meta: r.channel === 'gmail' ? 'Gmail' : 'WhatsApp',
      href: `/app/inbox?t=${encodeURIComponent(r.id)}`,
    })),
    ...msgs.hits.map((h) => ({
      id: h.id,
      label: clean(h.snippet).slice(0, 120) || h.mediaName,
      meta: h.threadTitle,
      href: `/app/inbox?t=${encodeURIComponent(h.threadId)}&m=${encodeURIComponent(h.id)}`,
    })),
  ].slice(0, limit + 4);
}

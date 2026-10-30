/**
 * Docs en vivo: presencia (quién está en la página y dónde tiene el cursor)
 * y avisos de sugerencias. El navegador hace polling a
 * /api/docs/pages/<id>/live (cada ~1,5 s con otras personas, más lento a
 * solas o con la pestaña oculta): cada pulso guarda su cursor, trae a los
 * demás y, si la página cambió, la versión nueva para fusionarla en el editor
 * (lib/docs-merge.ts). Sin websockets: anda igual en Vercel y en un servidor propio.
 */
import { getDb, type DocsPageRow } from './db';
import { createNotification } from './notifications';
import type { SessionUser } from './session';
import { realUserId } from './session';

/** Un pulso más viejo que esto ya no cuenta como presente. */
export const PRESENCE_TTL_MS = 20_000;
export const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface DocsPeer {
  session: string;
  user_id: string;
  name: string;
  image: string | null;
  block_id: string | null;
  start: number | null;
  end: number | null;
  /** 'edit' | 'suggest' | 'view' | 'comment': qué está haciendo. */
  mode: string;
  updated_at: string;
}

export async function touchPresence(args: {
  pageId: string;
  session: string;
  userId: string;
  blockId: string | null;
  start: number | null;
  end: number | null;
  mode: string;
  now?: Date;
}): Promise<void> {
  const now = (args.now ?? new Date()).toISOString();
  // Una sesión que ya se fue (cerró la pestaña): un pulso o cursor que llega tarde no la revive.
  if (await sessionLeft(args.pageId, args.session)) return;
  await getDb()
    .prepare(
      `INSERT INTO docs_presence (page_id, session_id, user_id, block_id, sel_start, sel_end, mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, session_id) DO UPDATE SET user_id = excluded.user_id, block_id = excluded.block_id,
         sel_start = excluded.sel_start, sel_end = excluded.sel_end, mode = excluded.mode, updated_at = excluded.updated_at`,
    )
    .run(args.pageId, args.session, args.userId, args.blockId, args.start, args.end, args.mode.slice(0, 16), now);
  // Limpieza de pulsos viejos (de vez en cuando, no en cada request).
  if (Math.random() < 0.05) {
    const cutoff = new Date(Date.parse(now) - 10 * 60_000).toISOString();
    await getDb().prepare('DELETE FROM docs_presence WHERE updated_at < ?').run(cutoff);
  }
}

export async function leavePresence(pageId: string, session: string, userId: string): Promise<void> {
  await getDb().prepare('DELETE FROM docs_presence WHERE page_id = ? AND session_id = ? AND user_id = ?').run(pageId, session, userId);
}

/** La sesión avisó que se fue de la página (feed en vivo, lib/docs-coedit.ts). */
export async function sessionLeft(pageId: string, session: string): Promise<boolean> {
  try {
    return !!(await getDb().prepare("SELECT 1 FROM docs_live_events WHERE kind = 'leave' AND page_id = ? AND session_id = ? LIMIT 1").get(pageId, session));
  } catch {
    return false;
  }
}

/** Las demás sesiones presentes en la página (la propia no). */
export async function listPeers(pageId: string, exceptSession: string, now = new Date()): Promise<DocsPeer[]> {
  const cutoff = new Date(now.getTime() - PRESENCE_TTL_MS).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT p.session_id, p.user_id, p.block_id, p.sel_start, p.sel_end, p.mode, p.updated_at, u.name, u.email, u.image
       FROM docs_presence p JOIN users u ON u.id = p.user_id
       WHERE p.page_id = ? AND p.updated_at >= ? AND p.session_id != ?
       ORDER BY p.updated_at DESC LIMIT 50`,
    )
    .all(pageId, cutoff, exceptSession)) as Array<{
    session_id: string;
    user_id: string;
    block_id: string | null;
    sel_start: number | null;
    sel_end: number | null;
    mode: string;
    updated_at: string;
    name: string | null;
    email: string;
    image: string | null;
  }>;
  return rows.map((r) => ({
    session: r.session_id,
    user_id: r.user_id,
    // Sin email completo: el nombre o la parte antes de la @.
    name: r.name?.trim() || r.email.split('@')[0],
    image: r.image,
    block_id: r.block_id,
    start: r.sel_start,
    end: r.sel_end,
    mode: r.mode,
    updated_at: r.updated_at,
  }));
}

/** Firma barata de los comentarios de una página: cambia si se agrega, borra o resuelve uno. */
export async function commentsSignature(pageId: string): Promise<string> {
  const row = (await getDb()
    .prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last, SUM(resolved) AS res FROM docs_comments WHERE page_id = ?')
    .get(pageId)) as { n: number; last: string | null; res: number | null };
  return `${row.n}:${row.last ?? ''}:${row.res ?? 0}`;
}

/** Sugerencias nuevas en una página: aviso en la campana al dueño (wiki) o al dueño del workspace. */
export async function notifyDocsSuggestions(page: DocsPageRow, user: SessionUser, count: number): Promise<void> {
  const actorId = realUserId(user);
  const target = page.page_owner_id || page.user_id;
  if (!target || target === actorId) return;
  const actor = user.actingUser ?? user;
  const who = actor.name?.trim() || actor.email;
  await createNotification({
    userId: target,
    type: 'comment',
    title: `${who} suggested ${count === 1 ? 'an edit' : `${count} edits`} in ${page.title || 'Untitled'}`,
    href: `/app/docs/${page.id}`,
    sourceType: 'docs_page',
    sourceId: page.id,
    meta: { pageTitle: page.title, actorName: who, actorId, suggestion: true },
  });
}

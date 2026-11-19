/**
 * Rec: papelera de la retención. Server-only.
 *
 * La retención (applyRetention, lib/rec-admin.ts) manda a la papelera los videos que pasan el plazo del
 * workspace; acá se listan (título y fechas, nada del video) y se restauran con sus comentarios y analítica.
 * Quien grabó un video ve y restaura los suyos; un admin, los de todos. Un video restaurado vuelve a contar su
 * plazo desde ese momento (retained_at).
 */
import { getDb } from './db';
import { nowDb, RecError, type RecActor } from './rec';
import { getSoftDeleted, listSoftDeleted, restoreSoftDeleted, type SoftDeleteEntry } from './soft-delete';

export interface RecTrashItem {
  id: string;
  title: string;
  /** Quien lo grabó (para que un admin sepa de quién es). */
  ownerId: string | null;
  deletedAt: string;
  purgeAt: string;
}

function itemOf(e: SoftDeleteEntry): RecTrashItem {
  return { id: e.id, title: e.label, ownerId: e.scopeId, deletedAt: e.deletedAt, purgeAt: e.purgeAt };
}

export async function listRecTrash(a: RecActor): Promise<RecTrashItem[]> {
  const rows = await listSoftDeleted(a.ws, 'rec', { kind: 'video', limit: 500, ...(a.admin ? {} : { scopeIds: [a.actor] }) });
  return rows.map(itemOf);
}

/** Restaura un video. conflict si algo ocupó su lugar mientras tanto (la entrada queda). */
export async function restoreRecTrash(a: RecActor, entryId: string): Promise<RecTrashItem> {
  const entry = await getSoftDeleted(a.ws, 'rec', entryId);
  if (!entry || entry.kind !== 'video' || (!a.admin && entry.scopeId !== a.actor)) throw new RecError('not_found', 404);
  const res = await restoreSoftDeleted(a.ws, 'rec', entryId);
  if (!res.ok) throw new RecError(res.reason, res.reason === 'conflict' ? 409 : 404);
  const db = getDb();
  await db.prepare('UPDATE rec_videos SET retained_at = ? WHERE id = ? AND workspace_id = ?').run(nowDb(), entry.recordId, a.ws);
  await db.prepare('UPDATE rec_settings SET retention_deleted = MAX(0, retention_deleted - 1) WHERE workspace_id = ?').run(a.ws);
  return itemOf(entry);
}

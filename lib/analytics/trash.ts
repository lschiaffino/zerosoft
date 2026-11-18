/**
 * Analytics: papelera de la retención de replay. Server-only.
 *
 * La retención (runReplayRetention, lib/analytics/replay.ts) manda a la papelera las grabaciones que pasan el
 * plazo del proyecto; acá se listan (cuándo empezó cada una y cuándo se borra para siempre, nada de la persona
 * ni de las páginas) y se restauran. Las ven y restauran los admins, igual que las grabaciones. Una grabación
 * restaurada vuelve a contar su retención desde ese momento (retained_at).
 *
 * Los eventos y sesiones viejos se siguen borrando en duro (lib/analytics/cron.ts): son filas sueltas y
 * agregados, no un registro que alguien restauraría.
 */
import { getDb } from '../db';
import { listSoftDeleted, purgeSoftDeleted, restoreSoftDeleted, type SoftDeleteEntry } from '../soft-delete';

export interface ReplayTrashItem {
  id: string;
  /** Cuándo empezó la grabación (ISO). */
  startedAt: string;
  deletedAt: string;
  purgeAt: string;
}

function itemOf(e: SoftDeleteEntry): ReplayTrashItem {
  return { id: e.id, startedAt: e.label, deletedAt: e.deletedAt, purgeAt: e.purgeAt };
}

/** El caller ya comprobó que el proyecto es del workspace y que quien pide es admin. */
export async function listReplayTrash(workspaceId: string, projectId: string): Promise<ReplayTrashItem[]> {
  return (await listSoftDeleted(workspaceId, 'analytics', { kind: 'recording', scopeIds: [projectId], limit: 500 })).map(itemOf);
}

export type ReplayRestoreResult = { ok: true; item: ReplayTrashItem } | { ok: false; reason: 'not_found' | 'conflict' };

/** Restaura una grabación. conflict si la misma sesión volvió a grabarse mientras tanto (la entrada queda). */
export async function restoreReplayTrash(workspaceId: string, projectId: string, entryId: string, now = Date.now()): Promise<ReplayRestoreResult> {
  const db = getDb();
  const entry = (await db
    .prepare("SELECT id FROM soft_deleted WHERE id = ? AND workspace_id = ? AND app = 'analytics' AND kind = 'recording' AND scope_id = ?")
    .get(entryId, workspaceId, projectId)) as { id: string } | undefined;
  if (!entry) return { ok: false, reason: 'not_found' };
  const res = await restoreSoftDeleted(workspaceId, 'analytics', entryId);
  if (!res.ok) return res;
  await db.prepare('UPDATE analytics_replay_recordings SET retained_at = ? WHERE id = ? AND project_id = ?').run(now, res.entry.recordId, projectId);
  return { ok: true, item: itemOf(res.entry) };
}

/**
 * Borrar una persona (o pedir su borrado por API) se lleva también sus grabaciones de la papelera, con sus
 * chunks. La entrada no guarda el distinct_id a la vista: se lee de la fila guardada en el snapshot.
 */
export async function purgeReplayTrashOf(projectId: string, distinctIds: string[]): Promise<number> {
  if (!distinctIds.length) return 0;
  const db = getDb();
  let purged = 0;
  for (let i = 0; i < distinctIds.length; i += 50) {
    const part = distinctIds.slice(i, i + 50);
    const rows = (await db
      .prepare(
        `SELECT id, workspace_id FROM soft_deleted WHERE app = 'analytics' AND kind = 'recording' AND scope_id = ?
         AND json_extract(snapshot, '$.tables[0].rows[0].distinct_id') IN (${part.map(() => '?').join(',')})`,
      )
      .all(projectId, ...part)) as Array<{ id: string; workspace_id: string }>;
    for (const r of rows) if (await purgeSoftDeleted(r.workspace_id, 'analytics', r.id)) purged++;
  }
  return purged;
}

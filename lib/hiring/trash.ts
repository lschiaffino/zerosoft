/**
 * Hiring: papelera de la retención. Server-only.
 *
 * La limpieza horaria (purgeExpiredCandidates) manda a la papelera a los candidatos inactivos más allá de la
 * retención del workspace; acá un admin los ve (nombre y fechas, nada más) y los restaura con sus postulaciones,
 * documentos y su línea de tiempo. Restaurar cuenta como actividad: la retención vuelve a contar desde ahí y
 * la línea de tiempo lo anota.
 */
import { getDb } from '../db';
import { listSoftDeleted, purgeSoftDeleted, restoreSoftDeleted, type SoftDeleteEntry } from '../soft-delete';
import { addEvent } from './events';
import { HiringError, type HiringActor } from './types';

export interface HiringTrashItem {
  id: string;
  name: string;
  deletedAt: string;
  purgeAt: string;
}

function itemOf(e: SoftDeleteEntry): HiringTrashItem {
  return { id: e.id, name: e.label, deletedAt: e.deletedAt, purgeAt: e.purgeAt };
}

function requireAdmin(actor: HiringActor): void {
  if (!actor.admin) throw new HiringError('forbidden', 403);
}

export async function listHiringTrash(actor: HiringActor): Promise<HiringTrashItem[]> {
  requireAdmin(actor);
  return (await listSoftDeleted(actor.ws, 'hiring', { kind: 'candidate', limit: 500 })).map(itemOf);
}

/** Restaura un candidato. conflict si algo ocupó su lugar mientras tanto (la entrada queda). */
export async function restoreHiringTrash(actor: HiringActor, entryId: string): Promise<HiringTrashItem> {
  requireAdmin(actor);
  const res = await restoreSoftDeleted(actor.ws, 'hiring', entryId);
  if (!res.ok) throw new HiringError(res.reason, res.reason === 'conflict' ? 409 : 404);
  await getDb().prepare('UPDATE hiring_candidates SET purge_claimed_at = NULL WHERE id = ? AND workspace_id = ?').run(res.entry.recordId, actor.ws);
  // addEvent también mueve last_activity_at: la retención cuenta desde la restauración.
  await addEvent(actor.ws, res.entry.recordId, null, 'restored', actor.person);
  return itemOf(res.entry);
}

interface TrashedCandidate {
  entryId: string;
  ws: string;
  email: string;
}

/** Fila raíz (hiring_candidates) del snapshot de una entrada. */
function rootRow(snapshot: string): Record<string, unknown> | null {
  try {
    const snap = JSON.parse(snapshot) as { tables?: Array<{ table: string; rows: Array<Record<string, unknown>> }> };
    const first = snap.tables?.[0];
    return first?.table === 'hiring_candidates' ? (first.rows[0] ?? null) : null;
  } catch {
    return null;
  }
}

/** El candidato en la papelera con ese hash de token para olvidarlo (link del email), si hay. */
export async function trashedByForgetHash(hash: string): Promise<TrashedCandidate | null> {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const rows = (await getDb()
    .prepare("SELECT id, workspace_id, snapshot FROM soft_deleted WHERE app = 'hiring' AND kind = 'candidate' AND instr(snapshot, ?) > 0 LIMIT 5")
    .all(`"forget_token_hash":"${hash}"`)) as Array<{ id: string; workspace_id: string; snapshot: string }>;
  for (const r of rows) {
    const root = rootRow(r.snapshot);
    if (root?.forget_token_hash === hash) return { entryId: r.id, ws: r.workspace_id, email: String(root.email ?? '') };
  }
  return null;
}

/**
 * Pedido de borrado del candidato: lo que tiene en la papelera con ese email se purga ya (con CV y documentos),
 * sin esperar el plazo. Devuelve cuántas entradas purgó.
 */
export async function purgeTrashedByEmail(ws: string, email: string): Promise<number> {
  const want = email.trim().toLowerCase();
  if (!want) return 0;
  const rows = (await getDb()
    .prepare("SELECT id, snapshot FROM soft_deleted WHERE workspace_id = ? AND app = 'hiring' AND kind = 'candidate' AND instr(lower(snapshot), ?) > 0")
    .all(ws, JSON.stringify(want))) as Array<{ id: string; snapshot: string }>;
  let n = 0;
  for (const r of rows) {
    const root = rootRow(r.snapshot);
    if (String(root?.email ?? '').toLowerCase() !== want) continue;
    if (await purgeSoftDeleted(ws, 'hiring', r.id)) n++;
  }
  return n;
}

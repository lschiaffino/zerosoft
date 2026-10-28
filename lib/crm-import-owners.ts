/**
 * CRM — owners del otro CRM que se suman después de la migración.
 *
 * Al importar, los registros de un owner de HubSpot/Pipedrive que todavía no
 * era miembro quedan con el owner por defecto y anotados en
 * crm_import_pending_owners (con el email de ese owner). Cuando una persona
 * con ese email se une al workspace (lib/workspace-lifecycle.ts › personJoined, que corre al
 * aceptar la invitación), sus registros pasan a ser suyos: solo los que
 * siguen con el owner por defecto. Los que alguien reasignó a mano no se
 * tocan. Después la anotación se borra.
 */
import { getDb } from './db';

const TABLES: Record<string, string> = {
  company: 'crm_companies',
  contact: 'crm_contacts',
  deal: 'crm_deals',
  activity: 'crm_activities',
};

export interface ClaimResult {
  /** Registros que pasaron a la persona. */
  reassigned: number;
  /** Anotados que ya tenían otro owner (alguien los reasignó): quedan como estaban. */
  kept: number;
}

/** Pasa a `personId` los registros importados que esperaban a su email en el workspace. */
export async function claimImportedRecords(workspaceId: string, personId: string): Promise<ClaimResult> {
  const db = getDb();
  const user = (await db.prepare('SELECT email FROM users WHERE id = ?').get(personId)) as { email: string } | undefined;
  const email = user?.email?.trim().toLowerCase();
  const out: ClaimResult = { reassigned: 0, kept: 0 };
  if (!email) return out;
  const rows = (await db
    .prepare('SELECT entity, record_id, default_owner_id FROM crm_import_pending_owners WHERE workspace_id = ? AND email = ?')
    .all(workspaceId, email)) as Array<{ entity: string; record_id: string; default_owner_id: string }>;
  for (const r of rows) {
    const table = TABLES[r.entity];
    if (!table) continue;
    const res = await db
      .prepare(`UPDATE ${table} SET owner_id = ? WHERE id = ? AND user_id = ? AND owner_id = ?`)
      .run(personId, r.record_id, workspaceId, r.default_owner_id);
    if (res.changes > 0) out.reassigned += 1;
    else out.kept += 1;
  }
  if (rows.length) await db.prepare('DELETE FROM crm_import_pending_owners WHERE workspace_id = ? AND email = ?').run(workspaceId, email);
  return out;
}


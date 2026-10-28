/**
 * CRM — validación de ids referenciados (company_id, owner_id, contactos, deals).
 * Cualquier id que llega del cliente se verifica contra el workspace antes de
 * guardarse, así un registro nunca apunta a datos de otro workspace.
 * Server-only.
 */
import { getDb, type Db } from './db';

/** Referencia inválida (no existe o es de otro workspace). Las rutas responden 400. */
export class CrmRefError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'CrmRefError';
  }
}

async function owns(db: Db, table: string, userId: string, id: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId));
}

/** El owner es el dueño del workspace o un miembro de alguno de sus teams. */
export async function isWorkspacePerson(userId: string, personId: string, db: Db = getDb()): Promise<boolean> {
  if (personId === userId) return true;
  return !!(await db
    .prepare(
      `SELECT 1 FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE t.owner_id = ? AND m.user_id = ? AND m.role != 'guest' LIMIT 1`,
    )
    .get(userId, personId));
}

/** Valida las referencias presentes (undefined/null no se validan). Lanza CrmRefError. */
export async function assertRefs(
  userId: string,
  refs: {
    companyId?: string | null;
    contactId?: string | null;
    dealId?: string | null;
    ownerId?: string | null;
  },
  db: Db = getDb(),
): Promise<void> {
  if (refs.companyId && !(await owns(db, 'crm_companies', userId, refs.companyId))) {
    throw new CrmRefError('invalid_company');
  }
  if (refs.contactId && !(await owns(db, 'crm_contacts', userId, refs.contactId))) {
    throw new CrmRefError('invalid_contact');
  }
  if (refs.dealId && !(await owns(db, 'crm_deals', userId, refs.dealId))) {
    throw new CrmRefError('invalid_deal');
  }
  if (refs.ownerId && !(await isWorkspacePerson(userId, refs.ownerId, db))) {
    throw new CrmRefError('invalid_owner');
  }
}

/** Filtra a los contactos que pertenecen al workspace (descarta el resto). */
export async function ownedContactIds(userId: string, ids: string[], db: Db = getDb()): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = (await db
    .prepare(
      `SELECT id FROM crm_contacts WHERE user_id = ? AND id IN (${unique.map(() => '?').join(',')})`,
    )
    .all(userId, ...unique)) as Array<{ id: string }>;
  const ok = new Set(rows.map((r) => r.id));
  return unique.filter((id) => ok.has(id));
}

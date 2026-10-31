/**
 * CRM — asignación round-robin de leads nuevos. Server-only.
 *
 * Una regla por workspace: fuentes que asigna (form, chat, cal, import, api),
 * pool ordenado de personas y un cursor persistente (mismo enfoque que el
 * round-robin de hosts de Cal: lib/calendar.ts → rr_cursor). Las personas
 * marcadas como no disponibles (fuera de oficina) se saltean sin perder su
 * turno en el orden. Cada asignación queda en crm_assignment_history.
 */
import { localized } from './notification-copy';
import { getDb, type Db } from './db';
import { isWorkspacePerson } from './crm-refs';
import { createNotification } from './notifications';

export const ASSIGNMENT_SOURCES = ['form', 'chat', 'cal', 'import', 'api'] as const;
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];

export interface AssignmentRule {
  enabled: boolean;
  sources: AssignmentSource[];
  /** Personas en orden round-robin. */
  pool: string[];
  cursor: number;
}

function parseList(raw: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function getAssignmentRule(workspaceId: string, db: Db = getDb()): Promise<AssignmentRule> {
  const row = (await db.prepare('SELECT * FROM crm_assignment_rules WHERE user_id = ?').get(workspaceId)) as
    | { enabled: number; sources: string; pool: string; cursor: number }
    | undefined;
  return {
    enabled: !!row?.enabled,
    sources: parseList(row?.sources).filter((s): s is AssignmentSource =>
      (ASSIGNMENT_SOURCES as readonly string[]).includes(s),
    ),
    pool: parseList(row?.pool),
    cursor: Number(row?.cursor ?? 0),
  };
}

export async function saveAssignmentRule(
  workspaceId: string,
  input: { enabled: boolean; sources: string[]; pool: string[] },
  db: Db = getDb(),
): Promise<AssignmentRule> {
  const sources = [...new Set(input.sources)].filter((s): s is AssignmentSource =>
    (ASSIGNMENT_SOURCES as readonly string[]).includes(s),
  );
  const pool: string[] = [];
  for (const p of [...new Set(input.pool)]) {
    if (await isWorkspacePerson(workspaceId, p, db)) pool.push(p);
  }
  await db
    .prepare(
      `INSERT INTO crm_assignment_rules (user_id, enabled, sources, pool, cursor, updated_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, sources = excluded.sources,
         pool = excluded.pool, cursor = CASE WHEN crm_assignment_rules.pool = excluded.pool THEN crm_assignment_rules.cursor ELSE 0 END,
         updated_at = excluded.updated_at`,
    )
    .run(workspaceId, input.enabled ? 1 : 0, JSON.stringify(sources), JSON.stringify(pool));
  return getAssignmentRule(workspaceId, db);
}

/** Personas marcadas como no disponibles (out of office). */
export async function unavailablePeople(workspaceId: string, db: Db = getDb()): Promise<Set<string>> {
  const rows = (await db
    .prepare('SELECT person_id FROM crm_member_availability WHERE user_id = ? AND available = 0')
    .all(workspaceId)) as Array<{ person_id: string }>;
  return new Set(rows.map((r) => r.person_id));
}

export async function setAvailability(
  workspaceId: string,
  personId: string,
  available: boolean,
  db: Db = getDb(),
): Promise<boolean> {
  if (!(await isWorkspacePerson(workspaceId, personId, db))) return false;
  await db
    .prepare(
      `INSERT INTO crm_member_availability (user_id, person_id, available, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, person_id) DO UPDATE SET available = excluded.available, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, personId, available ? 1 : 0);
  return true;
}

/**
 * Próximo owner del pool desde el cursor, salteando no disponibles. Avanza el
 * cursor con compare-and-set (dos leads simultáneos no se llevan a la misma
 * persona); reintenta si otro proceso lo movió. null si no hay nadie.
 */
export async function pickNextOwner(workspaceId: string, db: Db = getDb()): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rule = await getAssignmentRule(workspaceId, db);
    if (!rule.pool.length) return null;
    const away = await unavailablePeople(workspaceId, db);
    const n = rule.pool.length;
    const start = ((rule.cursor % n) + n) % n;
    let chosen = -1;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % n;
      if (!away.has(rule.pool[idx])) {
        chosen = idx;
        break;
      }
    }
    if (chosen < 0) return null;
    const res = await db
      .prepare('UPDATE crm_assignment_rules SET cursor = ? WHERE user_id = ? AND cursor = ?')
      .run((chosen + 1) % n, workspaceId, rule.cursor);
    if (res.changes > 0) return rule.pool[chosen];
  }
  return null;
}

/**
 * Asigna un lead nuevo si la regla del workspace está activa para esa fuente.
 * Devuelve el owner asignado (o null si no aplica). Nunca lanza.
 */
export async function assignNewLead(
  workspaceId: string,
  contactId: string,
  source: AssignmentSource,
  db: Db = getDb(),
): Promise<string | null> {
  try {
    const rule = await getAssignmentRule(workspaceId, db);
    if (!rule.enabled || !rule.sources.includes(source)) return null;
    const personId = await pickNextOwner(workspaceId, db);
    if (!personId) return null;
    await db
      .prepare("UPDATE crm_contacts SET owner_id = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(personId, contactId, workspaceId);
    await db
      .prepare(
        'INSERT INTO crm_assignment_history (id, user_id, contact_id, person_id, source, method) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(crypto.randomUUID(), workspaceId, contactId, personId, source, 'round_robin');
    const contact = (await db
      .prepare('SELECT first_name, last_name, email FROM crm_contacts WHERE id = ?')
      .get(contactId)) as { first_name: string; last_name: string; email: string } | undefined;
    const name = contact ? `${contact.first_name} ${contact.last_name}`.trim() || contact.email : '';
    await createNotification({
      userId: personId,
      type: 'crm_lead',
      title: name ? localized('leadAssigned', { name }) : localized('leadAssignedContact'),
      body: localized('leadSource', { source }),
      href: `/app/crm/contacts/${contactId}`,
      sourceType: 'crm_contact',
      sourceId: contactId,
    }).catch(() => null);
    return personId;
  } catch {
    return null;
  }
}

export interface AssignmentHistoryRow {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  person_id: string;
  person_email: string | null;
  source: string;
  method: string;
  created_at: string;
}

export async function listAssignmentHistory(
  workspaceId: string,
  limit = 50,
  db: Db = getDb(),
): Promise<AssignmentHistoryRow[]> {
  return (await db
    .prepare(
      `SELECT h.id, h.contact_id, NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name,
         h.person_id, u.email AS person_email, h.source, h.method, h.created_at
       FROM crm_assignment_history h
       LEFT JOIN crm_contacts c ON c.id = h.contact_id
       LEFT JOIN users u ON u.id = h.person_id
       WHERE h.user_id = ?
       ORDER BY h.created_at DESC, h.rowid DESC
       LIMIT ?`,
    )
    .all(workspaceId, Math.min(Math.max(limit, 1), 200))) as AssignmentHistoryRow[];
}

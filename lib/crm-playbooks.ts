/**
 * CRM — playbooks: CRUD por workspace y "usar" un playbook en un registro
 * (guarda las respuestas en propiedades y deja el uso en el timeline como
 * nota o llamada). Server-only. Lo puro vive en lib/crm-playbooks-schema.ts.
 */
import { getDb, type CrmPlaybookRow, type CrmPlaybookRunRow, type Db } from './db';
import { createActivity, listCustomFields, parseCustom, updateCompany, updateContact, updateDeal } from './crm';
import { coerceCustomFieldValue } from './crm-custom-fields';
import {
  answersText,
  parseEntities,
  parseQuestions,
  propertyPatch,
  type Playbook,
  type PlaybookEntity,
  type PlaybookInput,
  type PlaybookRunInput,
} from './crm-playbooks-schema';

function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export function toPlaybook(row: CrmPlaybookRow): Playbook {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    questions: parseQuestions(row.questions),
    entities: parseEntities(row.entities),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface PlaybookListRow extends Playbook {
  uses: number;
  last_used_at: string | null;
}

export async function listPlaybooks(
  workspaceId: string,
  opts: { q?: string; entity?: PlaybookEntity; db?: Db } = {},
): Promise<PlaybookListRow[]> {
  const db = opts.db ?? getDb();
  const where = ['p.user_id = ?'];
  const args: string[] = [workspaceId];
  if (opts.q?.trim()) {
    where.push("p.name LIKE ? ESCAPE '\\'");
    args.push(`%${opts.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  const rows = (await db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM crm_playbook_runs r WHERE r.playbook_id = p.id) AS uses,
         (SELECT MAX(r.created_at) FROM crm_playbook_runs r WHERE r.playbook_id = p.id) AS last_used_at
       FROM crm_playbooks p WHERE ${where.join(' AND ')}
       ORDER BY p.name COLLATE NOCASE ASC`,
    )
    .all(...args)) as Array<CrmPlaybookRow & { uses: number; last_used_at: string | null }>;
  const list = rows.map((r) => ({ ...toPlaybook(r), uses: Number(r.uses ?? 0), last_used_at: r.last_used_at }));
  return opts.entity ? list.filter((p) => p.entities.includes(opts.entity!)) : list;
}

export async function getPlaybook(workspaceId: string, id: string, db: Db = getDb()): Promise<Playbook | null> {
  const row = (await db.prepare('SELECT * FROM crm_playbooks WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | CrmPlaybookRow
    | undefined;
  return row ? toPlaybook(row) : null;
}

export async function createPlaybook(
  workspaceId: string,
  input: PlaybookInput,
  createdBy: string | null,
  db: Db = getDb(),
): Promise<Playbook> {
  const id = crypto.randomUUID();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO crm_playbooks (id, user_id, name, body, questions, entities, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      input.name,
      input.body ?? '',
      JSON.stringify(input.questions ?? []),
      JSON.stringify(input.entities ?? ['contact', 'company', 'deal']),
      createdBy,
      ts,
      ts,
    );
  return (await getPlaybook(workspaceId, id, db))!;
}

export async function updatePlaybook(
  workspaceId: string,
  id: string,
  input: Partial<PlaybookInput>,
  db: Db = getDb(),
): Promise<Playbook | null> {
  const sets: Array<[string, string]> = [];
  if (input.name !== undefined) sets.push(['name', input.name]);
  if (input.body !== undefined) sets.push(['body', input.body]);
  if (input.questions !== undefined) sets.push(['questions', JSON.stringify(input.questions)]);
  if (input.entities !== undefined) sets.push(['entities', JSON.stringify(input.entities)]);
  if (sets.length) {
    const res = await db
      .prepare(`UPDATE crm_playbooks SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(...sets.map(([, v]) => v), now(), id, workspaceId);
    if (!res.changes) return null;
  }
  return getPlaybook(workspaceId, id, db);
}

export async function deletePlaybook(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  return (await db.prepare('DELETE FROM crm_playbooks WHERE id = ? AND user_id = ?').run(id, workspaceId)).changes > 0;
}

// ---------- Usar un playbook ----------

export type RunResult =
  | { ok: true; run: CrmPlaybookRunRow; activityId: string; updated: string[] }
  | { ok: false; reason: 'not_found' | 'wrong_entity' };

const TABLE: Record<PlaybookEntity, string> = { contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' };

/**
 * Guarda un uso: escribe las respuestas mapeadas en el registro, crea la nota
 * o la llamada en su timeline y deja el uso en crm_playbook_runs.
 */
export async function runPlaybook(
  workspaceId: string,
  playbookId: string,
  input: PlaybookRunInput,
  actor: { id: string; email: string },
  db: Db = getDb(),
): Promise<RunResult> {
  const playbook = await getPlaybook(workspaceId, playbookId, db);
  if (!playbook) return { ok: false, reason: 'not_found' };
  if (!playbook.entities.includes(input.entity)) return { ok: false, reason: 'wrong_entity' };
  const record = (await db.prepare(`SELECT * FROM ${TABLE[input.entity]} WHERE id = ? AND user_id = ?`).get(input.entityId, workspaceId)) as
    | (Record<string, unknown> & { custom: string | null; company_id?: string | null })
    | undefined;
  if (!record) return { ok: false, reason: 'not_found' };

  // Respuestas → propiedades (los custom se validan contra su campo y se suman a los que ya tiene).
  const { standard, custom } = propertyPatch(playbook.questions, input.answers, input.entity);
  const updated: string[] = Object.keys(standard);
  let mergedCustom: Record<string, unknown> | undefined;
  if (Object.keys(custom).length) {
    const defs = await listCustomFields(workspaceId, `${input.entity === 'company' ? 'companies' : `${input.entity}s`}`);
    mergedCustom = parseCustom(record.custom);
    for (const [name, value] of Object.entries(custom)) {
      const def = defs.find((d) => d.name === name);
      const v = def ? coerceCustomFieldValue(def, value) : undefined;
      if (v === undefined) continue;
      mergedCustom[name] = v;
      updated.push(`custom.${name}`);
    }
  }
  const patch = { ...standard, ...(mergedCustom ? { custom: mergedCustom } : {}) };
  if (Object.keys(patch).length) {
    if (input.entity === 'contact') await updateContact(workspaceId, input.entityId, patch, db, actor.email);
    else if (input.entity === 'company') await updateCompany(workspaceId, input.entityId, patch, db, actor.email);
    else await updateDeal(workspaceId, input.entityId, patch, actor.email);
  }

  // Timeline: nota o llamada con el guion respondido.
  const transcript = answersText(playbook.questions, input.answers);
  const callNote = input.call?.note?.trim() ?? '';
  const body = [callNote, transcript].filter(Boolean).join('\n\n').slice(0, 5000);
  const refs =
    input.entity === 'contact'
      ? { contactId: input.entityId, companyId: (record.company_id as string | null | undefined) ?? null }
      : input.entity === 'company'
        ? { companyId: input.entityId }
        : { dealId: input.entityId };
  const activity = await createActivity(workspaceId, {
    type: input.logAs === 'call' ? 'call' : 'note',
    subject: `Playbook: ${playbook.name}`.slice(0, 500),
    body,
    ownerId: actor.id,
    ...(input.logAs === 'call'
      ? {
          outcome: input.call?.outcome ?? '',
          durationMin: input.call?.durationMin ?? null,
          direction: input.call?.direction ?? 'outbound',
          channel: input.call?.channel ?? '',
        }
      : {}),
    ...refs,
  });

  const runId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_playbook_runs (id, user_id, playbook_id, playbook_name, entity, entity_id, activity_id, answers, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, workspaceId, playbook.id, playbook.name, input.entity, input.entityId, activity.id, JSON.stringify(input.answers), actor.id, now());
  const run = (await db.prepare('SELECT * FROM crm_playbook_runs WHERE id = ?').get(runId)) as CrmPlaybookRunRow;
  return { ok: true, run, activityId: activity.id, updated };
}

/** Usos de un playbook (o en un registro), del más nuevo al más viejo. */
export async function listPlaybookRuns(
  workspaceId: string,
  filter: { playbookId?: string; entity?: PlaybookEntity; entityId?: string; limit?: number },
  db: Db = getDb(),
): Promise<CrmPlaybookRunRow[]> {
  const where = ['user_id = ?'];
  const args: Array<string | number> = [workspaceId];
  if (filter.playbookId) {
    where.push('playbook_id = ?');
    args.push(filter.playbookId);
  }
  if (filter.entity && filter.entityId) {
    where.push('entity = ? AND entity_id = ?');
    args.push(filter.entity, filter.entityId);
  }
  args.push(Math.min(filter.limit ?? 50, 200));
  return (await db
    .prepare(`SELECT * FROM crm_playbook_runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...args)) as CrmPlaybookRunRow[];
}

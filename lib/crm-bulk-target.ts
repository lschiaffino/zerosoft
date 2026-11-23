/**
 * CRM: a qué registros apunta una acción masiva de los listados. O los ids
 * elegidos en la página (hasta 500), o "todos los que coinciden" con el
 * listado: la query de la URL, que el server vuelve a evaluar con quien pide
 * (lib/crm-list-matching.ts), con tope. En los dos casos solo quedan los que
 * la persona ve. También: crear una tarea por registro. Server-only.
 */
import { z } from 'zod';
import { visibleIds, sessionScope } from './crm-visibility';
import { resolveMatching, MATCHING_CAP, type MatchingEntity } from './crm-list-matching';
import { createActivity } from './crm';
import { CrmRefError } from './crm-refs';
import { dueOnDate } from './crm-tasks-index';
import { TASK_PRIORITIES } from './tasks-shared';
import type { TeamRole } from './teams';

const TABLES = { contacts: 'crm_contacts', companies: 'crm_companies', deals: 'crm_deals' } as const;

/** Lo que agregan los esquemas de las rutas bulk: `ids` o `matching`. */
export const bulkTargetFields = {
  ids: z.array(z.string().min(1).max(64)).min(1).max(500).optional(),
  matching: z.object({ query: z.string().max(20_000) }).optional(),
};

/** Tope de "Crear tareas" en una acción (cada tarea dispara sus eventos y workflows). */
export const BULK_TASKS_CAP = 200;

/** Datos de "Crear tareas" en masa. */
export const bulkTaskFields = {
  task: z
    .object({
      subject: z.string().trim().min(1).max(200),
      /** Día de vencimiento (YYYY-MM-DD, a las 9 en la zona de la persona); vacío = sin fecha. */
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
      priority: z.enum(TASK_PRIORITIES).optional(),
      /** `me`: quien la crea; `owner`: el owner de cada registro (sin owner, quien la crea). */
      assignTo: z.enum(['me', 'owner']).optional(),
    })
    .optional(),
};

type BulkUser = { id: string; role: TeamRole; actingUser?: { id: string } | null };

export type BulkTarget = { ids: string[]; matched?: number; total?: number } | { error: 'invalid_input' | 'invalid_filter' };

/** Los ids visibles a los que apunta el pedido. */
export async function bulkTargetIds(
  user: BulkUser,
  entity: MatchingEntity,
  data: { ids?: string[]; matching?: { query: string } },
): Promise<BulkTarget> {
  const scope = await sessionScope(user);
  if (data.matching) {
    const res = await resolveMatching(user, entity, data.matching.query, MATCHING_CAP);
    if ('error' in res) return res;
    return { ids: await visibleIds(user.id, TABLES[entity], res.ids, scope), matched: res.ids.length, total: res.total };
  }
  if (!data.ids?.length) return { error: 'invalid_input' };
  return { ids: await visibleIds(user.id, TABLES[entity], data.ids, scope) };
}

const REF = { contacts: 'contactId', companies: 'companyId', deals: 'dealId' } as const;
const OWNER_SQL = {
  contacts: 'SELECT id, owner_id FROM crm_contacts',
  companies: 'SELECT id, owner_id FROM crm_companies',
  deals: 'SELECT id, owner_id FROM crm_deals',
} as const;

/**
 * Una tarea por registro, asociada a él, como "Crear tareas" de HubSpot. Los
 * ids ya vienen filtrados por visibilidad; createActivity vuelve a chequear
 * que el registro y el owner sean del workspace.
 */
export async function bulkCreateTasks(
  user: BulkUser,
  entity: MatchingEntity,
  ids: string[],
  task: { subject: string; dueDate?: string; priority?: (typeof TASK_PRIORITIES)[number]; assignTo?: 'me' | 'owner' },
  timeZone: string,
): Promise<{ count: number; failed: number }> {
  const me = (user.actingUser?.id ?? user.id);
  const owners = new Map<string, string | null>();
  if (task.assignTo === 'owner' && ids.length) {
    const { getDb } = await import('./db');
    const ph = ids.map(() => '?').join(',');
    const rows = (await getDb()
      .prepare(`${OWNER_SQL[entity]} WHERE user_id = ? AND id IN (${ph})`)
      .all(user.id, ...ids)) as Array<{ id: string; owner_id: string | null }>;
    for (const r of rows) owners.set(r.id, r.owner_id);
  }
  const dueAt = task.dueDate ? dueOnDate(null, task.dueDate, timeZone) : null;
  let count = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await createActivity(user.id, {
        type: 'task',
        subject: task.subject,
        dueAt,
        priority: task.priority ?? '',
        ownerId: task.assignTo === 'owner' ? owners.get(id) || me : me,
        [REF[entity]]: id,
      });
      count++;
    } catch (err) {
      if (!(err instanceof CrmRefError)) throw err;
      failed++;
    }
  }
  return { count, failed };
}

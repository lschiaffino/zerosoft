/**
 * CRM — fechas de actividad mantenidas en cada registro (contacto, empresa, deal):
 *
 * - last_activity_at: la actividad registrada más reciente (notas, llamadas,
 *   reuniones y emails por su creación; tareas recién cuando se completan).
 * - last_contacted_at: el último contacto real (llamada, reunión o email que
 *   no sea entrante).
 * - next_activity_at: la tarea, llamada o reunión pendiente con fecha más
 *   próxima (incluye las vencidas: es lo siguiente por hacer).
 *
 * Las mantienen triggers sobre crm_activities (cualquier alta, edición o baja,
 * venga de donde venga), así que listar y ordenar por ellas es una columna
 * más. Este módulo arma el SQL; no importa lib/db (lo usa la migración).
 */
import { formatDate } from './utils';

export const ACTIVITY_DATE_TABLES = [
  { table: 'crm_contacts', fk: 'contact_id' },
  { table: 'crm_companies', fk: 'company_id' },
  { table: 'crm_deals', fk: 'deal_id' },
] as const;

export type ActivityDateTable = (typeof ACTIVITY_DATE_TABLES)[number]['table'];

/** Expresiones agregadas sobre las actividades `a` del registro. */
const LAST_ACTIVITY = "MAX(CASE WHEN a.type = 'task' THEN a.done_at ELSE a.created_at END)";
const LAST_CONTACTED =
  "MAX(CASE WHEN a.type IN ('call', 'meeting') OR (a.type = 'email' AND a.direction <> 'inbound') THEN a.created_at END)";
const NEXT_ACTIVITY =
  "MIN(CASE WHEN a.done = 0 AND a.due_at IS NOT NULL AND a.type IN ('task', 'call', 'meeting') THEN a.due_at END)";

/**
 * UPDATE que recalcula las tres fechas de `table`. `where` restringe las filas
 * (p. ej. 'id = NEW.contact_id'); sin `where` recalcula todo (backfill).
 */
export function activityDatesUpdateSql(table: ActivityDateTable, where?: string): string {
  const fk = ACTIVITY_DATE_TABLES.find((x) => x.table === table)!.fk;
  return `UPDATE ${table} SET (last_activity_at, last_contacted_at, next_activity_at) = (
    SELECT ${LAST_ACTIVITY}, ${LAST_CONTACTED}, ${NEXT_ACTIVITY}
    FROM crm_activities a WHERE a.${fk} = ${table}.id
  )${where ? ` WHERE ${where}` : ''}`;
}

/** Columnas de crm_activities que cambian alguna de las fechas. */
const WATCHED = ['type', 'due_at', 'done', 'done_at', 'created_at', 'direction', 'contact_id', 'company_id', 'deal_id'];

function body(refs: Array<'NEW' | 'OLD'>): string {
  return ACTIVITY_DATE_TABLES.flatMap(({ table, fk }) =>
    refs.map((ref) => `  ${activityDatesUpdateSql(table, `${ref}.${fk} IS NOT NULL AND id = ${ref}.${fk}`)};`),
  ).join('\n');
}

/** DDL de los triggers (idempotente). */
export function activityDateTriggersSql(): string {
  return `
CREATE TRIGGER IF NOT EXISTS trg_crm_activity_dates_ai AFTER INSERT ON crm_activities BEGIN
${body(['NEW'])}
END;
CREATE TRIGGER IF NOT EXISTS trg_crm_activity_dates_au AFTER UPDATE OF ${WATCHED.join(', ')} ON crm_activities BEGIN
${body(['OLD', 'NEW'])}
END;
CREATE TRIGGER IF NOT EXISTS trg_crm_activity_dates_ad AFTER DELETE ON crm_activities BEGIN
${body(['OLD'])}
END;`;
}

/** Claves de columna/sort de las tres fechas, en el orden en que se muestran. */
export const ACTIVITY_DATE_FIELDS = ['lastActivity', 'lastContacted', 'nextActivity'] as const;
export type ActivityDateField = (typeof ACTIVITY_DATE_FIELDS)[number];

export const ACTIVITY_DATE_COLUMNS: Record<ActivityDateField, string> = {
  lastActivity: 'last_activity_at',
  lastContacted: 'last_contacted_at',
  nextActivity: 'next_activity_at',
};

/** Sorts por fechas de actividad, comunes a contactos, empresas y deals. */
export const ACTIVITY_DATE_SORTS = [
  'last_activity',
  'last_activity_asc',
  'last_contacted',
  'last_contacted_asc',
  'next_activity',
  'next_activity_desc',
] as const;
export type ActivityDateSort = (typeof ACTIVITY_DATE_SORTS)[number];

/**
 * ORDER BY para una fecha de actividad; los registros sin fecha van al final
 * en ambos sentidos. `alias` es el de la tabla en la query.
 */
export function activityDateOrder(alias: string, field: ActivityDateField, dir: 'asc' | 'desc'): string {
  const col = `${alias}.${ACTIVITY_DATE_COLUMNS[field]}`;
  return `${col} IS NULL, ${col} ${dir === 'asc' ? 'ASC' : 'DESC'}, ${alias}.id`;
}

/** 'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM[:SS]' (UTC) → fecha corta; '' si no hay. */
export function formatActivityDate(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const v = value.length === 10 ? `${value} 00:00:00` : value;
  try {
    return formatDate(v, locale);
  } catch {
    return '';
  }
}

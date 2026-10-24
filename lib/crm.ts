/**
 * CRM — capa de queries (server-only).
 * Sigue el patrón de lib/links.ts: getDb() singleton, WHERE builders,
 * paginación con clamp, ids crypto.randomUUID(), timestamps UTC.
 */
import { assertRefs, CrmRefError, ownedContactIds } from './crm-refs';
import { deleteUploads } from './uploads';
import { dayRangeUtc, getUserTimeZone } from './user-tz';
import type { WebhookEvent } from './webhooks';
import { emitEvent } from './events';
import { emitCrmHookSoon, recordPayload } from './crm-hooks';
import {
  associateDealCompany,
  autoAssociateContactCompanies,
  listContactCompanies,
  listCompanyContacts,
  listCompanyDeals,
  listChildCompanies,
  companyAncestors,
  companyRollup,
  listDealCompanies,
  setContactPrimaryCompany,
  setParentCompany,
  syncContactPrimary,
  syncDealPrimary,
  type CompanyContactRow,
  type CompanyDealRow,
  type CompanyRollup,
  type ContactCompanyRow,
  type DealCompanyRow,
} from './crm-assoc';
import { tagCondition, type TagEntity } from './crm-tags';
import { trashRecords } from './crm-trash';
import { nextRepeatDue, type TaskRepeat } from './crm-task-repeat';
import { activityDateOrder, ACTIVITY_DATE_SORTS, type ActivityDateSort } from './crm-activity-dates';
import { extraSortOrder, type ExtraSort } from './crm-list-sort';
import { missingRequiredFields, normalizeRequiredFields, parseRequiredFields } from './crm-stage-rules';

export { ACTIVITY_DATE_SORTS, type ActivityDateSort };
import { activityScopeSql, ownerScopeSql, type OwnerScope } from './crm-visibility';
import { baseAmountSql, getCrmSettings } from './crm-currency';
import {
  ensureMigrated,
  getClient,
  getDb,
  txDb,
  type CrmActivityRow,
  type CrmCompanyRow,
  type CrmContactRow,
  type CrmCustomFieldRow,
  type CrmCustomFieldType,
  type CrmDealRow,
  type CrmEmailRow,
  type CrmListRow,
  type CrmPipelineRow,
  type CrmPropertyEventRow,
  type CrmSavedReportRow,
  type CrmSavedViewRow,
  type CrmStageRow,
  type CrmTaskProjectRow,
  type CrmTaskFileRow,
  type Db,
} from './db';

// ---------- Constantes ----------

import {
  ACTIVITY_TYPES,
  LIFECYCLE_STAGES,
  LEAD_STATUSES,
  PRIORITIES,
  SOURCES,
  type ActivityType,
  type LeadStatus,
  type LifecycleStage,
  type Priority,
  type Source,
} from './crm-constants';

export {
  ACTIVITY_TYPES,
  LIFECYCLE_STAGES,
  LEAD_STATUSES,
  PRIORITIES,
  SOURCES,
  type ActivityType,
  type LeadStatus,
  type LifecycleStage,
  type Priority,
  type Source,
};

// ---------- Helpers ----------

function activityDateOrders(alias: string): Record<ActivityDateSort, string> {
  return {
    last_activity: activityDateOrder(alias, 'lastActivity', 'desc'),
    last_activity_asc: activityDateOrder(alias, 'lastActivity', 'asc'),
    last_contacted: activityDateOrder(alias, 'lastContacted', 'desc'),
    last_contacted_asc: activityDateOrder(alias, 'lastContacted', 'asc'),
    next_activity: activityDateOrder(alias, 'nextActivity', 'asc'),
    next_activity_desc: activityDateOrder(alias, 'nextActivity', 'desc'),
  };
}

/** Campos de filtro avanzado para las fechas de actividad. */
function activityDateAdvFields(alias: string): Record<string, AdvancedFieldDef> {
  return {
    lastActivity: { expr: `${alias}.last_activity_at`, type: 'date' },
    lastContacted: { expr: `${alias}.last_contacted_at`, type: 'date' },
    nextActivity: { expr: `${alias}.next_activity_at`, type: 'date' },
  };
}

/** Timestamp UTC 'YYYY-MM-DD HH:MM:SS' (mismo formato que datetime('now')). */
function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Inicio y fin del día de hoy (UTC) en formato de la DB. */
/** "Hoy" en la zona horaria de quien mira (cookie tz), como rango UTC de la DB. */
async function todayRange(): Promise<{ start: string; end: string }> {
  return dayRangeUtc(await getUserTimeZone());
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// ============================================================
// ADVANCED FILTER BUILDER (query param `filters`, JSON FilterRule[])
// ============================================================

/**
 * Regla del constructor de filtros avanzados. Claves cortas para una URL compacta.
 * `f` = campo (los custom usan `custom:<name>`), `o` = operador, `v`/`v2` = valores.
 */
export interface FilterRule {
  f: string;
  o: string;
  v?: string;
  v2?: string;
}

export type FilterFieldType = 'text' | 'number' | 'select' | 'date' | 'boolean' | 'multiselect';

interface AdvancedFieldDef {
  /** Expresión SQL ya aliaseada; sale solo de nuestros mapas internos (nunca del usuario). */
  expr: string;
  type: FilterFieldType;
}

const TEXT_OPS = new Set(['contains', 'equals', 'starts']);
const NUMBER_OPS = new Set(['eq', 'neq', 'gt', 'lt']);
const SELECT_OPS = new Set(['is', 'isnot']);
const DATE_OPS = new Set(['before', 'after', 'between']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Nombres de custom fields admitidos en el JSON path (evita inyección en el path). */
const CUSTOM_NAME = /^[A-Za-z0-9_\-]{1,100}$/;

/** Parsea y valida el query param `filters` (JSON). Devuelve [] ante cualquier corrupción. */
export function parseFilterRules(raw: string | undefined): FilterRule[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: FilterRule[] = [];
    for (const item of value.slice(0, 20)) {
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      if (typeof r.f !== 'string' || typeof r.o !== 'string' || !r.f || !r.o) continue;
      out.push({
        f: r.f.slice(0, 120),
        o: r.o.slice(0, 20),
        v: typeof r.v === 'string' ? r.v.slice(0, 500) : undefined,
        v2: typeof r.v2 === 'string' ? r.v2.slice(0, 500) : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Expresión SQL para una regla sobre custom field, según su tipo declarado. */
function customExpr(alias: 'c' | 'co' | 'd', name: string, type: FilterFieldType): string {
  const base = `json_extract(${alias}.custom, '$.${name}')`;
  return type === 'number' ? `CAST(${base} AS REAL)` : base;
}

/**
 * Traduce una regla a una condición WHERE parametrizada.
 * Devuelve null si la regla es inválida o está incompleta (se ignora, no rompe la query).
 */
const ALIAS_ENTITY: Record<'c' | 'co' | 'd', TagEntity> = { c: 'contact', co: 'company', d: 'deal' };

function buildRuleCondition(
  alias: 'c' | 'co' | 'd',
  fields: Record<string, AdvancedFieldDef>,
  rule: FilterRule,
  customTypes?: Record<string, FilterFieldType>,
): { sql: string; args: Array<string | number> } | null {
  // Tag: relación many-to-many, no una columna. is / isnot sobre crm_record_tags.
  if (rule.f === 'tag') {
    const v = (rule.v ?? '').trim();
    if (!v || !SELECT_OPS.has(rule.o)) return null;
    const cond = tagCondition(alias, ALIAS_ENTITY[alias]);
    return { sql: rule.o === 'is' ? cond : `NOT ${cond}`, args: [v] };
  }
  let def = fields[rule.f];
  if (!def && rule.f.startsWith('custom:')) {
    const name = rule.f.slice(7);
    if (!CUSTOM_NAME.test(name)) return null;
    const type = customTypes?.[name] ?? 'text';
    def = { expr: customExpr(alias, name, type), type };
  }
  if (!def) return null;

  const v = (rule.v ?? '').trim();
  const { expr, type } = def;

  if (type === 'text') {
    if (!v || !TEXT_OPS.has(rule.o)) return null;
    if (rule.o === 'contains') {
      return { sql: `${expr} LIKE ? ESCAPE '\\'`, args: [`%${escapeLike(v)}%`] };
    }
    if (rule.o === 'equals') return { sql: `${expr} = ?`, args: [v] };
    return { sql: `${expr} LIKE ? ESCAPE '\\'`, args: [`${escapeLike(v)}%`] };
  }

  if (type === 'number') {
    if (!NUMBER_OPS.has(rule.o)) return null;
    const n = Number(v);
    if (!v || Number.isNaN(n)) return null;
    const op = rule.o === 'eq' ? '=' : rule.o === 'neq' ? '!=' : rule.o === 'gt' ? '>' : '<';
    return { sql: `${expr} ${op} ?`, args: [n] };
  }

  if (type === 'multiselect') {
    // Lista JSON: "es" = la contiene; "no es" = no la contiene (o está vacía).
    if (!v || !SELECT_OPS.has(rule.o) || !rule.f.startsWith('custom:')) return null;
    const has = `EXISTS (SELECT 1 FROM json_each(${alias}.custom, '$.${rule.f.slice(7)}') WHERE value = ?)`;
    return { sql: rule.o === 'is' ? has : `NOT ${has}`, args: [v] };
  }

  if (type === 'select' || type === 'boolean') {
    if (!v || !SELECT_OPS.has(rule.o)) return null;
    // Boolean custom: se guarda como JSON true/false → json_extract da 1/0 (integer).
    const arg: string | number = type === 'boolean' ? Number(v === '1' || v === 'true') : v;
    if (rule.o === 'is') return { sql: `${expr} = ?`, args: [arg] };
    return { sql: `(${expr} IS NULL OR ${expr} != ?)`, args: [arg] };
  }

  // date
  if (!DATE_OPS.has(rule.o) || !ISO_DATE.test(v)) return null;
  if (rule.o === 'before') return { sql: `date(${expr}) < date(?)`, args: [v] };
  if (rule.o === 'after') return { sql: `date(${expr}) > date(?)`, args: [v] };
  const v2 = (rule.v2 ?? '').trim();
  if (!ISO_DATE.test(v2)) return null;
  return { sql: `date(${expr}) BETWEEN date(?) AND date(?)`, args: [v, v2] };
}

/** Agrega las reglas avanzadas al WHERE (AND). Futuro: combinar grupos con OR. */
function appendAdvancedFilters(
  where: string[],
  args: Array<string | number>,
  alias: 'c' | 'co' | 'd',
  fields: Record<string, AdvancedFieldDef>,
  rules: FilterRule[] | undefined,
  customTypes?: Record<string, FilterFieldType>,
): void {
  if (!rules?.length) return;
  for (const rule of rules) {
    const cond = buildRuleCondition(alias, fields, rule, customTypes);
    if (!cond) continue;
    where.push(cond.sql);
    args.push(...cond.args);
  }
}

/** Dispara workflows habilitados para un evento. Import dinámico evita dependencia circular. */
async function fireEvent(
  userId: string,
  event: {
    type: import('./crm-workflows').TriggerType;
    entity: 'contact' | 'company' | 'deal' | 'task' | 'email';
    entityId: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  // Lead scoring primero (reglas de propiedad): los workflows ven el score nuevo.
  if (event.entity === 'contact' && (event.type === 'contact_created' || event.type === 'contact_updated')) {
    const { recalcContactScoreSafe } = await import('./crm-scoring');
    await recalcContactScoreSafe(userId, event.entityId);
  }
  try {
    const mod = await import('./crm-workflows');
    await mod.runWorkflowsForEvent(userId, event);
  } catch {
    /* no debe bloquear la operación principal */
  }
  const hook = CRM_WEBHOOK_EVENTS[event.type];
  if (hook) {
    try {
      const table = event.entity === 'contact' ? 'crm_contacts' : 'crm_deals';
      const row = (await getDb()
        .prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`)
        .get(event.entityId, userId)) as ({ user_id: string; custom?: string } & Record<string, unknown>) | undefined;
      if (row) {
        const { user_id: _owner, ...data } = row;
        await emitEvent(userId, hook, {
          ...data,
          custom: parseCustom((data.custom as string | undefined) ?? null),
          ...(event.payload ? { change: event.payload } : {}),
        });
      }
    } catch {
      /* el webhook nunca bloquea la operación */
    }
  }
}

/** Dispara workflows (+ webhook si corresponde) de un evento del CRM. Lo usan los quotes. */
export const fireCrmEvent = fireEvent;

/** Eventos del CRM que también salen como webhooks (lib/webhooks.ts). */
const CRM_WEBHOOK_EVENTS: Partial<Record<import('./crm-workflows').TriggerType, Extract<WebhookEvent, import('./flow-schema').FlowEventType>>> = {
  contact_created: 'contact.created',
  contact_updated: 'contact.updated',
  deal_created: 'deal.created',
  deal_updated: 'deal.updated',
  deal_stage_changed: 'deal.stage_changed',
  deal_won: 'deal.won',
  deal_lost: 'deal.lost',
};

/** Parsea la columna custom (JSON object) sin romper ante datos corruptos. */
export function parseCustom(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonObject(json: string | null): Record<string, unknown> {
  return parseCustom(json);
}

/**
 * Convierte un objeto camelCase (solo claves presentes y !== undefined) en
 * pares [columna, valor] listos para un UPDATE. `custom` se serializa a JSON.
 */
function toColumnValues(
  cols: Record<string, string>,
  data: Record<string, unknown>,
): Array<[string, string | number | null]> {
  const out: Array<[string, string | number | null]> = [];
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in data)) continue;
    const v = data[key];
    if (v === undefined) continue;
    if (key === 'custom') out.push([col, JSON.stringify(v ?? {})]);
    else out.push([col, v as string | number | null]);
  }
  return out;
}

/** Normaliza cualquier valor de BD a string para comparar en el audit. */
function normValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * Inserta una fila de audit por cada propiedad de `sets` que cambió
 * respecto de `before` (la fila completa pre-UPDATE). La columna `custom`
 * se compara clave por clave para evitar loguear el blob JSON entero.
 */
async function logPropertyEvents(
  userId: string,
  entity: 'contact' | 'company' | 'deal',
  entityId: string,
  before: Record<string, unknown>,
  sets: Array<[string, string | number | null]>,
  actorEmail: string,
  db: Db = getDb(),
): Promise<void> {
  const ins = db.prepare(
    `INSERT INTO crm_property_events
       (id, user_id, entity, entity_id, field, old_value, new_value, actor_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Cada propiedad que cambia sale como <entity>.property_changed (webhooks y apps).
  const changed: Array<{ property: string; oldValue: string | null; newValue: string | null }> = [];
  for (const [col, value] of sets) {
    if (col === 'custom') {
      const oldCustom = parseCustom(normValue(before[col]));
      const newCustom = parseCustom(normValue(value));
      const keys = new Set([...Object.keys(oldCustom), ...Object.keys(newCustom)]);
      for (const k of keys) {
        const oldV = normValue(oldCustom[k]);
        const newV = normValue(newCustom[k]);
        if (oldV !== newV) {
          await ins.run(
            crypto.randomUUID(),
            userId,
            entity,
            entityId,
            `custom.${k}`,
            oldV,
            newV,
            actorEmail,
          );
          changed.push({ property: `custom.${k}`, oldValue: oldV, newValue: newV });
        }
      }
      continue;
    }
    const oldV = normValue(before[col]);
    const newV = normValue(value);
    if (oldV !== newV) {
      await ins.run(crypto.randomUUID(), userId, entity, entityId, col, oldV, newV, actorEmail);
      changed.push({ property: col, oldValue: oldV, newValue: newV });
    }
  }
  for (const c of changed) {
    await emitCrmHookSoon(userId, `${entity}.property_changed`, {
      objectType: entity,
      id: entityId,
      ...c,
      changedBy: actorEmail || null,
    });
  }
}

export async function listPropertyEvents(
  userId: string,
  entity: 'contact' | 'company' | 'deal',
  entityId: string,
  limit = 50,
): Promise<(CrmPropertyEventRow & { new_company_name: string | null; old_company_name: string | null })[]> {
  return (await getDb()
    .prepare(
      `SELECT e.*,
        nco.name AS new_company_name,
        oco.name AS old_company_name
       FROM crm_property_events e
       LEFT JOIN crm_companies nco
         ON e.field = 'company_id' AND nco.id = e.new_value
       LEFT JOIN crm_companies oco
         ON e.field = 'company_id' AND oco.id = e.old_value
       WHERE e.user_id = ? AND e.entity = ? AND e.entity_id = ?
       ORDER BY e.created_at DESC, e.rowid DESC
       LIMIT ?`,
    )
    .all(userId, entity, entityId, limit)) as (CrmPropertyEventRow & {
    new_company_name: string | null;
    old_company_name: string | null;
  })[];
}

// ============================================================
// CONTACTS
// ============================================================

export interface ContactFilter {
  q?: string;
  lifecycle?: string;
  leadStatus?: string;
  source?: string;
  companyId?: string;
  owner?: string;
  createdFrom?: string;
  createdTo?: string;
  /** Id de tag: solo contactos con ese tag. */
  tag?: string;
  custom?: Record<string, string>;
  filters?: FilterRule[];
  /** Tipos de los custom fields (para operadores correctos en reglas `custom:*`). */
  customTypes?: Record<string, FilterFieldType>;
  /** Visibilidad por owner (lib/crm-visibility.ts). null/undefined = todo. */
  ownerScope?: OwnerScope;
  sort?: 'newest' | 'oldest' | 'name' | 'name_desc' | 'email' | 'email_desc' | 'score' | 'score_asc' | ActivityDateSort | ExtraSort;
  page?: number;
  pageSize?: number;
}

export type ContactListRow = CrmContactRow & { company_name: string | null };

const CONTACT_ADV_FIELDS: Record<string, AdvancedFieldDef> = {
  name: { expr: "trim(c.first_name || ' ' || c.last_name)", type: 'text' },
  email: { expr: 'c.email', type: 'text' },
  company: { expr: 'c.company_id', type: 'select' },
  lifecycle: { expr: 'c.lifecycle_stage', type: 'select' },
  leadStatus: { expr: 'c.lead_status', type: 'select' },
  owner: { expr: 'c.owner_id', type: 'select' },
  source: { expr: 'c.source', type: 'select' },
  score: { expr: 'c.score', type: 'number' },
  created: { expr: 'c.created_at', type: 'date' },
  ...activityDateAdvFields('c'),
};

/** Agrega la condición de visibilidad por owner al WHERE. */
function appendOwnerScope(
  where: string[],
  args: Array<string | number>,
  alias: string,
  scope: OwnerScope | undefined,
): void {
  const cond = ownerScopeSql(alias, scope);
  if (!cond.sql) return;
  where.push(cond.sql);
  args.push(...cond.args);
}

/** "Nombre Apellido" del contacto: buscar el nombre completo encuentra a la persona (no solo cada parte). */
const CONTACT_FULL_NAME = "(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))";

function buildContactWhere(
  userId: string,
  f: ContactFilter,
): { where: string; args: Array<string | number> } {
  const where: string[] = ['c.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(
      `(${CONTACT_FULL_NAME} LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')`,
    );
    args.push(like, like);
  }
  if (f.lifecycle) {
    where.push('c.lifecycle_stage = ?');
    args.push(f.lifecycle);
  }
  if (f.leadStatus) {
    where.push('c.lead_status = ?');
    args.push(f.leadStatus);
  }
  if (f.source) {
    where.push('c.source = ?');
    args.push(f.source);
  }
  if (f.companyId) {
    // Cualquier asociación (no solo la primaria).
    where.push('EXISTS (SELECT 1 FROM crm_contact_companies xcc WHERE xcc.contact_id = c.id AND xcc.company_id = ?)');
    args.push(f.companyId);
  }
  if (f.tag) {
    where.push(tagCondition('c', 'contact'));
    args.push(f.tag);
  }
  if (f.owner) {
    where.push('c.owner_id = ?');
    args.push(f.owner);
  }
  if (f.createdFrom) {
    where.push('c.created_at >= ?');
    args.push(`${f.createdFrom} 00:00:00`);
  }
  if (f.createdTo) {
    where.push('c.created_at <= ?');
    args.push(`${f.createdTo} 23:59:59`);
  }
  if (f.custom) {
    for (const [name, value] of Object.entries(f.custom)) {
      if (!value) continue;
      where.push(`json_extract(c.custom, '$.${name}') = ?`);
      args.push(value);
    }
  }
  appendAdvancedFilters(where, args, 'c', CONTACT_ADV_FIELDS, f.filters, f.customTypes);
  appendOwnerScope(where, args, 'c', f.ownerScope);
  return { where: where.join(' AND '), args };
}

const CONTACT_ORDER: Record<Exclude<NonNullable<ContactFilter['sort']>, ExtraSort>, string> = {
  newest: 'c.created_at DESC, c.id',
  oldest: 'c.created_at ASC, c.id',
  name: "c.first_name COLLATE NOCASE ASC, c.last_name COLLATE NOCASE ASC, c.id",
  name_desc: "c.first_name COLLATE NOCASE DESC, c.last_name COLLATE NOCASE DESC, c.id",
  email: "c.email COLLATE NOCASE ASC, c.id",
  email_desc: "c.email COLLATE NOCASE DESC, c.id",
  score: 'c.score DESC, c.created_at DESC, c.id',
  score_asc: 'c.score ASC, c.created_at DESC, c.id',
  ...activityDateOrders('c'),
};

export async function listContacts(
  userId: string,
  f: ContactFilter,
): Promise<{ rows: ContactListRow[]; total: number }> {
  const db = getDb();
  const { where, args } = buildContactWhere(userId, f);
  const total = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM crm_contacts c WHERE ${where}`).get(...args)) as {
      c: number;
    }
  ).c;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const order =
    extraSortOrder('c', f.sort, f.customTypes) ??
    CONTACT_ORDER[(f.sort ?? 'newest') as keyof typeof CONTACT_ORDER] ??
    CONTACT_ORDER.newest;
  const rows = (await db
    .prepare(
      `SELECT c.*, co.name AS company_name
       FROM crm_contacts c
       LEFT JOIN crm_companies co ON co.id = c.company_id
       WHERE ${where}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as ContactListRow[];
  return { rows, total };
}

export type ContactDealRow = CrmDealRow & { stage_name: string; pipeline_name: string };

export interface ContactDetail {
  contact: CrmContactRow;
  /** Empresa primaria (= contact.company_id). */
  company: CrmCompanyRow | null;
  /** Todas las empresas asociadas (primaria primero) con su label. */
  companies: ContactCompanyRow[];
  deals: ContactDealRow[];
  lists: CrmListRow[];
}

export async function getContact(userId: string, id: string): Promise<ContactDetail | null> {
  const db = getDb();
  const contact = (await db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmContactRow | undefined;
  if (!contact) return null;
  const company = contact.company_id
    ? ((await db
        .prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(contact.company_id, userId)) as
        | CrmCompanyRow
        | undefined) ?? null
    : null;
  const deals = (await db
    .prepare(
      `SELECT d.*, s.name AS stage_name, p.name AS pipeline_name
       FROM crm_deals d
       JOIN crm_deal_contacts dc ON dc.deal_id = d.id
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       LEFT JOIN crm_pipelines p ON p.id = d.pipeline_id
       WHERE dc.contact_id = ? AND d.user_id = ?
       ORDER BY d.created_at DESC`,
    )
    .all(id, userId)) as ContactDealRow[];
  const lists = (await db
    .prepare(
      `SELECT l.* FROM crm_lists l
       JOIN crm_list_members m ON m.list_id = l.id
       WHERE m.contact_id = ? AND l.user_id = ?
       ORDER BY l.name ASC`,
    )
    .all(id, userId)) as CrmListRow[];
  const companies = await listContactCompanies(userId, id, db);
  return { contact, company, companies, deals, lists };
}

export interface ContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  website?: string;
  city?: string;
  country?: string;
  lifecycleStage?: string;
  leadStatus?: string;
  source?: string;
  companyId?: string | null;
  ownerId?: string | null;
  custom?: Record<string, unknown>;
}

const CONTACT_COLS: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  jobTitle: 'job_title',
  website: 'website',
  city: 'city',
  country: 'country',
  lifecycleStage: 'lifecycle_stage',
  leadStatus: 'lead_status',
  source: 'source',
  companyId: 'company_id',
  ownerId: 'owner_id',
  custom: 'custom',
};

/** Dominios de email gratuito: nunca se auto-vinculan a una empresa. */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.es',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'zoho.com',
  'yandex.com',
]);

/** Dominio lowercase de un email ('' si no tiene). */
function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase();
}

/** Id de la empresa del usuario con ese dominio (null si no hay / es freemail). */
async function findCompanyByDomain(userId: string, domain: string, db: Db): Promise<string | null> {
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  const row = (await db
    .prepare('SELECT id FROM crm_companies WHERE user_id = ? AND lower(domain) = ?')
    .get(userId, domain)) as { id: string } | undefined;
  return row?.id ?? null;
}

export async function createContact(
  userId: string,
  data: ContactInput,
  db: Db = getDb(),
): Promise<CrmContactRow> {
  await assertRefs(userId, { companyId: data.companyId, ownerId: data.ownerId }, db);
  const id = crypto.randomUUID();
  // Auto-link: si no vino empresa explícita, intentamos por dominio del email.
  const companyId =
    data.companyId ?? (await findCompanyByDomain(userId, domainOf(data.email ?? ''), db));
  await db
    .prepare(
      `INSERT INTO crm_contacts
       (id, user_id, owner_id, first_name, last_name, email, phone, job_title, website, city, country,
        lifecycle_stage, lead_status, source, company_id, custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      data.ownerId ?? userId,
      data.firstName ?? '',
      data.lastName ?? '',
      data.email ?? '',
      data.phone ?? '',
      data.jobTitle ?? '',
      data.website ?? '',
      data.city ?? '',
      data.country ?? '',
      data.lifecycleStage ?? 'lead',
      data.leadStatus ?? 'new',
      data.source ?? '',
      companyId,
      JSON.stringify(data.custom ?? {}),
    );
  if (companyId) await setContactPrimaryCompany(userId, id, companyId, db);
  const contact = (await db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(id)) as CrmContactRow;
  await fireEvent(userId, { type: 'contact_created', entity: 'contact', entityId: id });
  return contact;
}

export async function updateContact(
  userId: string,
  id: string,
  data: ContactInput,
  db: Db = getDb(),
  actorEmail = '',
): Promise<CrmContactRow | null> {
  const existing = (await db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmContactRow | undefined;
  if (!existing) return null;
  await assertRefs(userId, { companyId: data.companyId, ownerId: data.ownerId }, db);
  const sets = toColumnValues(CONTACT_COLS, data as Record<string, unknown>);
  // Auto-link: si cambia el email, no vino companyId explícito y el contacto
  // no tiene empresa, intentamos vincular por dominio del email nuevo.
  if (data.email !== undefined && data.companyId === undefined && !existing.company_id) {
    const linked = await findCompanyByDomain(userId, domainOf(data.email), db);
    if (linked) sets.push(['company_id', linked]);
  }
  const setSql = sets.map(([c]) => `${c} = ?`).join(', ');
  await db
    .prepare(`UPDATE crm_contacts SET ${setSql ? `${setSql}, ` : ''}updated_at = ? WHERE id = ?`)
    .run(...sets.map(([, v]) => v), now(), id);
  // company_id es el espejo de la asociación primaria: la tabla de
  // asociaciones manda (asocia la nueva como primaria o quita la actual).
  const companySet = sets.find(([c]) => c === 'company_id');
  if (companySet) {
    await setContactPrimaryCompany(userId, id, (companySet[1] as string | null) ?? null, db);
    companySet[1] = await syncContactPrimary(id, db);
  }
  await logPropertyEvents(userId, 'contact', id, existing as unknown as Record<string, unknown>, sets, actorEmail, db);
  const contact = (await db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(id)) as CrmContactRow;
  await fireEvent(userId, { type: 'contact_updated', entity: 'contact', entityId: id });
  return contact;
}

/** Borra un contacto: va a la papelera (lib/crm-trash.ts) con sus actividades propias. */
export async function deleteContact(userId: string, id: string, actorEmail = ''): Promise<boolean> {
  return (await trashRecords(userId, 'contact', [id], actorEmail)) > 0;
}

export interface DuplicateGroup {
  email: string;
  contacts: CrmContactRow[];
}

/** Grupos de contactos que comparten lower(email) (email no vacío, count > 1). */
export async function findDuplicateContacts(userId: string): Promise<DuplicateGroup[]> {
  const db = getDb();
  const groups = (await db
    .prepare(
      `SELECT lower(email) AS lemail, COUNT(*) AS c
       FROM crm_contacts
       WHERE user_id = ? AND email != ''
       GROUP BY lemail
       HAVING c > 1
       ORDER BY c DESC`,
    )
    .all(userId)) as Array<{ lemail: string; c: number }>;
  return Promise.all(
    groups.map(async (g) => ({
      email: g.lemail,
      contacts: (await db
        .prepare(
          'SELECT * FROM crm_contacts WHERE user_id = ? AND lower(email) = ? ORDER BY created_at ASC',
        )
        .all(userId, g.lemail)) as CrmContactRow[],
    })),
  );
}

/**
 * Merge: mueve todo lo del contacto `dropId` a `keepId` y borra `dropId`.
 * Transacción única. Devuelve el contacto conservado, o null si falta alguno.
 */
/** Columnas de texto que un merge completa si están vacías en el que queda. */
const MERGE_FILL_COLUMNS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'job_title',
  'website',
  'city',
  'country',
  'source',
] as const;

/**
 * Pares [columna, valor] para completar en `keep` los campos vacíos con los
 * de `drop` (estilo HubSpot: el que queda gana, salvo que no tenga valor).
 * Incluye owner_id y los custom fields ausentes en `keep`; la empresa la
 * resuelve syncContactPrimary con las asociaciones migradas.
 */
export function mergeFillPatch(keep: CrmContactRow, drop: CrmContactRow): [string, string][] {
  const out: [string, string][] = [];
  const k = keep as unknown as Record<string, unknown>;
  const d = drop as unknown as Record<string, unknown>;
  for (const col of MERGE_FILL_COLUMNS) {
    const kv = String(k[col] ?? '').trim();
    const dv = String(d[col] ?? '').trim();
    if (!kv && dv) out.push([col, String(d[col])]);
  }
  if (!keep.owner_id && drop.owner_id) out.push(['owner_id', drop.owner_id]);
  const kc = parseCustom(keep.custom);
  const dc = parseCustom(drop.custom);
  let changed = false;
  for (const [key, v] of Object.entries(dc)) {
    const cur = kc[key];
    const empty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0);
    if (empty && v !== undefined && v !== null && v !== '') {
      kc[key] = v;
      changed = true;
    }
  }
  if (changed) out.push(['custom', JSON.stringify(kc)]);
  return out;
}

export async function mergeContacts(
  userId: string,
  keepId: string,
  dropId: string,
): Promise<CrmContactRow | null> {
  const db = getDb();
  if (keepId === dropId) return null;
  const keep = (await db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(keepId, userId)) as CrmContactRow | undefined;
  const drop = (await db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(dropId, userId)) as CrmContactRow | undefined;
  if (!keep || !drop) return null;

  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    // Empresas: las del descartado pasan como no primarias; si el que queda
    // no tenía, se promueve la más antigua (syncContactPrimary).
    await tdb
      .prepare('UPDATE OR IGNORE crm_contact_companies SET contact_id = ?, is_primary = 0 WHERE contact_id = ?')
      .run(keepId, dropId);
    await tdb.prepare('DELETE FROM crm_contact_companies WHERE contact_id = ?').run(dropId);
    await syncContactPrimary(keepId, tdb);
    // Campos vacíos del que queda se completan con los del descartado.
    const fill = mergeFillPatch(keep, drop);
    const sets = ['updated_at = ?', ...fill.map(([col]) => `${col} = ?`)];
    await tdb
      .prepare(`UPDATE crm_contacts SET ${sets.join(', ')} WHERE id = ?`)
      .run(now(), ...fill.map(([, v]) => v), keepId);
    // Tags del descartado.
    await tdb
      .prepare("UPDATE OR IGNORE crm_record_tags SET record_id = ? WHERE entity = 'contact' AND record_id = ?")
      .run(keepId, dropId);
    // Deals: migra los vínculos; si el keep ya estaba en el deal, descarta el dupe.
    await tdb
      .prepare('UPDATE OR IGNORE crm_deal_contacts SET contact_id = ? WHERE contact_id = ?')
      .run(keepId, dropId);
    await tdb.prepare('DELETE FROM crm_deal_contacts WHERE contact_id = ?').run(dropId);
    // Activities.
    await tdb
      .prepare('UPDATE crm_activities SET contact_id = ?, updated_at = ? WHERE contact_id = ?')
      .run(keepId, now(), dropId);
    // Emails (Gmail y enviados desde el CRM). El timeline lee por
    // crm_email_contacts: si no se re-apunta, el CASCADE del DELETE final se
    // lleva los emails del descartado.
    await tdb.prepare('UPDATE crm_emails SET contact_id = ? WHERE contact_id = ?').run(keepId, dropId);
    await tdb
      .prepare('UPDATE OR IGNORE crm_email_contacts SET contact_id = ? WHERE contact_id = ?')
      .run(keepId, dropId);
    await tdb.prepare('DELETE FROM crm_email_contacts WHERE contact_id = ?').run(dropId);
    // Secuencias: si ambos están vivos en la misma secuencia, la del
    // descartado sale con motivo 'merged' (el índice único es parcial sobre
    // active/paused); el historial completo pasa al que queda.
    await tdb
      .prepare(
        `UPDATE crm_sequence_enrollments SET status = 'exited', exit_reason = 'merged', finished_at = ?, updated_at = ?
         WHERE contact_id = ? AND status IN ('active', 'paused')
           AND sequence_id IN (SELECT sequence_id FROM crm_sequence_enrollments
                               WHERE contact_id = ? AND status IN ('active', 'paused'))`,
      )
      .run(now(), now(), dropId, keepId);
    await tdb.prepare('UPDATE crm_sequence_enrollments SET contact_id = ? WHERE contact_id = ?').run(keepId, dropId);
    // Formularios, historial de asignación y de propiedades.
    await tdb.prepare('UPDATE crm_form_submissions SET contact_id = ? WHERE contact_id = ?').run(keepId, dropId);
    await tdb.prepare('UPDATE crm_assignment_history SET contact_id = ? WHERE contact_id = ?').run(keepId, dropId);
    await tdb
      .prepare("UPDATE crm_property_events SET entity_id = ? WHERE user_id = ? AND entity = 'contact' AND entity_id = ?")
      .run(keepId, userId, dropId);
    // Listas estáticas.
    await tdb
      .prepare('UPDATE OR IGNORE crm_list_members SET contact_id = ? WHERE contact_id = ?')
      .run(keepId, dropId);
    await tdb.prepare('DELETE FROM crm_list_members WHERE contact_id = ?').run(dropId);
    // Borra el contacto descartado.
    await tdb.prepare('DELETE FROM crm_contacts WHERE id = ?').run(dropId);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return (await db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(keepId)) as CrmContactRow;
}

export async function bulkUpdateContacts(
  userId: string,
  ids: string[],
  patch: { lifecycleStage?: string },
): Promise<number> {
  if (!ids.length || !patch.lifecycleStage) return 0;
  const ph = ids.map(() => '?').join(',');
  return (
    await getDb()
      .prepare(
        `UPDATE crm_contacts SET lifecycle_stage = ?, updated_at = ? WHERE user_id = ? AND id IN (${ph})`,
      )
      .run(patch.lifecycleStage, now(), userId, ...ids)
  ).changes;
}

export async function bulkDeleteContacts(userId: string, ids: string[], actorEmail = ''): Promise<number> {
  return trashRecords(userId, 'contact', ids, actorEmail);
}

// ============================================================
// COMPANIES
// ============================================================

export async function bulkUpdateCompanies(
  userId: string,
  ids: string[],
  patch: { lifecycleStage?: string },
): Promise<number> {
  if (!ids.length || !patch.lifecycleStage) return 0;
  const ph = ids.map(() => '?').join(',');
  return (
    await getDb()
      .prepare(
        `UPDATE crm_companies SET lifecycle_stage = ?, updated_at = ? WHERE user_id = ? AND id IN (${ph})`,
      )
      .run(patch.lifecycleStage, now(), userId, ...ids)
  ).changes;
}

export async function bulkDeleteCompanies(userId: string, ids: string[], actorEmail = ''): Promise<number> {
  if (!ids.length) return 0;
  const db = getDb();
  const affected = await companyDependents(userId, ids, db);
  const changes = await trashRecords(userId, 'company', ids, actorEmail, db);
  await afterCompanyDelete(userId, affected, db);
  return changes;
}

/** Contactos y deals asociados + hijas de las empresas que se van a borrar. */
async function companyDependents(
  userId: string,
  ids: string[],
  db: Db,
): Promise<{ contacts: string[]; deals: string[] }> {
  const ph = ids.map(() => '?').join(',');
  const contacts = (await db
    .prepare(`SELECT DISTINCT contact_id AS id FROM crm_contact_companies WHERE user_id = ? AND company_id IN (${ph})`)
    .all(userId, ...ids)) as Array<{ id: string }>;
  const deals = (await db
    .prepare(`SELECT DISTINCT deal_id AS id FROM crm_deal_companies WHERE user_id = ? AND company_id IN (${ph})`)
    .all(userId, ...ids)) as Array<{ id: string }>;
  return { contacts: contacts.map((r) => r.id), deals: deals.map((r) => r.id) };
}

/**
 * Tras borrar empresas: las FKs ya borraron las asociaciones; se re-elige la
 * primaria de contactos/deals afectados y las hijas huérfanas quedan como raíz.
 */
async function afterCompanyDelete(
  userId: string,
  affected: { contacts: string[]; deals: string[] },
  db: Db,
): Promise<void> {
  for (const id of affected.contacts) await syncContactPrimary(id, db);
  for (const id of affected.deals) await syncDealPrimary(id, db);
  await db
    .prepare(
      `UPDATE crm_companies SET parent_company_id = NULL
       WHERE user_id = ? AND parent_company_id IS NOT NULL
         AND parent_company_id NOT IN (SELECT id FROM crm_companies WHERE user_id = ?)`,
    )
    .run(userId, userId);
  // Contactos que apuntaban a una empresa borrada sin asociación (datos viejos).
  await db
    .prepare(
      `UPDATE crm_contacts SET company_id = NULL
       WHERE user_id = ? AND company_id IS NOT NULL
         AND company_id NOT IN (SELECT id FROM crm_companies WHERE user_id = ?)`,
    )
    .run(userId, userId);
}

export interface CompanyFilter {
  q?: string;
  industry?: string;
  lifecycle?: string;
  owner?: string;
  createdFrom?: string;
  createdTo?: string;
  /** Id de tag: solo empresas con ese tag. */
  tag?: string;
  /** Solo hijas directas de esta empresa. */
  parentId?: string;
  custom?: Record<string, string>;
  filters?: FilterRule[];
  customTypes?: Record<string, FilterFieldType>;
  ownerScope?: OwnerScope;
  sort?: 'newest' | 'oldest' | 'name' | 'name_desc' | ActivityDateSort | ExtraSort;
  page?: number;
  pageSize?: number;
}

export type CompanyListRow = CrmCompanyRow & { contact_count: number };

const COMPANY_ADV_FIELDS: Record<string, AdvancedFieldDef> = {
  name: { expr: 'co.name', type: 'text' },
  domain: { expr: 'co.domain', type: 'text' },
  industry: { expr: 'co.industry', type: 'select' },
  lifecycle: { expr: 'co.lifecycle_stage', type: 'select' },
  owner: { expr: 'co.owner_id', type: 'select' },
  created: { expr: 'co.created_at', type: 'date' },
  ...activityDateAdvFields('co'),
};

export async function listCompanies(
  userId: string,
  f: CompanyFilter,
): Promise<{ rows: CompanyListRow[]; total: number }> {
  const db = getDb();
  const where: string[] = ['co.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(`(co.name LIKE ? ESCAPE '\\' OR co.domain LIKE ? ESCAPE '\\')`);
    args.push(like, like);
  }
  if (f.industry) {
    where.push('co.industry = ?');
    args.push(f.industry);
  }
  if (f.lifecycle) {
    where.push('co.lifecycle_stage = ?');
    args.push(f.lifecycle);
  }
  if (f.owner) {
    where.push('co.owner_id = ?');
    args.push(f.owner);
  }
  if (f.createdFrom) {
    where.push('co.created_at >= ?');
    args.push(`${f.createdFrom} 00:00:00`);
  }
  if (f.createdTo) {
    where.push('co.created_at <= ?');
    args.push(`${f.createdTo} 23:59:59`);
  }
  if (f.tag) {
    where.push(tagCondition('co', 'company'));
    args.push(f.tag);
  }
  if (f.parentId) {
    where.push('co.parent_company_id = ?');
    args.push(f.parentId);
  }
  if (f.custom) {
    for (const [name, value] of Object.entries(f.custom)) {
      if (!value) continue;
      where.push(`json_extract(co.custom, '$.${name}') = ?`);
      args.push(value);
    }
  }
  appendAdvancedFilters(where, args, 'co', COMPANY_ADV_FIELDS, f.filters, f.customTypes);
  appendOwnerScope(where, args, 'co', f.ownerScope);
  const whereSql = where.join(' AND ');
  const total = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM crm_companies co WHERE ${whereSql}`).get(
      ...args,
    )) as {
      c: number;
    }
  ).c;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const dateOrders = activityDateOrders('co');
  const order =
    extraSortOrder('co', f.sort, f.customTypes) ??
    (f.sort && f.sort in dateOrders
      ? dateOrders[f.sort as ActivityDateSort]
      : f.sort === 'oldest'
      ? 'co.created_at ASC, co.id'
      : f.sort === 'name'
        ? 'co.name COLLATE NOCASE ASC, co.id'
        : f.sort === 'name_desc'
          ? 'co.name COLLATE NOCASE DESC, co.id'
          : 'co.created_at DESC, co.id');
  const rows = (await db
    .prepare(
      `SELECT co.*,
         (SELECT COUNT(*) FROM crm_contact_companies ct WHERE ct.company_id = co.id) AS contact_count
       FROM crm_companies co
       WHERE ${whereSql}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as CompanyListRow[];
  return { rows, total };
}

export interface CompanyDetail {
  company: CrmCompanyRow;
  /** Contactos asociados (con label y si esta es su empresa primaria). */
  contacts: CompanyContactRow[];
  /** Deals asociados (crm_deal_companies). */
  deals: CompanyDealRow[];
  /** Empresa madre inmediata (null = raíz). */
  parent: { id: string; name: string } | null;
  /** Cadena de madres hasta la raíz (inmediata primero). */
  ancestors: Array<{ id: string; name: string }>;
  children: CrmCompanyRow[];
  /** Valor de deals propio y del árbol completo, en moneda base. */
  rollup: CompanyRollup;
}

export async function getCompany(userId: string, id: string): Promise<CompanyDetail | null> {
  const db = getDb();
  const company = (await db
    .prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmCompanyRow | undefined;
  if (!company) return null;
  const contacts = await listCompanyContacts(userId, id, db);
  const deals = await listCompanyDeals(userId, id, db);
  const ancestors = await companyAncestors(userId, id, db);
  const children = await listChildCompanies(userId, id, db);
  const rollup = await companyRollup(userId, id, db);
  return { company, contacts, deals, parent: ancestors[0] ?? null, ancestors, children, rollup };
}

export interface CompanyInput {
  name?: string;
  domain?: string;
  industry?: string;
  employees?: number | null;
  phone?: string;
  website?: string;
  city?: string;
  country?: string;
  lifecycleStage?: string;
  ownerId?: string | null;
  /** Empresa madre (jerarquía). null = raíz. Valida ciclos. */
  parentCompanyId?: string | null;
  custom?: Record<string, unknown>;
}

const COMPANY_COLS: Record<string, string> = {
  name: 'name',
  domain: 'domain',
  industry: 'industry',
  employees: 'employees',
  phone: 'phone',
  website: 'website',
  city: 'city',
  country: 'country',
  lifecycleStage: 'lifecycle_stage',
  ownerId: 'owner_id',
  custom: 'custom',
};

export async function createCompany(
  userId: string,
  data: CompanyInput,
  db: Db = getDb(),
): Promise<CrmCompanyRow> {
  await assertRefs(userId, { ownerId: data.ownerId }, db);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_companies
       (id, user_id, owner_id, name, domain, industry, employees, phone, website, city, country, lifecycle_stage, custom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      data.ownerId ?? userId,
      data.name ?? '',
      data.domain ?? '',
      data.industry ?? '',
      data.employees ?? null,
      data.phone ?? '',
      data.website ?? '',
      data.city ?? '',
      data.country ?? '',
      data.lifecycleStage ?? 'lead',
      JSON.stringify(data.custom ?? {}),
    );
  if (data.parentCompanyId) await setParentCompany(userId, id, data.parentCompanyId, db);
  const company = (await db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(id)) as CrmCompanyRow;
  await emitCrmHookSoon(userId, 'company.created', recordPayload(company as unknown as Record<string, unknown>));
  return company;
}

export async function updateCompany(
  userId: string,
  id: string,
  data: CompanyInput,
  db: Db = getDb(),
  actorEmail = '',
): Promise<CrmCompanyRow | null> {
  const existing = (await db
    .prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmCompanyRow | undefined;
  if (!existing) return null;
  await assertRefs(userId, { ownerId: data.ownerId }, db);
  // Primero la jerarquía: si hay ciclo lanza CrmRefError y no se guarda nada.
  if (data.parentCompanyId !== undefined) {
    await setParentCompany(userId, id, data.parentCompanyId, db);
  }
  const sets = toColumnValues(COMPANY_COLS, data as Record<string, unknown>);
  if (data.parentCompanyId !== undefined) sets.push(['parent_company_id', data.parentCompanyId]);
  const setSql = sets.map(([c]) => `${c} = ?`).join(', ');
  await db
    .prepare(`UPDATE crm_companies SET ${setSql ? `${setSql}, ` : ''}updated_at = ? WHERE id = ?`)
    .run(...sets.map(([, v]) => v), now(), id);
  await logPropertyEvents(userId, 'company', id, existing as unknown as Record<string, unknown>, sets, actorEmail, db);
  const company = (await db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(id)) as CrmCompanyRow;
  if (sets.length) {
    await emitCrmHookSoon(userId, 'company.updated', recordPayload(company as unknown as Record<string, unknown>));
  }
  return company;
}

/** Borra una empresa: va a la papelera (lib/crm-trash.ts) con sus actividades propias. */
export async function deleteCompany(userId: string, id: string, actorEmail = ''): Promise<boolean> {
  const db = getDb();
  const affected = await companyDependents(userId, [id], db);
  const deleted = (await trashRecords(userId, 'company', [id], actorEmail, db)) > 0;
  if (deleted) await afterCompanyDelete(userId, affected, db);
  return deleted;
}

// ============================================================
// PIPELINES & STAGES
// ============================================================

export interface PipelineWithStages extends CrmPipelineRow {
  stages: CrmStageRow[];
}

export async function listPipelinesWithStages(userId: string): Promise<PipelineWithStages[]> {
  const db = getDb();
  const pipelines = (await db
    .prepare('SELECT * FROM crm_pipelines WHERE user_id = ? ORDER BY position ASC, created_at ASC')
    .all(userId)) as CrmPipelineRow[];
  const stageStmt = db.prepare(
    'SELECT * FROM crm_stages WHERE pipeline_id = ? ORDER BY position ASC',
  );
  return Promise.all(
    pipelines.map(async (p) => ({ ...p, stages: (await stageStmt.all(p.id)) as CrmStageRow[] })),
  );
}

async function getOwnedPipeline(userId: string, id: string): Promise<CrmPipelineRow | null> {
  return (
    ((await getDb()
      .prepare('SELECT * FROM crm_pipelines WHERE id = ? AND user_id = ?')
      .get(id, userId)) as CrmPipelineRow | undefined) ?? null
  );
}

/** Stage cuyo pipeline pertenece al usuario (las stages no tienen user_id propio). */
async function getOwnedStage(userId: string, id: string): Promise<CrmStageRow | null> {
  return (
    ((await getDb()
      .prepare(
        `SELECT s.* FROM crm_stages s
         JOIN crm_pipelines p ON p.id = s.pipeline_id
         WHERE s.id = ? AND p.user_id = ?`,
      )
      .get(id, userId)) as CrmStageRow | undefined) ?? null
  );
}

export async function createPipeline(userId: string, name: string): Promise<CrmPipelineRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const maxPos = (
    (await db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM crm_pipelines WHERE user_id = ?')
      .get(userId)) as {
      m: number;
    }
  ).m;
  await db
    .prepare('INSERT INTO crm_pipelines (id, user_id, name, position) VALUES (?, ?, ?, ?)')
    .run(id, userId, name, maxPos + 1);
  return (await db.prepare('SELECT * FROM crm_pipelines WHERE id = ?').get(id)) as CrmPipelineRow;
}

export async function renamePipeline(
  userId: string,
  id: string,
  name: string,
): Promise<CrmPipelineRow | null> {
  const db = getDb();
  if (!(await getOwnedPipeline(userId, id))) return null;
  await db.prepare('UPDATE crm_pipelines SET name = ? WHERE id = ?').run(name, id);
  return (await db.prepare('SELECT * FROM crm_pipelines WHERE id = ?').get(id)) as CrmPipelineRow;
}

export type DeletePipelineResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_empty' };

/** Solo borra pipelines sin deals (las stages caen en cascada). */
export async function deletePipeline(userId: string, id: string): Promise<DeletePipelineResult> {
  const db = getDb();
  if (!(await getOwnedPipeline(userId, id))) return { ok: false, reason: 'not_found' };
  const dealCount = (
    (await db
      .prepare('SELECT COUNT(*) AS c FROM crm_deals WHERE pipeline_id = ? AND user_id = ?')
      .get(id, userId)) as { c: number }
  ).c;
  if (dealCount > 0) return { ok: false, reason: 'not_empty' };
  await db.prepare('DELETE FROM crm_pipelines WHERE id = ?').run(id);
  return { ok: true };
}

export async function createStage(
  userId: string,
  pipelineId: string,
  data: { name: string; probability?: number },
): Promise<CrmStageRow | null> {
  const db = getDb();
  if (!(await getOwnedPipeline(userId, pipelineId))) return null;
  const id = crypto.randomUUID();
  const maxPos = (
    (await db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM crm_stages WHERE pipeline_id = ?')
      .get(pipelineId)) as { m: number }
  ).m;
  await db
    .prepare(
      'INSERT INTO crm_stages (id, pipeline_id, name, probability, position) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, pipelineId, data.name, data.probability ?? 0, maxPos + 1);
  return (await db.prepare('SELECT * FROM crm_stages WHERE id = ?').get(id)) as CrmStageRow;
}

export async function updateStage(
  userId: string,
  id: string,
  data: {
    name?: string;
    probability?: number;
    isWon?: boolean;
    isLost?: boolean;
    rottingDays?: number | null;
    /** Propiedades obligatorias para entrar (lib/crm-stage-rules.ts). */
    requiredFields?: string[];
  },
): Promise<CrmStageRow | null> {
  const db = getDb();
  if (!(await getOwnedStage(userId, id))) return null;
  const sets: Array<[string, string | number | null]> = [];
  if (data.requiredFields !== undefined) sets.push(['required_fields', JSON.stringify(normalizeRequiredFields(data.requiredFields))]);
  if (data.rottingDays !== undefined) sets.push(['rotting_days', data.rottingDays]);
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.probability !== undefined) sets.push(['probability', data.probability]);
  if (data.isWon !== undefined) sets.push(['is_won', data.isWon ? 1 : 0]);
  if (data.isLost !== undefined) sets.push(['is_lost', data.isLost ? 1 : 0]);
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_stages SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...sets.map(([, v]) => v), id);
  }
  return (await db.prepare('SELECT * FROM crm_stages WHERE id = ?').get(id)) as CrmStageRow;
}

export type DeleteStageResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_empty' };

/** Solo borra stages sin deals. */
export async function deleteStage(userId: string, id: string): Promise<DeleteStageResult> {
  const db = getDb();
  if (!(await getOwnedStage(userId, id))) return { ok: false, reason: 'not_found' };
  const dealCount = (
    (await db
      .prepare('SELECT COUNT(*) AS c FROM crm_deals WHERE stage_id = ? AND user_id = ?')
      .get(id, userId)) as { c: number }
  ).c;
  if (dealCount > 0) return { ok: false, reason: 'not_empty' };
  await db.prepare('DELETE FROM crm_stages WHERE id = ?').run(id);
  return { ok: true };
}

/** Reordena stages: position = índice en el array recibido. */
export async function reorderStages(
  userId: string,
  pipelineId: string,
  stageIds: string[],
): Promise<boolean> {
  const db = getDb();
  if (!(await getOwnedPipeline(userId, pipelineId))) return false;
  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    const stmt = tdb.prepare('UPDATE crm_stages SET position = ? WHERE id = ? AND pipeline_id = ?');
    for (let i = 0; i < stageIds.length; i++) {
      await stmt.run(i, stageIds[i], pipelineId);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return true;
}

// ============================================================
// DEALS
// ============================================================

export interface DealFilter {
  pipelineId: string;
  q?: string;
  stageId?: string;
  priority?: string;
  source?: string;
  owner?: string;
  createdFrom?: string;
  createdTo?: string;
  /** Id de tag: solo deals con ese tag. */
  tag?: string;
  /** Deals asociados a esta empresa. */
  companyId?: string;
  custom?: Record<string, string>;
  filters?: FilterRule[];
  customTypes?: Record<string, FilterFieldType>;
  ownerScope?: OwnerScope;
  sort?: 'newest' | 'oldest' | 'amount' | 'amount_asc' | 'close_date' | 'close_date_desc' | ActivityDateSort | ExtraSort;
  page?: number;
  pageSize?: number;
}

export type DealListRow = CrmDealRow & { stage_name: string | null; company_name: string | null };

const DEAL_ADV_FIELDS: Record<string, AdvancedFieldDef> = {
  name: { expr: 'd.name', type: 'text' },
  amount: { expr: 'd.amount', type: 'number' },
  stage: { expr: 'd.stage_id', type: 'select' },
  priority: { expr: 'd.priority', type: 'select' },
  source: { expr: 'd.source', type: 'select' },
  owner: { expr: 'd.owner_id', type: 'select' },
  closeDate: { expr: 'd.close_date', type: 'date' },
  created: { expr: 'd.created_at', type: 'date' },
  ...activityDateAdvFields('d'),
};

const DEAL_ORDER: Record<Exclude<NonNullable<DealFilter['sort']>, ExtraSort>, string> = {
  newest: 'd.created_at DESC, d.id',
  oldest: 'd.created_at ASC, d.id',
  amount: 'd.amount DESC, d.id',
  amount_asc: 'd.amount ASC, d.id',
  close_date: "d.close_date IS NULL, d.close_date ASC, d.id",
  close_date_desc: "d.close_date IS NULL, d.close_date DESC, d.id",
  ...activityDateOrders('d'),
};

export async function listDeals(
  userId: string,
  f: DealFilter,
): Promise<{ rows: DealListRow[]; total: number }> {
  const db = getDb();
  const where: string[] = ['d.user_id = ?', 'd.pipeline_id = ?'];
  const args: Array<string | number> = [userId, f.pipelineId];
  if (f.q) {
    where.push(`d.name LIKE ? ESCAPE '\\'`);
    args.push(`%${escapeLike(f.q)}%`);
  }
  if (f.stageId) {
    where.push('d.stage_id = ?');
    args.push(f.stageId);
  }
  if (f.priority) {
    where.push('d.priority = ?');
    args.push(f.priority);
  }
  if (f.source) {
    where.push('d.source = ?');
    args.push(f.source);
  }
  if (f.owner) {
    where.push('d.owner_id = ?');
    args.push(f.owner);
  }
  if (f.createdFrom) {
    where.push('d.created_at >= ?');
    args.push(`${f.createdFrom} 00:00:00`);
  }
  if (f.createdTo) {
    where.push('d.created_at <= ?');
    args.push(`${f.createdTo} 23:59:59`);
  }
  if (f.tag) {
    where.push(tagCondition('d', 'deal'));
    args.push(f.tag);
  }
  if (f.companyId) {
    where.push('EXISTS (SELECT 1 FROM crm_deal_companies xdc WHERE xdc.deal_id = d.id AND xdc.company_id = ?)');
    args.push(f.companyId);
  }
  if (f.custom) {
    for (const [name, value] of Object.entries(f.custom)) {
      if (!value) continue;
      where.push(`json_extract(d.custom, '$.${name}') = ?`);
      args.push(value);
    }
  }
  appendAdvancedFilters(where, args, 'd', DEAL_ADV_FIELDS, f.filters, f.customTypes);
  appendOwnerScope(where, args, 'd', f.ownerScope);
  const whereSql = where.join(' AND ');
  const total = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM crm_deals d WHERE ${whereSql}`).get(...args)) as {
      c: number;
    }
  ).c;
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(f.page ?? 1, 1), pages);
  const rows = (await db
    .prepare(
      `SELECT d.*, s.name AS stage_name,
         (SELECT co.name FROM crm_deal_companies pdc JOIN crm_companies co ON co.id = pdc.company_id
          WHERE pdc.deal_id = d.id AND pdc.is_primary = 1) AS company_name
       FROM crm_deals d
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       WHERE ${whereSql}
       ORDER BY ${extraSortOrder('d', f.sort, f.customTypes) ?? DEAL_ORDER[(f.sort ?? 'newest') as keyof typeof DEAL_ORDER] ?? DEAL_ORDER.newest}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as DealListRow[];
  return { rows, total };
}

export interface BoardDeal extends CrmDealRow {
  contact_id: string | null;
  contact_name: string | null;
  company_name: string | null;
  last_activity_at: string | null;
  /** Último email sincronizado o enviado con alguno de los contactos del deal. */
  last_email_at: string | null;
  /** amount convertido a la moneda base del workspace (totales del board). */
  amount_base: number;
  /** Calculados en la page (días desde created_at / última actividad). */
  age_days?: number;
  idle_days?: number;
}

export interface BoardStage {
  stage: CrmStageRow;
  deals: BoardDeal[];
  count: number;
  amount: number;
}

/** Columnas del kanban: stages ordenados con sus deals (orden position). */
export async function listDealsForBoard(
  userId: string,
  pipelineId: string,
  ownerScope?: OwnerScope,
): Promise<BoardStage[]> {
  const db = getDb();
  const scope = ownerScopeSql('d', ownerScope);
  const stages = (await db
    .prepare('SELECT * FROM crm_stages WHERE pipeline_id = ? ORDER BY position ASC')
    .all(pipelineId)) as CrmStageRow[];
  const deals = (await db
    .prepare(
      `SELECT d.*,
         c.id AS contact_id,
         NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name,
         co.name AS company_name,
         (SELECT MAX(a.created_at) FROM crm_activities a WHERE a.deal_id = d.id) AS last_activity_at,
         (SELECT MAX(e.sent_at) FROM crm_deal_contacts edc
            JOIN crm_email_contacts ec ON ec.contact_id = edc.contact_id
            JOIN crm_emails e ON e.id = ec.email_id
          WHERE edc.deal_id = d.id AND e.sent_at != '') AS last_email_at,
         ${baseAmountSql('d')} AS amount_base
       FROM crm_deals d
       LEFT JOIN crm_contacts c ON c.id = (
         SELECT dc.contact_id FROM crm_deal_contacts dc WHERE dc.deal_id = d.id ORDER BY dc.rowid LIMIT 1
       )
       LEFT JOIN crm_deal_companies pdc ON pdc.deal_id = d.id AND pdc.is_primary = 1
       LEFT JOIN crm_companies co ON co.id = pdc.company_id
       WHERE d.user_id = ? AND d.pipeline_id = ?${scope.sql ? ` AND ${scope.sql}` : ''}
       ORDER BY d.position ASC`,
    )
    .all(userId, pipelineId, ...scope.args)) as BoardDeal[];
  return stages.map((stage) => {
    const stageDeals = deals.filter((d) => d.stage_id === stage.id);
    return {
      stage,
      deals: stageDeals,
      count: stageDeals.length,
      // Totales en moneda base (deals en otras monedas se convierten).
      amount: stageDeals.reduce((s, d) => s + d.amount_base, 0),
    };
  });
}

export interface DealDetail {
  deal: CrmDealRow;
  stage: CrmStageRow | null;
  pipeline: CrmPipelineRow | null;
  contacts: CrmContactRow[];
  /** Empresa primaria del deal. */
  company: CrmCompanyRow | null;
  /** Todas las empresas asociadas (primaria primero). */
  companies: DealCompanyRow[];
}

export async function getDeal(userId: string, id: string): Promise<DealDetail | null> {
  const db = getDb();
  const deal = (await db
    .prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmDealRow | undefined;
  if (!deal) return null;
  const stage =
    ((await db.prepare('SELECT * FROM crm_stages WHERE id = ?').get(deal.stage_id)) as
      | CrmStageRow
      | undefined) ?? null;
  const pipeline =
    ((await db.prepare('SELECT * FROM crm_pipelines WHERE id = ?').get(deal.pipeline_id)) as
      | CrmPipelineRow
      | undefined) ?? null;
  const contacts = (await db
    .prepare(
      `SELECT c.* FROM crm_contacts c
       JOIN crm_deal_contacts dc ON dc.contact_id = c.id
       WHERE dc.deal_id = ?
       ORDER BY dc.rowid ASC`,
    )
    .all(id)) as CrmContactRow[];
  const companies = await listDealCompanies(userId, id, db);
  const primary = companies.find((c) => c.is_primary) ?? null;
  let company: CrmCompanyRow | null = null;
  if (primary) {
    const { is_primary: _p, ...row } = primary;
    company = row;
  }
  return { deal, stage, pipeline, contacts, company, companies };
}

export interface DealInput {
  pipelineId?: string;
  stageId?: string;
  name?: string;
  amount?: number;
  currency?: string;
  closeDate?: string | null;
  priority?: string;
  source?: string;
  description?: string;
  lostReason?: string;
  ownerId?: string | null;
  custom?: Record<string, unknown>;
  contactIds?: string[];
  addContactIds?: string[];
  removeContactIds?: string[];
  /** Empresa primaria (se asocia si hace falta). */
  companyId?: string | null;
  /** Empresas a asociar (no primarias, salvo que no haya otra). */
  companyIds?: string[];
  /** true = el amount es manual aunque haya line items. */
  amountOverride?: boolean;
}

export type CreateDealResult =
  | { ok: true; deal: CrmDealRow }
  | { ok: false; reason: 'invalid_pipeline' | 'invalid_stage' };

async function stageInPipeline(stageId: string, pipelineId: string): Promise<CrmStageRow | null> {
  return (
    ((await getDb()
      .prepare('SELECT * FROM crm_stages WHERE id = ? AND pipeline_id = ?')
      .get(stageId, pipelineId)) as CrmStageRow | undefined) ?? null
  );
}

async function setDealContacts(
  dealId: string,
  contactIds: string[],
  db: Db = getDb(),
): Promise<void> {
  await db.prepare('DELETE FROM crm_deal_contacts WHERE deal_id = ?').run(dealId);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO crm_deal_contacts (deal_id, contact_id) VALUES (?, ?)',
  );
  for (const contactId of contactIds) await insert.run(dealId, contactId);
}

export async function createDeal(userId: string, data: DealInput): Promise<CreateDealResult> {
  const db = getDb();
  if (!data.pipelineId || !(await getOwnedPipeline(userId, data.pipelineId))) {
    return { ok: false, reason: 'invalid_pipeline' };
  }
  if (!data.stageId || !(await stageInPipeline(data.stageId, data.pipelineId))) {
    return { ok: false, reason: 'invalid_stage' };
  }
  await assertRefs(userId, { ownerId: data.ownerId, companyId: data.companyId }, db);
  for (const companyId of data.companyIds ?? []) await assertRefs(userId, { companyId }, db);
  const contactIds = await ownedContactIds(userId, data.contactIds ?? [], db);
  const currency = (data.currency || (await getCrmSettings(userId, db)).baseCurrency).toUpperCase();
  const id = crypto.randomUUID();
  const maxPos = (
    (await db
      .prepare('SELECT COALESCE(MAX(position), 0) AS m FROM crm_deals WHERE stage_id = ?')
      .get(data.stageId)) as { m: number }
  ).m;
  const ts = now();
  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    await tdb
      .prepare(
        `INSERT INTO crm_deals
         (id, user_id, owner_id, pipeline_id, stage_id, name, amount, currency, close_date, priority,
          source, description, lost_reason, position, custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        data.ownerId ?? userId,
        data.pipelineId!,
        data.stageId!,
        data.name ?? '',
        data.amount ?? 0,
        currency,
        data.closeDate ?? null,
        data.priority ?? 'medium',
        data.source ?? '',
        data.description ?? '',
        data.lostReason ?? '',
        maxPos + 1024,
        JSON.stringify(data.custom ?? {}),
        ts,
        ts,
      );
    if (contactIds.length) await setDealContacts(id, contactIds, tdb);
    if (data.companyId) await associateDealCompany(userId, id, data.companyId, { primary: true }, tdb);
    for (const companyId of data.companyIds ?? []) await associateDealCompany(userId, id, companyId, {}, tdb);
    // Las empresas primarias de los contactos quedan asociadas (como HubSpot).
    if (contactIds.length) await autoAssociateContactCompanies(userId, id, contactIds, tdb);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  const deal = (await db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(id)) as CrmDealRow;
  await fireEvent(userId, { type: 'deal_created', entity: 'deal', entityId: id });
  return { ok: true, deal };
}

const DEAL_COLS: Record<string, string> = {
  name: 'name',
  amount: 'amount',
  currency: 'currency',
  closeDate: 'close_date',
  priority: 'priority',
  source: 'source',
  description: 'description',
  lostReason: 'lost_reason',
  ownerId: 'owner_id',
  amountOverride: 'amount_override',
  custom: 'custom',
};

export async function updateDeal(
  userId: string,
  id: string,
  data: DealInput,
  actorEmail = '',
): Promise<CrmDealRow | null> {
  const db = getDb();
  const existing = (await db
    .prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmDealRow | undefined;
  if (!existing) return null;
  await assertRefs(userId, { ownerId: data.ownerId, companyId: data.companyId }, db);
  for (const companyId of data.companyIds ?? []) await assertRefs(userId, { companyId }, db);
  const setIds = data.contactIds ? await ownedContactIds(userId, data.contactIds, db) : undefined;
  const addIds = await ownedContactIds(userId, data.addContactIds ?? [], db);
  const patch: Record<string, unknown> = { ...data };
  if (typeof patch.currency === 'string') patch.currency = patch.currency.toUpperCase();
  if (data.amountOverride !== undefined) patch.amountOverride = data.amountOverride ? 1 : 0;
  // Editar el amount a mano en un deal con line items lo fija (override).
  const lineCount = (
    (await db.prepare('SELECT COUNT(*) AS c FROM crm_line_items WHERE deal_id = ?').get(id)) as { c: number }
  ).c;
  if (data.amount !== undefined && data.amountOverride === undefined && lineCount > 0) patch.amountOverride = 1;
  const sets = toColumnValues(DEAL_COLS, patch);
  const setSql = sets.map(([c]) => `${c} = ?`).join(', ');
  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    await tdb
      .prepare(`UPDATE crm_deals SET ${setSql ? `${setSql}, ` : ''}updated_at = ? WHERE id = ?`)
      .run(...sets.map(([, v]) => v), now(), id);
    if (setIds) await setDealContacts(id, setIds, tdb);
    if (data.removeContactIds?.length) {
      const ph = data.removeContactIds.map(() => '?').join(',');
      await tdb
        .prepare(`DELETE FROM crm_deal_contacts WHERE deal_id = ? AND contact_id IN (${ph})`)
        .run(id, ...data.removeContactIds);
    }
    if (addIds.length) {
      const ins = tdb.prepare(
        'INSERT OR IGNORE INTO crm_deal_contacts (deal_id, contact_id) VALUES (?, ?)',
      );
      for (const contactId of addIds) await ins.run(id, contactId);
    }
    if (data.companyId) await associateDealCompany(userId, id, data.companyId, { primary: true }, tdb);
    for (const companyId of data.companyIds ?? []) await associateDealCompany(userId, id, companyId, {}, tdb);
    const linked = [...(setIds ?? []), ...addIds];
    if (linked.length) await autoAssociateContactCompanies(userId, id, linked, tdb);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  await logPropertyEvents(userId, 'deal', id, existing as unknown as Record<string, unknown>, sets, actorEmail);
  // Volver a "calcular desde line items" (o cambiar la moneda) recalcula el amount.
  if (lineCount > 0 && (data.amountOverride === false || data.currency !== undefined)) {
    const { recalcDealAmount } = await import('./crm-products');
    await recalcDealAmount(userId, id);
  }
  const deal = (await db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(id)) as CrmDealRow;
  await fireEvent(userId, { type: 'deal_updated', entity: 'deal', entityId: id });
  return deal;
}

/** Borra un deal: va a la papelera (lib/crm-trash.ts) con sus actividades propias. */
export async function deleteDeal(userId: string, id: string, actorEmail = ''): Promise<boolean> {
  return (await trashRecords(userId, 'deal', [id], actorEmail)) > 0;
}

export async function bulkDeleteDeals(userId: string, ids: string[], actorEmail = ''): Promise<number> {
  return trashRecords(userId, 'deal', ids, actorEmail);
}

export type MoveDealResult =
  | { ok: true; deal: CrmDealRow }
  | { ok: false; reason: 'not_found' | 'invalid_stage' }
  /** La etapa pide propiedades que el deal no tiene (claves de lib/crm-stage-rules.ts). */
  | { ok: false; reason: 'missing_required'; missing: string[] };

/**
 * Propiedades obligatorias de `stage` que le faltan al deal. Los custom
 * fields que ya no existen no se exigen (si no, ningún deal podría entrar).
 */
export async function dealMissingForStage(userId: string, deal: CrmDealRow, stage: CrmStageRow): Promise<string[]> {
  const required = parseRequiredFields(stage.required_fields);
  if (!required.length) return [];
  const db = getDb();
  const customNames = required.some((k) => k.startsWith('custom:'))
    ? new Set((await listCustomFields(userId, 'deals')).map((f) => `custom:${f.name}`))
    : new Set<string>();
  const effective = required.filter((k) => !k.startsWith('custom:') || customNames.has(k));
  const companies = effective.includes('company')
    ? ((await db.prepare('SELECT COUNT(*) AS c FROM crm_deal_companies WHERE deal_id = ?').get(deal.id)) as { c: number }).c
    : 1;
  const contacts = effective.includes('contacts')
    ? ((await db.prepare('SELECT COUNT(*) AS c FROM crm_deal_contacts WHERE deal_id = ?').get(deal.id)) as { c: number }).c
    : 1;
  return missingRequiredFields(effective, { ...deal, custom: parseCustom(deal.custom) }, { companies, contacts });
}

/**
 * Mueve un deal a otro stage del mismo pipeline.
 * - position: mediana entre vecinos; al final max+1024; al principio min/2.
 * - Semántica de cierre: stage is_won → closed_at=now y lost_reason='';
 *   stage is_lost → closed_at=now (lost_reason solo si vino lostReason);
 *   stage abierto → closed_at=NULL y lost_reason=''.
 */
export async function moveDeal(
  userId: string,
  id: string,
  stageId: string,
  beforeId?: string | null,
  lostReason?: string,
  actorEmail = '',
  /** enforceRequired=false: import y presupuestos aceptados no exigen las propiedades de la etapa. */
  opts: { enforceRequired?: boolean } = {},
): Promise<MoveDealResult> {
  const db = getDb();
  const deal = (await db
    .prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmDealRow | undefined;
  if (!deal) return { ok: false, reason: 'not_found' };
  const stage = await stageInPipeline(stageId, deal.pipeline_id);
  if (!stage) return { ok: false, reason: 'invalid_stage' };
  if (opts.enforceRequired !== false && deal.stage_id !== stageId) {
    const missing = await dealMissingForStage(userId, deal, stage);
    if (missing.length) return { ok: false, reason: 'missing_required', missing };
  }

  // Vecinos en el stage destino (sin el deal que se mueve), ordenados por position.
  const siblings = (await db
    .prepare(
      'SELECT id, position FROM crm_deals WHERE stage_id = ? AND id != ? ORDER BY position ASC',
    )
    .all(stageId, id)) as Array<{ id: string; position: number }>;

  let position: number;
  const beforeIdx = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
  if (beforeIdx > 0) {
    position = (siblings[beforeIdx - 1].position + siblings[beforeIdx].position) / 2;
  } else if (beforeIdx === 0) {
    position = siblings[0].position / 2;
  } else {
    // Al final (o beforeId inválido → se interpreta como append).
    position = siblings.length ? siblings[siblings.length - 1].position + 1024 : 1024;
  }

  const ts = now();
  let closedAt: string | null;
  let newLostReason: string;
  if (stage.is_won) {
    closedAt = ts;
    newLostReason = '';
  } else if (stage.is_lost) {
    closedAt = ts;
    newLostReason = lostReason !== undefined ? lostReason : deal.lost_reason;
  } else {
    closedAt = null;
    newLostReason = '';
  }

  const oldStageName = deal.stage_id
    ? (((await db.prepare('SELECT name FROM crm_stages WHERE id = ?').get(deal.stage_id)) as { name: string } | undefined)?.name ?? '')
    : '';
  await db
    .prepare(
      `UPDATE crm_deals
     SET stage_id = ?, position = ?, closed_at = ?, lost_reason = ?, updated_at = ?
     WHERE id = ?`,
    )
    .run(stageId, position, closedAt, newLostReason, ts, id);
  const oldStageId = deal.stage_id;
  if (oldStageName !== stage.name) {
    await db
      .prepare(
        `INSERT INTO crm_property_events
         (id, user_id, entity, entity_id, field, old_value, new_value, actor_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), userId, 'deal', id, 'stage', oldStageName, stage.name, actorEmail);
  }

  const movedDeal = (await db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(id)) as CrmDealRow;

  if (oldStageId !== stageId) {
    await fireEvent(userId, {
      type: 'deal_stage_changed',
      entity: 'deal',
      entityId: id,
      payload: { oldStageId, newStageId: stageId },
    });
    if (stage.is_won) {
      await fireEvent(userId, { type: 'deal_won', entity: 'deal', entityId: id });
    }
    if (stage.is_lost) {
      await fireEvent(userId, { type: 'deal_lost', entity: 'deal', entityId: id });
    }
  }

  return { ok: true, deal: movedDeal };
}

// ============================================================
// ACTIVITIES
// ============================================================

export interface ActivityInput {
  type?: ActivityType;
  subject?: string;
  body?: string;
  dueAt?: string | null;
  direction?: string;
  outcome?: string;
  /** Llamadas: '' = teléfono, 'whatsapp'. Solo cuenta para type 'call'. */
  channel?: string;
  durationMin?: number | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  projectId?: string | null;
  ownerId?: string | null;
  /** Solo tareas: al completarla se crea la siguiente (lib/crm-task-repeat.ts). */
  repeat?: TaskRepeat;
}

export type ActivityListRow = CrmActivityRow & {
  contact_name: string | null;
  company_name: string | null;
  deal_name: string | null;
  owner_name: string | null;
  project_name: string | null;
  project_color: string | null;
};

const ACTIVITY_SELECT = `
  SELECT a.*,
    NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name,
    co.name AS company_name,
    d.name AS deal_name,
    u.name AS owner_name,
    p.name AS project_name,
    p.color AS project_color
  FROM crm_activities a
  LEFT JOIN crm_contacts c ON c.id = a.contact_id
  LEFT JOIN crm_companies co ON co.id = a.company_id
  LEFT JOIN crm_deals d ON d.id = a.deal_id
  LEFT JOIN users u ON u.id = a.owner_id
  LEFT JOIN crm_task_projects p ON p.id = a.project_id
`;

async function assertActivityRefs(userId: string, data: ActivityInput, db: Db): Promise<void> {
  await assertRefs(
    userId,
    { contactId: data.contactId, companyId: data.companyId, dealId: data.dealId, ownerId: data.ownerId },
    db,
  );
  if (
    data.projectId &&
    !(await db
      .prepare('SELECT 1 FROM crm_task_projects WHERE id = ? AND user_id = ?')
      .get(data.projectId, userId))
  ) {
    throw new CrmRefError('invalid_project');
  }
}

/**
 * Tareas cuyo vencimiento ya pasó y todavía no dispararon `task_due`.
 * La llama el cron (app/api/cron/tick); cada tarea dispara una sola vez por fecha.
 */
export async function fireDueTasks(limit = 200): Promise<number> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT id, user_id FROM crm_activities
       WHERE type = 'task' AND done = 0 AND due_at IS NOT NULL AND due_at <= ? AND due_fired_at IS NULL
       ORDER BY due_at ASC LIMIT ?`,
    )
    .all(now(), limit)) as Array<{ id: string; user_id: string }>;
  for (const row of rows) {
    const claimed = await db
      .prepare('UPDATE crm_activities SET due_fired_at = ? WHERE id = ? AND due_fired_at IS NULL')
      .run(now(), row.id);
    if (!claimed.changes) continue;
    await fireEvent(row.user_id, { type: 'task_due', entity: 'task', entityId: row.id });
    const task = (await db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(row.id)) as CrmActivityRow | undefined;
    if (task) await emitEvent(row.user_id, 'task.due', taskEventPayload(task));
  }
  return rows.length;
}

/** Datos de una tarea para los disparadores de Flow (task.*). */
export function taskEventPayload(task: CrmActivityRow) {
  return {
    task: {
      id: task.id,
      subject: task.subject,
      body: task.body,
      dueAt: task.due_at,
      done: task.done === 1,
      doneAt: task.done_at ?? null,
      ownerId: task.owner_id,
      contactId: task.contact_id,
      companyId: task.company_id,
      dealId: task.deal_id,
    },
  };
}

export async function createActivity(
  userId: string,
  data: ActivityInput,
): Promise<CrmActivityRow> {
  const db = getDb();
  await assertActivityRefs(userId, data, db);
  const id = crypto.randomUUID();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO crm_activities
       (id, user_id, owner_id, type, subject, body, due_at, direction, outcome, channel, duration_min,
        contact_id, company_id, deal_id, project_id, repeat, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      data.ownerId ?? null,
      data.type ?? 'note',
      data.subject ?? '',
      data.body ?? '',
      data.dueAt ?? null,
      data.direction ?? '',
      data.outcome ?? '',
      (data.type ?? 'note') === 'call' ? (data.channel ?? '') : '',
      data.durationMin ?? null,
      data.contactId ?? null,
      data.companyId ?? null,
      data.dealId ?? null,
      data.projectId ?? null,
      (data.type ?? 'note') === 'task' ? (data.repeat ?? 'none') : 'none',
      ts,
      ts,
    );
  // Lead scoring: reuniones, llamadas y notas cuentan como actividad del contacto.
  if (data.contactId) {
    const { recalcContactScoreSafe } = await import('./crm-scoring');
    await recalcContactScoreSafe(userId, data.contactId);
  }
  const created = (await db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(id)) as CrmActivityRow;
  if (created.type === 'task') await emitEvent(userId, 'task.created', taskEventPayload(created));
  return created;
}

export async function updateActivity(
  userId: string,
  id: string,
  data: ActivityInput & { done?: boolean; pinned?: boolean },
): Promise<CrmActivityRow | null> {
  const db = getDb();
  const existing = (await db
    .prepare('SELECT * FROM crm_activities WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmActivityRow | undefined;
  if (!existing) return null;
  await assertActivityRefs(userId, data, db);

  const sets: Array<[string, string | number | null]> = [];
  if (data.type !== undefined) sets.push(['type', data.type]);
  if (data.subject !== undefined) sets.push(['subject', data.subject]);
  if (data.body !== undefined) sets.push(['body', data.body]);
  if (data.dueAt !== undefined) {
    sets.push(['due_at', data.dueAt]);
    // Nueva fecha → el aviso de vencimiento (task_due) vuelve a quedar pendiente.
    if (data.dueAt !== existing.due_at) sets.push(['due_fired_at', null]);
  }
  if (data.direction !== undefined) sets.push(['direction', data.direction]);
  if (data.outcome !== undefined) sets.push(['outcome', data.outcome]);
  if (data.durationMin !== undefined) sets.push(['duration_min', data.durationMin]);
  if (data.contactId !== undefined) sets.push(['contact_id', data.contactId]);
  if (data.companyId !== undefined) sets.push(['company_id', data.companyId]);
  if (data.dealId !== undefined) sets.push(['deal_id', data.dealId]);
  if (data.projectId !== undefined) sets.push(['project_id', data.projectId]);
  if (data.ownerId !== undefined) sets.push(['owner_id', data.ownerId]);
  if (data.done !== undefined) {
    sets.push(['done', data.done ? 1 : 0]);
    // done → done_at=now; undone → done_at NULL.
    sets.push(['done_at', data.done ? now() : null]);
  }
  if (data.pinned !== undefined) sets.push(['pinned', data.pinned ? 1 : 0]);
  if (data.repeat !== undefined) sets.push(['repeat', data.repeat]);
  sets.push(['updated_at', now()]);
  await db
    .prepare(`UPDATE crm_activities SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...sets.map(([, v]) => v), id);
  const updated = (await db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(id)) as CrmActivityRow;
  if (data.done === true && existing.done === 0 && updated.type === 'task') {
    await emitEvent(userId, 'task.completed', taskEventPayload(updated));
  }
  if (data.done === true && existing.done === 0 && (await spawnNextRepeat(userId, updated, db))) {
    return (await db.prepare('SELECT * FROM crm_activities WHERE id = ?').get(id)) as CrmActivityRow;
  }
  return updated;
}

/**
 * Tarea con repetición recién completada → crea la siguiente de la serie (una
 * sola vez: repeat_next_id reclama la tarea, reabrir y volver a completar no
 * duplica). Copia asunto, cuerpo, owner, proyecto y registros asociados.
 */
async function spawnNextRepeat(userId: string, task: CrmActivityRow, db: Db): Promise<string | null> {
  const repeat = task.repeat ?? 'none';
  if (task.type !== 'task' || repeat === 'none' || task.repeat_next_id) return null;
  const nextId = crypto.randomUUID();
  const claimed = await db
    .prepare('UPDATE crm_activities SET repeat_next_id = ? WHERE id = ? AND repeat_next_id IS NULL')
    .run(nextId, task.id);
  if (!claimed.changes) return null;
  const ts = now();
  await db
    .prepare(
      `INSERT INTO crm_activities
       (id, user_id, owner_id, type, subject, body, due_at, contact_id, company_id, deal_id, project_id, repeat,
        created_at, updated_at)
       VALUES (?, ?, ?, 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      nextId,
      userId,
      task.owner_id,
      task.subject,
      task.body,
      nextRepeatDue(task.due_at, repeat),
      task.contact_id,
      task.company_id,
      task.deal_id,
      task.project_id,
      repeat,
      ts,
      ts,
    );
  return nextId;
}

/** Borra una actividad: va a la papelera (lib/crm-trash.ts). */
export async function deleteActivity(userId: string, id: string, actorEmail = ''): Promise<boolean> {
  return (await trashRecords(userId, 'activity', [id], actorEmail)) > 0;
}

export async function getActivity(userId: string, id: string): Promise<ActivityListRow | null> {
  return (await getDb()
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE a.id = ? AND a.user_id = ?`,
    )
    .get(id, userId)) as ActivityListRow | undefined ?? null;
}

// ============================================================
// TASK PROJECTS
// ============================================================

export interface TaskProjectInput {
  name?: string;
  color?: string;
  archived?: boolean;
}

export async function listTaskProjects(userId: string, includeArchived = false): Promise<CrmTaskProjectRow[]> {
  const db = getDb();
  if (includeArchived) {
    return (await db
      .prepare(
        'SELECT * FROM crm_task_projects WHERE user_id = ? ORDER BY archived ASC, name ASC',
      )
      .all(userId)) as CrmTaskProjectRow[];
  }
  return (await db
    .prepare(
      'SELECT * FROM crm_task_projects WHERE user_id = ? AND archived = 0 ORDER BY name ASC',
    )
    .all(userId)) as CrmTaskProjectRow[];
}

export async function getTaskProject(userId: string, id: string): Promise<CrmTaskProjectRow | null> {
  return (
    ((await getDb()
      .prepare('SELECT * FROM crm_task_projects WHERE id = ? AND user_id = ?')
      .get(id, userId)) as CrmTaskProjectRow | undefined) ?? null
  );
}

export async function createTaskProject(userId: string, data: TaskProjectInput): Promise<CrmTaskProjectRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = now();
  await db
    .prepare(
      `INSERT INTO crm_task_projects (id, user_id, name, color, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      data.name ?? 'Project',
      data.color ?? '#666666',
      data.archived ? 1 : 0,
      ts,
      ts,
    );
  return (await db.prepare('SELECT * FROM crm_task_projects WHERE id = ?').get(id)) as CrmTaskProjectRow;
}

export async function updateTaskProject(
  userId: string,
  id: string,
  data: TaskProjectInput,
): Promise<CrmTaskProjectRow | null> {
  const db = getDb();
  const existing = await getTaskProject(userId, id);
  if (!existing) return null;
  const sets: Array<[string, string | number]> = [];
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.color !== undefined) sets.push(['color', data.color]);
  if (data.archived !== undefined) sets.push(['archived', data.archived ? 1 : 0]);
  if (sets.length) {
    sets.push(['updated_at', now()]);
    await db
      .prepare(
        `UPDATE crm_task_projects SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
      )
      .run(...sets.map(([, v]) => v), id);
  }
  return (await db.prepare('SELECT * FROM crm_task_projects WHERE id = ?').get(id)) as CrmTaskProjectRow;
}

export async function deleteTaskProject(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const project = await getTaskProject(userId, id);
  if (!project) return false;
  await db.prepare('UPDATE crm_activities SET project_id = NULL, updated_at = ? WHERE project_id = ?').run(now(), id);
  return (await db.prepare('DELETE FROM crm_task_projects WHERE id = ? AND user_id = ?').run(id, userId)).changes > 0;
}

// ============================================================
// TASK FILES
// ============================================================

export async function listTaskFiles(activityId: string): Promise<CrmTaskFileRow[]> {
  return (await getDb()
    .prepare(
      'SELECT * FROM crm_task_files WHERE activity_id = ? ORDER BY created_at DESC',
    )
    .all(activityId)) as CrmTaskFileRow[];
}

export async function createTaskFile(
  activityId: string,
  data: { filename: string; contentType: string; size: number; url: string },
): Promise<CrmTaskFileRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_task_files (id, activity_id, filename, content_type, size, url)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, activityId, data.filename, data.contentType, data.size, data.url);
  return (await db.prepare('SELECT * FROM crm_task_files WHERE id = ?').get(id)) as CrmTaskFileRow;
}

/** Borra el adjunto y su archivo del almacenamiento (en la papelera, en cambio, se conserva). */
export async function deleteTaskFile(activityId: string, fileId: string): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT url FROM crm_task_files WHERE id = ? AND activity_id = ?')
    .get(fileId, activityId)) as { url: string } | undefined;
  if (!row) return false;
  await db.prepare('DELETE FROM crm_task_files WHERE id = ? AND activity_id = ?').run(fileId, activityId);
  await deleteUploads([row.url]);
  return true;
}

export interface TimelineFilter {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  type?: ActivityType;
  limit?: number;
  /** Visibilidad por owner: solo actividades de registros visibles. */
  ownerScope?: OwnerScope;
}

/** Timeline de un registro (contacto, empresa o deal), más reciente primero. */
export async function listTimeline(
  userId: string,
  f: TimelineFilter,
): Promise<ActivityListRow[]> {
  const db = getDb();
  const where: string[] = ['a.user_id = ?'];
  const args: Array<string | number> = [userId];
  if (f.contactId) {
    where.push('a.contact_id = ?');
    args.push(f.contactId);
  }
  if (f.companyId) {
    where.push('a.company_id = ?');
    args.push(f.companyId);
  }
  if (f.dealId) {
    where.push('a.deal_id = ?');
    args.push(f.dealId);
  }
  if (f.type) {
    where.push('a.type = ?');
    args.push(f.type);
  }
  const scope = activityScopeSql('a', f.ownerScope);
  if (scope.sql) {
    where.push(scope.sql);
    args.push(...scope.args);
  }
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500);
  return (await db
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY a.pinned DESC, COALESCE(a.due_at, a.created_at) DESC, a.created_at DESC
       LIMIT ?`,
    )
    .all(...args, limit)) as ActivityListRow[];
}

/** Próxima tarea abierta de un registro (la de vencimiento más cercano; sin fecha al final). */
export async function nextTaskFor(
  userId: string,
  f: { contactId?: string; companyId?: string; dealId?: string },
): Promise<ActivityListRow | null> {
  const where: string[] = ["a.user_id = ?", "a.type = 'task'", 'a.done = 0'];
  const args: Array<string | number> = [userId];
  if (f.contactId) {
    where.push('a.contact_id = ?');
    args.push(f.contactId);
  }
  if (f.companyId) {
    where.push('a.company_id = ?');
    args.push(f.companyId);
  }
  if (f.dealId) {
    where.push('a.deal_id = ?');
    args.push(f.dealId);
  }
  const row = (await getDb()
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE ${where.join(' AND ')}
       ORDER BY a.due_at IS NULL, a.due_at ASC, a.created_at ASC
       LIMIT 1`,
    )
    .get(...args)) as ActivityListRow | undefined;
  return row ?? null;
}

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'done';

export interface ListTasksFilter {
  bucket: TaskBucket;
  projectId?: string;
  ownerId?: string;
  ownerScope?: OwnerScope;
}

export async function listTasks(userId: string, filter: TaskBucket | ListTasksFilter): Promise<ActivityListRow[]> {
  const db = getDb();
  const { start, end } = await todayRange();
  const f: ListTasksFilter = typeof filter === 'string' ? { bucket: filter } : filter;
  let cond: string;
  const args: Array<string | number> = [userId];
  switch (f.bucket) {
    case 'overdue':
      cond = 'a.done = 0 AND a.due_at IS NOT NULL AND a.due_at < ?';
      args.push(start);
      break;
    case 'today':
      cond = 'a.done = 0 AND a.due_at >= ? AND a.due_at <= ?';
      args.push(start, end);
      break;
    case 'upcoming':
      cond = 'a.done = 0 AND (a.due_at IS NULL OR a.due_at > ?)';
      args.push(end);
      break;
    case 'done':
      cond = 'a.done = 1';
      break;
  }
  if (f.projectId) {
    cond += ' AND a.project_id = ?';
    args.push(f.projectId);
  }
  if (f.ownerId) {
    cond += ' AND a.owner_id = ?';
    args.push(f.ownerId);
  }
  const scope = activityScopeSql('a', f.ownerScope);
  if (scope.sql) {
    cond += ` AND ${scope.sql}`;
    args.push(...scope.args);
  }
  const order =
    f.bucket === 'done'
      ? 'a.done_at DESC, a.updated_at DESC'
      : 'a.due_at IS NULL, a.due_at ASC, a.created_at DESC';
  return (await db
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE a.user_id = ? AND a.type = 'task' AND ${cond}
       ORDER BY ${order}`,
    )
    .all(...args)) as ActivityListRow[];
}

/** Busca tareas por subject, body o entidad asociada. */
export async function searchTasks(userId: string, q: string, ownerScope?: OwnerScope): Promise<ActivityListRow[]> {
  const db = getDb();
  const like = `%${escapeLike(q)}%`;
  const scope = activityScopeSql('a', ownerScope);
  return (await db
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE a.user_id = ? AND a.type = 'task'
         AND (a.subject LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\'
              OR c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\'
              OR co.name LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\')${scope.sql ? ` AND ${scope.sql}` : ''}
       ORDER BY a.updated_at DESC
       LIMIT 10`,
    )
    .all(userId, like, like, like, like, like, like, ...scope.args)) as ActivityListRow[];
}

/** Tareas abiertas vencidas o que vencen hoy (badge de la sidebar). */
export async function countDueTasks(userId: string): Promise<number> {
  const { end } = await todayRange();
  const row = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM crm_activities
       WHERE user_id = ? AND type = 'task' AND done = 0 AND due_at IS NOT NULL AND due_at <= ?`,
    )
    .get(userId, end)) as { c: number };
  return row.c;
}

// ============================================================
// LISTS
// ============================================================

/** Filtro JSON de una lista dinámica (subset de ContactFilter). */
export interface ListFilterJson {
  q?: string;
  lifecycle?: string;
  leadStatus?: string;
  source?: string;
}

function parseListFilter(json: string): ListFilterJson {
  const raw = parseJsonObject(json);
  const out: ListFilterJson = {};
  if (typeof raw.q === 'string') out.q = raw.q;
  if (typeof raw.lifecycle === 'string') out.lifecycle = raw.lifecycle;
  if (typeof raw.leadStatus === 'string') out.leadStatus = raw.leadStatus;
  if (typeof raw.source === 'string') out.source = raw.source;
  return out;
}

async function countDynamicList(userId: string, filter: ListFilterJson): Promise<number> {
  const { where, args } = buildContactWhere(userId, filter);
  return (
    (await getDb()
      .prepare(`SELECT COUNT(*) AS c FROM crm_contacts c WHERE ${where}`)
      .get(...args)) as { c: number }
  ).c;
}

export interface ListWithCount extends CrmListRow {
  memberCount: number;
}

export async function listLists(userId: string): Promise<ListWithCount[]> {
  const db = getDb();
  const lists = (await db
    .prepare('SELECT * FROM crm_lists WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId)) as CrmListRow[];
  const countStmt = db.prepare('SELECT COUNT(*) AS c FROM crm_list_members WHERE list_id = ?');
  return Promise.all(
    lists.map(async (list) => ({
      ...list,
      memberCount:
        list.kind === 'dynamic'
          ? await countDynamicList(userId, parseListFilter(list.filter))
          : ((await countStmt.get(list.id)) as { c: number }).c,
    })),
  );
}

export interface ListDetail {
  list: CrmListRow;
  members: ContactListRow[];
  memberCount: number;
}

export async function getList(userId: string, id: string): Promise<ListDetail | null> {
  const db = getDb();
  const list = (await db
    .prepare('SELECT * FROM crm_lists WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CrmListRow | undefined;
  if (!list) return null;
  if (list.kind === 'dynamic') {
    // Evalúa el filtro con el mismo WHERE builder de listContacts.
    const { where, args } = buildContactWhere(userId, parseListFilter(list.filter));
    const members = (await db
      .prepare(
        `SELECT c.*, co.name AS company_name
         FROM crm_contacts c
         LEFT JOIN crm_companies co ON co.id = c.company_id
         WHERE ${where}
         ORDER BY ${CONTACT_ORDER.newest}
         LIMIT 500`,
      )
      .all(...args)) as ContactListRow[];
    // Se muestran hasta 500, pero el conteo es el real.
    const count = (await db
      .prepare(`SELECT COUNT(*) AS n FROM crm_contacts c WHERE ${where}`)
      .get(...args)) as { n: number };
    return { list, members, memberCount: count.n };
  }
  const members = (await db
    .prepare(
      `SELECT c.*, co.name AS company_name
       FROM crm_contacts c
       JOIN crm_list_members m ON m.contact_id = c.id
       LEFT JOIN crm_companies co ON co.id = c.company_id
       WHERE m.list_id = ? AND c.user_id = ?
       ORDER BY c.created_at DESC`,
    )
    .all(id, userId)) as ContactListRow[];
  return { list, members, memberCount: members.length };
}

export interface ListInput {
  name?: string;
  entity?: string;
  kind?: 'static' | 'dynamic';
  filter?: ListFilterJson;
}

export async function createList(userId: string, data: ListInput): Promise<CrmListRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO crm_lists (id, user_id, name, entity, kind, filter) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      id,
      userId,
      data.name ?? '',
      data.entity ?? 'contacts',
      data.kind ?? 'static',
      JSON.stringify(data.filter ?? {}),
    );
  return (await db.prepare('SELECT * FROM crm_lists WHERE id = ?').get(id)) as CrmListRow;
}

export async function updateList(
  userId: string,
  id: string,
  data: ListInput,
): Promise<CrmListRow | null> {
  const db = getDb();
  const existing = await db
    .prepare('SELECT id FROM crm_lists WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!existing) return null;
  const sets: Array<[string, string]> = [];
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.entity !== undefined) sets.push(['entity', data.entity]);
  if (data.kind !== undefined) sets.push(['kind', data.kind]);
  if (data.filter !== undefined) sets.push(['filter', JSON.stringify(data.filter)]);
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_lists SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...sets.map(([, v]) => v), id);
  }
  return (await db.prepare('SELECT * FROM crm_lists WHERE id = ?').get(id)) as CrmListRow;
}

export async function deleteList(userId: string, id: string): Promise<boolean> {
  return (
    (await getDb().prepare('DELETE FROM crm_lists WHERE id = ? AND user_id = ?').run(id, userId))
      .changes > 0
  );
}

/** Agrega contactos a una lista estática del workspace (ignora ids ajenos). */
export async function addListMembers(
  userId: string,
  listId: string,
  contactIds: string[],
): Promise<number> {
  const list = await getDb()
    .prepare("SELECT 1 FROM crm_lists WHERE id = ? AND user_id = ? AND kind = 'static'")
    .get(listId, userId);
  if (!list) return 0;
  contactIds = await ownedContactIds(userId, contactIds);
  if (!contactIds.length) return 0;
  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  let added = 0;
  try {
    const insert = tdb.prepare(
      'INSERT OR IGNORE INTO crm_list_members (list_id, contact_id) VALUES (?, ?)',
    );
    for (const contactId of contactIds) added += (await insert.run(listId, contactId)).changes;
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return added;
}

export async function removeListMember(
  userId: string,
  listId: string,
  contactId: string,
): Promise<boolean> {
  return (
    (await getDb()
      .prepare(
        `DELETE FROM crm_list_members WHERE list_id = ? AND contact_id = ?
         AND list_id IN (SELECT id FROM crm_lists WHERE user_id = ?)`,
      )
      .run(listId, contactId, userId)).changes > 0
  );
}

// ============================================================
// SAVED VIEWS
// ============================================================

export async function listSavedViews(
  userId: string,
  entity: string,
): Promise<CrmSavedViewRow[]> {
  return (await getDb()
    .prepare(
      'SELECT * FROM crm_saved_views WHERE user_id = ? AND entity = ? ORDER BY created_at ASC',
    )
    .all(userId, entity)) as CrmSavedViewRow[];
}

export async function createSavedView(
  userId: string,
  data: { entity: string; name: string; query?: Record<string, unknown> },
): Promise<CrmSavedViewRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO crm_saved_views (id, user_id, entity, name, query) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, data.entity, data.name, JSON.stringify(data.query ?? {}));
  return (await db.prepare('SELECT * FROM crm_saved_views WHERE id = ?').get(id)) as CrmSavedViewRow;
}

export async function deleteSavedView(userId: string, id: string): Promise<boolean> {
  return (
    (await getDb()
      .prepare('DELETE FROM crm_saved_views WHERE id = ? AND user_id = ?')
      .run(id, userId)).changes > 0
  );
}

// ============================================================
// SAVED REPORTS
// ============================================================

export async function listSavedReports(userId: string): Promise<CrmSavedReportRow[]> {
  return (await getDb()
    .prepare(
      'SELECT * FROM crm_saved_reports WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(userId)) as CrmSavedReportRow[];
}

export async function createSavedReport(
  userId: string,
  data: { name: string; reportType: string; filters?: Record<string, unknown> },
): Promise<CrmSavedReportRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO crm_saved_reports (id, user_id, name, report_type, filters) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, userId, data.name, data.reportType, JSON.stringify(data.filters ?? {}));
  return (await db.prepare('SELECT * FROM crm_saved_reports WHERE id = ?').get(id)) as CrmSavedReportRow;
}

export async function deleteSavedReport(userId: string, id: string): Promise<boolean> {
  return (
    (await getDb()
      .prepare('DELETE FROM crm_saved_reports WHERE id = ? AND user_id = ?')
      .run(id, userId)).changes > 0
  );
}

// ============================================================
// CUSTOM FIELDS
// ============================================================

export async function listCustomFields(
  userId: string,
  entity?: string,
): Promise<CrmCustomFieldRow[]> {
  const db = getDb();
  if (entity) {
    return (await db
      .prepare(
        'SELECT * FROM crm_custom_fields WHERE user_id = ? AND entity = ? ORDER BY position ASC, label ASC',
      )
      .all(userId, entity)) as CrmCustomFieldRow[];
  }
  return (await db
    .prepare('SELECT * FROM crm_custom_fields WHERE user_id = ? ORDER BY entity ASC, position ASC')
    .all(userId)) as CrmCustomFieldRow[];
}

export interface CustomFieldInput {
  entity?: string;
  name?: string;
  label?: string;
  type?: CrmCustomFieldType;
  options?: string[];
  position?: number;
}

export async function createCustomField(
  userId: string,
  data: CustomFieldInput,
): Promise<CrmCustomFieldRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_custom_fields (id, user_id, entity, name, label, type, options, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      data.entity ?? 'contacts',
      data.name ?? '',
      data.label ?? '',
      data.type ?? 'text',
      JSON.stringify(data.options ?? []),
      data.position ?? 0,
    );
  return (await db
    .prepare('SELECT * FROM crm_custom_fields WHERE id = ?')
    .get(id)) as CrmCustomFieldRow;
}

export async function updateCustomField(
  userId: string,
  id: string,
  data: CustomFieldInput,
): Promise<CrmCustomFieldRow | null> {
  const db = getDb();
  const existing = await db
    .prepare('SELECT id FROM crm_custom_fields WHERE id = ? AND user_id = ?')
    .get(id, userId);
  if (!existing) return null;
  const sets: Array<[string, string | number]> = [];
  if (data.entity !== undefined) sets.push(['entity', data.entity]);
  if (data.name !== undefined) sets.push(['name', data.name]);
  if (data.label !== undefined) sets.push(['label', data.label]);
  if (data.type !== undefined) sets.push(['type', data.type]);
  if (data.options !== undefined) sets.push(['options', JSON.stringify(data.options)]);
  if (data.position !== undefined) sets.push(['position', data.position]);
  if (sets.length) {
    await db
      .prepare(
        `UPDATE crm_custom_fields SET ${sets.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
      )
      .run(...sets.map(([, v]) => v), id);
  }
  return (await db
    .prepare('SELECT * FROM crm_custom_fields WHERE id = ?')
    .get(id)) as CrmCustomFieldRow;
}

export async function deleteCustomField(userId: string, id: string): Promise<boolean> {
  return (
    (await getDb()
      .prepare('DELETE FROM crm_custom_fields WHERE id = ? AND user_id = ?')
      .run(id, userId)).changes > 0
  );
}

// ============================================================
// IMPORT / EXPORT
// ============================================================

// La lógica de import vive en lib/crm-import.ts (owner por email, custom
// fields, asociaciones, deals, presets). Se re-exporta por compatibilidad.
export {
  importCompanies,
  importContacts,
  importDeals,
  type ImportMode,
  type ImportResult,
  type MappedCompanyRow,
  type MappedContactRow,
  type MappedDealRow,
} from './crm-import';

export type ExportEntity = 'contacts' | 'companies' | 'deals' | 'activities';

/** Todas las filas del usuario para export (sin auth extra: lo maneja la ruta). */
export async function exportRows(
  userId: string,
  entity: ExportEntity,
  ownerScope?: OwnerScope,
): Promise<Array<CrmContactRow | CrmCompanyRow | CrmDealRow | CrmActivityRow>> {
  const db = getDb();
  const table =
    entity === 'contacts'
      ? 'crm_contacts'
      : entity === 'companies'
        ? 'crm_companies'
        : entity === 'deals'
          ? 'crm_deals'
          : 'crm_activities';
  const scope = entity === 'activities' ? activityScopeSql('x', ownerScope) : ownerScopeSql('x', ownerScope);
  return (await db
    .prepare(
      `SELECT x.*, u.email AS owner_email FROM ${table} x
       LEFT JOIN users u ON u.id = x.owner_id
       WHERE x.user_id = ?${scope.sql ? ` AND ${scope.sql}` : ''} ORDER BY x.created_at DESC`,
    )
    .all(userId, ...scope.args)) as Array<CrmContactRow | CrmCompanyRow | CrmDealRow | CrmActivityRow>;
}

// ============================================================
// OVERVIEW / REPORTS
// ============================================================

export interface FunnelStage {
  id: string;
  name: string;
  probability: number;
  is_won: 0 | 1;
  is_lost: 0 | 1;
  count: number;
  amount: number;
}

export interface WonLostMonth {
  month: string; // 'YYYY-MM'
  won: number;
  lost: number;
}

export interface ClosingDealRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  close_date: string | null;
  stage_name: string | null;
}

export interface CrmOverview {
  totalContacts: number;
  openDealsCount: number;
  openDealsAmount: number;
  forecastWeighted: number;
  wonThisMonth: { count: number; amount: number };
  tasksDueToday: number;
  funnel: FunnelStage[];
  wonLostByMonth: WonLostMonth[];
  recentActivities: ActivityListRow[];
  upcomingTasks: ActivityListRow[];
  closingThisMonth: ClosingDealRow[];
}

async function defaultPipelineId(userId: string): Promise<string | null> {
  const row = (await getDb()
    .prepare('SELECT id FROM crm_pipelines WHERE user_id = ? ORDER BY position ASC LIMIT 1')
    .get(userId)) as { id: string } | undefined;
  return row?.id ?? null;
}

/** ' AND <cond>' de visibilidad por owner para el alias (o '' si no restringe). */
function scopeAnd(alias: string, scope: OwnerScope | undefined): { sql: string; args: string[] } {
  const c = ownerScopeSql(alias, scope);
  return c.sql ? { sql: ` AND ${c.sql}`, args: c.args } : { sql: '', args: [] };
}

function activityScopeAnd(alias: string, scope: OwnerScope | undefined): { sql: string; args: string[] } {
  const c = activityScopeSql(alias, scope);
  return c.sql ? { sql: ` AND ${c.sql}`, args: c.args } : { sql: '', args: [] };
}

async function funnelForPipeline(
  userId: string,
  pipelineId: string | null,
  ownerScope?: OwnerScope,
): Promise<FunnelStage[]> {
  if (!pipelineId) return [];
  const sc = scopeAnd('d', ownerScope);
  return (await getDb()
    .prepare(
      `SELECT s.id, s.name, s.probability, s.is_won, s.is_lost,
         COUNT(d.id) AS count, COALESCE(SUM(${baseAmountSql('d')}), 0) AS amount
       FROM crm_stages s
       LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = ?${sc.sql}
       WHERE s.pipeline_id = ?
       GROUP BY s.id
       ORDER BY s.position ASC`,
    )
    .all(userId, ...sc.args, pipelineId)) as FunnelStage[];
}

/** Últimos 6 meses (incluido el actual) con conteo de deals won/lost por closed_at. */
export async function wonLostByMonth(userId: string, ownerScope?: OwnerScope): Promise<WonLostMonth[]> {
  const db = getDb();
  const months: string[] = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(
      `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  }
  const sc = scopeAnd('d', ownerScope);
  const rows = (await db
    .prepare(
      `SELECT substr(d.closed_at, 1, 7) AS month,
         SUM(CASE WHEN s.is_won = 1 THEN 1 ELSE 0 END) AS won,
         SUM(CASE WHEN s.is_lost = 1 THEN 1 ELSE 0 END) AS lost
       FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND d.closed_at IS NOT NULL AND substr(d.closed_at, 1, 7) >= ?${sc.sql}
       GROUP BY month`,
    )
    .all(userId, months[0], ...sc.args)) as Array<{ month: string; won: number; lost: number }>;
  const map = new Map(rows.map((r) => [r.month, r]));
  return months.map((month) => ({
    month,
    won: map.get(month)?.won ?? 0,
    lost: map.get(month)?.lost ?? 0,
  }));
}

export async function getCrmOverview(userId: string, ownerScope?: OwnerScope): Promise<CrmOverview> {
  const db = getDb();
  const { start, end } = await todayRange();
  const month = start.slice(0, 7);
  const cs = scopeAnd('c', ownerScope);
  const ds = scopeAnd('d', ownerScope);
  const as = activityScopeAnd('a', ownerScope);

  const totalContacts = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM crm_contacts c WHERE c.user_id = ?${cs.sql}`).get(userId, ...cs.args)) as {
      c: number;
    }
  ).c;

  const open = (await db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(${baseAmountSql('d')}), 0) AS a FROM crm_deals d WHERE d.user_id = ? AND d.closed_at IS NULL${ds.sql}`,
    )
    .get(userId, ...ds.args)) as { c: number; a: number };

  const forecastWeighted = (
    (await db
      .prepare(
        `SELECT COALESCE(SUM(${baseAmountSql('d')} * s.probability / 100.0), 0) AS f
         FROM crm_deals d
         JOIN crm_stages s ON s.id = d.stage_id
         WHERE d.user_id = ? AND d.closed_at IS NULL${ds.sql}`,
      )
      .get(userId, ...ds.args)) as { f: number }
  ).f;

  const wonThisMonth = (await db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(${baseAmountSql('d')}), 0) AS a
       FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND s.is_won = 1 AND substr(d.closed_at, 1, 7) = ?${ds.sql}`,
    )
    .get(userId, month, ...ds.args)) as { c: number; a: number };

  const tasksDueToday = (
    (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM crm_activities a
         WHERE a.user_id = ? AND a.type = 'task' AND a.done = 0 AND a.due_at >= ? AND a.due_at <= ?${as.sql}`,
      )
      .get(userId, start, end, ...as.args)) as { c: number }
  ).c;

  const recentActivities = (await db
    .prepare(`${ACTIVITY_SELECT} WHERE a.user_id = ?${as.sql} ORDER BY a.created_at DESC LIMIT 8`)
    .all(userId, ...as.args)) as ActivityListRow[];

  const upcomingTasks = (await db
    .prepare(
      `${ACTIVITY_SELECT}
       WHERE a.user_id = ? AND a.type = 'task' AND a.done = 0 AND (a.due_at IS NULL OR a.due_at >= ?)${as.sql}
       ORDER BY a.due_at IS NULL, a.due_at ASC, a.created_at DESC
       LIMIT 6`,
    )
    .all(userId, start, ...as.args)) as ActivityListRow[];

  const closingThisMonth = (await db
    .prepare(
      `SELECT d.id, d.name, d.amount, d.currency, d.close_date, s.name AS stage_name
       FROM crm_deals d
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND d.closed_at IS NULL AND substr(d.close_date, 1, 7) = ?${ds.sql}
       ORDER BY d.close_date ASC
       LIMIT 8`,
    )
    .all(userId, month, ...ds.args)) as ClosingDealRow[];

  return {
    totalContacts,
    openDealsCount: open.c,
    openDealsAmount: open.a,
    forecastWeighted,
    wonThisMonth: { count: wonThisMonth.c, amount: wonThisMonth.a },
    tasksDueToday,
    closingThisMonth,
    funnel: await funnelForPipeline(userId, await defaultPipelineId(userId), ownerScope),
    wonLostByMonth: await wonLostByMonth(userId, ownerScope),
    recentActivities,
    upcomingTasks,
  };
}

export interface CrmReports {
  funnel: FunnelStage[];
  forecastByStage: Array<{
    id: string;
    name: string;
    probability: number;
    count: number;
    amount: number;
    forecast: number;
  }>;
  wonLostByMonth: WonLostMonth[];
  dealsBySource: Array<{ source: string; count: number; amount: number }>;
  contactsByLifecycle: Array<{ lifecycle: string; count: number }>;
  activitiesByType: Array<{ type: string; count: number }>;
  dealsByPriority: Array<{ priority: string; count: number; amount: number }>;
  lostReasons: Array<{ reason: string; count: number }>;
  avgDaysToClose: number | null;
  tasksByStatus: Array<{ status: 'done' | 'pending'; count: number }>;
}

export async function getCrmReports(userId: string, ownerScope?: OwnerScope): Promise<CrmReports> {
  const db = getDb();
  const pipelineId = await defaultPipelineId(userId);
  const ds = scopeAnd('d', ownerScope);
  const cs = scopeAnd('c', ownerScope);
  const as = activityScopeAnd('a', ownerScope);

  const forecastByStage = pipelineId
    ? ((await db
        .prepare(
          `SELECT s.id, s.name, s.probability,
             COUNT(d.id) AS count,
             COALESCE(SUM(${baseAmountSql('d')}), 0) AS amount,
             COALESCE(SUM(${baseAmountSql('d')} * s.probability / 100.0), 0) AS forecast
           FROM crm_stages s
           LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = ? AND d.closed_at IS NULL${ds.sql}
           WHERE s.pipeline_id = ?
           GROUP BY s.id
           ORDER BY s.position ASC`,
        )
        .all(userId, ...ds.args, pipelineId)) as CrmReports['forecastByStage'])
    : [];

  const dealsBySource = (await db
    .prepare(
      `SELECT COALESCE(NULLIF(d.source, ''), 'other') AS source,
         COUNT(*) AS count, COALESCE(SUM(${baseAmountSql('d')}), 0) AS amount
       FROM crm_deals d
       WHERE d.user_id = ?${ds.sql}
       GROUP BY 1
       ORDER BY amount DESC`,
    )
    .all(userId, ...ds.args)) as CrmReports['dealsBySource'];

  const contactsByLifecycle = (await db
    .prepare(
      `SELECT c.lifecycle_stage AS lifecycle, COUNT(*) AS count
       FROM crm_contacts c
       WHERE c.user_id = ?${cs.sql}
       GROUP BY c.lifecycle_stage
       ORDER BY count DESC`,
    )
    .all(userId, ...cs.args)) as CrmReports['contactsByLifecycle'];

  const activitiesByType = (await db
    .prepare(
      `SELECT a.type, COUNT(*) AS count
       FROM crm_activities a
       WHERE a.user_id = ?${as.sql}
       GROUP BY a.type
       ORDER BY count DESC`,
    )
    .all(userId, ...as.args)) as CrmReports['activitiesByType'];

  const avg = (await db
    .prepare(
      `SELECT AVG(julianday(d.closed_at) - julianday(d.created_at)) AS days
       FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND s.is_won = 1 AND d.closed_at IS NOT NULL${ds.sql}`,
    )
    .get(userId, ...ds.args)) as { days: number | null };

  const dealsByPriority = (await db
    .prepare(
      `SELECT d.priority AS priority, COUNT(*) AS count, COALESCE(SUM(${baseAmountSql('d')}), 0) AS amount
       FROM crm_deals d
       WHERE d.user_id = ?${ds.sql}
       GROUP BY d.priority
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END`,
    )
    .all(userId, ...ds.args)) as CrmReports['dealsByPriority'];

  const lostReasons = (await db
    .prepare(
      `SELECT COALESCE(NULLIF(d.lost_reason, ''), 'other') AS reason, COUNT(*) AS count
       FROM crm_deals d
       JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND s.is_lost = 1${ds.sql}
       GROUP BY 1
       ORDER BY count DESC`,
    )
    .all(userId, ...ds.args)) as CrmReports['lostReasons'];

  const tasksByStatus = (await db
    .prepare(
      `SELECT CASE WHEN a.done = 1 THEN 'done' ELSE 'pending' END AS status,
         COUNT(*) AS count
       FROM crm_activities a
       WHERE a.user_id = ? AND a.type = 'task'${as.sql}
       GROUP BY status`,
    )
    .all(userId, ...as.args)) as CrmReports['tasksByStatus'];

  return {
    funnel: await funnelForPipeline(userId, pipelineId, ownerScope),
    forecastByStage,
    wonLostByMonth: await wonLostByMonth(userId, ownerScope),
    dealsBySource,
    contactsByLifecycle,
    activitiesByType,
    dealsByPriority,
    lostReasons,
    avgDaysToClose: avg.days === null ? null : Math.round(avg.days * 10) / 10,
    tasksByStatus,
  };
}

// ============================================================
// SEARCH
// ============================================================

export interface SearchResults {
  contacts: CrmContactRow[];
  companies: CrmCompanyRow[];
  deals: CrmDealRow[];
}

/** Búsqueda global: top 5 por entidad (respeta la visibilidad por owner). */
export async function searchAll(userId: string, q: string, ownerScope?: OwnerScope): Promise<SearchResults> {
  const db = getDb();
  const like = `%${escapeLike(q)}%`;
  const cs = scopeAnd('c', ownerScope);
  const cos = scopeAnd('co', ownerScope);
  const ds = scopeAnd('d', ownerScope);
  const contacts = (await db
    .prepare(
      `SELECT c.* FROM crm_contacts c
       WHERE c.user_id = ? AND (${CONTACT_FULL_NAME} LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\')${cs.sql}
       ORDER BY c.created_at DESC
       LIMIT 5`,
    )
    .all(userId, like, like, ...cs.args)) as CrmContactRow[];
  const companies = (await db
    .prepare(
      `SELECT co.* FROM crm_companies co
       WHERE co.user_id = ? AND (co.name LIKE ? ESCAPE '\\' OR co.domain LIKE ? ESCAPE '\\')${cos.sql}
       ORDER BY co.created_at DESC
       LIMIT 5`,
    )
    .all(userId, like, like, ...cos.args)) as CrmCompanyRow[];
  const deals = (await db
    .prepare(
      `SELECT d.* FROM crm_deals d
       WHERE d.user_id = ? AND d.name LIKE ? ESCAPE '\\'${ds.sql}
       ORDER BY d.created_at DESC
       LIMIT 5`,
    )
    .all(userId, like, ...ds.args)) as CrmDealRow[];
  return { contacts, companies, deals };
}

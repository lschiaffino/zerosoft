/**
 * Datos propios del workspace como tablas de solo lectura para Analytics.
 *
 * Cada tabla virtual es una CTE armada acá: filtra por workspace, aplica los
 * permisos de quien mira (apps que usa, visibilidad del CRM, proyectos de
 * Track, rol de Books, chats de Groups) y tiene tope de filas. La consulta de
 * la persona corre encima de esas CTEs (lib/bi/zs-run.ts) y solo puede nombrar
 * estas tablas (lib/analytics/sql-safe.ts con la config de abajo).
 */
import { getDb } from '../db';
import { ownerScopeFor, ownerScopeSql } from '../crm-visibility';
import { trackVisibleSql } from '../track-access';
import { groupsViewer, chatAccessSql } from '../groups-access';
import { booksActor } from '../books';
import { can } from '../books-roles';
import { joinKeySet } from '../analytics/sql-safe';
import { viewerCan, type BiViewer } from './access';
import type { ColumnType, SchemaTable } from './types';

/** Filas que cada tabla puede tener como mucho (las más nuevas). */
export const ZS_TABLE_ROW_CAP = 50_000;
/** Ventana de los eventos de Pulse. */
export const ZS_EVENTS_DAYS = 90;

type Ctx = {
  viewer: BiViewer;
  crmScope: string[] | null;
  booksInvoices: boolean;
  booksBills: boolean;
  groupsAccess: { sql: string; args: string[] } | null;
  groupsMask: boolean;
  now: number;
};

interface ZsTableDef {
  name: string;
  app: 'crm' | 'track' | 'books' | 'groups' | 'pulse';
  columns: Array<[string, ColumnType]>;
  /** null si quien mira no puede ver la tabla. */
  cte(ctx: Ctx): { sql: string; args: unknown[] } | null;
}

const crmWhere = (alias: string, ctx: Ctx) => {
  const s = ownerScopeSql(alias, ctx.crmScope);
  return s.sql ? { sql: ` AND ${s.sql}`, args: s.args } : { sql: '', args: [] as string[] };
};

const TABLES: ZsTableDef[] = [
  {
    name: 'contacts',
    app: 'crm',
    columns: [
      ['id', 'text'], ['first_name', 'text'], ['last_name', 'text'], ['email', 'text'], ['phone', 'text'], ['job_title', 'text'],
      ['city', 'text'], ['country', 'text'], ['lifecycle_stage', 'text'], ['lead_status', 'text'], ['source', 'text'],
      ['company_id', 'text'], ['owner_id', 'text'], ['score', 'number'], ['created_at', 'date'], ['updated_at', 'date'],
    ],
    cte(ctx) {
      const w = crmWhere('c', ctx);
      return {
        sql: `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.job_title, c.city, c.country, c.lifecycle_stage, c.lead_status, c.source,
          c.company_id, COALESCE(c.owner_id, c.user_id) AS owner_id, c.score, datetime(c.created_at) AS created_at, datetime(c.updated_at) AS updated_at
          FROM crm_contacts c WHERE c.user_id = ?${w.sql} ORDER BY c.created_at DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId, ...w.args],
      };
    },
  },
  {
    name: 'companies',
    app: 'crm',
    columns: [
      ['id', 'text'], ['name', 'text'], ['domain', 'text'], ['industry', 'text'], ['employees', 'number'], ['city', 'text'], ['country', 'text'],
      ['lifecycle_stage', 'text'], ['owner_id', 'text'], ['created_at', 'date'],
    ],
    cte(ctx) {
      const w = crmWhere('c', ctx);
      return {
        sql: `SELECT c.id, c.name, c.domain, c.industry, c.employees, c.city, c.country, c.lifecycle_stage, COALESCE(c.owner_id, c.user_id) AS owner_id,
          datetime(c.created_at) AS created_at FROM crm_companies c WHERE c.user_id = ?${w.sql} ORDER BY c.created_at DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId, ...w.args],
      };
    },
  },
  {
    name: 'deals',
    app: 'crm',
    columns: [
      ['id', 'text'], ['name', 'text'], ['amount', 'number'], ['currency', 'text'], ['pipeline', 'text'], ['stage', 'text'], ['status', 'text'],
      ['priority', 'text'], ['source', 'text'], ['owner_id', 'text'], ['close_date', 'date'], ['closed_at', 'date'], ['created_at', 'date'],
    ],
    cte(ctx) {
      const w = crmWhere('d', ctx);
      return {
        sql: `SELECT d.id, d.name, d.amount, d.currency, p.name AS pipeline, s.name AS stage,
          CASE WHEN s.is_won = 1 THEN 'won' WHEN s.is_lost = 1 THEN 'lost' ELSE 'open' END AS status,
          d.priority, d.source, COALESCE(d.owner_id, d.user_id) AS owner_id, d.close_date, datetime(d.closed_at) AS closed_at, datetime(d.created_at) AS created_at
          FROM crm_deals d LEFT JOIN crm_pipelines p ON p.id = d.pipeline_id LEFT JOIN crm_stages s ON s.id = d.stage_id
          WHERE d.user_id = ?${w.sql} ORDER BY d.created_at DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId, ...w.args],
      };
    },
  },
  {
    name: 'projects',
    app: 'track',
    columns: [['id', 'text'], ['name', 'text'], ['status', 'text'], ['created_at', 'date']],
    cte(ctx) {
      const v = trackVisibleSql('p', ctx.viewer.personId);
      return {
        sql: `SELECT p.id, p.name, p.status, datetime(p.created_at) AS created_at FROM track_projects p
          WHERE COALESCE(p.team_id, p.owner_id) = ? AND ${v.sql} ORDER BY p.created_at DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId, ...v.args],
      };
    },
  },
  {
    name: 'issues',
    app: 'track',
    columns: [
      ['id', 'text'], ['identifier', 'text'], ['title', 'text'], ['project_id', 'text'], ['status', 'text'], ['status_category', 'text'],
      ['priority', 'number'], ['assignee_id', 'text'], ['estimate', 'number'], ['due_date', 'date'], ['created_at', 'date'], ['updated_at', 'date'],
    ],
    cte(ctx) {
      const v = trackVisibleSql('p', ctx.viewer.personId);
      return {
        sql: `SELECT i.id, i.identifier, i.title, i.project_id, st.name AS status, st.category AS status_category, i.priority, i.assignee_id, i.estimate,
          i.due_date, datetime(i.created_at) AS created_at, datetime(i.updated_at) AS updated_at
          FROM track_issues i JOIN track_projects p ON p.id = i.project_id LEFT JOIN track_statuses st ON st.id = i.status_id
          WHERE COALESCE(p.team_id, p.owner_id) = ? AND i.archived_at IS NULL AND ${v.sql} ORDER BY i.created_at DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId, ...v.args],
      };
    },
  },
  {
    name: 'invoices',
    app: 'books',
    columns: [
      ['id', 'text'], ['type', 'text'], ['number', 'text'], ['status', 'text'], ['customer', 'text'], ['issue_date', 'date'], ['due_date', 'date'],
      ['currency', 'text'], ['subtotal', 'number'], ['tax', 'number'], ['total', 'number'], ['paid', 'number'], ['balance', 'number'],
    ],
    cte(ctx) {
      const types = [ctx.booksInvoices ? "'invoice','credit_note'" : '', ctx.booksBills ? "'bill'" : ''].filter(Boolean).join(',');
      if (!types) return null;
      return {
        sql: `SELECT d.id, d.doc_type AS type, d.number_label AS number, d.status, bc.name AS customer, d.issue_date, d.due_date, d.currency,
          d.subtotal / 100.0 AS subtotal, d.tax_total / 100.0 AS tax, d.total / 100.0 AS total, d.paid_total / 100.0 AS paid,
          (d.total - d.paid_total - COALESCE(d.credited_total, 0)) / 100.0 AS balance
          FROM books_documents d LEFT JOIN books_contacts bc ON bc.id = d.contact_id
          WHERE d.workspace_id = ? AND d.doc_type IN (${types}) ORDER BY d.issue_date DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId],
      };
    },
  },
  {
    name: 'chats',
    app: 'groups',
    columns: [
      ['id', 'text'], ['line', 'text'], ['kind', 'text'], ['name', 'text'], ['phone', 'text'], ['status', 'text'], ['assigned_to', 'text'],
      ['unread', 'number'], ['last_message_at', 'date'], ['created_at', 'date'],
    ],
    cte(ctx) {
      const a = ctx.groupsAccess;
      return {
        sql: `SELECT c.id, n.name AS line, c.kind, c.name, ${ctx.groupsMask ? 'NULL' : 'c.phone'} AS phone, c.status, c.assigned_to, c.unread_count AS unread,
          datetime(c.last_message_at) AS last_message_at, datetime(c.created_at) AS created_at
          FROM groups_chats c LEFT JOIN groups_numbers n ON n.id = c.number_id
          WHERE c.user_id = ?${a ? ` AND ${a.sql}` : ''} ORDER BY c.last_message_at DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId, ...(a?.args ?? [])],
      };
    },
  },
  {
    name: 'messages',
    app: 'groups',
    columns: [
      ['id', 'text'], ['chat_id', 'text'], ['direction', 'text'], ['sender_name', 'text'], ['author_id', 'text'], ['body', 'text'],
      ['media_type', 'text'], ['status', 'text'], ['created_at', 'date'],
    ],
    cte(ctx) {
      const a = ctx.groupsAccess;
      return {
        sql: `SELECT m.id, m.chat_id, m.direction, m.sender_name, m.author_id, m.body, m.media_type, m.status, datetime(m.created_at) AS created_at
          FROM groups_messages m${a ? ' JOIN groups_chats c ON c.id = m.chat_id' : ''}
          WHERE m.user_id = ? AND m.deleted_at IS NULL${a ? ` AND ${a.sql}` : ''} ORDER BY m.created_at DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId, ...(a?.args ?? [])],
      };
    },
  },
  {
    name: 'events',
    app: 'pulse',
    columns: [
      ['project', 'text'], ['event', 'text'], ['distinct_id', 'text'], ['time', 'date'], ['session_id', 'text'], ['pathname', 'text'],
      ['referring_domain', 'text'], ['utm_source', 'text'], ['utm_campaign', 'text'], ['browser', 'text'], ['os', 'text'], ['device_type', 'text'],
      ['country', 'text'],
    ],
    cte(ctx) {
      return {
        sql: `SELECT p.name AS project, e.event, e.distinct_id, datetime(e.ts / 1000, 'unixepoch') AS time, e.session_id, e.pathname, e.referring_domain,
          e.utm_source, e.utm_campaign, e.browser, e.os, e.device AS device_type, e.country
          FROM analytics_events e JOIN analytics_projects p ON p.id = e.project_id
          WHERE p.workspace_id = ? AND e.ts >= CAST(? AS INTEGER) ORDER BY e.ts DESC LIMIT ${ZS_TABLE_ROW_CAP}`,
        args: [ctx.viewer.workspaceId, String(ctx.now - ZS_EVENTS_DAYS * 86_400_000)],
      };
    },
  },
];

export const ZS_TABLE_NAMES = TABLES.map((t) => t.name);

/** Uniones permitidas entre tablas propias (nunca multiplican más que la tabla grande). */
export const ZS_JOINS: ReadonlyArray<readonly [string, string]> = [
  ['contacts.company_id', 'companies.id'],
  ['issues.project_id', 'projects.id'],
  ['messages.chat_id', 'chats.id'],
];
export const ZS_GUARD = { virtual: ZS_TABLE_NAMES, joinKeys: joinKeySet(ZS_JOINS), maxRefs: 3 };

async function context(viewer: BiViewer, now: number): Promise<Ctx> {
  const crm = viewerCan(viewer, 'crm');
  const books = viewerCan(viewer, 'books');
  const groups = viewerCan(viewer, 'groups');
  const crmScope = crm ? await ownerScopeFor({ workspaceId: viewer.workspaceId, personId: viewer.personId, role: viewer.role }, getDb()) : [];
  let booksInvoices = false;
  let booksBills = false;
  if (books) {
    const actor = await booksActor({ ws: viewer.workspaceId, person: viewer.personId, workspaceRole: viewer.personId === viewer.workspaceId ? 'owner' : viewer.role });
    booksInvoices = can(actor.role, 'invoices.read');
    booksBills = can(actor.role, 'bills.read');
  }
  let groupsAccess: Ctx['groupsAccess'] = null;
  let groupsMask = false;
  if (groups) {
    const gv = await groupsViewer(viewer.workspaceId, viewer.personId, viewer.role);
    groupsAccess = chatAccessSql(gv, 'c');
    groupsMask = gv.mask;
  }
  return { viewer, crmScope, booksInvoices, booksBills, groupsAccess, groupsMask, now };
}

function tableVisible(t: ZsTableDef, viewer: BiViewer): boolean {
  return viewerCan(viewer, t.app);
}

/** Tablas que la persona puede consultar, con sus columnas (navegador de esquema). */
export async function zsSchema(viewer: BiViewer): Promise<SchemaTable[]> {
  const ctx = await context(viewer, Date.now());
  return TABLES.filter((t) => tableVisible(t, viewer) && t.cte(ctx)).map((t) => ({
    name: t.name,
    app: t.app,
    columns: t.columns.map(([name, type]) => ({ name, type })),
  }));
}

/**
 * Cláusula WITH con las tablas que nombra la consulta. Las que la persona no
 * puede ver quedan como CTE vacía con las mismas columnas: la consulta sigue
 * siendo válida y no devuelve nada de ahí.
 */
export async function zsCtes(viewer: BiViewer, usedTables: Iterable<string>, now = Date.now()): Promise<{ sql: string; args: unknown[] }> {
  const want = new Set([...usedTables].map((t) => t.toLowerCase()));
  const defs = TABLES.filter((t) => want.has(t.name));
  if (!defs.length) return { sql: '', args: [] };
  const ctx = await context(viewer, now);
  const parts: string[] = [];
  const args: unknown[] = [];
  for (const t of defs) {
    const built = tableVisible(t, viewer) ? t.cte(ctx) : null;
    if (built) {
      parts.push(`${t.name} AS (${built.sql})`);
      args.push(...built.args);
    } else {
      parts.push(`${t.name} AS (SELECT ${t.columns.map(([c]) => `NULL AS ${c}`).join(', ')} WHERE 0)`);
    }
  }
  return { sql: `WITH ${parts.join(',\n')}`, args };
}

export function zsTableColumns(name: string): Array<[string, ColumnType]> | null {
  return TABLES.find((t) => t.name === name)?.columns ?? null;
}

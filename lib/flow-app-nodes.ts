/**
 * Flow — nodos que escriben en las apps: CRM (actualizar contacto, empresa
 * o deal; crear tarea) y Track (actualizar issue). Reusan las mismas
 * funciones que la app (lib/crm.ts, lib/track-data.ts), que filtran por
 * workspace y validan referencias: un flow solo toca registros de su
 * workspace y no puede apuntar a datos de otro. Server-only.
 */
import { getDb } from './db';
import { StepError } from './flow-errors';
import { CRM_UPDATE_FIELDS, type CrmUpdateEntity } from './flow-schema';
import { renderString, renderValue, stringify, toDate } from './flow-template';

type Cfg = Record<string, unknown>;
type Ctx = Record<string, unknown>;

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function text(cfg: Cfg, key: string, tctx: Ctx): string {
  return renderString(cfg[key] ?? '', tctx).trim();
}

/** Formato de fechas del CRM en la base: 'YYYY-MM-DD HH:MM:SS' en UTC. */
function dbDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Persona del workspace por id o email (owner de un registro, assignee). null si vacío. */
async function workspacePerson(ws: string, raw: string, error: string): Promise<string | null> {
  if (!raw) return null;
  let id = raw;
  if (raw.includes('@')) {
    const row = (await getDb().prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').get(raw.toLowerCase())) as
      | { id: string }
      | undefined;
    if (!row) throw new StepError(error);
    id = row.id;
  }
  const { isWorkspacePerson } = await import('./crm-refs');
  if (!(await isWorkspacePerson(ws, id))) throw new StepError(error);
  return id;
}

async function crmCall<T>(fn: () => Promise<T>): Promise<T> {
  const { CrmRefError } = await import('./crm-refs');
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CrmRefError) throw new StepError(err.code);
    throw err;
  }
}

// ---------- CRM: actualizar registro ----------

const CRM_TABLES: Record<CrmUpdateEntity, string> = { contact: 'crm_contacts', company: 'crm_companies', deal: 'crm_deals' };

/** first_name → firstName; owner → ownerId; company → companyId. */
export function crmFieldKey(raw: string): string {
  const camel = raw.trim().replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  if (camel === 'owner' || camel === 'ownerEmail') return 'ownerId';
  if (camel === 'company') return 'companyId';
  return camel;
}

/** Fila para la salida del nodo: sin user_id y con custom como objeto. */
function recordOutput(row: Record<string, unknown>): Record<string, unknown> {
  const { user_id: _ws, ...rest } = row;
  void _ws;
  if (typeof rest.custom === 'string') {
    try {
      rest.custom = JSON.parse(rest.custom);
    } catch {
      rest.custom = {};
    }
  }
  return rest;
}

/**
 * Actualiza un contacto, empresa o deal del workspace. Las propiedades van en
 * `fields` (firstName o first_name, amount, custom.plan…); en deals, `stage`
 * (nombre o id de una etapa de su pipeline) lo mueve con moveDeal, igual que
 * el tablero. Los contactos sin id se buscan por email.
 */
export async function crmUpdateNode(ws: string, cfg: Cfg, tctx: Ctx, actorEmail = '') {
  const entity: CrmUpdateEntity = cfg.entity === 'company' || cfg.entity === 'deal' ? cfg.entity : 'contact';
  const db = getDb();
  let id = text(cfg, 'recordId', tctx);
  if (!id && entity === 'contact') {
    const email = text(cfg, 'email', tctx).toLowerCase();
    if (email) {
      if (!EMAIL_RE.test(email)) throw new StepError('invalid_email');
      const row = (await db
        .prepare('SELECT id FROM crm_contacts WHERE user_id = ? AND lower(email) = ? LIMIT 1')
        .get(ws, email)) as { id: string } | undefined;
      if (!row) throw new StepError('record_not_found');
      id = row.id;
    }
  }
  if (!id) throw new StepError('missing_record');
  const table = CRM_TABLES[entity];
  const existing = (await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, ws)) as
    | Record<string, unknown>
    | undefined;
  if (!existing) throw new StepError('record_not_found');

  const allowed = CRM_UPDATE_FIELDS[entity] as readonly string[];
  const patch: Record<string, unknown> = {};
  let custom: Record<string, unknown> | null = null;
  for (const f of Array.isArray(cfg.fields) ? (cfg.fields as Array<{ key?: string; value?: unknown }>) : []) {
    const rawKey = String(f?.key ?? '').trim();
    if (!rawKey) continue;
    const value = renderValue(f?.value ?? '', tctx);
    if (rawKey.startsWith('custom.')) {
      const sub = rawKey.slice(7).trim();
      if (!sub || sub === '__proto__' || sub === 'constructor' || sub === 'prototype') throw new StepError('unknown_property');
      if (!custom) {
        try {
          custom = JSON.parse(String(existing.custom ?? '{}')) as Record<string, unknown>;
        } catch {
          custom = {};
        }
      }
      custom[sub] = value;
      continue;
    }
    const key = crmFieldKey(rawKey);
    if (!allowed.includes(key)) throw new StepError(`unknown_property (${rawKey.slice(0, 40)})`);
    const str = stringify(value).trim();
    if (key === 'amount' || key === 'employees') {
      if (str === '' && key === 'employees') patch[key] = null;
      else {
        const n = Number(str.replace(/,/g, ''));
        if (!Number.isFinite(n)) throw new StepError(`invalid_value (${key})`);
        patch[key] = n;
      }
    } else if (key === 'ownerId') {
      patch[key] = await workspacePerson(ws, str, 'invalid_owner');
    } else if (key === 'companyId') {
      patch[key] = str || null;
    } else if (key === 'closeDate') {
      const d = str ? toDate(str) : null;
      if (str && !d) throw new StepError('invalid_date');
      patch[key] = d ? d.toISOString().slice(0, 10) : null;
    } else if (key === 'email') {
      if (str && !EMAIL_RE.test(str)) throw new StepError('invalid_email');
      patch[key] = str.toLowerCase();
    } else {
      patch[key] = str.slice(0, 5000);
    }
  }
  if (custom) patch.custom = custom;

  const stage = entity === 'deal' ? text(cfg, 'stage', tctx) : '';
  if (Object.keys(patch).length === 0 && !stage) throw new StepError('missing_fields');

  const crm = await import('./crm');
  if (Object.keys(patch).length > 0) {
    await crmCall<unknown>(() =>
      entity === 'contact'
        ? crm.updateContact(ws, id, patch, undefined, actorEmail)
        : entity === 'company'
          ? crm.updateCompany(ws, id, patch, undefined, actorEmail)
          : crm.updateDeal(ws, id, patch, actorEmail),
    );
  }
  let stageName: string | null = null;
  if (stage) {
    const row = (await db
      .prepare('SELECT id, name FROM crm_stages WHERE pipeline_id = ? AND (id = ? OR lower(name) = ?) LIMIT 1')
      .get(String(existing.pipeline_id ?? ''), stage, stage.toLowerCase())) as { id: string; name: string } | undefined;
    if (!row) throw new StepError('invalid_stage');
    const moved = await crm.moveDeal(ws, id, row.id, null, undefined, actorEmail);
    if (!moved.ok) throw new StepError(moved.reason, false, moved.reason === 'missing_required' ? { missing: moved.missing } : undefined);
    stageName = row.name;
  }
  const updated = (await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)) as Record<string, unknown>;
  return {
    entity,
    id,
    changed: [...Object.keys(patch), ...(stage ? ['stage'] : [])],
    ...(stageName ? { stage: stageName } : {}),
    record: recordOutput(updated),
  };
}

// ---------- CRM: crear tarea ----------

/** Contacto por id o email (del workspace). */
async function contactRef(ws: string, raw: string): Promise<string | null> {
  if (!raw) return null;
  if (!raw.includes('@')) return raw;
  const row = (await getDb()
    .prepare('SELECT id FROM crm_contacts WHERE user_id = ? AND lower(email) = ? LIMIT 1')
    .get(ws, raw.toLowerCase())) as { id: string } | undefined;
  if (!row) throw new StepError('invalid_contact');
  return row.id;
}

/** Crea una tarea del CRM (vence en N horas o días), asociada a contacto, deal o empresa. */
export async function crmTaskNode(ws: string, cfg: Cfg, tctx: Ctx, now = new Date()) {
  const subject = text(cfg, 'subject', tctx).slice(0, 300);
  if (!subject) throw new StepError('missing_subject');
  const amount = Number(cfg.dueIn);
  const unitMs = cfg.dueUnit === 'hours' ? 3_600_000 : 86_400_000;
  const dueIn = Number.isFinite(amount) ? Math.min(Math.max(amount, 0), 3650) : 1;
  const dueAt = dbDate(new Date(now.getTime() + dueIn * unitMs));
  const contactId = await contactRef(ws, text(cfg, 'contactId', tctx));
  const ownerId = await workspacePerson(ws, text(cfg, 'owner', tctx), 'invalid_owner');
  const { createActivity } = await import('./crm');
  const task = await crmCall(() =>
    createActivity(ws, {
      type: 'task',
      subject,
      body: renderString(cfg.body ?? '', tctx).slice(0, 20_000),
      dueAt,
      ownerId,
      contactId,
      dealId: text(cfg, 'dealId', tctx) || null,
      companyId: text(cfg, 'companyId', tctx) || null,
    }),
  );
  return {
    task: {
      id: task.id,
      subject: task.subject,
      dueAt: task.due_at,
      ownerId: task.owner_id,
      contactId: task.contact_id,
      dealId: task.deal_id,
      companyId: task.company_id,
    },
  };
}

// ---------- Track: actualizar issue ----------

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/**
 * Actualiza un issue de Track del workspace (por id o identificador ENG-12):
 * status (nombre o id), prioridad, assignee (email o id; 'none' lo quita),
 * título, vencimiento y un comentario. Mismas validaciones que la API.
 */
export async function trackUpdateNode(ws: string, actorId: string, cfg: Cfg, tctx: Ctx) {
  const ref = text(cfg, 'issue', tctx);
  if (!ref) throw new StepError('missing_issue');
  const db = getDb();
  const track = await import('./track-data');
  let issueId = ref;
  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(ref)) {
    const row = (await db
      .prepare(
        `SELECT i.id FROM track_issues i JOIN track_projects p ON p.id = i.project_id
         WHERE p.owner_id = ? AND i.identifier = ? LIMIT 1`,
      )
      .get(ws, ref.toUpperCase())) as { id: string } | undefined;
    if (row) issueId = row.id;
  }
  const issue = await track.getIssue(issueId);
  const project = issue ? await track.getProject(issue.project_id) : undefined;
  if (!issue || !project || project.owner_id !== ws) throw new StepError('issue_not_found');

  const payload: Record<string, unknown> = {};
  const status = text(cfg, 'status', tctx);
  if (status) {
    const statuses = await track.listStatuses(project.id);
    const match = statuses.find((s) => s.id === status) ?? statuses.find((s) => s.name.toLowerCase() === status.toLowerCase());
    if (!match) throw new StepError('invalid_status');
    payload.statusId = match.id;
  }
  const priority = String(cfg.priority ?? '');
  if ((PRIORITIES as readonly string[]).includes(priority)) payload.priority = priority;
  const assignee = text(cfg, 'assignee', tctx);
  if (assignee) {
    if (assignee.toLowerCase() === 'none') payload.assigneeId = null;
    else {
      let id = assignee;
      if (assignee.includes('@')) {
        const row = (await db.prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').get(assignee.toLowerCase())) as
          | { id: string }
          | undefined;
        if (!row) throw new StepError('invalid_assignee');
        id = row.id;
      }
      payload.assigneeId = id;
    }
  }
  const title = text(cfg, 'title', tctx).slice(0, 300);
  if (title) payload.title = title;
  const due = text(cfg, 'dueDate', tctx);
  if (due) {
    if (due.toLowerCase() === 'none') payload.dueDate = null;
    else {
      const d = toDate(due);
      if (!d) throw new StepError('invalid_date');
      payload.dueDate = d.toISOString().slice(0, 10);
    }
  }
  const comment = renderString(cfg.comment ?? '', tctx).trim().slice(0, 20_000);
  if (Object.keys(payload).length === 0 && !comment) throw new StepError('missing_fields');

  const { claimTriage, validateIssueRefs } = await import('./track-bulk');
  const invalid = await validateIssueRefs(
    project,
    { statusId: payload.statusId as string | undefined, assigneeId: payload.assigneeId as string | null | undefined },
    { ownerId: ws, issueId: issue.id },
  );
  if (invalid) throw new StepError(invalid);
  let current = issue;
  if (Object.keys(payload).length > 0) {
    // Igual que la API: mover o asignar un issue en triage lo acepta.
    if (issue.triage && (payload.statusId !== undefined || payload.assigneeId !== undefined)) await claimTriage(issue.id);
    current = (await track.updateIssue(issue.id, payload, actorId)) ?? issue;
  }
  let commentId: string | null = null;
  if (comment) commentId = (await track.createIssueComment(issue.id, actorId, { body: comment })).id;
  return {
    issue: {
      id: current.id,
      identifier: current.identifier,
      title: current.title,
      status: current.status_name,
      priority: current.priority,
      assigneeId: current.assignee_id,
      dueDate: current.due_date,
    },
    project: { id: project.id, name: project.name },
    changed: Object.keys(payload),
    commentId,
  };
}

// ---------- Docs: páginas y filas ----------

/** Errores de lib/docs-platform.ts como errores del paso ("unknown_property:Plan" → "unknown_property (Plan)"). */
async function docsCall<T>(fn: () => Promise<T>): Promise<T> {
  const { DocsPlatformError } = await import('./docs-platform');
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DocsPlatformError) {
      const [code, detail] = err.code.split(':');
      throw new StepError(detail ? `${code} (${detail.slice(0, 40)})` : code);
    }
    throw err;
  }
}

async function flowDocsActor(ws: string, actorId: string) {
  const { docsActorFor } = await import('./docs-platform-access');
  const actor = await docsActorFor(ws, actorId);
  if (!actor) throw new StepError('no_flow_owner');
  return actor;
}

/** Variables de la plantilla: los datos del trigger aplanados (trigger.page.title → "page.title" y "trigger.page.title"). */
export function templateVars(tctx: Ctx): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (v: unknown, path: string, depth: number) => {
    if (Object.keys(out).length >= 200 || depth > 4) return;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    } else if (path) out[path] = stringify(v);
  };
  walk(tctx.trigger, '', 0);
  for (const [k, v] of Object.entries({ ...out })) out[`trigger.${k}`] = v;
  out.today = new Date().toISOString().slice(0, 10);
  return out;
}

/**
 * Docs: crea una página (con plantilla y como subpágina de otra), le agrega
 * o reemplaza el contenido (Markdown), la renombra o la manda a la papelera.
 * Actúa con los permisos de quien creó el flow.
 */
export async function docsPageFlowNode(ws: string, actorId: string, cfg: Cfg, tctx: Ctx) {
  const op = String(cfg.operation || 'page_create');
  const platform = await import('./docs-platform');
  const actor = await flowDocsActor(ws, actorId);
  const content = renderString(cfg.content ?? '', tctx);
  const title = text(cfg, 'title', tctx).slice(0, 300);
  const out = (p: { id: string; title: string; url: string; parentId: string | null }) => ({ page: { id: p.id, title: p.title, url: p.url, parentId: p.parentId } });
  if (op === 'page_create') {
    const templateId = String(cfg.templateId ?? '').trim();
    const page = await docsCall(() =>
      platform.createPage(actor, {
        title,
        parentId: text(cfg, 'parentId', tctx) || null,
        markdown: content,
        templateId: templateId || null,
        vars: templateId ? templateVars(tctx) : undefined,
        ownedByActor: true,
      }),
    );
    return out(page);
  }
  const pageId = text(cfg, 'pageId', tctx);
  if (!pageId) throw new StepError('missing_page');
  if (op === 'page_append' || op === 'page_replace') {
    if (!content.trim()) throw new StepError('missing_content');
    const page = await docsCall(() => platform.updatePage(actor, pageId, op === 'page_append' ? { appendMarkdown: content } : { markdown: content }));
    return out(page);
  }
  if (op === 'page_rename') {
    if (!title) throw new StepError('missing_title');
    return out(await docsCall(() => platform.updatePage(actor, pageId, { title })));
  }
  if (op === 'page_archive') return { ...out(await docsCall(() => platform.updatePage(actor, pageId, { archived: true }))), archived: true };
  throw new StepError('invalid_operation');
}

export function databaseRef(raw: string): { pageId: string; blockId: string } {
  const [pageId, blockId] = raw.split('/');
  if (!pageId?.trim() || !blockId?.trim()) throw new StepError('missing_database');
  return { pageId: pageId.trim(), blockId: blockId.trim() };
}

/** Docs: agrega una fila a una base (con plantilla de fila) o cambia una (por id o por título). */
export async function docsRowFlowNode(ws: string, actorId: string, cfg: Cfg, tctx: Ctx) {
  const op = String(cfg.operation || 'row_create');
  const { pageId, blockId } = databaseRef(String(cfg.database ?? ''));
  const platform = await import('./docs-platform');
  const actor = await flowDocsActor(ws, actorId);
  const values: Record<string, unknown> = {};
  for (const f of Array.isArray(cfg.values) ? (cfg.values as Array<{ key?: string; value?: unknown }>) : []) {
    const key = String(f?.key ?? '').trim();
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    values[key] = renderValue(f?.value ?? '', tctx);
  }
  const title = text(cfg, 'title', tctx);
  const content = renderString(cfg.content ?? '', tctx);
  const rowOut = (r: { id: string; title: string; url: string; properties: Record<string, string> }) => ({
    row: { id: r.id, title: r.title, url: r.url, properties: r.properties },
    database: { pageId, blockId },
  });
  if (op === 'row_create') {
    const template = String(cfg.template ?? '').trim();
    const row = await docsCall(() => platform.createRow(actor, pageId, blockId, { title, values, markdown: content || undefined, template: template || undefined }));
    return { ...rowOut(row), created: true };
  }
  let rowId = text(cfg, 'rowId', tctx);
  const byTitle = !rowId;
  if (byTitle) {
    if (!title) throw new StepError('missing_row');
    rowId = (await docsCall(() => platform.findRowByTitle(actor, pageId, blockId, title))) ?? '';
    if (!rowId) throw new StepError('row_not_found');
  }
  const newTitle = text(cfg, 'newTitle', tctx) || (!byTitle ? title : '');
  const row = await docsCall(() =>
    platform.updateRow(actor, pageId, blockId, rowId, {
      values,
      ...(newTitle ? { title: newTitle } : {}),
      ...(content.trim() ? { appendMarkdown: content } : {}),
    }),
  );
  return { ...rowOut(row), created: false };
}

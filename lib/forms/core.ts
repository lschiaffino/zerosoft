/**
 * Forms: formularios (crear, leer, editar, publicar, borrar) y el acceso por
 * formulario. Server-only.
 *
 * Acceso: owner y admins ven todos; el resto ve los compartidos con todo el
 * workspace, los que creó y aquellos donde lo sumaron (forms_members). Sin
 * acceso a un formulario, nadie ve sus respuestas ni sus archivos (la app,
 * ⌘K, el asistente, la API y los avisos usan esta misma regla). La app en sí
 * (team_members.apps) la chequea la capa HTTP antes de llegar acá.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db';
import { seal, open } from '../secret-box';
import { listOwnerSpacePeople } from '../workspace';
import { checkDefinition, normalizeDefinition, emptyDefinition } from './engine';
import { isTemplateId, templateDefinition } from './templates';
import {
  DEFAULT_SETTINGS,
  FormsError,
  definitionSchema,
  newId,
  settingsSchema,
  type FormDefinition,
  type FormLang,
  type FormSettings,
  type FormStatus,
  type FormsActor,
  type Sharing,
} from './types';

export interface FormRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  status: FormStatus;
  definition: string;
  settings: string;
  sharing: Sharing;
  webhook_secret: string;
  response_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface FormDto {
  id: string;
  name: string;
  slug: string;
  status: FormStatus;
  definition: FormDefinition;
  settings: FormSettings;
  sharing: Sharing;
  members: string[];
  responseCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  /** Abierto para responder ahora (publicado, antes del cierre y del tope). */
  open: boolean;
  closedReason: '' | 'draft' | 'closed' | 'date' | 'limit';
  canDelete: boolean;
  /** Secreto de firma del webhook (solo para quien creó el form o un admin). */
  webhookSecret: string;
}

export interface FormListItem {
  id: string;
  name: string;
  slug: string;
  status: FormStatus;
  responseCount: number;
  partialCount: number;
  lastResponseAt: string | null;
  updatedAt: string;
  sharing: Sharing;
  open: boolean;
}

const now = () => new Date().toISOString();

function parse(raw: string | null | undefined): unknown {
  try {
    return JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
}

export function settingsOf(row: Pick<FormRow, 'settings'>): FormSettings {
  const obj = parse(row.settings);
  const parsed = settingsSchema.partial().safeParse(obj && typeof obj === 'object' ? obj : {});
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export function definitionOf(row: Pick<FormRow, 'definition'>): FormDefinition {
  return normalizeDefinition(parse(row.definition));
}

/** ¿Se puede responder ahora? */
export function openState(row: Pick<FormRow, 'status' | 'response_count'>, s: FormSettings, at = new Date()): FormDto['closedReason'] {
  if (row.status === 'draft') return 'draft';
  if (row.status === 'closed') return 'closed';
  if (s.closeAt && !Number.isNaN(Date.parse(s.closeAt)) && Date.parse(s.closeAt) <= at.getTime()) return 'date';
  if (s.responseLimit > 0 && row.response_count >= s.responseLimit) return 'limit';
  return '';
}

// ---------- Acceso ----------

export async function formMembers(formId: string): Promise<string[]> {
  const rows = (await getDb().prepare('SELECT user_id FROM forms_members WHERE form_id = ? ORDER BY created_at').all(formId)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

/** ¿La persona ve este formulario? (la app ya se chequeó en la capa HTTP). */
export async function canAccess(actor: FormsActor, row: Pick<FormRow, 'id' | 'workspace_id' | 'sharing' | 'created_by'>): Promise<boolean> {
  if (row.workspace_id !== actor.ws) return false;
  if (actor.admin || row.sharing === 'workspace' || row.created_by === actor.person) return true;
  return Boolean(await getDb().prepare('SELECT 1 FROM forms_members WHERE form_id = ? AND user_id = ?').get(row.id, actor.person));
}

/**
 * ¿Esta persona del workspace ve el form? Para avisos, Flow y webhooks: tiene
 * que tener la app Forms y acceso al formulario.
 */
export async function personCanAccess(row: Pick<FormRow, 'id' | 'workspace_id' | 'sharing' | 'created_by'>, personId: string | null): Promise<boolean> {
  if (!personId) return false;
  const people = await listOwnerSpacePeople(row.workspace_id, { app: 'forms' });
  const p = people.find((x) => x.id === personId);
  if (!p) return false;
  return canAccess({ ws: row.workspace_id, person: personId, admin: p.role === 'owner' || p.role === 'admin' }, row);
}

/** SQL de visibilidad para listas y búsquedas (alias f). */
export function visibleSql(actor: FormsActor): { sql: string; args: string[] } {
  if (actor.admin) return { sql: 'f.workspace_id = ?', args: [actor.ws] };
  return {
    sql: "f.workspace_id = ? AND (f.sharing = 'workspace' OR f.created_by = ? OR EXISTS (SELECT 1 FROM forms_members m WHERE m.form_id = f.id AND m.user_id = ?))",
    args: [actor.ws, actor.person, actor.person],
  };
}

export async function getFormRow(ws: string, id: string): Promise<FormRow | null> {
  return ((await getDb().prepare('SELECT * FROM forms_forms WHERE id = ? AND workspace_id = ?').get(id, ws)) as FormRow | undefined) ?? null;
}

/** Fila del formulario si la persona lo ve; si no, null (como si no existiera). */
export async function accessibleRow(actor: FormsActor, id: string): Promise<FormRow | null> {
  const row = await getFormRow(actor.ws, id);
  return row && (await canAccess(actor, row)) ? row : null;
}

async function toDto(actor: FormsActor, row: FormRow): Promise<FormDto> {
  const settings = settingsOf(row);
  const reason = openState(row, settings);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    definition: definitionOf(row),
    settings,
    sharing: row.sharing,
    members: await formMembers(row.id),
    responseCount: row.response_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    open: reason === '',
    closedReason: reason,
    canDelete: actor.admin || row.created_by === actor.person,
    // El secreto de firma solo lo ve quien puede configurar el webhook.
    webhookSecret: row.webhook_secret && (actor.admin || row.created_by === actor.person) ? open(row.webhook_secret) : '',
  };
}

export async function getForm(actor: FormsActor, id: string): Promise<FormDto | null> {
  const row = await accessibleRow(actor, id);
  return row ? toDto(actor, row) : null;
}

export async function listForms(actor: FormsActor, opts: { q?: string; status?: string } = {}): Promise<FormListItem[]> {
  const vis = visibleSql(actor);
  const where = [vis.sql];
  const args: string[] = [...vis.args];
  if (opts.q?.trim()) {
    where.push("f.name LIKE ? ESCAPE '\\'");
    args.push(`%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (opts.status && ['draft', 'published', 'closed'].includes(opts.status)) {
    where.push('f.status = ?');
    args.push(opts.status);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM forms_responses r WHERE r.form_id = f.id AND r.status = 'partial') AS partial_count,
              (SELECT MAX(r.submitted_at) FROM forms_responses r WHERE r.form_id = f.id AND r.status = 'completed') AS last_response_at
       FROM forms_forms f WHERE ${where.join(' AND ')} ORDER BY f.updated_at DESC LIMIT 500`,
    )
    .all(...args)) as Array<FormRow & { partial_count: number; last_response_at: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    responseCount: Number(r.response_count),
    partialCount: Number(r.partial_count),
    lastResponseAt: r.last_response_at,
    updatedAt: r.updated_at,
    sharing: r.sharing,
    open: openState(r, settingsOf(r)) === '',
  }));
}

// ---------- Slug ----------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

/** El slug vive en /f/<slug>, compartido con los formularios del CRM: no puede chocar con ninguno. */
export async function slugTaken(slug: string, exceptId = ''): Promise<boolean> {
  const db = getDb();
  if (await db.prepare('SELECT 1 FROM forms_forms WHERE slug = ? AND id != ?').get(slug, exceptId)) return true;
  return Boolean(await db.prepare('SELECT 1 FROM crm_forms WHERE slug = ? OR token = ?').get(slug, slug));
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'form'
  );
}

async function freshSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 6; i++) {
    const s = `${base}-${randomBytes(3).toString('hex')}`;
    if (!(await slugTaken(s))) return s;
  }
  return `form-${randomBytes(6).toString('hex')}`;
}

// ---------- Escritura ----------

export interface CreateInput {
  name: string;
  template?: string | null;
  lang?: FormLang;
  definition?: FormDefinition;
}

export async function createForm(actor: FormsActor, input: CreateInput): Promise<FormDto> {
  const name = input.name.trim().slice(0, 200) || 'Untitled form';
  const lang = input.lang ?? 'en';
  const def = input.definition ?? (input.template && isTemplateId(input.template) ? templateDefinition(input.template, lang) : emptyDefinition(lang));
  checkDefinition(definitionSchema.parse(def));
  const id = newId('fm_');
  const at = now();
  const defaults = await workspaceDefaults(actor.ws);
  const settings: FormSettings = { ...DEFAULT_SETTINGS, retentionDays: defaults.retentionDays, notifyPeople: [actor.person] };
  await getDb()
    .prepare(
      `INSERT INTO forms_forms (id, workspace_id, name, slug, status, definition, settings, sharing, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, 'workspace', ?, ?, ?)`,
    )
    .run(id, actor.ws, name, await freshSlug(name), JSON.stringify(def), JSON.stringify(settings), actor.person, at, at);
  return (await getForm(actor, id))!;
}

export interface UpdateInput {
  name?: string;
  slug?: string;
  definition?: unknown;
  settings?: Partial<FormSettings>;
  sharing?: Sharing;
  members?: string[];
  status?: FormStatus;
  /** Genera un secreto de firma nuevo para el webhook (quien creó el form o un admin). */
  rotateWebhookSecret?: boolean;
}

/** Ajustes nuevos: valida personas a avisar (con acceso) y que el CRM lo prenda alguien que lo tiene. */
async function cleanSettings(actor: FormsActor, row: FormRow, patch: Partial<FormSettings>, sharing: Sharing, members: string[]): Promise<FormSettings> {
  const merged = settingsSchema.parse({ ...settingsOf(row), ...patch });
  if (patch.notifyPeople) {
    const people = await listOwnerSpacePeople(actor.ws, { app: 'forms' });
    merged.notifyPeople = patch.notifyPeople.filter((pid) => {
      const p = people.find((x) => x.id === pid);
      if (!p) return false;
      return p.role === 'owner' || p.role === 'admin' || sharing === 'workspace' || row.created_by === pid || members.includes(pid);
    });
  }
  const owner = actor.admin || row.created_by === actor.person;
  const before = settingsOf(row);
  // Emails de aviso: personas del workspace que ven el form. Una dirección de
  // afuera solo la agrega quien creó el form o un admin (si no, el form
  // serviría para mandar sus respuestas a cualquier casilla).
  if (patch.notifyEmails) {
    const people = await listOwnerSpacePeople(actor.ws, { app: 'forms' });
    const clean: string[] = [];
    for (const raw of patch.notifyEmails) {
      const email = raw.trim().toLowerCase();
      if (clean.includes(email)) continue;
      const p = people.find((x) => x.email.toLowerCase() === email);
      const insider = p && (p.role === 'owner' || p.role === 'admin' || sharing === 'workspace' || row.created_by === p.id || members.includes(p.id));
      const kept = before.notifyEmails.some((e) => e.toLowerCase() === email);
      if (!insider && !owner && !kept) throw new FormsError('notify_external_forbidden', 403);
      clean.push(email);
    }
    merged.notifyEmails = clean;
  }
  // Webhook: lo configura quien creó el form o un admin.
  if (patch.webhookUrl !== undefined && patch.webhookUrl !== before.webhookUrl && !owner) throw new FormsError('forbidden', 403);
  if (patch.crm?.enabled && !before.crm.enabled && !actor.crm) throw new FormsError('crm_forbidden', 403);
  if (merged.closeAt && Number.isNaN(Date.parse(merged.closeAt))) throw new FormsError('invalid_date');
  return merged;
}

export async function updateForm(actor: FormsActor, id: string, input: UpdateInput): Promise<FormDto | null> {
  const row = await accessibleRow(actor, id);
  if (!row) return null;
  const sets: Array<[string, string | null]> = [];
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 200);
    if (!name) throw new FormsError('name_required');
    sets.push(['name', name]);
  }
  if (input.slug !== undefined && input.slug !== row.slug) {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) throw new FormsError('invalid_slug');
    if (await slugTaken(slug, id)) throw new FormsError('slug_taken', 409);
    sets.push(['slug', slug]);
  }
  if (input.definition !== undefined) {
    const parsed = definitionSchema.safeParse(input.definition);
    if (!parsed.success) throw new FormsError('invalid_definition', 400, { issue: parsed.error.issues[0]?.path.join('.') ?? '' });
    sets.push(['definition', JSON.stringify(checkDefinition(parsed.data))]);
  }
  // Compartir: solo quien creó el form o un admin cambia quién lo ve.
  let sharing = row.sharing;
  let members = await formMembers(id);
  if (input.sharing !== undefined || input.members !== undefined) {
    if (!actor.admin && row.created_by !== actor.person) throw new FormsError('forbidden', 403);
    if (input.sharing) {
      sharing = input.sharing;
      sets.push(['sharing', sharing]);
    }
    if (input.members) {
      const people = await listOwnerSpacePeople(actor.ws, { app: 'forms' });
      members = [...new Set(input.members)].filter((m) => people.some((p) => p.id === m)).slice(0, 200);
    }
  }
  if (input.settings !== undefined) sets.push(['settings', JSON.stringify(await cleanSettings(actor, row, input.settings, sharing, members))]);
  if (input.rotateWebhookSecret || (input.settings?.webhookUrl && !row.webhook_secret)) {
    if (!actor.admin && row.created_by !== actor.person) throw new FormsError('forbidden', 403);
    sets.push(['webhook_secret', seal(`whsec_${randomBytes(24).toString('hex')}`)]);
  }
  if (input.status !== undefined && input.status !== row.status) {
    if (input.status === 'published') {
      const def = input.definition !== undefined ? normalizeDefinition(input.definition) : definitionOf(row);
      if (!def.questions.length) throw new FormsError('no_questions');
      sets.push(['published_at', now()]);
    }
    sets.push(['status', input.status]);
  }
  const db = getDb();
  if (input.members !== undefined) {
    await db.prepare('DELETE FROM forms_members WHERE form_id = ?').run(id);
    for (const m of members) await db.prepare('INSERT OR IGNORE INTO forms_members (form_id, user_id, created_at) VALUES (?, ?, ?)').run(id, m, now());
  }
  if (sets.length) {
    await db.prepare(`UPDATE forms_forms SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND workspace_id = ?`).run(...sets.map(([, v]) => v), now(), id, actor.ws);
  } else if (input.members !== undefined) {
    await db.prepare('UPDATE forms_forms SET updated_at = ? WHERE id = ?').run(now(), id);
  }
  return getForm(actor, id);
}

export async function duplicateForm(actor: FormsActor, id: string, name?: string): Promise<FormDto | null> {
  const row = await accessibleRow(actor, id);
  if (!row) return null;
  const copy = await createForm(actor, { name: name ?? `${row.name} (copy)`, definition: definitionOf(row) });
  const s = settingsOf(row);
  await getDb().prepare('UPDATE forms_forms SET settings = ? WHERE id = ?').run(JSON.stringify({ ...s, webhookUrl: '', notifyEmails: [], notifyPeople: [actor.person] }), copy.id);
  return getForm(actor, copy.id);
}

/** Borra el form con sus respuestas y archivos. Solo quien lo creó o un admin. */
export async function deleteForm(actor: FormsActor, id: string): Promise<boolean> {
  const row = await accessibleRow(actor, id);
  if (!row) return false;
  if (!actor.admin && row.created_by !== actor.person) throw new FormsError('forbidden', 403);
  const db = getDb();
  const files = (await db.prepare('SELECT ref FROM forms_files WHERE form_id = ?').all(id)) as Array<{ ref: string }>;
  await db.prepare('DELETE FROM forms_visit_steps WHERE form_id = ?').run(id);
  await db.prepare('DELETE FROM forms_visits WHERE form_id = ?').run(id);
  await db.prepare('DELETE FROM forms_files WHERE form_id = ?').run(id);
  await db.prepare('DELETE FROM forms_responses WHERE form_id = ?').run(id);
  await db.prepare('DELETE FROM forms_members WHERE form_id = ?').run(id);
  const res = await db.prepare('DELETE FROM forms_forms WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  const { deleteFormFiles } = await import('./files');
  await deleteFormFiles(files.map((f) => f.ref));
  return res.changes > 0;
}

// ---------- Ajustes de la app ----------

export async function workspaceDefaults(ws: string): Promise<{ retentionDays: number }> {
  const row = (await getDb().prepare('SELECT retention_days FROM forms_settings WHERE workspace_id = ?').get(ws)) as { retention_days: number } | undefined;
  return { retentionDays: Number(row?.retention_days ?? 0) };
}

export async function saveWorkspaceDefaults(actor: FormsActor, input: { retentionDays: number }): Promise<{ retentionDays: number }> {
  if (!actor.admin) throw new FormsError('forbidden', 403);
  const days = Math.max(0, Math.min(3650, Math.floor(input.retentionDays)));
  await getDb()
    .prepare('INSERT INTO forms_settings (workspace_id, retention_days, updated_at) VALUES (?, ?, ?) ON CONFLICT (workspace_id) DO UPDATE SET retention_days = excluded.retention_days, updated_at = excluded.updated_at')
    .run(actor.ws, days, now());
  return { retentionDays: days };
}

// ---------- Público ----------

/** Form por slug para /f/<slug> (publicado o cerrado; un borrador no existe). */
export async function getPublicFormRow(slug: string): Promise<FormRow | null> {
  if (!/^[a-z0-9-]{2,62}$/i.test(slug)) return null;
  return ((await getDb().prepare("SELECT * FROM forms_forms WHERE slug = ? AND status != 'draft'").get(slug.toLowerCase())) as FormRow | undefined) ?? null;
}

/** Hook para otras apps (Hiring, People): el form público por id, si es del workspace. */
export async function getWorkspaceFormSlug(ws: string, id: string): Promise<string | null> {
  const row = (await getDb().prepare("SELECT slug FROM forms_forms WHERE id = ? AND workspace_id = ? AND status = 'published'").get(id, ws)) as { slug: string } | undefined;
  return row?.slug ?? null;
}

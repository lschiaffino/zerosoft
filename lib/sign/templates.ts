/**
 * Sign: plantillas (documento + roles + campos por rol) y envío masivo.
 * Server-only.
 *
 * Las plantillas son del workspace: cualquiera con Sign las usa; las edita y
 * borra quien la creó o un admin. Usar una plantilla copia su PDF a un sobre
 * nuevo (el sobre no depende de que la plantilla siga existiendo) y asigna
 * cada rol a una persona. El envío masivo hace un sobre por fila de un CSV.
 */
import { getDb } from '../db';
import { parseCsv } from '../csv-parse';
import { sha256Hex } from '../esign';
import { deleteSignFiles, readSignFile, storeSignFile } from './files';
import { sanitizePdf, type PageBox } from './pdf';
import { addEvent, cleanFieldInput, createEnvelope, newId, nowIso, parseJson, sendEnvelope, type EnvelopeRow } from './core';
import { isEmail, RECIPIENT_ROLES, SignError, type FieldKind, type RecipientRole, type SignActor, type SigningOrder } from './types';

export interface TemplateRole {
  key: string;
  name: string;
  role: RecipientRole;
  order: number;
}

export interface TemplateField {
  roleKey: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label: string;
  options: string[];
}

export interface TemplateRow {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  description: string;
  message: string;
  signing_order: SigningOrder;
  otp_required: number;
  expires_days: number;
  reminder_days: number;
  document_ref: string | null;
  document_name: string;
  document_hash: string | null;
  pages: string;
  roles: string;
  fields: string;
  created_at: string;
  updated_at: string;
}

export function templateDto(t: TemplateRow, actor: SignActor) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    message: t.message,
    signingOrder: t.signing_order,
    otpRequired: t.otp_required === 1,
    expiresDays: t.expires_days,
    reminderDays: t.reminder_days,
    hasDocument: Boolean(t.document_ref),
    documentName: t.document_name,
    documentHash: t.document_hash,
    pages: parseJson<PageBox[]>(t.pages, []),
    roles: parseJson<TemplateRole[]>(t.roles, []),
    fields: parseJson<TemplateField[]>(t.fields, []),
    canEdit: actor.admin || t.created_by === actor.person,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}
export type TemplateDto = ReturnType<typeof templateDto>;

export async function listTemplates(actor: SignActor, q = ''): Promise<TemplateRow[]> {
  const term = q.trim().toLowerCase().slice(0, 100);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return (await getDb().prepare("SELECT * FROM sign_templates WHERE workspace_id = ? AND lower(name) LIKE ? ESCAPE '\\' ORDER BY updated_at DESC").all(actor.ws, like)) as TemplateRow[];
  }
  return (await getDb().prepare('SELECT * FROM sign_templates WHERE workspace_id = ? ORDER BY updated_at DESC').all(actor.ws)) as TemplateRow[];
}

export async function getTemplate(actor: SignActor, id: string): Promise<TemplateRow> {
  const t = (await getDb().prepare('SELECT * FROM sign_templates WHERE id = ? AND workspace_id = ?').get(id.slice(0, 80), actor.ws)) as TemplateRow | undefined;
  if (!t) throw new SignError('not_found', 404);
  return t;
}

async function requireEdit(actor: SignActor, id: string): Promise<TemplateRow> {
  const t = await getTemplate(actor, id);
  if (!(actor.admin || t.created_by === actor.person)) throw new SignError('forbidden', 403);
  return t;
}

const DEFAULT_ROLES: TemplateRole[] = [{ key: 'r1', name: 'Signer', role: 'signer', order: 1 }];

export async function createTemplate(actor: SignActor, input: { name: string; description?: string }): Promise<TemplateRow> {
  const id = newId('tpl');
  const ts = nowIso();
  await getDb()
    .prepare('INSERT INTO sign_templates (id, workspace_id, created_by, name, description, roles, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, actor.person, input.name.trim().slice(0, 160) || 'Untitled', (input.description ?? '').slice(0, 500), JSON.stringify(DEFAULT_ROLES), ts, ts);
  return getTemplate(actor, id);
}

export async function setTemplateDocument(actor: SignActor, id: string, file: { bytes: Buffer; name: string }): Promise<TemplateRow> {
  const t = await requireEdit(actor, id);
  const clean = await sanitizePdf(file.bytes);
  const ref = await storeSignFile(clean.bytes, 'application/pdf');
  const fields = parseJson<TemplateField[]>(t.fields, []).filter((f) => f.page <= clean.pages.length);
  await getDb()
    .prepare('UPDATE sign_templates SET document_ref = ?, document_name = ?, document_hash = ?, pages = ?, fields = ?, updated_at = ? WHERE id = ?')
    .run(ref, file.name.slice(0, 200), sha256Hex(clean.bytes), JSON.stringify(clean.pages), JSON.stringify(fields), nowIso(), t.id);
  if (t.document_ref) await deleteSignFiles([t.document_ref]);
  return getTemplate(actor, id);
}

export interface TemplatePatch {
  name?: string;
  description?: string;
  message?: string;
  signingOrder?: SigningOrder;
  otpRequired?: boolean;
  expiresDays?: number;
  reminderDays?: number;
  roles?: TemplateRole[];
  fields?: Array<Omit<TemplateField, 'required' | 'label' | 'options'> & { required?: boolean; label?: string; options?: string[] }>;
}

export function cleanRoles(roles: TemplateRole[]): TemplateRole[] {
  if (!roles.length || roles.length > 20) throw new SignError('invalid_roles');
  const keys = new Set<string>();
  return roles.map((r, i) => {
    const key = /^[\w-]{1,20}$/.test(r.key) ? r.key : `r${i + 1}`;
    if (keys.has(key) || !RECIPIENT_ROLES.includes(r.role)) throw new SignError('invalid_roles');
    keys.add(key);
    return { key, name: r.name.trim().slice(0, 60) || `Role ${i + 1}`, role: r.role, order: Math.min(50, Math.max(1, Math.round(r.order || 1))) };
  });
}

export async function updateTemplate(actor: SignActor, id: string, patch: TemplatePatch): Promise<TemplateRow> {
  const t = await requireEdit(actor, id);
  const roles = patch.roles ? cleanRoles(patch.roles) : parseJson<TemplateRole[]>(t.roles, []);
  const pages = parseJson<PageBox[]>(t.pages, []);
  let fields = parseJson<TemplateField[]>(t.fields, []);
  if (patch.fields) {
    if (patch.fields.length > 500) throw new SignError('too_many_fields');
    fields = patch.fields.map((f) => {
      const role = roles.find((r) => r.key === f.roleKey);
      if (!role || role.role === 'cc') throw new SignError('invalid_field_recipient');
      return { roleKey: role.key, ...cleanFieldInput({ ...f, recipientId: role.key }, pages.length) };
    });
  }
  // Un rol que se borró se lleva sus campos.
  fields = fields.filter((f) => roles.some((r) => r.key === f.roleKey && r.role !== 'cc'));
  const n = (v: number | undefined, d: number, min: number, max: number) => (v === undefined ? d : Math.min(max, Math.max(min, Math.round(v))));
  await getDb()
    .prepare('UPDATE sign_templates SET name = ?, description = ?, message = ?, signing_order = ?, otp_required = ?, expires_days = ?, reminder_days = ?, roles = ?, fields = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.name !== undefined ? patch.name.trim().slice(0, 160) || t.name : t.name,
      patch.description !== undefined ? patch.description.slice(0, 500) : t.description,
      patch.message !== undefined ? patch.message.slice(0, 4000) : t.message,
      patch.signingOrder ?? t.signing_order,
      patch.otpRequired === undefined ? t.otp_required : patch.otpRequired ? 1 : 0,
      n(patch.expiresDays, t.expires_days, 1, 365),
      n(patch.reminderDays, t.reminder_days, 0, 30),
      JSON.stringify(roles),
      JSON.stringify(fields),
      nowIso(),
      t.id,
    );
  return getTemplate(actor, id);
}

export async function deleteTemplate(actor: SignActor, id: string): Promise<void> {
  const t = await requireEdit(actor, id);
  await getDb().prepare('DELETE FROM sign_templates WHERE id = ?').run(t.id);
  await deleteSignFiles([t.document_ref]);
}

export async function templateFile(actor: SignActor, id: string): Promise<{ bytes: Buffer; name: string }> {
  const t = await getTemplate(actor, id);
  if (!t.document_ref) throw new SignError('not_found', 404);
  const bytes = await readSignFile(t.document_ref);
  if (!bytes) throw new SignError('file_unavailable', 404);
  return { bytes, name: t.document_name || 'template.pdf' };
}

export interface UseTemplateInput {
  title?: string;
  message?: string;
  /** roleKey → persona. */
  recipients: Record<string, { name: string; email: string }>;
  send?: boolean;
  locale?: string;
  bulkId?: string | null;
}

/** Sobre nuevo desde la plantilla (borrador, o enviado con send). */
export async function envelopeFromTemplate(actor: SignActor, id: string, input: UseTemplateInput): Promise<EnvelopeRow> {
  const t = await getTemplate(actor, id);
  if (!t.document_ref) throw new SignError('no_document');
  const roles = parseJson<TemplateRole[]>(t.roles, []);
  for (const r of roles) {
    const p = input.recipients[r.key];
    if (!p || !p.name?.trim() || !isEmail((p.email ?? '').trim())) throw new SignError('role_unfilled', 400, { role: r.name });
  }
  const bytes = await readSignFile(t.document_ref);
  if (!bytes) throw new SignError('file_unavailable', 404);
  const env = await createEnvelope(actor, {
    title: (input.title ?? '').trim() || t.name,
    message: input.message ?? t.message,
    locale: input.locale,
    source: 'template',
    templateId: t.id,
    bulkId: input.bulkId ?? null,
    signingOrder: t.signing_order,
    otpRequired: t.otp_required === 1,
    expiresDays: t.expires_days,
    reminderDays: t.reminder_days,
  });
  const db = getDb();
  const ref = await storeSignFile(bytes, 'application/pdf');
  await db.prepare('UPDATE sign_envelopes SET document_ref = ?, document_name = ?, document_hash = ?, upload_hash = ?, pages = ? WHERE id = ?').run(ref, t.document_name, t.document_hash, t.document_hash, t.pages, env.id);
  const ids = new Map<string, string>();
  const ts = nowIso();
  for (const r of roles) {
    const rid = newId('rcp');
    ids.set(r.key, rid);
    const p = input.recipients[r.key];
    await db
      .prepare('INSERT INTO sign_recipients (id, envelope_id, role, role_name, name, email, routing_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rid, env.id, r.role, r.name, p.name.trim().slice(0, 120), p.email.trim().toLowerCase(), t.signing_order === 'parallel' ? 1 : r.order, ts);
  }
  for (const f of parseJson<TemplateField[]>(t.fields, [])) {
    const rid = ids.get(f.roleKey);
    if (!rid) continue;
    await db
      .prepare('INSERT INTO sign_fields (id, envelope_id, recipient_id, kind, page, x, y, w, h, required, label, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('fld'), env.id, rid, f.kind, f.page, f.x, f.y, f.w, f.h, f.required ? 1 : 0, f.label, JSON.stringify(f.options));
  }
  await addEvent(env.id, 'template', { actorId: actor.person, detail: { templateId: t.id, name: t.name } });
  return input.send ? sendEnvelope(actor, env.id) : env;
}

export const BULK_MAX_ROWS = 200;

/**
 * Envío masivo: un sobre por fila. El CSV trae `name` y `email` (con
 * encabezado) para el primer rol que firma; los otros roles van fijos.
 */
export async function bulkSend(
  actor: SignActor,
  id: string,
  input: { csv: string; fixed?: Record<string, { name: string; email: string }>; locale?: string },
): Promise<{ bulkId: string; sent: number; errors: Array<{ row: number; error: string }> }> {
  const t = await getTemplate(actor, id);
  const roles = parseJson<TemplateRole[]>(t.roles, []);
  const target = roles.find((r) => r.role === 'signer');
  if (!target) throw new SignError('no_signer_role');
  const rows = parseCsv(input.csv.replace(/^﻿/, '')).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) throw new SignError('csv_empty');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iName = header.indexOf('name');
  const iEmail = header.indexOf('email');
  if (iName < 0 || iEmail < 0) throw new SignError('csv_header');
  const body = rows.slice(1);
  if (body.length > BULK_MAX_ROWS) throw new SignError('csv_too_many', 400, { max: BULK_MAX_ROWS });
  const bulkId = newId('blk');
  let sent = 0;
  const errors: Array<{ row: number; error: string }> = [];
  for (const [i, row] of body.entries()) {
    const person = { name: (row[iName] ?? '').trim(), email: (row[iEmail] ?? '').trim() };
    if (!person.name || !isEmail(person.email)) {
      errors.push({ row: i + 2, error: 'invalid_row' });
      continue;
    }
    try {
      await envelopeFromTemplate(actor, t.id, { recipients: { ...(input.fixed ?? {}), [target.key]: person }, title: `${t.name} · ${person.name}`, send: true, locale: input.locale, bulkId });
      sent++;
    } catch (err) {
      errors.push({ row: i + 2, error: err instanceof SignError ? err.code : 'error' });
    }
  }
  return { bulkId, sent, errors };
}

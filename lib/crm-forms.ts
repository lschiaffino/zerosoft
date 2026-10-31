/**
 * CRM Forms — formularios de captura (página /f/<slug|token> y embed), envíos
 * y su efecto en el CRM. Server-only.
 *
 * Cada envío: valida (requeridos, email, opciones, consentimiento), filtra
 * spam (honeypot + tiempo mínimo; el rate limit por IP lo aplica la ruta),
 * crea o actualiza el contacto (dedupe por email), vincula/crea la empresa,
 * registra el envío y una actividad "Form submitted" en el timeline, aplica
 * lista/tags/secuencia, avisa al owner y a los emails configurados y dispara
 * el trigger de workflows `form_submitted` y el evento de Flow `form.submitted`.
 */
import { localized } from './notification-copy';
import { typedCustomValues } from './crm-custom-fields';
import { createHash } from 'crypto';
import { getDb, type CrmContactRow, type CrmFormRow, type CrmFormSubmissionRow, type Db } from './db';
import {
  dealNameFor,
  defaultFormFields,
  formFieldSchema,
  ownerFromRules,
  mapSubmission,
  normalizeFields,
  normalizeSettings,
  urlParamsOf,
  validateSubmission,
  type FieldError,
  type FormField,
  type FormSettings,
  type FormStatus,
  type FormSubmitBody,
} from './crm-forms-schema';
import { LIFECYCLE_STAGES } from './crm-constants';
import { isWorkspacePerson } from './crm-refs';
import { emitEvent } from './events';
import { csvCell, looksLikeSpam } from './form-engine';
import type { OwnerScope } from './crm-visibility';

export interface CrmForm {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
  token: string;
  status: FormStatus;
  fields: FormField[];
  settings: FormSettings;
  submission_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_submission_at?: string | null;
}

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function parseJson(raw: string | null | undefined): unknown {
  try {
    return JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
}

function toForm(row: CrmFormRow & { last_submission_at?: string | null }): CrmForm {
  return {
    ...row,
    fields: normalizeFields(parseJson(row.fields)),
    settings: normalizeSettings(parseJson(row.settings)),
  };
}

function newToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export class FormError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'FormError';
  }
}

// ---------- CRUD ----------

export async function listForms(workspaceId: string, db: Db = getDb()): Promise<CrmForm[]> {
  const rows = (await db
    .prepare(
      `SELECT f.*, (SELECT MAX(s.created_at) FROM crm_form_submissions s WHERE s.form_id = f.id) AS last_submission_at
       FROM crm_forms f WHERE f.user_id = ? ORDER BY f.status = 'archived', f.created_at DESC`,
    )
    .all(workspaceId)) as Array<CrmFormRow & { last_submission_at: string | null }>;
  return rows.map(toForm);
}

export async function getForm(workspaceId: string, id: string, db: Db = getDb()): Promise<CrmForm | null> {
  const row = (await db.prepare('SELECT * FROM crm_forms WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
    | CrmFormRow
    | undefined;
  return row ? toForm(row) : null;
}

/** Form público por slug o token (solo activo o pausado; archivado = no existe). */
export async function getPublicForm(key: string, db: Db = getDb()): Promise<CrmForm | null> {
  if (!/^[a-z0-9-]{2,62}$/i.test(key)) return null;
  const row = (await db
    .prepare("SELECT * FROM crm_forms WHERE (token = ? OR slug = ?) AND status != 'archived' LIMIT 1")
    .get(key, key.toLowerCase())) as CrmFormRow | undefined;
  return row ? toForm(row) : null;
}

/** Lo que ve un visitante: sin owner, lista, tags ni emails de aviso. */
export interface PublicFormDto {
  key: string;
  name: string;
  status: FormStatus;
  fields: FormField[];
  settings: Pick<
    FormSettings,
    'title' | 'description' | 'submitText' | 'consentText' | 'consentRequired' | 'successMode' | 'successMessage'
  >;
  /** Site key de Turnstile si el form pide CAPTCHA ('fake' en tests), o null. */
  captchaSiteKey: string | null;
}

export function toPublicForm(form: CrmForm): PublicFormDto {
  const s = form.settings;
  return {
    key: form.slug ?? form.token,
    name: form.name,
    status: form.status,
    fields: form.fields,
    settings: {
      title: s.title,
      description: s.description,
      submitText: s.submitText,
      consentText: s.consentText,
      consentRequired: s.consentRequired,
      successMode: s.successMode,
      successMessage: s.successMessage,
    },
    captchaSiteKey: s.captcha ? captchaSiteKey() : null,
  };
}

// ---------- CAPTCHA (Cloudflare Turnstile) ----------

/** CAPTCHA_FAKE=1 (tests): el widget es un checkbox de prueba y el token válido es "fake-pass". */
function captchaFake(): boolean {
  return process.env.CAPTCHA_FAKE === '1';
}

/** Site key pública, o null si el CAPTCHA no está configurado en este servidor. */
export function captchaSiteKey(): string | null {
  if (captchaFake()) return 'fake';
  return process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : null;
}

export function captchaConfigured(): boolean {
  return captchaSiteKey() !== null;
}

/** Verifica el token con Turnstile (siteverify). Sin configurar, no bloquea el envío. */
export async function verifyCaptcha(token: string | undefined, ip?: string): Promise<boolean> {
  if (captchaFake()) return token === 'fake-pass';
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return true;
  if (!token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown') form.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

async function slugTaken(slug: string, exceptId: string | null, db: Db): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM crm_forms WHERE (slug = ? OR token = ?) AND id != ?')
    .get(slug, slug, exceptId ?? '');
  if (row) return true;
  // /f/<slug> es compartido con la app Forms: tampoco puede chocar con uno de sus formularios.
  return !!(await db.prepare('SELECT 1 FROM forms_forms WHERE slug = ?').get(slug));
}

/** Valida referencias de settings (owner, lista, tags, secuencia) contra el workspace. */
/**
 * Emails de aviso de alguien que no creó el form ni es admin: solo personas
 * del workspace (o las que el form ya tenía). Mismo criterio que la app Forms.
 */
async function assertInsiderEmails(workspaceId: string, emails: string[], kept: string[], db: Db): Promise<void> {
  const { listOwnerSpacePeople } = await import('./workspace');
  const people = await listOwnerSpacePeople(workspaceId, {}, db);
  for (const e of emails) {
    const email = e.trim().toLowerCase();
    if (kept.some((k) => k.toLowerCase() === email)) continue;
    if (!people.some((p) => p.email.toLowerCase() === email)) throw new FormError('notify_external_forbidden');
  }
}

async function cleanSettings(workspaceId: string, patch: Partial<FormSettings>, db: Db): Promise<Partial<FormSettings>> {
  const out = { ...patch };
  if (out.ownerId && !(await isWorkspacePerson(workspaceId, out.ownerId, db))) throw new FormError('invalid_owner');
  if (out.listId) {
    const ok = await db.prepare("SELECT 1 FROM crm_lists WHERE id = ? AND user_id = ? AND kind = 'static'").get(out.listId, workspaceId);
    if (!ok) throw new FormError('invalid_list');
  }
  if (out.sequenceId) {
    const ok = await db.prepare('SELECT 1 FROM crm_sequences WHERE id = ? AND user_id = ?').get(out.sequenceId, workspaceId);
    if (!ok) throw new FormError('invalid_sequence');
  }
  if (out.createDeal || out.dealPipelineId || out.dealStageId) {
    if (out.dealPipelineId || out.dealStageId) {
      const ok = await db
        .prepare('SELECT 1 FROM crm_stages s JOIN crm_pipelines p ON p.id = s.pipeline_id WHERE s.id = ? AND p.id = ? AND p.user_id = ?')
        .get(out.dealStageId ?? '', out.dealPipelineId ?? '', workspaceId);
      if (!ok) throw new FormError('invalid_stage');
    } else if (out.createDeal) throw new FormError('invalid_stage');
  }
  if (out.ownerRules?.length) {
    for (const r of out.ownerRules) {
      if (!(await isWorkspacePerson(workspaceId, r.ownerId, db))) throw new FormError('invalid_owner');
    }
  }
  if (out.tagIds?.length) {
    const rows = (await db
      .prepare(`SELECT id FROM crm_tags WHERE user_id = ? AND id IN (${out.tagIds.map(() => '?').join(',')})`)
      .all(workspaceId, ...out.tagIds)) as Array<{ id: string }>;
    const ok = new Set(rows.map((r) => r.id));
    out.tagIds = out.tagIds.filter((t) => ok.has(t));
  }
  return out;
}

function checkFields(fields: FormField[]): FormField[] {
  const ids = new Set<string>();
  for (const f of fields) {
    if (!formFieldSchema.safeParse(f).success) throw new FormError('invalid_field');
    if (ids.has(f.id)) throw new FormError('duplicate_field');
    ids.add(f.id);
    if (f.type === 'select' && !f.options?.length) throw new FormError('missing_options');
  }
  return fields;
}

export async function createForm(
  workspaceId: string,
  input: {
    name: string;
    slug?: string | null;
    status?: FormStatus;
    fields?: FormField[];
    settings?: Partial<FormSettings>;
    createdBy?: string | null;
  },
  db: Db = getDb(),
): Promise<CrmForm> {
  const id = crypto.randomUUID();
  const slug = input.slug ? input.slug.toLowerCase() : null;
  if (slug && (await slugTaken(slug, null, db))) throw new FormError('slug_taken');
  const fields = checkFields(input.fields ?? defaultFormFields());
  const settings = normalizeSettings({
    title: input.name,
    ...(await cleanSettings(workspaceId, input.settings ?? {}, db)),
  });
  await db
    .prepare(
      `INSERT INTO crm_forms (id, user_id, name, slug, token, status, fields, settings, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      input.name.trim().slice(0, 200),
      slug,
      newToken(),
      input.status ?? 'active',
      JSON.stringify(fields),
      JSON.stringify(settings),
      input.createdBy ?? null,
    );
  return (await getForm(workspaceId, id, db))!;
}

export async function updateForm(
  workspaceId: string,
  id: string,
  input: {
    name?: string;
    slug?: string | null;
    status?: FormStatus;
    fields?: FormField[];
    settings?: Partial<FormSettings>;
  },
  db: Db = getDb(),
  /** Quién edita: una dirección de aviso de afuera del workspace solo la agrega quien creó el form o un admin. */
  actor?: { person: string; admin: boolean },
): Promise<CrmForm | null> {
  const existing = await getForm(workspaceId, id, db);
  if (!existing) return null;
  if (input.settings?.notifyEmails && actor && !actor.admin && existing.created_by !== actor.person) {
    await assertInsiderEmails(workspaceId, input.settings.notifyEmails, existing.settings.notifyEmails, db);
  }
  const sets: Array<[string, string | null]> = [];
  if (input.name !== undefined) sets.push(['name', input.name.trim().slice(0, 200)]);
  if (input.slug !== undefined) {
    const slug = input.slug ? input.slug.toLowerCase() : null;
    if (slug && (await slugTaken(slug, id, db))) throw new FormError('slug_taken');
    sets.push(['slug', slug]);
  }
  if (input.status !== undefined) sets.push(['status', input.status]);
  if (input.fields !== undefined) sets.push(['fields', JSON.stringify(checkFields(input.fields))]);
  if (input.settings !== undefined) {
    const clean = await cleanSettings(workspaceId, input.settings, db);
    sets.push(['settings', JSON.stringify(normalizeSettings({ ...existing.settings, ...clean }))]);
  }
  if (sets.length) {
    await db
      .prepare(`UPDATE crm_forms SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(...sets.map(([, v]) => v), nowDb(), id, workspaceId);
  }
  return getForm(workspaceId, id, db);
}

export async function deleteForm(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  return (await db.prepare('DELETE FROM crm_forms WHERE id = ? AND user_id = ?').run(id, workspaceId)).changes > 0;
}

// ---------- Envíos ----------

export type SubmissionRow = CrmFormSubmissionRow & { contact_name: string | null; contact_email: string | null };

export async function listSubmissions(
  workspaceId: string,
  formId: string,
  opts: { page?: number; pageSize?: number; ownerScope?: OwnerScope } = {},
  db: Db = getDb(),
): Promise<{ rows: SubmissionRow[]; total: number }> {
  const where = ['s.user_id = ?', 's.form_id = ?'];
  const args: Array<string | number> = [workspaceId, formId];
  if (opts.ownerScope) {
    // Visibilidad por owner: envíos sin contacto o de contactos visibles.
    if (!opts.ownerScope.length) where.push('s.contact_id IS NULL');
    else {
      where.push(
        `(s.contact_id IS NULL OR COALESCE(c.owner_id, c.user_id) IN (${opts.ownerScope.map(() => '?').join(',')}))`,
      );
      args.push(...opts.ownerScope);
    }
  }
  const whereSql = where.join(' AND ');
  const total = (
    (await db
      .prepare(`SELECT COUNT(*) AS c FROM crm_form_submissions s LEFT JOIN crm_contacts c ON c.id = s.contact_id WHERE ${whereSql}`)
      .get(...args)) as { c: number }
  ).c;
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 5000);
  const page = Math.max(opts.page ?? 1, 1);
  const rows = (await db
    .prepare(
      `SELECT s.*, NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name, c.email AS contact_email
       FROM crm_form_submissions s LEFT JOIN crm_contacts c ON c.id = s.contact_id
       WHERE ${whereSql}
       ORDER BY s.created_at DESC, s.rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as SubmissionRow[];
  return { rows, total };
}

/** CSV de envíos: fecha, contacto, una columna por campo y UTM. */
export function submissionsCsv(form: CrmForm, rows: SubmissionRow[]): string {
  const utmKeys = new Set<string>();
  const parsed = rows.map((r) => {
    const data = (parseJson(r.data) as Record<string, unknown> | null) ?? {};
    const utm = (parseJson(r.utm) as Record<string, string> | null) ?? {};
    Object.keys(utm).forEach((k) => utmKeys.add(k));
    return { r, data, utm };
  });
  const utmCols = [...utmKeys].sort();
  const dataFields = form.fields.filter((f) => f.type !== 'step');
  const header = ['submitted_at', 'contact_id', 'contact_email', ...dataFields.map((f) => f.label || f.id), ...utmCols, 'page_url', 'referrer'];
  const lines = [header.map(csvCell).join(',')];
  for (const { r, data, utm } of parsed) {
    lines.push(
      [
        r.created_at,
        r.contact_id ?? '',
        r.contact_email ?? '',
        ...dataFields.map((f) => {
          const v = data[f.id];
          return typeof v === 'boolean' ? (v ? 'yes' : 'no') : (v ?? '');
        }),
        ...utmCols.map((k) => utm[k] ?? ''),
        r.page_url,
        r.referrer,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export type SubmitResult =
  | {
      ok: true;
      spam?: boolean;
      submissionId?: string;
      contactId?: string;
      created?: boolean;
      successMode: FormSettings['successMode'];
      successMessage: string;
      redirectUrl: string;
    }
  | { ok: false; error: 'not_found' | 'paused' | 'invalid' | 'captcha'; fieldErrors?: Record<string, FieldError> };

function lifecycleRank(stage: string): number {
  return (LIFECYCLE_STAGES as readonly string[]).indexOf(stage);
}

function hashIp(ip: string): string {
  return ip ? createHash('sha256').update(`${process.env.NEXTAUTH_SECRET ?? ''}:${ip}`).digest('hex').slice(0, 32) : '';
}

/**
 * Procesa un envío público. `meta.ip` solo se guarda hasheado. Un envío que
 * parece spam (honeypot completo o enviado demasiado rápido) responde ok sin
 * guardar nada, para no darle pistas al bot.
 */
export async function submitForm(
  key: string,
  body: FormSubmitBody,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<SubmitResult> {
  const db = getDb();
  const form = await getPublicForm(key, db);
  if (!form) return { ok: false, error: 'not_found' };
  if (form.status !== 'active') return { ok: false, error: 'paused' };
  const s = form.settings;
  const success = {
    successMode: s.successMode,
    successMessage: s.successMessage,
    redirectUrl: s.successMode === 'redirect' ? s.redirectUrl : '',
  };

  if (looksLikeSpam({ honeypot: body.website_url, minSeconds: 0 })) return { ok: true, spam: true, ...success };
  if (s.captcha && captchaConfigured() && !(await verifyCaptcha(body.captchaToken, meta.ip))) {
    return { ok: false, error: 'captcha' };
  }
  if (looksLikeSpam({ elapsedMs: body.elapsedMs, minSeconds: s.minSubmitSeconds })) return { ok: true, spam: true, ...success };

  const urlParams = { ...urlParamsOf(body.pageUrl), ...(body.utm ?? {}) };
  const { values, errors } = validateSubmission(form.fields, s, body, urlParams);
  if (Object.keys(errors).length) return { ok: false, error: 'invalid', fieldErrors: errors };

  const workspaceId = form.user_id;
  const mapped = mapSubmission(form.fields, values);
  const email = (mapped.contact.email ?? '').trim().toLowerCase();

  const crm = await import('./crm');
  // Valores de custom fields con el tipo de cada campo (número, lista, URL…).
  const [contactDefs, companyDefs] = await Promise.all([
    crm.listCustomFields(workspaceId, 'contacts'),
    crm.listCustomFields(workspaceId, 'companies'),
  ]);
  const contactCustom = typedCustomValues(contactDefs, mapped.contactCustom);
  const companyCustom = typedCustomValues(companyDefs, mapped.companyCustom);
  const { findContactByEmail } = await import('./crm-integrations');

  // Empresa: por nombre o dominio (se crea si no existe).
  let companyId: string | null = null;
  if (mapped.company.name || mapped.company.domain) {
    const existingCo = (await db
      .prepare(
        `SELECT id FROM crm_companies WHERE user_id = ?
           AND ((? != '' AND lower(name) = lower(?)) OR (? != '' AND lower(domain) = lower(?)))
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(
        workspaceId,
        mapped.company.name ?? '',
        mapped.company.name ?? '',
        mapped.company.domain ?? '',
        mapped.company.domain ?? '',
      )) as { id: string } | undefined;
    if (existingCo) companyId = existingCo.id;
    else {
      const co = await crm.createCompany(workspaceId, {
        name: mapped.company.name || mapped.company.domain || '',
        domain: mapped.company.domain,
        industry: mapped.company.industry,
        website: mapped.company.website,
        phone: mapped.company.phone,
        city: mapped.company.city,
        country: mapped.company.country,
        custom: Object.keys(companyCustom).length ? companyCustom : undefined,
      });
      companyId = co.id;
    }
  }

  const existing: CrmContactRow | null = email && s.updateExisting ? await findContactByEmail(workspaceId, email) : null;
  let contact: CrmContactRow;
  let created = false;
  // Dueño: la primera regla que coincide; si no, el dueño fijo; si no, round-robin.
  const ruleOwner = ownerFromRules(s.ownerRules, values);
  const ownerValid =
    ruleOwner && (await isWorkspacePerson(workspaceId, ruleOwner, db))
      ? ruleOwner
      : s.ownerId && (await isWorkspacePerson(workspaceId, s.ownerId, db))
        ? s.ownerId
        : null;

  if (existing) {
    // Dedupe: completa/actualiza solo lo que vino (nunca borra con vacíos).
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(mapped.contact)) if (v && k !== 'email') patch[k] = v;
    if (Object.keys(contactCustom).length) {
      patch.custom = { ...crm.parseCustom(existing.custom), ...contactCustom };
    }
    if (companyId && !existing.company_id) patch.companyId = companyId;
    // Lifecycle solo avanza (nunca retrocede un customer a lead).
    if (s.lifecycleStage && lifecycleRank(s.lifecycleStage) > lifecycleRank(existing.lifecycle_stage)) {
      patch.lifecycleStage = s.lifecycleStage;
    }
    if (!existing.source && s.source) patch.source = s.source;
    contact = Object.keys(patch).length
      ? ((await crm.updateContact(workspaceId, existing.id, patch as never, db, 'form')) ?? existing)
      : existing;
  } else {
    contact = await crm.createContact(
      workspaceId,
      {
        firstName: mapped.contact.firstName,
        lastName: mapped.contact.lastName,
        email: email || undefined,
        phone: mapped.contact.phone,
        jobTitle: mapped.contact.jobTitle,
        website: mapped.contact.website,
        city: mapped.contact.city,
        country: mapped.contact.country,
        lifecycleStage: s.lifecycleStage || undefined,
        leadStatus: s.leadStatus || undefined,
        source: s.source || 'form',
        companyId,
        ownerId: ownerValid,
        custom: Object.keys(contactCustom).length ? contactCustom : undefined,
      },
      db,
    );
    created = true;
    if (!ownerValid) {
      const { assignNewLead } = await import('./crm-assignment');
      await assignNewLead(workspaceId, contact.id, 'form', db);
    }
    contact = ((await db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(contact.id)) as CrmContactRow) ?? contact;
  }

  // Envío
  const submissionId = crypto.randomUUID();
  const utm: Record<string, string> = {};
  for (const [k, v] of Object.entries(urlParams)) {
    if (/^(utm_[a-z]+|gclid|fbclid)$/.test(k) && v) utm[k] = String(v).slice(0, 500);
  }
  await db
    .prepare(
      `INSERT INTO crm_form_submissions (id, form_id, user_id, contact_id, contact_created, data, utm, page_url, referrer, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      submissionId,
      form.id,
      workspaceId,
      contact.id,
      created ? 1 : 0,
      JSON.stringify({ ...values, ...(s.consentText ? { __consent: !!body.consent } : {}) }),
      JSON.stringify(utm),
      (body.pageUrl ?? '').slice(0, 2000),
      (body.referrer ?? '').slice(0, 2000),
      hashIp(meta.ip ?? ''),
      (meta.userAgent ?? '').slice(0, 300),
    );
  await db.prepare('UPDATE crm_forms SET submission_count = submission_count + 1 WHERE id = ?').run(form.id);

  // Timeline: actividad "Form submitted" con los valores.
  const lines = form.fields
    .filter((f) => values[f.id] !== '' && values[f.id] !== undefined)
    .map((f) => `${f.label || f.id}: ${typeof values[f.id] === 'boolean' ? (values[f.id] ? 'yes' : 'no') : String(values[f.id])}`);
  if (Object.keys(utm).length) lines.push('', ...Object.entries(utm).map(([k, v]) => `${k}: ${v}`));
  if (body.pageUrl) lines.push('', `Page: ${body.pageUrl}`);
  await crm.createActivity(workspaceId, {
    type: 'note',
    subject: `Form submitted: ${form.name}`,
    body: lines.join('\n'),
    contactId: contact.id,
    companyId: contact.company_id,
  });

  // Deal del envío (pipeline y etapa elegidos en el form), asociado al contacto y su empresa.
  let dealId: string | null = null;
  if (s.createDeal && s.dealPipelineId && s.dealStageId) {
    try {
      const contactLabel = `${contact.first_name} ${contact.last_name}`.trim() || contact.email || '';
      const res = await crm.createDeal(workspaceId, {
        pipelineId: s.dealPipelineId,
        stageId: s.dealStageId,
        name: dealNameFor(s.dealName, {
          name: contactLabel,
          email: contact.email ?? '',
          company: mapped.company.name ?? '',
          form: form.name,
        }),
        source: s.source || 'form',
        ownerId: contact.owner_id ?? null,
        contactIds: [contact.id],
        companyId: contact.company_id ?? companyId,
      });
      if (res.ok) dealId = res.deal.id;
    } catch {
      /* el deal no bloquea el envío */
    }
  }

  // Lista, tags y secuencia (cada uno no puede romper el envío).
  if (s.listId) await crm.addListMembers(workspaceId, s.listId, [contact.id]).catch(() => 0);
  if (s.tagIds.length) {
    const { applyTag } = await import('./crm-tags');
    for (const tagId of s.tagIds) await applyTag(workspaceId, tagId, 'contact', [contact.id], 'add').catch(() => 0);
  }
  if (s.sequenceId) {
    try {
      const { enrollContacts, defaultSenderFor } = await import('./crm-sequences');
      const senderId = await defaultSenderFor(workspaceId, s.sequenceId, contact.id);
      await enrollContacts(workspaceId, { sequenceId: s.sequenceId, contactIds: [contact.id], senderId, enrolledBy: null });
    } catch {
      /* la secuencia no bloquea el envío */
    }
  }

  // Avisos
  const contactName = `${contact.first_name} ${contact.last_name}`.trim() || contact.email || 'Someone';
  if (s.notifyOwner) {
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: contact.owner_id ?? workspaceId,
      type: 'crm_form',
      title: localized('crmFormSubmitted', { who: contactName, name: form.name }),
      body: lines.slice(0, 6).join('\n'),
      href: `/app/crm/contacts/${contact.id}`,
      sourceType: 'crm_form',
      sourceId: form.id,
    }).catch(() => null);
  }
  if (s.notifyEmails.length) {
    const { sendEmail } = await import('./email');
    const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
    const { rateLimit } = await import('./rate-limit');
    for (const to of s.notifyEmails) {
      // Tope diario por form: un formulario público no puede volverse un relay de emails.
      if (!(await rateLimit(`crm-form-notify:${form.id}`, 200, 86_400)).ok) break;
      await sendEmail({
        to,
        subject: `New submission: ${form.name}`,
        text: `${contactName} submitted "${form.name}".\n\n${lines.join('\n')}\n\n${base}/en/app/crm/contacts/${contact.id}`,
      }).catch(() => null);
    }
  }

  // Automatizaciones
  try {
    const { runWorkflowsForEvent } = await import('./crm-workflows');
    await runWorkflowsForEvent(workspaceId, {
      type: 'form_submitted',
      entity: 'contact',
      entityId: contact.id,
      payload: { formId: form.id, submissionId, created },
    });
  } catch {
    /* no bloquea */
  }
  await emitEvent(workspaceId, 'form.submitted', {
    form: { id: form.id, name: form.name },
    submission: { id: submissionId, values },
    contact: { id: contact.id, email: contact.email, created },
    ...(dealId ? { deal: { id: dealId } } : {}),
    utm,
  });
  const { recalcContactScoreSafe } = await import('./crm-scoring');
  await recalcContactScoreSafe(workspaceId, contact.id);

  return { ok: true, submissionId, contactId: contact.id, created, ...success };
}

export async function getSubmission(
  workspaceId: string,
  id: string,
  db: Db = getDb(),
): Promise<CrmFormSubmissionRow | null> {
  return (
    ((await db.prepare('SELECT * FROM crm_form_submissions WHERE id = ? AND user_id = ?').get(id, workspaceId)) as
      | CrmFormSubmissionRow
      | undefined) ?? null
  );
}

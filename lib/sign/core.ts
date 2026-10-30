/**
 * Sign: sobres del lado de quien envía. Server-only.
 *
 * Un sobre es un borrador hasta que se envía: documento (PDF limpio, privado),
 * destinatarios con su rol y orden, campos por destinatario y los ajustes
 * (mensaje, vencimiento, recordatorios, código por email). Enviado, no se
 * cambia más: se anula y se copia a un borrador nuevo.
 *
 * Quién ve un sobre: quien lo creó, los admins del workspace y los
 * destinatarios que son personas del workspace (por su email, para "esperan
 * mi firma"). Gestionarlo (enviar, anular, recordar, bajar archivos): quien
 * lo creó y los admins.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from '../email';
import { createNotification } from '../notifications';
import { sha256Hex } from '../esign';
import { deleteSignFiles, readSignFile, storeSignFile } from './files';
import { sanitizePdf, type PageBox } from './pdf';
import { formatDate, signCopy, signLocale, type SignCopyKey, type SignLocale } from './i18n';
import {
  activeRecipients,
  assertEditable,
  canManageEnvelope,
  canSeeEnvelope,
  clampBox,
  FIELD_KINDS,
  hashToken,
  isEmail,
  parseOptions,
  RECIPIENT_ROLES,
  SignError,
  signingToken,
  type EnvelopeStatus,
  type FieldKind,
  type RecipientRole,
  type RecipientStatus,
  type SignActor,
  type SigningOrder,
} from './types';

// ---------- Filas ----------

export interface EnvelopeRow {
  id: string;
  workspace_id: string;
  created_by: string;
  title: string;
  message: string;
  status: EnvelopeStatus;
  signing_order: SigningOrder;
  otp_required: number;
  expires_days: number;
  expires_at: string | null;
  reminder_days: number;
  locale: string;
  document_ref: string | null;
  document_name: string;
  document_hash: string | null;
  upload_hash: string | null;
  pages: string;
  final_ref: string | null;
  final_hash: string | null;
  flattened_hash: string | null;
  source: string;
  links: string;
  template_id: string | null;
  bulk_id: string | null;
  sent_at: string | null;
  completed_at: string | null;
  declined_at: string | null;
  voided_at: string | null;
  void_reason: string;
  expired_at: string | null;
  finalize_claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipientRow {
  id: string;
  envelope_id: string;
  role: RecipientRole;
  role_name: string;
  name: string;
  email: string;
  routing_order: number;
  status: RecipientStatus;
  token_hash: string | null;
  token_nonce: string | null;
  session_hash: string | null;
  otp_hash: string | null;
  otp_expires_at: string | null;
  otp_attempts: number;
  otp_verified_at: string | null;
  consent_at: string | null;
  notified_at: string | null;
  reminded_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  decline_reason: string;
  signature_image: string;
  signature_kind: string;
  initials_image: string;
  ip: string;
  user_agent: string;
  created_at: string;
}

export interface FieldRow {
  id: string;
  envelope_id: string;
  recipient_id: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: number;
  label: string;
  options: string;
  value: string | null;
  filled_at: string | null;
}

export interface EventRow {
  id: string;
  envelope_id: string;
  recipient_id: string | null;
  actor_id: string | null;
  kind: string;
  ip: string;
  user_agent: string;
  detail: string;
  created_at: string;
}

/** Vínculo con un registro de otra app (CRM, Hiring, People). */
export interface EnvelopeLink {
  app: 'crm' | 'hiring' | 'people' | 'docs';
  kind: string;
  id: string;
  label?: string;
}

// ---------- Utilidades ----------

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;
export const nowIso = () => new Date().toISOString();

export function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(raw || '');
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function signingLink(locale: string, token: string): string {
  return `${appBase()}/${signLocale(locale)}/sign/${token}`;
}

// ---------- Lecturas ----------

export async function getEnvelopeRow(ws: string, id: string): Promise<EnvelopeRow | null> {
  if (!id || id.length > 80) return null;
  return ((await getDb().prepare('SELECT * FROM sign_envelopes WHERE id = ? AND workspace_id = ?').get(id, ws)) as EnvelopeRow | undefined) ?? null;
}

export async function envelopeById(id: string): Promise<EnvelopeRow | null> {
  return ((await getDb().prepare('SELECT * FROM sign_envelopes WHERE id = ?').get(id)) as EnvelopeRow | undefined) ?? null;
}

export async function listRecipients(envId: string): Promise<RecipientRow[]> {
  return (await getDb().prepare('SELECT * FROM sign_recipients WHERE envelope_id = ? ORDER BY routing_order, created_at, id').all(envId)) as RecipientRow[];
}

export async function listFields(envId: string): Promise<FieldRow[]> {
  return (await getDb().prepare('SELECT * FROM sign_fields WHERE envelope_id = ? ORDER BY page, y, x, id').all(envId)) as FieldRow[];
}

export async function listEvents(envId: string): Promise<EventRow[]> {
  return (await getDb().prepare('SELECT * FROM sign_events WHERE envelope_id = ? ORDER BY created_at, id').all(envId)) as EventRow[];
}

export async function addEvent(
  envId: string,
  kind: string,
  o: { recipientId?: string | null; actorId?: string | null; ip?: string; ua?: string; detail?: Record<string, unknown> } = {},
): Promise<void> {
  await getDb()
    .prepare('INSERT INTO sign_events (id, envelope_id, recipient_id, actor_id, kind, ip, user_agent, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('sev'), envId, o.recipientId ?? null, o.actorId ?? null, kind, (o.ip ?? '').slice(0, 64), (o.ua ?? '').slice(0, 300), JSON.stringify(o.detail ?? {}), nowIso());
}

async function personName(id: string): Promise<{ name: string; email: string }> {
  const row = (await getDb().prepare('SELECT name, email FROM users WHERE id = ?').get(id)) as { name: string | null; email: string } | undefined;
  return { name: row?.name || row?.email?.split('@')[0] || 'zerosoft', email: row?.email ?? '' };
}

/** Sobre que la persona puede ver (o null: para ella no existe). */
export async function requireSee(actor: SignActor, id: string): Promise<{ env: EnvelopeRow; recipients: RecipientRow[] }> {
  const env = await getEnvelopeRow(actor.ws, id);
  if (!env) throw new SignError('not_found', 404);
  const recipients = await listRecipients(env.id);
  if (!canSeeEnvelope(actor, env, recipients.map((r) => r.email))) throw new SignError('not_found', 404);
  // Un borrador es solo de quien lo arma (y de los admins): un destinatario todavía no recibió nada.
  if (env.status === 'draft' && !canManageEnvelope(actor, env)) throw new SignError('not_found', 404);
  return { env, recipients };
}

export async function requireManage(actor: SignActor, id: string): Promise<{ env: EnvelopeRow; recipients: RecipientRow[] }> {
  const res = await requireSee(actor, id);
  if (!canManageEnvelope(actor, res.env)) throw new SignError('forbidden', 403);
  return res;
}

// ---------- DTO ----------

export function recipientDto(r: RecipientRow, current: boolean) {
  return {
    id: r.id,
    role: r.role,
    roleName: r.role_name,
    name: r.name,
    email: r.email,
    routingOrder: r.routing_order,
    status: r.status,
    current,
    notifiedAt: r.notified_at,
    viewedAt: r.viewed_at,
    signedAt: r.signed_at,
    declinedAt: r.declined_at,
    declineReason: r.decline_reason,
    otpVerifiedAt: r.otp_verified_at,
  };
}

export function fieldDto(f: FieldRow, withValue: boolean) {
  return {
    id: f.id,
    recipientId: f.recipient_id,
    kind: f.kind,
    page: f.page,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    required: f.required === 1,
    label: f.label,
    options: parseOptions(f.options),
    value: withValue ? f.value : null,
  };
}

export function eventDto(e: EventRow, recipients: RecipientRow[]) {
  const r = recipients.find((x) => x.id === e.recipient_id);
  return { id: e.id, kind: e.kind, at: e.created_at, recipient: r ? { name: r.name, email: r.email } : null, ip: e.ip, userAgent: e.user_agent, detail: parseJson<Record<string, unknown>>(e.detail, {}) };
}

export async function envelopeDto(actor: SignActor, env: EnvelopeRow, recipients: RecipientRow[], opts: { fields?: boolean; events?: boolean } = {}) {
  const active = env.status === 'sent' ? new Set(activeRecipients(recipients, env.signing_order).map((r) => r.id)) : new Set<string>();
  const sender = await personName(env.created_by);
  const fields = opts.fields ? await listFields(env.id) : [];
  const events = opts.events ? await listEvents(env.id) : [];
  const me = actor.email.toLowerCase();
  return {
    id: env.id,
    title: env.title,
    message: env.message,
    status: env.status,
    signingOrder: env.signing_order,
    otpRequired: env.otp_required === 1,
    expiresDays: env.expires_days,
    expiresAt: env.expires_at,
    reminderDays: env.reminder_days,
    locale: env.locale,
    documentName: env.document_name,
    hasDocument: Boolean(env.document_ref),
    hasFinal: Boolean(env.final_ref),
    documentHash: env.document_hash,
    uploadHash: env.upload_hash,
    flattenedHash: env.flattened_hash,
    finalHash: env.final_hash,
    pages: parseJson<PageBox[]>(env.pages, []),
    source: env.source,
    links: parseJson<EnvelopeLink[]>(env.links, []),
    templateId: env.template_id,
    bulkId: env.bulk_id,
    createdBy: env.created_by,
    senderName: sender.name,
    senderEmail: sender.email,
    canManage: canManageEnvelope(actor, env),
    canDelete: canManageEnvelope(actor, env) && env.status !== 'sent' && (env.status !== 'completed' || actor.admin),
    waitingOnMe: env.status === 'sent' && recipients.some((r) => active.has(r.id) && r.email.toLowerCase() === me),
    sentAt: env.sent_at,
    completedAt: env.completed_at,
    declinedAt: env.declined_at,
    voidedAt: env.voided_at,
    voidReason: env.void_reason,
    expiredAt: env.expired_at,
    createdAt: env.created_at,
    updatedAt: env.updated_at,
    recipients: recipients.map((r) => recipientDto(r, active.has(r.id))),
    fields: fields.map((f) => fieldDto(f, env.status !== 'draft')),
    events: events.map((e) => eventDto(e, recipients)),
  };
}
export type EnvelopeDto = Awaited<ReturnType<typeof envelopeDto>>;

// ---------- Listado ----------

export type SignBox = 'all' | 'action' | 'waiting' | 'completed' | 'closed' | 'drafts';
export const SIGN_BOXES: SignBox[] = ['all', 'action', 'waiting', 'completed', 'closed', 'drafts'];

export interface EnvelopeListItem {
  id: string;
  title: string;
  status: EnvelopeStatus;
  box: Exclude<SignBox, 'all'>;
  recipients: Array<{ name: string; email: string; status: RecipientStatus; role: RecipientRole }>;
  senderName: string;
  mine: boolean;
  updatedAt: string;
  sentAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
}

/** Caja de un sobre para quien mira: "esperan mi firma" va primero. */
export function boxOf(env: Pick<EnvelopeRow, 'status' | 'signing_order'>, recipients: Array<Pick<RecipientRow, 'id' | 'email' | 'role' | 'routing_order' | 'status'>>, myEmail: string): Exclude<SignBox, 'all'> {
  if (env.status === 'draft') return 'drafts';
  if (env.status === 'completed') return 'completed';
  if (env.status !== 'sent') return 'closed';
  const me = myEmail.trim().toLowerCase();
  const active = activeRecipients(recipients as RecipientRow[], env.signing_order);
  return me && active.some((r) => r.email.toLowerCase() === me) ? 'action' : 'waiting';
}

/** Sobres que la persona ve, con su caja. Filtra por caja y por texto (título, nombre o email). */
export async function listEnvelopes(actor: SignActor, opts: { box?: SignBox; q?: string; limit?: number } = {}): Promise<EnvelopeListItem[]> {
  const db = getDb();
  const me = actor.email.trim().toLowerCase();
  const args: Array<string | number> = [actor.ws];
  let where = 'e.workspace_id = ?';
  if (!actor.admin) {
    where += ' AND (e.created_by = ? OR EXISTS (SELECT 1 FROM sign_recipients rr WHERE rr.envelope_id = e.id AND lower(rr.email) = ?))';
    args.push(actor.person, me || '-');
  }
  const q = (opts.q ?? '').trim().toLowerCase().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where += " AND (lower(e.title) LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM sign_recipients rq WHERE rq.envelope_id = e.id AND (lower(rq.name) LIKE ? ESCAPE '\\' OR lower(rq.email) LIKE ? ESCAPE '\\')))";
    args.push(like, like, like);
  }
  const rows = (await db.prepare(`SELECT e.* FROM sign_envelopes e WHERE ${where} ORDER BY e.updated_at DESC LIMIT ?`).all(...args, Math.min(opts.limit ?? 300, 500))) as EnvelopeRow[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const recs = (await db.prepare(`SELECT * FROM sign_recipients WHERE envelope_id IN (${ids.map(() => '?').join(',')}) ORDER BY routing_order, created_at`).all(...ids)) as RecipientRow[];
  const byEnv = new Map<string, RecipientRow[]>();
  for (const r of recs) byEnv.set(r.envelope_id, [...(byEnv.get(r.envelope_id) ?? []), r]);
  const senders = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.created_by))) senders.set(id, (await personName(id)).name);
  const items = rows.map((e) => {
    const rs = byEnv.get(e.id) ?? [];
    return {
      id: e.id,
      title: e.title,
      status: e.status,
      box: boxOf(e, rs, me),
      recipients: rs.map((r) => ({ name: r.name, email: r.email, status: r.status, role: r.role })),
      senderName: senders.get(e.created_by) ?? '',
      mine: e.created_by === actor.person,
      updatedAt: e.updated_at,
      sentAt: e.sent_at,
      completedAt: e.completed_at,
      expiresAt: e.expires_at,
    } satisfies EnvelopeListItem;
  });
  // Un borrador ajeno no le interesa a un destinatario (todavía no le llegó nada).
  const visible = items.filter((i) => i.box !== 'drafts' || rows.find((r) => r.id === i.id)!.created_by === actor.person || actor.admin);
  return opts.box && opts.box !== 'all' ? visible.filter((i) => i.box === opts.box) : visible;
}

export function countBoxes(items: EnvelopeListItem[]): Record<SignBox, number> {
  const out: Record<SignBox, number> = { all: items.length, action: 0, waiting: 0, completed: 0, closed: 0, drafts: 0 };
  for (const i of items) out[i.box]++;
  return out;
}

// ---------- Crear y editar ----------

export interface CreateEnvelopeInput {
  title: string;
  message?: string;
  locale?: string;
  source?: string;
  links?: EnvelopeLink[];
  templateId?: string | null;
  bulkId?: string | null;
  /** Clave por fila del envío masivo: la misma fila no crea dos sobres aunque se reintente. */
  bulkKey?: string | null;
  signingOrder?: SigningOrder;
  otpRequired?: boolean;
  expiresDays?: number;
  reminderDays?: number;
}

export async function createEnvelope(actor: SignActor, input: CreateEnvelopeInput): Promise<EnvelopeRow> {
  const id = newId('env');
  const ts = nowIso();
  const title = input.title.trim().slice(0, 200) || 'Untitled';
  await getDb()
    .prepare(
      `INSERT INTO sign_envelopes (id, workspace_id, created_by, title, message, status, signing_order, otp_required, expires_days, reminder_days, locale, source, links, template_id, bulk_id, bulk_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      actor.ws,
      actor.person,
      title,
      (input.message ?? '').slice(0, 4000),
      input.signingOrder === 'parallel' ? 'parallel' : 'sequential',
      input.otpRequired === false ? 0 : 1,
      clampDays(input.expiresDays ?? 30, 1, 365),
      clampDays(input.reminderDays ?? 0, 0, 30),
      signLocale(input.locale),
      (input.source ?? 'upload').slice(0, 20),
      JSON.stringify((input.links ?? []).slice(0, 10)),
      input.templateId ?? null,
      input.bulkId ?? null,
      input.bulkKey ?? null,
      ts,
      ts,
    );
  await addEvent(id, 'created', { actorId: actor.person });
  return (await getEnvelopeRow(actor.ws, id))!;
}

function clampDays(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
}

/** Guarda un PDF (limpio) como documento del borrador. Los campos de páginas que ya no existen se borran. */
export async function setDocument(actor: SignActor, id: string, file: { bytes: Buffer; name: string }): Promise<EnvelopeRow> {
  const { env } = await requireManage(actor, id);
  assertEditable(env);
  const clean = await sanitizePdf(file.bytes);
  const ref = await storeSignFile(clean.bytes, 'application/pdf');
  const ts = nowIso();
  const res = await getDb()
    .prepare("UPDATE sign_envelopes SET document_ref = ?, document_name = ?, document_hash = ?, upload_hash = ?, pages = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
    .run(ref, file.name.slice(0, 200), sha256Hex(clean.bytes), sha256Hex(file.bytes), JSON.stringify(clean.pages), ts, env.id);
  if (!res.changes) {
    await deleteSignFiles([ref]);
    throw new SignError('envelope_locked', 409);
  }
  await getDb().prepare('DELETE FROM sign_fields WHERE envelope_id = ? AND page > ?').run(env.id, clean.pages.length);
  if (env.document_ref) await deleteSignFiles([env.document_ref]);
  await addEvent(env.id, 'document', { actorId: actor.person, detail: { name: file.name.slice(0, 200), pages: clean.pages.length } });
  return (await getEnvelopeRow(actor.ws, env.id))!;
}

export interface EnvelopePatch {
  title?: string;
  message?: string;
  signingOrder?: SigningOrder;
  otpRequired?: boolean;
  expiresDays?: number;
  reminderDays?: number;
}

export async function updateEnvelope(actor: SignActor, id: string, patch: EnvelopePatch): Promise<EnvelopeRow> {
  const { env } = await requireManage(actor, id);
  assertEditable(env);
  const next = {
    title: patch.title !== undefined ? patch.title.trim().slice(0, 200) || env.title : env.title,
    message: patch.message !== undefined ? patch.message.slice(0, 4000) : env.message,
    signing_order: patch.signingOrder ?? env.signing_order,
    otp_required: patch.otpRequired === undefined ? env.otp_required : patch.otpRequired ? 1 : 0,
    expires_days: patch.expiresDays !== undefined ? clampDays(patch.expiresDays, 1, 365) : env.expires_days,
    reminder_days: patch.reminderDays !== undefined ? clampDays(patch.reminderDays, 0, 30) : env.reminder_days,
  };
  const res = await getDb()
    .prepare("UPDATE sign_envelopes SET title = ?, message = ?, signing_order = ?, otp_required = ?, expires_days = ?, reminder_days = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
    .run(next.title, next.message, next.signing_order, next.otp_required, next.expires_days, next.reminder_days, nowIso(), env.id);
  if (!res.changes) throw new SignError('envelope_locked', 409);
  return (await getEnvelopeRow(actor.ws, env.id))!;
}

export interface RecipientInput {
  id?: string;
  role: RecipientRole;
  name: string;
  email: string;
  routingOrder: number;
  roleName?: string;
}

/** Reemplaza la lista de destinatarios del borrador (los que salen se llevan sus campos). */
export async function saveRecipients(actor: SignActor, id: string, list: RecipientInput[]): Promise<RecipientRow[]> {
  const { env, recipients } = await requireManage(actor, id);
  assertEditable(env);
  if (list.length > 50) throw new SignError('too_many_recipients');
  for (const r of list) {
    if (!RECIPIENT_ROLES.includes(r.role)) throw new SignError('invalid_input');
    if (!r.name.trim()) throw new SignError('recipient_name');
    if (!isEmail(r.email.trim())) throw new SignError('recipient_email', 400, { email: r.email });
  }
  const db = getDb();
  const keep = new Set(list.map((r) => r.id).filter((x): x is string => Boolean(x) && recipients.some((o) => o.id === x)));
  for (const old of recipients) if (!keep.has(old.id)) await db.prepare('DELETE FROM sign_recipients WHERE id = ? AND envelope_id = ?').run(old.id, env.id);
  const ts = nowIso();
  for (const r of list) {
    const order = env.signing_order === 'parallel' ? 1 : Math.min(50, Math.max(1, Math.round(r.routingOrder || 1)));
    if (r.id && keep.has(r.id)) {
      await db
        .prepare('UPDATE sign_recipients SET role = ?, name = ?, email = ?, routing_order = ?, role_name = ? WHERE id = ? AND envelope_id = ?')
        .run(r.role, r.name.trim().slice(0, 120), r.email.trim().toLowerCase(), order, (r.roleName ?? '').slice(0, 60), r.id, env.id);
      // Un CC no completa campos.
      if (r.role === 'cc') await db.prepare('DELETE FROM sign_fields WHERE recipient_id = ?').run(r.id);
    } else {
      await db
        .prepare('INSERT INTO sign_recipients (id, envelope_id, role, role_name, name, email, routing_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(newId('rcp'), env.id, r.role, (r.roleName ?? '').slice(0, 60), r.name.trim().slice(0, 120), r.email.trim().toLowerCase(), order, ts);
    }
  }
  await db.prepare('UPDATE sign_envelopes SET updated_at = ? WHERE id = ?').run(ts, env.id);
  return listRecipients(env.id);
}

export interface FieldInput {
  recipientId: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required?: boolean;
  label?: string;
  options?: string[];
}

export function cleanFieldInput(f: FieldInput, pageCount: number): Omit<FieldInput, 'recipientId'> & { required: boolean; label: string; options: string[] } {
  if (!FIELD_KINDS.includes(f.kind)) throw new SignError('invalid_field');
  const page = Math.round(f.page);
  if (!(page >= 1 && page <= pageCount)) throw new SignError('invalid_field');
  const box = clampBox(f);
  const options = f.kind === 'dropdown' ? [...new Set((f.options ?? []).map((o) => String(o).trim().slice(0, 100)).filter(Boolean))].slice(0, 50) : [];
  if (f.kind === 'dropdown' && !options.length) throw new SignError('dropdown_options');
  // Fecha, nombre y email los completa el servidor: siempre "obligatorios".
  const required = ['date', 'name', 'email'].includes(f.kind) ? true : f.required !== false;
  return { kind: f.kind, page, ...box, required, label: (f.label ?? '').trim().slice(0, 80), options };
}

/** Reemplaza los campos del borrador. Cada campo es de un destinatario que firma o aprueba. */
export async function saveFields(actor: SignActor, id: string, list: FieldInput[]): Promise<FieldRow[]> {
  const { env, recipients } = await requireManage(actor, id);
  assertEditable(env);
  if (list.length > 500) throw new SignError('too_many_fields');
  const pages = parseJson<PageBox[]>(env.pages, []);
  const db = getDb();
  const rows = list.map((f) => {
    const r = recipients.find((x) => x.id === f.recipientId);
    if (!r || r.role === 'cc') throw new SignError('invalid_field_recipient');
    return { recipientId: r.id, ...cleanFieldInput(f, pages.length) };
  });
  await db.prepare('DELETE FROM sign_fields WHERE envelope_id = ?').run(env.id);
  for (const f of rows) {
    await db
      .prepare('INSERT INTO sign_fields (id, envelope_id, recipient_id, kind, page, x, y, w, h, required, label, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('fld'), env.id, f.recipientId, f.kind, f.page, f.x, f.y, f.w, f.h, f.required ? 1 : 0, f.label, JSON.stringify(f.options));
  }
  await db.prepare('UPDATE sign_envelopes SET updated_at = ? WHERE id = ?').run(nowIso(), env.id);
  return listFields(env.id);
}

/** Qué le falta a un borrador para enviarse (vacío = listo). */
export function sendProblems(env: Pick<EnvelopeRow, 'document_ref'>, recipients: RecipientRow[], fields: FieldRow[]): string[] {
  const out: string[] = [];
  if (!env.document_ref) out.push('no_document');
  const acting = recipients.filter((r) => r.role !== 'cc');
  if (!acting.length) out.push('no_signers');
  for (const r of recipients.filter((x) => x.role === 'signer')) {
    if (!fields.some((f) => f.recipient_id === r.id && f.kind === 'signature')) out.push(`no_signature_field:${r.id}`);
  }
  const emails = recipients.map((r) => `${r.role}:${r.email}`);
  if (new Set(emails).size !== emails.length) out.push('duplicate_recipient');
  return out;
}

// ---------- Emails ----------

async function deliver(env: EnvelopeRow, to: string, subjectKey: SignCopyKey, lines: string[], vars: Record<string, string>, extra: { link?: string; linkLabel?: string; attachment?: { name: string; bytes: Buffer } } = {}): Promise<boolean> {
  const locale = signLocale(env.locale);
  const subject = signCopy(locale, subjectKey, vars);
  const paragraphs = lines.map((l) => escapeHtml(l));
  if (extra.link) paragraphs.push(`<a href="${escapeHtml(extra.link)}" style="color:#000000;font-weight:500;">${escapeHtml(extra.linkLabel ?? extra.link)}</a>`);
  paragraphs.push(`<span style="color:#888888;font-size:12px;">${escapeHtml(signCopy(locale, 'legal'))}</span>`);
  const text = [...lines, ...(extra.link ? [extra.link] : []), '', signCopy(locale, 'legal')].join('\n');
  const res = await sendEmail({
    to,
    from: appSender(),
    subject,
    text,
    html: renderBrandedHtml({ heading: subject, paragraphs, eyebrow: signCopy(locale, 'eyebrow') }),
    attachments: extra.attachment ? [{ filename: extra.attachment.name, content: extra.attachment.bytes.toString('base64'), contentType: 'application/pdf', encoding: 'base64' }] : undefined,
  }).catch(() => ({ ok: false }));
  return res.ok;
}

/** Link de un destinatario: el token se arma del nonce guardado; si no hay, se crea uno. */
export async function recipientToken(r: RecipientRow, rotate = false): Promise<string> {
  let nonce = r.token_nonce;
  if (!nonce || rotate) {
    nonce = randomBytes(12).toString('base64url');
    // Un token nuevo invalida la sesión con código de la anterior.
    await getDb().prepare('UPDATE sign_recipients SET token_nonce = ?, token_hash = ?, session_hash = NULL WHERE id = ?').run(nonce, hashToken(signingToken(r.id, nonce)), r.id);
  }
  return signingToken(r.id, nonce);
}

/** Avisa a un destinatario que le toca (invitación o recordatorio). */
export async function notifyRecipient(env: EnvelopeRow, r: RecipientRow, kind: 'invite' | 'reminder', opts: { rotate?: boolean } = {}): Promise<void> {
  const locale = signLocale(env.locale);
  const sender = await personName(env.created_by);
  const token = await recipientToken(r, opts.rotate);
  const link = signingLink(locale, token);
  const vars = { sender: sender.name, senderEmail: sender.email, title: env.title, date: env.expires_at ? formatDate(env.expires_at, locale) : '' };
  const lines = [
    signCopy(locale, kind === 'reminder' ? 'reminderLine' : r.role === 'approver' ? 'approveLine' : 'inviteLine', vars),
    ...(env.message.trim() ? [env.message.trim()] : []),
    ...(env.expires_at ? [signCopy(locale, 'expires', vars)] : []),
  ];
  await deliver(env, r.email, kind === 'reminder' ? 'reminderSubject' : r.role === 'approver' ? 'approveSubject' : 'inviteSubject', lines, vars, { link, linkLabel: signCopy(locale, 'open') });
  const ts = nowIso();
  if (kind === 'invite') {
    await getDb().prepare("UPDATE sign_recipients SET status = CASE WHEN status = 'created' THEN 'sent' ELSE status END, notified_at = COALESCE(notified_at, ?), reminded_at = ? WHERE id = ?").run(ts, ts, r.id);
  } else {
    await getDb().prepare('UPDATE sign_recipients SET reminded_at = ? WHERE id = ?').run(ts, r.id);
  }
  await addEvent(env.id, kind === 'invite' ? 'notified' : 'reminded', { recipientId: r.id, detail: { rotated: Boolean(opts.rotate) } });
}

/** Aviso dentro de la app para quien envió. */
export async function notifySender(env: EnvelopeRow, key: SignCopyKey, vars: Record<string, string> = {}): Promise<void> {
  await createNotification({
    userId: env.created_by,
    type: 'sign_activity',
    title: env.title.slice(0, 200),
    body: signCopy(signLocale(env.locale), key, vars).slice(0, 300),
    href: `/app/sign/envelopes/${env.id}`,
    sourceType: 'sign',
    sourceId: env.id,
  }).catch(() => null);
}

export async function emailTo(env: EnvelopeRow, to: string, subjectKey: SignCopyKey, lines: string[], vars: Record<string, string>, attachment?: { name: string; bytes: Buffer }): Promise<void> {
  await deliver(env, to, subjectKey, lines, vars, { attachment });
}

export { personName };

// ---------- Enviar, anular, copiar, borrar, recordar ----------

/** Avisa a los que les toca ahora y todavía no recibieron el link. */
export async function notifyActive(env: EnvelopeRow): Promise<void> {
  const recipients = await listRecipients(env.id);
  for (const r of activeRecipients(recipients, env.signing_order)) {
    if (r.status === 'created') await notifyRecipient(env, r, 'invite');
  }
}

export async function sendEnvelope(actor: SignActor, id: string): Promise<EnvelopeRow> {
  const { env, recipients } = await requireManage(actor, id);
  assertEditable(env);
  const problems = sendProblems(env, recipients, await listFields(env.id));
  if (problems.length) throw new SignError('not_ready', 400, { problems });
  const ts = nowIso();
  const expires = new Date(Date.now() + env.expires_days * 86_400_000).toISOString();
  const res = await getDb().prepare("UPDATE sign_envelopes SET status = 'sent', sent_at = ?, expires_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'").run(ts, expires, ts, env.id);
  if (!res.changes) throw new SignError('envelope_locked', 409);
  await addEvent(env.id, 'sent', { actorId: actor.person, detail: { documentHash: env.document_hash } });
  const sent = (await getEnvelopeRow(actor.ws, env.id))!;
  await notifyActive(sent);
  return sent;
}

export async function voidEnvelope(actor: SignActor, id: string, reason: string): Promise<EnvelopeRow> {
  const { env, recipients } = await requireManage(actor, id);
  return voidRow(env, recipients, reason, actor.person);
}

/**
 * Anula desde otra app que ya validó el permiso (Hiring retira la oferta que
 * salió a firmar). Nada si el sobre no está enviado.
 */
export async function voidEnvelopeFromApp(ws: string, id: string, reason: string, actorId: string): Promise<boolean> {
  const env = await getEnvelopeRow(ws, id);
  if (!env || env.status !== 'sent') return false;
  await voidRow(env, await listRecipients(env.id), reason, actorId).catch(() => null);
  return true;
}

async function voidRow(env: EnvelopeRow, recipients: RecipientRow[], reason: string, actorId: string): Promise<EnvelopeRow> {
  if (env.status !== 'sent') throw new SignError('invalid_state', 409);
  const ts = nowIso();
  const res = await getDb().prepare("UPDATE sign_envelopes SET status = 'voided', voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ? AND status = 'sent'").run(ts, reason.slice(0, 500), ts, env.id);
  if (!res.changes) throw new SignError('invalid_state', 409);
  await addEvent(env.id, 'voided', { actorId, detail: { reason: reason.slice(0, 500) } });
  const sender = await personName(env.created_by);
  const locale = signLocale(env.locale);
  for (const r of recipients.filter((x) => x.notified_at)) {
    await emailTo(env, r.email, 'voidedSubject', [signCopy(locale, 'voidedLine', { sender: sender.name, title: env.title }), ...(reason ? [signCopy(locale, 'reason', { reason })] : [])], { title: env.title });
  }
  const voided = (await getEnvelopeRow(env.workspace_id, env.id))!;
  // Otras apps (una oferta de Hiring vuelve a "aprobada").
  const { runSignHooks } = await import('./hooks');
  await runSignHooks('voided', voided, null);
  return voided;
}

/** Copia a un borrador nuevo (mismo documento, destinatarios y campos): así se "corrige" un sobre enviado. */
export async function copyEnvelope(actor: SignActor, id: string): Promise<EnvelopeRow> {
  const { env, recipients } = await requireManage(actor, id);
  const fresh = await createEnvelope(actor, {
    title: env.title,
    message: env.message,
    locale: env.locale,
    source: env.source,
    links: parseJson<EnvelopeLink[]>(env.links, []),
    templateId: env.template_id,
    signingOrder: env.signing_order,
    otpRequired: env.otp_required === 1,
    expiresDays: env.expires_days,
    reminderDays: env.reminder_days,
  });
  const db = getDb();
  if (env.document_ref) {
    const bytes = await readSignFile(env.document_ref);
    if (bytes) {
      const ref = await storeSignFile(bytes, 'application/pdf');
      await db.prepare('UPDATE sign_envelopes SET document_ref = ?, document_name = ?, document_hash = ?, upload_hash = ?, pages = ? WHERE id = ?').run(ref, env.document_name, env.document_hash, env.upload_hash, env.pages, fresh.id);
    }
  }
  const map = new Map<string, string>();
  const ts = nowIso();
  for (const r of recipients) {
    const nid = newId('rcp');
    map.set(r.id, nid);
    await db.prepare('INSERT INTO sign_recipients (id, envelope_id, role, role_name, name, email, routing_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(nid, fresh.id, r.role, r.role_name, r.name, r.email, r.routing_order, ts);
  }
  for (const f of await listFields(env.id)) {
    const rid = map.get(f.recipient_id);
    if (!rid) continue;
    await db.prepare('INSERT INTO sign_fields (id, envelope_id, recipient_id, kind, page, x, y, w, h, required, label, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(newId('fld'), fresh.id, rid, f.kind, f.page, f.x, f.y, f.w, f.h, f.required, f.label, f.options);
  }
  await addEvent(fresh.id, 'copied', { actorId: actor.person, detail: { from: env.id } });
  return (await getEnvelopeRow(actor.ws, fresh.id))!;
}

/** Borra un sobre que no está en curso (un enviado se anula primero). */
export async function deleteEnvelope(actor: SignActor, id: string): Promise<void> {
  const { env } = await requireManage(actor, id);
  if (env.status === 'sent') throw new SignError('void_first', 409);
  // Un sobre completo es un registro firmado: solo un admin lo borra (la UI pide confirmación).
  if (env.status === 'completed' && !actor.admin) throw new SignError('admin_only', 403);
  const res = await getDb().prepare("DELETE FROM sign_envelopes WHERE id = ? AND status != 'sent'").run(env.id);
  if (!res.changes) throw new SignError('void_first', 409);
  await deleteSignFiles([env.document_ref, env.final_ref]);
}

/** Reenvía el link a quienes les toca ahora (o a uno). Con rotate, el link anterior deja de servir. */
export async function remindEnvelope(actor: SignActor, id: string, opts: { recipientId?: string | null; rotate?: boolean } = {}): Promise<number> {
  const { env, recipients } = await requireManage(actor, id);
  if (env.status !== 'sent') throw new SignError('invalid_state', 409);
  const targets = activeRecipients(recipients, env.signing_order).filter((r) => !opts.recipientId || r.id === opts.recipientId);
  if (!targets.length) throw new SignError('not_found', 404);
  for (const r of targets) await notifyRecipient(env, r, r.notified_at ? 'reminder' : 'invite', { rotate: opts.rotate });
  if (opts.rotate) await addEvent(env.id, 'link_revoked', { actorId: actor.person, detail: { recipients: targets.map((r) => r.id) } });
  return targets.length;
}

/** Link para firmar desde la app cuando el sobre espera a esta persona (mismo email). */
export async function signLinkForMe(actor: SignActor, id: string): Promise<string> {
  const { env, recipients } = await requireSee(actor, id);
  if (env.status !== 'sent') throw new SignError('invalid_state', 409);
  const me = actor.email.toLowerCase();
  const r = activeRecipients(recipients, env.signing_order).find((x) => x.email.toLowerCase() === me);
  if (!r) throw new SignError('not_your_turn', 403);
  const token = await recipientToken(r);
  return `/${signLocale(env.locale)}/sign/${token}`;
}

/** Bytes del original o del firmado, para quien puede ver el sobre. */
export async function envelopeFile(actor: SignActor, id: string, which: 'original' | 'final'): Promise<{ bytes: Buffer; name: string }> {
  const { env } = await requireSee(actor, id);
  const ref = which === 'final' ? env.final_ref : env.document_ref;
  if (!ref) throw new SignError('not_found', 404);
  const bytes = await readSignFile(ref);
  if (!bytes) throw new SignError('file_unavailable', 404);
  const base = (env.document_name || env.title).replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'document';
  return { bytes, name: which === 'final' ? `${base}-signed.pdf` : `${base}.pdf` };
}

// ---------- ⌘K ----------

export async function searchSign(actor: SignActor, q: string): Promise<Array<{ kind: 'envelope' | 'template'; id: string; label: string; meta: string; href: string }>> {
  const term = q.trim();
  if (!term) return [];
  const envs = (await listEnvelopes(actor, { q: term, limit: 8 })).slice(0, 8);
  const like = `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const tpls = (await getDb()
    .prepare(`SELECT id, name, description FROM sign_templates WHERE workspace_id = ? AND (lower(name) LIKE ? ESCAPE '\\' OR lower(description) LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 6`)
    .all(actor.ws, like, like)) as Array<{ id: string; name: string; description: string }>;
  return [
    ...envs.map((e) => ({ kind: 'envelope' as const, id: e.id, label: e.title, meta: e.recipients.map((r) => r.name).join(', '), href: `/app/sign/envelopes/${e.id}` })),
    ...tpls.map((t) => ({ kind: 'template' as const, id: t.id, label: t.name, meta: t.description.slice(0, 80), href: `/app/sign/templates/${t.id}` })),
  ];
}

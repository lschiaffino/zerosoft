/**
 * Forms: respuestas. Envío público (validación con el motor, anti-spam,
 * tope de respuestas atómico, límite por IP), respuestas parciales con
 * consentimiento, archivos privados, visitas para el abandono, la tabla con
 * filtros, el CSV, el resumen por pregunta y la retención. Server-only.
 */
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db';
import { looksLikeSpam } from '../form-engine';
import { accessibleRow, definitionOf, getPublicFormRow, openState, settingsOf, type FormRow } from './core';
import { checkResponse, cleanPartial, dropOff, localize, pickLang, responsesCsv, summarize, type AnswerError, type CsvRow, type DisplayLabels, type QuestionSummary } from './engine';
import { checkRenderToken } from './render-token';
import { FORMS_FILE_MAX_BYTES, deleteFormFiles, safeFileName, sniffFormFile, storeFormFile } from './files';
import { FormsError, newId, type AnswerValue, type Answers, type FileAnswer, type FormDefinition, type FormsActor } from './types';

const nowIso = () => new Date().toISOString();

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(raw ?? '');
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function hashIp(ip: string): string {
  return ip && ip !== 'unknown' ? createHash('sha256').update(`${process.env.NEXTAUTH_SECRET ?? ''}:forms:${ip}`).digest('hex').slice(0, 32) : '';
}

const hashToken = (t: string) => createHash('sha256').update(`forms-resume:${t}`).digest('hex');

// ---------- Archivos (subida pública) ----------

/**
 * Sube un archivo para una pregunta de archivo de un form abierto. Queda sin
 * respuesta hasta el envío (el cron borra los huérfanos al día). Devuelve el
 * id que el envío referencia: solo sirve para ese form y esa pregunta.
 */
export async function uploadPublicFile(slug: string, questionId: string, file: { bytes: Buffer; filename: string }): Promise<FileAnswer> {
  const row = await getPublicFormRow(slug);
  if (!row) throw new FormsError('not_found', 404);
  if (openState(row, settingsOf(row))) throw new FormsError('closed', 409);
  const q = definitionOf(row).questions.find((x) => x.id === questionId);
  if (!q || q.type !== 'file_upload') throw new FormsError('invalid_question');
  const max = Math.min((q.maxMb ?? 10) * 1024 * 1024, FORMS_FILE_MAX_BYTES);
  if (file.bytes.length === 0 || file.bytes.length > max) throw new FormsError('file_size', 413, { maxMb: Math.round(max / 1024 / 1024) });
  const kind = sniffFormFile(new Uint8Array(file.bytes.subarray(0, 16)), file.filename);
  if (!kind) throw new FormsError('file_type', 415);
  const ref = await storeFormFile(file.bytes, kind.mime);
  const id = newId('fmf_');
  const name = safeFileName(file.filename, kind.ext);
  await getDb()
    .prepare('INSERT INTO forms_files (id, workspace_id, form_id, question_id, response_id, ref, name, mime, size, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)')
    .run(id, row.workspace_id, row.id, questionId, ref, name, kind.mime, file.bytes.length, nowIso());
  return { fileId: id, name, size: file.bytes.length };
}

async function signatureToFile(row: FormRow, questionId: string, dataUrl: string): Promise<FileAnswer | null> {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  if (!bytes.length || bytes.length > 300_000 || sniffFormFile(new Uint8Array(bytes.subarray(0, 16)), 'signature.png')?.mime !== 'image/png') return null;
  const ref = await storeFormFile(bytes, 'image/png');
  const id = newId('fmf_');
  await getDb()
    .prepare('INSERT INTO forms_files (id, workspace_id, form_id, question_id, response_id, ref, name, mime, size, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)')
    .run(id, row.workspace_id, row.id, questionId, ref, 'signature.png', 'image/png', bytes.length, nowIso());
  return { fileId: id, name: 'signature.png', size: bytes.length };
}

// ---------- Envío ----------

export interface SubmitBody {
  answers: Record<string, unknown>;
  hidden?: Record<string, string>;
  lang?: string;
  consent?: boolean;
  /** Honeypot: los humanos no lo ven. */
  website_url?: string;
  /** Marca de render firmada por el servidor (lib/forms/render-token.ts). */
  renderToken?: string;
  /** Token de la respuesta parcial (si se guardaba el progreso). */
  resumeToken?: string;
  visitId?: string;
}

export type SubmitResult =
  | { ok: true; spam?: boolean; responseId?: string; endingId: string; vars: Record<string, number>; answers: Answers }
  | { ok: false; error: 'too_fast'; waitMs: number; renderToken: string }
  | { ok: false; error: 'not_found' | 'closed' | 'invalid' | 'consent' | 'ip_limit'; reason?: string; errors?: Record<string, AnswerError> };

/** Tope de respuestas parciales guardadas por formulario. */
export const MAX_PARTIALS_PER_FORM = 10_000;
/** Parciales abiertas por IP (hash) y formulario. */
export const MAX_OPEN_PARTIALS_PER_IP = 3;
/** Tamaño máximo del JSON de respuestas de una parcial. */
export const MAX_PARTIAL_BYTES = 200_000;
/** Las parciales abandonadas se borran a los 30 días, sea cual sea la retención. */
export const PARTIAL_TTL_DAYS = 30;

/**
 * Envío público. El honeypot responde "ok" sin guardar (no le da pistas a un
 * bot). El tiempo mínimo se mide desde la marca de render firmada por el
 * servidor: si falta, no verifica o es demasiado pronto, responde too_fast
 * con lo que falta esperar (y una marca nueva si hacía falta); el cliente
 * espera y reintenta una vez, así un humano rápido no pierde su respuesta.
 *
 * El límite por IP usa la IP de clientIp() (lib/rate-limit.ts): detrás de un
 * proxy propio, el proxy tiene que mandar X-Forwarded-For y TRUST_PROXY
 * quedar sin tocar; con TRUST_PROXY=0 todas las IPs son "unknown" y el
 * límite por IP no aplica.
 */
export async function submitResponse(slug: string, body: SubmitBody, meta: { ip?: string; userAgent?: string } = {}): Promise<SubmitResult> {
  const db = getDb();
  const row = await getPublicFormRow(slug);
  if (!row) return { ok: false, error: 'not_found' };
  const settings = settingsOf(row);
  const reason = openState(row, settings);
  if (reason) return { ok: false, error: 'closed', reason };
  const def = definitionOf(row);
  const hidden: Record<string, string> = {};
  for (const h of def.hidden) if (typeof body.hidden?.[h] === 'string') hidden[h] = body.hidden[h].slice(0, 300);
  if (looksLikeSpam({ honeypot: body.website_url, minSeconds: 0 })) {
    return { ok: true, spam: true, endingId: def.endings[0]?.id ?? '', vars: {}, answers: {} };
  }
  const timing = checkRenderToken(row.slug, body.renderToken);
  if (!timing.ok) return { ok: false, error: 'too_fast', waitMs: timing.waitMs, renderToken: timing.token };
  if (def.consent.enabled && def.consent.required && !body.consent) return { ok: false, error: 'consent' };
  const checked = checkResponse(def, body.answers ?? {}, hidden);
  if (Object.keys(checked.errors).length) return { ok: false, error: 'invalid', errors: checked.errors };
  const ipHash = hashIp(meta.ip ?? '');
  // Archivos: cada uno tiene que ser de este form y esta pregunta, sin usar.
  const files: string[] = [];
  for (const q of def.questions) {
    const a = checked.answers[q.id];
    if (q.type === 'file_upload' && a) {
      const f = a as FileAnswer;
      const ok = (await db.prepare('SELECT name, size FROM forms_files WHERE id = ? AND form_id = ? AND question_id = ? AND response_id IS NULL').get(f.fileId, row.id, q.id)) as { name: string; size: number } | undefined;
      if (!ok) return { ok: false, error: 'invalid', errors: { [q.id]: 'invalid' } };
      checked.answers[q.id] = { fileId: f.fileId, name: ok.name, size: Number(ok.size) };
      files.push(f.fileId);
    }
  }

  // Tope de respuestas: el contador sube solo si queda lugar (compare-and-set
  // en una sola sentencia). Dos envíos a la vez nunca pasan el tope.
  const claim = await db
    .prepare('UPDATE forms_forms SET response_count = response_count + 1 WHERE id = ? AND (? = 0 OR response_count < ?)')
    .run(row.id, settings.responseLimit, settings.responseLimit);
  if (claim.changes === 0) return { ok: false, error: 'closed', reason: 'limit' };
  const release = () => db.prepare('UPDATE forms_forms SET response_count = MAX(0, response_count - 1) WHERE id = ?').run(row.id);

  const responseId = newId('fmr_');
  const lang = pickLang(def, body.lang);
  try {
    for (const q of def.questions) {
      const a = checked.answers[q.id];
      if (q.type === 'signature' && typeof a === 'string') {
        const f = await signatureToFile(row, q.id, a);
        if (!f) throw new FormsError('invalid_signature');
        checked.answers[q.id] = f;
        files.push(f.fileId);
      }
    }
    const at = nowIso();
    await db
      .prepare(
        `INSERT INTO forms_responses (id, form_id, workspace_id, status, answers, hidden, vars, ending_id, lang, ip_hash, user_agent, consent, created_at, updated_at, submitted_at)
         VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(responseId, row.id, row.workspace_id, JSON.stringify(checked.answers), JSON.stringify(hidden), JSON.stringify(checked.vars), checked.endingId, lang, ipHash, (meta.userAgent ?? '').slice(0, 300), body.consent ? 1 : 0, at, at, at);
    // Límite por IP atómico: primero se inserta, después se cuenta; si se pasó, se deshace.
    if (settings.perIpLimit > 0 && ipHash) {
      const n = (await db.prepare("SELECT COUNT(*) AS n FROM forms_responses WHERE form_id = ? AND ip_hash = ? AND status = 'completed'").get(row.id, ipHash)) as { n: number };
      if (Number(n.n) > settings.perIpLimit) {
        await db.prepare('DELETE FROM forms_responses WHERE id = ?').run(responseId);
        await release();
        return { ok: false, error: 'ip_limit' };
      }
    }
  } catch (err) {
    // Algo falló después de reservar el lugar: se devuelve.
    await db.prepare('DELETE FROM forms_responses WHERE id = ?').run(responseId);
    await release();
    throw err;
  }
  // Desde acá la respuesta está guardada: nada de lo que sigue la deshace.
  for (const f of files) await db.prepare('UPDATE forms_files SET response_id = ? WHERE id = ? AND response_id IS NULL').run(responseId, f);
  // Venía guardando parciales: la parcial ya no hace falta.
  if (body.resumeToken && /^[a-f0-9]{32}$/.test(body.resumeToken)) {
    await db.prepare("DELETE FROM forms_responses WHERE resume_hash = ? AND form_id = ? AND status = 'partial'").run(hashToken(body.resumeToken), row.id);
  }
  if (body.visitId && /^[a-z0-9]{8,40}$/i.test(body.visitId)) await db.prepare('UPDATE forms_visits SET completed = 1 WHERE id = ? AND form_id = ?').run(hashVisit(body.visitId), row.id);
  try {
    const { afterResponse } = await import('./integrations');
    await afterResponse(row, def, { id: responseId, answers: checked.answers, hidden, vars: checked.vars, endingId: checked.endingId, lang });
  } catch (err) {
    console.error('[forms] after response', err instanceof Error ? err.message : err);
  }
  return { ok: true, responseId, endingId: checked.endingId, vars: checked.vars, answers: checked.answers };
}

/**
 * Respuesta parcial: solo si el form las pide y quien responde aceptó. Se
 * guarda por un token que vive en su navegador (en la base, solo el hash).
 * Topes: 10.000 parciales por form, 3 abiertas por IP y 200 KB por parcial;
 * las abandonadas se borran a los 30 días (purgeFormsRetention).
 */
export async function savePartial(slug: string, body: { token?: string; answers: Record<string, unknown>; hidden?: Record<string, string>; lang?: string; consent: boolean }, meta: { ip?: string } = {}): Promise<{ token: string } | null> {
  const row = await getPublicFormRow(slug);
  if (!row) throw new FormsError('not_found', 404);
  const settings = settingsOf(row);
  if (!settings.partials || !body.consent) throw new FormsError('partials_off', 400);
  if (openState(row, settings)) throw new FormsError('closed', 409);
  const def = definitionOf(row);
  const answers = cleanPartial(def, body.answers ?? {});
  const json = JSON.stringify(answers);
  if (json.length > MAX_PARTIAL_BYTES) throw new FormsError('too_large', 413);
  const hidden: Record<string, string> = {};
  for (const h of def.hidden) if (typeof body.hidden?.[h] === 'string') hidden[h] = body.hidden[h].slice(0, 300);
  const db = getDb();
  const at = nowIso();
  if (body.token && /^[a-f0-9]{32}$/.test(body.token)) {
    const res = await db
      .prepare("UPDATE forms_responses SET answers = ?, hidden = ?, lang = ?, updated_at = ? WHERE resume_hash = ? AND form_id = ? AND status = 'partial'")
      .run(json, JSON.stringify(hidden), pickLang(def, body.lang), at, hashToken(body.token), row.id);
    if (res.changes) return { token: body.token };
  }
  if (!Object.keys(answers).length) return null;
  const total = (await db.prepare("SELECT COUNT(*) AS n FROM forms_responses WHERE form_id = ? AND status = 'partial'").get(row.id)) as { n: number };
  if (Number(total.n) >= MAX_PARTIALS_PER_FORM) throw new FormsError('partials_full', 429);
  const ipHash = hashIp(meta.ip ?? '');
  if (ipHash) {
    const mine = (await db.prepare("SELECT COUNT(*) AS n FROM forms_responses WHERE form_id = ? AND status = 'partial' AND ip_hash = ?").get(row.id, ipHash)) as { n: number };
    if (Number(mine.n) >= MAX_OPEN_PARTIALS_PER_IP) throw new FormsError('partials_full', 429);
  }
  const token = randomBytes(16).toString('hex');
  await db
    .prepare(
      `INSERT INTO forms_responses (id, form_id, workspace_id, status, answers, hidden, vars, lang, ip_hash, resume_hash, consent, created_at, updated_at)
       VALUES (?, ?, ?, 'partial', ?, ?, '{}', ?, ?, ?, 1, ?, ?)`,
    )
    .run(newId('fmr_'), row.id, row.workspace_id, json, JSON.stringify(hidden), pickLang(def, body.lang), ipHash, hashToken(token), at, at);
  return { token };
}

// ---------- Visitas (abandono por pregunta) ----------

const hashVisit = (v: string) => createHash('sha256').update(`forms-visit:${v}`).digest('hex').slice(0, 32);

/** Una visita llegó a una pregunta. Sin respuestas ni IP: solo el id de la pregunta. */
export async function trackVisit(slug: string, visitId: string, questionId: string | null): Promise<void> {
  if (!/^[a-z0-9]{8,40}$/i.test(visitId)) return;
  const row = await getPublicFormRow(slug);
  if (!row || row.status !== 'published') return;
  const db = getDb();
  const id = hashVisit(visitId);
  await db.prepare('INSERT OR IGNORE INTO forms_visits (id, form_id, created_at, completed) VALUES (?, ?, ?, 0)').run(id, row.id, nowIso());
  if (questionId && definitionOf(row).questions.some((q) => q.id === questionId)) {
    await db.prepare('INSERT OR IGNORE INTO forms_visit_steps (visit_id, form_id, question_id) VALUES (?, ?, ?)').run(id, row.id, questionId);
  }
}

// ---------- Lectura (miembros con acceso) ----------

export interface ResponseRow {
  id: string;
  form_id: string;
  status: 'completed' | 'partial';
  answers: string;
  hidden: string;
  vars: string;
  ending_id: string | null;
  lang: string;
  contact_id: string | null;
  consent: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export interface ResponseDto {
  id: string;
  status: 'completed' | 'partial';
  answers: Answers;
  hidden: Record<string, string>;
  vars: Record<string, number>;
  endingId: string | null;
  lang: string;
  contactId: string | null;
  consent: boolean;
  createdAt: string;
  submittedAt: string | null;
}

export function toResponseDto(r: ResponseRow): ResponseDto {
  return {
    id: r.id,
    status: r.status,
    answers: parse<Answers>(r.answers, {}),
    hidden: parse<Record<string, string>>(r.hidden, {}),
    vars: parse<Record<string, number>>(r.vars, {}),
    endingId: r.ending_id,
    lang: r.lang,
    contactId: r.contact_id,
    consent: Boolean(r.consent),
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
  };
}

export interface ResponseFilters {
  status?: 'completed' | 'partial' | '';
  q?: string;
  from?: string;
  to?: string;
  /** Filtro por respuesta a una pregunta (contiene, sin distinguir mayúsculas). */
  question?: string;
  value?: string;
  page?: number;
  pageSize?: number;
}

export async function listResponses(actor: FormsActor, formId: string, f: ResponseFilters = {}): Promise<{ rows: ResponseDto[]; total: number } | null> {
  const row = await accessibleRow(actor, formId);
  if (!row) return null;
  const where = ['form_id = ?'];
  const args: Array<string | number> = [formId];
  where.push('status = ?');
  args.push(f.status === 'partial' ? 'partial' : 'completed');
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) {
    where.push('COALESCE(submitted_at, created_at) >= ?');
    args.push(`${f.from}T00:00:00`);
  }
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) {
    where.push('COALESCE(submitted_at, created_at) <= ?');
    args.push(`${f.to}T23:59:59.999Z`);
  }
  const esc = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  if (f.q?.trim()) {
    where.push("(lower(answers) LIKE ? ESCAPE '\\' OR lower(hidden) LIKE ? ESCAPE '\\')");
    args.push(esc(f.q.trim()), esc(f.q.trim()));
  }
  const def = definitionOf(row);
  if (f.question && f.value?.trim() && def.questions.some((q) => q.id === f.question)) {
    where.push(`lower(CAST(json_extract(answers, ?) AS TEXT)) LIKE ? ESCAPE '\\'`);
    args.push(`$.${f.question}`, esc(f.value.trim()));
  }
  const sql = where.join(' AND ');
  const db = getDb();
  const total = Number(((await db.prepare(`SELECT COUNT(*) AS n FROM forms_responses WHERE ${sql}`).get(...args)) as { n: number }).n);
  const size = Math.min(Math.max(f.pageSize ?? 50, 1), 5000);
  const page = Math.max(f.page ?? 1, 1);
  const rows = (await db.prepare(`SELECT * FROM forms_responses WHERE ${sql} ORDER BY COALESCE(submitted_at, updated_at) DESC, rowid DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size)) as ResponseRow[];
  return { rows: rows.map(toResponseDto), total };
}

export async function getResponse(actor: FormsActor, formId: string, responseId: string): Promise<ResponseDto | null> {
  const row = await accessibleRow(actor, formId);
  if (!row) return null;
  const r = (await getDb().prepare('SELECT * FROM forms_responses WHERE id = ? AND form_id = ?').get(responseId, formId)) as ResponseRow | undefined;
  return r ? toResponseDto(r) : null;
}

/** Borra respuestas (y sus archivos). Una respuesta completa baja el contador. */
export async function deleteResponses(actor: FormsActor, formId: string, ids: string[]): Promise<number> {
  const row = await accessibleRow(actor, formId);
  if (!row) throw new FormsError('not_found', 404);
  const db = getDb();
  let n = 0;
  for (const id of ids.slice(0, 500)) {
    const r = (await db.prepare('DELETE FROM forms_responses WHERE id = ? AND form_id = ? RETURNING status').get(id, formId)) as { status: string } | undefined;
    if (!r) continue;
    n++;
    if (r.status === 'completed') await db.prepare('UPDATE forms_forms SET response_count = MAX(0, response_count - 1) WHERE id = ?').run(formId);
    const files = (await db.prepare('DELETE FROM forms_files WHERE response_id = ? RETURNING ref').all(id)) as Array<{ ref: string }>;
    await deleteFormFiles(files.map((f) => f.ref));
  }
  return n;
}

/** Archivo de una respuesta, solo con acceso al form. */
export async function fileForMember(actor: FormsActor, fileId: string): Promise<{ ref: string; name: string; mime: string } | null> {
  if (!/^fmf_[a-z0-9]{10,40}$/i.test(fileId)) return null;
  const f = (await getDb().prepare('SELECT form_id, ref, name, mime, response_id FROM forms_files WHERE id = ? AND workspace_id = ?').get(fileId, actor.ws)) as
    | { form_id: string; ref: string; name: string; mime: string; response_id: string | null }
    | undefined;
  if (!f || !f.response_id) return null;
  if (!(await accessibleRow(actor, f.form_id))) return null;
  return { ref: f.ref, name: f.name, mime: f.mime };
}

export async function exportCsv(actor: FormsActor, formId: string, filters: ResponseFilters = {}): Promise<{ name: string; csv: string } | null> {
  const row = await accessibleRow(actor, formId);
  if (!row) return null;
  const res = await listResponses(actor, formId, { ...filters, page: 1, pageSize: 5000 });
  const def = definitionOf(row);
  const rows: CsvRow[] = (res?.rows ?? []).map((r) => ({ id: r.id, status: r.status, submittedAt: r.submittedAt, createdAt: r.createdAt, lang: r.lang, endingId: r.endingId, answers: r.answers, hidden: r.hidden, vars: r.vars }));
  return { name: `${row.slug}-responses.csv`, csv: responsesCsv(def, rows) };
}

export interface FormSummary {
  total: number;
  partials: number;
  visits: number;
  completionRate: number;
  questions: QuestionSummary[];
  dropOff: ReturnType<typeof dropOff>;
  byDay: Array<{ day: string; count: number }>;
}

export async function formSummary(actor: FormsActor, formId: string, labels?: DisplayLabels): Promise<FormSummary | null> {
  const row = await accessibleRow(actor, formId);
  if (!row) return null;
  const def = definitionOf(row);
  const db = getDb();
  const rows = (await db.prepare("SELECT answers FROM forms_responses WHERE form_id = ? AND status = 'completed' ORDER BY submitted_at DESC LIMIT 5000").all(formId)) as Array<{ answers: string }>;
  const responses = rows.map((r) => ({ answers: parse<Answers>(r.answers, {}) }));
  const partials = Number(((await db.prepare("SELECT COUNT(*) AS n FROM forms_responses WHERE form_id = ? AND status = 'partial'").get(formId)) as { n: number }).n);
  const visits = Number(((await db.prepare('SELECT COUNT(*) AS n FROM forms_visits WHERE form_id = ?').get(formId)) as { n: number }).n);
  const completedVisits = Number(((await db.prepare('SELECT COUNT(*) AS n FROM forms_visits WHERE form_id = ? AND completed = 1').get(formId)) as { n: number }).n);
  const steps = (await db.prepare('SELECT question_id, COUNT(*) AS n FROM forms_visit_steps WHERE form_id = ? GROUP BY question_id').all(formId)) as Array<{ question_id: string; n: number }>;
  const reached = Object.fromEntries(steps.map((s) => [s.question_id, Number(s.n)]));
  const days = (await db
    .prepare("SELECT substr(submitted_at, 1, 10) AS day, COUNT(*) AS n FROM forms_responses WHERE form_id = ? AND status = 'completed' AND submitted_at >= ? GROUP BY day ORDER BY day")
    .all(formId, new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10))) as Array<{ day: string; n: number }>;
  return {
    total: responses.length,
    partials,
    visits,
    completionRate: visits ? Math.round((completedVisits / visits) * 1000) / 10 : 0,
    questions: summarize(def, responses, labels),
    dropOff: dropOff(def, visits, reached, completedVisits),
    byDay: days.map((d) => ({ day: d.day, count: Number(d.n) })),
  };
}

/** Respuestas completas desde una fecha (asistente: "¿cuántas NPS esta semana?"). */
export async function countSince(formId: string, sinceIso: string): Promise<number> {
  return Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM forms_responses WHERE form_id = ? AND status = 'completed' AND submitted_at >= ?").get(formId, sinceIso)) as { n: number }).n);
}

// ---------- Retención (cron) ----------

/**
 * Borra respuestas más viejas que la retención de su form, parciales
 * abandonadas hace más de 30 días (sea cual sea la retención), archivos
 * subidos que nunca se enviaron (más de un día) y visitas de más de 180 días.
 * Cada fila se reclama con compare-and-set sobre su valor anterior de
 * purge_claimed_at antes de borrar sus archivos: dos corridas a la vez no
 * borran lo mismo dos veces, y un reclamo de más de una hora (una corrida que
 * murió a mitad de camino) se puede volver a tomar. Una respuesta completa
 * borrada baja el contador del form (el tope de respuestas libera ese lugar).
 */
export async function purgeFormsRetention(at = new Date(), limit = 500): Promise<{ responses: number; partials: number; orphans: number; visits: number }> {
  const db = getDb();
  const stamp = at.toISOString();
  const stale = new Date(at.getTime() - 3_600_000).toISOString();
  const claimable = '(purge_claimed_at IS NULL OR purge_claimed_at < ?)';

  const purgeResponse = async (r: { id: string; form_id: string; status: string; purge_claimed_at: string | null }): Promise<boolean> => {
    const claim = await db.prepare("UPDATE forms_responses SET purge_claimed_at = ? WHERE id = ? AND COALESCE(purge_claimed_at, '') = ?").run(stamp, r.id, r.purge_claimed_at ?? '');
    if (!claim.changes) return false;
    const files = (await db.prepare('DELETE FROM forms_files WHERE response_id = ? RETURNING ref').all(r.id)) as Array<{ ref: string }>;
    await deleteFormFiles(files.map((x) => x.ref));
    const gone = await db.prepare('DELETE FROM forms_responses WHERE id = ? AND purge_claimed_at = ?').run(r.id, stamp);
    if (gone.changes && r.status === 'completed') await db.prepare('UPDATE forms_forms SET response_count = MAX(0, response_count - 1) WHERE id = ?').run(r.form_id);
    return gone.changes > 0;
  };

  let responses = 0;
  const forms = (await db.prepare("SELECT id, settings FROM forms_forms WHERE settings LIKE '%retentionDays%'").all()) as Array<{ id: string; settings: string }>;
  for (const f of forms) {
    const days = settingsOf(f).retentionDays;
    if (!days) continue;
    const cutoff = new Date(at.getTime() - days * 86_400_000).toISOString();
    const due = (await db
      .prepare(`SELECT id, form_id, status, purge_claimed_at FROM forms_responses WHERE form_id = ? AND COALESCE(submitted_at, updated_at) < ? AND ${claimable} LIMIT ?`)
      .all(f.id, cutoff, stale, limit)) as Array<{ id: string; form_id: string; status: string; purge_claimed_at: string | null }>;
    for (const r of due) if (await purgeResponse(r)) responses++;
  }

  let partials = 0;
  const partialCut = new Date(at.getTime() - PARTIAL_TTL_DAYS * 86_400_000).toISOString();
  const abandoned = (await db
    .prepare(`SELECT id, form_id, status, purge_claimed_at FROM forms_responses WHERE status = 'partial' AND updated_at < ? AND ${claimable} LIMIT ?`)
    .all(partialCut, stale, limit)) as Array<{ id: string; form_id: string; status: string; purge_claimed_at: string | null }>;
  for (const r of abandoned) if (await purgeResponse(r)) partials++;

  let orphans = 0;
  const old = new Date(at.getTime() - 86_400_000).toISOString();
  const loose = (await db.prepare(`SELECT id, ref, purge_claimed_at FROM forms_files WHERE response_id IS NULL AND created_at < ? AND ${claimable} LIMIT ?`).all(old, stale, limit)) as Array<{
    id: string;
    ref: string;
    purge_claimed_at: string | null;
  }>;
  for (const f of loose) {
    const claim = await db.prepare("UPDATE forms_files SET purge_claimed_at = ? WHERE id = ? AND response_id IS NULL AND COALESCE(purge_claimed_at, '') = ?").run(stamp, f.id, f.purge_claimed_at ?? '');
    if (!claim.changes) continue;
    await deleteFormFiles([f.ref]);
    await db.prepare('DELETE FROM forms_files WHERE id = ?').run(f.id);
    orphans++;
  }
  const visitCut = new Date(at.getTime() - 180 * 86_400_000).toISOString();
  await db.prepare('DELETE FROM forms_visit_steps WHERE visit_id IN (SELECT id FROM forms_visits WHERE created_at < ?)').run(visitCut);
  const v = await db.prepare('DELETE FROM forms_visits WHERE created_at < ?').run(visitCut);
  return { responses, partials, orphans, visits: v.changes };
}

/** Definición localizada para mostrar (el idioma pedido si el form lo tiene). */
export function publicDefinition(def: FormDefinition, lang: string): FormDefinition {
  return localize(def, pickLang(def, lang));
}

export type { AnswerValue };

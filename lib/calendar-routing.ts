/**
 * Calendar routing forms — capa de queries (server-only).
 * Un routing form es un formulario público que hace unas preguntas y deriva
 * al visitante según las respuestas: las reglas se evalúan en orden
 * (position) y gana la primera que matchea; si ninguna matchea, se usa el
 * destino de respaldo del form. Cada destino es un event type, una URL
 * externa o un mensaje en la misma página. Cada envío queda registrado.
 */
import {
  getDb,
  type CalendarRoutingFormRow,
  type CalendarRoutingFieldRow,
  type CalendarRoutingRuleRow,
  type CalendarRoutingSubmissionRow,
} from './db';
import { CalendarError, getEventType, getEventTypeById, parseJson } from './calendar';
import type {
  RoutingFormCreatePayload,
  RoutingFormUpdatePayload,
  RoutingFieldCreatePayload,
  RoutingFieldUpdatePayload,
  RoutingRuleCreatePayload,
  RoutingRuleUpdatePayload,
} from './calendar-schema';

// ---------- Helpers ----------

function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export interface RoutingFieldWithOptions extends CalendarRoutingFieldRow {
  optionsParsed: string[];
}

export interface RoutingFormWithChildren extends CalendarRoutingFormRow {
  fields: RoutingFieldWithOptions[];
  rules: CalendarRoutingRuleRow[];
}

function decorateField(row: CalendarRoutingFieldRow): RoutingFieldWithOptions {
  return { ...row, optionsParsed: parseJson<string[]>(row.options, []) };
}

async function decorateForm(row: CalendarRoutingFormRow): Promise<RoutingFormWithChildren> {
  const fields = (await getDb()
    .prepare('SELECT * FROM calendar_routing_fields WHERE form_id = ? ORDER BY position ASC, rowid ASC')
    .all(row.id)) as CalendarRoutingFieldRow[];
  const rules = (await getDb()
    .prepare('SELECT * FROM calendar_routing_rules WHERE form_id = ? ORDER BY position ASC, rowid ASC')
    .all(row.id)) as CalendarRoutingRuleRow[];
  return { ...row, fields: fields.map(decorateField), rules };
}

// ---------- Forms ----------

export async function listRoutingForms(userId: string): Promise<CalendarRoutingFormRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM calendar_routing_forms WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)) as CalendarRoutingFormRow[];
}

export async function getRoutingForm(
  userId: string,
  id: string,
): Promise<RoutingFormWithChildren | undefined> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_routing_forms WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CalendarRoutingFormRow | undefined;
  return row ? decorateForm(row) : undefined;
}

/** Lookup público /r/<handle>/<slug>: solo forms activos. */
export async function getRoutingFormByHandle(
  handle: string,
  slug: string,
): Promise<RoutingFormWithChildren | undefined> {
  const row = (await getDb()
    .prepare(
      `SELECT f.* FROM calendar_routing_forms f JOIN users u ON u.id = f.user_id
       WHERE u.handle = ? AND f.slug = ? AND f.active = 1`,
    )
    .get(handle.toLowerCase(), slug)) as CalendarRoutingFormRow | undefined;
  return row ? decorateForm(row) : undefined;
}

/** Lookup público por id (lo usa la API del form): solo forms activos. */
export async function getPublicRoutingForm(id: string): Promise<RoutingFormWithChildren | undefined> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_routing_forms WHERE id = ? AND active = 1')
    .get(id)) as CalendarRoutingFormRow | undefined;
  return row ? decorateForm(row) : undefined;
}

/**
 * Links viejos /r/<slug>: el form más antiguo con ese slug. Solo forms creados
 * antes de la migración de handles (los únicos que tuvieron ese link): uno
 * nuevo no puede apropiarse de un /r/<slug> que no era suyo.
 */
export async function legacyRoutingPath(slug: string): Promise<string | null> {
  const row = (await getDb()
    .prepare(
      `SELECT u.handle FROM calendar_routing_forms f JOIN users u ON u.id = f.user_id
       WHERE f.slug = ? AND f.active = 1 AND u.handle IS NOT NULL
         AND f.created_at < (SELECT applied_at FROM schema_migrations WHERE id = '005_user_handles')
       ORDER BY f.created_at ASC LIMIT 1`,
    )
    .get(slug)) as { handle: string } | undefined;
  return row ? `/r/${row.handle}/${slug}` : null;
}

async function formSlugExists(userId: string, slug: string, excludeId?: string): Promise<boolean> {
  const row = (await getDb()
    .prepare(
      excludeId
        ? 'SELECT 1 AS one FROM calendar_routing_forms WHERE user_id = ? AND slug = ? AND id != ?'
        : 'SELECT 1 AS one FROM calendar_routing_forms WHERE user_id = ? AND slug = ?',
    )
    .get(userId, slug, ...(excludeId ? [excludeId] : []))) as { one: number } | undefined;
  return row?.one === 1;
}

/** El default debe ser un event type del propio usuario. */
async function assertOwnsEventType(userId: string, eventTypeId: string): Promise<void> {
  const et = await getEventType(userId, eventTypeId);
  if (!et) throw new CalendarError('invalid_input', 400);
}

export async function createRoutingForm(
  userId: string,
  payload: RoutingFormCreatePayload,
): Promise<RoutingFormWithChildren> {
  if (await formSlugExists(userId, payload.slug)) {
    throw new CalendarError('slug_taken', 409);
  }
  if (payload.defaultEventTypeId) await assertOwnsEventType(userId, payload.defaultEventTypeId);
  const id = crypto.randomUUID();
  const ts = now();
  await getDb()
    .prepare(
      `INSERT INTO calendar_routing_forms
       (id, user_id, slug, title, description, active, default_event_type_id, created_at, updated_at,
        fallback_action, fallback_url, fallback_message, pass_answers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      payload.slug,
      payload.title,
      payload.description ?? '',
      payload.active === false ? 0 : 1,
      payload.defaultEventTypeId ?? null,
      ts,
      ts,
      payload.fallbackAction ?? 'event',
      payload.fallbackUrl ?? '',
      payload.fallbackMessage ?? '',
      payload.passAnswers === false ? 0 : 1,
    );
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_routing_forms WHERE id = ?')
    .get(id)) as CalendarRoutingFormRow;
  return decorateForm(row);
}

export async function updateRoutingForm(
  userId: string,
  id: string,
  payload: RoutingFormUpdatePayload,
): Promise<RoutingFormWithChildren | undefined> {
  const existing = (await getDb()
    .prepare('SELECT * FROM calendar_routing_forms WHERE id = ? AND user_id = ?')
    .get(id, userId)) as CalendarRoutingFormRow | undefined;
  if (!existing) return undefined;
  if (payload.slug && payload.slug !== existing.slug && (await formSlugExists(userId, payload.slug, id))) {
    throw new CalendarError('slug_taken', 409);
  }
  if (payload.defaultEventTypeId) await assertOwnsEventType(userId, payload.defaultEventTypeId);

  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (payload.slug !== undefined) {
    sets.push('slug = ?');
    values.push(payload.slug);
  }
  if (payload.title !== undefined) {
    sets.push('title = ?');
    values.push(payload.title);
  }
  if (payload.description !== undefined) {
    sets.push('description = ?');
    values.push(payload.description);
  }
  if (payload.active !== undefined) {
    sets.push('active = ?');
    values.push(payload.active ? 1 : 0);
  }
  if (payload.defaultEventTypeId !== undefined) {
    sets.push('default_event_type_id = ?');
    values.push(payload.defaultEventTypeId ?? null);
  }
  if (payload.fallbackAction !== undefined) {
    sets.push('fallback_action = ?');
    values.push(payload.fallbackAction);
  }
  if (payload.fallbackUrl !== undefined) {
    sets.push('fallback_url = ?');
    values.push(payload.fallbackUrl);
  }
  if (payload.fallbackMessage !== undefined) {
    sets.push('fallback_message = ?');
    values.push(payload.fallbackMessage);
  }
  if (payload.passAnswers !== undefined) {
    sets.push('pass_answers = ?');
    values.push(payload.passAnswers ? 1 : 0);
  }
  if (sets.length === 0) return decorateForm(existing);

  sets.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await getDb()
    .prepare(`UPDATE calendar_routing_forms SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return getRoutingForm(userId, id);
}

export async function deleteRoutingForm(userId: string, id: string): Promise<boolean> {
  const existing = (await getDb()
    .prepare('SELECT 1 AS one FROM calendar_routing_forms WHERE id = ? AND user_id = ?')
    .get(id, userId)) as { one: number } | undefined;
  if (!existing) return false;
  // Fields y rules caen en cascada por FK.
  await getDb().prepare('DELETE FROM calendar_routing_forms WHERE id = ?').run(id);
  return true;
}

// ---------- Fields ----------

async function nextPosition(table: 'calendar_routing_fields' | 'calendar_routing_rules', formId: string): Promise<number> {
  const row = (await getDb()
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ${table} WHERE form_id = ?`)
    .get(formId)) as { next: number } | undefined;
  return Number(row?.next ?? 0);
}

export async function addRoutingField(
  userId: string,
  formId: string,
  payload: RoutingFieldCreatePayload,
): Promise<RoutingFieldWithOptions | undefined> {
  const form = await getRoutingForm(userId, formId);
  if (!form) return undefined;
  const id = crypto.randomUUID();
  const position = payload.position ?? (await nextPosition('calendar_routing_fields', formId));
  const options = payload.type === 'select' ? JSON.stringify(payload.options ?? []) : '[]';
  await getDb()
    .prepare(
      `INSERT INTO calendar_routing_fields (id, form_id, name, label, type, options, required, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, formId, payload.name, payload.label, payload.type, options, payload.required ? 1 : 0, position);
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_routing_fields WHERE id = ?')
    .get(id)) as CalendarRoutingFieldRow;
  return decorateField(row);
}

export async function updateRoutingField(
  userId: string,
  formId: string,
  fieldId: string,
  payload: RoutingFieldUpdatePayload,
): Promise<RoutingFieldWithOptions | undefined> {
  const form = await getRoutingForm(userId, formId);
  if (!form) return undefined;
  const existing = form.fields.find((f) => f.id === fieldId);
  if (!existing) return undefined;

  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (payload.name !== undefined) {
    sets.push('name = ?');
    values.push(payload.name);
  }
  if (payload.label !== undefined) {
    sets.push('label = ?');
    values.push(payload.label);
  }
  if (payload.type !== undefined) {
    sets.push('type = ?');
    values.push(payload.type);
  }
  const nextType = payload.type ?? existing.type;
  if (payload.options !== undefined || payload.type !== undefined) {
    sets.push('options = ?');
    values.push(nextType === 'select' ? JSON.stringify(payload.options ?? existing.optionsParsed) : '[]');
  }
  if (payload.required !== undefined) {
    sets.push('required = ?');
    values.push(payload.required ? 1 : 0);
  }
  if (payload.position !== undefined) {
    sets.push('position = ?');
    values.push(payload.position);
  }
  if (sets.length === 0) return decorateField(existing);

  values.push(fieldId);
  await getDb()
    .prepare(`UPDATE calendar_routing_fields SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_routing_fields WHERE id = ?')
    .get(fieldId)) as CalendarRoutingFieldRow;
  return decorateField(row);
}

export async function deleteRoutingField(userId: string, formId: string, fieldId: string): Promise<boolean> {
  const form = await getRoutingForm(userId, formId);
  if (!form) return false;
  // Las reglas que apuntan al field caen en cascada por FK.
  const res = await getDb()
    .prepare('DELETE FROM calendar_routing_fields WHERE id = ? AND form_id = ?')
    .run(fieldId, formId);
  return res.changes > 0;
}

// ---------- Rules ----------

export async function addRoutingRule(
  userId: string,
  formId: string,
  payload: RoutingRuleCreatePayload,
): Promise<CalendarRoutingRuleRow | undefined> {
  const form = await getRoutingForm(userId, formId);
  if (!form) return undefined;
  if (!form.fields.some((f) => f.id === payload.fieldId)) throw new CalendarError('invalid_input', 400);
  const action = payload.action ?? 'event';
  if (action === 'event') await assertOwnsEventType(userId, payload.eventTypeId ?? '');
  const id = crypto.randomUUID();
  const position = payload.position ?? (await nextPosition('calendar_routing_rules', formId));
  await getDb()
    .prepare(
      `INSERT INTO calendar_routing_rules (id, form_id, field_id, operator, value, event_type_id, position, action, target_url, message, crm_match, route_to_owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      formId,
      payload.fieldId,
      payload.operator,
      payload.value ?? '',
      action === 'event' ? (payload.eventTypeId ?? null) : null,
      position,
      action,
      action === 'url' ? (payload.targetUrl ?? '') : '',
      action === 'message' ? (payload.message ?? '') : '',
      payload.crmMatch ?? '',
      payload.routeToOwner ? 1 : 0,
    );
  return (await getDb()
    .prepare('SELECT * FROM calendar_routing_rules WHERE id = ?')
    .get(id)) as CalendarRoutingRuleRow;
}

export async function updateRoutingRule(
  userId: string,
  formId: string,
  ruleId: string,
  payload: RoutingRuleUpdatePayload,
): Promise<CalendarRoutingRuleRow | undefined> {
  const form = await getRoutingForm(userId, formId);
  if (!form) return undefined;
  const existing = form.rules.find((r) => r.id === ruleId);
  if (!existing) return undefined;
  if (payload.fieldId !== undefined && !form.fields.some((f) => f.id === payload.fieldId)) {
    throw new CalendarError('invalid_input', 400);
  }
  if (payload.eventTypeId) await assertOwnsEventType(userId, payload.eventTypeId);
  // El destino que queda tiene que estar completo: evento, URL o mensaje.
  const action = payload.action ?? existing.action;
  const nextEvent = payload.eventTypeId !== undefined ? payload.eventTypeId : existing.event_type_id;
  const nextUrl = payload.targetUrl ?? existing.target_url;
  const nextMessage = payload.message ?? existing.message;
  if ((action === 'event' && !nextEvent) || (action === 'url' && !nextUrl) || (action === 'message' && !nextMessage)) {
    throw new CalendarError('invalid_input', 400);
  }

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (payload.action !== undefined) {
    sets.push('action = ?');
    values.push(payload.action);
  }
  if (payload.targetUrl !== undefined) {
    sets.push('target_url = ?');
    values.push(payload.targetUrl);
  }
  if (payload.message !== undefined) {
    sets.push('message = ?');
    values.push(payload.message);
  }

  if (payload.fieldId !== undefined) {
    sets.push('field_id = ?');
    values.push(payload.fieldId);
  }
  if (payload.operator !== undefined) {
    sets.push('operator = ?');
    values.push(payload.operator);
  }
  if (payload.value !== undefined) {
    sets.push('value = ?');
    values.push(payload.value);
  }
  if (payload.eventTypeId !== undefined) {
    sets.push('event_type_id = ?');
    values.push(payload.eventTypeId ?? null);
  }
  if (payload.position !== undefined) {
    sets.push('position = ?');
    values.push(payload.position);
  }
  if (payload.crmMatch !== undefined) {
    sets.push('crm_match = ?');
    values.push(payload.crmMatch);
  }
  if (payload.routeToOwner !== undefined) {
    sets.push('route_to_owner = ?');
    values.push(payload.routeToOwner ? 1 : 0);
  }
  if (sets.length === 0) return existing;

  values.push(ruleId);
  await getDb()
    .prepare(`UPDATE calendar_routing_rules SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values);
  return (await getDb()
    .prepare('SELECT * FROM calendar_routing_rules WHERE id = ?')
    .get(ruleId)) as CalendarRoutingRuleRow;
}

export async function deleteRoutingRule(userId: string, formId: string, ruleId: string): Promise<boolean> {
  const form = await getRoutingForm(userId, formId);
  if (!form) return false;
  const res = await getDb()
    .prepare('DELETE FROM calendar_routing_rules WHERE id = ? AND form_id = ?')
    .run(ruleId, formId);
  return res.changes > 0;
}

// ---------- Evaluación ----------

export type RoutingAnswers = Record<string, unknown>;

/** Normaliza una respuesta a string comparable (lowercase, trim; true → 'true'). */
function normalizeAnswer(value: unknown): string {
  if (value === true) return 'true';
  if (value === false || value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function isTruthyAnswer(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s !== '' && s !== 'false' && s !== '0' && s !== 'no';
  }
  return false;
}

function ruleMatches(rule: CalendarRoutingRuleRow, field: CalendarRoutingFieldRow, answers: RoutingAnswers): boolean {
  const answer = answers[field.name];
  switch (rule.operator) {
    case 'truthy':
      return isTruthyAnswer(answer);
    case 'is': {
      const a = normalizeAnswer(answer);
      return a !== '' && a === rule.value.trim().toLowerCase();
    }
    case 'is_not': {
      const a = normalizeAnswer(answer);
      // Una respuesta ausente no puede compararse: no matchea.
      return a !== '' && a !== rule.value.trim().toLowerCase();
    }
    case 'contains': {
      const a = normalizeAnswer(answer);
      const v = rule.value.trim().toLowerCase();
      return a !== '' && v !== '' && a.includes(v);
    }
  }
}

/** A dónde termina un envío: un evento (slug), una URL o un mensaje. */
export type RoutingOutcome =
  | { kind: 'event'; slug: string; ruleId: string | null; hostId?: string | null }
  | { kind: 'url'; url: string; ruleId: string | null }
  | { kind: 'message'; message: string; ruleId: string | null };

/** Destino de una regla (o del respaldo) si se puede usar; null si su evento está inactivo o borrado. */
async function outcomeFor(
  action: 'event' | 'url' | 'message',
  target: { eventTypeId: string | null; url: string; message: string },
  ruleId: string | null,
): Promise<RoutingOutcome | null> {
  if (action === 'url') return target.url ? { kind: 'url', url: target.url, ruleId } : null;
  if (action === 'message') return target.message ? { kind: 'message', message: target.message, ruleId } : null;
  if (!target.eventTypeId) return null;
  const et = await getEventTypeById(target.eventTypeId);
  return et && et.active === 1 ? { kind: 'event', slug: et.slug, ruleId } : null;
}

/**
 * Evalúa las reglas del form en orden: gana la primera que matchea y cuyo
 * destino sirve (un evento inactivo o borrado se saltea); si ninguna, el
 * respaldo del form; si tampoco, null.
 */
export async function routeAnswers(form: RoutingFormWithChildren, answers: RoutingAnswers): Promise<RoutingOutcome | null> {
  const sorted = [...form.rules].sort((a, b) => a.position - b.position);
  const contacts = new Map<string, CrmContactMatch | null>();
  const contactFor = async (email: string) => {
    if (!contacts.has(email)) contacts.set(email, await findCrmContact(form.user_id, email));
    return contacts.get(email) ?? null;
  };
  for (const rule of sorted) {
    const field = form.fields.find((f) => f.id === rule.field_id);
    if (!field) continue;
    let contact: CrmContactMatch | null = null;
    if (rule.crm_match === 'contact' || rule.crm_match === 'no_contact') {
      const email = normalizeAnswer(answers[field.name]);
      contact = email.includes('@') ? await contactFor(email) : null;
      if ((rule.crm_match === 'contact') !== !!contact) continue;
    } else if (!ruleMatches(rule, field, answers)) {
      continue;
    }
    const out = await outcomeFor(
      rule.action ?? 'event',
      { eventTypeId: rule.event_type_id, url: rule.target_url, message: rule.message },
      rule.id,
    );
    if (!out) continue;
    // Reservar con el owner del contacto (si es anfitrión del evento; si no, el reparto de siempre).
    if (out.kind === 'event' && rule.route_to_owner === 1 && contact?.ownerId && rule.event_type_id) {
      if (await isHostOf(rule.event_type_id, contact.ownerId)) return { ...out, hostId: contact.ownerId };
    }
    return out;
  }
  return outcomeFor(
    form.fallback_action ?? 'event',
    { eventTypeId: form.default_event_type_id, url: form.fallback_url, message: form.fallback_message },
    null,
  );
}

export interface CrmContactMatch {
  id: string;
  ownerId: string | null;
}

/** Contacto del CRM del workspace con ese email (el más viejo si hay duplicados). */
export async function findCrmContact(workspaceId: string, email: string): Promise<CrmContactMatch | null> {
  const row = (await getDb()
    .prepare('SELECT id, owner_id FROM crm_contacts WHERE user_id = ? AND lower(email) = ? ORDER BY created_at LIMIT 1')
    .get(workspaceId, email.trim().toLowerCase())) as { id: string; owner_id: string | null } | undefined;
  return row ? { id: row.id, ownerId: row.owner_id } : null;
}

/** La persona atiende ese tipo de evento (está en su pool, o es su dueño sin pool). */
async function isHostOf(eventTypeId: string, userId: string): Promise<boolean> {
  const pool = (await getDb().prepare('SELECT user_id FROM calendar_event_hosts WHERE event_type_id = ?').all(eventTypeId)) as Array<{
    user_id: string;
  }>;
  if (pool.length > 0) return pool.some((h) => h.user_id === userId);
  const et = await getEventTypeById(eventTypeId);
  return et?.user_id === userId;
}

/** Compat: slug del evento de destino (null si el destino no es un evento). */
export async function evaluateRouting(form: RoutingFormWithChildren, answers: RoutingAnswers): Promise<string | null> {
  const out = await routeAnswers(form, answers);
  return out?.kind === 'event' ? out.slug : null;
}

/**
 * Respuestas que viajan al destino como parámetros de URL: solo las de
 * campos del form, como texto de una línea (sí/no para booleanos), hasta 500
 * caracteres. Las vacías no van.
 */
export function answerParams(form: Pick<RoutingFormWithChildren, 'fields'>, answers: RoutingAnswers): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const f of form.fields) {
    const raw = answers[f.name];
    let v: string;
    if (f.type === 'boolean') {
      if (raw === undefined || raw === null || raw === '') continue;
      v = isTruthyAnswer(raw) ? 'true' : 'false';
    } else {
      // eslint-disable-next-line no-control-regex
      v = typeof raw === 'string' || typeof raw === 'number' ? String(raw).replace(/[\x00-\x1f\x7f]+/g, ' ').trim() : '';
    }
    if (!v) continue;
    out.push([f.name, v.slice(0, 500)]);
  }
  return out;
}

/** `base` (path o URL absoluta) con los parámetros agregados (sin pisar los que ya trae). */
export function withParams(base: string, params: Array<[string, string]>): string {
  if (params.length === 0) return base;
  const absolute = /^https?:\/\//i.test(base);
  const url = new URL(base, 'http://local.invalid');
  for (const [k, v] of params) if (!url.searchParams.has(k)) url.searchParams.set(k, v);
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

/** Respuestas guardadas en el registro: solo campos del form, texto acotado. */
function storedAnswers(form: RoutingFormWithChildren, answers: RoutingAnswers): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of form.fields) {
    const raw = answers[f.name];
    if (f.type === 'boolean') {
      if (raw !== undefined && raw !== null && raw !== '') out[f.name] = isTruthyAnswer(raw);
      continue;
    }
    if (typeof raw === 'string' || typeof raw === 'number') {
      const v = String(raw).trim().slice(0, 2000);
      if (v) out[f.name] = v;
    }
  }
  return out;
}

/** Cuántos envíos se guardan por form (los más viejos se borran). */
export const MAX_SUBMISSIONS_PER_FORM = 5000;

/** Registra un envío del form público y a dónde terminó. Devuelve su id (viaja al link de reserva como rsid). */
export async function logRoutingSubmission(
  form: RoutingFormWithChildren,
  answers: RoutingAnswers,
  outcome: RoutingOutcome | null,
): Promise<string> {
  const target = !outcome ? '' : outcome.kind === 'event' ? outcome.slug : outcome.kind === 'url' ? outcome.url : '';
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO calendar_routing_submissions (id, form_id, answers, outcome, target, rule_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      form.id,
      JSON.stringify(storedAnswers(form, answers)),
      outcome?.kind ?? 'none',
      target,
      outcome?.ruleId ?? null,
      new Date().toISOString(),
    );
  await getDb()
    .prepare(
      `DELETE FROM calendar_routing_submissions WHERE form_id = ? AND id NOT IN (
         SELECT id FROM calendar_routing_submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT ?)`,
    )
    .run(form.id, form.id, MAX_SUBMISSIONS_PER_FORM);
  return id;
}

// ---------- Embudo (analytics del form) ----------

export interface RoutingFunnel {
  submissions: number;
  /** Terminaron en un tipo de evento. */
  routedToEvent: number;
  /** De esos, cuántos reservaron (con el link que trae rsid). */
  booked: number;
  /** Reservas que siguen en pie (confirmadas o ya pasadas, sin cancelar ni no-show). */
  confirmed: number;
  /** Terminaron en una URL externa o en un mensaje. */
  routedElsewhere: number;
  /** Sin destino (ninguna regla ni respaldo). */
  unrouted: number;
  /** Reservas / envíos que fueron a un evento (null sin envíos a eventos). */
  bookingRate: number | null;
  /** Por destino: regla (o respaldo) y su conversión a reserva. */
  byRoute: Array<{ ruleId: string | null; outcome: string; target: string; submissions: number; booked: number }>;
}

/** Cuenta el embudo de envíos → evento → reserva. Puro. */
export function computeRoutingFunnel(
  rows: Array<{ outcome: string; target: string; rule_id: string | null; booking_status: string | null }>,
): RoutingFunnel {
  const byRoute = new Map<string, RoutingFunnel['byRoute'][number]>();
  let routedToEvent = 0;
  let booked = 0;
  let confirmed = 0;
  let routedElsewhere = 0;
  let unrouted = 0;
  for (const r of rows) {
    const key = `${r.rule_id ?? ''}|${r.outcome}|${r.target}`;
    const route = byRoute.get(key) ?? { ruleId: r.rule_id, outcome: r.outcome, target: r.target, submissions: 0, booked: 0 };
    route.submissions++;
    if (r.outcome === 'event') {
      routedToEvent++;
      if (r.booking_status) {
        booked++;
        route.booked++;
        if (r.booking_status === 'confirmed') confirmed++;
      }
    } else if (r.outcome === 'url' || r.outcome === 'message') {
      routedElsewhere++;
    } else {
      unrouted++;
    }
    byRoute.set(key, route);
  }
  return {
    submissions: rows.length,
    routedToEvent,
    booked,
    confirmed,
    routedElsewhere,
    unrouted,
    bookingRate: routedToEvent ? booked / routedToEvent : null,
    byRoute: [...byRoute.values()].sort((a, b) => b.submissions - a.submissions),
  };
}

/** Embudo de un form del workspace (envíos guardados, hasta MAX_SUBMISSIONS_PER_FORM). */
export async function loadRoutingFunnel(userId: string, formId: string): Promise<RoutingFunnel | undefined> {
  const form = await getRoutingForm(userId, formId);
  if (!form) return undefined;
  // Una reserva por envío: la primera que lo trajo (los holds de pago vencidos no cuentan).
  const rows = (await getDb()
    .prepare(
      `SELECT s.outcome, s.target, s.rule_id,
         (SELECT b.status FROM calendar_bookings b
          WHERE b.routing_submission_id = s.id AND NOT (b.status = 'cancelled' AND b.payment_status = 'expired')
          ORDER BY b.created_at LIMIT 1) AS booking_status
       FROM calendar_routing_submissions s WHERE s.form_id = ?`,
    )
    .all(formId)) as Array<{ outcome: string; target: string; rule_id: string | null; booking_status: string | null }>;
  return computeRoutingFunnel(rows);
}

/** El envío es de un form del workspace (para atar una reserva a su envío). */
export async function submissionBelongsTo(userId: string, submissionId: string): Promise<boolean> {
  return !!(await getDb()
    .prepare(
      `SELECT 1 AS one FROM calendar_routing_submissions s JOIN calendar_routing_forms f ON f.id = s.form_id
       WHERE s.id = ? AND f.user_id = ?`,
    )
    .get(submissionId, userId));
}

export interface RoutingSubmission extends CalendarRoutingSubmissionRow {
  answersParsed: Record<string, string | boolean>;
}

/** Envíos de un form del usuario, el más nuevo primero. */
export async function listRoutingSubmissions(
  userId: string,
  formId: string,
  limit = 100,
): Promise<RoutingSubmission[] | undefined> {
  const form = await getRoutingForm(userId, formId);
  if (!form) return undefined;
  const rows = (await getDb()
    .prepare('SELECT * FROM calendar_routing_submissions WHERE form_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(formId, Math.min(Math.max(limit, 1), 1000))) as CalendarRoutingSubmissionRow[];
  return rows.map((r) => ({ ...r, answersParsed: parseJson<Record<string, string | boolean>>(r.answers, {}) }));
}

/**
 * Campos required sin respuesta válida (para validar el POST público). En un
 * sí/no "required" significa que se eligió una de las dos: "No" vale.
 */
export function missingRequiredFields(form: Pick<RoutingFormWithChildren, 'fields'>, answers: RoutingAnswers): string[] {
  return form.fields
    .filter((f) => f.required === 1)
    .filter((f) => {
      const answer = answers[f.name];
      return f.type === 'boolean' ? answer === undefined || answer === null || answer === '' : normalizeAnswer(answer) === '';
    })
    .map((f) => f.name);
}

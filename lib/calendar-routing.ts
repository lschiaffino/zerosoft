/**
 * Calendar routing forms — capa de queries (server-only).
 * Un routing form es un formulario público que hace unas preguntas y deriva
 * al visitante al event type correcto según las respuestas: las reglas se
 * evalúan en orden (position) y gana la primera que matchea; si ninguna
 * matchea, se usa el default_event_type_id del form.
 */
import {
  getDb,
  type CalendarRoutingFormRow,
  type CalendarRoutingFieldRow,
  type CalendarRoutingRuleRow,
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

/** Lookup público por slug (mismo patrón que getEventTypeBySlug): solo forms activos. */
export async function getRoutingFormBySlug(slug: string): Promise<RoutingFormWithChildren | undefined> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_routing_forms WHERE slug = ? AND active = 1')
    .get(slug)) as CalendarRoutingFormRow | undefined;
  return row ? decorateForm(row) : undefined;
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
       (id, user_id, slug, title, description, active, default_event_type_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  await assertOwnsEventType(userId, payload.eventTypeId);
  const id = crypto.randomUUID();
  const position = payload.position ?? (await nextPosition('calendar_routing_rules', formId));
  await getDb()
    .prepare(
      `INSERT INTO calendar_routing_rules (id, form_id, field_id, operator, value, event_type_id, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, formId, payload.fieldId, payload.operator, payload.value ?? '', payload.eventTypeId, position);
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
  if (payload.eventTypeId !== undefined) await assertOwnsEventType(userId, payload.eventTypeId);

  const sets: string[] = [];
  const values: (string | number)[] = [];

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
    values.push(payload.eventTypeId);
  }
  if (payload.position !== undefined) {
    sets.push('position = ?');
    values.push(payload.position);
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

/**
 * Evalúa las reglas del form en orden: devuelve el slug del event type de la
 * primera regla que matchea y cuyo destino existe y está activo; si ninguna
 * matchea, el slug del default (también debe estar activo); si no hay ruta, null.
 */
export async function evaluateRouting(
  form: RoutingFormWithChildren,
  answers: RoutingAnswers,
): Promise<string | null> {
  const sorted = [...form.rules].sort((a, b) => a.position - b.position);
  for (const rule of sorted) {
    const field = form.fields.find((f) => f.id === rule.field_id);
    if (!field) continue;
    if (!ruleMatches(rule, field, answers)) continue;
    const target = await getEventTypeById(rule.event_type_id);
    if (target && target.active === 1) return target.slug;
    // Destino inactivo o borrado: se salta a la siguiente regla.
  }
  if (form.default_event_type_id) {
    const fallback = await getEventTypeById(form.default_event_type_id);
    if (fallback && fallback.active === 1) return fallback.slug;
  }
  return null;
}

/** Campos required sin respuesta válida (para validar el POST público). */
export function missingRequiredFields(form: RoutingFormWithChildren, answers: RoutingAnswers): string[] {
  return form.fields
    .filter((f) => f.required === 1)
    .filter((f) => {
      const answer = answers[f.name];
      return f.type === 'boolean' ? !isTruthyAnswer(answer) : normalizeAnswer(answer) === '';
    })
    .map((f) => f.name);
}

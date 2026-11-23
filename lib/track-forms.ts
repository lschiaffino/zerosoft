/**
 * Track — formularios de pedidos (form templates de Linear).
 *
 * Una plantilla de issue con campos propios es un formulario: quien puede ver
 * el team lo completa desde /app/track/forms/<id> (o eligiéndolo en el alta
 * rápida) y se crea un issue con las respuestas en la descripción, en triage
 * si el team lo tiene prendido. Las propiedades de la plantilla (prioridad,
 * asignado, labels, estimación) se aplican igual que en una plantilla común.
 *
 * Puro: sin base de datos, se usa en el servidor y en el cliente.
 */
import { z } from 'zod';

export const FORM_FIELD_TYPES = ['text', 'textarea', 'select', 'checkbox'] as const;
export type TrackFormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const MAX_FORM_FIELDS = 20;
export const MAX_FIELD_OPTIONS = 30;
export const MAX_ANSWER_LENGTH = 10_000;

export const formFieldSchema = z
  .object({
    id: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
    label: z.string().trim().min(1).max(200),
    type: z.enum(FORM_FIELD_TYPES),
    required: z.boolean().optional().default(false),
    help: z.string().trim().max(300).optional(),
    options: z.array(z.string().trim().min(1).max(100)).max(MAX_FIELD_OPTIONS).optional(),
  })
  .transform((f) => ({
    ...f,
    help: f.help || undefined,
    // Solo las opciones de una lista se guardan, sin repetidas.
    options: f.type === 'select' ? [...new Set(f.options ?? [])] : undefined,
  }))
  .refine((f) => f.type !== 'select' || (f.options?.length ?? 0) > 0, { message: 'options_required', path: ['options'] });

export const formFieldsSchema = z
  .array(formFieldSchema)
  .max(MAX_FORM_FIELDS)
  .refine((list) => new Set(list.map((f) => f.id)).size === list.length, { message: 'duplicate_field_id' });

export type TrackFormField = z.output<typeof formFieldSchema>;

/** Respuestas tal como llegan del formulario: texto o casilla. */
export type TrackFormAnswers = Record<string, string | boolean | undefined>;

/** Campos guardados en la plantilla (JSON). Lo que no valida se descarta. */
export function parseFormFields(raw: string | null | undefined): TrackFormField[] {
  if (!raw) return [];
  try {
    const parsed = formFieldsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function isFormTemplate(tpl: { fields?: string | null }): boolean {
  return parseFormFields(tpl.fields).length > 0;
}

export type FormAnswerError = { fieldId: string; code: 'required' | 'invalid_option' | 'too_long' };

/**
 * Valida y normaliza las respuestas: obligatorios con valor, opciones que
 * existen y largo máximo. Devuelve los valores limpios o los errores por campo.
 */
export function validateFormAnswers(
  fields: TrackFormField[],
  answers: TrackFormAnswers,
): { ok: true; values: Record<string, string | boolean> } | { ok: false; errors: FormAnswerError[] } {
  const errors: FormAnswerError[] = [];
  const values: Record<string, string | boolean> = {};
  for (const f of fields) {
    const raw = answers[f.id];
    if (f.type === 'checkbox') {
      const checked = raw === true || raw === 'true';
      if (f.required && !checked) errors.push({ fieldId: f.id, code: 'required' });
      values[f.id] = checked;
      continue;
    }
    const text = typeof raw === 'string' ? (f.type === 'textarea' ? raw.replace(/\s+$/, '') : raw.trim()) : '';
    if (!text.trim()) {
      if (f.required) errors.push({ fieldId: f.id, code: 'required' });
      continue;
    }
    if (text.length > MAX_ANSWER_LENGTH) {
      errors.push({ fieldId: f.id, code: 'too_long' });
      continue;
    }
    if (f.type === 'select' && !(f.options ?? []).includes(text)) {
      errors.push({ fieldId: f.id, code: 'invalid_option' });
      continue;
    }
    values[f.id] = text;
  }
  return errors.length ? { ok: false, errors } : { ok: true, values };
}

/** Una respuesta de una línea no puede abrir un bloque de markdown (título, lista, cita). */
function inlineSafe(text: string): string {
  return text.replace(/^(\s*)([#>*+-]|\d+[.)])(\s)/, '$1\\$2$3');
}

/**
 * Descripción del issue: cada campo respondido como "**Pregunta**" y su
 * respuesta, en el orden del formulario, y al final los detalles libres. Una
 * casilla tildada es una tarea hecha ("- [x] Pregunta", se lee igual en
 * cualquier idioma); las sin tildar y los campos vacíos no aparecen.
 */
export function composeFormDescription(
  fields: TrackFormField[],
  values: Record<string, string | boolean>,
  opts: { details?: string } = {},
): string {
  const blocks: string[] = [];
  for (const f of fields) {
    const v = values[f.id];
    if (v === undefined || v === false || v === '') continue;
    const label = `**${f.label.replace(/\*/g, '\\*')}**`;
    if (v === true) {
      blocks.push(`- [x] ${f.label.replace(/\n/g, ' ')}`);
    } else if (f.type === 'textarea') {
      blocks.push(`${label}\n\n${v}`);
    } else {
      blocks.push(`${label}\n${inlineSafe(v)}`);
    }
  }
  const details = opts.details?.trim();
  if (details) blocks.push(details);
  return blocks.join('\n\n');
}

/** Id corto para un campo nuevo, que no choque con los que ya hay. */
export function newFieldId(existing: Array<{ id: string }>): string {
  const taken = new Set(existing.map((f) => f.id));
  for (let n = existing.length + 1; ; n++) {
    const id = `f${n}`;
    if (!taken.has(id)) return id;
  }
}

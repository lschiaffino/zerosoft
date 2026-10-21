/**
 * Cal — preguntas de la página de reserva (puro, sin zod ni DB: lo usan la
 * página pública, el editor y el server).
 *
 * Tipos: text (una línea), textarea (varias líneas), number, phone, boolean
 * (una casilla, p. ej. aceptar términos) y las de opciones: select
 * (desplegable), radio (una de varias a la vista) y checkbox (varias).
 */

export const QUESTION_TYPES = ['text', 'textarea', 'number', 'phone', 'boolean', 'select', 'radio', 'checkbox'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Tipos que se responden eligiendo de una lista de opciones. */
export const OPTION_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set(['select', 'radio', 'checkbox']);
export const MAX_QUESTION_OPTIONS = 50;

/** Tope de invitados extra por reserva (el evento puede pedir menos). */
export const MAX_GUESTS = 10;

/** Cuántos invitados extra acepta el evento (0 si no permite). */
export function guestLimit(rules: Record<string, unknown> | null | undefined): number {
  if (rules?.allowGuests !== true) return 0;
  const max = rules.maxGuests;
  return typeof max === 'number' && Number.isInteger(max) && max >= 1 && max <= MAX_GUESTS ? max : MAX_GUESTS;
}

export interface Question {
  name: string;
  label: string;
  type: QuestionType;
  required: boolean;
  /** Solo en select, radio y checkbox. */
  options: string[];
}

export function isQuestionType(v: unknown): v is QuestionType {
  return typeof v === 'string' && (QUESTION_TYPES as readonly string[]).includes(v);
}

/** Preguntas guardadas en el event type (JSON ya parseado), tolerando datos viejos o rotos. */
export function parseQuestions(list: unknown): Question[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => {
      const type = isQuestionType(f.type) ? f.type : 'text';
      return {
        name: typeof f.name === 'string' ? f.name : '',
        label: typeof f.label === 'string' ? f.label : '',
        type,
        required: f.required === true,
        options: OPTION_QUESTION_TYPES.has(type) && Array.isArray(f.options)
          ? f.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '')
          : [],
      };
    });
}

/**
 * Opciones escritas en el editor (una por línea) listas para guardar: sin
 * espacios de más, sin vacías ni repetidas, hasta MAX_QUESTION_OPTIONS.
 */
export function cleanOptions(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const v = raw.trim().slice(0, 200);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_QUESTION_OPTIONS);
}

/** Teléfono escrito a mano: dígitos con +, espacios, guiones, puntos o paréntesis (de 6 a 20 dígitos). */
export function isValidPhone(raw: string): boolean {
  const v = raw.trim();
  if (!/^\+?[0-9 ().-]{6,32}$/.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  return digits >= 6 && digits <= 20;
}

/** Respuesta como texto para mostrarla (listas separadas por coma, sí/no). */
export function answerText(value: unknown, bool: { yes: string; no: string }): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? bool.yes : bool.no;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  return JSON.stringify(value);
}

/**
 * Respuestas pre-llenadas desde la URL de la página de reserva (?<pregunta>=…,
 * p. ej. las que pasa un routing form): solo preguntas que existen, con un
 * valor válido para su tipo. Las opciones tienen que existir (checkbox:
 * separadas por coma); sí/no acepta true/false. Textos de hasta 2000.
 */
export function prefillAnswers(
  questions: Question[],
  params: Record<string, string | string[] | undefined>,
): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (const q of questions) {
    if (!q.name || q.name === 'name' || q.name === 'email') continue;
    let raw = params[q.name];
    if (Array.isArray(raw)) raw = raw[0];
    if (typeof raw !== 'string') continue;
    // eslint-disable-next-line no-control-regex
    const v = raw.replace(/[\x00-\x08\x0b-\x1f\x7f]+/g, ' ').trim().slice(0, 2000);
    if (!v) continue;
    if (q.type === 'boolean') {
      if (v === 'true' || v === 'false') out[q.name] = v === 'true';
    } else if (q.type === 'checkbox') {
      const picked = v.split(',').map((s) => s.trim());
      const valid = q.options.filter((o) => picked.includes(o));
      if (valid.length > 0) out[q.name] = valid;
    } else if (q.type === 'select' || q.type === 'radio') {
      if (q.options.includes(v)) out[q.name] = v;
    } else if (q.type === 'number') {
      if (Number.isFinite(Number(v))) out[q.name] = v;
    } else if (q.type === 'phone') {
      if (isValidPhone(v)) out[q.name] = v;
    } else {
      out[q.name] = q.type === 'textarea' ? v : v.replace(/\s+/g, ' ');
    }
  }
  return out;
}

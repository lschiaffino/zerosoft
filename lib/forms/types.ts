/**
 * Forms (Typeform): tipos y schemas de la definición de un formulario y de
 * sus ajustes. Puro (lo usan el builder, la página pública y el servidor).
 *
 * Todo el texto que escribe quien arma el formulario (títulos, opciones,
 * pantallas) es texto plano: se muestra con React (escapado) y nunca como
 * HTML. Los colores del tema se validan como #rrggbb y la fuente sale de una
 * lista cerrada.
 */
import { z } from 'zod';

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'url',
  'date',
  'choice',
  'multi_choice',
  'dropdown',
  'yes_no',
  'rating',
  'opinion_scale',
  'ranking',
  'matrix',
  'file_upload',
  'signature',
  'statement',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Tipos con opciones (choices). */
export const CHOICE_TYPES: readonly QuestionType[] = ['choice', 'multi_choice', 'dropdown', 'ranking'];
/** Tipos que no guardan respuesta. */
export const NO_ANSWER_TYPES: readonly QuestionType[] = ['statement'];

export const FORM_LANGS = ['en', 'es', 'pt'] as const;
export type FormLang = (typeof FORM_LANGS)[number];

export const CONDITION_OPS = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'answered',
  'not_answered',
  'includes',
  'not_includes',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const CALC_OPS = ['add', 'subtract', 'multiply', 'divide', 'set'] as const;
export type CalcOp = (typeof CALC_OPS)[number];

export const FONT_KEYS = ['system', 'serif', 'mono', 'rounded'] as const;
export type FontKey = (typeof FONT_KEYS)[number];

const id = z.string().regex(/^[a-z0-9_]{1,40}$/i);
const ref = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const text = (max: number) => z.string().max(max);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const choiceSchema = z.object({
  id,
  label: text(300),
  /** Puntos que suma a la variable "score" si se elige (quiz). */
  points: z.number().min(-1000).max(1000).optional(),
});
export type Choice = z.infer<typeof choiceSchema>;

export const questionSchema = z.object({
  id,
  /** Clave para el piping ({{name}}) y el CSV. */
  ref,
  type: z.enum(QUESTION_TYPES),
  title: text(500),
  description: text(2000).default(''),
  required: z.boolean().default(false),
  placeholder: text(200).optional(),
  choices: z.array(choiceSchema).max(100).optional(),
  /** Matriz: filas y columnas (una columna por fila). */
  rows: z.array(choiceSchema).max(30).optional(),
  columns: z.array(choiceSchema).max(15).optional(),
  /** Texto: largo; número: valor; multi: cantidad de opciones. */
  min: z.number().min(-1e12).max(1e12).optional(),
  max: z.number().min(-1e12).max(1e12).optional(),
  /** Rating (3-10) y escala (5, 7, 10 u 11 con NPS). */
  steps: z.number().int().min(2).max(11).optional(),
  /** Escala de opinión: arranca en 0 o en 1. */
  start: z.union([z.literal(0), z.literal(1)]).optional(),
  leftLabel: text(80).optional(),
  rightLabel: text(80).optional(),
  /** Escala 0-10 de NPS (calcula promotores y detractores). */
  nps: z.boolean().optional(),
  /** Archivo: tamaño máximo en MB (1-10). */
  maxMb: z.number().int().min(1).max(10).optional(),
  /** Fecha: rango permitido (YYYY-MM-DD). */
  minDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Texto del botón (enunciado). */
  button: text(60).optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const conditionSchema = z.object({
  /** q:<id> (pregunta), v:<nombre> (variable) o h:<nombre> (campo oculto). */
  left: z.string().regex(/^(q|v|h):[a-z0-9_]{1,40}$/i),
  op: z.enum(CONDITION_OPS),
  value: text(300).default(''),
});
export type Condition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  /** Saltar a una pregunta posterior o a un final (end:<id>). */
  z.object({ type: z.literal('jump'), to: z.string().regex(/^(q|end):[a-z0-9_]{1,40}$/i) }),
  z.object({
    type: z.literal('calc'),
    variable: id,
    op: z.enum(CALC_OPS),
    /** Número fijo, o el valor numérico de una respuesta (q:<id>). */
    value: z.union([z.number().min(-1e9).max(1e9), z.string().regex(/^q:[a-z0-9_]{1,40}$/i)]),
  }),
]);
export type LogicAction = z.infer<typeof actionSchema>;

export const ruleSchema = z.object({
  id,
  /** Sin condiciones = siempre. */
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
});
export type LogicRule = z.infer<typeof ruleSchema>;

export const endingSchema = z.object({
  id,
  title: text(500),
  description: text(2000).default(''),
  button: text(60).optional(),
  /** Al terminar, ir a esta URL (https). */
  redirectUrl: z
    .string()
    .max(2000)
    .refine((v) => v === '' || /^https:\/\//i.test(v), 'invalid_url')
    .optional(),
});
export type Ending = z.infer<typeof endingSchema>;

export const definitionSchema = z.object({
  welcome: z
    .object({ enabled: z.boolean(), title: text(500), description: text(2000).default(''), button: text(60).default('') })
    .default({ enabled: false, title: '', description: '', button: '' }),
  questions: z.array(questionSchema).max(150),
  /** Reglas por pregunta (se evalúan al dejarla, en orden). */
  logic: z.record(z.array(ruleSchema).max(20)).default({}),
  variables: z.array(z.object({ name: id, initial: z.number().min(-1e9).max(1e9).default(0) })).max(10).default([]),
  endings: z.array(endingSchema).min(1).max(20),
  /** Campos ocultos: se leen de la URL (?name=…). */
  hidden: z.array(id).max(20).default([]),
  consent: z.object({ enabled: z.boolean(), required: z.boolean(), text: text(1000) }).default({ enabled: false, required: true, text: '' }),
  lang: z.enum(FORM_LANGS).default('en'),
  languages: z.array(z.enum(FORM_LANGS)).max(3).default([]),
  /** Traducciones: idioma → clave (q.<id>.title, …) → texto. */
  translations: z.record(z.record(text(2000))).default({}),
});
export type FormDefinition = z.infer<typeof definitionSchema>;

export const themeSchema = z.object({
  background: hex,
  text: hex,
  accent: hex,
  /** Color del texto encima del acento (botones). */
  onAccent: hex,
  font: z.enum(FONT_KEYS),
});
export type FormTheme = z.infer<typeof themeSchema>;

export const THEME_PRESETS: Record<string, FormTheme> = {
  paper: { background: '#ffffff', text: '#1a1a1a', accent: '#1a1a1a', onAccent: '#ffffff', font: 'system' },
  night: { background: '#111418', text: '#f2f2f2', accent: '#7cc4ff', onAccent: '#111418', font: 'system' },
  sand: { background: '#f6f1e7', text: '#2b2118', accent: '#b4541a', onAccent: '#ffffff', font: 'serif' },
  forest: { background: '#eef4ef', text: '#14301f', accent: '#1f6b3a', onAccent: '#ffffff', font: 'rounded' },
  ink: { background: '#0b1a33', text: '#e8eefb', accent: '#ffd166', onAccent: '#0b1a33', font: 'mono' },
};

export const settingsSchema = z.object({
  /** Una pregunta por pantalla (Typeform) o todo en una página. */
  mode: z.enum(['conversational', 'classic']),
  theme: themeSchema,
  progressBar: z.boolean(),
  /** Cierra en esta fecha (ISO) o nunca (''). */
  closeAt: z.string().max(40),
  /** Máximo de respuestas completas (0 = sin límite). */
  responseLimit: z.number().int().min(0).max(1_000_000),
  /** Máximo de respuestas por IP (0 = sin límite). */
  perIpLimit: z.number().int().min(0).max(1000),
  /** Guardar respuestas parciales (solo si quien responde acepta). */
  partials: z.boolean(),
  /** Guardar el progreso en el navegador para retomar. */
  resume: z.boolean(),
  closedMessage: text(500),
  notifyPeople: z.array(z.string().max(64)).max(20),
  notifyEmails: z.array(z.string().trim().max(320).email()).max(10),
  /** Días que se guardan las respuestas (0 = siempre). */
  retentionDays: z.number().int().min(0).max(3650),
  crm: z.object({
    enabled: z.boolean(),
    email: z.string().max(40),
    name: z.string().max(40),
    phone: z.string().max(40),
    company: z.string().max(40),
  }),
  webhookUrl: z
    .string()
    .max(2000)
    .refine((v) => v === '' || /^https:\/\//i.test(v), 'invalid_url'),
});
export type FormSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: FormSettings = {
  mode: 'conversational',
  theme: THEME_PRESETS.paper,
  progressBar: true,
  closeAt: '',
  responseLimit: 0,
  perIpLimit: 0,
  partials: false,
  resume: true,
  closedMessage: '',
  notifyPeople: [],
  notifyEmails: [],
  retentionDays: 0,
  crm: { enabled: false, email: '', name: '', phone: '', company: '' },
  webhookUrl: '',
};

export const FORM_STATUSES = ['draft', 'published', 'closed'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const SHARING = ['workspace', 'people'] as const;
export type Sharing = (typeof SHARING)[number];

/** Valor de una respuesta (según el tipo). */
export type AnswerValue = string | number | boolean | string[] | Record<string, string> | FileAnswer;
export interface FileAnswer {
  fileId: string;
  name: string;
  size: number;
}
export type Answers = Record<string, AnswerValue>;

export class FormsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'FormsError';
  }
}

/** Quién actúa: workspace (id del owner), persona real y si es admin. */
export interface FormsActor {
  ws: string;
  person: string;
  admin: boolean;
  /** Tiene el CRM en este workspace (para prender la integración). */
  crm?: boolean;
}

export function newId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

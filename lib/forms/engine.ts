/**
 * Forms: el motor (puro). Validación de respuestas, lógica (saltos, ramas,
 * variables calculadas y finales por camino), piping de respuestas,
 * traducciones, CSV y resumen por pregunta.
 *
 * La lógica se evalúa con una tabla de operadores: no hay eval, ni Function,
 * ni expresiones libres. Un salto solo puede ir hacia adelante (a una
 * pregunta posterior o a un final), así que el recorrido siempre termina.
 */
import { compareText, csvLine, isEmail, isHttpUrl, isPhone } from '../form-engine';
import {
  CHOICE_TYPES,
  FormsError,
  NO_ANSWER_TYPES,
  definitionSchema,
  type AnswerValue,
  type Answers,
  type Condition,
  type FileAnswer,
  type FormDefinition,
  type FormLang,
  type Question,
} from './types';

// ---------- Definición ----------

export function emptyDefinition(lang: FormLang = 'en'): FormDefinition {
  return {
    welcome: { enabled: false, title: '', description: '', button: '' },
    questions: [],
    logic: {},
    variables: [],
    endings: [{ id: 'end_default', title: lang === 'es' ? '¡Gracias!' : lang === 'pt' ? 'Obrigado!' : 'Thanks!', description: '' }],
    hidden: [],
    consent: { enabled: false, required: true, text: '' },
    lang,
    languages: [],
    translations: {},
  };
}

/** JSON guardado → definición completa (o una vacía si está rota). */
export function normalizeDefinition(raw: unknown): FormDefinition {
  const parsed = definitionSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyDefinition();
}

const scaleSteps = (q: Question) => (q.type === 'opinion_scale' ? (q.nps ? 11 : (q.steps ?? 5)) : (q.steps ?? 5));
const scaleStart = (q: Question) => (q.nps ? 0 : (q.start ?? 1));

/**
 * Chequea lo que el schema no puede: ids y refs únicos, opciones donde hacen
 * falta, saltos solo hacia adelante y condiciones sobre cosas que existen.
 */
export function checkDefinition(def: FormDefinition): FormDefinition {
  const ids = new Set<string>();
  const refs = new Set<string>();
  for (const q of def.questions) {
    if (ids.has(q.id)) throw new FormsError('duplicate_question');
    ids.add(q.id);
    if (refs.has(q.ref)) throw new FormsError('duplicate_ref', 400, { ref: q.ref });
    refs.add(q.ref);
    if (CHOICE_TYPES.includes(q.type)) {
      if (!q.choices?.length) throw new FormsError('missing_choices', 400, { question: q.id });
      if (new Set(q.choices.map((c) => c.id)).size !== q.choices.length) throw new FormsError('duplicate_choice');
    }
    if (q.type === 'matrix' && (!q.rows?.length || !q.columns?.length)) throw new FormsError('missing_choices', 400, { question: q.id });
    if (q.type === 'rating' && (scaleSteps(q) < 3 || scaleSteps(q) > 10)) throw new FormsError('invalid_steps');
  }
  const endings = new Set(def.endings.map((e) => e.id));
  if (endings.size !== def.endings.length) throw new FormsError('duplicate_ending');
  const vars = new Set(def.variables.map((v) => v.name));
  vars.add('score');
  const hidden = new Set(def.hidden);
  const index = new Map(def.questions.map((q, i) => [q.id, i]));
  for (const [qid, rules] of Object.entries(def.logic)) {
    const at = index.get(qid);
    if (at === undefined) throw new FormsError('invalid_logic', 400, { question: qid });
    for (const r of rules) {
      for (const c of r.conditions) {
        const [kind, name] = splitLeft(c.left);
        if (kind === 'q' && !index.has(name)) throw new FormsError('invalid_logic', 400, { question: qid });
        if (kind === 'v' && !vars.has(name)) throw new FormsError('invalid_logic', 400, { question: qid });
        if (kind === 'h' && !hidden.has(name)) throw new FormsError('invalid_logic', 400, { question: qid });
      }
      for (const a of r.actions) {
        if (a.type === 'jump') {
          const [kind, target] = a.to.split(':');
          if (kind === 'end' ? !endings.has(target) : (index.get(target) ?? -1) <= at) throw new FormsError('invalid_jump', 400, { question: qid });
        } else {
          if (a.variable !== 'score' && !vars.has(a.variable)) throw new FormsError('invalid_logic', 400, { question: qid });
          if (typeof a.value === 'string' && !index.has(a.value.slice(2))) throw new FormsError('invalid_logic', 400, { question: qid });
        }
      }
    }
  }
  return def;
}

function splitLeft(left: string): ['q' | 'v' | 'h', string] {
  const i = left.indexOf(':');
  return [left.slice(0, i) as 'q' | 'v' | 'h', left.slice(i + 1)];
}

// ---------- Traducciones ----------

export interface TranslatableString {
  key: string;
  source: string;
}

/** Todos los textos traducibles de la definición (en el idioma base). */
export function translatableStrings(def: FormDefinition): TranslatableString[] {
  const out: TranslatableString[] = [];
  const add = (key: string, source: string | undefined) => {
    if (source && source.trim()) out.push({ key, source });
  };
  if (def.welcome.enabled) {
    add('welcome.title', def.welcome.title);
    add('welcome.description', def.welcome.description);
    add('welcome.button', def.welcome.button);
  }
  for (const q of def.questions) {
    add(`q.${q.id}.title`, q.title);
    add(`q.${q.id}.description`, q.description);
    add(`q.${q.id}.placeholder`, q.placeholder);
    add(`q.${q.id}.left`, q.leftLabel);
    add(`q.${q.id}.right`, q.rightLabel);
    add(`q.${q.id}.button`, q.button);
    for (const c of q.choices ?? []) add(`q.${q.id}.choice.${c.id}`, c.label);
    for (const c of q.rows ?? []) add(`q.${q.id}.row.${c.id}`, c.label);
    for (const c of q.columns ?? []) add(`q.${q.id}.col.${c.id}`, c.label);
  }
  for (const e of def.endings) {
    add(`ending.${e.id}.title`, e.title);
    add(`ending.${e.id}.description`, e.description);
    add(`ending.${e.id}.button`, e.button);
  }
  if (def.consent.enabled) add('consent.text', def.consent.text);
  return out;
}

/** La definición en otro idioma: cada texto traducido reemplaza al base; lo que falta queda en el base. */
export function localize(def: FormDefinition, lang: string): FormDefinition {
  if (lang === def.lang || !def.languages.includes(lang as FormLang)) return def;
  const tr = def.translations[lang] ?? {};
  const t = (key: string, base: string | undefined) => (tr[key]?.trim() ? tr[key] : base);
  return {
    ...def,
    welcome: { ...def.welcome, title: t('welcome.title', def.welcome.title) ?? '', description: t('welcome.description', def.welcome.description) ?? '', button: t('welcome.button', def.welcome.button) ?? '' },
    questions: def.questions.map((q) => ({
      ...q,
      title: t(`q.${q.id}.title`, q.title) ?? '',
      description: t(`q.${q.id}.description`, q.description) ?? '',
      placeholder: t(`q.${q.id}.placeholder`, q.placeholder),
      leftLabel: t(`q.${q.id}.left`, q.leftLabel),
      rightLabel: t(`q.${q.id}.right`, q.rightLabel),
      button: t(`q.${q.id}.button`, q.button),
      choices: q.choices?.map((c) => ({ ...c, label: t(`q.${q.id}.choice.${c.id}`, c.label) ?? '' })),
      rows: q.rows?.map((c) => ({ ...c, label: t(`q.${q.id}.row.${c.id}`, c.label) ?? '' })),
      columns: q.columns?.map((c) => ({ ...c, label: t(`q.${q.id}.col.${c.id}`, c.label) ?? '' })),
    })),
    endings: def.endings.map((e) => ({ ...e, title: t(`ending.${e.id}.title`, e.title) ?? '', description: t(`ending.${e.id}.description`, e.description) ?? '', button: t(`ending.${e.id}.button`, e.button) })),
    consent: { ...def.consent, text: t('consent.text', def.consent.text) ?? '' },
  };
}

/** Idioma para quien responde: el pedido si el form lo tiene, si no el base. */
export function pickLang(def: FormDefinition, wanted: string | null | undefined): FormLang {
  const all = [def.lang, ...def.languages];
  const w = (wanted ?? '').slice(0, 2).toLowerCase();
  return (all.includes(w as FormLang) ? w : def.lang) as FormLang;
}

// ---------- Respuestas ----------

export type AnswerError =
  | 'required'
  | 'invalid'
  | 'invalid_email'
  | 'invalid_phone'
  | 'invalid_url'
  | 'invalid_number'
  | 'too_short'
  | 'too_long'
  | 'too_small'
  | 'too_large'
  | 'too_few'
  | 'too_many'
  | 'invalid_date'
  | 'invalid_option';

export function isEmptyAnswer(v: AnswerValue | undefined | null): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return 'fileId' in v ? !(v as FileAnswer).fileId : Object.keys(v).length === 0;
  return false;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Valida una respuesta y la devuelve normalizada (o el error). Una respuesta
 * vacía es válida si la pregunta no es obligatoria (devuelve undefined).
 */
export function checkAnswer(q: Question, raw: unknown): { value?: AnswerValue; error?: AnswerError } {
  if (NO_ANSWER_TYPES.includes(q.type)) return {};
  const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0);
  if (empty) return q.required ? { error: 'required' } : {};
  switch (q.type) {
    case 'short_text':
    case 'long_text': {
      if (typeof raw !== 'string') return { error: 'invalid' };
      const v = raw.trim().slice(0, q.type === 'short_text' ? 1000 : 10000);
      if (q.min !== undefined && v.length < q.min) return { error: 'too_short' };
      if (q.max !== undefined && v.length > q.max) return { error: 'too_long' };
      return { value: v };
    }
    case 'email': {
      if (typeof raw !== 'string') return { error: 'invalid' };
      const v = raw.trim().toLowerCase();
      return isEmail(v) ? { value: v } : { error: 'invalid_email' };
    }
    case 'phone': {
      if (typeof raw !== 'string') return { error: 'invalid' };
      const v = raw.trim();
      return isPhone(v) ? { value: v } : { error: 'invalid_phone' };
    }
    case 'url': {
      if (typeof raw !== 'string') return { error: 'invalid' };
      let v = raw.trim();
      if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
      return isHttpUrl(v) ? { value: v } : { error: 'invalid_url' };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(',', '.')) : NaN;
      if (!Number.isFinite(n)) return { error: 'invalid_number' };
      if (q.min !== undefined && n < q.min) return { error: 'too_small' };
      if (q.max !== undefined && n > q.max) return { error: 'too_large' };
      return { value: n };
    }
    case 'date': {
      if (typeof raw !== 'string' || !validDate(raw)) return { error: 'invalid_date' };
      if (q.minDate && raw < q.minDate) return { error: 'too_small' };
      if (q.maxDate && raw > q.maxDate) return { error: 'too_large' };
      return { value: raw };
    }
    case 'choice':
    case 'dropdown': {
      if (typeof raw !== 'string' || !q.choices?.some((c) => c.id === raw)) return { error: 'invalid_option' };
      return { value: raw };
    }
    case 'multi_choice': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !q.choices?.some((c) => c.id === x))) return { error: 'invalid_option' };
      const v = [...new Set(raw as string[])];
      if (q.min !== undefined && v.length < q.min) return { error: 'too_few' };
      if (q.max !== undefined && v.length > q.max) return { error: 'too_many' };
      return { value: v };
    }
    case 'ranking': {
      const all = (q.choices ?? []).map((c) => c.id);
      if (!Array.isArray(raw) || raw.length !== all.length || new Set(raw).size !== all.length || raw.some((x) => !all.includes(x as string))) {
        return { error: 'invalid_option' };
      }
      return { value: raw as string[] };
    }
    case 'yes_no': {
      if (raw === true || raw === 'yes') return { value: true };
      if (raw === false || raw === 'no') return { value: false };
      return { error: 'invalid' };
    }
    case 'rating':
    case 'opinion_scale': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      const lo = q.type === 'rating' ? 1 : scaleStart(q);
      const hi = q.type === 'rating' ? scaleSteps(q) : lo + scaleSteps(q) - 1;
      if (!Number.isInteger(n) || n < lo || n > hi) return { error: 'invalid_option' };
      return { value: n };
    }
    case 'matrix': {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid' };
      const out: Record<string, string> = {};
      for (const [row, col] of Object.entries(raw as Record<string, unknown>)) {
        if (!q.rows?.some((r) => r.id === row) || typeof col !== 'string' || !q.columns?.some((c) => c.id === col)) return { error: 'invalid_option' };
        out[row] = col;
      }
      if (q.required && Object.keys(out).length < (q.rows?.length ?? 0)) return { error: 'required' };
      return Object.keys(out).length ? { value: out } : q.required ? { error: 'required' } : {};
    }
    case 'file_upload': {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid' };
      const f = raw as Partial<FileAnswer>;
      if (typeof f.fileId !== 'string' || !/^fmf_[a-z0-9]{10,40}$/i.test(f.fileId)) return { error: 'invalid' };
      return { value: { fileId: f.fileId, name: String(f.name ?? '').slice(0, 200), size: Number(f.size) || 0 } };
    }
    case 'signature': {
      // Firma dibujada: PNG en data URL (el servidor la pasa a archivo privado).
      if (typeof raw !== 'string' || !/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(raw) || raw.length > 400_000) return { error: 'invalid' };
      return { value: raw };
    }
    default:
      return { error: 'invalid' };
  }
}

// ---------- Lógica ----------

function answerAsText(q: Question | undefined, v: AnswerValue | undefined): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return q?.type === 'signature' ? 'signed' : v;
  if (Array.isArray(v)) return v.join(',');
  if ('fileId' in v) return (v as FileAnswer).name || 'file';
  return Object.values(v).join(',');
}

function asNumber(v: AnswerValue | undefined | number): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

export interface LogicState {
  answers: Answers;
  hidden: Record<string, string>;
  vars: Record<string, number>;
}

/** Evalúa una condición (tabla de operadores, nada de eval). */
export function evalCondition(def: FormDefinition, c: Condition, state: LogicState): boolean {
  const [kind, name] = splitLeft(c.left);
  const q = kind === 'q' ? def.questions.find((x) => x.id === name) : undefined;
  const raw: AnswerValue | number | undefined = kind === 'q' ? state.answers[name] : kind === 'v' ? state.vars[name] : state.hidden[name];
  switch (c.op) {
    case 'answered':
      return !isEmptyAnswer(raw as AnswerValue);
    case 'not_answered':
      return isEmptyAnswer(raw as AnswerValue);
    case 'includes':
    case 'not_includes': {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
      const has = list.includes(c.value);
      return c.op === 'includes' ? has : !has;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // Fechas (YYYY-MM-DD) se comparan como texto; el resto, como número.
      if (typeof raw === 'string' && DATE_RE.test(raw) && DATE_RE.test(c.value)) {
        return c.op === 'gt' ? raw > c.value : c.op === 'gte' ? raw >= c.value : c.op === 'lt' ? raw < c.value : raw <= c.value;
      }
      const a = asNumber(raw as AnswerValue);
      const b = asNumber(c.value);
      if (a === null || b === null) return false;
      return c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b;
    }
    default: {
      const text = kind === 'q' ? answerAsText(q, raw as AnswerValue) : raw === undefined ? '' : String(raw);
      const op = c.op === 'is' ? 'equals' : c.op === 'is_not' ? 'not_equals' : c.op;
      return compareText(op as 'equals' | 'not_equals' | 'contains' | 'not_contains', text, c.value);
    }
  }
}

export interface PathResult {
  /** Preguntas en el orden en que se ven con estas respuestas. */
  path: string[];
  /** Final al que llega (o el primero). */
  endingId: string;
  vars: Record<string, number>;
}

/**
 * Recorrido con las respuestas actuales: arranca en la primera pregunta y en
 * cada una suma los puntos de las opciones elegidas, aplica las reglas en
 * orden (los cálculos de todas las que se cumplen; el primer salto gana) y
 * sigue. Las preguntas que todavía no se respondieron siguen de largo, así
 * que el mismo recorrido sirve para la pantalla de a una, la clásica y el
 * servidor.
 */
export function computePath(def: FormDefinition, answers: Answers, hidden: Record<string, string> = {}): PathResult {
  const vars: Record<string, number> = { score: 0 };
  for (const v of def.variables) vars[v.name] = v.initial;
  const state: LogicState = { answers, hidden, vars };
  const path: string[] = [];
  const index = new Map(def.questions.map((q, i) => [q.id, i]));
  let i = 0;
  let endingId = def.endings[0]?.id ?? '';
  let guard = 0;
  while (i < def.questions.length && guard++ < 1000) {
    const q = def.questions[i];
    path.push(q.id);
    const a = answers[q.id];
    if (q.choices?.length && a !== undefined) {
      const picked = Array.isArray(a) ? a : typeof a === 'string' ? [a] : [];
      if (q.type !== 'ranking') for (const c of q.choices) if (picked.includes(c.id) && c.points) vars.score += c.points;
    }
    let jump: string | null = null;
    for (const rule of def.logic[q.id] ?? []) {
      const ok = rule.conditions.length === 0 || (rule.match === 'any' ? rule.conditions.some((c) => evalCondition(def, c, state)) : rule.conditions.every((c) => evalCondition(def, c, state)));
      if (!ok) continue;
      for (const act of rule.actions) {
        if (act.type === 'calc') {
          const n = typeof act.value === 'number' ? act.value : (asNumber(answers[act.value.slice(2)]) ?? 0);
          const cur = vars[act.variable] ?? 0;
          vars[act.variable] =
            act.op === 'add' ? cur + n : act.op === 'subtract' ? cur - n : act.op === 'multiply' ? cur * n : act.op === 'divide' ? (n === 0 ? cur : cur / n) : n;
          if (!Number.isFinite(vars[act.variable])) vars[act.variable] = 0;
        } else if (!jump) jump = act.to;
      }
    }
    if (jump?.startsWith('end:')) {
      endingId = jump.slice(4);
      return { path, endingId, vars };
    }
    const next = jump ? (index.get(jump.slice(2)) ?? i + 1) : i + 1;
    i = next > i ? next : i + 1;
  }
  return { path, endingId, vars };
}

export interface CheckedResponse {
  answers: Answers;
  errors: Record<string, AnswerError>;
  path: string[];
  endingId: string;
  vars: Record<string, number>;
}

/**
 * Valida un envío completo: recorre la lógica con lo enviado, valida solo las
 * preguntas del camino (las que quedaron fuera por una rama no se exigen ni se
 * guardan) y vuelve a recorrer con los valores limpios.
 */
export function checkResponse(def: FormDefinition, raw: Record<string, unknown>, hidden: Record<string, string> = {}): CheckedResponse {
  const clean: Answers = {};
  for (const q of def.questions) {
    const r = checkAnswer({ ...q, required: false }, raw[q.id]);
    if (r.value !== undefined) clean[q.id] = r.value;
  }
  const { path } = computePath(def, clean, hidden);
  const answers: Answers = {};
  const errors: Record<string, AnswerError> = {};
  for (const qid of path) {
    const q = def.questions.find((x) => x.id === qid)!;
    const r = checkAnswer(q, raw[qid]);
    if (r.error) errors[qid] = r.error;
    else if (r.value !== undefined) answers[qid] = r.value;
  }
  const final = computePath(def, answers, hidden);
  return { answers, errors, ...final };
}

/** Respuestas parciales: solo valores válidos de preguntas que existen (nada se exige). */
export function cleanPartial(def: FormDefinition, raw: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const q of def.questions) {
    if (q.type === 'file_upload' || q.type === 'signature') continue;
    const r = checkAnswer({ ...q, required: false }, raw[q.id]);
    if (r.value !== undefined) out[q.id] = r.value;
  }
  return out;
}

/** Campos ocultos desde los parámetros de la URL (solo los declarados). */
export function hiddenFrom(def: FormDefinition, params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of def.hidden) {
    const v = params[name];
    if (typeof v === 'string' && v) out[name] = v.slice(0, 300);
  }
  return out;
}

// ---------- Texto de una respuesta y piping ----------

export interface DisplayLabels {
  yes: string;
  no: string;
  file: string;
  signed: string;
}
export const EN_LABELS: DisplayLabels = { yes: 'Yes', no: 'No', file: 'File', signed: 'Signed' };

/** Respuesta como texto para mostrar (opciones por su etiqueta). Texto plano. */
export function answerDisplay(q: Question, v: AnswerValue | undefined, labels: DisplayLabels = EN_LABELS): string {
  if (v === undefined || v === null) return '';
  const label = (id: string, list = q.choices) => list?.find((c) => c.id === id)?.label ?? id;
  switch (q.type) {
    case 'choice':
    case 'dropdown':
      return label(String(v));
    case 'multi_choice':
      return (v as string[]).map((x) => label(x)).join(', ');
    case 'ranking':
      return (v as string[]).map((x, i) => `${i + 1}. ${label(x)}`).join(', ');
    case 'yes_no':
      return v ? labels.yes : labels.no;
    case 'matrix':
      return Object.entries(v as Record<string, string>)
        .map(([r, c]) => `${label(r, q.rows)}: ${label(c, q.columns)}`)
        .join('; ');
    case 'file_upload':
      return (v as FileAnswer).name || labels.file;
    case 'signature':
      return labels.signed;
    default:
      return String(v);
  }
}

const PIPE_RE = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/gi;

/**
 * Reemplaza {{ref}} por la respuesta (por ref de pregunta), {{score}} y otras
 * variables, y campos ocultos. Devuelve texto plano: quien lo muestra lo
 * escapa (React o escapeHtml), así que una respuesta con HTML queda como
 * texto. Cada valor insertado se corta en 200 caracteres.
 */
export function pipe(text: string, def: FormDefinition, ctx: { answers: Answers; vars?: Record<string, number>; hidden?: Record<string, string>; labels?: DisplayLabels }): string {
  if (!text.includes('{{')) return text;
  return text.replace(PIPE_RE, (_, key: string) => {
    const q = def.questions.find((x) => x.ref === key);
    let out = '';
    if (q) out = answerDisplay(q, ctx.answers[q.id], ctx.labels);
    else if (ctx.vars && key in ctx.vars) out = String(Math.round(ctx.vars[key] * 100) / 100);
    else if (ctx.hidden && key in ctx.hidden) out = ctx.hidden[key];
    return out.slice(0, 200);
  });
}

/** Escape para HTML (emails de aviso). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- CSV ----------

export interface CsvRow {
  id: string;
  status: string;
  submittedAt: string | null;
  createdAt: string;
  lang: string;
  endingId: string | null;
  answers: Answers;
  hidden: Record<string, string>;
  vars: Record<string, number>;
}

/** CSV de respuestas: una columna por pregunta, ocultos y variables. Guarda de fórmulas en cada celda. */
export function responsesCsv(def: FormDefinition, rows: CsvRow[]): string {
  const qs = def.questions.filter((q) => !NO_ANSWER_TYPES.includes(q.type));
  const varNames = ['score', ...def.variables.map((v) => v.name).filter((n) => n !== 'score')];
  const endingTitle = (id: string | null) => def.endings.find((e) => e.id === id)?.title ?? '';
  const header = ['response_id', 'status', 'submitted_at', 'language', 'ending', ...qs.map((q) => q.title || q.ref), ...def.hidden, ...varNames];
  const lines = [csvLine(header)];
  for (const r of rows) {
    lines.push(
      csvLine([
        r.id,
        r.status,
        r.submittedAt ?? r.createdAt,
        r.lang,
        endingTitle(r.endingId),
        ...qs.map((q) => answerDisplay(q, r.answers[q.id])),
        ...def.hidden.map((h) => r.hidden[h] ?? ''),
        ...varNames.map((n) => (r.vars[n] === undefined ? '' : r.vars[n])),
      ]),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ---------- Resumen ----------

export interface QuestionSummary {
  id: string;
  ref: string;
  type: Question['type'];
  title: string;
  answered: number;
  /** Conteo por opción / valor (barras). */
  counts?: Array<{ key: string; label: string; count: number }>;
  average?: number | null;
  nps?: { score: number; promoters: number; passives: number; detractors: number } | null;
  /** Últimas respuestas de texto. */
  samples?: string[];
  /** Matriz: conteo por fila y columna. */
  matrix?: Array<{ row: string; counts: Array<{ label: string; count: number }> }>;
}

export function npsOf(values: number[]): { score: number; promoters: number; passives: number; detractors: number } | null {
  if (!values.length) return null;
  const promoters = values.filter((v) => v >= 9).length;
  const detractors = values.filter((v) => v <= 6).length;
  const passives = values.length - promoters - detractors;
  return { score: Math.round(((promoters - detractors) / values.length) * 100), promoters, passives, detractors };
}

/** Resumen por pregunta sobre respuestas completas (más nuevas primero). */
export function summarize(def: FormDefinition, responses: Array<{ answers: Answers }>, labels: DisplayLabels = EN_LABELS): QuestionSummary[] {
  return def.questions
    .filter((q) => !NO_ANSWER_TYPES.includes(q.type))
    .map((q) => {
      const vals = responses.map((r) => r.answers[q.id]).filter((v) => !isEmptyAnswer(v));
      const base: QuestionSummary = { id: q.id, ref: q.ref, type: q.type, title: q.title, answered: vals.length };
      const count = (keys: Array<{ key: string; label: string }>, pick: (v: AnswerValue) => string[]) => {
        const m = new Map(keys.map((k) => [k.key, 0]));
        for (const v of vals) for (const k of pick(v)) if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1);
        return keys.map((k) => ({ ...k, count: m.get(k.key) ?? 0 }));
      };
      switch (q.type) {
        case 'choice':
        case 'dropdown':
        case 'multi_choice':
          return { ...base, counts: count((q.choices ?? []).map((c) => ({ key: c.id, label: c.label })), (v) => (Array.isArray(v) ? v : [String(v)])) };
        case 'ranking': {
          // Posición promedio (1 = primero): menos es mejor.
          const pos = new Map<string, number[]>();
          for (const v of vals as string[][]) v.forEach((c, i) => pos.set(c, [...(pos.get(c) ?? []), i + 1]));
          return {
            ...base,
            counts: (q.choices ?? [])
              .map((c) => {
                const p = pos.get(c.id) ?? [];
                return { key: c.id, label: c.label, count: p.length ? Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 10) / 10 : 0 };
              })
              .sort((a, b) => a.count - b.count),
          };
        }
        case 'yes_no':
          return { ...base, counts: count([{ key: 'true', label: labels.yes }, { key: 'false', label: labels.no }], (v) => [String(v)]) };
        case 'rating':
        case 'opinion_scale': {
          const nums = vals.map(Number);
          const lo = q.type === 'rating' ? 1 : scaleStart(q);
          const hi = q.type === 'rating' ? scaleSteps(q) : lo + scaleSteps(q) - 1;
          const keys = Array.from({ length: hi - lo + 1 }, (_, i) => ({ key: String(lo + i), label: String(lo + i) }));
          return {
            ...base,
            counts: count(keys, (v) => [String(v)]),
            average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null,
            nps: q.nps ? npsOf(nums) : null,
          };
        }
        case 'number': {
          const nums = vals.map(Number);
          return { ...base, average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null, samples: nums.slice(0, 5).map(String) };
        }
        case 'matrix':
          return {
            ...base,
            matrix: (q.rows ?? []).map((r) => ({
              row: r.label,
              counts: (q.columns ?? []).map((c) => ({ label: c.label, count: vals.filter((v) => (v as Record<string, string>)[r.id] === c.id).length })),
            })),
          };
        case 'file_upload':
        case 'signature':
          return base;
        default:
          return { ...base, samples: vals.slice(0, 5).map((v) => answerDisplay(q, v, labels)) };
      }
    });
}

/** Abandono por pregunta: cuántas visitas llegaron a cada una (en el orden del form). */
export function dropOff(def: FormDefinition, visits: number, reached: Record<string, number>, completed: number): Array<{ id: string; title: string; reached: number; rate: number }> {
  return [
    ...def.questions.map((q) => ({ id: q.id, title: q.title, reached: reached[q.id] ?? 0 })),
    { id: '__completed', title: '', reached: completed },
  ].map((r) => ({ ...r, rate: visits ? Math.round((r.reached / visits) * 1000) / 10 : 0 }));
}

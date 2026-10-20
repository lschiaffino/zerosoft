/**
 * Robots — catálogo de pasos, validación (zod), límites y plantillas. Sin
 * dependencias de servidor: lo comparten la API, el runner y el editor.
 *
 * Un robot es una lista de pasos de navegador (goto, click, fill, extract…)
 * que se ejecuta en un Chromium aislado (ver lib/robots-runner.ts). Los textos
 * admiten plantillas {{inputs.x}}, {{vars.x}} y, dentro de un loop,
 * {{loop.item}} / {{loop.index}}.
 */
import { z } from 'zod';
import { isValidCron, isValidTimezone } from './cron';

// ---------- Límites ----------

/** Pasos definidos (contando los anidados en loops). */
export const MAX_ROBOT_STEPS = 100;
/** Pasos dentro de un loop_over. */
export const MAX_LOOP_STEPS = 20;
/** Elementos que recorre un loop_over. */
export const MAX_LOOP_ITEMS = 50;
/** Acciones ejecutadas por corrida (loops incluidos). */
export const MAX_EXECUTED_STEPS = 500;
/** Navegaciones / pestañas por corrida. */
export const MAX_PAGES = 20;
/** Capturas por corrida. */
export const MAX_SCREENSHOTS = 5;
/**
 * Tiempo máximo de una corrida (segundos). Las rutas que corren robots en
 * forma sincrónica tienen maxDuration = 300 s: el resto queda para crear la
 * VM, el margen de corte (+45 s), subir capturas/archivos y registrar el uso.
 * Valores guardados mayores (antes el tope era 300) se acotan a este.
 */
export const MAX_TIMEOUT_SEC = 180;
export const DEFAULT_TIMEOUT_SEC = 120;
/** Variables de entrada por robot. */
export const MAX_INPUTS = 20;
/** Archivos (download / pdf) por corrida y tamaño máximo de cada uno. */
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Reintentos por paso. */
export const MAX_STEP_RETRIES = 5;
/** Intervalo mínimo de un schedule en minutos. */
export const MIN_SCHEDULE_MINUTES = 15;
/** Fallas seguidas (schedule o Flow) que pausan el schedule. 0 = nunca. */
export const DEFAULT_PAUSE_AFTER = 3;
export const MAX_PAUSE_AFTER = 20;
/** Días que se guardan las corridas. 0 = el default del servidor (ROBOTS_RUN_RETENTION_DAYS). */
export const RETENTION_OPTIONS = [0, 7, 30, 90, 365] as const;

// ---------- Pasos ----------

export const STEP_TYPES = [
  'goto',
  'click',
  'fill',
  'select',
  'press',
  'wait',
  'extract',
  'extract_table',
  'screenshot',
  'scroll',
  'if_exists',
  'download',
  'upload',
  'pdf',
  'evaluate',
  'loop_over',
] as const;
export type RobotStepType = (typeof STEP_TYPES)[number];

const varName = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]{0,39}$/, 'invalid_name');
const selector = z.string().trim().max(500);
const template = z.string().max(2000);

/**
 * Opciones de cualquier paso: reintentos (cantidad + espera entre intentos) y
 * seguir si falla (el error queda como advertencia y la corrida sigue).
 */
const retry = {
  retries: z.number().int().min(0).max(MAX_STEP_RETRIES).optional(),
  retryDelayMs: z.number().int().min(0).max(30_000).optional(),
  continueOnError: z.boolean().optional(),
};

const gotoStep = z.object({ type: z.literal('goto'), url: template.min(1), ...retry });
const clickStep = z.object({
  type: z.literal('click'),
  selector: selector.optional().default(''),
  text: z.string().max(200).optional().default(''),
  ...retry,
});
const fillStep = z.object({ type: z.literal('fill'), selector: selector.min(1), value: template.default(''), ...retry });
const selectStep = z.object({ type: z.literal('select'), selector: selector.min(1), value: template.default(''), ...retry });
const pressStep = z.object({
  type: z.literal('press'),
  key: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9+_ -]+$/),
  selector: selector.optional().default(''),
  ...retry,
});
const waitStep = z.object({
  type: z.literal('wait'),
  ms: z.number().int().min(0).max(30_000).optional().default(0),
  selector: selector.optional().default(''),
  ...retry,
});
const extractStep = z.object({
  type: z.literal('extract'),
  selector: selector.min(1),
  name: varName,
  mode: z.enum(['text', 'attribute', 'all']).default('text'),
  attribute: z.string().trim().max(60).optional().default(''),
  ...retry,
});
const extractTableStep = z.object({ type: z.literal('extract_table'), selector: selector.min(1), name: varName, ...retry });
const screenshotStep = z.object({ type: z.literal('screenshot'), name: varName, ...retry });
const scrollStep = z.object({
  type: z.literal('scroll'),
  selector: selector.optional().default(''),
  /** Píxeles a bajar; 0 = hasta el final de la página. */
  y: z.number().int().min(0).max(100_000).optional().default(0),
  ...retry,
});
/** Clic que dispara una descarga: el archivo va a Blob y {{vars.<name>.url}} queda con la URL. */
const downloadStep = z.object({
  type: z.literal('download'),
  selector: selector.optional().default(''),
  text: z.string().max(200).optional().default(''),
  name: varName,
  ...retry,
});
/** Sube a un <input type="file"> un archivo bajado de una URL pública. */
const uploadStep = z.object({
  type: z.literal('upload'),
  selector: selector.min(1),
  url: template.min(1),
  filename: z.string().max(200).optional().default(''),
  ...retry,
});
/** La página actual como PDF (A4) en Blob: {{vars.<name>.url}}. */
const pdfStep = z.object({ type: z.literal('pdf'), name: varName, ...retry });
/** JS propio dentro de la página (cuerpo de una función async); el valor devuelto (JSON) queda en vars. */
const evaluateStep = z.object({
  type: z.literal('evaluate'),
  script: z.string().min(1).max(10_000),
  name: varName,
  ...retry,
});
const ifExistsStep = z.object({
  type: z.literal('if_exists'),
  selector: selector.optional().default(''),
  text: z.string().max(200).optional().default(''),
  /** Si NO existe: saltear N pasos, ir a un paso (solo hacia adelante), terminar o fallar. */
  onMissing: z.enum(['skip', 'goto', 'stop', 'fail']).default('skip'),
  count: z.number().int().min(1).max(MAX_ROBOT_STEPS).optional().default(1),
  /** Número de paso (1-based) al que saltar con onMissing = goto. */
  target: z.number().int().min(1).max(MAX_ROBOT_STEPS).optional().default(1),
});

const leafStep = z.discriminatedUnion('type', [
  gotoStep,
  clickStep,
  fillStep,
  selectStep,
  pressStep,
  waitStep,
  extractStep,
  extractTableStep,
  screenshotStep,
  scrollStep,
  ifExistsStep,
  downloadStep,
  uploadStep,
  pdfStep,
  evaluateStep,
]);

const loopStep = z.object({
  type: z.literal('loop_over'),
  /** Lista a recorrer: {{inputs.urls}} o {{vars.links}}. */
  list: template.min(1),
  max: z.number().int().min(1).max(MAX_LOOP_ITEMS).optional().default(10),
  steps: z.array(leafStep).max(MAX_LOOP_STEPS),
  /** Si un elemento falla, queda como advertencia y el loop pasa al siguiente. */
  continueOnItemError: z.boolean().optional(),
});

export const robotStepSchema = z.union([leafStep, loopStep]);
export type RobotStep = z.infer<typeof robotStepSchema>;
export type RobotLeafStep = z.infer<typeof leafStep>;

export const robotInputSchema = z.object({
  name: varName,
  label: z.string().max(80).optional().default(''),
  kind: z.enum(['text', 'list']).default('text'),
  default: z.string().max(5000).optional().default(''),
  required: z.boolean().optional().default(false),
});
export type RobotInputDef = z.infer<typeof robotInputSchema>;

export const robotScheduleSchema = z
  .object({
    mode: z.enum(['daily', 'interval', 'cron']),
    time: z.string().regex(/^\d{1,2}:\d{2}$/).optional().default('09:00'),
    timezone: z.string().max(60).optional().default('UTC'),
    every: z.number().int().min(1).max(1440).optional().default(24),
    unit: z.enum(['hours', 'minutes']).optional().default('hours'),
    /** Cron de 5 campos (mode = cron), en `timezone`. */
    cron: z.string().max(120).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.mode === 'interval') {
      if (s.unit === 'minutes' && s.every < MIN_SCHEDULE_MINUTES) ctx.addIssue({ code: 'custom', path: ['every'], message: 'min_interval' });
      if (s.unit === 'hours' && s.every > 168) ctx.addIssue({ code: 'custom', path: ['every'], message: 'max_interval' });
    }
    if (s.mode === 'cron' && !isValidCron(s.cron ?? '')) ctx.addIssue({ code: 'custom', path: ['cron'], message: 'invalid_cron' });
    if (s.mode !== 'interval' && !isValidTimezone(s.timezone)) ctx.addIssue({ code: 'custom', path: ['timezone'], message: 'invalid_timezone' });
  })
  .nullable();
export type RobotSchedule = z.infer<typeof robotScheduleSchema>;

export type RobotErrorCode =
  | 'invalid_steps'
  | 'too_many_steps'
  | 'invalid_inputs'
  | 'duplicate_input'
  | 'invalid_goto_target'
  | 'nested_loop';

/** Cantidad de pasos contando los anidados. */
export function countSteps(steps: readonly RobotStep[]): number {
  let n = 0;
  for (const s of steps) n += 1 + (s.type === 'loop_over' ? s.steps.length : 0);
  return n;
}

export type StepsValidation = { ok: true; steps: RobotStep[] } | { ok: false; error: RobotErrorCode; index?: number };

export function validateSteps(input: unknown): StepsValidation {
  if (!Array.isArray(input)) return { ok: false, error: 'invalid_steps' };
  if (input.length > MAX_ROBOT_STEPS) return { ok: false, error: 'too_many_steps' };
  const out: RobotStep[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as { type?: unknown; steps?: unknown } | null;
    if (raw && raw.type === 'loop_over' && Array.isArray(raw.steps)) {
      if (raw.steps.some((s) => (s as { type?: unknown } | null)?.type === 'loop_over')) {
        return { ok: false, error: 'nested_loop', index: i };
      }
    }
    const parsed = robotStepSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'invalid_steps', index: i };
    out.push(parsed.data);
  }
  if (countSteps(out) > MAX_ROBOT_STEPS) return { ok: false, error: 'too_many_steps' };
  // goto de if_exists: solo hacia adelante (sin ciclos) y dentro de la lista.
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.type === 'if_exists' && s.onMissing === 'goto' && (s.target <= i + 1 || s.target > out.length + 1)) {
      return { ok: false, error: 'invalid_goto_target', index: i };
    }
  }
  return { ok: true, steps: out };
}

export type InputsValidation = { ok: true; inputs: RobotInputDef[] } | { ok: false; error: RobotErrorCode };

export function validateInputDefs(input: unknown): InputsValidation {
  const parsed = z.array(robotInputSchema).max(MAX_INPUTS).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_inputs' };
  const names = new Set<string>();
  for (const d of parsed.data) {
    if (names.has(d.name)) return { ok: false, error: 'duplicate_input' };
    names.add(d.name);
  }
  return { ok: true, inputs: parsed.data };
}

/**
 * Valores de entrada de una corrida: aplica defaults, exige los requeridos y
 * convierte las listas (una por línea) en arrays. Ignora claves desconocidas.
 */
export function resolveInputs(
  defs: readonly RobotInputDef[],
  values: Record<string, unknown> | undefined,
): { ok: true; inputs: Record<string, unknown> } | { ok: false; error: 'missing_input'; name: string } {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const raw = values?.[d.name];
    let v: unknown = raw === undefined || raw === null || raw === '' ? d.default : raw;
    if (d.kind === 'list') {
      if (typeof v === 'string') {
        v = v
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean);
      } else if (!Array.isArray(v)) {
        v = v === undefined || v === null ? [] : [v];
      }
      v = (v as unknown[]).slice(0, 500).map((x) => (typeof x === 'string' ? x.slice(0, 2000) : x));
      if (d.required && (v as unknown[]).length === 0) return { ok: false, error: 'missing_input', name: d.name };
    } else {
      v = typeof v === 'string' ? v.slice(0, 5000) : v === undefined || v === null ? '' : String(v).slice(0, 5000);
      if (d.required && !(v as string).trim()) return { ok: false, error: 'missing_input', name: d.name };
    }
    out[d.name] = v;
  }
  return { ok: true, inputs: out };
}

/** Paso nuevo con valores por defecto (editor). */
export function defaultStep(type: RobotStepType): RobotStep {
  switch (type) {
    case 'goto':
      return { type, url: 'https://' };
    case 'click':
      return { type, selector: '', text: '' };
    case 'fill':
    case 'select':
      return { type, selector: '', value: '' };
    case 'press':
      return { type, key: 'Enter', selector: '' };
    case 'wait':
      return { type, ms: 1000, selector: '' };
    case 'extract':
      return { type, selector: '', name: 'value', mode: 'text', attribute: '' };
    case 'extract_table':
      return { type, selector: 'table', name: 'rows' };
    case 'screenshot':
      return { type, name: 'page' };
    case 'scroll':
      return { type, selector: '', y: 0 };
    case 'if_exists':
      return { type, selector: '', text: '', onMissing: 'skip', count: 1, target: 1 };
    case 'download':
      return { type, selector: '', text: '', name: 'file' };
    case 'upload':
      return { type, selector: 'input[type="file"]', url: '', filename: '' };
    case 'pdf':
      return { type, name: 'pdf' };
    case 'evaluate':
      return { type, script: 'return document.title;', name: 'result' };
    case 'loop_over':
      return { type, list: '{{inputs.urls}}', max: 10, steps: [] };
  }
}

// ---------- API ----------

export const robotCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  template: z.string().max(60).optional(),
});

export const robotUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  steps: z.unknown().optional(),
  inputs: z.unknown().optional(),
  enabled: z.boolean().optional(),
  schedule: robotScheduleSchema.optional(),
  // Hasta 300 por compatibilidad con robots viejos; se acota a MAX_TIMEOUT_SEC al guardar.
  timeoutSec: z.number().int().min(10).max(300).optional(),
  /** Guardar cookies y localStorage entre corridas (cifrados). */
  persistSession: z.boolean().optional(),
  /** Email al dueño cuando falla una corrida automática (con tope de frecuencia). */
  failureAlerts: z.boolean().optional(),
  /** Fallas seguidas que pausan el schedule (0 = nunca). */
  pauseAfter: z.number().int().min(0).max(MAX_PAUSE_AFTER).optional(),
  retentionDays: z
    .number()
    .int()
    .refine((n) => (RETENTION_OPTIONS as readonly number[]).includes(n), 'invalid_retention')
    .optional(),
});

export const robotRunSchema = z.object({
  inputs: z.record(z.unknown()).optional(),
});

// ---------- Plantillas ----------

export interface RobotTemplate {
  key: 'scrapeTable' | 'priceCheck' | 'fillForm' | 'screenshot';
  steps: RobotStep[];
  inputs: RobotInputDef[];
  schedule: RobotSchedule;
}

export const ROBOT_TEMPLATES: readonly RobotTemplate[] = [
  {
    key: 'scrapeTable',
    inputs: [{ name: 'url', label: 'Page URL', kind: 'text', default: 'https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations)', required: true }],
    schedule: null,
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'wait', ms: 0, selector: 'table' },
      { type: 'extract_table', selector: 'table', name: 'rows' },
    ],
  },
  {
    key: 'priceCheck',
    inputs: [
      { name: 'url', label: 'Product URL', kind: 'text', default: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html', required: true },
      { name: 'priceSelector', label: 'Price selector', kind: 'text', default: '.price_color', required: true },
    ],
    schedule: { mode: 'daily', time: '09:00', timezone: 'UTC', every: 24, unit: 'hours' },
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'extract', selector: 'h1', name: 'title', mode: 'text', attribute: '' },
      { type: 'extract', selector: '{{inputs.priceSelector}}', name: 'price', mode: 'text', attribute: '' },
    ],
  },
  {
    key: 'fillForm',
    inputs: [
      { name: 'url', label: 'Form URL', kind: 'text', default: 'https://httpbin.org/forms/post', required: true },
      { name: 'name', label: 'Name', kind: 'text', default: 'Ada Lovelace', required: false },
      { name: 'email', label: 'Email', kind: 'text', default: 'ada@example.com', required: false },
    ],
    schedule: null,
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'fill', selector: 'input[name="custname"]', value: '{{inputs.name}}' },
      { type: 'fill', selector: 'input[name="custemail"]', value: '{{inputs.email}}' },
      { type: 'click', selector: 'form button', text: 'Submit order' },
      { type: 'wait', ms: 1000, selector: '' },
      { type: 'extract', selector: 'body', name: 'response', mode: 'text', attribute: '' },
      { type: 'screenshot', name: 'result' },
    ],
  },
  {
    key: 'screenshot',
    inputs: [{ name: 'url', label: 'Page URL', kind: 'text', default: 'https://example.com', required: true }],
    schedule: null,
    steps: [
      { type: 'goto', url: '{{inputs.url}}' },
      { type: 'extract', selector: 'h1, p', name: 'heading', mode: 'text', attribute: '' },
      { type: 'screenshot', name: 'page' },
    ],
  },
];
